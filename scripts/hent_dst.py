"""Henter kommunetal fra Danmarks Statistik (Statistikbanken API).

For hver tabel i TABELLER hentes metadata (tableinfo.json) og data i
BULK-format, delt op pr. år, til data/dst/<TABEL>/<år>.csv.gz.
Rækker med værdien 0 eller ".." udelades for at holde filerne små.
År, der allerede er hentet, springes over, undtagen de to nyeste
(de kan blive revideret).

Brug: python scripts/hent_dst.py [TABEL ...]   (standard: alle i TABELLER)
"""
import csv
import gzip
import io
import json
import sys
import time
from pathlib import Path

import requests

API = "https://api.statbank.dk/v1"
UD = Path(__file__).resolve().parent.parent / "data" / "dst"
FRA_AAR = 2007

# tabel: beskrivelse. Variabler kaldet PRISENHED låses til løbende priser.
TABELLER = {
    "BUDK32": "Kommunernes budgetter efter funktion, dranst og art",
    "REGK31": "Kommunernes regnskaber efter funktion, dranst og art",
    "FOLK1AM": "Befolkningen den 1. i måneden efter område, køn og alder",
    "RAS300": "Beskæftigede efter område og branche",
    "AUL01": "Fuldtidsledige efter område",
    "INDKP101": "Personindkomster efter område",
    "HFUDD11": "Befolkningens højest fuldførte uddannelse efter område",
    "PSKAT": "Kommunale skatteprocenter",
    "ARE207": "Areal efter område (km2)",
    "FOLK1A": "Befolkningen den 1. i kvartalet efter område, køn, alder og civilstand",
    "BEV107": "Befolkningsregnskab efter kommune og bevægelsesart",
    "RAS201": "Erhvervs- og beskæftigelsesfrekvenser efter område, alder og køn",
    "RAS301": "Beskæftigede efter bopælsområde, branche, alder og køn",
    "AUP01": "Fuldtidsledige i procent af arbejdsstyrken efter område",
    "NGLK": "Udvalgte kommunale regnskabsnøgletal",
}

# Variabler, hvor kun den første værdi (normalt "i alt") hentes, og evt. kun
# ét tidspunkt pr. år (fx første kvartal), så filerne holdes små.
# Kun variabler, hvor den første værdi faktisk er "i alt", må stå her.
FILTRE = {
    "FOLK1A": {"total": ["KØN", "CIVILSTAND"], "tid": "K1"},
    "AUP01": {"total": ["KØN"]},
}


def post(endpoint: str, body: dict, stream: bool = False) -> requests.Response:
    for forsoeg in range(4):
        r = requests.post(f"{API}/{endpoint}", json=body, timeout=600, stream=stream)
        if r.status_code == 200:
            return r
        print(f"  {endpoint} {body.get('table')} HTTP {r.status_code}: {r.text[:200]}", flush=True)
        if r.status_code == 400:
            break
        time.sleep(10 * (forsoeg + 1))
    r.raise_for_status()
    return r


def vaelg_vaerdier(var: dict, tabel: str = "") -> list:
    if var["id"].upper() in [x.upper() for x in FILTRE.get(tabel, {}).get("total", [])]:
        return [var["values"][0]["id"]]
    if var["id"].upper() == "PRISENHED":
        for v in var["values"]:
            if "løbende" in v["text"].lower():
                return [v["id"]]
        return [var["values"][0]["id"]]
    return ["*"]


def hent_tabel(tabel: str) -> None:
    mappe = UD / tabel
    mappe.mkdir(parents=True, exist_ok=True)
    try:
        info = post("tableinfo", {"table": tabel, "format": "JSON", "lang": "da"}).json()
    except Exception as e:  # noqa: BLE001
        print(f"!! {tabel}: findes ikke eller kunne ikke hentes ({e})", flush=True)
        return
    (mappe / "tableinfo.json").write_text(json.dumps(info, ensure_ascii=False, indent=1), encoding="utf-8")
    tidvar = next(v for v in info["variables"] if v.get("time"))
    aar_map: dict = {}
    for v in tidvar["values"]:
        aar = v["id"][:4]
        tidfilter = FILTRE.get(tabel, {}).get("tid")
        if tidfilter and not v["id"].endswith(tidfilter):
            continue
        if aar.isdigit() and int(aar) >= FRA_AAR:
            aar_map.setdefault(aar, []).append(v["id"])
    alle_aar = sorted(aar_map)
    for aar in alle_aar:
        fil = mappe / f"{aar}.csv.gz"
        if fil.exists() and aar not in alle_aar[-2:]:
            continue
        variabler = [{"code": v["id"], "values": aar_map[aar] if v.get("time") else vaelg_vaerdier(v, tabel)}
                     for v in info["variables"]]
        body = {"table": tabel, "format": "BULK", "lang": "da", "valuePresentation": "CodeAndValue",
                "variables": variabler}
        try:
            r = post("data", body, stream=True)
        except Exception as e:  # noqa: BLE001
            print(f"!! {tabel} {aar}: {e}", flush=True)
            continue
        r.raw.decode_content = True
        laeser = csv.reader(io.TextIOWrapper(r.raw, encoding="utf-8-sig"), delimiter=";")
        n = 0
        tmp = fil.with_suffix(".tmp")
        with gzip.open(tmp, "wt", encoding="utf-8", newline="") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(next(laeser))
            for raekke in laeser:
                vaerdi = raekke[-1].strip()
                if vaerdi in ("", "0", "..", "-"):
                    continue
                w.writerow(raekke)
                n += 1
        tmp.replace(fil)
        print(f"{tabel} {aar}: {n} rækker", flush=True)
        time.sleep(1)


def hent_katalog() -> None:
    """Gem en liste over alle aktive DST-tabeller og deres variabler (data/dst/_katalog.json)."""
    try:
        tabeller = post("tables", {"lang": "da", "format": "JSON", "includeInactive": False}).json()
    except Exception as e:  # noqa: BLE001
        print(f"!! katalog: {e}", flush=True)
        return
    UD.mkdir(parents=True, exist_ok=True)
    (UD / "_katalog.json").write_text(json.dumps(tabeller, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"katalog: {len(tabeller)} tabeller", flush=True)


def main() -> None:
    hent_katalog()
    for tabel in sys.argv[1:] or TABELLER:
        print(f"== {tabel}: {TABELLER.get(tabel, '')}", flush=True)
        hent_tabel(tabel)


if __name__ == "__main__":
    main()
