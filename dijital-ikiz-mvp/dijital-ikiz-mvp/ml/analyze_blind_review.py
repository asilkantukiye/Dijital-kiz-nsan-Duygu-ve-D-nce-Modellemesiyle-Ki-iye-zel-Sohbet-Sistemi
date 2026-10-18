from __future__ import annotations

import argparse
import csv
import json
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Iterable, Mapping

from analyze_feedback import bootstrap_mean_ci, sign_flip_permutation_test

VARIANTS = ("personalized", "baseline")
METRICS = (
    "helpfulness_1_5",
    "style_fit_1_5",
    "emotion_fit_1_5",
)
KEY_FIELDS = ("case_id", "response_label", "variant", "participant_id")


def _read_condition_key(
    rows: Iterable[Mapping[str, object]],
) -> dict[tuple[str, str], dict[str, str]]:
    key: dict[tuple[str, str], dict[str, str]] = {}
    cases: dict[str, list[dict[str, str]]] = defaultdict(list)

    for row_number, row in enumerate(rows, start=2):
        case_id = str(row.get("case_id") or "").strip()
        label = str(row.get("response_label") or "").strip().upper()
        variant = str(row.get("variant") or "").strip().lower()
        participant_id = str(row.get("participant_id") or "").strip()

        if not case_id or not participant_id:
            raise ValueError(f"Koşul anahtarı satırı {row_number}: case_id ve participant_id gerekli.")
        if label not in ("A", "B"):
            raise ValueError(f"Koşul anahtarı satırı {row_number}: response_label A veya B olmalı.")
        if variant not in VARIANTS:
            raise ValueError(
                f"Koşul anahtarı satırı {row_number}: variant personalized veya baseline olmalı."
            )

        identity = (case_id, label)
        if identity in key:
            raise ValueError(
                f"Koşul anahtarı satırı {row_number}: aynı case_id/response_label birden fazla kez var."
            )

        record = {
            "case_id": case_id,
            "response_label": label,
            "variant": variant,
            "participant_id": participant_id,
        }
        key[identity] = record
        cases[case_id].append(record)

    if not key:
        raise ValueError("Koşul anahtarında geçerli satır yok.")

    for case_id, records in cases.items():
        if len(records) != 2 or {row["response_label"] for row in records} != {"A", "B"}:
            raise ValueError(f"{case_id}: koşul anahtarı tam A ve B satırlarını içermeli.")
        if {row["variant"] for row in records} != set(VARIANTS):
            raise ValueError(f"{case_id}: A/B koşul anahtarı iki ayrı varyantı içermeli.")
        if len({row["participant_id"] for row in records}) != 1:
            raise ValueError(f"{case_id}: eşleştirilmiş yanıtlar aynı takma katılımcıya ait olmalı.")

    return key


def _parse_optional_rating(value: object, row_number: int, metric: str) -> int | None:
    raw = str(value if value is not None else "").strip()
    if raw == "":
        return None
    try:
        rating = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"Puan CSV satırı {row_number}: {metric} 1–5 arasında tam sayı veya boş olmalı."
        ) from exc
    if str(rating) != raw or not 1 <= rating <= 5:
        raise ValueError(
            f"Puan CSV satırı {row_number}: {metric} 1–5 arasında tam sayı veya boş olmalı."
        )
    return rating


def analyze_blind_review_rows(
    rating_rows: Iterable[Mapping[str, object]],
    condition_key_rows: Iterable[Mapping[str, object]],
    *,
    seed: int = 42,
    bootstrap_repetitions: int = 10_000,
    permutation_repetitions: int = 10_000,
) -> dict[str, object]:
    key = _read_condition_key(condition_key_rows)
    seen_rater_case: set[tuple[str, str, str]] = set()

    # First average independent raters for each response/case; then average cases
    # within participant and condition so repeated prompts are not counted as
    # independent participants.
    case_scores: dict[tuple[str, str, str, str], list[int]] = defaultdict(list)
    rating_row_count = 0
    skipped_metric_cells = 0
    rater_ids: set[str] = set()

    for row_number, row in enumerate(rating_rows, start=2):
        rater_id = str(row.get("rater_id") or "").strip()
        case_id = str(row.get("case_id") or "").strip()
        label = str(row.get("response_label") or "").strip().upper()

        if not rater_id:
            raise ValueError(f"Puan CSV satırı {row_number}: rater_id gerekli; takma kod kullan.")
        if not case_id or label not in ("A", "B"):
            raise ValueError(
                f"Puan CSV satırı {row_number}: case_id gerekli ve response_label A/B olmalı."
            )
        identity = (rater_id, case_id, label)
        if identity in seen_rater_case:
            raise ValueError(
                f"Puan CSV satırı {row_number}: aynı değerlendirici/vaka/yanıt birden fazla kez var."
            )
        seen_rater_case.add(identity)

        condition = key.get((case_id, label))
        if condition is None:
            raise ValueError(
                f"Puan CSV satırı {row_number}: case_id/response_label gizli koşul anahtarında bulunamadı."
            )

        parsed = {
            metric: _parse_optional_rating(row.get(metric), row_number, metric)
            for metric in METRICS
        }
        if all(value is None for value in parsed.values()):
            raise ValueError(
                f"Puan CSV satırı {row_number}: en az bir rubrik puanı gerekli."
            )

        rating_row_count += 1
        rater_ids.add(rater_id)
        for metric, value in parsed.items():
            if value is None:
                skipped_metric_cells += 1
                continue
            case_scores[
                (
                    condition["participant_id"],
                    condition["variant"],
                    case_id,
                    metric,
                )
            ].append(value)

    if rating_row_count == 0:
        raise ValueError("Puan CSV'sinde değerlendirici kaydı bulunamadı.")

    # Average across raters for each individual response, then across cases per participant.
    participant_case_means: dict[tuple[str, str, str], dict[str, float]] = defaultdict(dict)
    for (participant_id, variant, case_id, metric), values in case_scores.items():
        participant_case_means[(participant_id, variant, case_id)][metric] = statistics.mean(values)

    participant_variant_metric: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    variant_case_counts: dict[str, set[tuple[str, str]]] = defaultdict(set)
    for (participant_id, variant, case_id), metric_values in participant_case_means.items():
        variant_case_counts[variant].add((participant_id, case_id))
        for metric, value in metric_values.items():
            participant_variant_metric[(participant_id, variant, metric)].append(value)

    participant_means: dict[str, dict[str, dict[str, float]]] = defaultdict(
        lambda: {variant: {} for variant in VARIANTS}
    )
    for (participant_id, variant, metric), case_means in participant_variant_metric.items():
        participant_means[participant_id][variant][metric] = statistics.mean(case_means)

    report_metrics: dict[str, object] = {}
    total_paired_participant_counts: list[int] = []

    for metric in METRICS:
        variant_summary: dict[str, dict[str, object]] = {}
        for variant in VARIANTS:
            means = [
                participant_means[participant_id][variant][metric]
                for participant_id in participant_means
                if metric in participant_means[participant_id][variant]
            ]
            variant_summary[variant] = {
                "rated_participant_count": len(means),
                "rated_case_count": len([
                    (participant_id, case_id)
                    for (participant_id, used_variant, case_id, used_metric) in case_scores
                    if used_variant == variant and used_metric == metric
                ]),
                "mean_participant_score": statistics.mean(means) if means else None,
                "median_participant_score": statistics.median(means) if means else None,
            }

        paired_ids = [
            participant_id
            for participant_id, variants in participant_means.items()
            if metric in variants["personalized"] and metric in variants["baseline"]
        ]
        differences = [
            participant_means[participant_id]["personalized"][metric]
            - participant_means[participant_id]["baseline"][metric]
            for participant_id in paired_ids
        ]
        total_paired_participant_counts.append(len(paired_ids))
        ci = (
            bootstrap_mean_ci(
                differences,
                seed=seed,
                repetitions=bootstrap_repetitions,
            )
            if differences else None
        )
        permutation = (
            sign_flip_permutation_test(
                differences,
                seed=seed,
                repetitions=permutation_repetitions,
            )
            if differences else None
        )

        paired_cases = 0
        case_values: dict[tuple[str, str, str], dict[str, float]] = defaultdict(dict)
        for (participant_id, variant, case_id, used_metric), values in case_scores.items():
            if used_metric == metric:
                case_values[(participant_id, case_id, used_metric)][variant] = statistics.mean(values)
        for values in case_values.values():
            if "personalized" in values and "baseline" in values:
                paired_cases += 1

        report_metrics[metric] = {
            "variant_summary": variant_summary,
            "paired_participant_count": len(paired_ids),
            "paired_case_count": paired_cases,
            "difference_personalized_minus_baseline": {
                "mean": statistics.mean(differences) if differences else None,
                "median": statistics.median(differences) if differences else None,
                "bootstrap_95_percent_ci_mean": ci,
                "permutation_test": permutation,
            },
        }

    warnings = [
        "Koşul anahtarı gizli tutulmalı; bu rapora ham katılımcı kodları, metinler veya e-posta dahil edilmez.",
        "Rapor, yalnızca bu kör puan örneklemindeki algılanan yararlılık/üslup/ton uygunluğunu özetler; VAD/Big Five doğruluğunu veya psikolojik faydayı kanıtlamaz.",
        "Puan analizi değerlendiriciler arası uyumu hesaplamaz; gerekliyse ordinal ölçeğe uygun bir uyum ölçüsünü ayrıca raporla.",
        "Puanlar eksik olabilir; metrik başına yalnızca o metriğe puan veren kayıtlar kullanılır.",
    ]
    min_paired = min(total_paired_participant_counts) if total_paired_participant_counts else 0
    if min_paired < 10:
        warnings.append(
            "En az bir ölçütte 10'dan az eşleştirilmiş katılımcı var; sonuçlar yalnızca öncül bulgu olarak sunulmalı."
        )
    elif min_paired < 30:
        warnings.append(
            "Eşleştirilmiş katılımcı sayısı küçük; güven aralıkları ve p-değerleri temkinli yorumlanmalı."
        )

    return {
        "analysis_type": "blind paired response rating; participant-clustered exploratory comparison",
        "rating_scale": "1-5",
        "reviewer_count": len(rater_ids),
        "rating_rows": rating_row_count,
        "missing_metric_cells": skipped_metric_cells,
        "metrics": report_metrics,
        "warnings": warnings,
        "scientific_note": (
            "For each metric, ratings are first averaged across raters per response, then across prompts per participant and condition. "
            "The paired difference compares participant-level personalized and baseline means."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze anonymised blind human ratings using a separate private condition key."
    )
    parser.add_argument("ratings_csv", type=Path)
    parser.add_argument("condition_key_csv", type=Path)
    parser.add_argument("--output", type=Path, default=Path("ml/results/blind_review_analysis.json"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--bootstrap-repetitions", type=int, default=10_000)
    parser.add_argument("--permutation-repetitions", type=int, default=10_000)
    args = parser.parse_args()

    with args.ratings_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"rater_id", "case_id", "response_label", *METRICS}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"Puan CSV'sinde eksik kolonlar: {', '.join(sorted(missing))}")
        ratings = list(reader)

    with args.condition_key_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = set(KEY_FIELDS) - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"Koşul anahtarında eksik kolonlar: {', '.join(sorted(missing))}")
        key_rows = list(reader)

    try:
        report = analyze_blind_review_rows(
            ratings,
            key_rows,
            seed=args.seed,
            bootstrap_repetitions=args.bootstrap_repetitions,
            permutation_repetitions=args.permutation_repetitions,
        )
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Rapor: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
