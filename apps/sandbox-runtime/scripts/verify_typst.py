"""Compile and inspect the bundled Typst starter during the image build."""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pypdfium2 as pdfium
from pypdf import PdfReader


SOURCE = r'''
#import "theme.typ": report
#show: report.with(title: "Document smoke check", author: "Meowbert")
#set heading(numbering: "1.")

= Overview <overview>
Café — selectable text, a reference to @overview, and a footnote.
#footnote[Footnote verification.]

$ sum_(i=1)^n i = n(n+1)/2 $

#grid(columns: (1fr, 2fr), gutter: 8pt,
  rect(width: 100%, height: 12pt, fill: rgb("253647")),
  [A custom layout beside flowing text.],
)

#table(
  columns: (1fr, 2fr),
  table.header([*Line item*], [*Description*]),
  ..range(100).map(i => (str(i), [Row #i])).flatten(),
)
'''


def compile_source(directory: Path, name: str, source: str) -> Path:
    (directory / f"{name}.typ").write_text(source, encoding="utf-8")
    output = directory / f"{name}.pdf"
    result = subprocess.run(
        ["typst", "compile", "--ignore-system-fonts", f"{name}.typ", str(output)],
        cwd=directory, capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0 or result.stderr.strip():
        raise RuntimeError(f"Typst compilation failed or emitted diagnostics: {result.stderr}")
    return output


def verify_export(directory: Path) -> None:
    output = compile_source(directory, "report", SOURCE)
    reader = PdfReader(output)
    if len(reader.pages) < 2:
        raise RuntimeError("The long table did not paginate")
    texts = [page.extract_text() for page in reader.pages]
    if not all("Line item" in text for text in texts):
        raise RuntimeError("The table header did not repeat on every page")
    if "Footnote verification." not in texts[0] or "Row 99" not in texts[-1]:
        raise RuntimeError("The PDF lost the footnote or final table row")
    if abs(float(reader.pages[0].mediabox.width) - 595.28) > 1:
        raise RuntimeError("The default page width is not A4")
    with pdfium.PdfDocument(str(output)) as rendered:
        for page in rendered:
            image = page.render(scale=0.5).to_pil()
            if image.convert("L").getextrema()[0] > 100:
                raise RuntimeError("A rendered PDF page is blank")
            page.close()


def main() -> None:
    skill_dir = Path(sys.argv[1]).resolve()
    with tempfile.TemporaryDirectory(prefix="typst-smoke-") as temporary:
        directory = Path(temporary)
        shutil.copyfile(skill_dir / "templates/report.typ", directory / "theme.typ")
        verify_export(directory)
        minimal = compile_source(directory, "minimal", '#import "theme.typ": report\n#show: report\nUntitled document.')
        if "Untitled document." not in PdfReader(minimal).pages[0].extract_text():
            raise RuntimeError("The starter failed without optional title and author")
        print("Typst starter: compilation, pagination, text, and rendering passed")


if __name__ == "__main__":
    main()
