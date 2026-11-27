"""Henter budgetaftaler, budgetoversigter og klimabudgetter som originalfiler.

Læser data/budgetaftaler/<år>/kilder.json (én post pr. kommune med felterne
aftale, regneark, klima, side; flere URL'er adskilles med " | ") og gemmer
filerne i data/budgetaftaler/<år>/filer/<Kommune>/.
Skriver en manifest.csv med status for hver fil. Filer, der allerede er
hentet, springes over, så jobbet kan køre igen og igen.

Brug: python scripts/hent_dokumenter.py [år ...]   (standard: alle år)
"""
import csv
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests

ROD = Path(__file__).resolve().parent.parent / "data" / "budgetaftaler"
UA = "Mozilla/5.0 (compatible; kommunedata-arkiv/1.0)"
FELTER = ("aftale", "regneark", "klima")
PAUSE = 1.5  # sekunder mellem kald, for at være høflig over for kommunernes servere


def filnavn(felt: str, nr: int, url: str, ctype: str) -> str:
    navn = unquote(Path(urlparse(url).path).name) or "dokument"
    navn = re.sub(r"[^\w.\-æøåÆØÅ ]", "_", navn).strip()[:120]
    if "." not in navn[-6:]:
        if "pdf" in ctype:
            navn += ".pdf"
        elif "sheet" in ctype or "excel" in ctype:
            navn += ".xlsx"
        elif "html" in ctype:
            navn += ".html"
    return f"{felt}_{nr}_{navn}"


def hent(url: str, session: requests.Session):
    for forsoeg in range(3):
        try:
            r = session.get(url, timeout=60, allow_redirects=True)
            return r
        except requests.RequestException as e:  # netværksfejl: prøv igen
            fejl = e
            time.sleep(5 * (forsoeg + 1))
    raise fejl


def behandl_aar(aar_dir: Path, session: requests.Session) -> None:
    kilder = json.loads((aar_dir / "kilder.json").read_text(encoding="utf-8"))
    manifest_sti = aar_dir / "manifest.csv"
    gamle = {}
    if manifest_sti.exists():
        with manifest_sti.open(encoding="utf-8") as f:
            for raekke in csv.DictReader(f):
                gamle[(raekke["kommune"], raekke["url"])] = raekke
    nye = []
    for kommune, post in sorted(kilder.items()):
        for felt in FELTER:
            urls = [u.strip() for u in (post.get(felt) or "").split("|") if u.strip()]
            for nr, url in enumerate(urls, 1):
                gammel = gamle.get((kommune, url))
                if gammel and gammel["status"] == "ok" and (aar_dir / gammel["fil"]).exists():
                    nye.append(gammel)
                    continue
                raekke = {"kommune": kommune, "type": felt, "url": url, "status": "", "http": "",
                          "fil": "", "bytes": "", "sha256": "", "hentet": time.strftime("%Y-%m-%d")}
                try:
                    r = hent(url, session)
                    raekke["http"] = str(r.status_code)
                    if r.status_code == 200 and r.content:
                        ctype = r.headers.get("content-type", "").lower()
                        mappe = aar_dir / "filer" / kommune
                        mappe.mkdir(parents=True, exist_ok=True)
                        sti = mappe / filnavn(felt, nr, r.url, ctype)
                        sti.write_bytes(r.content)
                        raekke.update(status="ok", fil=str(sti.relative_to(aar_dir)),
                                      bytes=str(len(r.content)),
                                      sha256=hashlib.sha256(r.content).hexdigest())
                        if "html" in ctype:
                            raekke["status"] = "ok_html"  # siden er gemt, men det er ikke selve dokumentet
                    else:
                        raekke["status"] = "fejl"
                except Exception as e:  # noqa: BLE001
                    raekke.update(status="fejl", http=type(e).__name__)
                print(f"{aar_dir.name} {kommune:20} {felt:9} {raekke['status']:7} {raekke['http']} {url}", flush=True)
                nye.append(raekke)
                time.sleep(PAUSE)
    with manifest_sti.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["kommune", "type", "url", "status", "http", "fil", "bytes", "sha256", "hentet"])
        w.writeheader()
        w.writerows(nye)
    ok = sum(1 for r in nye if r["status"] == "ok")
    print(f"== {aar_dir.name}: {ok} af {len(nye)} filer hentet")


def main() -> None:
    session = requests.Session()
    session.headers["User-Agent"] = UA
    aar = sys.argv[1:] or sorted(p.name for p in ROD.iterdir() if (p / "kilder.json").exists())
    for a in aar:
        behandl_aar(ROD / a, session)


if __name__ == "__main__":
    main()
