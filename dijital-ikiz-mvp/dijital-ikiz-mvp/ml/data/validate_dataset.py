from __future__ import annotations

import argparse
import csv
import math
from pathlib import Path

REQUIRED_COLUMNS = {
    "sample_id",
    "participant_id",
    "text",
    "source",
    "license_or_consent",
    "valence",
    "arousal",
    "dominance",
    "openness",
    "conscientiousness",
    "extraversion",
    "agreeableness",
    "neuroticism",
    "style_informality",
    "style_emoji_rate",
    "style_slang_rate",
    "style_humor",
}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_path", type=Path)
    args = parser.parse_args()

    with args.csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        columns = set(reader.fieldnames or [])

        missing = REQUIRED_COLUMNS - columns
        if missing:
            raise SystemExit(f"Eksik kolonlar: {', '.join(sorted(missing))}")

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

    provenance_fields = ("source", "license_or_consent")
    for field in provenance_fields:
        if any(not str(row[field] or "").strip() for row in rows):
            raise SystemExit(
                f"{field} boş olamaz; veri kaynağı/lisans veya açık rıza bilgisi zorunludur."
            )

    label_columns = [
        "valence",
        "arousal",
        "dominance",
        "openness",
        "conscientiousness",
        "extraversion",
        "agreeableness",
        "neuroticism",
        "style_informality",
        "style_emoji_rate",
        "style_slang_rate",
        "style_humor",
    ]
    for column in label_columns:
        for row_number, row in enumerate(rows, start=2):
            try:
                value = float(row[column])
            except (TypeError, ValueError):
                raise SystemExit(f"{column} sayısal olmalıdır (CSV satırı {row_number}).")
            if not math.isfinite(value):
                raise SystemExit(
                    f"{column} sonlu bir sayı olmalıdır; NaN/sonsuz değer kabul edilmez "
                    f"(CSV satırı {row_number})."
                )
            if not 0 <= value <= 1:
                raise SystemExit(f"{column} 0–1 aralığında olmalıdır (CSV satırı {row_number}).")

    print(f"Toplam örnek: {len(rows)}")
    print(f"Katılımcı sayısı: {len(set(participant_ids))}")

    for column in label_columns:
        print(f"{column}: {len(rows)}/{len(rows)} etiketli")

    print("Veri şeması temel kontrollerden geçti.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
