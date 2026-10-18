from __future__ import annotations

import argparse
import csv
import hashlib
from collections import defaultdict
from pathlib import Path


def bucket(participant_id: str, seed: str) -> float:
    digest = hashlib.sha256(f"{seed}:{participant_id}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Katılımcıları sızıntısız train/validation/test bölümlerine ayırır."
    )
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--train", type=float, default=0.8)
    parser.add_argument("--validation", type=float, default=0.1)
    parser.add_argument("--seed", default="digital-twin-v1")
    args = parser.parse_args()

    if (
        args.train <= 0
        or args.validation <= 0
        or args.train + args.validation >= 1
    ):
        raise SystemExit("Train ve validation oranları pozitif olmalı; toplamları 1'den küçük olmalı.")

    with args.input_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    missing = {"participant_id", "sample_id"} - set(fieldnames)
    if missing:
        raise SystemExit(f"Eksik kolonlar: {', '.join(sorted(missing))}")
    if not rows:
        raise SystemExit("Girdi CSV boş.")

    participant_values = [str(row.get("participant_id") or "").strip() for row in rows]
    if any(not value or value.casefold() in {"nan", "none", "null"} for value in participant_values):
        raise SystemExit("Boş participant_id bulundu; bölme yapılmadı.")

    sample_ids = [str(row.get("sample_id") or "").strip() for row in rows]
    if any(not value or value.casefold() in {"nan", "none", "null"} for value in sample_ids):
        raise SystemExit("Boş sample_id bulundu; bölme yapılmadı.")
    if len(sample_ids) != len(set(sample_ids)):
        raise SystemExit("Tekrarlanan sample_id bulundu; bölme yapılmadı.")

    participants = sorted(set(participant_values))
    if len(participants) < 3:
        raise SystemExit(
            "Train/validation/test için en az 3 farklı katılımcı gerekli. "
            "Daha az katılımcıyla bilimsel olarak ayrı üç bölüm oluşturulamaz."
        )

    # Hash ordering makes the split deterministic. Minimum one participant in
    # each split avoids silently omitting validation/test files on small datasets.
    ranked = sorted(participants, key=lambda value: (bucket(value, args.seed), value))
    participant_count = len(ranked)
    train_count = max(1, min(participant_count - 2, round(participant_count * args.train)))
    validation_count = max(
        1,
        min(
            participant_count - train_count - 1,
            round(participant_count * (args.train + args.validation)) - train_count,
        ),
    )

    assignments: dict[str, str] = {}
    for participant in ranked[:train_count]:
        assignments[participant] = "train"
    for participant in ranked[train_count : train_count + validation_count]:
        assignments[participant] = "validation"
    for participant in ranked[train_count + validation_count :]:
        assignments[participant] = "test"

    grouped: dict[str, list[dict[str, str]]] = {
        "train": [],
        "validation": [],
        "test": [],
    }
    for row, participant in zip(rows, participant_values):
        grouped[assignments[participant]].append(row)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for split in ("train", "validation", "test"):
        output = args.output_dir / f"{split}.csv"
        with output.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(grouped[split])

        print(
            f"{split}: {len(grouped[split])} örnek, "
            f"{len({row['participant_id'].strip() for row in grouped[split]})} katılımcı"
        )

    print(f"Toplam katılımcı: {participant_count}")
    print("Aynı katılımcı yalnızca tek bölümde yer alır; oranlar küçük veri kümelerinde yaklaşık olabilir.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
