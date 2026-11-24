# Chrome handover and the confirm window

When Chrome starts a download of 1 MB or more, the Downy extension sends it to Downy's local API instead. With "Ask before each download" on (the default), a small window opens near the top of the screen with the file name and folder. Download (or Enter) starts it, Cancel (or Esc) drops it. With the setting off, the download starts at once. Calls without the token from Downy's own copy of the extension are refused. A video adds Trim to the window (see `trim-video.md`) and a ZIP adds Choose files (see `zip-pick.md`).

## Sub-features

- `handover-confirm` opens the confirm window for `POST /api/file` and starts the download on Download.
- `handover-cancel` closes the confirm window on Cancel and starts nothing.
- `handover-rename` saves the file under the name typed into the window.
- `handover-direct` starts the download at once when "Ask before each download" is off.
- `handover-token` refuses an API call without the right token with 401.

## How to get to it (user POV)

- Download a file of 1 MB or more in Chrome with the extension loaded.
- The extension popup lists recent downloads (`GET /api/downloads`).
- Settings, Chrome, "Ask before each download" turns the confirm window on and off.

## Driving it with downy-verify

Preconditions:

- Baseline from `README.md`. `confirm` is true.
- The helper's `api` command plays the extension: it sends the run's token from `data/api-token` and a `chrome-extension://` Origin, as `extension/background.js` does. The extension is a separate program, so the API is its real path into Downy.

- **Hand over (`handover-confirm`).** Run `$V api POST api/file "{\"url\":\"$B/file/small.bin\",\"filename\":\"small.bin\",\"referrer\":\"$B/\"}"`. It answers `200 {"prompt":"<request id>"}`.
- **The window opens.** Run `$V wait 'document.querySelector("#title")?.textContent' --target prompt`. It prints `small.bin`. Run `$V shot confirm --target prompt`. The window shows a BIN tile, "127.0.0.1, 3.0 MB", Rename, "Saves to Downloads", Download and Start a batch.
- **Rename (`handover-rename`).** Run `$V click '#rename' --target prompt` (the link then reads Keep the name), then `$V wait '!document.querySelector("#nameRow").hidden' --target prompt`, then `$V type '#name' 'renamed' --replace --target prompt`. Downy keeps the extension, so the file becomes `renamed.bin`.
- **Download.** Run `$V click '#go' --target prompt`. The confirm window closes. Run `$V api POST api/prompt '{"id":"<request id>"}'`; it answers `{"state":"started","downloadId":"<id>"}`. Wait in the main window for that id to be done, then `$V files --save handover`. It lists `Downloads\renamed.bin` matching `/file/small.bin`.
- **Cancel (`handover-cancel`).** Hand over `$B/file/norange.bin`, wait for `#title` in the prompt target, then `$V click '#close' --target prompt` (the x at the top right, `aria-label="Cancel"`). `$V api POST api/prompt '{"id":"<new id>"}'` answers `{"state":"cancelled","downloadId":null}`, and `$V state` has no new row.
- **No confirm (`handover-direct`).** Open Settings (`$V click '#openSettings'`), the Chrome page (`$V click '#setNav [data-page=chrome]'`), and click the "Ask before each download" switch (`$V click 'input.switch[name=confirm]'`), then close (`$V click 'button[aria-label="Close settings"]'`). Hand over again. The answer is the download row itself, with an `id` and `status`, and no prompt target appears.
- **Wrong token (`handover-token`).** Run `curl -s -o /dev/null -w '%{http_code}' -H 'Origin: chrome-extension://x' -H 'X-Downy-Token: wrong' "http://127.0.0.1:$(node -e "console.log(require(process.argv[1]).apiPort)" "$(cat .verify/current)/run.json")/api/status"`. It prints 401.

## Gotchas

- The confirm window is its own DevTools target. Every command for it needs `--target prompt`; without it the helper acts on the main window.
- With `showOnStart` on (the default), a started download brings the main window to the front and focuses its row.
- Each `api` call with the right token marks the extension as seen, which turns Downy's Chrome extension status green. Don't use `api` while proving the extension setup status.
- A later file joins an open window that holds only files from the same site, and a window that collects a batch takes anything. Answer or cancel one before handing over the next, or expect a group (`#group`) instead of one file. A video always gets its own window unless a batch collects.
- `#trim` and `#choose` stay hidden for a plain file such as `small.bin`. Check that with `$V eval '[document.querySelector("#trim").hidden, document.querySelector("#choose").hidden]' --target prompt`.
- The name field `#name` stays hidden until Rename is clicked, and the helper refuses to type into a hidden field.
- `#cancel` and `#go` sit at the bottom of the window. With one file, the bottom row is Download and Start a batch, and cancelling is the x (`#close`) or Esc. `#cancel` belongs to the group view.
- The settings switches are `input.switch` named `organize`, `confirm`, `showOnStart`, `closeToTray`, `openAtLogin` and `notify`. Check with `$V eval '[...document.querySelectorAll("#settings input.switch")].map(i => i.name)'` if a click misses.
