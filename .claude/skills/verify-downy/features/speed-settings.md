# Speed settings

Settings, Speed has two steppers: Connections per file (1 to 32, default 8) and Downloads at the same time (1 to 10, default 3). Downy saves a change at once. More files than the limit wait in line on the Downloads tab, and the next one starts when a slot frees up.

## Sub-features

- `speed-connections` changes connections per file, and new downloads use that many.
- `speed-active` changes downloads at the same time, and extra files wait as queued.
- `speed-limits` disables the minus button at the lower limit and the plus button at the upper one.

## How to get to it (user POV)

- Click the sliders icon at the top right (Settings), then Speed on the left, then the minus or plus buttons.

## Driving it with downy-verify

Preconditions:

- Baseline from `README.md`: connections 8, downloads at once 3.

- **Open Speed.** Run `$V click '#openSettings'`, `$V wait 'document.querySelector("#settings").open'`, `$V click '#setNav [data-page=speed]'`. Take `$V shot speed-before`. The outputs read 8 and 3.
- **One at a time (`speed-active`).** Click `$V click '[data-step=maxActive][data-delta="-1"]'` twice, waiting after each for `document.querySelector("output[name=maxActive]").textContent` to read 2, then 1. The minus button is now disabled: `$V eval 'document.querySelector("[data-step=maxActive][data-delta=\"-1\"]").disabled'` prints true (`speed-limits`). Read the stored value: `node -e "console.log(require(process.argv[1]).maxActive)" "$(cat .verify/current)/data/settings.json"` prints 1.
- **Close.** Run `$V click 'button[aria-label="Close settings"]'` and wait for `!document.querySelector("#settings").open`.
- **The queue follows it.** Paste `$B/file/slow.bin` twice (type, Enter, wait for the first row each time). Then `$V wait 'downy.state().then(r => { const s = r.data.downloads.map(d => d.status).sort().join(","); return s === "downloading,queued" && s })'`. Take `$V shot one-at-a-time`. The waiting row shows its place in line with the Next chip.
- **Connections (`speed-connections`).** Set connections to 2 with the minus button (6 clicks from 8, wait for `output[name=connections]` to read 2). Cancel both slow rows, paste `$B/file/slow.bin` again and wait for downloading. `$V eval 'downy.state().then(r => r.data.downloads.find(d => d.status === "downloading").segments.length)'` prints 2, and `$V serverlog slow.bin` shows the newest download open two Range requests at once, at `bytes=0-10485759` and `bytes=25165824-35651583`. Each request stops at 10 MB, so more follow as each half goes on, about 6 in all for 48 MB.

## Gotchas

- A change to maxActive applies to the queue at once (`settings.on("change")` calls `schedule()`), but lowering it does not stop files that already run. Start the files after lowering it.
- The stepper buttons do nothing while disabled, and the helper refuses to click a disabled button. Read the output before each click.
- Two downloads of the same link get two rows and two files (`slow.bin`, then `slow (2).bin`), so tell rows apart by id.
- Cancelled rows stay in the list, so filter them out when you wait for `downloading,queued`.
