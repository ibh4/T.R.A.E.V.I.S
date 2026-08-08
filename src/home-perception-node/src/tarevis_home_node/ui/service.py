from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from ..contracts import EventLevel, EventSource, create_event
from ..media_devices import MediaDeviceManager
from ..mocks.scenarios import SCENARIO_NAMES, create_mock_event
from .runtime import UiRuntime
from .workers import AudioSampleWorker, PreviewBuffer, VisionWorker


def create_app(
    runtime: UiRuntime,
    *,
    preview: PreviewBuffer | None = None,
    vision_worker: VisionWorker | None = None,
    audio_worker: AudioSampleWorker | None = None,
    media_manager: MediaDeviceManager | None = None,
    ui_dist_dir: Path | None = None,
    snapshots_dir: Path = Path("data/snapshots"),
) -> FastAPI:
    preview_buffer = preview or PreviewBuffer()
    device_manager = media_manager or MediaDeviceManager()

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        try:
            yield
        finally:
            if vision_worker is not None:
                vision_worker.stop()

    app = FastAPI(title="TAREVIS Home Node UI Service", version="0.1.0", lifespan=lifespan)

    @app.get("/api/health")
    async def health() -> dict[str, object]:
        return {
            "ok": True,
            "service": "tarevis-home-node-ui",
            "schema_version": "1.0",
            "vision_available": vision_worker is not None,
            "audio_available": audio_worker is not None,
        }

    @app.get("/api/state")
    async def state() -> dict[str, object]:
        return runtime.snapshot()

    @app.get("/api/local-devices/media")
    async def media_devices() -> dict[str, object]:
        return device_manager.inventory().to_dict()

    @app.post("/api/local-devices/refresh")
    async def refresh_media_devices() -> dict[str, object]:
        return device_manager.inventory(refresh=True).to_dict()

    @app.post("/api/settings/media")
    async def save_media_settings(values: dict[str, object]) -> dict[str, object]:
        if vision_worker is not None and vision_worker.running:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="请先停止视觉采集")
        if audio_worker is not None and audio_worker.running:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="请等待音频采样结束")
        try:
            return device_manager.save(values).to_dict()
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    @app.post("/api/vision/test")
    async def test_camera(values: dict[str, object] | None = None) -> dict[str, object]:
        stable_id = str(values.get("stable_id")) if values and values.get("stable_id") else None
        result = device_manager.test_camera(stable_id)
        runtime.update_status(
            camera="ready" if result.ok else "offline",
            last_error=None if result.ok else result.message,
        )
        return result.to_dict()

    @app.post("/api/audio/test")
    async def test_microphone(values: dict[str, object] | None = None) -> dict[str, object]:
        stable_id = str(values.get("stable_id")) if values and values.get("stable_id") else None
        try:
            duration_seconds = float(values.get("seconds", 0.6)) if values else 0.6
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="seconds must be numeric") from exc
        result = device_manager.test_microphone(
            stable_id,
            duration_seconds=duration_seconds,
        )
        rms = result.details.get("rms")
        runtime.update_status(
            microphone="ready" if result.ok else "offline",
            audio_level=float(rms) if isinstance(rms, (int, float)) else 0.0,
            last_error=None if result.ok else result.message,
        )
        return result.to_dict()

    @app.post("/api/mock/{scenario_name}")
    async def mock_event(scenario_name: str) -> dict[str, object]:
        if scenario_name == "normal":
            runtime.reset_normal()
            return {"event": None, "snapshot": runtime.snapshot()}
        if scenario_name == "ack":
            event_id = runtime.latest_unresolved_event_id()
            if event_id is None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="no unresolved event")
            event = runtime.acknowledge(event_id)
            return {"event": event.to_dict(), "snapshot": runtime.snapshot()}
        if scenario_name == "person":
            event = create_event(
                device_id=runtime.device_id,
                source=EventSource.VISION,
                event_type="person_detected",
                level=EventLevel.MEDIUM,
                zone="living_room",
                confidence=0.91,
                payload={"mock": True, "summary": "模拟二级目标检测确认人员"},
            )
            runtime.emit(event)
            return {"event": event.to_dict(), "snapshot": runtime.snapshot()}
        if scenario_name not in SCENARIO_NAMES:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="unknown mock scenario")
        event = create_mock_event(scenario_name, device_id=runtime.device_id)
        runtime.emit(event)
        return {"event": event.to_dict(), "snapshot": runtime.snapshot()}

    @app.post("/api/events/{event_id}/ack")
    async def acknowledge_event(event_id: str) -> dict[str, object]:
        try:
            event = runtime.acknowledge(event_id)
        except KeyError as exc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="event not found") from exc
        return {"event": event.to_dict(), "snapshot": runtime.snapshot()}

    @app.post("/api/vision/start", status_code=status.HTTP_202_ACCEPTED)
    async def start_vision() -> dict[str, object]:
        if vision_worker is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="vision source is not configured")
        started = vision_worker.start()
        return {"started": started, "running": vision_worker.running}

    @app.post("/api/vision/stop")
    async def stop_vision() -> dict[str, object]:
        if vision_worker is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="vision source is not configured")
        stopped = vision_worker.stop()
        return {"stopped": stopped, "running": vision_worker.running}

    @app.post("/api/audio/sample", status_code=status.HTTP_202_ACCEPTED)
    async def sample_audio() -> dict[str, object]:
        if audio_worker is None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="audio sampler is not configured")
        started = audio_worker.start()
        if not started:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="audio sample is already running")
        return {"started": True, "running": audio_worker.running}

    @app.get("/media/preview.jpg")
    async def preview_jpeg() -> Response:
        jpeg = preview_buffer.get_jpeg()
        if jpeg is None:
            return JSONResponse(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                content={"detail": "no preview frame available"},
            )
        return Response(content=jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.get("/media/preview.mjpg")
    async def preview_mjpeg() -> StreamingResponse:
        async def frames() -> AsyncIterator[bytes]:
            last_jpeg: bytes | None = None
            last_sent_at = 0.0
            while True:
                jpeg = preview_buffer.get_jpeg()
                now = time.monotonic()
                if jpeg is not None and (jpeg is not last_jpeg or now - last_sent_at >= 1.0):
                    last_jpeg = jpeg
                    last_sent_at = now
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        + f"Content-Length: {len(jpeg)}\r\n\r\n".encode("ascii")
                        + jpeg
                        + b"\r\n"
                    )
                await asyncio.sleep(0.2)

        return StreamingResponse(
            frames(),
            media_type="multipart/x-mixed-replace; boundary=frame",
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/media/snapshots/{filename}")
    async def snapshot_file(filename: str) -> FileResponse:
        root = snapshots_dir.resolve()
        candidate = (root / filename).resolve()
        if not candidate.is_relative_to(root) or not candidate.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="snapshot not found")
        return FileResponse(candidate, media_type="image/jpeg", headers={"Cache-Control": "no-store"})

    @app.websocket("/ws")
    async def event_stream(websocket: WebSocket) -> None:
        await websocket.accept()
        queue = runtime.subscribe()
        receive_task: asyncio.Task[dict[str, object]] | None = None
        queue_task: asyncio.Task[dict[str, object]] | None = None
        try:
            await websocket.send_json({"kind": "snapshot", "snapshot": runtime.snapshot()})
            receive_task = asyncio.create_task(websocket.receive())
            while True:
                queue_task = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait(
                    {receive_task, queue_task},
                    timeout=10.0,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if receive_task in done:
                    client_message = receive_task.result()
                    if client_message["type"] == "websocket.disconnect":
                        break
                    receive_task = asyncio.create_task(websocket.receive())
                if queue_task in done:
                    await websocket.send_json(queue_task.result())
                    queue_task = None
                elif not done:
                    queue_task.cancel()
                    await asyncio.gather(queue_task, return_exceptions=True)
                    queue_task = None
                    await websocket.send_json({"kind": "ping"})
                else:
                    queue_task.cancel()
                    await asyncio.gather(queue_task, return_exceptions=True)
                    queue_task = None
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            pending = [task for task in (receive_task, queue_task) if task is not None and not task.done()]
            for task in pending:
                task.cancel()
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            runtime.unsubscribe(queue)

    resolved_ui_dir = ui_dist_dir.resolve() if ui_dist_dir is not None else None
    if resolved_ui_dir is not None and (resolved_ui_dir / "index.html").is_file():
        app.mount("/", StaticFiles(directory=resolved_ui_dir, html=True), name="ui")
    else:
        @app.get("/")
        async def service_root() -> dict[str, str]:
            return {
                "service": "tarevis-home-node-ui",
                "ui": "not_built",
                "hint": "run npm run build in ui/ or use the Vite dev server",
            }

    return app
