"""Strict validation for actual artifacts returned by the Kaggle training notebook."""
from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path
from typing import Any


class ArtifactValidationError(ValueError):
    """Raised when a training artifact is missing or scientifically unusable."""


def _reject_non_finite(value: str) -> None:
    raise ValueError(f"Non-standard non-finite JSON number: {value}")


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"), parse_constant=_reject_non_finite)
    except Exception as exc:
        raise ArtifactValidationError(f"Invalid JSON: {path}") from exc


def _number(value: Any, name: str, minimum: float | None = None, maximum: float | None = None) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ArtifactValidationError(f"{name} must be a finite number.")
    result = float(value)
    if minimum is not None and result < minimum:
        raise ArtifactValidationError(f"{name} is below the allowed minimum.")
    if maximum is not None and result > maximum:
        raise ArtifactValidationError(f"{name} is above the allowed maximum.")
    return result


def _positive_integer(value: Any, name: str, minimum: int = 1) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ArtifactValidationError(f"{name} must be an integer >= {minimum}.")
    return value


def _nonempty_file(path: Path) -> bool:
    return path.is_file() and path.stat().st_size > 0


def validate_artifacts(root: Path) -> dict[str, dict[str, Any]]:
    root = Path(root).resolve()
    if not root.is_dir():
        raise ArtifactValidationError(f"Artifact directory does not exist: {root}")

    required = {
        "sentiment/metrics.json": "sentiment",
        "qwen-lora/metrics.json": "qwen",
    }
    report_paths = sorted(root.rglob("metrics.json"))
    if not report_paths:
        raise ArtifactValidationError("No metrics.json reports found.")
    reports = {path.relative_to(root).as_posix(): _read_json(path) for path in report_paths}

    missing = sorted(set(required) - set(reports))
    if missing:
        raise ArtifactValidationError("Missing required trained-task metrics: " + ", ".join(missing))
    if any(not isinstance(report, dict) for report in reports.values()):
        raise ArtifactValidationError("Each metrics report must contain a JSON object at its root.")

    sentiment = reports["sentiment/metrics.json"]
    sentiment_metrics = sentiment.get("test_metrics")
    if not isinstance(sentiment_metrics, dict):
        raise ArtifactValidationError("Sentiment test_metrics object missing.")
    if "sentiment" not in str(sentiment.get("task", "")).casefold():
        raise ArtifactValidationError("Sentiment report task identity is incorrect.")
    if sentiment.get("model") != "dbmdz/bert-base-turkish-cased":
        raise ArtifactValidationError("Unexpected sentiment base model.")
    for key in ("accuracy", "f1_macro", "f1_weighted"):
        _number(sentiment_metrics.get(key), f"sentiment.test_metrics.{key}", 0, 1)
    for key in ("train_rows", "validation_rows", "test_rows"):
        _positive_integer(sentiment.get(key), f"sentiment.{key}", minimum=30)
    for key in ("train_source_sha256", "test_source_sha256"):
        if not isinstance(sentiment.get(key), str) or not re.fullmatch(r"[0-9a-f]{64}", sentiment[key]):
            raise ArtifactValidationError(f"sentiment.{key} must be a lowercase SHA-256 digest.")

    sentiment_model = root / "sentiment" / "model"
    if not _nonempty_file(sentiment_model / "config.json"):
        raise ArtifactValidationError("Trained sentiment model config is missing or empty.")
    if not any(_nonempty_file(path) for suffix in ("*.safetensors", "*.bin") for path in sentiment_model.glob(suffix)):
        raise ArtifactValidationError("Trained sentiment model weights are missing or empty.")
    if not any(
        _nonempty_file(sentiment_model / name)
        for name in ("tokenizer.json", "tokenizer_config.json")
    ):
        raise ArtifactValidationError("Sentiment tokenizer files are missing or empty.")

    qwen = reports["qwen-lora/metrics.json"]
    if qwen.get("task") != "Turkish instruction SFT with QLoRA":
        raise ArtifactValidationError("Qwen report task identity is incorrect.")
    if qwen.get("base_model") != "Qwen/Qwen3-4B-Instruct-2507":
        raise ArtifactValidationError("Unexpected Qwen base model.")
    for key in ("train_rows_encoded", "validation_rows_encoded", "test_rows_encoded"):
        _positive_integer(qwen.get(key), f"qwen.{key}")
    base_loss = _number(qwen.get("base_model_test_loss"), "qwen.base_model_test_loss", 0)
    tuned_loss = _number(qwen.get("finetuned_model_test_loss"), "qwen.finetuned_model_test_loss", 0)
    _number(qwen.get("validation_loss"), "qwen.validation_loss", 0)
    improvement = _number(qwen.get("test_loss_improvement"), "qwen.test_loss_improvement")
    if not math.isclose(improvement, base_loss - tuned_loss, rel_tol=1e-5, abs_tol=1e-6):
        raise ArtifactValidationError("Qwen test_loss_improvement does not match base minus fine-tuned test loss.")

    adapter_dir = root / "qwen-lora" / "adapter"
    if not _nonempty_file(adapter_dir / "adapter_config.json"):
        raise ArtifactValidationError("Qwen adapter config is missing or empty.")
    if not any(_nonempty_file(path) for suffix in ("adapter_model.safetensors", "adapter_model.bin") for path in adapter_dir.glob(suffix)):
        raise ArtifactValidationError("Qwen adapter weights are missing or empty.")
    if not _nonempty_file(root / "qwen-lora" / "tokenizer" / "tokenizer_config.json"):
        raise ArtifactValidationError("Qwen tokenizer config is missing or empty.")

    # Re-serializing with allow_nan=False guards reports beyond the two mandatory tasks too.
    try:
        json.dumps(reports, ensure_ascii=False, allow_nan=False)
    except (ValueError, TypeError) as exc:
        raise ArtifactValidationError("At least one metrics report has unsupported values.") from exc
    return reports


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact_root", type=Path, help="Unpacked root of the Kaggle output archive")
    parser.add_argument("--summary", type=Path, required=True, help="Path for validated metrics summary JSON")
    args = parser.parse_args()

    reports = validate_artifacts(args.artifact_root)
    args.summary.parent.mkdir(parents=True, exist_ok=True)
    args.summary.write_text(
        json.dumps(reports, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(f"Validated {len(reports)} report(s), both required tasks, finite metrics, SHA-256 provenance, and non-empty model/tokenizer weights.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
