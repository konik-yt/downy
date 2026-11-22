---
name: verify-job-lifecycle
description: Model-check the Downy download queue (class Manager in app/src/main/manager.js) with TLA+ and TLC. Use for any change to Manager status handling, schedule(), start(), run(), shutdown(), cleanup(), the cookies map, pause, resume, cancel, remove or clearFinished, or batches (startBatch, commitBatch, dismissBatch), and for changes to the schedule() and shutdown() calls in app/src/main/main.js.
---

# Verify the download job lifecycle

`formal/JobLifecycle.tla` is a TLA+ model of the download queue that `Manager` runs in `app/src/main/manager.js`. TLC checks every order in which user calls, finished downloads and quitting can interleave for 3 downloads, and it checks the properties below in each reachable state. Tests check the orders someone wrote down. This check covers the races between an await in `start()`, `run()` or `shutdown()` and a user call, which tests rarely reach.

## Does the change touch the model?

Compare the change with the coverage record below. It touches the model when it changes any method in the table, adds a place that writes `job.status`, `job.pausing`, `job.cancelling`, `job.batch`, `this.runtime`, `this.cookies` or `this.stopping`, adds or moves an `await` inside one of those methods, or adds a caller of `schedule()`, `start()` or `shutdown()`.

To see what changed in the covered code since the model was last confirmed:

```bash
git diff 8232822 -- app/src/main/manager.js app/src/main/main.js app/src/main/segmented.js
git diff 8232822 -- app/src/renderer/app.js | grep -n -i -E "dismiss|b\.state"
```

Changes to formats, file names, progress, `tick()`, folders or yt-dlp arguments do not touch the model.

## Run the check

```bash
bash formal/check.sh
```

It needs Java 11 or later (CI uses Temurin 21) and curl. The first run downloads `tla2tools.jar` 1.7.4 to `~/.cache/downy-tla` and checks its SHA-256. A run takes about 20 seconds. The `model` job in `.github/workflows/check.yml` runs the same script.

Each config prints one line. All of them must say `pass`.

- `faithful-max1.cfg` and `faithful-max2.cfg` are the model as the code is, with "Downloads at the same time" at 1 and at 2. They pass when TLC finds no error.
- Each `bug-*.cfg` turns on one `BUG_*` switch, which puts a past or likely mistake back into the model. It passes only when TLC reports the invariant on its `INVARIANT` line as violated. This shows that the check can still fail.

To read a counterexample, run one config. The script then prints everything TLC says:

```bash
bash formal/check.sh faithful-max1.cfg
```

## Properties

Each property is an invariant at the end of `formal/JobLifecycle.tla`, with the same sentence in a comment above it.

| Invariant | Promise | Harm if it breaks | Fails in |
| --- | --- | --- | --- |
| `NoStartAfterStop` | Once `shutdown()` has begun, no job enters downloading. | A waiting download starts while Downy quits, is cut off, and comes back paused instead of queued. | `bug-no-stopping-guard.cfg`, the bug that c6868a3 fixed |
| `ActiveWithinLimit` | No more files are ACTIVE at once than maxActive. | Downy runs more downloads at once than the user set. | `bug-no-active-limit.cfg` |
| `OneAtATime` | A one-at-a-time batch never has two files ACTIVE at once. | A batch the user asked to run one by one downloads files side by side. | `bug-no-busy-check.cfg` |
| `NoCookieAfterEnd` | A job that is done, cancelled, removed or cleared holds no browser cookie. | Downy keeps the cookie of the browser session after the download ended. | `bug-keep-cookie.cfg`, the bug that 29d0a6d and 9f23943 fixed |
| `NoPartLeftBehind` | A job that is done, cancelled, removed or cleared leaves no part file. | Unused part files pile up in Downy's data folder. | `bug-remove-skips-finished.cfg`, the bug that 3ee9309 fixed |
| `FailedKeepsPart` | A queued, running, paused or failed job keeps its part file. | A retry starts the download again from zero. | `bug-cleanup-on-error.cfg` |
| `RunningStaysListed` | A job with a runtime entry stays in the list until its run ended. | A removed download keeps running with no row to stop it. | `bug-remove-running.cfg` |
| `NoIdleSlot` | While Downy waits for the next event and is not quitting, no waiting file could take a free slot. | A download waits in the queue with a slot free. | `bug-no-schedule-on-resume.cfg` |

## Coverage record

The sync commit is `8232822`. At that commit the model matches the code in the table. Each action in the spec is one synchronous stretch of code, from where a method starts or an await returns to the next await or the end.

| Model | Code |
| --- | --- |
| `Schedule` operator, `Starts`, `Units`, `Slots`, `Fits`, `Busy` | `schedule()`, `activeCount()`, and the synchronous part of `start()` in manager.js |
| `CookiesAfter`, `PartsAfter` | `cleanup()` in manager.js |
| `Commit` | `commit()` and `prepare()` |
| `CommitBatch` | `commitBatch()` with mode "one" |
| `Pause` | `pause()`, also `pauseAll()` and `pauseBatch()`, which loop over it |
| `Resume` | `resume()`, also `resumeAll()`, `resumeBatch()` and `retryBatch()` |
| `Cancel` | `cancel()`, also `cancelBatch()` |
| `Remove` | `remove()`, one id per step |
| `ClearFinished` | `clearFinished()` with its three scopes |
| `StartBatch` | `startBatch()` with mode "one" |
| `DismissBatch` | `dismissBatch()`, called only for a batch whose `b.state` is "finished" in `buildBatches()` in app/src/renderer/app.js |
| `MainSchedules` | the `manager.schedule()` calls in app/src/main/main.js |
| `ShutdownBegin` | `shutdown()` up to `await Promise.allSettled(...)`, called from before-quit in main.js |
| `ShutdownEnd` | `shutdown()` after that await, then `app.exit(0)` in before-quit |
| `WritePart` | `downloadStream()` in app/src/main/segmented.js and `runYtdlp()` writing part files |
| `RunEnds` | `run()` after its last await, through its try, catch and finally blocks |
| `RunFinally` | the `.finally` callback that `start()` hangs on `run()` |
| `UserCanAct` | Node runs every queued promise callback before the next IPC call, HTTP request or timer |

## What the model leaves out

A pass covers the model at its bounds, not all of Downy.

- Bounds are 3 downloads, 3 batch ids, and maxActive 1 or 2 as a fixed setting. With 4 downloads and 4 batch ids at maxActive 2, TLC also found no error at the sync commit, in 10,203,270 distinct states. That run took 9 minutes on 24 cores, so the script does not run it. To repeat it, copy `formal/faithful-max2.cfg` to `formal/faithful-big.cfg`, add `j4` to `Jobs` and `b4` to `BatchIds`, run `bash formal/check.sh faithful-big.cfg`, and delete the copy afterwards.
- Queue order is not modeled. `move()` lets the user put waiting files in any order, so `schedule()` in the model may start any waiting file, and a batch may start any of its waiting files instead of the lowest `batchIndex`.
- "merging" and "converting" count as "downloading". `pause()` does nothing during them in the code, and the model lets it set `pausing`, which only adds behaviors.
- Batches that run "all" together schedule like files outside a batch, so the model has no separate mode for them.
- Each job has one part file of its own. yt-dlp names temp files after the output name, so two jobs with the same name share them, and the model does not cover that.
- `run()` can throw before its first await when ffmpeg is missing. The model treats that as a run that ends later.
- `load()`, `sweepParts()`, restarts, `save()` and what downloads.json holds are not modeled.
- A lower maxActive in Settings leaves running downloads alone, which the model does not cover.

## Is it a real bug or a modeling error?

When a faithful config fails, read the trace from `bash formal/check.sh <config>`. Each `State N: <Action line ...>` names the action that led to that state. Translate every step into a call with the coverage record, then ask whether the code can take those steps in that order.

- Check each step against the code it stands for. The guard of the action must match the `if` checks in the method, and the state after the step must match what the method writes.
- Check the order against the event loop. A user call cannot land while a `.finally` callback of `start()` is queued, or between the last such callback and the rest of `shutdown()`. `UserCanAct` encodes this. A run can end at any time.
- If every step is possible in the code, the code breaks the property. Report it with the steps in the code's words, such as "commit() starts A, then shutdown() aborts A, then A's .finally calls schedule(), which starts B". Do not weaken the invariant or the model until it passes, and do not change product code unless the user asks.
- If a step is impossible in the code, the model is wrong. Fix the action to match the code and run the check again.

When a `bug-*.cfg` stops failing, the model no longer reaches the mistake it replays. That usually means an action changed so that the switch has no effect any more. Make the switch put the mistake back again.

## Update the model for an intended change

1. Find the changed method in the coverage record and edit its action in `formal/JobLifecycle.tla` so it does what the new code does. One synchronous stretch of code is one action. A new await splits an action in two.
2. A new method that writes statuses, flags, the runtime map, cookies, part files or batches gets a new action, a row in the coverage record, and a place in `Next`.
3. Run `bash formal/check.sh`. If a faithful config fails, use the section above to tell a real bug from a modeling error.
4. If the change means a promise itself changes, change the invariant and its sentence only when the user agrees, and update the properties table here.
5. Every invariant needs a `bug-*.cfg` that fails on it. For a new property, add a `BUG_*` constant to the spec, set it to FALSE in every config, and add a config that sets it to TRUE and names the new invariant on its `INVARIANT` line.
6. Once the check passes and you have confirmed that every row of the coverage record still describes the code, set the sync commit above to the commit you checked. Move it forward only after that confirmation.
