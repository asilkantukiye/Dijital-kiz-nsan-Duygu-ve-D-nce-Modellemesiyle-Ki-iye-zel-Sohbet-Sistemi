from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
from collections import Counter, defaultdict
from pathlib import Path

DIMENSIONS = ("style_fit", "relevance", "coherence")
SCORE_COLUMNS = tuple(
    f"response_{response}_{dimension}"
    for dimension in DIMENSIONS
    for response in (1, 2)
)
ALLOWED_COLUMNS = ("evaluator_id", "case_id", *SCORE_COLUMNS)


def _distance(left: int, right: int, proportions: list[float]) -> float:
    """Ordinal Krippendorff disagreement distance using marginal category frequencies."""
    if left == right:
        return 0.0
    low, high = sorted((left, right))
    cumulative = sum(proportions[low - 1:high])
    midpoint_mass = (proportions[low - 1] + proportions[high - 1]) / 2.0
    return (cumulative - midpoint_mass) ** 2


def krippendorff_alpha_ordinal(units: dict[str, list[int]]) -> dict[str, object]:
    valid = [values for values in units.values() if len(values) >= 2]
    if not valid:
        return {"status": "not_estimable", "alpha": None,
                "reason": "Fewer than one item has at least two ratings.", "items": 0, "ratings": 0}

    ratings = [score for values in valid for score in values]
    if any(score not in {1, 2, 3, 4, 5} for score in ratings):
        raise ValueError("Ordinal ratings must be integers from 1 to 5.")
    counts = Counter(ratings)
    total = len(ratings)
    categories = [counts.get(category, 0) / total for category in range(1, 6)]
    if len(counts) < 2:
        return {"status": "not_estimable", "alpha": None,
                "reason": "Expected disagreement is zero because all ratings use one category.",
                "items": len(valid), "ratings": total, "categories_used": sorted(counts)}

    # Krippendorff coincidence matrix: each rating is paired with every other rating
    # on the same item, weighted by 1/(ratings_on_item - 1).
    coincidence = [[0.0] * 5 for _ in range(5)]
    for values in valid:
        weight = 1.0 / (len(values) - 1)
        for index, left in enumerate(values):
            for right in values[index + 1:]:
                coincidence[left - 1][right - 1] += weight
                coincidence[right - 1][left - 1] += weight

    coincidence_total = sum(map(sum, coincidence))
    observed = sum(
        coincidence[left - 1][right - 1] * _distance(left, right, categories)
        for left in range(1, 6) for right in range(1, 6)
    ) / coincidence_total

    expected_sum = 0.0
    for left in range(1, 6):
        for right in range(1, 6):
            if left == right:
                expected_pairs = counts.get(left, 0) * (counts.get(left, 0) - 1)
            else:
                expected_pairs = counts.get(left, 0) * counts.get(right, 0)
            expected_sum += (expected_pairs / (total - 1)) * _distance(left, right, categories)
    expected = expected_sum / total
    if expected <= 1e-15:
        return {"status": "not_estimable", "alpha": None,
                "reason": "Expected disagreement is numerically zero.",
                "items": len(valid), "ratings": total,
                "observed_disagreement": observed, "expected_disagreement": expected}

    return {
        "status": "estimated",
        "alpha": 1.0 - observed / expected,
        "items": len(valid),
        "ratings": total,
        "categories_used": sorted(counts),
        "observed_disagreement": observed,
        "expected_disagreement": expected,
    }


def quadratic_weighted_cohen_kappa(left: list[int], right: list[int]) -> dict[str, object]:
    if len(left) != len(right):
        raise ValueError("Both raters must score the same number of items.")
    if len(left) < 2:
        return {
            "status": "not_estimable",
            "kappa": None,
            "items": len(left),
            "reason": "At least two commonly rated items are required.",
        }
    if any(
        not isinstance(score, int) or isinstance(score, bool) or score not in {1, 2, 3, 4, 5}
        for score in (*left, *right)
    ):
        raise ValueError("Quadratic weighted Cohen's kappa requires integer ratings from 1 to 5.")

    total = len(left)
    observed = [[0] * 5 for _ in range(5)]
    for first, second in zip(left, right, strict=True):
        observed[first - 1][second - 1] += 1

    row_totals = [sum(row) for row in observed]
    column_totals = [
        sum(observed[row][column] for row in range(5))
        for column in range(5)
    ]
    observed_agreement = 0.0
    expected_agreement = 0.0

    for row in range(5):
        for column in range(5):
            weight = 1.0 - ((row - column) / 4.0) ** 2
            observed_agreement += weight * observed[row][column] / total
            expected_agreement += (
                weight * row_totals[row] * column_totals[column] / (total * total)
            )

    denominator = 1.0 - expected_agreement
    if denominator <= 1e-15:
        return {
            "status": "not_estimable",
            "kappa": None,
            "items": total,
            "weighting": "quadratic",
            "reason": "Expected weighted disagreement is zero.",
            "observed_weighted_agreement": observed_agreement,
            "expected_weighted_agreement": expected_agreement,
        }

    return {
        "status": "estimated",
        "kappa": (observed_agreement - expected_agreement) / denominator,
        "items": total,
        "weighting": "quadratic",
        "observed_weighted_agreement": observed_agreement,
        "expected_weighted_agreement": expected_agreement,
    }


def _percentile(values: list[float], probability: float) -> float:
    ordered = sorted(values)
    index = (len(ordered) - 1) * probability
    low = int(index)
    high = min(low + 1, len(ordered) - 1)
    fraction = index - low
    return ordered[low] * (1 - fraction) + ordered[high] * fraction


def clustered_bootstrap_ci(
    units: dict[str, list[int]],
    cluster_by_item: dict[str, str],
    *,
    seed: int = 42,
    repetitions: int = 2000,
) -> dict[str, object]:
    if repetitions < 200:
        raise ValueError("At least 200 bootstrap repetitions are required.")
    clusters: dict[str, list[str]] = defaultdict(list)
    for item_id in units:
        cluster = cluster_by_item.get(item_id)
        if cluster is None:
            raise ValueError(f"Missing prompt-cluster assignment for {item_id}.")
        clusters[cluster].append(item_id)
    cluster_ids = sorted(clusters)
    if len(cluster_ids) < 2:
        return {"status": "not_estimable", "lower": None, "upper": None,
                "clusters": len(cluster_ids), "valid_repetitions": 0,
                "reason": "At least two independent prompt clusters are required."}

    rng = random.Random(seed)
    samples: list[float] = []
    for draw in range(repetitions):
        boot: dict[str, list[int]] = {}
        for occurrence in range(len(cluster_ids)):
            selected = rng.choice(cluster_ids)
            for item_id in clusters[selected]:
                boot[f"{occurrence}:{item_id}"] = units[item_id]
        estimate = krippendorff_alpha_ordinal(boot)
        if estimate["status"] == "estimated":
            samples.append(float(estimate["alpha"]))

    if len(samples) < max(100, int(repetitions * 0.8)):
        return {"status": "not_estimable", "lower": None, "upper": None,
                "clusters": len(cluster_ids), "valid_repetitions": len(samples),
                "reason": "Too many bootstrap draws had zero expected disagreement."}
    return {
        "status": "estimated",
        "lower": _percentile(samples, 0.025),
        "upper": _percentile(samples, 0.975),
        "clusters": len(cluster_ids),
        "valid_repetitions": len(samples),
        "requested_repetitions": repetitions,
        "method": "percentile bootstrap resampling whole identical-prompt clusters",
    }


def _load_inputs(run_dir: Path, scores_path: Path):
    blind: dict[str, str] = {}
    with (run_dir / "blind-evaluation.jsonl").open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            case_id, prompt = row.get("case_id"), row.get("prompt")
            if not isinstance(case_id, str) or not case_id.strip() or case_id in blind:
                raise ValueError(f"Invalid or duplicate case_id in blind package at line {line_number}.")
            if not isinstance(prompt, str) or not prompt.strip():
                raise ValueError(f"Missing prompt in blind package for {case_id}.")
            blind[case_id] = " ".join(prompt.split()).casefold()
    if not blind:
        raise ValueError("Blind evaluation package is empty.")

    rows = []
    seen: set[tuple[str, str]] = set()
    evaluators_by_case: dict[str, set[str]] = defaultdict(set)
    with scores_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)) or set(headers) != set(ALLOWED_COLUMNS):
            raise ValueError("Score CSV must contain exactly the approved evaluator_id, case_id and six score columns.")
        for line_number, row in enumerate(reader, start=2):
            evaluator = str(row.get("evaluator_id") or "").strip()
            case_id = str(row.get("case_id") or "").strip()
            if not evaluator or not evaluator.replace("_", "").replace("-", "").isalnum():
                raise ValueError(f"Invalid pseudonymous evaluator_id at CSV line {line_number}.")
            if case_id not in blind:
                raise ValueError(f"Unknown case_id at CSV line {line_number}.")
            if (evaluator, case_id) in seen:
                raise ValueError(f"Duplicate evaluator/case pair at CSV line {line_number}.")
            seen.add((evaluator, case_id))
            evaluators_by_case[case_id].add(evaluator)
            cleaned = {"evaluator_id": evaluator, "case_id": case_id}
            for column in SCORE_COLUMNS:
                raw = str(row.get(column) or "").strip()
                try:
                    score = int(raw)
                except ValueError as exc:
                    raise ValueError(f"Invalid score at CSV line {line_number}, {column}.") from exc
                if str(score) != raw or score not in {1, 2, 3, 4, 5}:
                    raise ValueError(f"Score must be an integer from 1 to 5 at CSV line {line_number}, {column}.")
                cleaned[column] = score
            rows.append(cleaned)

    if not rows:
        raise ValueError("No evaluator scores found.")
    missing = set(blind) - set(evaluators_by_case)
    under_reviewed = [case for case, evaluators in evaluators_by_case.items() if len(evaluators) < 2]
    if missing or under_reviewed:
        raise ValueError(
            f"Every blinded pair requires at least two independent evaluators; "
            f"missing={len(missing)}, under_reviewed={len(under_reviewed)}."
        )
    return blind, rows


def analyze(run_dir: Path, scores_path: Path, *, seed: int = 42, repetitions: int = 2000):
    blind, rows = _load_inputs(run_dir, scores_path)
    cluster_for_case = {
        case_id: hashlib.sha256(prompt.encode("utf-8")).hexdigest()
        for case_id, prompt in blind.items()
    }
    report: dict[str, object] = {
        "analysis_type": "blinded ordinal inter-rater reliability",
        "coefficient": "Ordinal Krippendorff alpha; quadratic weighted Cohen kappa when exactly two evaluators",
        "rating_scale": "1-5",
        "cases": len(blind),
        "unique_prompt_clusters": len(set(cluster_for_case.values())),
        "evaluators": len({str(row["evaluator_id"]) for row in rows}),
        "dimensions": {},
        "interpretation_note": (
            "Both blinded response positions are treated as separate rated items. "
            "The confidence interval resamples whole identical-prompt clusters. "
            "If expected disagreement is zero, coefficients are marked not_estimable, never replaced with 1. "
            "Quadratic weighted Cohen kappa is calculated only when exactly two evaluators are present; "
            "ordinal Krippendorff alpha remains the multi-rater measure."
        ),
        "warnings": [],
        "privacy_note": "Evaluator IDs, individual scores, prompts and response texts are excluded from this report.",
    }
    if report["unique_prompt_clusters"] < 20:
        report["warnings"].append(
            "Fewer than 20 independent prompt clusters: reliability estimates and clustered intervals are exploratory."
        )

    evaluator_ids = sorted({str(row["evaluator_id"]) for row in rows})

    for dimension in DIMENSIONS:
        units: dict[str, list[int]] = {}
        clusters: dict[str, str] = {}
        for case_id in blind:
            for response in (1, 2):
                item = f"{case_id}::response_{response}"
                units[item] = []
                clusters[item] = cluster_for_case[case_id]
        for row in rows:
            case_id = str(row["case_id"])
            for response in (1, 2):
                units[f"{case_id}::response_{response}"].append(
                    int(row[f"response_{response}_{dimension}"])
                )
        point = krippendorff_alpha_ordinal(units)
        interval = (
            clustered_bootstrap_ci(units, clusters, seed=seed, repetitions=repetitions)
            if point["status"] == "estimated"
            else {"status": "not_estimable", "lower": None, "upper": None,
                  "reason": point["reason"]}
        )
        weighted_kappa: dict[str, object]
        if len(evaluator_ids) != 2:
            weighted_kappa = {
                "status": "not_applicable",
                "kappa": None,
                "raters": len(evaluator_ids),
                "reason": "Quadratic weighted Cohen kappa requires exactly two evaluators; use ordinal Krippendorff alpha for multi-rater data.",
            }
        else:
            paired_scores: dict[str, dict[str, int]] = {
                item: {} for item in units
            }
            for row in rows:
                evaluator = str(row["evaluator_id"])
                case_id = str(row["case_id"])
                for response in (1, 2):
                    item = f"{case_id}::response_{response}"
                    paired_scores[item][evaluator] = int(
                        row[f"response_{response}_{dimension}"]
                    )
            complete_pairs = [
                (ratings[evaluator_ids[0]], ratings[evaluator_ids[1]])
                for ratings in paired_scores.values()
                if evaluator_ids[0] in ratings and evaluator_ids[1] in ratings
            ]
            if len(complete_pairs) != len(paired_scores):
                weighted_kappa = {
                    "status": "not_estimable",
                    "kappa": None,
                    "raters": 2,
                    "items": len(complete_pairs),
                    "reason": "Both evaluators must rate every response item for paired Cohen kappa.",
                }
            else:
                weighted_kappa = {
                    **quadratic_weighted_cohen_kappa(
                        [pair[0] for pair in complete_pairs],
                        [pair[1] for pair in complete_pairs],
                    ),
                    "raters": 2,
                }
        report["dimensions"][dimension] = {
            "point_estimate": point,
            "clustered_95_percent_ci": interval,
            "quadratic_weighted_cohen_kappa": weighted_kappa,
        }
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Calculate ordinal Krippendorff alpha for blinded A/B ratings.")
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--scores", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--bootstrap-repetitions", type=int, default=2000)
    args = parser.parse_args()
    scores = args.scores or args.run_dir / "evaluator-scores.csv"
    output = args.output or args.run_dir / "reliability-report.json"
    report = analyze(args.run_dir, scores, seed=args.seed, repetitions=args.bootstrap_repetitions)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    print(f"Reliability report: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
