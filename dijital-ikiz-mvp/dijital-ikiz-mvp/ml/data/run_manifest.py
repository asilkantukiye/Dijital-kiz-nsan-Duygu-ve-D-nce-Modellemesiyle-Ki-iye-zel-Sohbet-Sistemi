from __future__ import annotations

import hashlib
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any


def sha256_file(path: str | Path, chunk_size: int = 1024 * 1024) -> str:
    """Return a streaming SHA-256 digest for the exact file bytes."""
    if chunk_size < 1:
        raise ValueError("chunk_size pozitif bir tam sayı olmalı.")

    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(chunk_size), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_split_manifest(
    path: str | Path,
    rows: Iterable[Mapping[str, Any]],
    labels: Iterable[str],
) -> dict[str, Any]:
    """Describe a validated split without exposing text or participant IDs.

    The source filename is reduced to its basename so local directory paths
    cannot leak into the research report. Provenance values are counted, not
    copied into the report; the exact source file is bound by its SHA-256 hash.
    This is a reproducibility aid, not a license verifier or anonymization tool.
    """
    source_path = Path(path)
    row_count = 0
    sample_ids: set[str] = set()
    participant_ids: set[str] = set()
    source_values: set[str] = set()
    license_values: set[str] = set()

    for row in rows:
        row_count += 1
        for field, values in (
            ("sample_id", sample_ids),
            ("participant_id", participant_ids),
            ("source", source_values),
            ("license_or_consent", license_values),
        ):
            value = str(row.get(field) or "").strip()
            if value and value.casefold() not in {"nan", "none", "null"}:
                values.add(value)

    return {
        "file_name": source_path.name,
        "sha256": sha256_file(source_path),
        "row_count": row_count,
        "unique_sample_count": len(sample_ids),
        "unique_participant_count": len(participant_ids),
        "label_columns": list(labels),
        "distinct_source_value_count": len(source_values),
        "distinct_license_or_consent_value_count": len(license_values),
    }
