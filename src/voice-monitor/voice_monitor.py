from __future__ import annotations

import argparse
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterator


BASE_DIR = Path(__file__).resolve().parent
MODEL_FILES = {
    "tokens": "tokens.txt",
    "encoder": "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
    "decoder": "decoder-epoch-12-avg-2-chunk-16-left-64.onnx",
    "joiner": "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx",
}


class ConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class MonitorConfig:
    config_path: Path
    model_dir: Path
    keywords_raw: Path
    keywords_file: Path
    sample_rate: int
    block_duration_seconds: float
    device: int | str | None
    num_threads: int
    max_active_paths: int
    num_trailing_blanks: int
    keywords_score: float
    keywords_threshold: float
    provider: str
    cooldown_seconds: float

    @classmethod
    def load(cls, path: Path) -> "MonitorConfig":
        config_path = path.expanduser().resolve()
        try:
            data = json.loads(config_path.read_text(encoding="utf-8"))
        except FileNotFoundError as exc:
            raise ConfigurationError(f"配置文件不存在: {config_path}") from exc
        except json.JSONDecodeError as exc:
            raise ConfigurationError(f"配置文件不是有效 JSON: {exc}") from exc

        root = config_path.parent
        audio = data.get("audio", {})
        kws = data.get("kws", {})

        def resolve(value: str) -> Path:
            candidate = Path(value).expanduser()
            return candidate.resolve() if candidate.is_absolute() else (root / candidate).resolve()

        try:
            config = cls(
                config_path=config_path,
                model_dir=resolve(data["model_dir"]),
                keywords_raw=resolve(data["keywords_raw"]),
                keywords_file=resolve(data["keywords_file"]),
                sample_rate=int(audio.get("sample_rate", 16000)),
                block_duration_seconds=float(audio.get("block_duration_seconds", 0.1)),
                device=audio.get("device"),
                num_threads=int(kws.get("num_threads", 2)),
                max_active_paths=int(kws.get("max_active_paths", 4)),
                num_trailing_blanks=int(kws.get("num_trailing_blanks", 1)),
                keywords_score=float(kws.get("keywords_score", 1.0)),
                keywords_threshold=float(kws.get("keywords_threshold", 0.25)),
                provider=str(kws.get("provider", "cpu")),
                cooldown_seconds=float(data.get("cooldown_seconds", 1.5)),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ConfigurationError(f"配置字段无效: {exc}") from exc

        if config.sample_rate <= 0 or config.block_duration_seconds <= 0:
            raise ConfigurationError("采样率和音频块时长必须大于 0")
        if not 0 <= config.keywords_threshold <= 1:
            raise ConfigurationError("keywords_threshold 必须在 0 到 1 之间")
        if config.cooldown_seconds < 0:
            raise ConfigurationError("cooldown_seconds 不能小于 0")
        return config

    @property
    def model_paths(self) -> dict[str, Path]:
        return {name: self.model_dir / filename for name, filename in MODEL_FILES.items()}

    def validate_files(self) -> None:
        missing = [path for path in (*self.model_paths.values(), self.keywords_file) if not path.is_file()]
        if not missing:
            return
        formatted = "\n".join(f"  - {path}" for path in missing)
        raise ConfigurationError(
            f"缺少 KWS 运行文件:\n{formatted}\n"
            "请先运行: python setup.py"
        )


def create_keyword_spotter(config: MonitorConfig) -> Any:
    try:
        import sherpa_onnx
    except ImportError as exc:
        raise ConfigurationError(
            "未安装 sherpa-onnx，请运行: python -m pip install -r requirements.txt"
        ) from exc

    config.validate_files()
    paths = config.model_paths
    return sherpa_onnx.KeywordSpotter(
        tokens=str(paths["tokens"]),
        encoder=str(paths["encoder"]),
        decoder=str(paths["decoder"]),
        joiner=str(paths["joiner"]),
        num_threads=config.num_threads,
        max_active_paths=config.max_active_paths,
        keywords_file=str(config.keywords_file),
        keywords_score=config.keywords_score,
        keywords_threshold=config.keywords_threshold,
        num_trailing_blanks=config.num_trailing_blanks,
        provider=config.provider,
    )


def iter_detected_keywords(
    keyword_spotter: Any,
    audio_blocks: Iterator[Any],
    sample_rate: int,
    cooldown_seconds: float,
    clock: Callable[[], float] = time.monotonic,
    on_result: Callable[[str], None] | None = None,
) -> Iterator[str]:
    stream = keyword_spotter.create_stream()
    last_detection_at = float("-inf")

    for samples in audio_blocks:
        stream.accept_waveform(sample_rate, samples.reshape(-1))
        while keyword_spotter.is_ready(stream):
            keyword_spotter.decode_stream(stream)
            keyword = keyword_spotter.get_result(stream)
            if on_result is not None:
                on_result(keyword)
            if not keyword:
                continue

            # A detected stream must be reset immediately according to sherpa-onnx's API.
            keyword_spotter.reset_stream(stream)
            now = clock()
            if now - last_detection_at >= cooldown_seconds:
                last_detection_at = now
                yield keyword


def microphone_blocks(config: MonitorConfig) -> Iterator[Any]:
    try:
        import sounddevice as sd
    except ImportError as exc:
        raise ConfigurationError(
            "未安装 sounddevice，请运行: python -m pip install -r requirements.txt"
        ) from exc

    frames = round(config.sample_rate * config.block_duration_seconds)
    try:
        with sd.InputStream(
            channels=1,
            dtype="float32",
            samplerate=config.sample_rate,
            device=config.device,
        ) as stream:
            while True:
                samples, overflowed = stream.read(frames)
                if overflowed:
                    print("警告: 麦克风输入溢出，本次音频可能不完整", file=sys.stderr)
                yield samples
    except Exception as exc:
        raise ConfigurationError(f"无法打开麦克风: {exc}") from exc


def list_devices() -> int:
    try:
        import sounddevice as sd
    except ImportError:
        print("未安装 sounddevice，请先安装 requirements.txt", file=sys.stderr)
        return 2

    devices = sd.query_devices()
    found = False
    for index, device in enumerate(devices):
        if device["max_input_channels"] > 0:
            marker = "*" if index == sd.default.device[0] else " "
            print(f"{marker} {index}: {device['name']}")
            found = True
    if not found:
        print("没有找到麦克风输入设备", file=sys.stderr)
        return 1
    return 0


def emit_detection(keyword: str) -> None:
    event = {
        "type": "wake_word",
        "keyword": keyword,
        "detected_at": datetime.now(timezone.utc).isoformat(),
    }
    print(json.dumps(event, ensure_ascii=False), flush=True)


def emit_verbose_result(keyword: str) -> None:
    """Print every KWS decode result without polluting the JSON event stream."""
    value = keyword or "<未命中>"
    print(f"[KWS] {value}", file=sys.stderr, flush=True)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="基于 sherpa-onnx 的中文唤醒词监听器")
    parser.add_argument(
        "--config",
        type=Path,
        default=BASE_DIR / "config.json",
        help="配置文件路径",
    )
    parser.add_argument("--list-devices", action="store_true", help="列出麦克风输入设备后退出")
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="持续打印每次 KWS 解码结果；未命中显示 <未命中>",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.list_devices:
        return list_devices()

    try:
        config = MonitorConfig.load(args.config)
        spotter = create_keyword_spotter(config)
        device_label = "系统默认麦克风" if config.device is None else str(config.device)
        print(f"正在监听 {device_label}，按 Ctrl+C 停止。", file=sys.stderr)
        for keyword in iter_detected_keywords(
            keyword_spotter=spotter,
            audio_blocks=microphone_blocks(config),
            sample_rate=config.sample_rate,
            cooldown_seconds=config.cooldown_seconds,
            on_result=emit_verbose_result if args.verbose else None,
        ):
            emit_detection(keyword)
    except ConfigurationError as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("\n监听已停止。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
