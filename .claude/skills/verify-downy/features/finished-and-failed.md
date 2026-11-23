# Finished and Failed lists

The tabs at the top split the list into Downloads (running and waiting), Finished and Failed, each with a count. Finished groups files by day, shows where each was saved, and has Open folder and Clear from list. Failed holds downloads that failed or were cancelled, with Retry on failed ones and Clear from list. Removing a row from the list keeps the downloaded file.

## Sub-features

- `list-tabs` switches between Downloads, Finished and Failed, with the right counts.
- `list-remove` removes one finished row and keeps the file on disk.
- `list-clear` clears every row in the open tab with Clear from list.
- `list-failed` shows a cancelled or failed download in Failed.
- `list-retry` retries a failed download from its row or with Retry all.

## How to get to it (user POV)

- Click Downloads, Finished or Failed at the top of the window.
- Hover a row and click its trash icon (Remove from list).
- Click Clear from list at the top right of the Finished or Failed list.
- Click Retry on a failed row.

## Driving it with downy-verify

Preconditions:

- Baseline from `README.md`.
- Two finished files: paste `$B/file/small.bin` and `$B/file/norange.bin` as in `paste-file-link.md` and wait until both are done.

- **Tabs (`list-tabs`).** Run `$V click '#tabs .tab[data-tab=done]'`, then `$V wait 'document.querySelector("#main").dataset.view === "done" && document.querySelector("#tabs .tab[data-tab=done] .n").textContent'`. It prints 2. `#viewTitle` reads Finished and `#viewMeta` reads "2 files, 5.0 MB". Take `$V shot finished`.
- **Remove one (`list-remove`).** Get small.bin's id as in the pause recipe, then `$V click "[data-id=\"$ID\"] button[aria-label=\"Remove from list\"]"`. Wait for the Finished count to read 1. `$V files` still lists `Downloads\small.bin`.
- **Clear (`list-clear`).** Run `$V click '#viewActs button' --text 'Clear from list'`. Wait for `downy.state().then(r => r.data.downloads.length === 0)`. The list shows "No finished downloads yet." in `#listEmpty`, and `$V files` still lists both files.
- **Cancelled goes to Failed (`list-failed`).** Start `$B/file/slow.bin`, wait for downloading, click its `Cancel download`. Then `$V click '#tabs .tab[data-tab=failed]'` and wait for `#main[data-view=failed]`. The row is there with `data-status="cancelled"`. Take `$V shot failed`.
- **Retry (`list-retry`).** A cancelled row has no Retry, only a failed one. Start slow.bin, wait for downloading, then stop the test server by its PID: `node -e "process.kill(require(process.argv[1]).serverPid)" "$(cat .verify/current)/run.json"`. Downy retries 8 times with waits up to 15 s, so wait up to 120 s for status `error`. The row in Failed has a Retry button. Clicking it with the server gone fails again, which proves the button is wired; a retry that succeeds needs a fresh launch.

## Gotchas

- Folder chips (`#folderChips`) only appear with files in two or more folders. File links all go to `Downloads`, so chips need a YouTube or video download and can't be shown with the local server alone.
- Open folder and Show in folder open Explorer on the user's desktop. Don't click them.
- Double clicking a finished row opens the file in its default app. Don't.
- After stopping the server, `doctor` reports the file server down, and later recipes in the same run fail. Run `$V cleanup` and launch again.
