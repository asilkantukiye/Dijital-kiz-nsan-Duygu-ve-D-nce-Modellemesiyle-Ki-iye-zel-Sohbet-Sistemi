from __future__ import annotations

import argparse
import json
import math
import platform
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import transformers
from torch import nn
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModel, AutoTokenizer

from data.provenance import validate_provenance
from data.run_manifest import build_split_manifest
from data.regression_metrics import calculate_regression_metrics
from data.split_integrity import validate_split_integrity


class TextRegressionDataset(Dataset):
    def __init__(self, frame: pd.DataFrame, tokenizer, labels: list[str], max_length: int):
        self.frame = frame.reset_index(drop=True)
        self.tokenizer = tokenizer
        self.labels = labels
        self.max_length = max_length

    def __len__(self) -> int:
        return len(self.frame)

    def __getitem__(self, index: int):
        row = self.frame.iloc[index]
        encoded = self.tokenizer(
            str(row["text"]),
            truncation=True,
            padding="max_length",
            max_length=self.max_length,
            return_tensors="pt",
        )

        targets = torch.tensor(
            [float(row[label]) for label in self.labels],
            dtype=torch.float32,
        )

        return {
            "input_ids": encoded["input_ids"].squeeze(0),
            "attention_mask": encoded["attention_mask"].squeeze(0),
            "labels": targets,
        }


class TransformerRegressor(nn.Module):
    def __init__(
        self,
        model_name: str,
        output_dim: int,
        dropout: float = 0.1,
        revision: str | None = None,
    ):
        super().__init__()
        model_kwargs = {"revision": revision} if revision else {}
        self.encoder = AutoModel.from_pretrained(model_name, **model_kwargs)
        hidden_size = self.encoder.config.hidden_size
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, output_dim)

    def forward(self, input_ids, attention_mask):
        outputs = self.encoder(input_ids=input_ids, attention_mask=attention_mask)
        pooled = outputs.last_hidden_state[:, 0]
        return self.head(self.dropout(pooled))


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def load_split(path: Path, labels: list[str]) -> pd.DataFrame:
    frame = pd.read_csv(path)

    required = {"sample_id", "participant_id", "text", *labels}
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"{path} eksik kolonlar: {sorted(missing)}")

    # Direct training entry points must enforce the same provenance policy as
    # the standalone CSV validator; never let an ad-hoc split bypass it.
    validate_provenance(
        frame.columns,
        frame.to_dict(orient="records"),
        str(path),
    )

    for column in ("sample_id", "participant_id", "text"):
        if frame[column].isna().any():
            raise ValueError(f"{path}: {column} boş değer içeriyor.")
        frame[column] = frame[column].astype(str).str.strip()
        if frame[column].eq("").any():
            raise ValueError(f"{path}: {column} boş değer içeriyor.")

    if frame["sample_id"].duplicated().any():
        raise ValueError(f"{path}: tekrarlanan sample_id bulundu.")

    for label in labels:
        frame[label] = pd.to_numeric(frame[label], errors="coerce")
        if frame[label].isna().any():
            raise ValueError(f"{path}: {label} sayısal olmayan veya boş etiket içeriyor.")
        if not np.isfinite(frame[label].to_numpy(dtype=float)).all():
            raise ValueError(f"{path}: {label} sonlu olmayan etiket içeriyor.")
        if ((frame[label] < 0) | (frame[label] > 1)).any():
            raise ValueError(f"{path}: {label} etiketleri 0–1 aralığında olmalı.")

    if frame.empty:
        raise ValueError(f"{path} kullanılabilir etiketli örnek içermiyor.")

    return frame


@torch.no_grad()
def evaluate(model, loader, device, labels):
    model.eval()
    predictions = []
    targets = []

    for batch in loader:
        inputs = {k: batch[k].to(device) for k in ("input_ids", "attention_mask")}
        output = model(**inputs).detach().cpu().numpy()
        target = batch["labels"].numpy()
        predictions.append(output)
        targets.append(target)

    y_pred = np.clip(np.concatenate(predictions), 0, 1)
    y_true = np.concatenate(targets)
    return calculate_regression_metrics(y_true.tolist(), y_pred.tolist(), labels)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--test", type=Path, required=True)
    parser.add_argument("--labels", nargs="+", required=True)
    parser.add_argument("--model", default="dbmdz/bert-base-turkish-cased")
    parser.add_argument(
        "--model-revision",
        default=None,
        help="Hugging Face model revision; değişmez commit SHA kullanılması önerilir.",
    )
    parser.add_argument("--output", type=Path, default=Path("artifacts/regressor"))
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    if not 1 <= len(args.labels) <= 8:
        raise SystemExit("1-8 hedef kolonu destekleniyor.")
    if len(set(args.labels)) != len(args.labels):
        raise SystemExit("Aynı hedef kolonu birden fazla kez seçilemez.")
    if args.epochs < 1 or args.batch_size < 1 or args.max_length < 1:
        raise SystemExit("epochs, batch-size ve max-length pozitif tam sayılar olmalı.")
    if not math.isfinite(args.learning_rate) or args.learning_rate <= 0:
        raise SystemExit("learning-rate pozitif ve sonlu bir sayı olmalı.")

    set_seed(args.seed)

    train = load_split(args.train, args.labels)
    validation = load_split(args.validation, args.labels)
    test = load_split(args.test, args.labels)

    # Refuse to report test metrics if the same participant or sample appears
    # in more than one split. This protects against inflated research results.
    validate_split_integrity({
        "train": (train["participant_id"].tolist(), train["sample_id"].tolist()),
        "validation": (
            validation["participant_id"].tolist(),
            validation["sample_id"].tolist(),
        ),
        "test": (test["participant_id"].tolist(), test["sample_id"].tolist()),
    })

    # Capture hashes before the lengthy training run so the report binds to
    # the input files used for this run, without copying raw rows into output.
    dataset_manifest = {
        "hash_algorithm": "sha256",
        "splits": {
            "train": build_split_manifest(
                args.train, train.to_dict(orient="records"), args.labels
            ),
            "validation": build_split_manifest(
                args.validation, validation.to_dict(orient="records"), args.labels
            ),
            "test": build_split_manifest(
                args.test, test.to_dict(orient="records"), args.labels
            ),
        },
    }

    tokenizer_kwargs = {"revision": args.model_revision} if args.model_revision else {}
    tokenizer = AutoTokenizer.from_pretrained(args.model, **tokenizer_kwargs)

    train_ds = TextRegressionDataset(train, tokenizer, args.labels, args.max_length)
    val_ds = TextRegressionDataset(validation, tokenizer, args.labels, args.max_length)
    test_ds = TextRegressionDataset(test, tokenizer, args.labels, args.max_length)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = TransformerRegressor(
        args.model,
        len(args.labels),
        revision=args.model_revision,
    ).to(device)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    loss_fn = nn.MSELoss()

    best_val = float("inf")
    args.output.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []

        for batch in train_loader:
            optimizer.zero_grad()

            inputs = {
                "input_ids": batch["input_ids"].to(device),
                "attention_mask": batch["attention_mask"].to(device),
            }
            targets = batch["labels"].to(device)

            predictions = model(**inputs)
            loss = loss_fn(predictions, targets)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            losses.append(float(loss.detach().cpu()))

        val_metrics = evaluate(model, val_loader, device, args.labels)
        print(
            f"epoch={epoch} train_mse={np.mean(losses):.5f} "
            f"val_mae={val_metrics['mae']:.5f} val_rmse={val_metrics['rmse']:.5f}"
        )

        if val_metrics["mae"] < best_val:
            best_val = val_metrics["mae"]
            torch.save(model.state_dict(), args.output / "best_model.pt")

    model.load_state_dict(torch.load(args.output / "best_model.pt", map_location=device))
    test_metrics = evaluate(model, test_loader, device, args.labels)

    # A train-mean predictor is a simple, transparent reference baseline. Its
    # means are estimated on train only; the test split remains untouched.
    training_target_mean = train[args.labels].mean().to_numpy(dtype=float)
    baseline_predictions = np.repeat(
        training_target_mean.reshape(1, -1),
        repeats=len(test),
        axis=0,
    )
    baseline_metrics = calculate_regression_metrics(
        test[args.labels].to_numpy(dtype=float).tolist(),
        baseline_predictions.tolist(),
        args.labels,
    )

    report = {
        "model": args.model,
        "labels": args.labels,
        "device": str(device),
        "seed": args.seed,
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "learning_rate": args.learning_rate,
        "max_length": args.max_length,
        "train_rows": len(train),
        "validation_rows": len(validation),
        "test_rows": len(test),
        "model_revision": args.model_revision,
        "model_revision_supplied": args.model_revision is not None,
        "runtime": {
            "python": platform.python_version(),
            "numpy": np.__version__,
            "pandas": pd.__version__,
            "torch": str(torch.__version__),
            "transformers": transformers.__version__,
        },
        "dataset_manifest": dataset_manifest,
        "selection_metric": "validation_mae",
        "baseline": {
            "type": "per_target_train_mean",
            "description": "Her hedef için yalnızca eğitim kümesinin ortalamasını tahmin eder.",
            "test_metrics": baseline_metrics,
        },
        "test_metrics": test_metrics,
        "mae_improvement_over_train_mean_baseline": (
            baseline_metrics["mae"] - test_metrics["mae"]
        ),
        "scientific_note": (
            "Pearson ve Spearman korelasyonları hedef veya tahmin sabit olduğunda null olabilir. "
            "Sonuçlar yalnızca bu katılımcı-ayrılmış test kümesi içindir; gerçek eğitim "
            "çalıştırılmadan başarı iddiası olarak raporlanmamalıdır."
        ),
    }

    with (args.output / "metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)

    tokenizer.save_pretrained(args.output / "tokenizer")
    print(json.dumps({
        "test_metrics": test_metrics,
        "baseline_metrics": baseline_metrics,
        "mae_improvement_over_train_mean_baseline": report["mae_improvement_over_train_mean_baseline"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
