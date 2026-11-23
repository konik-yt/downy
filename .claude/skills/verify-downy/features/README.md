# Downy verification map

This folder is the maintained list of what a user can do in Downy and how to prove each part works in the real app. Read this index first, then follow the feature file for the area you changed. Every recipe uses the helper from `../SKILL.md`:

```bash
V="node .claude/skills/verify-downy/scripts/downy-verify.mjs"
B=$(node -e "console.log(require(require('fs').readFileSync('.verify/current','utf8').trim()+'/evidence/served.json').base)")
```

## Baseline preconditions

- `$V launch` printed `READY`, and `$V doctor` printed `DOCTOR OK`.
- The run is seeded (no `--fresh`): the download list is empty, `downloadDir` is the run's `downloads/`, `maxActive` is 3, `connections` is 8, `confirm` is true, notifications are off.
- `B` holds the file server's base URL from `evidence/served.json`.
- Drive only the instance this run launched. The user's installed Downy (port 9614, `%APPDATA%\Downy`) is off limits.

## Driving conventions

- Start each recipe from the baseline unless its preconditions say otherwise. When a recipe leaves rows behind that the next one doesn't expect, run `$V cleanup` and `$V launch` again.
- Use the stable handles listed in `../SKILL.md`: ids, `aria-label`, `data-id`, `data-tab`, `data-status`, `data-step`. Use `--text` only for header buttons that have nothing else.
- Cause every change with `click`, `type` or `key`. Use `eval`, `wait`, `state` and `files` only to read.
- After each action, `wait` for the state it should cause. Never sleep and hope.

## Proof and skip reporting

- Take a `shot` before and after each action you claim; `actions.log` records the action between them.
- A download proof includes `$V files --save <name>` with a `matches` entry for the served file and the expected path under `downloads/`.
- A resume proof includes `$V serverlog <file>` lines with Range starts past 0 after the Resume click.
- A settings proof includes the value read back from `data/settings.json` or `downy.state()` after the dialog closed.
- Name the feature id (such as `paste-file`) and entry point with each artifact in your report.
- When a journey can't run, report the command that failed and the missing precondition. Do not report a skipped entry point as covered through another one.

## Feature entry contract

Each feature file has an H1 title and one paragraph on what the user sees, then exactly these H2 sections in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with downy-verify` (starting with `Preconditions:` and labelled steps that pair the user action, the exact command and the result to observe), and `Gotchas`.

## Features

- [Paste a file link](./paste-file-link.md): the composer, a segmented download into Downloads, links Downy must refuse.
- [Pause, resume and cancel](./pause-resume-cancel.md): row buttons on a running download, resuming from saved offsets, quitting with a download running.
- [Chrome handover and the confirm window](./chrome-handover.md): what the extension sends to the local API, and the window that asks before the download starts.
- [Finished and Failed lists](./finished-and-failed.md): the tabs, removing rows, Clear from list, Retry.
- [Speed settings](./speed-settings.md): connections per file and downloads at the same time, and the queue they cause.
- [Trim a video](./trim-video.md): the filmstrip with drag handles in the confirm window and the main window picker, and the clip it saves. Needs the real network.
- [Pick files from a ZIP](./zip-pick.md): the file list for a `.zip` link in the main window and behind Choose files in the confirm window, and the files it extracts.

Last driven against the real app (2026-11-24, Downy 3.1.0, commit 686f88b):

- `paste-file`, `paste-norange`, `paste-refuse-page`, `paste-refuse-bad`: driven. `paste-html-file` and `paste-empty` were driven on 2026-11-24 at commit 85ecd32. The Ctrl+V and drop entries read the user's clipboard or need another app, so they are not driven.
- `pause-row`, `resume-row`, `cancel-row`, `pause-quit`: driven. `pause-all` and `pause-queued` not yet.
- `handover-confirm`, `handover-rename`, `handover-cancel`, `handover-token`: driven. `handover-direct` not yet.
- `list-tabs`, `list-remove`, `list-clear`, `list-failed`, `list-retry`: driven.
- `speed-active`, `speed-limits`, `speed-connections`: driven.
- `trim-confirm`, `trim-picker`, `trim-drag`, `trim-keys`, `trim-size`, `trim-cancel`: driven against YouTube.
- `zip-composer`, `zip-confirm`, `zip-tree`, `zip-extract`, `zip-whole`: driven. `zip-plain` is covered by unit tests only.

## Not mapped yet

- Welcome screen (`$V launch --fresh`): folder step, tools step, Chrome extension step.
- YouTube and other video sites beyond a trimmed clip: a whole video, MP3, and sites other than YouTube. `trim-video.md` covers the format picker and the confirm window for one video. Needs the real network and yt-dlp, so the local file server can't stand in.
- Picking files and batches (`#selbar`, Download one by one, Download all together), and reordering the queue by drag or Alt with an arrow key.
- Tray menu, Start with Windows, and the updater. The tray and login items are native, and the updater only runs in an installed build.
