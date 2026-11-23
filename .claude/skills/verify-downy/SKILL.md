---
name: verify-downy
description: Launch and drive the real Downy desktop app (Electron, run from source in app/) to prove a change works the way a user sees it. Starts an isolated copy beside any installed Downy, drives the window over DevTools with real clicks and keys, serves test files from a local server, and keeps screenshots, file hashes and request logs as evidence. Use after changing anything in app/src/main or app/src/renderer that a user can see or that changes what lands on disk, such as the composer, the download list, pause and resume, the Finished tab, settings, or the confirm window that Chrome downloads open.
---

# Verify Downy in the real app

Downy is a Windows download manager. The surface a user touches is the Electron window (`app/src/renderer/index.html`), plus the small confirm window (`prompt.html`) that opens when the Chrome extension hands over a download through the local API. This skill runs Downy from source with its own data folder, API port and download folder, so it never touches the user's installed Downy, which normally runs at the same time on port 9614 with data in `%APPDATA%\Downy`.

Everything goes through one helper, `scripts/downy-verify.mjs`. It needs Node 22.2 or later (for the built-in WebSocket, and `zlib.crc32` to build the ZIP fixture) and `npm install` done in `app/`. Run it from the repo root. In Git Bash:

```bash
V="node .claude/skills/verify-downy/scripts/downy-verify.mjs"
$V            # prints every command
```

For a fixed feature, open `features/README.md` and follow that feature's file. The map is the list of journeys to cover. A proof that drives one entry point is incomplete when the map lists others for the feature you changed.

## Launch

```bash
$V launch            # seeded: welcome screen skipped, downloads go into this run
$V launch --fresh    # empty data folder, for driving the welcome screen
```

It does this:

1. Creates `.verify/run-<UTC time>/` in the repo with `data/`, `downloads/` and `evidence/`, and writes that path to `.verify/current`. Every later command acts on the run named there. `.verify/` is in `.gitignore`.
2. Unless `--fresh`, writes `data/settings.json` with `downloadDir` set to the run's `downloads/`, `onboarded` and `extensionSetup` true (no welcome or extension dialogs), `notify` false (no Windows toasts on the user's desktop) and `closeToTray` false (closing the window quits, which cleanup uses). Everything else keeps the defaults in `app/src/main/settings.js`, including `connections` 8, `maxActive` 3 and `confirm` true.
3. Starts the test file server as a detached Node process on a free port. It writes `evidence/served.json` with the URL, size and sha256 of each file:
   - `file/small.bin`: 3 MB, answers Range requests, full speed.
   - `file/slow.bin`: 48 MB, answers Range requests, 128 KB/s per connection (about 1 MB/s at 8 connections). Use it whenever a download must still be running when you act on it.
   - `file/norange.bin`: 2 MB, ignores Range, like a simple server.
   - `file/slow-norange.bin`: 8 MB, ignores Range, 256 KB/s. Use it to pause a download that can't resume.
   - `login`: answers with HTML and has no `.html` name, like a sign-in page. Downy must refuse it.
   - `page.html`: answers with HTML under an `.html` name. Downy downloads it, since the user linked to a page file.
   - `file/Sample.zip`: a ZIP with Range support, for Choose files. It holds `Sample/readme.txt`, `Sample/data.json`, `Sample/docs/guide.md`, `Sample/docs/notes.txt` and `Sample/big.bin` (4 MB, stored). `served.json` lists each entry as `/file/Sample.zip!/Sample/<path>` with its sha256, so `files` names the entry an extracted file matches.
4. Starts `app/node_modules/electron/dist/electron.exe .` in `app/` with `DOWNY_USER_DATA=<run>/data`, `DOWNY_PORT=<free port>` and `--remote-debugging-port=<free port>`. Output goes to `evidence/app.log`.
5. Waits up to 60 s for ready, and prints `READY run=<dir>`. Ready means usable: the main window ran `init()` (the three tabs exist and `downy.state()` answers ok) and the local API answers `GET /` with "Downy is running". A DevTools port that answers is not enough.

`DOWNY_USER_DATA` matters for two reasons. Electron's single instance lock is per data folder, so without it a second Downy quits at once when the installed one runs. And from source the app name is also "Downy", so without it the run would read and write the user's real `%APPDATA%\Downy`.

To get the file server's base URL:

```bash
B=$(node -e "console.log(require(require('fs').readFileSync('.verify/current','utf8').trim()+'/evidence/served.json').base)")
```

Teardown is `$V cleanup`, below.

## Doctor

Run it first whenever anything looks off. It is read only.

```bash
$V doctor
```

It checks that the Downy and file server PIDs from `run.json` are alive, the API port is not 9614, the DevTools page is `app/src/renderer/index.html` of this checkout, `downy.state()` answers, the download folder is this run's `downloads/` (proves Downy uses our data folder), the version under Settings, About matches `app/package.json`, the API answers on our port, and the file server answers. It also prints how many downloads are listed and whether yt-dlp, ffmpeg and a JS runtime were found. It ends with `DOCTOR OK` (exit 0) or `DOCTOR FAIL (n)` (exit 1). On a failure, run cleanup and launch again rather than driving a half working instance.

## Drive

All page commands talk to the main window over DevTools. Add `--target prompt` to talk to the confirm window instead. Clicks are real mouse events at the element's centre and keys are real key events, so they go through the same handlers a user triggers. The helper refuses to click an element that is missing, hidden or disabled.

```bash
$V type '#url' "$B/file/small.bin"     # clicks the field, then inserts the text at the cursor
$V type '#url' "$B/login" --replace    # clicks, presses Ctrl+A, then types over the old text
$V key Enter                           # Enter, Escape, Tab, the arrows, Home, End, PageUp, PageDown
$V key Shift+ArrowRight --target prompt  # modifiers go in front, joined with +
$V drag '.trim-handle.start' 44 --target prompt   # presses at the centre, moves 44 px right in steps, lets go
$V drag '.trim-handle.end' -404 --shot mid-drag --target prompt   # --shot captures while the button is down
$V click '[data-id="<id>"] button[aria-label="Pause"]'
$V click '#viewActs button' --text 'Clear from list'   # buttons with no id or label
$V wait 'downy.state().then(r => r.data.downloads.some(d => d.status === "done"))' --timeout 30000
$V eval 'document.querySelector("#main").dataset.view'
$V api POST api/file '{"url":"'$B'/file/small.bin","filename":"small.bin"}'   # what the Chrome extension sends
```

`wait` polls a JavaScript expression in the page until it is truthy (default 30 s) and prints its value. Use it after every action instead of sleeping. `eval` and `wait` are for reading state only. Do not call `downy.pause(...)` or other `window.downy` methods to cause a change: that skips the button a user clicks. Cleanup is the one exception, and it only closes the window.

Write API paths as `api/file`, without the leading slash. Git Bash rewrites an argument like `/api/file` into `C:/Program Files/Git/api/file`; the helper undoes that, but the short form avoids it. `serverlog` takes a file name such as `slow.bin` for the same reason.

Stable handles in the main window (`app/src/renderer/index.html` and `app.js`):

| What | Selector |
| --- | --- |
| Link field, send button | `#url`, `#sendBtn` (`aria-label="Download"`), the hint under it is `#composerHint` |
| Tabs | `#tabs .tab[data-tab=downloads]`, `[data-tab=done]`, `[data-tab=failed]`; the count is `.n` inside, and its `data-v` holds the settled number (the text holds two digits while the count rolls); the open tab has `aria-current="page"` |
| Current view | `#main[data-view]`: `idle`, `busy`, `done` or `failed` |
| A download row | `[data-id="<download id>"]`, with `data-status` set to queued, downloading, merging, converting, paused, done, error or cancelled |
| Row buttons | `button[aria-label=...]` inside the row: `Pause`, `Resume`, `Cancel download`, `Move to top`, `Open file`, `Show in folder`, `Remove from list`. Retry on a failed row is a text button: `click '[data-id="<id>"] button' --text Retry` |
| Finished and Failed header | `#viewTitle`, `#viewMeta`, buttons in `#viewActs` by text (`Open folder`, `Clear from list`, and `Retry` with one failed file or `Retry all` with more), folder chips in `#folderChips` |
| Totals while running | `#status` with `#statusBig`, `#statusSub`, button `#statusAct` |
| Title bar | `#openSettings` (`aria-label="Settings"`), `#openFolder`, `[data-win=minimize]`, `[data-win=maximize]`, `[data-win=close]` |
| Settings dialog | `#settings` (open when `#settings.open`), pages `#setNav [data-page=saving|speed|chrome|app|about]`, steppers `[data-step=connections|maxActive][data-delta="1"|"-1"]` with the value in `output[name=connections]` and `output[name=maxActive]`, switches `input[name=organize]` and the other `input.switch[name=...]`, close `button[aria-label="Close settings"]` |
| Welcome dialog (`--fresh`) | `#welcome`, `#welcomeNext`, `#toolsSkip`, `#toolsInstall`, `#extSkip`, `#extDone` |
| Video picker in the main window | `#picker`, opened by Enter on a YouTube link. `.pick-trim` (Trim, then Cancel trim), tiles `.pick[data-id=v720]`, `[data-id=m4a]`, `[data-id=mp3]`, the trimmer below. The same `#picker` shows the ZIP list for a `.zip` link |
| Trimmer (both windows) | `.trim-handle.start`, `.trim-handle.end` (`role=slider`, keys move them), `.trim-sel` (drag to move the whole part), `.trim-times b` ("Drag an end to trim", then "1:00 to 1:20, 20 seconds"), `.trim-bubble` (frame and time while dragging) |
| ZIP file list (both windows) | rows `.ft-row` with check box `.ft-box` (`aria-checked`), folders `.ft-row.dir` with `--depth: 0` for the top one, a file's `.ft-name[title]` holds its path in the archive, the summary `.ft-sum` with Pick none or Pick all |
| Confirm window (`--target prompt`) | `#title` (file name), `#rename` (then reads Keep the name) and `#name`, `#dir`, `#change`, `#go` (Download, with the label in `#goText`), `#startBatch`, `#close` (the x, cancels one file), `#error`, `#trim` (videos) with the format tiles in `#tiles .pick[data-id=...]`, `#choose` (Choose files, then Keep all files, for ZIPs) with the list in `#zipBox`, `#screen` (the big frame while a trim handle moves). `#cancel` and the x `#gClose` belong to the group of several files and read Cancel all, or Cancel batch while a batch collects |

Get a download's id from the window, not from the API:

```bash
ID=$($V eval 'downy.state().then(r => r.data.downloads.find(d => d.title === "slow.bin").id)' | tr -d '"')
```

Do not click `Open folder`, `Show in folder`, `Open file` or Settings, Saving, `Change`: they open Explorer, the file's app or a native folder picker on the user's desktop, which the helper can't drive or close. To prove those, check the IPC result or say they were not covered.

## Evidence

Everything goes into `.verify/run-<time>/evidence/`, which cleanup keeps:

| File | Made by | Shows |
| --- | --- | --- |
| `NN-<name>.png` | `$V shot <name>` | the window at that moment, numbered in order |
| `actions.log` | every click, type, key, wait, api call, launch and cleanup | what was done and when, so the screenshots read as before and after |
| `served.json` | launch | the sha256 each served file must end up with |
| `server-log.jsonl` | the file server | every request: method, path, Range, status, bytes. `$V serverlog slow.bin` prints one line each |
| `files-<name>.json` | `$V files --save <name>` | each file under `downloads/` with size, sha256 and which served file it matches (`matches: null` means corrupt or unknown) |
| `state-<name>.json` | `$V state --save <name>` | the download list as the window sees it: id, title, status, bytes, folder, filepath, error, segment count |
| `app.log` | Downy's stdout and stderr | errors from the main process |

Proof standards:

- Drive the real user path: type into `#url` and press Enter, click the row's button. Do not call `window.downy` methods or post to the API to cause what you claim the window does. The API is the real path only for the Chrome extension features, since the extension is a separate program that talks to it.
- Capture the action and the result: a `shot` before and after, with `actions.log` between them. A final screenshot alone does not show that your action caused it.
- Check side effects next to what is visible. A finished download needs `files` to show the right sha256 at the right path (for example `Downloads\small.bin`). Resume needs `serverlog` to show Range requests that start past 0. Settings need `data/settings.json` to hold the new value. Read those files before cleanup, since cleanup deletes `data/` and `downloads/`; copy what matters into `evidence/` with `files --save` and `state --save`.
- The file server stands in for the internet. That is the only mock, and it sits at a real boundary: Downy speaks plain HTTP to it as it would to any host. YouTube and other yt-dlp sites need the real network and are not covered by this server.

## Cleanup

```bash
$V cleanup
```

It closes the main window through DevTools (with `closeToTray` off, which it sets first, Downy quits through `before-quit` and saves running downloads as paused), waits up to 10 s, then runs `taskkill /PID <pid> /T /F` on the Electron PID this run started if it is still there. It stops the file server by its PID, deletes `data/` and `downloads/`, checks that the API port no longer answers, and removes `.verify/current`. It never kills by image name: the user's own `Downy.exe`, and any other `electron.exe`, keep running. It prints `evidence kept in <dir>` and exits 1 if Downy is still alive or the port still answers.

Run cleanup after every run, failed ones too, so no Electron or file server stays behind. If `.verify/current` is gone but processes remain, set `DOWNY_VERIFY_RUN=<run dir>` and run cleanup again; the PIDs are in that run's `run.json`.

## Gotchas

- Launch creates a new run each time, so a restart with the same data folder is not built in. To prove that something survives a quit, read `data/downloads.json` after `cleanup` has closed the window and before it deletes `data/`, or quit with `$V click '[data-win=close]'` and read the file then.
- After a launch, Downy runs `winget upgrade yt-dlp.yt-dlp` once a day when yt-dlp came from winget, and checks GitHub for updates only in an installed build. From source the updater is off.
- A link that answers with HTML is refused with "This link opens a web page, not a file" in `#composerHint`, unless its name ends in `.html` or `.htm` (`draftFile` in `app/src/main/manager.js`). Use `login` to prove the refusal; `page.html` downloads.
- Screenshots come from the page, so the native title bar area and other windows are not in them. The window is frameless, so the title bar in the screenshot is Downy's own.
