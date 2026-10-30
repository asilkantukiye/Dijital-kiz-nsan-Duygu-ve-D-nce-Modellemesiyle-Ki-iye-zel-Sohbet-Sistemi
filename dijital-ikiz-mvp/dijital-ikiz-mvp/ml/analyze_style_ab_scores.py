from __future__ import annotations

import argparse
import csv
import hashlib
import json
import random
import statistics
from collections import defaultdict
from itertools import product
from pathlib import Path
from typing import Iterable, Mapping

DIMENSIONS = ("style_fit", "relevance", "coherence")
SCORE_COLUMNS = tuple(
    f"response_{response}_{dimension}"
    for dimension in DIMENSIONS
    for response in (1, 2)
)
ALLOWED_COLUMNS = ("evaluator_id", "case_id", *SCORE_COLUMNS)
CONDITIONS = {"baseline", "personalized"}


def _load_blind_rows(path: Path) -> dict[str, dict[str, str]]:
    rows: dict[str, dict[str, str]] = {}
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Kör paket satırı {line_number} geçerli JSON değil.") from exc

            if not isinstance(row, dict):
                raise ValueError(f"Kör paket satırı {line_number} nesne olmalı.")
            case_id = row.get("case_id")
            if not isinstance(case_id, str) or not case_id.strip():
                raise ValueError(f"Kör paket satırı {line_number}: case_id boş.")
            case_id = case_id.strip()
            if case_id in rows:
                raise ValueError(f"Kör pakette yinelenen case_id: {case_id}")

            forbidden = {"condition", "variant", "response_1_condition", "response_2_condition"}
            if forbidden.intersection(row):
                raise ValueError(f"Kör paket koşul bilgisini açığa çıkarıyor: {case_id}")

            for field in ("response_1", "response_2", "prompt", "target_style"):
                if not isinstance(row.get(field), str) or not row[field].strip():
                    raise ValueError(f"Kör paket {case_id}: {field} boş veya geçersiz.")

            rows[case_id] = {
                "prompt": " ".join(row["prompt"].split()).casefold(),
                "response_1": row["response_1"],
                "response_2": row["response_2"],
                "target_style": row["target_style"],
            }

    if not rows:
        raise ValueError("Kör değerlendirme paketi boş.")
    return rows


def _load_condition_key(path: Path, case_ids: set[str]) -> dict[str, dict[str, str]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Koşul anahtarı geçerli JSON değil.") from exc

    if not isinstance(raw, list):
        raise ValueError("Koşul anahtarı bir JSON dizisi olmalı.")

    key: dict[str, dict[str, str]] = {}
    for row in raw:
        if not isinstance(row, dict):
            raise ValueError("Koşul anahtarındaki her kayıt nesne olmalı.")
        case_id = row.get("case_id")
        first = row.get("response_1_condition")
        second = row.get("response_2_condition")
        if not isinstance(case_id, str) or not case_id.strip():
            raise ValueError("Koşul anahtarında case_id boş.")
        if case_id in key:
            raise ValueError(f"Koşul anahtarında yinelenen case_id: {case_id}")
        if {first, second} != CONDITIONS:
            raise ValueError(f"{case_id}: koşul anahtarı baseline/personalized eşleşmesi değil.")
        key[case_id] = {
            "response_1_condition": first,
            "response_2_condition": second,
        }

    if set(key) != case_ids:
        raise ValueError("Kör paket ve koşul anahtarındaki case_id kümeleri eşleşmiyor.")
    return key


def _parse_score(value: object, *, row_number: int, column: str) -> int:
    raw = str(value if value is not None else "").strip()
    try:
        score = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"CSV satırı {row_number}: {column} 1–5 arasında tam sayı olmalı."
        ) from exc
    if str(score) != raw or not 1 <= score <= 5:
        raise ValueError(
            f"CSV satırı {row_number}: {column} 1–5 arasında tam sayı olmalı."
        )
    return score


def _load_scores(path: Path, case_ids: set[str]) -> list[dict[str, object]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)):
            raise ValueError("Puanlama CSV dosyasında yinelenen kolon adı var.")
        missing = set(ALLOWED_COLUMNS) - set(headers)
        extra = set(headers) - set(ALLOWED_COLUMNS)
        if missing or extra:
            details = []
            if missing:
                details.append("eksik: " + ", ".join(sorted(missing)))
            if extra:
                details.append("izin verilmeyen: " + ", ".join(sorted(extra)))
            raise ValueError("Puanlama CSV kolonları geçersiz (" + "; ".join(details) + ").")

        cleaned: list[dict[str, object]] = []
        seen: set[tuple[str, str]] = set()
        evaluators_by_case: dict[str, set[str]] = defaultdict(set)

        for row_number, row in enumerate(reader, start=2):
            evaluator_id = str(row.get("evaluator_id") or "").strip()
            case_id = str(row.get("case_id") or "").strip()
            if not evaluator_id or len(evaluator_id) > 64 or not evaluator_id.replace("_", "").replace("-", "").isalnum():
                raise ValueError(
                    f"CSV satırı {row_number}: evaluator_id kısa, takma ve boşluksuz bir kod olmalı."
                )
            if case_id not in case_ids:
                raise ValueError(f"CSV satırı {row_number}: bilinmeyen case_id.")
            pair = (evaluator_id, case_id)
            if pair in seen:
                raise ValueError(
                    f"CSV satırı {row_number}: aynı değerlendirici aynı çifti iki kez puanlamış."
                )
            seen.add(pair)
            evaluators_by_case[case_id].add(evaluator_id)

            scores = {
                column: _parse_score(row.get(column), row_number=row_number, column=column)
                for column in SCORE_COLUMNS
            }
            cleaned.append({
                "evaluator_id": evaluator_id,
                "case_id": case_id,
                **scores,
            })

    if not cleaned:
        raise ValueError("Puanlama CSV dosyasında sonuç bulunamadı.")

    missing_cases = case_ids - set(evaluators_by_case)
    if missing_cases:
        raise ValueError(
            "Bazı kör çiftler puanlanmamış: " + ", ".join(sorted(missing_cases)[:5])
        )

    under_reviewed = [
        case_id for case_id, evaluators in evaluators_by_case.items()
        if len(evaluators) < 2
    ]
    if under_reviewed:
        raise ValueError(
            "Her kör çift en az iki bağımsız değerlendirici tarafından puanlanmalı; "
            "eksik çift sayısı: " + str(len(under_reviewed))
        )

    return cleaned


def _bootstrap_ci(
    values: list[float],
    *,
    seed: int,
    repetitions: int,
) -> list[float]:
    if not values or repetitions < 100:
        raise ValueError("Bootstrap için veri ve en az 100 tekrar gerekli.")
    rng = random.Random(seed)
    count = len(values)
    estimates = sorted(
        statistics.mean(rng.choice(values) for _ in range(count))
        for _ in range(repetitions)
    )

    def quantile(probability: float) -> float:
        position = (len(estimates) - 1) * probability
        lower = int(position)
        upper = min(lower + 1, len(estimates) - 1)
        fraction = position - lower
        return estimates[lower] * (1 - fraction) + estimates[upper] * fraction

    return [quantile(0.025), quantile(0.975)]


def _sign_flip_test(
    values: list[float],
    *,
    seed: int,
    repetitions: int,
) -> dict[str, object]:
    if not values:
        raise ValueError("Permütasyon testi için en az bir prompt kümesi gerekli.")
    observed = abs(statistics.mean(values))
    epsilon = 1e-12
    count = len(values)

    if count <= 15:
        extreme = sum(
            abs(statistics.mean(value * sign for value, sign in zip(values, signs)))
            + epsilon >= observed
            for signs in product((-1, 1), repeat=count)
        )
        total = 2 ** count
        return {
            "method": "exact paired sign-flip permutation",
            "p_value_two_sided": extreme / total,
            "permutations": total,
        }

    if repetitions < 100:
        raise ValueError("Monte Carlo permütasyon tekrarı en az 100 olmalı.")
    rng = random.Random(seed)
    extreme = 0
    for _ in range(repetitions):
        permuted = abs(
            statistics.mean(value * rng.choice((-1, 1)) for value in values)
        )
        if permuted + epsilon >= observed:
            extreme += 1
    return {
        "method": "Monte Carlo paired sign-flip permutation",
        "p_value_two_sided": (extreme + 1) / (repetitions + 1),
        "permutations": repetitions,
    }


def analyze_style_ab_scores(
    run_dir: Path,
    scores_path: Path,
    *,
    seed: int = 42,
    bootstrap_repetitions: int = 10_000,
    permutation_repetitions: int = 10_000,
) -> dict[str, object]:
    blind_path = run_dir / "blind-evaluation.jsonl"
    key_path = run_dir / "condition-key.json"
    manifest_path = run_dir / "run-manifest.json"

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("Deney manifest'i geçerli JSON değil.") from exc
    if not isinstance(manifest, dict) or not isinstance(manifest.get("model_alias"), str):
        raise ValueError("Deney manifest'inde model_alias bulunmalı.")

    blind = _load_blind_rows(blind_path)
    condition_key = _load_condition_key(key_path, set(blind))
    score_rows = _load_scores(scores_path, set(blind))

    by_case: dict[str, dict[str, dict[str, list[int]]]] = {
        case_id: {
            dimension: {"baseline": [], "personalized": []}
            for dimension in DIMENSIONS
        }
        for case_id in blind
    }
    evaluators: set[str] = set()
    evaluators_by_case: dict[str, set[str]] = defaultdict(set)

    for row in score_rows:
        evaluator_id = str(row["evaluator_id"])
        case_id = str(row["case_id"])
        evaluators.add(evaluator_id)
        evaluators_by_case[case_id].add(evaluator_id)
        mapping = condition_key[case_id]
        for dimension in DIMENSIONS:
            first_score = int(row[f"response_1_{dimension}"])
            second_score = int(row[f"response_2_{dimension}"])
            by_case[case_id][dimension][mapping["response_1_condition"]].append(first_score)
            by_case[case_id][dimension][mapping["response_2_condition"]].append(second_score)

    case_effects: dict[str, dict[str, float]] = {dimension: {} for dimension in DIMENSIONS}
    condition_means: dict[str, dict[str, list[float]]] = {
        dimension: {"baseline": [], "personalized": []}
        for dimension in DIMENSIONS
    }

    for case_id, dimensions in by_case.items():
        for dimension in DIMENSIONS:
            baseline_values = dimensions[dimension]["baseline"]
            personalized_values = dimensions[dimension]["personalized"]
            if not baseline_values or not personalized_values:
                raise ValueError(f"{case_id}: iki koşul için eşleşmiş puan bulunamadı.")
            baseline_mean = statistics.mean(baseline_values)
            personalized_mean = statistics.mean(personalized_values)
            condition_means[dimension]["baseline"].append(baseline_mean)
            condition_means[dimension]["personalized"].append(personalized_mean)
            case_effects[dimension][case_id] = personalized_mean - baseline_mean

    # Identical prompts recur across the three synthetic style profiles.
    # Treat each unique prompt as one inference cluster, not each row as independent.
    prompt_clusters: dict[str, list[str]] = defaultdict(list)
    for case_id, data in blind.items():
        prompt_digest = hashlib.sha256(data["prompt"].encode("utf-8")).hexdigest()
        prompt_clusters[prompt_digest].append(case_id)

    cluster_effects: dict[str, list[float]] = {dimension: [] for dimension in DIMENSIONS}
    for case_ids in prompt_clusters.values():
        for dimension in DIMENSIONS:
            cluster_effects[dimension].append(
                statistics.mean(case_effects[dimension][case_id] for case_id in case_ids)
            )

    dimension_reports: dict[str, dict[str, object]] = {}
    for dimension in DIMENSIONS:
        baseline_mean = statistics.mean(condition_means[dimension]["baseline"])
        personalized_mean = statistics.mean(condition_means[dimension]["personalized"])
        prompt_effects = cluster_effects[dimension]
        dimension_reports[dimension] = {
            "baseline_mean_1_to_5": baseline_mean,
            "personalized_mean_1_to_5": personalized_mean,
            "mean_case_difference_personalized_minus_baseline": statistics.mean(
                case_effects[dimension].values()
            ),
            "mean_prompt_cluster_difference": statistics.mean(prompt_effects),
        }

    primary_effects = cluster_effects["style_fit"]
    warnings = [
        "Bu analiz yalnızca değerlendiricilerin yanıt üslubu/uygunluğu puanlarını inceler; duygu, VAD, Big Five, psikolojik fayda veya kimlik taklidi doğruluğunu ölçmez.",
        "Sentetik pilot örnekleri gerçek kullanıcı davranışına genellenemez.",
        "Koşul anahtarı yalnızca bütün değerlendirici puanları tamamlandıktan sonra analiz için açılmalıdır.",
        "Bu betik değerlendiriciler arası güvenilirlik katsayısı hesaplamaz; ayrı ve önceden belirlenmiş bir uyum analizi gerekir.",
    ]
    if len(prompt_clusters) < 10:
        warnings.append(
            "10'dan az benzersiz istem kümesi var; güven aralığı ve permütasyon sonucu keşifsel kabul edilmelidir."
        )

    minimum_raters = min(len(values) for values in evaluators_by_case.values())
    maximum_raters = max(len(values) for values in evaluators_by_case.values())

    return {
        "analysis_type": "blinded paired style-personalization evaluation",
        "primary_outcome": "style_fit",
        "rating_scale": "1-5",
        "model_alias": manifest["model_alias"],
        "cases_scored": len(blind),
        "prompt_clusters": len(prompt_clusters),
        "evaluators_total": len(evaluators),
        "evaluators_per_case": {
            "minimum": minimum_raters,
            "maximum": maximum_raters,
        },
        "dimensions": dimension_reports,
        "primary_clustered_inference": {
            "outcome": "style_fit",
            "cluster_unit": "identical prompt text across target style profiles",
            "cluster_count": len(primary_effects),
            "mean_difference_personalized_minus_baseline": statistics.mean(primary_effects),
            "bootstrap_95_percent_ci": _bootstrap_ci(
                primary_effects,
                seed=seed,
                repetitions=bootstrap_repetitions,
            ),
            "two_sided_sign_flip_permutation": _sign_flip_test(
                primary_effects,
                seed=seed,
                repetitions=permutation_repetitions,
            ),
        },
        "warnings": warnings,
        "scientific_note": (
            "Positive style_fit difference means the personalized response received a higher "
            "blind style-match rating. Inference resamples/sign-flips unique prompt clusters "
            "because the same prompt is reused across synthetic style profiles. Secondary "
            "dimensions are descriptive only; no unplanned significance claims are produced."
        ),
        "privacy_note": (
            "Evaluator identifiers, raw scores by evaluator, prompts and response text are "
            "excluded from this report."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyse blinded, paired human ratings for the synthetic style A/B pilot."
    )
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--scores", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--bootstrap-repetitions", type=int, default=10_000)
    parser.add_argument("--permutation-repetitions", type=int, default=10_000)
    args = parser.parse_args()

    run_dir = args.run_dir
    scores_path = args.scores or (run_dir / "evaluator-scores.csv")
    output_path = args.output or (run_dir / "analysis-report.json")

    try:
        report = analyze_style_ab_scores(
            run_dir,
            scores_path,
            seed=args.seed,
            bootstrap_repetitions=args.bootstrap_repetitions,
            permutation_repetitions=args.permutation_repetitions,
        )
    except (OSError, ValueError, csv.Error, json.JSONDecodeError) as exc:
        raise SystemExit(str(exc)) from exc

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False))
    print(f"Analiz raporu: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
