from __future__ import annotations

import json
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

from .motion import MotionObservation, render_motion_overlay
from .sources import Frame


class PreviewState:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest_jpeg: bytes | None = None
        self._latest_meta: dict[str, object] = {
            "status": "waiting_for_frames",
            "updated_at": time.time(),
        }

    def update(self, frame: Frame, observation: MotionObservation) -> None:
        preview = render_motion_overlay(frame, observation)
        ok, encoded = cv2.imencode(".jpg", preview, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            return
        with self._lock:
            self._latest_jpeg = encoded.tobytes()
            self._latest_meta = {
                "status": "running",
                **observation.to_dict(),
                "updated_at": time.time(),
            }

    def get_jpeg(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def get_meta(self) -> dict[str, object]:
        with self._lock:
            return dict(self._latest_meta)


class PreviewServer:
    def __init__(self, host: str, port: int, state: PreviewState) -> None:
        self.host = host
        self.port = port
        self.state = state
        self._httpd = ThreadingHTTPServer((host, port), self._build_handler())
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._httpd.shutdown()
        self._httpd.server_close()
        self._thread.join(timeout=2.0)

    def _build_handler(self):
        state = self.state

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                if self.path in {"/", "/index.html"}:
                    self._send_bytes(HTTPStatus.OK, _PREVIEW_HTML, "text/html; charset=utf-8")
                    return
                if self.path == "/status.json":
                    body = json.dumps(state.get_meta(), ensure_ascii=False).encode("utf-8")
                    self._send_bytes(HTTPStatus.OK, body, "application/json; charset=utf-8")
                    return
                if self.path == "/latest.jpg":
                    jpeg = state.get_jpeg()
                    if jpeg is None:
                        self.send_error(HTTPStatus.SERVICE_UNAVAILABLE, "No frame available")
                        return
                    self._send_bytes(HTTPStatus.OK, jpeg, "image/jpeg")
                    return
                if self.path == "/stream.mjpg":
                    self._stream_mjpeg()
                    return
                self.send_error(HTTPStatus.NOT_FOUND, "Not Found")

            def _send_bytes(self, status: int, body: bytes, content_type: str) -> None:
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _stream_mjpeg(self) -> None:
                self.send_response(HTTPStatus.OK)
                self.send_header("Cache-Control", "no-store")
                self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
                self.end_headers()
                try:
                    while True:
                        jpeg = state.get_jpeg()
                        if jpeg is not None:
                            self.wfile.write(b"--frame\r\n")
                            self.wfile.write(b"Content-Type: image/jpeg\r\n")
                            self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii"))
                            self.wfile.write(jpeg)
                            self.wfile.write(b"\r\n")
                        time.sleep(0.2)
                except (BrokenPipeError, ConnectionResetError):
                    return

            def log_message(self, format: str, *args) -> None:
                return

        return Handler


_PREVIEW_HTML = b"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>TAREVIS Vision Preview</title>
  <style>
    body { margin: 16px; background: #111; color: #eee; font-family: Consolas, monospace; }
    img { display: block; max-width: 100%; border: 1px solid #444; }
    pre { padding: 12px; background: #1b1b1b; border: 1px solid #333; overflow: auto; }
  </style>
</head>
<body>
  <h1>TAREVIS Vision Preview</h1>
  <img src="/stream.mjpg" alt="motion preview">
  <pre id="status">loading...</pre>
  <script>
    async function refresh() {
      const response = await fetch('/status.json');
      document.getElementById('status').textContent = JSON.stringify(await response.json(), null, 2);
    }
    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>"""
