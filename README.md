<img src="extension/icons/icon128.png" width="64" height="64" alt="">

# Downy

A YouTube download manager in the style of IDM. A Chrome extension puts a "Download this video" button over YouTube videos. Picking a quality hands the job to the Downy desktop app, which opens, shows the progress and saves the file into a folder for its format.

## What it does

- Downloads each file over several connections at once (8 by default). When a connection finishes its part, it takes half of the largest part still running, so all connections stay busy until the end.
- Pauses and resumes any download. Progress is saved to disk every second, so a download picks up where it stopped even after Downy or Windows restarts.
- Runs several downloads at the same time (3 by default) and queues the rest.
- Sorts finished files into `MP3`, `M4A`, `144p` up to `2160p` folders inside the download folder you choose.
- Lives in the system tray. Closing the window keeps downloads running. Quit from the tray icon.
- Can start with Windows (Settings, Start with Windows).

## Parts

- `app/` is the desktop app (Electron). It serves a small local API on `http://127.0.0.1:9614` for the extension and accepts requests only from Chrome extensions.
  - `src/main/segmented.js` is the multi-connection downloader.
  - `src/main/manager.js` is the queue, pause and resume, saving state, and the ffmpeg merge or MP3 conversion.
  - `src/renderer/` is the window. The background is the Nyx pixel sky from T3 Code.
- `extension/` is the Chrome extension: the button over the player, the quality menu and a popup with recent downloads.

## Requirements

- `yt-dlp` and `ffmpeg`. Downy finds them on PATH or in winget's install folder:
  `winget install yt-dlp.yt-dlp Gyan.FFmpeg`
- Node.js or Deno, which yt-dlp needs to read YouTube.

## Install

1. Run `app\dist\Downy-Setup-2.0.0.exe`, or use `app\dist\Downy-2.0.0-portable.exe` without installing.
2. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick the `extension` folder. If you loaded it before, click its reload button.
3. Open any YouTube video and click "Download this video".

## Build from source

```
cd app
npm install
npm start          # run from source
npm run dist       # build the installer and the portable exe into app/dist
```

For testing, `DOWNY_USER_DATA` points Downy at a separate settings and history folder, and `DOWNY_SCREENSHOT` saves screenshots of the window every few seconds.

Keep yt-dlp current with `yt-dlp -U` (or `winget upgrade yt-dlp.yt-dlp`), since YouTube changes often.
