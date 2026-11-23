# Paste a file link

A user pastes a link to a file into the box at the bottom of the window and presses Enter. Downy checks the link, adds a row, downloads the file over several connections and saves it under `Downloads\` in the download folder. The window stays on the Downloads tab, and the Finished tab's count goes up. A link to a `.zip` opens the list of files in it instead (see `zip-pick.md`). A link that opens a web page or isn't http or https is refused with a message under the box.

## Sub-features

- `paste-file` downloads a Range capable file over several connections into `Downloads\<name>`.
- `paste-norange` downloads a file from a server that ignores Range, over one connection.
- `paste-refuse-page` refuses a link that returns HTML, with "This link opens a web page, not a file".
- `paste-html-file` downloads a link whose name ends in `.html`, even though it returns HTML.
- `paste-refuse-bad` refuses text that is not an http or https link.
- `paste-empty` asks for a link when the box is empty.

## How to get to it (user POV)

- Click the box ("Paste a YouTube link or a file link"), type or paste the link, press Enter.
- Same, then click the round send button on the right of the box.
- Press Ctrl+V anywhere in the window except another text field: an http or https link fills the box and the hint says "Press Enter to download this file into Downloads".
- Drop a link from a browser onto the window. It works like a paste.

## Driving it with downy-verify

Preconditions:

- Baseline from `README.md`, with an empty download list.

- **Before.** Run `$V shot before-paste`. The window shows "What should we download?" and `#main` has `data-view="idle"`.
- **Paste and Enter (`paste-file`).** Run `$V type '#url' "$B/file/small.bin"` then `$V key Enter`. Then `$V wait 'downy.state().then(r => r.data.downloads.find(d => d.title === "small.bin" && d.status === "done"))' --timeout 30000`. It prints the row with `status: "done"`, `folder: "Downloads"` and `downloaded` equal to `expected` (3145728).
- **The window shows it.** Run `$V wait 'document.querySelector("#tabs .tab[data-tab=done] .n")?.dataset.v === "1"'` and `$V shot after-download`. The Downloads tab stays open with `#main[data-view=idle]`, and the Finished tab's count reads 1. Click `#tabs .tab[data-tab=done]` to see the row: small.bin, "Saved to Downloads", 3.0 MB.
- **The file is right.** Run `$V files --save paste`. It lists `Downloads\small.bin`, size 3145728, with `matches: "/file/small.bin"`.
- **It used several connections.** Run `$V serverlog small.bin`. After a `bytes=0-0` probe there are 206 answers for 3 separate ranges (`0-1048575`, `1048576-2097151`, `2097152-3145727`), at about the same time.
- **Send button entry.** Run `$V type '#url' "$B/file/norange.bin"` then `$V click '#sendBtn'`, then wait as above for `norange.bin` to be done. `$V files` shows `Downloads\norange.bin` matching `/file/norange.bin`, and `$V serverlog norange.bin` shows GET requests answered 200 with the full 2097152 bytes, not 206 (`paste-norange`).
- **Web page (`paste-refuse-page`).** Run `$V type '#url' "$B/login"`, `$V key Enter`, then `$V wait 'document.querySelector("#composerHint.bad")?.textContent === "This link opens a web page, not a file"'`. `$V state` has no `login` row and `$V eval 'document.querySelector("#url").value'` still holds the link. Take `$V shot refused-page`.
- **An .html link is a file (`paste-html-file`).** Run `$V type '#url' "$B/page.html" --replace` and `$V key Enter`, then wait for a `page.html` row with status done. `$V files` lists `Downloads\page.html` matching `/page.html`, and the box is empty again.
- **Not a link (`paste-refuse-bad`).** Run `$V type '#url' "ftp://example.com/x.bin" --replace`, `$V key Enter`, then `$V wait 'document.querySelector("#composerHint.bad")?.textContent === "Downy can only download http and https links"'`.
- **Empty box (`paste-empty`).** Type one space over the old text with `$V type '#url' " " --replace` (the composer trims it to nothing), then `$V click '#sendBtn'` and `$V wait 'document.querySelector("#composerHint.bad")?.textContent === "Paste a link first"'`.

## Gotchas

- `type` clicks the field, which drops any selection, then inserts at the cursor. Without `--replace` a second link is appended to a refused one still in the box, and the server answers 404 for the joined URL.
- An error hint stays until you type in the box or the next check runs. Wait for the exact message, not just for `#composerHint.bad`, or you read the previous step's error.
- Read a tab count from `.n`'s `data-v`. Its text holds the old and new digits for a moment while the number rolls.
- A YouTube link takes the other path (format picker, yt-dlp, network). Only use links on `$B` here.
- The Ctrl+V entry reads the system clipboard, which belongs to the user's desktop. Don't write to it; report that entry as not driven. The drop entry needs a drag from another app, which the helper can't make, so report it as not driven too.
- File downloads always land in `Downloads\`, even with "Sort YouTube files by format" on. A second download with the same name gets a new name rather than overwriting, so check `files` for the exact path.
