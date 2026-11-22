---------------------------- MODULE JobLifecycle ----------------------------
\* A model of the download queue that class Manager runs in
\* app/src/main/manager.js. The skill in .claude/skills/verify-job-lifecycle says
\* how to run it and how to keep it in step with the code.
\*
\* Each action is one synchronous stretch of a Manager method, from where the
\* method starts or an await returns to the next await or the end. Other actions
\* can only come in at those awaits. The awaits that matter are the one on run()
\* inside start() and the one on Promise.allSettled() inside shutdown().
\*
\* Node runs every queued promise callback before it takes the next IPC call,
\* HTTP request or timer. So no user action lands between the end of run() and
\* the .finally callback that start() hangs on it, or between the last of those
\* callbacks and the rest of shutdown(). UserCanAct says that.

EXTENDS Naturals, FiniteSets, TLC

CONSTANTS
    Jobs,       \* download ids
    BatchIds,   \* ids that startBatch() and commitBatch() hand out
    NoBatch,    \* job.batch of a file that is in no batch
    MaxActive,  \* settings.maxActive, "Downloads at the same time"
    \* Each switch puts one mistake back into the model. All are FALSE in the
    \* faithful configs.
    BUG_NO_STOPPING_GUARD,     \* before c6868a3 shutdown() set no this.stopping and schedule() read none
    BUG_NO_ACTIVE_LIMIT,       \* schedule() without "if (this.activeCount() >= max) break"
    BUG_NO_BUSY_CHECK,         \* schedule() without "if (busy.has(j.batch)) continue"
    BUG_KEEP_COOKIE,           \* before 29d0a6d and 9f23943 cleanup() left the browser cookie behind
    BUG_REMOVE_SKIPS_FINISHED, \* before 3ee9309 remove() cleaned up unfinished jobs only and clearFinished() never did
    BUG_CLEANUP_ON_ERROR,      \* run() calls cleanup() when a download fails
    BUG_REMOVE_RUNNING,        \* remove() without "|| this.runtime.has(id)"
    BUG_NO_SCHEDULE_ON_RESUME  \* resume() without "this.schedule()"

ASSUME MaxActive \in Nat /\ MaxActive >= 1   \* schedule() uses Math.max(1, maxActive)
ASSUME NoBatch \notin BatchIds

VARIABLES
    status,      \* job.status. "new" is a draft that commit() has not added yet, and
                 \* "removed" is a job that remove() or clearFinished() deleted from this.jobs.
                 \* "downloading" also stands for "merging" and "converting", the other
                 \* ACTIVE statuses, which postProcess() and runYtdlp() set while run() goes on.
    pausing,     \* job.pausing
    cancelling,  \* job.cancelling
    runtime,     \* this.runtime has the job: "none", "run" while run() goes on, or
                 \* "finally" once run() has returned and the .finally callback of start() is queued
    cookie,      \* this.cookies has the job, which also covers the Cookie header that
                 \* runSegmented() copies into the stream headers
    part,        \* the job's part file in the parts folder: "none" while nothing is written,
                 \* "partial", or "deleted" once cleanup() removed it
    batch,       \* job.batch of a one-at-a-time batch, or NoBatch
    stopping,    \* this.stopping
    phase,       \* shutdown(): "idle" before it, "waiting" at its await, "exited" after app.exit(0)
    awaited,     \* jobs whose rt.done shutdown() waits for and that have not settled yet
    quitRunning  \* the list "running" that shutdown() takes before it waits

vars == <<status, pausing, cancelling, runtime, cookie, part, batch,
          stopping, phase, awaited, quitRunning>>

Statuses  == {"new", "queued", "downloading", "paused", "done", "error", "cancelled", "removed"}
FINISHED  == {"done", "error", "cancelled"}     \* FINISHED in manager.js
BATCHABLE == {"queued", "paused", "error"}      \* BATCHABLE in manager.js

\* The jobs in this.jobs.
Listed == {j \in Jobs : status[j] \notin {"new", "removed"}}

Min(a, b) == IF a < b THEN a ELSE b

-----------------------------------------------------------------------------
\* schedule() and start()

\* Batches with a file in an ACTIVE status, the "busy" set in schedule().
Busy(st, bt) == {bt[j] : j \in {k \in Jobs : bt[k] # NoBatch /\ st[k] = "downloading"}}

Waiting(st) == {j \in Jobs : st[j] = "queued"}

\* How many files the loop in schedule() can start when nothing stops it early. Each
\* waiting file outside a batch counts once, and so does each batch that is not busy
\* and has a waiting file, because "busy.add(j.batch)" lets a batch start one file.
Units(st, bt) ==
    IF BUG_NO_BUSY_CHECK
    THEN Cardinality(Waiting(st))
    ELSE Cardinality({j \in Waiting(st) : bt[j] = NoBatch})
         + Cardinality({b \in BatchIds \ Busy(st, bt) : \E j \in Waiting(st) : bt[j] = b})

\* Free slots below max, as "if (this.activeCount() >= max) break" counts them.
Slots(st) ==
    LET n == Cardinality({j \in Jobs : st[j] = "downloading"})
    IN  IF n < MaxActive THEN MaxActive - n ELSE 0

\* A set of files that one schedule() call may start. At most one per batch, and none
\* from a busy batch.
Fits(S, st, bt) ==
    \/ BUG_NO_BUSY_CHECK
    \/ \A x \in S : bt[x] # NoBatch =>
           /\ bt[x] \notin Busy(st, bt)
           /\ \A y \in S \ {x} : bt[y] # bt[x]

\* The loop walks the line in queue order. move() lets the user put waiting files in
\* any order, so the model lets the loop pick any waiting file. A batch starts its
\* waiting file with the lowest batchIndex, and the model lets it start any of them.
Starts(st, bt) ==
    LET want == IF BUG_NO_ACTIVE_LIMIT THEN Units(st, bt) ELSE Min(Slots(st), Units(st, bt))
    IN  {S \in SUBSET Waiting(st) : Fits(S, st, bt) /\ Cardinality(S) = want}

\* schedule() on the state that the calling method left (st, rt, pa, ca, bt), with
\* start() for each file it picks. start() adds the runtime entry, sets the status to
\* "downloading", clears job.pausing and job.cancelling, and calls run(), which goes
\* on until its first await.
Schedule(st, rt, pa, ca, bt) ==
    /\ batch' = bt
    /\ IF stopping   \* "if (this.stopping) return;"
       THEN /\ status' = st
            /\ runtime' = rt
            /\ pausing' = pa
            /\ cancelling' = ca
       ELSE \E S \in Starts(st, bt) :
              /\ status'     = [j \in Jobs |-> IF j \in S THEN "downloading" ELSE st[j]]
              /\ runtime'    = [j \in Jobs |-> IF j \in S THEN "run" ELSE rt[j]]
              /\ pausing'    = [j \in Jobs |-> IF j \in S THEN FALSE ELSE pa[j]]
              /\ cancelling' = [j \in Jobs |-> IF j \in S THEN FALSE ELSE ca[j]]

-----------------------------------------------------------------------------
\* cleanup(j) for each job in S. It deletes the job's entry in this.cookies, the
\* stream headers that hold the cookie, and the part files in the parts folder.

CookiesAfter(S) == [j \in Jobs |-> IF j \in S /\ ~BUG_KEEP_COOKIE THEN FALSE ELSE cookie[j]]

PartsAfter(S) == [j \in Jobs |-> IF j \in S /\ part[j] = "partial" THEN "deleted" ELSE part[j]]

-----------------------------------------------------------------------------
\* When an action can run

\* A promise callback is queued. That is the .finally of a start(), or the rest of
\* shutdown() once every rt.done it waits for has settled.
CallbackQueued ==
    \/ \E j \in Jobs : runtime[j] = "finally"
    \/ phase = "waiting" /\ awaited = {}

\* IPC calls from the window, HTTP calls from the extension and main.js all come in
\* as new tasks, which Node takes only once no promise callback is queued.
UserCanAct == phase # "exited" /\ ~CallbackQueued

-----------------------------------------------------------------------------
\* Methods that IPC, the extension server or main.js call

\* commit(job), from the confirm window. prepare() moves the draft's cookie into
\* this.cookies. Then schedule().
Commit(j) ==
    /\ UserCanAct
    /\ status[j] = "new"
    /\ \E c \in BOOLEAN : cookie' = [cookie EXCEPT ![j] = c]
    /\ Schedule([status EXCEPT ![j] = "queued"], runtime, pausing, cancelling, batch)
    /\ UNCHANGED <<part, stopping, phase, awaited, quitRunning>>

\* commitBatch(jobs, custom, "one") adds drafts as one batch, then calls schedule().
\* A batch that runs "all" together schedules like files outside a batch, which
\* Commit covers.
CommitBatch(S) ==
    /\ UserCanAct
    /\ S # {}
    /\ \A j \in S : status[j] = "new"
    /\ \E b \in BatchIds \ {batch[k] : k \in Listed} :
         /\ \E c \in [S -> BOOLEAN] :
              cookie' = [j \in Jobs |-> IF j \in S THEN c[j] ELSE cookie[j]]
         /\ Schedule([j \in Jobs |-> IF j \in S THEN "queued" ELSE status[j]],
                     runtime, pausing, cancelling,
                     [j \in Jobs |-> IF j \in S THEN b ELSE batch[j]])
    /\ UNCHANGED <<part, stopping, phase, awaited, quitRunning>>

\* pause(id). A waiting file is paused at once. A running one gets job.pausing and
\* rt.ctrl.abort(), and run() ends later. pauseAll() and pauseBatch() call pause()
\* in a loop with nothing in between, which is a run of these steps.
Pause(j) ==
    /\ UserCanAct
    /\ \/ /\ status[j] = "queued"
          /\ status' = [status EXCEPT ![j] = "paused"]
          /\ UNCHANGED pausing
       \/ /\ status[j] = "downloading"
          /\ ~pausing[j]
          /\ pausing' = [pausing EXCEPT ![j] = TRUE]
          /\ UNCHANGED status
    /\ UNCHANGED <<cancelling, runtime, cookie, part, batch, stopping, phase, awaited, quitRunning>>

\* resume(id) puts a paused or failed file back in line, then calls schedule().
\* resumeAll(), resumeBatch() and retryBatch() call it in a loop.
Resume(j) ==
    /\ UserCanAct
    /\ status[j] \in {"paused", "error"}
    /\ IF BUG_NO_SCHEDULE_ON_RESUME
       THEN /\ status' = [status EXCEPT ![j] = "queued"]
            /\ UNCHANGED <<runtime, pausing, cancelling, batch>>
       ELSE Schedule([status EXCEPT ![j] = "queued"], runtime, pausing, cancelling, batch)
    /\ UNCHANGED <<cookie, part, stopping, phase, awaited, quitRunning>>

\* cancel(id). A file with a runtime entry gets job.cancelling and rt.ctrl.abort(),
\* and run() ends later. Any other unfinished file is cancelled and cleaned up at once.
\* cancelBatch() calls it in a loop.
Cancel(j) ==
    /\ UserCanAct
    /\ j \in Listed
    /\ status[j] \notin FINISHED
    /\ IF runtime[j] # "none"
       THEN /\ ~cancelling[j]
            /\ cancelling' = [cancelling EXCEPT ![j] = TRUE]
            /\ UNCHANGED <<status, cookie, part>>
       ELSE /\ status' = [status EXCEPT ![j] = "cancelled"]
            /\ cookie' = CookiesAfter({j})
            /\ part' = PartsAfter({j})
            /\ UNCHANGED cancelling
    /\ UNCHANGED <<pausing, runtime, batch, stopping, phase, awaited, quitRunning>>

\* remove(ids) for one id. A list of ids is the same loop body again with nothing in
\* between. A file with a runtime entry is skipped.
Remove(j) ==
    /\ UserCanAct
    /\ j \in Listed
    /\ BUG_REMOVE_RUNNING \/ runtime[j] = "none"
    /\ status' = [status EXCEPT ![j] = "removed"]
    /\ LET cleaned == IF BUG_REMOVE_SKIPS_FINISHED /\ status[j] \in FINISHED THEN {} ELSE {j}
       IN  /\ cookie' = CookiesAfter(cleaned)
           /\ part' = PartsAfter(cleaned)
    /\ UNCHANGED <<pausing, cancelling, runtime, batch, stopping, phase, awaited, quitRunning>>

\* clearFinished(scope) deletes the done files for scope "done", the failed and
\* cancelled ones for scope "failed", and both for any other scope.
Scopes == {{"done"}, {"error", "cancelled"}, FINISHED}

ClearFinished(scope) ==
    /\ UserCanAct
    /\ LET gone    == {j \in Listed : status[j] \in scope}
           cleaned == IF BUG_REMOVE_SKIPS_FINISHED THEN {} ELSE gone
       IN  /\ gone # {}
           /\ status' = [j \in Jobs |-> IF j \in gone THEN "removed" ELSE status[j]]
           /\ cookie' = CookiesAfter(cleaned)
           /\ part' = PartsAfter(cleaned)
    /\ UNCHANGED <<pausing, cancelling, runtime, batch, stopping, phase, awaited, quitRunning>>

\* startBatch(ids, "one"). S is what it picks: waiting, paused and failed files with
\* no runtime entry. They get a new batch id and status "queued", then schedule().
\* A new id is one that no other file in the list has. An id that only the picked
\* files had is as good as a new one, because all of them move.
StartBatch(S) ==
    /\ UserCanAct
    /\ S # {}
    /\ \A j \in S : j \in Listed /\ status[j] \in BATCHABLE /\ runtime[j] = "none"
    /\ \E b \in BatchIds \ {batch[k] : k \in Listed \ S} :
         Schedule([j \in Jobs |-> IF j \in S THEN "queued" ELSE status[j]],
                  runtime, pausing, cancelling,
                  [j \in Jobs |-> IF j \in S THEN b ELSE batch[j]])
    /\ UNCHANGED <<cookie, part, stopping, phase, awaited, quitRunning>>

\* dismissBatch(id) keeps the files of the batch in the list as ordinary downloads.
\* The window offers Dismiss only for a batch whose state is "finished" in
\* buildBatches() in app/src/renderer/app.js, so with no file queued, paused or
\* ACTIVE. The model calls it only then. dismissBatch() calls no schedule(), which
\* is safe only because of that.
DismissBatch(b) ==
    /\ UserCanAct
    /\ \E j \in Listed : batch[j] = b
    /\ \A j \in Listed : batch[j] = b => status[j] \notin {"queued", "paused", "downloading"}
    /\ batch' = [j \in Jobs |-> IF j \in Listed /\ batch[j] = b THEN NoBatch ELSE batch[j]]
    /\ UNCHANGED <<status, pausing, cancelling, runtime, cookie, part, stopping, phase, awaited, quitRunning>>

\* main.js calls schedule() once Downy is ready and whenever the settings change.
MainSchedules ==
    /\ UserCanAct
    /\ Schedule(status, runtime, pausing, cancelling, batch)
    /\ UNCHANGED <<cookie, part, stopping, phase, awaited, quitRunning>>

\* shutdown(), from before-quit in main.js, up to "await Promise.allSettled(...)".
\* It sets this.stopping, gives every running job job.pausing and rt.ctrl.abort(), and
\* waits for the rt.done of the jobs that have a runtime entry right now.
ShutdownBegin ==
    /\ UserCanAct
    /\ phase = "idle"
    /\ LET running == {j \in Jobs : runtime[j] # "none"}
       IN  /\ awaited' = running
           /\ quitRunning' = running
           /\ pausing' = [j \in Jobs |-> IF j \in running /\ j \in Listed THEN TRUE ELSE pausing[j]]
    /\ stopping' = IF BUG_NO_STOPPING_GUARD THEN stopping ELSE TRUE
    /\ phase' = "waiting"
    /\ UNCHANGED <<status, cancelling, runtime, cookie, part, batch>>

\* The rest of shutdown(), once every rt.done it waited for has settled. ACTIVE jobs
\* become paused, and with resume the jobs that were running go back in line. Then
\* before-quit goes on in a promise callback and calls app.exit(0).
ShutdownEnd ==
    /\ phase = "waiting"
    /\ awaited = {}
    /\ \E resume \in BOOLEAN :
         LET paused == [j \in Jobs |->
                          IF j \in Listed /\ status[j] = "downloading" THEN "paused" ELSE status[j]]
         IN  status' = [j \in Jobs |->
                          IF resume /\ j \in quitRunning /\ j \in Listed /\ paused[j] = "paused"
                          THEN "queued" ELSE paused[j]]
    /\ phase' = "exited"
    /\ UNCHANGED <<pausing, cancelling, runtime, cookie, part, batch, stopping, awaited, quitRunning>>

-----------------------------------------------------------------------------
\* What happens while run() awaits

\* downloadStream() or yt-dlp writes the job's part file. Both settle only once
\* they stopped writing. runWorkers() waits for every worker, then fh.close(), and
\* runYtdlp() waits for the process to close.
WritePart(j) ==
    /\ phase # "exited"
    /\ runtime[j] = "run"
    /\ part[j] # "partial"
    /\ part' = [part EXCEPT ![j] = "partial"]
    /\ UNCHANGED <<status, pausing, cancelling, runtime, cookie, batch, stopping, phase, awaited, quitRunning>>

\* run() after its last await, through its try, catch and finally blocks. ok means the
\* download and postProcess() went through, which can also happen after a pause or
\* cancel that came too late. When run() throws, job.cancelling wins over job.pausing,
\* and a failure with neither flag is an error. Only the success path and the
\* cancelled path call cleanup(). A job that remove() deleted stays out of this.jobs.
\* The model lets a run end at any time, even while a callback is queued, which
\* covers the runs that one abort stops together.
RunEnds(j) ==
    /\ phase # "exited"
    /\ runtime[j] = "run"
    /\ \E ok \in BOOLEAN :
         LET outcome == IF ok THEN "done"
                        ELSE IF cancelling[j] THEN "cancelled"
                        ELSE IF pausing[j] THEN "paused"
                        ELSE "error"
             cleaned == IF outcome \in {"done", "cancelled"} \/ (outcome = "error" /\ BUG_CLEANUP_ON_ERROR)
                        THEN {j} ELSE {}
         IN  /\ status' = [status EXCEPT ![j] = IF @ = "removed" THEN "removed" ELSE outcome]
             /\ cookie' = CookiesAfter(cleaned)
             /\ part' = PartsAfter(cleaned)
    /\ runtime' = [runtime EXCEPT ![j] = "finally"]
    /\ pausing' = [pausing EXCEPT ![j] = FALSE]
    /\ cancelling' = [cancelling EXCEPT ![j] = FALSE]
    /\ UNCHANGED <<batch, stopping, phase, awaited, quitRunning>>

\* The .finally callback in start() deletes the runtime entry and calls schedule().
\* Its promise is rt.done, which settles once the callback returns.
RunFinally(j) ==
    /\ phase # "exited"
    /\ runtime[j] = "finally"
    /\ awaited' = awaited \ {j}
    /\ Schedule(status, [runtime EXCEPT ![j] = "none"], pausing, cancelling, batch)
    /\ UNCHANGED <<cookie, part, stopping, phase, quitRunning>>

\* Downy has quit and nothing happens any more.
Exited ==
    /\ phase = "exited"
    /\ UNCHANGED vars

-----------------------------------------------------------------------------

Init ==
    /\ status = [j \in Jobs |-> "new"]
    /\ pausing = [j \in Jobs |-> FALSE]
    /\ cancelling = [j \in Jobs |-> FALSE]
    /\ runtime = [j \in Jobs |-> "none"]
    /\ cookie = [j \in Jobs |-> FALSE]
    /\ part = [j \in Jobs |-> "none"]
    /\ batch = [j \in Jobs |-> NoBatch]
    /\ stopping = FALSE
    /\ phase = "idle"
    /\ awaited = {}
    /\ quitRunning = {}

Next ==
    \/ \E j \in Jobs :
         \/ Commit(j) \/ Pause(j) \/ Resume(j) \/ Cancel(j) \/ Remove(j)
         \/ WritePart(j) \/ RunEnds(j) \/ RunFinally(j)
    \/ \E S \in SUBSET Jobs : CommitBatch(S) \/ StartBatch(S)
    \/ \E scope \in Scopes : ClearFinished(scope)
    \/ \E b \in BatchIds : DismissBatch(b)
    \/ MainSchedules
    \/ ShutdownBegin
    \/ ShutdownEnd
    \/ Exited

Spec == Init /\ [][Next]_vars

\* Jobs are interchangeable, and so are batch ids.
Symmetry == Permutations(Jobs) \cup Permutations(BatchIds)

-----------------------------------------------------------------------------
\* Properties

TypeOK ==
    /\ status \in [Jobs -> Statuses]
    /\ pausing \in [Jobs -> BOOLEAN]
    /\ cancelling \in [Jobs -> BOOLEAN]
    /\ runtime \in [Jobs -> {"none", "run", "finally"}]
    /\ cookie \in [Jobs -> BOOLEAN]
    /\ part \in [Jobs -> {"none", "partial", "deleted"}]
    /\ batch \in [Jobs -> BatchIds \cup {NoBatch}]
    /\ stopping \in BOOLEAN
    /\ phase \in {"idle", "waiting", "exited"}
    /\ awaited \subseteq Jobs
    /\ quitRunning \subseteq Jobs

\* 1. Once shutdown() has begun, no job enters downloading.
\* If this breaks, a waiting download starts while Downy quits and is cut off, and
\* it comes back paused where it was queued.
\* start() is the only way into downloading and it adds a runtime entry. So the check
\* is that every job with a runtime entry is one that shutdown() is waiting for.
NoStartAfterStop ==
    phase # "idle" => \A j \in Jobs : runtime[j] # "none" => j \in awaited

\* 2. No more files are ACTIVE at once than "Downloads at the same time" allows.
\* If this breaks, Downy runs more downloads at once than the user set, and each one
\* gets slower. The model keeps maxActive fixed. Lowering it in Settings leaves the
\* running downloads alone, which is meant and is not covered.
ActiveWithinLimit ==
    Cardinality({j \in Jobs : status[j] = "downloading"}) <= MaxActive

\* 3. A one-at-a-time batch never has two files ACTIVE at once.
\* If this breaks, a batch the user asked to run one by one downloads files side by side.
OneAtATime ==
    \A b \in BatchIds :
        Cardinality({j \in Jobs : batch[j] = b /\ status[j] = "downloading"}) <= 1

\* 4. A job that is done, cancelled, removed or cleared holds no browser cookie.
\* If this breaks, Downy keeps the cookie of the user's browser session after the
\* download that needed it has ended.
NoCookieAfterEnd ==
    \A j \in Jobs : status[j] \in {"done", "cancelled", "removed"} => ~cookie[j]

\* 5. A job that is done, cancelled, removed or cleared leaves no part file behind.
\* If this breaks, part files that no download will use pile up in Downy's data
\* folder, and for videos they can be gigabytes.
NoPartLeftBehind ==
    \A j \in Jobs : status[j] \in {"done", "cancelled", "removed"} => part[j] # "partial"

\* 5b. A job that can still go on keeps its part file, so a retry resumes where the
\* download stopped. That covers a failed job until it is removed or cleared.
\* If this breaks, retrying a failed or paused download starts it again from zero.
FailedKeepsPart ==
    \A j \in Jobs : status[j] \in {"queued", "downloading", "paused", "error"} => part[j] # "deleted"

\* 6. A job with a runtime entry stays in the list until its run has ended.
\* If this breaks, a removed download keeps running with no row to pause or cancel
\* it, and still writes its part file or saves the file afterwards.
RunningStaysListed ==
    \A j \in Jobs : runtime[j] # "none" => status[j] # "removed"

\* 7. While Downy waits for the next event and is not quitting, no waiting file could
\* take a free slot. Every method that lets a file start calls schedule().
\* If this breaks, a download sits in the queue with a slot free until some other
\* download ends or the settings change.
NoIdleSlot ==
    UserCanAct /\ ~stopping => Min(Slots(status), Units(status, batch)) = 0

=============================================================================
