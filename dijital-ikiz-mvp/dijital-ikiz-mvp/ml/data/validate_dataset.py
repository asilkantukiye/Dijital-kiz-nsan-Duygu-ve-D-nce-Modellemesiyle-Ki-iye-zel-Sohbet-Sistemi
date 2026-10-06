from __future__ import annotations

import argparse
import csv
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

    sample_ids = [row["sample_id"].strip() for row in rows]
    participant_ids = [row["participant_id"].strip() for row in rows]

    if any(not value for value in sample_ids):
        raise SystemExit("Boş sample_id bulundu.")

    if len(sample_ids) != len(set(sample_ids)):
        raise SystemExit("Tekrarlanan sample_id bulundu.")

    if any(not value for value in participant_ids):
        raise SystemExit("Boş participant_id bulundu.")

    print(f"Toplam örnek: {len(rows)}")
    print(f"Katılımcı sayısı: {len(set(participant_ids))}")

    for column in [
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
    ]:
        filled = sum(1 for row in rows if str(row[column]).strip() != "")
        print(f"{column}: {filled}/{len(rows)} etiketli")

    print("Veri şeması temel kontrollerden geçti.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
