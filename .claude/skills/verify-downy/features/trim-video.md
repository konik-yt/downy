# Trim a video

A user who downloads a YouTube video can keep only part of it. Trim opens a filmstrip of the video with a handle at each end, like the trim bar in Apple Photos. Dragging a handle shows the frame and time under it, and the format tiles then show the size of the part instead of the whole video. Downy fetches only the bytes the part needs and cuts the file with ffmpeg, so a 20 s clip of a 140 MB video costs about 5 MB. The file name gets the range, such as `(720p, 1m00s-1m20s)`.

## Sub-features

- `trim-confirm` trims in the confirm window that a YouTube download from Chrome opens.
- `trim-picker` trims in the format picker of the main window, after pasting a YouTube link.
- `trim-drag` drags a handle, drags the middle to move the whole part, or clicks the strip to bring the nearest end there.
- `trim-keys` moves the focused handle with the arrow keys (1 s, with Shift 10 s), PageUp and PageDown (60 s), Home and End.
- `trim-size` shows each tile's size for the part, and puts the range in the saved file's name.
- `trim-cancel` drops the trim with Cancel trim, which brings back the whole video's name and sizes.

## How to get to it (user POV)

- Confirm window for a video: click Trim under the title. The link then reads Cancel trim.
- Main window: paste a YouTube link, press Enter, click Trim at the top right of the format picker.
- Drag the left or right handle on the filmstrip, or Tab to a handle and use the arrow keys. Then click Download or a format tile.

## Driving it with downy-verify

Preconditions:

- Baseline from `README.md`, plus the real network, yt-dlp and ffmpeg (`$V doctor` lists them).
- Big Buck Bunny, `https://www.youtube.com/watch?v=aqz-KE-bpKQ`, 10:35 long. The local file server has no video, so this feature can't run offline.
- `ffprobe` on PATH to measure the result.

- **Open the confirm window (`trim-confirm`).** Run `$V api POST api/download '{"url":"https://www.youtube.com/watch?v=aqz-KE-bpKQ","option":"v720"}'`. It answers `{"prompt":"<id>"}`. Then `$V wait '!document.querySelector("#trim").hidden' --target prompt --timeout 90000`, since yt-dlp reads the formats first.
- **Open the trimmer.** Run `$V click '#trim' --target prompt` and `$V wait '!!document.querySelector(".trim-handle.start")' --target prompt`. `.trim-times` reads "0:00", "Drag an end to trim", "10:35". The track is 462 px wide (`$V eval 'document.querySelector(".trim-track").getBoundingClientRect().width' --target prompt`).
- **Drag (`trim-drag`).** Run `$V drag '.trim-handle.start' 44 --target prompt`, then `$V drag '.trim-handle.end' -404 --shot confirm-trim-dragging --target prompt`. `$V eval 'document.querySelector(".trim-times b").textContent' --target prompt` prints "1:00 to 1:20, 20 seconds". The mid-drag shot shows the frame at 1:20 in the big picture and a bubble reading 1:20 over the handle.
- **Keys (`trim-keys`).** The end handle has focus after its drag. Run `$V key Shift+ArrowRight --target prompt`; the label reads "1:00 to 1:30, 30 seconds". `$V key Shift+ArrowLeft --target prompt` brings it back to 1:20.
- **Sizes (`trim-size`).** Run `$V eval '[...document.querySelectorAll("#tiles .pick")].map(b => b.textContent)' --target prompt`. The 720p tile (`#tiles .pick[data-id=v720]`) reads the whole size times 20 s over 10:35, such as 4.8 MB for 153.3 MB. YouTube's sizes change between yt-dlp reads (138.9 MB in another run), so check the ratio, not a fixed number.
- **Download.** Run `$V click '#go' --target prompt` (the window closes, so the helper may print "the window closed"). Wait for a row whose `filepath` ends in `(720p, 1m00s-1m20s).mp4` with status done, then run `ffprobe -v error -show_entries format=duration:stream=codec_type,height -of compact "<that path>"`. It shows a 720 video stream, an audio stream and a duration of about 20.05.
- **Main window picker (`trim-picker`).** Run `$V type '#url' "https://www.youtube.com/watch?v=aqz-KE-bpKQ" --replace`, `$V key Enter`, then `$V wait '!!document.querySelector("#picker .pick-trim")' --timeout 90000` and `$V click '#picker .pick-trim'`. The track is 706 px wide, so `$V drag '#picker .trim-handle.start' 67` and `$V drag '#picker .trim-handle.end' -628 --shot picker-trim-dragging` give "1:00 to 1:10, 10 seconds". The small frame shows inside the bubble here, since the picker has no big picture. Click `#picker .pick[data-id="v360"]`; the 360p file in `YouTube\360p` has an ffprobe duration of about 10.03.
- **Cancel (`trim-cancel`).** Click `#trim` (or `.pick-trim`) again. It reads Trim, the trimmer is gone and the tiles show the whole video's sizes.

## Gotchas

- The drag distances depend on the track width and the video length. Read the width first and work out dx as seconds divided by the length, times the width. Handles round to whole seconds, so check the label and fix it with the arrow keys.
- `onChange` runs when a drag ends or a key moves a handle, not during the drag, so the tile sizes change after the button comes up.
- The storyboard sheets load from YouTube's image server. Without them the strip is plain and the bubble shows only the time.
- A clip of an HLS stream falls back to yt-dlp's `--download-sections`, and its row shows a bar that moves without a percent.
