from __future__ import annotations

import argparse
import csv
import random
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Mapping

VARIANTS = ("personalized", "baseline")
REVIEW_FIELDS = ("case_id", "response_label", "prompt_text", "response_text")
KEY_FIELDS = ("case_id", "response_label", "variant", "participant_id")


def _normalize_prompt(value: str) -> str:
    return " ".join(value.split())


def prepare_blind_review(
    rows: Iterable[Mapping[str, object]],
    review_output: Path,
    condition_key_output: Path,
    *,
    seed: int | None = None,
    overwrite: bool = False,
) -> int:
    """Create a reviewer packet and separate condition key, with no participant ID output."""
    review_path = review_output.resolve()
    key_path = condition_key_output.resolve()

    if review_path == key_path:
        raise ValueError("Değerlendirici dosyası ile koşul anahtarı farklı dosyalar olmalı.")
    if not overwrite and (review_path.exists() or key_path.exists()):
        raise FileExistsError(
            "Çıktılardan biri zaten var. Var olan dosyayı korumak için farklı ad seç "
            "veya yalnızca bilerek yenilemek istiyorsan --overwrite kullan."
        )

    grouped: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    for row_number, row in enumerate(rows, start=2):
        pair_id = str(row.get("pair_id") or "").strip()
        participant_id = str(row.get("participant_id") or "").strip()
        variant = str(row.get("variant") or "").strip().lower()
        prompt = str(row.get("prompt_text") or "").strip()
        response = str(row.get("response_text") or "").strip()

        if not pair_id:
            raise ValueError(f"CSV satırı {row_number}: pair_id boş olamaz.")
        if not participant_id:
            raise ValueError(
                f"CSV satırı {row_number}: participant_id boş olamaz; önce takma ada çevir."
            )
        if variant not in VARIANTS:
            raise ValueError(
                f"CSV satırı {row_number}: variant personalized veya baseline olmalı."
            )
        if not prompt or not response:
            raise ValueError(
                f"CSV satırı {row_number}: prompt_text ve response_text boş olamaz."
            )
        if variant in grouped[pair_id]:
            raise ValueError(
                f"CSV satırı {row_number}: bir pair_id içinde aynı varyant birden fazla var."
            )

        grouped[pair_id][variant] = {
            "participant_id": participant_id,
            "prompt_text": prompt,
            "response_text": response,
        }

    if not grouped:
        raise ValueError("CSV içinde kör değerlendirmeye uygun kayıt bulunamadı.")

    pairs: list[tuple[str, dict[str, dict[str, str]]]] = []
    for pair_id, variants in grouped.items():
        if set(variants) != set(VARIANTS):
            raise ValueError(
                "Her pair_id için tam olarak bir personalized ve bir baseline yanıtı gerekli."
            )

        if variants["personalized"]["participant_id"] != variants["baseline"]["participant_id"]:
            raise ValueError("Aynı pair_id içindeki iki koşul aynı takma participant_id'ye ait olmalı.")

        personalized_prompt = _normalize_prompt(variants["personalized"]["prompt_text"])
        baseline_prompt = _normalize_prompt(variants["baseline"]["prompt_text"])
        if personalized_prompt != baseline_prompt:
            raise ValueError(
                "Aynı pair_id içindeki iki koşulun istemi aynı olmalı."
            )
        pairs.append((pair_id, variants))

    rng = random.Random(seed)
    rng.shuffle(pairs)

    review_rows: list[dict[str, str]] = []
    key_rows: list[dict[str, str]] = []

    for _pair_id, variants in pairs:
        case_id = uuid.uuid4().hex
        condition_order = [
            ("personalized", variants["personalized"]),
            ("baseline", variants["baseline"]),
        ]
        rng.shuffle(condition_order)

        for response_label, (variant, record) in zip(("A", "B"), condition_order):
            review_rows.append({
                "case_id": case_id,
                "response_label": response_label,
                "prompt_text": record["prompt_text"],
                "response_text": record["response_text"],
            })
            key_rows.append({
                "case_id": case_id,
                "response_label": response_label,
                "variant": variant,
                "participant_id": record["participant_id"],
            })

    # Randomize packet case order as a separate step so source CSV order is not a cue.
    case_ids = list(dict.fromkeys(row["case_id"] for row in review_rows))
    rng.shuffle(case_ids)
    order_index = {case_id: index for index, case_id in enumerate(case_ids)}
    review_rows.sort(key=lambda row: (order_index[row["case_id"]], row["response_label"]))
    key_rows.sort(key=lambda row: (order_index[row["case_id"]], row["response_label"]))

    review_path.parent.mkdir(parents=True, exist_ok=True)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    review_existed_before = review_path.exists()
    key_existed_before = key_path.exists()
    try:
        with review_path.open("x" if not overwrite else "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=REVIEW_FIELDS)
            writer.writeheader()
            writer.writerows(review_rows)

        with key_path.open("x" if not overwrite else "w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=KEY_FIELDS)
            writer.writeheader()
            writer.writerows(key_rows)
    except Exception:
        # If either newly-created output fails, remove any partial new file.
        # Existing files are left alone when overwrite=False.
        if not review_existed_before and review_path.exists():
            review_path.unlink()
        if not key_existed_before and key_path.exists():
            key_path.unlink()
        raise

    return len(pairs)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Prepare anonymised paired responses for blind human evaluation."
    )
    parser.add_argument("input_csv", type=Path)
    parser.add_argument(
        "--review-output",
        type=Path,
        default=Path("ml/results/blind_review.csv"),
    )
    parser.add_argument(
        "--key-output",
        type=Path,
        default=Path("ml/private/condition_key.csv"),
        help="Bu dosya gizli tutulmalı; değerlendiriciyle paylaşılmamalı.",
    )
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    with args.input_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"pair_id", "participant_id", "prompt_text", "response_text", "variant"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"Eksik kolonlar: {', '.join(sorted(missing))}")
        rows = list(reader)

    try:
        cases = prepare_blind_review(
            rows,
            args.review_output,
            args.key_output,
            seed=args.seed,
            overwrite=args.overwrite,
        )
    except (ValueError, FileExistsError) as exc:
        raise SystemExit(str(exc)) from exc

    print(f"Kör değerlendirme için {cases} eşleştirilmiş vaka hazırlandı.")
    print(f"Değerlendirici paketi: {args.review_output}")
    print(f"Gizli koşul anahtarı: {args.key_output}")
    print("Değerlendiriciye yalnızca ilk dosyayı ilet; anahtar dosyasını ayrı ve korumalı tut.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
