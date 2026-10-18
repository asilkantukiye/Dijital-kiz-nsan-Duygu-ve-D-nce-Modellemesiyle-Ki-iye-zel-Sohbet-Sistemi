from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path
from typing import Iterable, Mapping
import unicodedata

OUTPUT_FIELDS = (
    "pair_id",
    "participant_id",
    "prompt_text",
    "response_text",
    "variant",
)
REQUIRED_COLUMNS = {"id", "user_id", "role", "variant", "content", "created_at"}
VARIANTS = ("personalized", "baseline")


def _parse_timestamp(value: object, row_number: int) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        raise ValueError(f"CSV satırı {row_number}: created_at boş olamaz.")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"CSV satırı {row_number}: created_at ISO tarih/saat olmalı.") from exc
    if parsed.tzinfo is None:
        raise ValueError(
            f"CSV satırı {row_number}: created_at saat dilimi içermeli; UTC/offset kullan."
        )
    return parsed


def _normalize_prompt(value: str) -> str:
    # Keep matching conservative: normalize Unicode and whitespace but do not
    # change words, punctuation or case. This mirrors prepare_blind_review.py.
    return " ".join(unicodedata.normalize("NFKC", value).split())


def _hmac_hex(salt: bytes, payload: str, length: int = 32) -> str:
    return hmac.new(salt, payload.encode("utf-8"), hashlib.sha256).hexdigest()[:length]


def build_blind_review_input(
    rows: Iterable[Mapping[str, object]],
    pseudonym_salt: str,
    *,
    since: datetime | None = None,
) -> tuple[list[dict[str, str]], dict[str, int]]:
    """Transform exported message rows into anonymised same-prompt A/B pairs.

    Raw user IDs are used only as in-memory grouping keys and are never returned
    or printed. Timestamps must establish an unambiguous user/assistant order.
    """
    salt = pseudonym_salt.encode("utf-8")
    if len(salt) < 32:
        raise ValueError(
            "BLIND_REVIEW_PSEUDONYM_SALT en az 32 bayt olmalı; güçlü ve gizli bir değer kullan."
        )
    if since is not None and since.tzinfo is None:
        raise ValueError("--since saat dilimi içeren ISO tarih/saat olmalı.")

    grouped: dict[tuple[str, str], list[tuple[datetime, int, dict[str, str]]]] = defaultdict(list)
    seen_ids: set[str] = set()
    skipped_before_since = 0

    for row_number, row in enumerate(rows, start=2):
        message_id = str(row.get("id") or "").strip()
        raw_user_id = str(row.get("user_id") or "").strip()
        role = str(row.get("role") or "").strip().lower()
        variant = str(row.get("variant") or "").strip().lower()
        content = str(row.get("content") or "").strip()
        created_at = _parse_timestamp(row.get("created_at"), row_number)

        if not message_id or not raw_user_id:
            raise ValueError(f"CSV satırı {row_number}: id ve user_id boş olamaz.")
        if message_id in seen_ids:
            raise ValueError(f"CSV satırı {row_number}: yinelenen message id bulundu.")
        seen_ids.add(message_id)

        if role not in {"user", "assistant"}:
            raise ValueError(f"CSV satırı {row_number}: role user veya assistant olmalı.")
        if variant not in VARIANTS:
            raise ValueError(
                f"CSV satırı {row_number}: variant personalized veya baseline olmalı."
            )
        if not content:
            raise ValueError(f"CSV satırı {row_number}: content boş olamaz.")

        if since is not None and created_at < since:
            skipped_before_since += 1
            continue

        grouped[(raw_user_id, variant)].append((
            created_at,
            row_number,
            {"role": role, "content": content, "message_id": message_id},
        ))

    records_by_variant: dict[str, dict[tuple[str, str, int], dict[str, str]]] = {
        variant: {} for variant in VARIANTS
    }
    pseudonym_by_user: dict[str, str] = {}

    for (raw_user_id, variant), events in grouped.items():
        # Sort by explicit application timestamps. Equal timestamps are ambiguous;
        # never break a tie using random UUIDs or CSV row order.
        events.sort(key=lambda event: event[0])
        for index in range(1, len(events)):
            if events[index][0] <= events[index - 1][0]:
                raise ValueError(
                    "Aynı kullanıcı/varyant için created_at tekrar ediyor veya sıralı değil. "
                    "Mesaj sırasını güvenle kurmak mümkün değil; yalnızca zaman damgaları "
                    "ayrık olan kayıtları --since ile seç veya yeni zaman damgalı kayıtları kullan."
                )

        # A complete export must contain alternating user/assistant pairs. If
        # --since cuts through a pair or there is a gap, stop rather than guess.
        if len(events) % 2 != 0:
            raise ValueError(
                "Bir kullanıcı/varyant grubunda eşleşmemiş mesaj sayısı var. "
                "--since aralığını tam bir kullanıcı-yanıt çiftinin öncesine ayarla."
            )

        for index in range(0, len(events), 2):
            user_event = events[index][2]
            assistant_event = events[index + 1][2]
            if user_event["role"] != "user" or assistant_event["role"] != "assistant":
                raise ValueError(
                    "Mesajlar güvenli biçimde user→assistant çiftlerine ayrılamadı. "
                    "İhracatın tam ve created_at sırasına göre olduğundan emin ol."
                )

        pseudonym = pseudonym_by_user.setdefault(
            raw_user_id,
            "P-" + _hmac_hex(salt, "participant:" + raw_user_id, 20),
        )
        occurrences: Counter[str] = Counter()

        for index in range(0, len(events), 2):
            user_event = events[index][2]
            assistant_event = events[index + 1][2]
            prompt = user_event["content"]
            normalized = _normalize_prompt(prompt)
            if not normalized:
                continue

            occurrence = occurrences[normalized]
            occurrences[normalized] += 1
            identity = (pseudonym, normalized, occurrence)
            if identity in records_by_variant[variant]:
                raise ValueError(
                    "Aynı takma katılımcı/istem oluşumu yinelenmiş; dışa aktarma dosyasını denetle."
                )

            records_by_variant[variant][identity] = {
                "participant_id": pseudonym,
                "prompt_text": prompt,
                "response_text": assistant_event["content"],
            }

    personalized = records_by_variant["personalized"]
    baseline = records_by_variant["baseline"]
    paired_identities = sorted(set(personalized) & set(baseline))


    if not paired_identities:
        raise ValueError(
            "personalized ve baseline koşullarında aynı isteme ait eşleşmiş kayıt bulunamadı."
        )

    output_rows: list[dict[str, str]] = []
    for pseudonym, normalized_prompt, occurrence in paired_identities:
        left = personalized[(pseudonym, normalized_prompt, occurrence)]
        right = baseline[(pseudonym, normalized_prompt, occurrence)]
        pair_id = "PAIR-" + _hmac_hex(
            salt,
            f"pair:{pseudonym}:{normalized_prompt}:{occurrence}",
            28,
        )

        # Keep the original prompt from one condition; conservative normalization
        # guarantees prepare_blind_review.py accepts this pair as the same prompt.
        output_rows.extend([
            {
                "pair_id": pair_id,
                "participant_id": pseudonym,
                "prompt_text": left["prompt_text"],
                "response_text": left["response_text"],
                "variant": "personalized",
            },
            {
                "pair_id": pair_id,
                "participant_id": pseudonym,
                "prompt_text": right["prompt_text"],
                "response_text": right["response_text"],
                "variant": "baseline",
            },
        ])

    stats = {
        "export_rows_read": len(seen_ids),
        "rows_skipped_before_since": skipped_before_since,
        "paired_prompts": len(paired_identities),
        "unmatched_personalized_prompts": len(set(personalized) - set(baseline)),
        "unmatched_baseline_prompts": len(set(baseline) - set(personalized)),
        "participants_with_pairs": len({identity[0] for identity in paired_identities}),
    }
    return output_rows, stats


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert a local Supabase messages CSV export to pseudonymised blind-review input."
    )
    parser.add_argument("messages_csv", type=Path)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ml/data/blind_review_input.csv"),
    )
    parser.add_argument(
        "--since",
        help="Optional ISO timestamp with time zone; include complete message pairs after this time.",
    )
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    salt = os.environ.get("BLIND_REVIEW_PSEUDONYM_SALT", "")
    if not salt:
        raise SystemExit(
            "BLIND_REVIEW_PSEUDONYM_SALT tanımlı değil. En az 32 baytlık gizli salt'ı "
            "ortam değişkeni olarak ayarla; komut argümanı veya kaynak koda yazma."
        )

    try:
        since = (
            datetime.fromisoformat(args.since.replace("Z", "+00:00"))
            if args.since else None
        )
    except ValueError as exc:
        raise SystemExit("--since saat dilimli ISO tarih/saat olmalı.") from exc

    if args.output.exists() and not args.overwrite:
        raise SystemExit(
            f"Çıktı zaten var: {args.output}. Veri kaybını önlemek için farklı dosya adı "
            "kullan veya bilinçli yenileme için --overwrite ver."
        )

    with args.messages_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = REQUIRED_COLUMNS - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"Mesaj CSV'sinde eksik kolonlar: {', '.join(sorted(missing))}")
        messages = list(reader)

    try:
        rows, stats = build_blind_review_input(messages, salt, since=since)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x" if not args.overwrite else "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=OUTPUT_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    # Only safe counts and output path are printed; never print user IDs or texts.
    print("Eşleştirme özeti:")
    for key, value in stats.items():
        print(f"- {key}: {value}")
    print(f"Çıktı: {args.output}")
    print("Çıktı kişisel sohbet metinleri içerir; GitHub'a yükleme ve erişimi kısıtlı tut.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
