# Downy videos

Two Remotion videos in the same style:

- `DownyPromo`, 38 seconds, shows Downy at work: a video page in Chrome, the Download this video button, the quality menu, the small window that asks before the download, and the main window as the download runs and finishes.
- `DownySetup`, 57 seconds, walks through setup click by click: downloading the installer from GitHub, getting past SmartScreen, installing, the first-run steps (folder and tools), adding the Chrome extension with Developer mode and Load unpacked, and the button on YouTube. A bar at the top shows the step, and a caption at the bottom says what to click.

```
npm install
npm run dev                          # Remotion Studio, with sound
npx remotion render DownyPromo out/downy.mp4
npx remotion render DownySetup out/downy-setup.mp4
node scripts/make-sounds.mjs         # rebuild every sound in public/sfx
```

- `src/DownyPromo.tsx` puts the scenes in order, with the pixel dissolve between them and the music under them.
- `src/scenes/` holds one file per scene: Intro, Browse (the browser and the ask window), ManagerScene (the main window), Features and Outro. Each is also its own composition in the Studio, under Scenes.
- `src/components/` holds the pieces drawn from the app: the overlay button, the ask window, the main window and the segment bar.
- `src/DownySetup.tsx` and `src/setup/` are the setup video: its scenes, the captions, step bar and keycaps (`ui.tsx`), the welcome dialog, the release page and installer, and Chrome's extensions page with the folder picker.
- `scripts/make-sounds.mjs` synthesizes all the sounds and the music, so the video uses no outside audio.
- `scripts/stills.mjs <composition> <frame>...` saves frames to `out/stills` for a quick look.
