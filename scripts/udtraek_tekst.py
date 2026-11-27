"""Laver tekstudgaver af alle hentede PDF'er, så de kan analyseres og søges i.

For hver PDF i data/budgetaftaler/<år>/filer/<Kommune>/ skrives
data/budgetaftaler/<år>/tekst/<Kommune>/<filnavn>.txt.
Først bruges pdftotext. Har PDF'en næsten ingen tekst (scannet), køres
OCR med ocrmypdf og dansk tesseract. Eksisterende tekstfiler springes over.

Kræver: poppler-utils, ocrmypdf, tesseract-ocr-dan (installeres i workflowet).
"""
import subprocess
import tempfile
from pathlib import Path

ROD = Path(__file__).resolve().parent.parent / "data" / "budgetaftaler"
MIN_TEGN_PR_SIDE = 200


def antal_sider(pdf: Path) -> int:
    try:
        ud = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=60).stdout
        for linje in ud.splitlines():
            if linje.startswith("Pages:"):
                return int(linje.split()[1])
    except Exception:  # noqa: BLE001
        pass
    return 1


def pdftotext(pdf: Path) -> str:
    r = subprocess.run(["pdftotext", "-layout", str(pdf), "-"], capture_output=True, text=True, timeout=300)
    return r.stdout


def ocr(pdf: Path) -> str:
    with tempfile.TemporaryDirectory() as tmp:
        sidecar = Path(tmp) / "tekst.txt"
        ud = Path(tmp) / "ud.pdf"
        subprocess.run(["ocrmypdf", "-l", "dan", "--force-ocr", "--sidecar", str(sidecar),
                        "--output-type", "pdf", "--jobs", "2", str(pdf), str(ud)],
                       capture_output=True, timeout=1800)
        return sidecar.read_text(encoding="utf-8", errors="replace") if sidecar.exists() else ""


def main() -> None:
    n_ny = n_ocr = 0
    for pdf in sorted(ROD.glob("*/filer/*/*.pdf")):
        aar_dir = pdf.parents[2]
        ud = aar_dir / "tekst" / pdf.parent.name / (pdf.stem + ".txt")
        if ud.exists():
            continue
        ud.parent.mkdir(parents=True, exist_ok=True)
        tekst = pdftotext(pdf)
        metode = "pdftotext"
        if len(tekst.strip()) < MIN_TEGN_PR_SIDE * antal_sider(pdf):
            ocr_tekst = ocr(pdf)
            if len(ocr_tekst.strip()) > len(tekst.strip()):
                tekst, metode = ocr_tekst, "ocr"
                n_ocr += 1
        ud.write_text(f"# kilde: {pdf.relative_to(aar_dir)} | metode: {metode}\n\n{tekst}", encoding="utf-8")
        n_ny += 1
        print(f"{metode:9} {len(tekst):7} tegn  {pdf.relative_to(ROD)}", flush=True)
    print(f"== {n_ny} nye tekstfiler, heraf {n_ocr} med OCR")


if __name__ == "__main__":
    main()
