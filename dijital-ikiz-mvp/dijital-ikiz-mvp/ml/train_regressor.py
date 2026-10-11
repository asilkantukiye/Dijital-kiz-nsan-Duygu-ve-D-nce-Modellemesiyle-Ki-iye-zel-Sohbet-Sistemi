from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from torch import nn
from torch.utils.data import DataLoader, Dataset
from transformers import AutoModel, AutoTokenizer

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
    def __init__(self, model_name: str, output_dim: int, dropout: float = 0.1):
        super().__init__()
        self.encoder = AutoModel.from_pretrained(model_name)
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

    y_pred = np.concatenate(predictions)
    y_true = np.concatenate(targets)

    y_pred = np.clip(y_pred, 0, 1)

    per_label = {}
    for i, label in enumerate(labels):
        true_col = y_true[:, i]
        pred_col = y_pred[:, i]
        r2 = None if len(np.unique(true_col)) < 2 else float(r2_score(true_col, pred_col))
        per_label[label] = {
            "mae": float(mean_absolute_error(true_col, pred_col)),
            "rmse": float(math.sqrt(mean_squared_error(true_col, pred_col))),
            "r2": r2,
        }

    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(math.sqrt(mean_squared_error(y_true, y_pred))),
        "per_label": per_label,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", type=Path, required=True)
    parser.add_argument("--validation", type=Path, required=True)
    parser.add_argument("--test", type=Path, required=True)
    parser.add_argument("--labels", nargs="+", required=True)
    parser.add_argument("--model", default="dbmdz/bert-base-turkish-cased")
    parser.add_argument("--output", type=Path, default=Path("artifacts/regressor"))
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--max-length", type=int, default=256)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    set_seed(args.seed)

    if not 1 <= len(args.labels) <= 8:
        raise SystemExit("1-8 hedef kolonu destekleniyor.")

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

    tokenizer = AutoTokenizer.from_pretrained(args.model)

    train_ds = TextRegressionDataset(train, tokenizer, args.labels, args.max_length)
    val_ds = TextRegressionDataset(validation, tokenizer, args.labels, args.max_length)
    test_ds = TextRegressionDataset(test, tokenizer, args.labels, args.max_length)

    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size)
    test_loader = DataLoader(test_ds, batch_size=args.batch_size)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = TransformerRegressor(args.model, len(args.labels)).to(device)

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
        "test_metrics": test_metrics,
        "scientific_note": "Bu sonuçlar yalnızca çalıştırılan test seti içindir; rapora deney sonucu olarak ancak gerçek çalıştırmadan sonra eklenmelidir."
    }

    with (args.output / "metrics.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)

    tokenizer.save_pretrained(args.output / "tokenizer")
    print(json.dumps(test_metrics, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
