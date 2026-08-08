from __future__ import annotations

import argparse
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path
from pathlib import PurePosixPath

from voice_monitor import BASE_DIR, MODEL_FILES, ConfigurationError, MonitorConfig


MODEL_NAME = "sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01"
MODEL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/"
    f"{MODEL_NAME}.tar.bz2"
)


def extract_archive(archive: Path, destination: Path) -> None:
    """Extract regular files while rejecting archive path/link traversal."""
    with tarfile.open(archive, mode="r:bz2") as tar:
        for member in tar.getmembers():
            member_path = PurePosixPath(member.name)
            if member_path.is_absolute() or ".." in member_path.parts:
                raise ConfigurationError(f"模型压缩包包含不安全路径: {member.name}")
            if member.issym() or member.islnk():
                raise ConfigurationError(f"模型压缩包不允许链接文件: {member.name}")
            tar.extract(member, destination)


def download_model(model_dir: Path) -> None:
    if all((model_dir / filename).is_file() for filename in MODEL_FILES.values()):
        print(f"模型已就绪: {model_dir}")
        return

    model_dir.parent.mkdir(parents=True, exist_ok=True)
    print(f"正在下载中文 KWS 模型: {MODEL_URL}")
    with tempfile.TemporaryDirectory(prefix="voice-monitor-") as temporary_dir:
        temporary_path = Path(temporary_dir)
        archive = temporary_path / f"{MODEL_NAME}.tar.bz2"
        urllib.request.urlretrieve(MODEL_URL, archive, reporthook=show_progress)
        print()
        extract_dir = temporary_path / "extracted"
        extract_dir.mkdir()
        extract_archive(archive, extract_dir)
        extracted_model = extract_dir / MODEL_NAME
        if not extracted_model.is_dir():
            raise ConfigurationError("模型压缩包结构不符合预期")
        shutil.copytree(extracted_model, model_dir, dirs_exist_ok=True)
    print(f"模型下载完成: {model_dir}")


def show_progress(block_count: int, block_size: int, total_size: int) -> None:
    if total_size <= 0:
        return
    percent = min(100, block_count * block_size * 100 // total_size)
    print(f"\r下载进度: {percent:3d}%", end="", flush=True)


def prepare_keywords(config: MonitorConfig) -> None:
    if not config.keywords_raw.is_file():
        raise ConfigurationError(f"原始唤醒词文件不存在: {config.keywords_raw}")

    source_lines = [
        line for line in config.keywords_raw.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith(("//", "#"))
    ]
    if not source_lines:
        raise ConfigurationError("keywords_raw.txt 中没有有效唤醒词")

    phrases: list[str] = []
    extras: list[list[str]] = []
    for line in source_lines:
        phrase_parts: list[str] = []
        extra_parts: list[str] = []
        for part in line.split():
            if part.startswith((":", "#", "@")):
                extra_parts.append(part)
            else:
                phrase_parts.append(part)
        phrase = " ".join(phrase_parts)
        if not phrase or not any(part.startswith("@") for part in extra_parts):
            raise ConfigurationError(f"唤醒词格式无效，必须包含中文短语和 @返回名称: {line}")
        phrases.append(phrase)
        extras.append(extra_parts)

    print("正在生成 sherpa-onnx 唤醒词词元...")
    try:
        import sherpa_onnx

        encoded = sherpa_onnx.text2token(
            phrases,
            tokens=str(config.model_paths["tokens"]),
            tokens_type="ppinyin",
        )
    except ImportError as exc:
        raise ConfigurationError(
            "缺少词元转换依赖，请运行: python -m pip install -r requirements.txt"
        ) from exc
    except (AssertionError, OSError) as exc:
        raise ConfigurationError(f"唤醒词转换失败: {exc}") from exc

    if len(encoded) != len(phrases):
        raise ConfigurationError("部分唤醒词包含模型不支持的读音，请检查上方转换日志")
    output_lines = [" ".join([*tokens, *extra]) for tokens, extra in zip(encoded, extras)]
    config.keywords_file.write_text("\n".join(output_lines) + "\n", encoding="utf-8")
    print(f"唤醒词已生成: {config.keywords_file}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="下载模型并生成中文唤醒词文件")
    parser.add_argument("--config", type=Path, default=BASE_DIR / "config.json")
    parser.add_argument("--skip-download", action="store_true", help="只重新生成唤醒词")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        config = MonitorConfig.load(args.config)
        if not args.skip_download:
            download_model(config.model_dir)
        elif not config.model_paths["tokens"].is_file():
            raise ConfigurationError(f"tokens.txt 不存在: {config.model_paths['tokens']}")
        prepare_keywords(config)
        config.validate_files()
    except (ConfigurationError, OSError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2

    print("准备完成。运行 python voice_monitor.py 开始监听。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
