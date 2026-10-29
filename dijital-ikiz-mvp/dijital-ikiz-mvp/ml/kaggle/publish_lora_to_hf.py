#!/usr/bin/env python3
"""Validate a successful Kaggle artifact and publish only its Qwen LoRA adapter."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import shutil
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from typing import Any

EXPECTED_BASE_MODEL = "Qwen/Qwen3-4B-Instruct-2507"
MAX_UNCOMPRESSED_BYTES = 8 * 1024**3
MAX_FILES = 20_000


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Invalid JSON artifact: {path.name}") from exc
    require(isinstance(value, dict), f"Expected a JSON object: {path.name}")
    return value


def safe_extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    root = destination.resolve()

    try:
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            require(0 < len(members) <= MAX_FILES, "Artifact ZIP has an invalid file count.")
            require(sum(item.file_size for item in members) <= MAX_UNCOMPRESSED_BYTES,
                    "Artifact ZIP exceeds the extraction limit.")

            for item in members:
                posix_name = PurePosixPath(item.filename)
                require(not posix_name.is_absolute() and ".." not in posix_name.parts,
                        "Artifact ZIP contains an unsafe path.")
                target = (root / Path(*posix_name.parts)).resolve()
                require(target == root or root in target.parents,
                        "Artifact ZIP path escaped extraction directory.")
                unix_mode = (item.external_attr >> 16) & 0o170000
                require(unix_mode != 0o120000, "Artifact ZIP symlinks are not allowed.")
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(item, "r") as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
    except (OSError, zipfile.BadZipFile, RuntimeError) as exc:
        raise SystemExit("Model artifact ZIP could not be safely extracted.") from exc


def copy_file(source: Path, destination: Path) -> None:
    require(source.is_file() and source.stat().st_size > 0,
            f"Required model file is empty: {source.name}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", required=True, type=Path)
    parser.add_argument("--repo-id", required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    repo_id = args.repo_id.strip()
    parts = repo_id.split("/")
    require(
        len(parts) == 2 and all(part and all(c.isalnum() or c in "-_." for c in part) for part in parts),
        "HF model repository must be in OWNER/REPO form.",
    )
    token = os.environ.get("HF_WRITE_TOKEN", "").strip()
    require(len(token) >= 20, "HF_WRITE_TOKEN is missing or too short.")
    require(args.run_id.isdigit(), "Kaggle workflow run ID must be numeric.")
    require(args.artifact_dir.is_dir(), "Downloaded Kaggle artifact directory is missing.")

    archives = list(args.artifact_dir.rglob("dijital-ikiz-model-artifacts.zip"))
    require(len(archives) == 1, "Expected exactly one dijital-ikiz-model-artifacts.zip artifact.")

    with tempfile.TemporaryDirectory(prefix="qwen-lora-publish-") as temp:
        temp_root = Path(temp)
        extracted = temp_root / "extracted"
        safe_extract(archives[0], extracted)

        qwen_metrics = [
            path for path in extracted.rglob("metrics.json")
            if path.parent.name == "qwen-lora"
        ]
        require(len(qwen_metrics) == 1, "Expected qwen-lora/metrics.json exactly once.")
        qwen_metrics_path = qwen_metrics[0]
        qwen_root = qwen_metrics_path.parent
        adapter = qwen_root / "adapter"
        tokenizer = qwen_root / "tokenizer"
        config_path = adapter / "adapter_config.json"
        require(config_path.is_file(), "adapter_config.json is missing.")
        adapter_config = read_json(config_path)
        require(adapter_config.get("base_model_name_or_path") == EXPECTED_BASE_MODEL,
                "LoRA adapter targets an unexpected base model.")

        weights = [
            path for path in (adapter / "adapter_model.safetensors", adapter / "adapter_model.bin")
            if path.is_file() and path.stat().st_size > 0
        ]
        require(len(weights) == 1, "Expected one non-empty adapter_model.safetensors or adapter_model.bin.")

        require(tokenizer.is_dir(), "Tokenizer directory is missing.")
        require((tokenizer / "tokenizer_config.json").is_file(), "tokenizer_config.json is missing.")
        require(any((tokenizer / name).is_file() for name in
                    ("tokenizer.json", "tokenizer.model", "vocab.json")),
                "Tokenizer vocabulary file is missing.")

        metrics = read_json(qwen_metrics_path)
        require(metrics.get("base_model") == EXPECTED_BASE_MODEL,
                "Training metrics base model is unexpected.")
        for key in ("base_model_test_loss", "finetuned_model_test_loss", "validation_loss"):
            value = metrics.get(key)
            require(isinstance(value, (int, float)) and math.isfinite(value) and value >= 0,
                    f"Training metric {key} is missing or invalid.")
        require(metrics["finetuned_model_test_loss"] < metrics["base_model_test_loss"],
                "Publication blocked: evaluated fine-tuned test loss did not improve.")
        for key in ("train_rows_encoded", "validation_rows_encoded", "test_rows_encoded"):
            require(isinstance(metrics.get(key), int) and metrics[key] > 0,
                    f"Invalid row count: {key}.")

        release = temp_root / "release"
        release.mkdir()
        for source in adapter.iterdir():
            if source.is_file():
                copy_file(source, release / source.name)
        for source in tokenizer.iterdir():
            if source.is_file():
                copy_file(source, release / source.name)
        copy_file(qwen_metrics_path, release / "training-metrics.json")

        manifest = {}
        for path in sorted(release.iterdir()):
            if path.is_file():
                manifest[path.name] = {"bytes": path.stat().st_size, "sha256": sha256(path)}
        (release / "artifact-manifest.json").write_text(
            json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )

        readme = f"""---
base_model: {EXPECTED_BASE_MODEL}
library_name: peft
pipeline_tag: text-generation
tags:
  - turkish
  - qwen3
  - lora
  - kaggle
---

# Dijital İkiz İnsan — Qwen3-4B LoRA pilot

This private repository contains a LoRA adapter, not a standalone full model.

- Base model: {EXPECTED_BASE_MODEL}
- Kaggle workflow run: {args.run_id}
- Encoded train / validation / test rows: {metrics['train_rows_encoded']} / {metrics['validation_rows_encoded']} / {metrics['test_rows_encoded']}
- Base-model test loss: {metrics['base_model_test_loss']}
- Fine-tuned test loss: {metrics['finetuned_model_test_loss']}

The training set is general Turkish instruction data. This adapter is not a validated emotion/VAD/Big Five model, is not a person-specific identity replica, and has not established chat quality by test loss alone. Review the base model and dataset terms before redistribution.

Use the compatible base model and PEFT to load this adapter. The repository is intended to remain private until its licensing and research-release review is complete.
"""
        (release / "README.md").write_text(readme, encoding="utf-8")

        try:
            from huggingface_hub import HfApi
        except ImportError as exc:
            raise SystemExit("huggingface_hub is not installed in the publication environment.") from exc

        api = HfApi(token=token)
        try:
            api.create_repo(repo_id=repo_id, repo_type="model", private=True, exist_ok=True)
            before = api.repo_info(repo_id=repo_id, repo_type="model")
            require(bool(before.private), "Refusing to publish into a public Hugging Face repository.")
            api.upload_folder(
                repo_id=repo_id,
                repo_type="model",
                folder_path=str(release),
                commit_message=f"Publish validated Kaggle Qwen LoRA run {args.run_id}",
            )
            after = api.repo_info(repo_id=repo_id, repo_type="model")
            require(bool(after.private), "Hugging Face repository privacy verification failed after upload.")
            published_files = set(api.list_repo_files(repo_id=repo_id, repo_type="model"))
        except SystemExit:
            raise
        except Exception as exc:
            raise SystemExit(
                f"Hugging Face publication failed ({type(exc).__name__}); check token scope, ownership, and repository access."
            ) from exc

        required_remote = {
            "adapter_config.json",
            weights[0].name,
            "tokenizer_config.json",
            "training-metrics.json",
            "artifact-manifest.json",
            "README.md",
        }
        require(required_remote.issubset(published_files),
                "Uploaded repository is missing required adapter files.")

        print(json.dumps({
            "result": "published_private",
            "repository": repo_id,
            "url": f"https://huggingface.co/{repo_id}",
            "run_id": args.run_id,
            "base_model": EXPECTED_BASE_MODEL,
            "uploaded_files": sorted(required_remote),
            "adapter_weight_bytes": weights[0].stat().st_size,
            "private_verified": True,
            "secrets_included": False,
        }, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
