from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

from data.provenance import validate_provenance

COMMON_COLUMNS = {
    "sample_id",
    "participant_id",
    "text",
    "source",
    "license_or_consent",
}

VAD_COLUMNS = ("valence", "arousal", "dominance")
BIG_FIVE_COLUMNS = (
    "openness",
    "conscientiousness",
    "extraversion",
    "agreeableness",
    "neuroticism",
)
STYLE_COLUMNS = (
    "style_informality",
    "style_emoji_rate",
    "style_slang_rate",
    "style_humor",
)
TASK_LABEL_COLUMNS = {
    "vad": VAD_COLUMNS,
    "big-five": BIG_FIVE_COLUMNS,
    "style": STYLE_COLUMNS,
    "all": VAD_COLUMNS + BIG_FIVE_COLUMNS + STYLE_COLUMNS,
}

# Backwards-compatible set for callers and tests that validate a complete record.
REQUIRED_COLUMNS = COMMON_COLUMNS | set(TASK_LABEL_COLUMNS["all"])


def required_columns_for_task(task: str) -> set[str]:
    if task not in TASK_LABEL_COLUMNS:
        raise ValueError(f"Bilinmeyen görev: {task}")
    return COMMON_COLUMNS | set(TASK_LABEL_COLUMNS[task])


def main() -> int:
    parser = argparse.ArgumentParser(
        description="VAD, Big Five veya üslup regresyon verisini doğrular."
    )
    parser.add_argument("csv_path", type=Path)
    parser.add_argument(
        "--task",
        choices=tuple(TASK_LABEL_COLUMNS),
        default="all",
        help="Doğrulanacak etiket grubu (varsayılan: all).",
    )
    args = parser.parse_args()

    label_columns = TASK_LABEL_COLUMNS[args.task]

    with args.csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])
        missing = required_columns_for_task(args.task) - columns
        if missing:
            raise SystemExit(
                f"Eksik kolonlar ({args.task}): {', '.join(sorted(missing))}"
            )
        rows = list(reader)

    if not rows:
        raise SystemExit("CSV boş.")

    sample_ids = [str(row["sample_id"] or "").strip() for row in rows]
    participant_ids = [str(row["participant_id"] or "").strip() for row in rows]
    text_values = [str(row["text"] or "").strip() for row in rows]

    if any(not value or value.casefold() in {"nan", "none", "null"} for value in sample_ids):
        raise SystemExit("Boş sample_id bulundu.")

    if len(sample_ids) != len(set(sample_ids)):
        raise SystemExit("Tekrarlanan sample_id bulundu.")

    if any(not value or value.casefold() in {"nan", "none", "null"} for value in participant_ids):
        raise SystemExit("Boş participant_id bulundu.")

    if any(not value for value in text_values):
        raise SystemExit("Boş text bulundu; her örnek analiz edilebilir metin içermeli.")

    try:
        validate_provenance(reader.fieldnames or [], rows, str(args.csv_path))
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    for column in label_columns:
        for row_number, row in enumerate(rows, start=2):
            try:
                value = float(row[column])
            except (TypeError, ValueError):
                raise SystemExit(
                    f"{column} sayısal olmalıdır (CSV satırı {row_number})."
                )
            if not math.isfinite(value):
                raise SystemExit(
                    f"{column} sonlu bir sayı olmalıdır; NaN/sonsuz değer kabul edilmez "
                    f"(CSV satırı {row_number})."
                )
            if not 0 <= value <= 1:
                raise SystemExit(
                    f"{column} 0–1 aralığında olmalıdır (CSV satırı {row_number})."
                )

    print(f"Görev: {args.task}")
    print(f"Toplam örnek: {len(rows)}")
    print(f"Katılımcı sayısı: {len(set(participant_ids))}")

    for column in label_columns:
        print(f"{column}: {len(rows)}/{len(rows)} etiketli")

    print("Veri şeması temel kontrollerden geçti.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
