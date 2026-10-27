from __future__ import annotations

import argparse
import hashlib
import json
import os
import unicodedata
import urllib.request
from pathlib import Path

import numpy as np
import pandas as pd
import sklearn
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split

DATASET = "winvoker/turkish-sentiment-analysis-dataset"
DATA_REVISION = "ef87c7a2a7199a8b721c99425933316d35f9af2f"
BASE_URL = f"https://huggingface.co/datasets/{DATASET}/resolve/{DATA_REVISION}"
SEED = 42
LABELS = ["negative", "neutral", "positive"]


def canonical_label(value: object) -> str | None:
    text = unicodedata.normalize("NFKD", str(value)).casefold()
    text = "".join(c for c in text if not unicodedata.combining(c)).replace("ı", "i").strip()
    return {
        "positive": "positive",
        "pozitif": "positive",
        "olumlu": "positive",
        "negative": "negative",
        "negatif": "negative",
        "olumsuz": "negative",
        "neutral": "neutral",
        "notr": "neutral",
        "neutral sentiment": "neutral",
    }.get(text)


def clean_frame(frame: pd.DataFrame, name: str) -> pd.DataFrame:
    if not {"text", "label"}.issubset(frame.columns):
        raise ValueError(f"{name}: text and label columns are required.")

    result = frame[["text", "label"]].copy()
    result["text"] = (
        result["text"]
        .fillna("")
        .astype(str)
        .str.replace(r"[\x00-\x1F\x7F]", " ", regex=True)
        .str.replace(r"\s+", " ", regex=True)
        .str.strip()
    )
    result["label"] = result["label"].map(canonical_label)
    result = result[(result["text"] != "") & result["label"].notna()].copy()
    result["_key"] = result["text"].map(lambda value: unicodedata.normalize("NFKC", value).casefold())

    conflicts = result.groupby("_key")["label"].nunique()
    conflict_keys = set(conflicts[conflicts > 1].index)
    result = (
        result[~result["_key"].isin(conflict_keys)]
        .drop_duplicates("_key", keep="first")
        .reset_index(drop=True)
    )
    if result.empty:
        raise ValueError(f"{name}: no usable rows remain after normalization.")
    return result


def stratified_limit(frame: pd.DataFrame, limit: int, seed: int = SEED) -> pd.DataFrame:
    if limit < 1:
        raise ValueError("limit must be positive.")
    if frame["label"].nunique() != len(LABELS):
        raise ValueError("All three polarity labels must be present before sampling.")

    if len(frame) <= limit:
        return frame.sample(frac=1, random_state=seed).reset_index(drop=True)

    classes = sorted(frame["label"].unique())
    per_class = max(1, limit // len(classes))
    parts = [
        frame[frame["label"] == label].sample(
            n=min(len(frame[frame["label"] == label]), per_class),
            random_state=seed + index,
        )
        for index, label in enumerate(classes)
    ]
    result = pd.concat(parts).sample(frac=1, random_state=seed).reset_index(drop=True)
    if result["label"].nunique() != len(LABELS):
        raise ValueError("Stratified sample dropped one or more labels.")
    return result


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_if_missing(path: Path, filename: str) -> None:
    if path.is_file() and path.stat().st_size > 0:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        f"{BASE_URL}/{filename}?download=true",
        headers={"User-Agent": "dijital-ikiz-polarity-baseline/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response, path.open("wb") as output:
        output.write(response.read())


def run_baseline(train_csv: Path, test_csv: Path) -> dict:
    train_df = clean_frame(pd.read_csv(train_csv), "train")
    test_df = clean_frame(pd.read_csv(test_csv), "test")
    test_keys = set(test_df["_key"])
    before = len(train_df)
    train_df = train_df[~train_df["_key"].isin(test_keys)].reset_index(drop=True)
    overlap_removed = before - len(train_df)

    if train_df["label"].nunique() != 3 or test_df["label"].nunique() != 3:
        raise ValueError("Train and test files must each contain all three labels.")
    if min(len(train_df), len(test_df)) < 30:
        raise ValueError("Train or test split is too small.")

    train_pool, validation_pool = train_test_split(
        train_df,
        test_size=0.1,
        random_state=SEED,
        stratify=train_df["label"],
    )
    train_pilot = stratified_limit(train_pool, 15_000, SEED)
    validation_pilot = stratified_limit(validation_pool, 3_000, SEED + 1)
    test_pilot = stratified_limit(test_df, 3_000, SEED + 2)

    vectorizer = TfidfVectorizer(
        lowercase=True,
        strip_accents=None,
        ngram_range=(1, 2),
        min_df=2,
        max_df=0.98,
        max_features=200_000,
        sublinear_tf=True,
        dtype=np.float32,
    )
    x_train = vectorizer.fit_transform(train_pilot["text"].astype(str))
    x_test = vectorizer.transform(test_pilot["text"].astype(str))
    model = LogisticRegression(
        C=2.0,
        max_iter=1_000,
        solver="lbfgs",
        random_state=SEED,
    )
    model.fit(x_train, train_pilot["label"])
    predictions = model.predict(x_test)
    truth = test_pilot["label"].tolist()
    majority_label = train_pilot["label"].value_counts().idxmax()
    majority_predictions = [majority_label] * len(truth)

    test_metrics = {
        "accuracy": float(accuracy_score(truth, predictions)),
        "f1_macro": float(f1_score(truth, predictions, average="macro", labels=LABELS, zero_division=0)),
        "f1_weighted": float(f1_score(truth, predictions, average="weighted", labels=LABELS, zero_division=0)),
        "per_class": classification_report(
            truth, predictions, labels=LABELS, output_dict=True, zero_division=0
        ),
        "confusion_matrix_negative_neutral_positive": confusion_matrix(
            truth, predictions, labels=LABELS
        ).tolist(),
    }
    majority_baseline = {
        "majority_class": str(majority_label),
        "accuracy": float(accuracy_score(truth, majority_predictions)),
        "f1_macro": float(f1_score(truth, majority_predictions, average="macro", labels=LABELS, zero_division=0)),
    }

    return {
        "task": "Turkish sentiment polarity: negative/neutral/positive",
        "baseline_model": "TF-IDF word uni/bigrams + LogisticRegression",
        "dataset": DATASET,
        "dataset_revision": DATA_REVISION,
        "seed": SEED,
        "split_policy": "matches the Kaggle polarite pilot's clean/overlap removal, 90/10 train/validation split, and seeded stratified limits",
        "train_rows": int(len(train_pilot)),
        "validation_rows": int(len(validation_pilot)),
        "test_rows": int(len(test_pilot)),
        "training_rows_removed_due_to_test_overlap": int(overlap_removed),
        "train_source_sha256": sha256_file(train_csv),
        "test_source_sha256": sha256_file(test_csv),
        "vectorizer": {
            "ngram_range": [1, 2],
            "min_df": 2,
            "max_df": 0.98,
            "max_features": 200_000,
            "sublinear_tf": True,
        },
        "classifier": {"class": "LogisticRegression", "C": 2.0, "solver": "lbfgs", "max_iter": 1_000},
        "majority_class_baseline": majority_baseline,
        "test_metrics": test_metrics,
        "dependencies": {"pandas": pd.__version__, "numpy": np.__version__, "scikit_learn": sklearn.__version__},
        "scientific_limitations": [
            "This baseline uses the same published corpus/test sample as the transformer pilot, so it does not resolve source-composition or corpus-specific shortcut risks.",
            "The dataset README states that some neutral examples come from a Turkish Wikipedia dump and random text; an independent natural-conversation/source-held-out evaluation is still required.",
            "Polarity classification is not VAD regression, Big Five personality prediction, or a measure of personalized chat quality.",
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a reproducible CPU-only TF-IDF polarity baseline.")
    parser.add_argument("--train-csv", type=Path, help="Optional local train.csv.")
    parser.add_argument("--test-csv", type=Path, help="Optional local test.csv.")
    parser.add_argument("--output", type=Path, default=Path("artifacts/polarity-tfidf-baseline.json"))
    args = parser.parse_args()

    if bool(args.train_csv) != bool(args.test_csv):
        parser.error("--train-csv and --test-csv must be provided together.")

    if args.train_csv and args.test_csv:
        train_csv, test_csv = args.train_csv, args.test_csv
    else:
        data_dir = Path(os.environ.get("POLARITY_DATA_DIR", ".cache/polarity-dataset"))
        train_csv, test_csv = data_dir / "train.csv", data_dir / "test.csv"
        download_if_missing(train_csv, "train.csv")
        download_if_missing(test_csv, "test.csv")

    report = run_baseline(train_csv, test_csv)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = (
        "# TF-IDF polarity baseline benchmark\n\n"
        f"- Dataset revision: {report['dataset_revision']}\n"
        f"- Train / validation / test: {report['train_rows']} / {report['validation_rows']} / {report['test_rows']}\n"
        f"- Accuracy: {report['test_metrics']['accuracy']:.4f}\n"
        f"- Macro-F1: {report['test_metrics']['f1_macro']:.4f}\n"
        f"- Weighted-F1: {report['test_metrics']['f1_weighted']:.4f}\n"
        f"- Majority baseline accuracy / macro-F1: {report['majority_class_baseline']['accuracy']:.4f} / "
        f"{report['majority_class_baseline']['f1_macro']:.4f}\n\n"
        "Interpret alongside the BERTurk result with the same sampled test set. This baseline does not remove corpus/source artifact risks.\n"
    )
    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as stream:
            stream.write(summary)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
