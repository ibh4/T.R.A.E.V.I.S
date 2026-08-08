from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .object_detector import load_labels, sha256_file

MANIFEST_SCHEMA_VERSION = "1.0"
_SHA256_PATTERN = re.compile(r"^[A-Fa-f0-9]{64}$")


@dataclass(frozen=True, slots=True)
class ObjectModelManifest:
    model_id: str
    version: str
    source_url: str
    license: str
    model_file: str
    model_sha256: str
    labels_file: str
    labels_sha256: str
    input_width: int
    input_height: int
    class_count: int
    task: str = "object_detection"
    format: str = "onnx"
    schema_version: str = MANIFEST_SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != MANIFEST_SCHEMA_VERSION:
            raise ValueError(f"unsupported model manifest schema: {self.schema_version}")
        if not self.model_id or not self.version:
            raise ValueError("model_id and version are required")
        if not self.source_url.startswith(("https://", "http://")):
            raise ValueError("source_url must use HTTP or HTTPS")
        if not self.license.strip():
            raise ValueError("license is required")
        if Path(self.model_file).name != self.model_file:
            raise ValueError("model_file must be a filename relative to the manifest")
        if Path(self.labels_file).name != self.labels_file:
            raise ValueError("labels_file must be a filename relative to the manifest")
        if not _SHA256_PATTERN.fullmatch(self.model_sha256):
            raise ValueError("model_sha256 must contain 64 hexadecimal characters")
        if not _SHA256_PATTERN.fullmatch(self.labels_sha256):
            raise ValueError("labels_sha256 must contain 64 hexadecimal characters")
        if self.input_width < 1 or self.input_height < 1 or self.class_count < 1:
            raise ValueError("input dimensions and class_count must be positive")
        if self.format.lower() != "onnx":
            raise ValueError("only ONNX object models are supported")

    @classmethod
    def load(cls, path: Path) -> "ObjectModelManifest":
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"unable to read model manifest: {path}") from exc
        if not isinstance(data, dict):
            raise ValueError("model manifest must be a JSON object")
        required = {
            "schema_version",
            "model_id",
            "version",
            "source_url",
            "license",
            "model_file",
            "model_sha256",
            "labels_file",
            "labels_sha256",
            "input_width",
            "input_height",
            "class_count",
        }
        missing = sorted(required.difference(data))
        if missing:
            raise ValueError(f"missing model manifest fields: {', '.join(missing)}")
        return cls(
            schema_version=str(data["schema_version"]),
            model_id=str(data["model_id"]),
            version=str(data["version"]),
            source_url=str(data["source_url"]),
            license=str(data["license"]),
            model_file=str(data["model_file"]),
            model_sha256=str(data["model_sha256"]).upper(),
            labels_file=str(data["labels_file"]),
            labels_sha256=str(data["labels_sha256"]).upper(),
            input_width=_integer(data["input_width"], "input_width"),
            input_height=_integer(data["input_height"], "input_height"),
            class_count=_integer(data["class_count"], "class_count"),
            task=str(data.get("task", "object_detection")),
            format=str(data.get("format", "onnx")),
        )

    def verify(self, manifest_path: Path) -> dict[str, Any]:
        root = manifest_path.resolve().parent
        model_path = root / self.model_file
        labels_path = root / self.labels_file
        checks: list[dict[str, Any]] = []
        checks.append(_file_hash_check("model_sha256", model_path, self.model_sha256))
        checks.append(_file_hash_check("labels_sha256", labels_path, self.labels_sha256))
        try:
            labels = load_labels(labels_path)
            label_count = len(labels)
            checks.append(
                {
                    "name": "class_count",
                    "ok": label_count == self.class_count,
                    "expected": self.class_count,
                    "actual": label_count,
                }
            )
        except (OSError, ValueError) as exc:
            checks.append({"name": "class_count", "ok": False, "detail": str(exc)})
        ready = all(bool(check["ok"]) for check in checks)
        return {
            "ready": ready,
            "manifest_schema": self.schema_version,
            "model_id": self.model_id,
            "version": self.version,
            "source_url": self.source_url,
            "license": self.license,
            "task": self.task,
            "format": self.format,
            "input_size": {"width": self.input_width, "height": self.input_height},
            "checks": checks,
        }


def _file_hash_check(name: str, path: Path, expected: str) -> dict[str, Any]:
    if not path.is_file():
        return {"name": name, "ok": False, "expected": expected, "detail": f"missing file: {path}"}
    actual = sha256_file(path)
    return {
        "name": name,
        "ok": actual == expected,
        "expected": expected,
        "actual": actual,
        "path": str(path),
    }


def _integer(value: Any, field_name: str) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be an integer")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field_name} must be an integer") from exc
