#!/usr/bin/env python3
"""Static validation for the Kaggle training notebook; does not run model training."""

from __future__ import annotations

import ast
import json
import sys
from pathlib import Path


def main() -> int:
    notebook_path = Path(
        sys.argv[1] if len(sys.argv) > 1
        else "ml/kaggle/dijital_ikiz_training.ipynb"
    )
    if not notebook_path.is_file():
        raise SystemExit(f"Notebook bulunamadı: {notebook_path}")

    notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    if notebook.get("nbformat") != 4 or not isinstance(notebook.get("cells"), list):
        raise SystemExit("Geçersiz Jupyter notebook biçimi.")

    code_cells = 0
    for index, cell in enumerate(notebook["cells"]):
        if cell.get("cell_type") != "code":
            continue
        code_cells += 1
        source = cell.get("source", "")
        if isinstance(source, list):
            source = "".join(source)
        # IPython shell/magic commands are Kaggle notebook syntax, not Python AST.
        python_lines = [
            line for line in source.splitlines()
            if not line.lstrip().startswith(("!", "%"))
        ]
        python_source = "\n".join(python_lines)
        try:
            ast.parse(python_source, filename=f"{notebook_path}:cell-{index}")
        except SyntaxError as exc:
            raise SystemExit(
                f"Notebook hücresi {index} içinde Python sözdizimi hatası: "
                f"satır {exc.lineno}: {exc.msg}"
            ) from exc

    if code_cells == 0:
        raise SystemExit("Notebook içinde kod hücresi bulunamadı.")

    print(
        f"Notebook statik kontrolü geçti: {notebook_path} | "
        f"hücre={len(notebook['cells'])} | kod hücresi={code_cells}"
    )
    print("Not: Bu kontrol Kaggle GPU eğitimini çalıştırmaz ve model başarısını kanıtlamaz.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
