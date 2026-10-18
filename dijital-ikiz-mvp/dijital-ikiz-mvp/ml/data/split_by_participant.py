from __future__ import annotations

import argparse
import csv
import hashlib
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from data.split_integrity import normalize_text  # noqa: E402


def bucket(participant_id: str, seed: str) -> float:
    digest = hashlib.sha256(f"{seed}:{participant_id}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def group_participants_by_shared_text(
    rows: Sequence[Mapping[str, object]],
) -> list[list[str]]:
    """Keep participants connected by identical normalized text in one split.

    If participant A shares a text with B, and B shares another text with C,
    all three belong to one indivisible group. This prevents copies from
    crossing train/validation/test even when participant and sample IDs differ.
    """
    parent: dict[str, str] = {}

    def find(participant: str) -> str:
        while parent[participant] != participant:
            parent[participant] = parent[parent[participant]]
            participant = parent[participant]
        return participant

    def union(left: str, right: str) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            # Lexical root choice keeps group identity deterministic.
            lower, upper = sorted((left_root, right_root))
            parent[upper] = lower

    first_participant_by_text: dict[str, str] = {}
    for index, row in enumerate(rows, start=2):
        participant = str(row.get("participant_id") or "").strip()
        if not participant or participant.casefold() in {"nan", "none", "null"}:
            raise ValueError(f"dataset: participant_id boş değer içeriyor (satır {index}).")
        parent.setdefault(participant, participant)
        text = normalize_text(row.get("text"), split="dataset", index=index)
        first_participant = first_participant_by_text.get(text)
        if first_participant is None:
            first_participant_by_text[text] = participant
        else:
            union(participant, first_participant)

    members_by_root: dict[str, list[str]] = {}
    for participant in parent:
        members_by_root.setdefault(find(participant), []).append(participant)
    return sorted(
        (sorted(members) for members in members_by_root.values()),
        key=lambda members: members[0],
    )


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

    missing = {"participant_id", "sample_id", "text"} - set(fieldnames)
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
    participant_count = len(participants)
    try:
        groups = group_participants_by_shared_text(rows)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    if len(groups) < 3:
        raise SystemExit(
            "Train/validation/test için en az 3 bağımsız katılımcı/metin grubu gerekli. "
            "Aynı normalize edilmiş metinle bağlı katılımcıları ayrı bölümlere ayırmak "
            "test verisi sızıntısı oluşturabileceğinden bölme yapılmadı."
        )

    # Participants sharing any normalized text stay together as one group.
    # Hash ordering keeps the split deterministic and avoids text leakage.
    ranked_groups = sorted(groups, key=lambda group: (bucket(group[0], args.seed), group[0]))
    group_count = len(ranked_groups)
    train_count = max(1, min(group_count - 2, round(group_count * args.train)))
    validation_count = max(
        1,
        min(
            group_count - train_count - 1,
            round(group_count * (args.train + args.validation)) - train_count,
        ),
    )

    assignments: dict[str, str] = {}
    for group in ranked_groups[:train_count]:
        for participant in group:
            assignments[participant] = "train"
    for group in ranked_groups[train_count : train_count + validation_count]:
        for participant in group:
            assignments[participant] = "validation"
    for group in ranked_groups[train_count + validation_count :]:
        for participant in group:
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
    print(f"Bağımsız katılımcı/metin grubu: {group_count}")
    print(
        "Aynı katılımcılar ve normalize edilmiş metin kopyalarını paylaşan katılımcılar "
        "yalnızca tek bölümde yer alır; oranlar küçük veri kümelerinde yaklaşık olabilir."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
