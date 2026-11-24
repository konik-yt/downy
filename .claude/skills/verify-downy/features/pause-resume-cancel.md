# Pause, resume and cancel

While a file downloads, its row in the Downloads tab has Pause and Cancel buttons. Pause stops the connections and keeps what was downloaded. Resume puts the file back in line, and it continues from the saved offset of each connection instead of from zero. Cancel stops it for good and deletes the part file. Quitting Downy with a download running saves it as paused. A server that ignores Range can't resume, so its paused row reads "Paused. This server cannot resume, so it starts over" and Resume starts from zero.

## Sub-features

- `pause-row` pauses a running download from its row.
- `resume-row` resumes it, and every connection continues from its saved offset.
- `cancel-row` cancels a running or paused download and deletes its part file.
- `pause-quit` saves a running download as paused when Downy quits.
- `pause-all` pauses or resumes everything (from the totals button `#statusAct`, and the tray menu).
- `pause-queued` pauses a row that is still waiting in line, so it doesn't start.

## How to get to it (user POV)

- Downloads tab, hover the running row, click the pause icon (Pause), then the play icon (Resume).
- The same row's x icon (Cancel download).
- The button at the top right of the totals while files run (`#statusAct`).
- Close the window with "Keep running in the tray when closed" off, or Quit Downy from the tray.

## Driving it with downy-verify

Preconditions:

- Baseline from `README.md`.
- Use `slow.bin` (48 MB at about 1 MB/s). `small.bin` finishes before you can click.

- **Start.** Run `$V type '#url' "$B/file/slow.bin"` and `$V key Enter`. Then `$V wait 'downy.state().then(r => { const d = r.data.downloads.find(d => d.title === "slow.bin"); return d && d.status === "downloading" && d.downloaded > 2e6 && d.id })'`. It prints the id. Keep it: `ID=$($V eval 'downy.state().then(r => r.data.downloads.find(d => d.title === "slow.bin").id)' | tr -d '"')`. Run `$V shot running`. The row shows a speed near 1 MB/s and one bar block per connection.
- **Pause (`pause-row`).** Run `$V click "[data-id=\"$ID\"] button[aria-label=\"Pause\"]"`, then `$V wait "downy.state().then(r => r.data.downloads.find(d => d.id === '$ID').status === 'paused')"` and `$V shot paused`. The row reads paused and offers Resume. `$V state --save paused` keeps `downloaded` at the pause.
- **Part file kept.** Run `ls "$(cat .verify/current)/data/parts"`. It lists `<id>.file.bin`.
- **Resume (`resume-row`).** Run `$V click "[data-id=\"$ID\"] button[aria-label=\"Resume\"]"`, wait for status `downloading`, then `$V serverlog slow.bin`. The requests after the click have Range starts that are not segment boundaries, such as `bytes=393216-6291455`, one per connection. Requests from 0 again would mean the resume lost its offsets.
- **Cancel (`cancel-row`).** Run `$V click "[data-id=\"$ID\"] button[aria-label=\"Cancel download\"]"`, wait for status `cancelled`. The row moves to the Failed tab, `data/parts` no longer has `<id>.file.bin`, and `$V files` lists no `slow.bin`.
- **Quit with a download running (`pause-quit`).** Start slow.bin again and wait for `downloading`. Run `$V click '[data-win=close]'` (the seeded run has `closeToTray` off, so this quits). Wait until `$V doctor` reports the Downy process gone, then run `node -e "console.log(require(process.argv[1]).map(j => [j.title, j.status, j.downloaded]))" "$(cat .verify/current)/data/downloads.json"`. slow.bin is `paused` with the bytes it had. Then run `$V cleanup`.

## Gotchas

- Wait for `downloaded > 2e6` before pausing. A pause in the first second can land before every connection has an offset worth checking.
- Resume puts the file at the end of the line, so with other files waiting it may show queued before downloading.
- The pause-quit check must read `downloads.json` before cleanup, since cleanup deletes `data/`.
- After `[data-win=close]`, page commands fail with "the window closed". That is expected; only `doctor`, file reads and `cleanup` work then.
- Part files are named `<id>.<role>.<ext>`. A file link has `<id>.file.bin`. A clip of a video has `<id>.video.init.mp4` and `<id>.video.data.mp4`, and the same for audio. A ZIP pick has one part per run of picked files: `<id>.zip1.bin`, `<id>.zip2.bin`.
- `norange.bin` finishes before you can click. Use `slow-norange.bin` to pause a download that can't resume: wait for `document.querySelector('[data-id="<id>"][data-status=paused]')?.textContent`, which reads "Paused. This server cannot resume, so it starts over", and after Resume its `serverlog` shows a new request with no Range answered 200 with all 8388608 bytes.
- `downy.state()` reports paused a moment before the row re-renders. Wait on the row's `data-status` when you read its text.
