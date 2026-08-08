from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Sequence, TextIO

from .config import NodeConfig, load_config
from .mocks.scenarios import SCENARIO_NAMES, create_mock_event, list_scenarios
from .transport.sinks import CompositeEventSink, JsonlEventSink, StdoutEventSink


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TAREVIS isolated home perception node")
    parser.add_argument("--config", type=Path, default=None, help="Optional TOML config path.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list-scenarios", help="List available mock scenarios.")
    subparsers.add_parser("show-config", help="Print the resolved node config.")

    mock_parser = subparsers.add_parser("mock-event", help="Emit one structured mock event.")
    mock_parser.add_argument("--scenario", choices=SCENARIO_NAMES, required=True)
    mock_parser.add_argument("--device-id", default=None)
    mock_parser.add_argument("--zone", default=None)
    mock_parser.add_argument(
        "--sink",
        choices=["stdout", "jsonl", "both"],
        default="stdout",
        help="Where to emit the event.",
    )
    mock_parser.add_argument("--events-file", type=Path, default=None)
    mock_parser.add_argument("--pretty", action="store_true")

    vision_parser = subparsers.add_parser(
        "vision-motion",
        help="Run lightweight OpenCV motion detection.",
    )
    vision_parser.add_argument("--source", default="0", help="Camera index, file, or stream URL.")
    vision_parser.add_argument("--device-id", default=None)
    vision_parser.add_argument("--camera-id", default="cam_default")
    vision_parser.add_argument("--zone", default=None)
    vision_parser.add_argument("--roi", default="0,0,1,1")
    vision_parser.add_argument("--width", type=int, default=640)
    vision_parser.add_argument("--height", type=int, default=480)
    vision_parser.add_argument("--target-fps", type=float, default=5.0)
    vision_parser.add_argument("--warmup-frames", type=int, default=20)
    vision_parser.add_argument("--min-area", type=int, default=1500)
    vision_parser.add_argument("--min-score", type=float, default=0.015)
    vision_parser.add_argument("--min-consecutive-frames", type=int, default=3)
    vision_parser.add_argument("--cooldown-seconds", type=float, default=4.0)
    vision_parser.add_argument("--max-frames", type=int, default=None)
    vision_parser.add_argument("--max-events", type=int, default=1)
    vision_parser.add_argument("--snapshots-dir", type=Path, default=Path("data/snapshots"))
    vision_parser.add_argument("--max-snapshot-files", type=int, default=5)
    vision_parser.add_argument("--no-snapshots", action="store_true")
    vision_parser.add_argument("--preview-host", default="127.0.0.1")
    vision_parser.add_argument("--preview-port", type=int, default=0)
    vision_parser.add_argument("--object-model", type=Path, default=None)
    vision_parser.add_argument(
        "--object-labels",
        type=Path,
        default=Path("models/coco80.txt"),
    )
    vision_parser.add_argument("--object-input-size", type=int, default=640)
    vision_parser.add_argument("--object-confidence", type=float, default=0.25)
    vision_parser.add_argument("--object-nms", type=float, default=0.45)
    vision_parser.add_argument("--confirm-label", action="append", default=None)
    vision_parser.add_argument(
        "--sink",
        choices=["stdout", "jsonl", "both"],
        default="stdout",
    )
    vision_parser.add_argument("--events-file", type=Path, default=None)
    vision_parser.add_argument("--pretty", action="store_true")

    subparsers.add_parser("audio-devices", help="List available microphone input devices.")

    audio_probe_parser = subparsers.add_parser(
        "audio-probe",
        help="Record a short in-memory microphone sample and report its input level.",
    )
    audio_probe_parser.add_argument("--seconds", type=float, default=0.6)
    audio_probe_parser.add_argument("--sample-rate", type=int, default=16000)
    audio_probe_parser.add_argument("--channels", type=int, default=1)
    audio_probe_parser.add_argument("--device-index", type=int, default=None)

    audio_file_parser = subparsers.add_parser("audio-file", help="Process one PCM WAV file.")
    audio_file_parser.add_argument("audio_path", type=Path)
    _add_audio_processing_arguments(audio_file_parser)

    audio_record_parser = subparsers.add_parser(
        "audio-record",
        help="Record a fixed-duration PCM WAV and process it.",
    )
    audio_record_parser.add_argument("--seconds", type=float, default=5.0)
    audio_record_parser.add_argument("--sample-rate", type=int, default=16000)
    audio_record_parser.add_argument("--channels", type=int, default=1)
    audio_record_parser.add_argument("--device-index", type=int, default=None)
    audio_record_parser.add_argument(
        "--output",
        type=Path,
        default=Path("recordings/latest.wav"),
    )
    _add_audio_processing_arguments(audio_record_parser)

    benchmark_parser = subparsers.add_parser(
        "object-benchmark",
        help="Benchmark a traditional one-to-many YOLO ONNX model on blank frames.",
    )
    benchmark_parser.add_argument("--model", type=Path, required=True)
    benchmark_parser.add_argument("--labels", type=Path, required=True)
    benchmark_parser.add_argument("--input-size", type=int, default=640)
    benchmark_parser.add_argument("--confidence", type=float, default=0.25)
    benchmark_parser.add_argument("--nms", type=float, default=0.45)
    benchmark_parser.add_argument("--iterations", type=int, default=5)
    benchmark_parser.add_argument("--warmup-iterations", type=int, default=1)
    benchmark_parser.add_argument("--image", type=Path, default=None)
    benchmark_parser.add_argument("--expect-label", action="append", default=None)
    benchmark_parser.add_argument("--reject-label", action="append", default=None)

    manifest_parser = subparsers.add_parser(
        "model-verify",
        help="Verify an object model manifest, hashes, and label count.",
    )
    manifest_parser.add_argument("--manifest", type=Path, required=True)

    doctor_parser = subparsers.add_parser(
        "doctor",
        help="Inspect PC or Raspberry Pi runtime prerequisites.",
    )
    doctor_parser.add_argument(
        "--profile",
        choices=["core", "vision", "audio", "asr", "raspberry-pi-camera", "raspberry-pi"],
        default="core",
    )
    doctor_parser.add_argument("--model", type=Path, default=None)
    doctor_parser.add_argument("--labels", type=Path, default=None)

    ui_parser = subparsers.add_parser(
        "ui-server",
        help="Run the isolated local UI, API, and WebSocket service.",
    )
    ui_parser.add_argument("--host", default="127.0.0.1")
    ui_parser.add_argument("--port", type=int, default=8787)
    ui_parser.add_argument("--ui-dir", type=Path, default=Path("ui/dist"))
    ui_parser.add_argument("--snapshots-dir", type=Path, default=Path("data/snapshots"))
    ui_parser.add_argument("--vision-source", default=None)
    ui_parser.add_argument("--auto-start-vision", action="store_true")
    ui_parser.add_argument("--vision-width", type=int, default=640)
    ui_parser.add_argument("--vision-height", type=int, default=480)
    ui_parser.add_argument("--vision-fps", type=float, default=5.0)
    ui_parser.add_argument("--vision-roi", default="0,0,1,1")
    ui_parser.add_argument("--vision-warmup-frames", type=int, default=20)
    ui_parser.add_argument("--vision-min-area", type=int, default=1500)
    ui_parser.add_argument("--vision-min-score", type=float, default=0.015)
    ui_parser.add_argument("--vision-min-consecutive-frames", type=int, default=3)
    ui_parser.add_argument("--vision-cooldown-seconds", type=float, default=4.0)
    ui_parser.add_argument("--object-model", type=Path, default=None)
    ui_parser.add_argument("--object-labels", type=Path, default=Path("models/coco80.txt"))
    ui_parser.add_argument("--confirm-label", action="append", default=None)
    ui_parser.add_argument("--audio-seconds", type=float, default=5.0)
    ui_parser.add_argument("--audio-device-index", type=int, default=None)
    ui_parser.add_argument("--audio-transcriber", choices=["mock", "funasr"], default="mock")
    ui_parser.add_argument("--audio-mock-text", default="测试语音")
    ui_parser.add_argument("--funasr-model", default="iic/SenseVoiceSmall")
    return parser


def run(argv: Sequence[str] | None = None, *, stdout: TextIO | None = None) -> int:
    output = stdout or sys.stdout
    args = build_parser().parse_args(argv)
    config = load_config(args.config)

    if args.command == "list-scenarios":
        print(json.dumps(list_scenarios(), ensure_ascii=False, indent=2), file=output)
        return 0

    if args.command == "show-config":
        print(json.dumps(config.to_dict(), ensure_ascii=False, indent=2), file=output)
        return 0

    if args.command == "mock-event":
        event = create_mock_event(
            args.scenario,
            device_id=args.device_id or config.device_id,
            zone=args.zone,
        )
        sink = _build_sink(args.sink, args.events_file or config.events_file, output, args.pretty)
        sink.emit(event)
        return 0

    if args.command == "vision-motion":
        return _run_vision_motion(args, config, output)

    if args.command == "audio-devices":
        from .audio import list_input_devices

        print(json.dumps(list_input_devices(), ensure_ascii=False, indent=2), file=output)
        return 0

    if args.command == "audio-probe":
        from .audio import probe_input_device

        report = probe_input_device(
            duration_seconds=args.seconds,
            sample_rate=args.sample_rate,
            channels=args.channels,
            device_index=args.device_index,
        )
        print(json.dumps(report, ensure_ascii=False, indent=2), file=output)
        return 0

    if args.command == "audio-file":
        return _run_audio_file(args.audio_path, args, config, output)

    if args.command == "audio-record":
        from .audio import MicrophoneRecorder

        recorder = MicrophoneRecorder(
            sample_rate=args.sample_rate,
            channels=args.channels,
            device_index=args.device_index,
        )
        clip = recorder.record_fixed(args.seconds, args.output)
        return _run_audio_file(clip.path, args, config, output)

    if args.command == "object-benchmark":
        return _run_object_benchmark(args, output)

    if args.command == "model-verify":
        return _run_model_verify(args.manifest, output)

    if args.command == "doctor":
        return _run_doctor(args, output)

    if args.command == "ui-server":
        return _run_ui_server(args, config)

    raise ValueError(f"unsupported command: {args.command}")


def _build_sink(
    name: str,
    events_file: Path,
    output: TextIO,
    pretty: bool,
) -> StdoutEventSink | JsonlEventSink | CompositeEventSink:
    stdout_sink = StdoutEventSink(stream=output, pretty=pretty)
    jsonl_sink = JsonlEventSink(events_file)
    if name == "stdout":
        return stdout_sink
    if name == "jsonl":
        return jsonl_sink
    return CompositeEventSink([stdout_sink, jsonl_sink])


def _run_vision_motion(args: argparse.Namespace, config: NodeConfig, output: TextIO) -> int:
    from .vision import (
        MotionDetectorConfig,
        OpenCvYoloV8Detector,
        VisionMotionMonitor,
        VisionMonitorConfig,
        YoloV8Config,
        create_video_source,
        load_labels,
        parse_roi,
    )
    from .vision.preview import PreviewServer, PreviewState

    source = create_video_source(args.source, width=args.width, height=args.height)
    object_detector = (
        OpenCvYoloV8Detector(
            YoloV8Config(
                model_path=args.object_model,
                labels=load_labels(args.object_labels),
                input_width=args.object_input_size,
                input_height=args.object_input_size,
                confidence_threshold=args.object_confidence,
                nms_threshold=args.object_nms,
            )
        )
        if args.object_model is not None
        else None
    )
    monitor = VisionMotionMonitor(
        source=source,
        monitor_config=VisionMonitorConfig(
            device_id=args.device_id or config.device_id,
            camera_id=args.camera_id,
            zone=args.zone or config.default_zone,
            width=args.width,
            height=args.height,
            target_fps=None if args.target_fps <= 0 else args.target_fps,
            max_frames=args.max_frames,
            snapshots_enabled=not args.no_snapshots,
            snapshots_dir=args.snapshots_dir,
            max_snapshot_files=args.max_snapshot_files,
        ),
        detector_config=MotionDetectorConfig(
            roi=parse_roi(args.roi),
            warmup_frames=args.warmup_frames,
            min_area=args.min_area,
            min_score=args.min_score,
            min_consecutive_frames=args.min_consecutive_frames,
            cooldown_seconds=args.cooldown_seconds,
        ),
        object_detector=object_detector,
        confirmation_labels=frozenset(args.confirm_label or ["person"]),
    )
    sink = _build_sink(args.sink, args.events_file or config.events_file, output, args.pretty)
    preview_state = PreviewState() if args.preview_port > 0 else None
    preview_server = (
        PreviewServer(args.preview_host, args.preview_port, preview_state)
        if preview_state is not None
        else None
    )
    trigger_count = 0
    if preview_server is not None:
        preview_server.start()
    try:
        for event_batch in monitor.iter_event_batches(
            observer=preview_state.update if preview_state else None
        ):
            for event in event_batch:
                sink.emit(event)
            trigger_count += 1
            if args.max_events > 0 and trigger_count >= args.max_events:
                break
    finally:
        source.close()
        if preview_server is not None:
            preview_server.stop()
    return 0


def _run_object_benchmark(args: argparse.Namespace, output: TextIO) -> int:
    from .vision import (
        OpenCvYoloV8Detector,
        YoloV8Config,
        benchmark_detector,
        load_labels,
    )

    detector = OpenCvYoloV8Detector(
        YoloV8Config(
            model_path=args.model,
            labels=load_labels(args.labels),
            input_width=args.input_size,
            input_height=args.input_size,
            confidence_threshold=args.confidence,
            nms_threshold=args.nms,
        )
    )
    frame = None
    if args.image is not None:
        import cv2

        frame = cv2.imread(str(args.image))
        if frame is None:
            raise ValueError(f"unable to read benchmark image: {args.image}")
    result = benchmark_detector(
        detector,
        iterations=args.iterations,
        warmup_iterations=args.warmup_iterations,
        frame=frame,
    )
    detected_labels = {
        str(item["label"])
        for item in result["detections"]
        if isinstance(item, dict) and "label" in item
    }
    expectations = [
        {"label": label, "mode": "present", "passed": label in detected_labels}
        for label in (args.expect_label or [])
    ] + [
        {"label": label, "mode": "absent", "passed": label not in detected_labels}
        for label in (args.reject_label or [])
    ]
    result["image"] = str(args.image.resolve()) if args.image is not None else None
    result["expectations"] = expectations
    result["passed"] = all(bool(item["passed"]) for item in expectations)
    print(json.dumps(result, ensure_ascii=False, indent=2), file=output)
    return 0 if result["passed"] else 1


def _run_model_verify(manifest_path: Path, output: TextIO) -> int:
    from .vision import ObjectModelManifest

    manifest = ObjectModelManifest.load(manifest_path)
    report = manifest.verify(manifest_path)
    print(json.dumps(report, ensure_ascii=False, indent=2), file=output)
    return 0 if report["ready"] else 1


def _run_doctor(args: argparse.Namespace, output: TextIO) -> int:
    from .doctor import run_doctor

    report = run_doctor(
        profile=args.profile,
        model_path=args.model,
        labels_path=args.labels,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), file=output)
    return 0 if report["ready"] else 1


def _add_audio_processing_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--device-id", default=None)
    parser.add_argument("--zone", default=None)
    parser.add_argument("--min-duration", type=float, default=0.35)
    parser.add_argument("--min-rms", type=float, default=0.003)
    parser.add_argument("--transcriber", choices=["mock", "funasr"], default="mock")
    parser.add_argument("--mock-text", default="测试语音")
    parser.add_argument("--funasr-model", default="iic/SenseVoiceSmall")
    parser.add_argument("--vad-model", default="fsmn-vad")
    parser.add_argument("--language", default="auto")
    parser.add_argument("--device-target", default="cpu")
    parser.add_argument(
        "--sink",
        choices=["stdout", "jsonl", "both"],
        default="stdout",
    )
    parser.add_argument("--events-file", type=Path, default=None)
    parser.add_argument("--pretty", action="store_true")


def _run_ui_server(args: argparse.Namespace, config: NodeConfig) -> int:
    import uvicorn

    from .contracts import EventLevel, EventSource, create_event
    from .media_devices import MediaDeviceManager
    from .ui.runtime import UiRuntime
    from .ui.service import create_app
    from .ui.workers import (
        AudioSampleWorker,
        AudioWorkerConfig,
        PreviewBuffer,
        VisionWorker,
        VisionWorkerConfig,
    )

    media_manager = MediaDeviceManager(config.media_settings_file)
    selected_camera_source = args.vision_source or media_manager.resolve_camera_source()
    selected_microphone_index = (
        args.audio_device_index
        if args.audio_device_index is not None
        else media_manager.resolve_microphone_index()
    )
    if args.auto_start_vision and selected_camera_source is None:
        raise ValueError("--auto-start-vision requires --vision-source or a saved camera selection")

    vision_roi = None
    if selected_camera_source is not None:
        from .vision import parse_roi

        vision_roi = parse_roi(args.vision_roi)

    runtime = UiRuntime(config.device_id)
    preview = PreviewBuffer()
    vision_worker = (
        VisionWorker(
            runtime,
            preview,
            VisionWorkerConfig(
                source=selected_camera_source,
                device_id=config.device_id,
                zone=config.default_zone,
                width=args.vision_width,
                height=args.vision_height,
                target_fps=None if args.vision_fps <= 0 else args.vision_fps,
                snapshots_dir=args.snapshots_dir,
                roi=vision_roi or (0.0, 0.0, 1.0, 1.0),
                warmup_frames=args.vision_warmup_frames,
                min_area=args.vision_min_area,
                min_score=args.vision_min_score,
                min_consecutive_frames=args.vision_min_consecutive_frames,
                cooldown_seconds=args.vision_cooldown_seconds,
                object_model=args.object_model,
                object_labels=args.object_labels,
                confirmation_labels=frozenset(args.confirm_label or ["person"]),
            ),
        )
        if selected_camera_source is not None
        else None
    )
    audio_worker = AudioSampleWorker(
        runtime,
        AudioWorkerConfig(
            device_id=config.device_id,
            zone=config.default_zone,
            seconds=args.audio_seconds,
            device_index=selected_microphone_index,
            transcriber=args.audio_transcriber,
            mock_text=args.audio_mock_text,
            funasr_model=args.funasr_model,
        ),
    )
    runtime.emit(
        create_event(
            device_id=config.device_id,
            source=EventSource.SYSTEM,
            event_type="node_ready",
            level=EventLevel.INFO,
            zone=config.default_zone,
            payload={"summary": "家庭感知本地服务已就绪"},
        ),
        resolved=True,
    )
    app = create_app(
        runtime,
        preview=preview,
        vision_worker=vision_worker,
        audio_worker=audio_worker,
        media_manager=media_manager,
        ui_dist_dir=args.ui_dir,
        snapshots_dir=args.snapshots_dir,
    )
    if vision_worker is not None and args.auto_start_vision:
        vision_worker.start()
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
    return 0


def _run_audio_file(
    audio_path: Path,
    args: argparse.Namespace,
    config: NodeConfig,
    output: TextIO,
) -> int:
    from .audio import (
        AudioEventPipeline,
        AudioPipelineConfig,
        FunAsrTranscriber,
        MockTranscriber,
    )

    transcriber = (
        MockTranscriber(args.mock_text)
        if args.transcriber == "mock"
        else FunAsrTranscriber(
            model_name=args.funasr_model,
            vad_model=args.vad_model,
            language=args.language,
            device=args.device_target,
        )
    )
    pipeline = AudioEventPipeline(
        transcriber,
        AudioPipelineConfig(
            device_id=args.device_id or config.device_id,
            zone=args.zone or config.default_zone,
            min_duration_seconds=args.min_duration,
            min_rms=args.min_rms,
        ),
    )
    sink = _build_sink(args.sink, args.events_file or config.events_file, output, args.pretty)
    for event in pipeline.process_wav(audio_path):
        sink.emit(event)
    return 0


def main() -> int:
    try:
        return run()
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
