<img src="extension/icons/icon128.png" width="64" height="64" alt="">

# Downy

A download manager for Windows in the style of IDM. Downy splits each file into segments, downloads them over several connections at once, and saves its progress to disk every second, so a paused or interrupted download picks up where it stopped, even after a crash or a Windows restart. A Chrome extension hands Chrome's downloads over to the desktop app.

## How the downloader works

The code is in `app/src/main/segmented.js`.

- Downy first asks the server for the file size and checks that it answers Range requests. It then makes a part file of the full size and splits it into one segment per connection (8 by default). Each connection fetches its segment in Range requests of up to 10 MB and writes the bytes straight to their offset in the part file.
- When a connection finishes its segment, it takes the back half of the largest segment still running, as long as each half keeps at least 1 MB. All connections stay busy until the last byte, so one slow connection doesn't hold up the end of the download.
- A failed request is retried up to 8 times, with a wait that doubles each time up to 15 seconds. Answers 429 and 5xx count as worth retrying. When a link has expired (403 or 410), Downy gets a fresh one and the connection carries on from its offset.
- The queue saves the start, end and current offset of every segment to disk every second. A download that was paused, or cut off by a crash or a restart, resumes from those offsets. If the part file was deleted, that stream starts over.
- A server without Range support gets a single connection, which starts from zero again after an interruption.

## What else it does

- Runs several downloads at the same time (3 by default) and queues the rest. You can pause and resume one download or all of them.
- Takes over normal Chrome downloads of 1 MB or more, with the page's cookies and referrer, so signed-in downloads work. Chrome keeps the download when Downy is closed or the link only works inside the browser. The extension popup has a switch to turn this off. You can also paste any file link into Downy.
- Downloads videos from the sites yt-dlp supports, such as Vimeo, Reddit, X, Dailymotion or YouTube. The extension shows a "Download this video" button when the pointer is over a video, embedded players included. Downy uses yt-dlp only to read the page and list the formats. It downloads plain HTTP streams with its own segmented downloader and joins video and audio with ffmpeg. Formats that come as HLS or DASH fragments go through yt-dlp. On a site yt-dlp doesn't know, no button shows. Downy asks yt-dlp about the page once, with its catch-all "generic" extractor turned off, and gets an answer in about a second. The extension passes the site's cookies to yt-dlp, so videos that need a sign-in work. YouTube never gets cookies, because yt-dlp warns that they can get an account flagged.
- Asks before each download from Chrome in a small window near the top of the screen. After you pick a quality in the menu on the page, or when Chrome hands over a file, the window shows the file name, the folder and, for a video, the format, and you can change all three. Enter starts the download and Esc cancels it. Turn it off in Settings, Ask before each download.
- Sorts finished files inside the download folder you choose:

  ```
  Downloads\          files from Chrome and pasted file links
  YouTube\
    MP3\  M4A\  720p\  1080p\  2160p\ ...
  Videos\             videos from every other site, sorted the same way
    720p\  1080p\  Best\ ...
  ```
- Lives in the system tray. Closing the window keeps downloads running. Quit from the tray icon.
- Can start with Windows (Settings, Start with Windows).

## Parts

- `app/` is the desktop app (Electron). It serves a small local API on `http://127.0.0.1:9614` for the extension. Every call needs a random token that Downy writes into its own copy of the extension as `token.json`, so web pages and other extensions can't use the API.
  - `src/main/segmented.js` is the multi-connection downloader.
  - `src/main/manager.js` is the queue, pause and resume, saving state, and the ffmpeg merge or MP3 conversion.
  - `src/renderer/` is the window. The background is the Nyx pixel sky from T3 Code.
  - `src/main/updater.js` checks GitHub releases and installs updates with electron-updater.
  - `src/main/prompt.js` and `src/renderer/prompt.html` are the small window that asks before a download starts.
  - `src/main/installer.js` installs missing tools with winget.
  - `src/main/extension.js` copies the bundled extension into Downy's data folder and tracks whether Chrome has loaded it.
- `extension/` is the Chrome extension. The installer bundles it.
  - `overlay.js` is the button and the quality menu.
  - `content.js` puts it over the YouTube player, and `video.js` over videos on every other site.
  - `background.js` talks to Downy and hands Chrome downloads over to it.
  - `popup.html` lists recent downloads.

## Requirements

- `yt-dlp` and `ffmpeg`. Downy finds them on PATH or in winget's install folder.
- Node.js or Deno, which yt-dlp needs to read YouTube.

When any of them is missing, Downy offers to install it with winget (`yt-dlp.yt-dlp`, `Gyan.FFmpeg`, `DenoLand.Deno`), on the welcome screen or from Settings, Install tools. Once a day Downy runs `winget upgrade yt-dlp.yt-dlp` when yt-dlp came from winget, since YouTube changes often.

## Install

Each step has a short clip that shows what to click.

1. Open the [latest release](https://github.com/konik-yt/downy/releases/latest) and download `Downy-Setup-<version>.exe`. The exe is not code signed, so Windows SmartScreen may warn you. Click "More info", then "Run anyway".

   ![Downloading the installer from GitHub and getting past SmartScreen](docs/setup/download.webp)

2. Keep the install folder and click "Install". Leave "Run Downy" checked and click "Finish".

   ![The installer](docs/setup/install.webp)

3. Downy opens and asks where to save downloads. Click "Use this folder", or "Choose folder" to pick another. Next it checks for yt-dlp, ffmpeg and Deno. Click "Install" to get the missing ones with winget, then click "Next" when all three say Found.

   ![Picking the download folder and installing the tools](docs/setup/first-start.webp)

4. Now add the Chrome extension, which comes with Downy. Chrome only allows this kind of extension by hand. In Downy, click "Open Chrome". Downy copies `chrome://extensions` for you, so click Chrome's address bar, press Ctrl+V, then Enter. Turn on Developer mode at the top right.

   ![Opening chrome://extensions and turning on Developer mode](docs/setup/chrome-extensions.webp)

5. Back in Downy, click "Copy folder". In Chrome, click "Load unpacked", click the Folder box, press Ctrl+V and click "Select Folder". Downy shows up in your extensions.

   ![Copying the folder and loading it with Load unpacked](docs/setup/load-unpacked.webp)

6. The status in Downy turns green once Chrome has loaded the extension. Click "Done".

   ![The status turns green](docs/setup/connected.webp)

7. Open any YouTube video and click "Download this video".

   ![The Download this video button on YouTube](docs/setup/try-it.webp)

You can open the extension steps again from Settings, Chrome extension, Set up.

### Updating

Downy checks GitHub for a new release when it starts and every 4 hours. The installed app downloads the new version in the background, then shows "Restart to update" at the top right of the window and in the tray menu. Click it and Downy saves the downloads, installs the update and starts again, and the downloads that were running continue. If you don't click it, the update installs the next time you quit Downy. Settings, Updates shows the current version and has a "Check now" button.

Versions before 2.2 have no updater. Run the new `Downy-Setup-<version>.exe` over the old one once. Your settings, history and unfinished downloads stay in `%APPDATA%\Downy`.

Downy keeps its copy of the extension in `%APPDATA%\Downy\Chrome extension` and refreshes it after each update. Every answer from Downy carries the version it bundles in an `X-Downy-Extension` header. When that differs from the running extension, the extension waits until no request or download handover is in progress and reloads itself, which makes Chrome read the new files. It reloads at most once per version, so a failed copy can't cause a reload loop. Tabs that were open before the reload need a refresh before the video button works again. Extensions from Downy 2.2.1 and earlier lack this check, so after updating from one of them, click the reload button on Downy in `chrome://extensions` once or restart Chrome. The extension only works from that folder, because that is where Downy writes the token the API asks for. If you loaded it from a zip or from this repo, Downy asks you to switch to its own copy.

## Build from source

```
cd app
npm install
npm start          # run from source
npm run dist       # build the installer into app/dist
npm run lint       # ESLint for the app and the extension
npm test           # unit tests, no Electron or yt-dlp needed
```

For testing, `DOWNY_USER_DATA` points Downy at a separate settings and history folder, `DOWNY_PORT` moves the local API off 9614, `DOWNY_UPDATE_URL` points the updater at a folder with `latest.yml` and a setup exe instead of GitHub, and `DOWNY_SCREENSHOT` saves screenshots of the window every few seconds. `DOWNY_USER_DATA` and `DOWNY_SCREENSHOT` only work when Downy runs from source with `npm start`. `DOWNY_UPDATE_URL` only works in an installed build, since the updater is off when running from source.

A yt-dlp from somewhere other than winget is not upgraded by Downy. Keep it current with `yt-dlp -U`.

## Releasing

The Release workflow in `.github/workflows/release.yml` builds the installer on GitHub and publishes them as a release. Start it from the Actions tab (Release, then "Run workflow") or with:

```
gh workflow run release.yml                      # next patch version, like 2.0.1
gh workflow run release.yml -f bump=minor        # like 2.1.0
gh workflow run release.yml -f version=3.0.0     # an exact version
```

Each release carries `latest.yml` and `Downy-Setup-<version>.exe.blockmap` next to the exe. The updater in Downy reads them, so don't delete them from a release.

If the version in `app/package.json` has no release yet, the workflow releases that version as it is. Otherwise it raises the version, writes it to `app/package.json` and `extension/manifest.json`, commits that to the branch and tags the commit.

## Credits

The pixel sky background, the grid and the glass styles come from the Nyx theme for [T3 Code](https://github.com/pingdotgg/t3code), made by [Deepu (@Deepusleepy)](https://github.com/Deepusleepy). Thanks to Deepu for the art.
