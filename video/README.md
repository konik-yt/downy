# Downy product video

A 38 second Remotion video that shows Downy at work: a video page in Chrome, the Download this video button, the quality menu, the small window that asks before the download, and the main window as the download runs and finishes.

```
npm install
npm run dev                          # Remotion Studio, with sound
npx remotion render DownyPromo out/downy.mp4
node scripts/make-sounds.mjs         # rebuild every sound in public/sfx
```

- `src/DownyPromo.tsx` puts the scenes in order, with the pixel dissolve between them and the music under them.
- `src/scenes/` holds one file per scene: Intro, Browse (the browser and the ask window), ManagerScene (the main window), Features and Outro. Each is also its own composition in the Studio, under Scenes.
- `src/components/` holds the pieces drawn from the app: the overlay button, the ask window, the main window and the segment bar.
- `scripts/make-sounds.mjs` synthesizes all the sounds and the music, so the video uses no outside audio.
- `scripts/stills.mjs <composition> <frame>...` saves frames to `out/stills` for a quick look.
