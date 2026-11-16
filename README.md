<img src="extension/icons/icon128.png" width="64" height="64" alt="">

# Downy

A download manager in the style of IDM. A Chrome extension puts a "Download this video" button over YouTube videos and hands normal Chrome downloads to the Downy desktop app, which opens, shows the progress and saves the file.

## What it does

- Downloads each file over several connections at once (8 by default). When a connection finishes its part, it takes half of the largest part still running, so all connections stay busy until the end.
- Pauses and resumes any download. Progress is saved to disk every second, so a download picks up where it stopped even after Downy or Windows restarts.
- Runs several downloads at the same time (3 by default) and queues the rest.
- Takes over normal Chrome downloads of 1 MB or more, with the page's cookies and referrer, so signed-in downloads work. Chrome keeps the download when Downy is closed or the link only works inside the browser. The extension popup has a switch to turn this off. You can also paste any file link into Downy.
- Sorts finished files inside the download folder you choose:

  ```
  Downloads\          files from Chrome and pasted file links
  YouTube\
    MP3\  M4A\  720p\  1080p\  2160p\ ...
  ```
- Lives in the system tray. Closing the window keeps downloads running. Quit from the tray icon.
- Can start with Windows (Settings, Start with Windows).

## Parts

- `app/` is the desktop app (Electron). It serves a small local API on `http://127.0.0.1:9614` for the extension and accepts requests only from Chrome extensions.
  - `src/main/segmented.js` is the multi-connection downloader.
  - `src/main/manager.js` is the queue, pause and resume, saving state, and the ffmpeg merge or MP3 conversion.
  - `src/renderer/` is the window. The background is the Nyx pixel sky from T3 Code.
- `extension/` is the Chrome extension: the button over the player, the quality menu, the hand off of Chrome downloads and a popup with recent downloads.

## Requirements

- `yt-dlp` and `ffmpeg`. Downy finds them on PATH or in winget's install folder:
  `winget install yt-dlp.yt-dlp Gyan.FFmpeg`
- Node.js or Deno, which yt-dlp needs to read YouTube.

## Install

1. Open the [latest release](https://github.com/konik-yt/downy/releases/latest) and download `Downy-Setup-<version>.exe`, or `Downy-<version>-portable.exe` to run it without installing. The exe is not code signed, so Windows SmartScreen may warn you. Click "More info", then "Run anyway".
2. Download `Downy-extension-<version>.zip` from the same release and unzip it.
3. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and pick the unzipped folder. If you loaded it before, click its reload button.
4. Open any YouTube video and click "Download this video".

## Build from source

```
cd app
npm install
npm start          # run from source
npm run dist       # build the installer and the portable exe into app/dist
```

For testing, `DOWNY_USER_DATA` points Downy at a separate settings and history folder, and `DOWNY_SCREENSHOT` saves screenshots of the window every few seconds.

Keep yt-dlp current with `yt-dlp -U` (or `winget upgrade yt-dlp.yt-dlp`), since YouTube changes often.

## Releasing

The Release workflow in `.github/workflows/release.yml` builds the installer, the portable exe and the extension zip on GitHub and publishes them as a release. Start it from the Actions tab (Release, then "Run workflow") or with:

```
gh workflow run release.yml                      # next patch version, like 2.0.1
gh workflow run release.yml -f bump=minor        # like 2.1.0
gh workflow run release.yml -f version=3.0.0     # an exact version
```

If the version in `app/package.json` has no release yet, the workflow releases that version as it is. Otherwise it raises the version, writes it to `app/package.json` and `extension/manifest.json`, commits that to the branch and tags the commit.

## Credits

The pixel sky background, the grid and the glass styles come from the Nyx theme for [T3 Code](https://github.com/pingdotgg/t3code), made by [Deepu (@Deepusleepy)](https://github.com/Deepusleepy). Thanks to Deepu for the art.
