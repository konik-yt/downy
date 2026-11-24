# Pick files from a ZIP

When a link points to a ZIP on a server that answers Range requests, Downy reads the list of files inside it without downloading the archive, and the user ticks the files they want. Downy then fetches only the bytes of those files, checks each one's CRC32 and size, and saves them. One picked file goes straight into `Downloads\`. Several go into a folder named after the archive, such as `Downloads\Sample\docs\guide.md`, without a second `Sample` folder when the archive already has one at the top. Download whole archive keeps the old behaviour and saves the `.zip`.

## Sub-features

- `zip-composer` lists the files when a `.zip` link is pasted or entered in the main window.
- `zip-confirm` lists them in the confirm window that a ZIP download from Chrome opens, behind Choose files.
- `zip-tree` ticks files and folders: a folder box ticks everything below it, Pick none and Pick all flip every file, and a filter box shows up with more than 12 files.
- `zip-extract` saves only the picked files, with the right hashes, in the right folders.
- `zip-whole` downloads the archive itself with Download whole archive (main window) or Keep all files (confirm window).
- `zip-plain` keeps a ZIP on a server without Range, or one that can't be listed, as a plain download.

## How to get to it (user POV)

- Main window: paste a link that ends in `.zip`, or type it and press Enter. The picker shows the archive name, the file count and size, the tree, and the buttons Download N files, Download whole archive and Cancel.
- Confirm window: download a ZIP in Chrome. Click Choose files under the name. The link then reads Keep all files, and Download reads "Download N files".

## Driving it with downy-verify

Preconditions:

- Baseline from `README.md`. The file server serves `$B/file/Sample.zip` with `Sample/readme.txt`, `Sample/data.json`, `Sample/docs/guide.md`, `Sample/docs/notes.txt` and `Sample/big.bin` (4 MB).
- `served.json` lists each entry as `/file/Sample.zip!/Sample/<path>`, so `$V files` names the entry each saved file matches.

- **Open the list (`zip-composer`).** Run `$V type '#url' "$B/file/Sample.zip"` and `$V key Enter`, then `$V wait '!!document.querySelector("#picker .ft-box")'`. Every file starts ticked and `.ft-sum` reads "5 of 5 files" with Pick none.
- **Pick two (`zip-tree`).** Run `$V click '#picker .ft-sum button'` (Pick none), then `$V click '#picker .ft-row:has(> .ft-name[title$="readme.txt"]) .ft-box'` and the same for `data.json`. The primary button in `#picker .pick-actions` reads "Download 2 files". Take `$V shot zip-picked`.
- **Download (`zip-extract`).** Run `$V click '#picker .pick-actions .btn.primary'`. Wait for the row titled "2 files from Sample.zip" to be done, then `$V files --save zip`. It lists `Downloads\Sample\readme.txt` and `Downloads\Sample\data.json`, each matching its `/file/Sample.zip!/Sample/...` entry, and no `Downloads\Sample\Sample`.
- **Only those bytes.** Run `$V serverlog Sample.zip`. After the `bytes=0-0` probe and the tail read of the central directory, the ranges cover only the two files (such as `bytes=0-96` and `bytes=4197608-4200623`). No request covers `big.bin`.
- **Confirm window (`zip-confirm`).** Run `$V api POST api/file "{\"url\":\"$B/file/Sample.zip\",\"filename\":\"Sample.zip\",\"mime\":\"application/zip\"}"`, then `$V wait '!document.querySelector("#choose").hidden' --target prompt --timeout 20000` and `$V click '#choose' --target prompt`. Untick the top folder with `$V click '.ft-row.dir[style*="--depth: 0"] .ft-box' --target prompt`, tick `.ft-row:has(> .ft-name[title$="guide.md"]) .ft-box`, and read `#goText`: "Download 1 file". `#choose` reads Keep all files and `#rename` is hidden. Click `#go` (the window closes). The row is titled "guide.md from Sample.zip", and `$V files` lists `Downloads\guide.md` matching `/file/Sample.zip!/Sample/docs/guide.md`.
- **Whole archive (`zip-whole`).** In either window, choose Download whole archive or Keep all files. `$V files` lists `Downloads\Sample.zip` matching `/file/Sample.zip`.

## Gotchas

- The top folder `Sample` has `--depth: 0`. Folder rows are `.ft-row.dir`, and their name is a button that opens or closes the folder, so click `.ft-box` to tick.
- Find a file by `.ft-name[title$="<name>"]`. The title holds the full path inside the archive.
- One picked file lands in `Downloads\` with no folder, and its row is titled "<file> from <archive>". Several land in `Downloads\<archive name>\`.
- Clicking `#go` closes the confirm window, so the helper prints "the window closed". Add `|| true` in a chain.
- `zip.js` builds a part per run of picked files, joining runs less than 1 MB apart. Picking `readme.txt` and `data.json`, which `big.bin` sits between, makes two parts (`<id>.zip1.bin`, `<id>.zip2.bin`).
- `zip-plain` needs a ZIP on a server without Range. The fixture has Range, so `paste-norange` style proof needs a new fixture. Unit tests in `app/test/zip.test.js` cover it.
