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


def holm_adjust_pvalues(
    p_values: Mapping[str, float | None],
) -> dict[str, float | None]:
    """Apply Holm-Bonferroni correction to available p-values."""
    available: list[tuple[str, float]] = []
    for name, value in p_values.items():
        if value is None:
            continue
        if not 0 <= value <= 1:
            raise ValueError("p-değerleri 0 ile 1 arasında olmalı.")
        available.append((name, value))

    available.sort(key=lambda pair: pair[1])
    count = len(available)
    adjusted: dict[str, float | None] = {name: None for name in p_values}
    running_max = 0.0

    for rank, (name, value) in enumerate(available):
        candidate = min(1.0, (count - rank) * value)
        running_max = max(running_max, candidate)
        adjusted[name] = running_max

    return adjusted


def _quadratic_weighted_cohen_kappa(
    left: list[int],
    right: list[int],
) -> float | None:
    """Quadratic weighted Cohen kappa for two raters on matched ordinal 1-5 scores."""
    if len(left) != len(right) or len(left) < 2:
        return None

    categories = range(1, 6)
    count = len(left)
    observed = 0.0
    expected = 0.0

    left_counts = {category: left.count(category) / count for category in categories}
    right_counts = {category: right.count(category) / count for category in categories}

    for left_category in categories:
        for right_category in categories:
            weight = 1 - ((left_category - right_category) / 4) ** 2
            observed_count = sum(
                1 for a, b in zip(left, right)
                if a == left_category and b == right_category
            )
            observed += (observed_count / count) * weight
            expected += left_counts[left_category] * right_counts[right_category] * weight

    denominator = 1 - expected
    if abs(denominator) < 1e-12:
        return None
    return (observed - expected) / denominator


def _pairwise_rater_agreement(
    rater_scores: Mapping[str, Mapping[tuple[str, str], Mapping[str, int]]],
    rater_ids: set[str],
) -> dict[str, dict[str, object]]:
    from itertools import combinations

    output: dict[str, dict[str, object]] = {}
    for metric, unit_scores in rater_scores.items():
        coefficients: list[float] = []
        common_units_total = 0

        for left_rater, right_rater in combinations(sorted(rater_ids), 2):
            left: list[int] = []
            right: list[int] = []
            for ratings in unit_scores.values():
                if left_rater in ratings and right_rater in ratings:
                    left.append(ratings[left_rater])
                    right.append(ratings[right_rater])

            common_units_total += len(left)
            kappa = _quadratic_weighted_cohen_kappa(left, right)
            if kappa is not None:
                coefficients.append(kappa)

        output[metric] = {
            "method": "mean pairwise quadratic weighted Cohen kappa",
            "rater_pair_count": len(rater_ids) * (len(rater_ids) - 1) // 2,
            "defined_pair_count": len(coefficients),
            "common_scored_units_total": common_units_total,
            "mean": statistics.mean(coefficients) if coefficients else None,
            "minimum": min(coefficients) if coefficients else None,
            "maximum": max(coefficients) if coefficients else None,
        }

    return output


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
    rater_scores: dict[str, dict[tuple[str, str], dict[str, int]]] = {
        metric: defaultdict(dict) for metric in METRICS
    }
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
            rater_scores[metric][(case_id, label)][rater_id] = value

    if rating_row_count == 0:
        raise ValueError("Puan CSV'sinde değerlendirici kaydı bulunamadı.")

    # Average independent raters per response/case/condition first. For paired
    # effect estimates, compare only the SAME cases scored in both conditions
    # within each participant; do not compare condition means from different prompts.
    participant_case_means: dict[tuple[str, str, str], dict[str, float]] = defaultdict(dict)
    participant_case_metric_scores: dict[tuple[str, str, str, str], float] = {}
    for (participant_id, variant, case_id, metric), values in case_scores.items():
        mean_value = statistics.mean(values)
        participant_case_means[(participant_id, variant, case_id)][metric] = mean_value
        participant_case_metric_scores[(participant_id, variant, case_id, metric)] = mean_value

    participant_variant_metric: dict[tuple[str, str, str], list[float]] = defaultdict(list)
    for (participant_id, variant, case_id), metric_values in participant_case_means.items():
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
            rated_cases = {
                (participant_id, case_id)
                for (participant_id, used_variant, case_id, used_metric) in participant_case_metric_scores
                if used_variant == variant and used_metric == metric
            }
            variant_summary[variant] = {
                "rated_participant_count": len(means),
                "rated_case_count": len(rated_cases),
                "mean_participant_score": statistics.mean(means) if means else None,
                "median_participant_score": statistics.median(means) if means else None,
            }

        scores_by_participant_case: dict[str, dict[str, dict[str, float]]] = defaultdict(
            lambda: {variant: {} for variant in VARIANTS}
        )
        for (participant_id, variant, case_id, used_metric), score in participant_case_metric_scores.items():
            if used_metric == metric:
                scores_by_participant_case[participant_id][variant][case_id] = score

        differences: list[float] = []
        paired_case_count = 0
        for participant_id, variant_scores in scores_by_participant_case.items():
            common_cases = (
                set(variant_scores["personalized"])
                & set(variant_scores["baseline"])
            )
            if not common_cases:
                continue

            # Each participant contributes one mean of matched per-case
            # differences, regardless of how many prompts they rated.
            per_case_differences = [
                variant_scores["personalized"][case_id]
                - variant_scores["baseline"][case_id]
                for case_id in sorted(common_cases)
            ]
            differences.append(statistics.mean(per_case_differences))
            paired_case_count += len(common_cases)

        total_paired_participant_counts.append(len(differences))
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

        report_metrics[metric] = {
            "variant_summary": variant_summary,
            "paired_participant_count": len(differences),
            "paired_case_count": paired_case_count,
            "difference_personalized_minus_baseline": {
                "mean": statistics.mean(differences) if differences else None,
                "median": statistics.median(differences) if differences else None,
                "bootstrap_95_percent_ci_mean": ci,
                "permutation_test": permutation,
            },
        }

    # Correct for the three related rubric outcomes; confidence intervals remain
    # nominal per-metric intervals and should be interpreted accordingly.
    raw_p_values: dict[str, float | None] = {}
    for metric, details in report_metrics.items():
        difference = details["difference_personalized_minus_baseline"]
        permutation = difference["permutation_test"]
        raw_p_values[metric] = (
            float(permutation["p_value_two_sided"])
            if permutation is not None else None
        )
    holm_adjusted = holm_adjust_pvalues(raw_p_values)
    for metric, adjusted_p in holm_adjusted.items():
        if adjusted_p is not None:
            permutation = report_metrics[metric]["difference_personalized_minus_baseline"]["permutation_test"]
            if permutation is not None:
                permutation["p_value_holm_adjusted"] = adjusted_p

    inter_rater_agreement = _pairwise_rater_agreement(rater_scores, rater_ids)
    warnings = [
        "Koşul anahtarı gizli tutulmalı; bu rapora ham katılımcı kodları, metinler veya e-posta dahil edilmez.",
        "Rapor, yalnızca bu kör puan örneklemindeki algılanan yararlılık/üslup/ton uygunluğunu özetler; VAD/Big Five doğruluğunu veya psikolojik faydayı kanıtlamaz.",
        "Üç rubrik ölçütünün p-değerleri Holm düzeltmesiyle raporlanır; güven aralıkları her ölçüt için ayrı nominal %95 aralıktır.",
        "Pairwise weighted kappa birden fazla değerlendirici arasındaki uyumun özetidir; katılımcı ve vaka sayılarıyla birlikte raporlanmalı, tek başına kesin güvenilirlik kanıtı sayılmamalıdır.",
        "Puanlar eksik olabilir; metrik başına yalnızca o metriğe puan veren kayıtlar kullanılır.",
    ]
    if len(rater_ids) < 2:
        warnings.append("İki veya daha fazla kör değerlendirici olmadığından değerlendiriciler arası uyum hesaplanamaz.")
    elif any(item["defined_pair_count"] < item["rater_pair_count"] for item in inter_rater_agreement.values()):
        warnings.append("Bazı rater çiftleri için weighted kappa tanımsız olabilir (ör. puan dağılımı sabit veya ortak puan sayısı yetersiz).")
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
        "inter_rater_agreement": inter_rater_agreement,
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
