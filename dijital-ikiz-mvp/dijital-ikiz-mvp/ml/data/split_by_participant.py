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
    parser = argparse.ArgumentParser()
    parser.add_argument("input_csv", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--train", type=float, default=0.8)
    parser.add_argument("--validation", type=float, default=0.1)
    parser.add_argument("--seed", default="digital-twin-v1")
    args = parser.parse_args()

    if args.train <= 0 or args.validation < 0 or args.train + args.validation >= 1:
        raise SystemExit("Train/validation oranları geçersiz.")

    with args.input_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
        fieldnames = reader.fieldnames or []

    if "participant_id" not in fieldnames:
        raise SystemExit("participant_id kolonu gerekli.")

    participants = sorted({row["participant_id"].strip() for row in rows if row["participant_id"].strip()})

    assignments: dict[str, str] = {}
    for participant in participants:
        value = bucket(participant, args.seed)
        if value < args.train:
            split = "train"
        elif value < args.train + args.validation:
            split = "validation"
        else:
            split = "test"
        assignments[participant] = split

    grouped: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in rows:
        grouped[assignments[row["participant_id"].strip()]].append(row)

    args.output_dir.mkdir(parents=True, exist_ok=True)

    for split, split_rows in grouped.items():
        output = args.output_dir / f"{split}.csv"
        with output.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(split_rows)

        print(f"{split}: {len(split_rows)} örnek")

    print(f"Katılımcılar: {len(participants)}")
    print("Aynı participant_id farklı splitlerde kullanılmamak üzere bölündü.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
