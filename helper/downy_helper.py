"""Downy helper: a small local server that the Chrome extension talks to.

It runs yt-dlp and ffmpeg (both found on PATH) to list formats and download
videos, and serves a download manager page at http://127.0.0.1:9614/.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PORT = int(os.environ.get("DOWNY_PORT", "9614"))
HERE = Path(__file__).resolve().parent
DOWNLOAD_DIR = Path(os.environ.get("DOWNY_DIR", Path.home() / "Downloads" / "Downy"))
CACHE_DIR = Path(tempfile.gettempdir()) / "downy-cache"
CACHE_TTL = 60 * 60  # YouTube stream URLs stay valid for several hours; one hour is safe.
ALLOWED_HOSTS = {f"127.0.0.1:{PORT}", f"localhost:{PORT}"}
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)
YOUTUBE_HOSTS = re.compile(r"(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$", re.I)

CHILD_ENV = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")


def find_tool(name: str) -> str | None:
    return shutil.which(name)


def js_runtime_args() -> list[str]:
    # YouTube needs a JavaScript runtime to solve its player challenges.
    if find_tool("deno"):
        return []
    if find_tool("node"):
        return ["--js-runtimes", "node"]
    return []


def is_youtube_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(YOUTUBE_HOSTS.search(parsed.hostname or ""))


def human_size(n: float | None) -> str:
    if not n:
        return ""
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}"
        n /= 1024
    return ""


def fmt_size(f: dict) -> int:
    return int(f.get("filesize") or f.get("filesize_approx") or 0)


# ---------------------------------------------------------------- format list

class InfoCache:
    """Keeps the yt-dlp info JSON per video so a download can start without
    asking YouTube again."""

    def __init__(self) -> None:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.entries: dict[str, tuple[float, Path, dict]] = {}

    def get(self, url: str) -> tuple[Path, dict]:
        with self.lock:
            hit = self.entries.get(url)
            if hit and time.time() - hit[0] < CACHE_TTL and hit[1].exists():
                return hit[1], hit[2]
        info = self._extract(url)
        path = CACHE_DIR / f"{info['id']}.info.json"
        path.write_text(json.dumps(info), encoding="utf-8")
        with self.lock:
            self.entries[url] = (time.time(), path, info)
        return path, info

    @staticmethod
    def _extract(url: str) -> dict:
        ytdlp = find_tool("yt-dlp")
        if not ytdlp:
            raise RuntimeError("yt-dlp was not found on PATH")
        cmd = [ytdlp, "-J", "--no-playlist", "--no-warnings", *js_runtime_args(), url]
        proc = subprocess.run(
            cmd, capture_output=True, env=CHILD_ENV, creationflags=NO_WINDOW, timeout=120
        )
        if proc.returncode != 0:
            err = proc.stderr.decode("utf-8", "replace").strip().splitlines()
            raise RuntimeError(err[-1] if err else "yt-dlp failed")
        return json.loads(proc.stdout.decode("utf-8", "replace"))


def pick_audio(formats: list[dict]) -> dict | None:
    audio = [
        f for f in formats
        if f.get("vcodec") == "none" and f.get("acodec") not in (None, "none")
        and f.get("ext") == "m4a" and f.get("protocol", "https").startswith("http")
    ]
    if not audio:
        return None

    def key(f: dict):
        note = (f.get("format_note") or "").lower()
        return (
            "drc" not in str(f.get("format_id")),
            "original" in note or "default" in note,
            f.get("language_preference") or 0,
            f.get("abr") or 0,
        )

    return max(audio, key=key)


def pick_video(formats: list[dict], height: int) -> dict | None:
    video = [
        f for f in formats
        if f.get("height") == height and f.get("vcodec") not in (None, "none")
        and f.get("acodec") in (None, "none") and f.get("ext") != "mhtml"
    ]
    if not video:
        return None

    def key(f: dict):
        return (
            (f.get("protocol") or "") == "https",
            str(f.get("vcodec", "")).startswith("avc1"),
            f.get("ext") == "mp4",
            f.get("fps") or 0,
            f.get("tbr") or 0,
        )

    return max(video, key=key)


def build_options(info: dict) -> list[dict]:
    formats = info.get("formats") or []
    audio = pick_audio(formats)
    options: list[dict] = []

    heights = sorted(
        {f["height"] for f in formats
         if f.get("height") and f.get("vcodec") not in (None, "none") and f.get("ext") != "mhtml"},
        reverse=True,
    )
    for h in heights:
        video = pick_video(formats, h)
        if video and audio:
            selector = f"{video['format_id']}+{audio['format_id']}"
            size = fmt_size(video) + fmt_size(audio)
        else:
            # Old videos may only have a combined stream at this height.
            combined = [f for f in formats if f.get("height") == h and f.get("acodec") not in (None, "none")
                        and f.get("vcodec") not in (None, "none")]
            if not combined:
                continue
            video = max(combined, key=lambda f: f.get("tbr") or 0)
            selector = video["format_id"]
            size = fmt_size(video)
        tag = ""
        if h >= 2160:
            tag = " 4K"
        elif h >= 1440:
            tag = " 2K"
        elif h >= 720:
            tag = " HD"
        fps = video.get("fps") or 0
        fps_tag = f" {int(fps)}fps" if fps > 30 else ""
        options.append({
            "id": f"v{h}",
            "kind": "video",
            "label": f"MP4 file, quality {h}p{fps_tag}{tag}",
            "size": size,
            "sizeText": human_size(size),
            "selector": selector,
            "height": h,
        })

    if audio:
        size = fmt_size(audio)
        options.append({
            "id": "m4a", "kind": "audio", "label": "M4A audio only",
            "size": size, "sizeText": human_size(size), "selector": audio["format_id"],
        })
        options.append({
            "id": "mp3", "kind": "mp3", "label": "MP3 audio only",
            "size": size, "sizeText": human_size(size), "selector": audio["format_id"],
        })
    return options


# ------------------------------------------------------------------ downloads

PROGRESS_RE = re.compile(r"^DOWNY\|(?P<done>[^|]*)\|(?P<total>[^|]*)\|(?P<est>[^|]*)\|(?P<speed>[^|]*)\|(?P<eta>[^|]*)\|(?P<fid>.*)$")


def _num(s: str) -> float | None:
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


class Download:
    def __init__(self, url: str, info: dict, option: dict) -> None:
        self.id = uuid.uuid4().hex[:12]
        self.url = url
        self.video_id = info.get("id")
        self.title = info.get("title") or url
        self.thumbnail = info.get("thumbnail")
        self.option = option
        self.label = option["label"]
        self.expected = option.get("size") or 0
        self.status = "queued"  # queued, downloading, merging, converting, done, error, cancelled
        self.error = ""
        self.downloaded = 0.0
        self.speed = 0.0
        self.eta = None
        self.filepath = ""
        self.created = time.time()
        self.finished: float | None = None
        self.proc: subprocess.Popen | None = None
        self._done_parts = 0.0
        self._part_id = None
        self._part_bytes = 0.0
        self._cancel = False

    def public(self) -> dict:
        if self.status == "done":
            progress = 1.0
        elif self.expected:
            progress = min(self.downloaded / self.expected, 0.999)
        else:
            progress = 0.0
        return {
            "id": self.id, "url": self.url, "title": self.title, "thumbnail": self.thumbnail,
            "label": self.label, "status": self.status, "error": self.error,
            "downloaded": self.downloaded, "expected": self.expected, "progress": progress,
            "speed": self.speed, "eta": self.eta, "filepath": self.filepath,
            "filename": Path(self.filepath).name if self.filepath else "",
            "created": self.created, "finished": self.finished,
        }

    def on_progress(self, m: re.Match) -> None:
        fid = m["fid"]
        done = _num(m["done"]) or 0
        if fid != self._part_id:
            self._done_parts += self._part_bytes
            self._part_id = fid
        self._part_bytes = done
        self.downloaded = self._done_parts + done
        self.speed = _num(m["speed"]) or 0
        self.eta = _num(m["eta"])
        if not self.expected:
            total = _num(m["total"]) or _num(m["est"])
            if total:
                self.expected = total


class Manager:
    def __init__(self, cache: InfoCache) -> None:
        self.cache = cache
        self.lock = threading.Lock()
        self.items: dict[str, Download] = {}
        self.history_file = DOWNLOAD_DIR / ".downy-history.json"
        self._load_history()

    def _load_history(self) -> None:
        try:
            rows = json.loads(self.history_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return
        for row in rows[-200:]:
            d = Download.__new__(Download)
            d.__dict__.update({
                "id": row["id"], "url": row["url"], "video_id": row.get("video_id"),
                "title": row["title"], "thumbnail": row.get("thumbnail"),
                "option": {}, "label": row["label"], "expected": row.get("expected", 0),
                "status": row["status"], "error": row.get("error", ""),
                "downloaded": row.get("downloaded", 0), "speed": 0, "eta": None,
                "filepath": row.get("filepath", ""), "created": row.get("created", 0),
                "finished": row.get("finished"), "proc": None, "_cancel": False,
            })
            self.items[d.id] = d

    def _save_history(self) -> None:
        with self.lock:
            rows = [
                {**d.public(), "video_id": d.video_id}
                for d in self.items.values() if d.status in ("done", "error", "cancelled")
            ]
        try:
            DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            self.history_file.write_text(json.dumps(rows), encoding="utf-8")
        except OSError:
            pass

    def list(self) -> list[dict]:
        with self.lock:
            items = sorted(self.items.values(), key=lambda d: d.created, reverse=True)
            return [d.public() for d in items]

    def get(self, did: str) -> Download | None:
        with self.lock:
            return self.items.get(did)

    def start(self, url: str, option_id: str) -> Download:
        info_path, info = self.cache.get(url)
        option = next((o for o in build_options(info) if o["id"] == option_id), None)
        if not option:
            raise ValueError("That format is not available for this video")
        d = Download(url, info, option)
        with self.lock:
            self.items[d.id] = d
        threading.Thread(target=self._run, args=(d, info_path), daemon=True).start()
        return d

    def cancel(self, did: str) -> None:
        d = self.get(did)
        if not d or not d.proc or d.proc.poll() is not None:
            return
        d._cancel = True
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(d.proc.pid)],
                       capture_output=True, creationflags=NO_WINDOW)

    def remove(self, did: str) -> None:
        d = self.get(did)
        if d and d.status in ("done", "error", "cancelled"):
            with self.lock:
                self.items.pop(did, None)
            self._save_history()

    def clear_finished(self) -> None:
        with self.lock:
            for did in [k for k, d in self.items.items() if d.status in ("done", "error", "cancelled")]:
                self.items.pop(did)
        self._save_history()

    def _command(self, d: Download, info_path: Path) -> list[str]:
        ytdlp = find_tool("yt-dlp")
        if not ytdlp:
            raise RuntimeError("yt-dlp was not found on PATH")
        opt = d.option
        if opt["kind"] == "video":
            template = f"%(title)s ({opt['height']}p).%(ext)s"
        else:
            template = "%(title)s.%(ext)s"
        cmd = [
            ytdlp, "--load-info-json", str(info_path),
            "-f", opt["selector"],
            "-P", str(DOWNLOAD_DIR), "-o", template,
            "--newline", "--progress", "--no-mtime", "--no-warnings",
            "--progress-template",
            "download:DOWNY|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|"
            "%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
            "--print", "after_move:DOWNY_FILE|%(filepath)s",
            *js_runtime_args(),
        ]
        if opt["kind"] == "video":
            cmd += ["--merge-output-format", "mp4"]
        elif opt["kind"] == "mp3":
            cmd += ["-x", "--audio-format", "mp3", "--audio-quality", "0"]
        return cmd

    def _run(self, d: Download, info_path: Path) -> None:
        tail: list[str] = []
        try:
            DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
            if not find_tool("ffmpeg") and d.option["kind"] != "audio":
                raise RuntimeError("ffmpeg was not found on PATH")
            d.status = "downloading"
            d.proc = subprocess.Popen(
                self._command(d, info_path), stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                env=CHILD_ENV, creationflags=NO_WINDOW,
            )
            assert d.proc.stdout
            for raw in d.proc.stdout:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                m = PROGRESS_RE.match(line)
                if m:
                    d.on_progress(m)
                    continue
                if line.startswith("DOWNY_FILE|"):
                    d.filepath = line.split("|", 1)[1]
                    continue
                if line.startswith("[Merger]"):
                    d.status = "merging"
                elif line.startswith("[ExtractAudio]"):
                    d.status = "converting"
                tail = (tail + [line])[-8:]
            code = d.proc.wait()
            if d._cancel:
                d.status = "cancelled"
            elif code == 0:
                d.status = "done"
                if d.expected and d.downloaded < d.expected:
                    d.downloaded = d.expected
            else:
                d.status = "error"
                errors = [t for t in tail if t.startswith("ERROR")]
                d.error = (errors or tail or ["yt-dlp failed"])[-1]
        except Exception as exc:  # noqa: BLE001, report anything to the UI
            d.status = "error"
            d.error = str(exc)
        finally:
            d.speed = 0
            d.eta = None
            d.finished = time.time()
            self._save_history()


# ----------------------------------------------------------------- HTTP layer

CACHE = InfoCache()
MANAGER = Manager(CACHE)


def open_in_explorer(path: str, select: bool) -> None:
    if select and path and Path(path).exists():
        subprocess.Popen(["explorer", "/select,", path])
    else:
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
        os.startfile(DOWNLOAD_DIR)  # type: ignore[attr-defined]


class Handler(BaseHTTPRequestHandler):
    server_version = "DownyHelper/1.0"

    def log_message(self, fmt: str, *args) -> None:  # keep the console quiet
        pass

    # Only the extension and the helper's own page may call the API. Checking
    # Host blocks DNS rebinding; checking Origin blocks other websites.
    def _allowed(self) -> bool:
        if self.headers.get("Host") not in ALLOWED_HOSTS:
            return False
        origin = self.headers.get("Origin")
        if origin is None:
            return self.command == "GET"
        return origin.startswith("chrome-extension://") or origin in {f"http://{h}" for h in ALLOWED_HOSTS}

    def _cors(self) -> None:
        origin = self.headers.get("Origin")
        if origin and origin.startswith("chrome-extension://"):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _json(self, data, status: int = 200) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            return {}
        return data if isinstance(data, dict) else {}

    def do_OPTIONS(self) -> None:
        if not self._allowed():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        if not self._allowed():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            body = (HERE / "manager.html").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
        elif path == "/api/status":
            self._json({
                "ok": True, "version": 1, "downloadDir": str(DOWNLOAD_DIR),
                "ytdlp": bool(find_tool("yt-dlp")), "ffmpeg": bool(find_tool("ffmpeg")),
                "jsRuntime": bool(find_tool("deno") or find_tool("node")),
            })
        elif path == "/api/downloads":
            self._json({"downloads": MANAGER.list()})
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if not self._allowed():
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        path = urlparse(self.path).path
        data = self._body()
        try:
            if path == "/api/formats":
                url = str(data.get("url", ""))
                if not is_youtube_url(url):
                    raise ValueError("Only YouTube links are supported")
                _, info = CACHE.get(url)
                options = [{k: o[k] for k in ("id", "kind", "label", "size", "sizeText")}
                           for o in build_options(info)]
                self._json({"title": info.get("title"), "thumbnail": info.get("thumbnail"),
                            "duration": info.get("duration"), "options": options})
            elif path == "/api/download":
                url = str(data.get("url", ""))
                if not is_youtube_url(url):
                    raise ValueError("Only YouTube links are supported")
                d = MANAGER.start(url, str(data.get("option", "")))
                self._json(d.public())
            elif path == "/api/cancel":
                MANAGER.cancel(str(data.get("id", "")))
                self._json({"ok": True})
            elif path == "/api/remove":
                MANAGER.remove(str(data.get("id", "")))
                self._json({"ok": True})
            elif path == "/api/clear":
                MANAGER.clear_finished()
                self._json({"ok": True})
            elif path == "/api/open":
                d = MANAGER.get(str(data.get("id", "")))
                open_in_explorer(d.filepath if d else "", select=bool(data.get("select", True)))
                self._json({"ok": True})
            else:
                self.send_error(HTTPStatus.NOT_FOUND)
        except Exception as exc:  # noqa: BLE001, the extension shows the message
            self._json({"error": str(exc)}, status=400)


def main() -> None:
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Downy helper is already running on port {PORT}.")
        sys.exit(0)
    print(f"Downy helper running at http://{HOST}:{PORT}/  (downloads go to {DOWNLOAD_DIR})")
    for tool in ("yt-dlp", "ffmpeg"):
        if not find_tool(tool):
            print(f"Warning: {tool} was not found on PATH.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
