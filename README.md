<img src="extension/icons/icon128.png" width="64" height="64" alt="">

# Downy

A YouTube downloader in the style of IDM. A Chrome extension puts a "Download this video" button over YouTube videos. Picking a quality sends the job to a small helper app on your PC, which runs yt-dlp and ffmpeg and saves the file to `Downloads\Downy`.

## Parts

- `extension/` is the Chrome extension: the button over the player, the quality menu and a popup with recent downloads.
- `helper/downy_helper.py` is the local helper. It listens on `http://127.0.0.1:9614`, accepts requests only from the extension and its own page, and serves a download manager page at that address.
- `start-downy.bat` starts the helper without a console window.
- `install-startup.ps1` makes the helper start when you sign in. Run it with `-Remove` to undo.

## Requirements

- Python 3.10 or newer (no extra packages)
- `yt-dlp` and `ffmpeg` on PATH
- Node.js or Deno on PATH, which yt-dlp needs to read YouTube

## Setup

1. Double click `start-downy.bat`, or run `powershell -ExecutionPolicy Bypass -File install-startup.ps1` to start it at every sign in.
2. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick the `extension` folder.
3. Open any YouTube video. The button sits at the top right of the player and hides along with the YouTube controls.

## Options

- `DOWNY_DIR` changes the download folder.
- `DOWNY_PORT` changes the port. The extension expects 9614, so change `extension/background.js` and `manifest.json` too.

Keep yt-dlp current with `yt-dlp -U`, since YouTube changes often.
