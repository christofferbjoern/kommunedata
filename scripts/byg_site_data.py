"""Samler kommunedata til hjemmesiden (site/data/data.json).

Læser DST-tabellerne i data/dst/, de uploadede regneark i data/ og
budgetanalyserne i data/budgetaftaler/2027/. Alle tal gemmes pr. kommune
(3-cifret kommunekode) og år, med "000" som hele landet.

Brug: python scripts/byg_site_data.py
"""
import csv
import datetime as dt
import gzip
import json
import re
from collections import defaultdict
from pathlib import Path

ROD = Path(__file__).resolve().parent.parent
DST = ROD / "data" / "dst"
UD = ROD / "site" / "data" / "data.json"
FRA = 2008


def tal(s):
    s = (s or "").strip().replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def kode(felt):
    """'101 København' -> '101'"""
    return felt.split(" ", 1)[0]


def rows(tabel):
    mappe = DST / tabel
    if not mappe.exists():
        return
    for fil in sorted(mappe.glob("*.csv.gz")):
        with gzip.open(fil, "rt", encoding="utf-8") as f:
            r = csv.reader(f, delimiter=";")
            hoved = next(r)
            for raekke in r:
                yield dict(zip(hoved, raekke))


def info(tabel):
    p = DST / tabel / "tableinfo.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


# ---------- kommuner og regioner ----------
fi = info("FOLK1AM") or info("FOLK1A")
omr = next(v for v in fi["variables"] if v["id"] == "OMRÅDE")["values"]
kommuner, region = [], None
for v in omr:
    if v["text"].startswith("Region"):
        region = v["text"]
    elif v["id"] not in ("000", "411") and not v["text"].startswith("Landsdel"):  # 411 = Christiansø
        kommuner.append({"kode": v["id"], "navn": v["text"], "region": region})
KODER = [k["kode"] for k in kommuner]
ALLE = set(KODER) | {"000"}

maal = {}


def nyt_maal(key, navn, enhed, kategori, kilde, decimaler=0, retning=0, beskrivelse=""):
    maal[key] = {"navn": navn, "enhed": enhed, "kategori": kategori, "kilde": kilde,
                 "decimaler": decimaler, "retning": retning, "beskrivelse": beskrivelse,
                 "_v": defaultdict(dict)}
    return maal[key]["_v"]


# ---------- befolkning ----------
bef = defaultdict(dict)          # kode -> år -> indbyggere 1. jan
aldre = defaultdict(lambda: defaultdict(lambda: [0, 0, 0]))  # kode -> år -> [0-17, 18-64, 65+]
kilde_bef = "DST FOLK1A (1. kvartal)"
for r in rows("FOLK1A"):
    k = kode(r["OMRÅDE"])
    if k not in ALLE:
        continue
    aar = int(r["TID"][:4])
    v = tal(r["INDHOLD"]) or 0
    a = r["ALDER"].split(" ", 1)[0]
    if a == "IALT":
        bef[k][aar] = v
    else:
        n = int(re.sub(r"\D", "", a) or 0)
        aldre[k][aar][0 if n < 18 else (1 if n < 65 else 2)] += v
if not bef:
    kilde_bef = "DST FOLK1AM (januar)"
    for r in rows("FOLK1AM"):
        if not r["TID"].endswith("M01") or r["KØN"].startswith("TOT") is False:
            continue
        k = kode(r["OMRÅDE"])
        if k not in ALLE:
            continue
        aar = int(r["TID"][:4])
        v = tal(r["INDHOLD"]) or 0
        a = r["ALDER"].split(" ", 1)[0]
        if a == "IALT":
            bef[k][aar] = v
        else:
            n = int(re.sub(r"\D", "", a) or 0)
            aldre[k][aar][0 if n < 18 else (1 if n < 65 else 2)] += v

v = nyt_maal("bef", "Indbyggere", "personer", "Befolkning", kilde_bef,
             beskrivelse="Befolkningen 1. januar.")
for k, d in bef.items():
    v[k].update(d)
v = nyt_maal("vaekst", "Befolkningsvækst", "pct.", "Befolkning", kilde_bef, 2, 1,
             "Ændring i befolkningen fra 1. januar året før.")
for k, d in bef.items():
    for aar, n in d.items():
        if d.get(aar - 1):
            v[k][aar] = (n / d[aar - 1] - 1) * 100
for key, i, navn in (("andel0_17", 0, "Andel 0-17-årige"), ("andel65", 2, "Andel 65+ årige")):
    v = nyt_maal(key, navn, "pct.", "Befolkning", kilde_bef, 1)
    for k, d in aldre.items():
        for aar, g in d.items():
            if bef[k].get(aar):
                v[k][aar] = g[i] / bef[k][aar] * 100

# befolkningsregnskab (BEV107): fødselsoverskud og nettotilflytning pr. 1.000
komp = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
for r in rows("BEV107"):
    k = kode(r["OMRÅDE"])
    if k in ALLE:
        komp[k][int(r["TID"][:4])][kode(r["BEVÆGELSE"])] += tal(r["INDHOLD"]) or 0
if komp:
    vf = nyt_maal("foedselsoverskud", "Fødselsoverskud pr. 1.000 indbyggere", "pr. 1.000", "Befolkning", "DST BEV107", 1, 0,
                  "Levendefødte minus døde i løbet af året, pr. 1.000 indbyggere ved årets start.")
    vt = nyt_maal("nettotilflytning", "Nettotilflytning pr. 1.000 indbyggere", "pr. 1.000", "Befolkning", "DST BEV107", 1, 0,
                  "Tilflyttede minus fraflyttede (inden for Danmark) plus nettoindvandring, pr. 1.000 indbyggere.")
    for k, d in komp.items():
        for aar, a in d.items():
            n = a.get("B01A") or bef[k].get(aar)
            if n:
                vf[k][aar] = a.get("B04", 0) / n * 1000
                vt[k][aar] = (a.get("B07", 0) + a.get("B10", 0)) / n * 1000

# areal (ARE207)
areal = {}
for r in rows("ARE207"):
    k = kode(r["OMRÅDE"])
    if k in ALLE:
        areal.setdefault(k, {})[int(r["TID"][:4])] = tal(r["INDHOLD"])
if areal:
    v = nyt_maal("areal", "Areal", "km²", "Geografi", "DST ARE207", 0)
    for k, d in areal.items():
        v[k].update(d)
    vt = nyt_maal("taethed", "Befolkningstæthed", "indb. pr. km²", "Geografi", "DST ARE207 og " + kilde_bef, 0)
    for k, d in bef.items():
        if k in areal:
            seneste = areal[k][max(areal[k])]
            for aar, n in d.items():
                a = areal[k].get(aar, seneste)
                if a:
                    vt[k][aar] = n / a

# ---------- beskæftigelse ----------
# RAS201: befolkningen ultimo november efter socioøkonomisk status, herkomst, alder og køn
ras = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
for r in rows("RAS201"):
    k = kode(r["OMRÅDE"])
    if k not in ALLE:
        continue
    aar = int(r["TID"][:4])
    x = tal(r["INDHOLD"]) or 0
    alder = kode(r["ALDER"])
    soc = kode(r["SOCIO"])
    d = ras[k][aar]
    d["alle"] += x
    if kode(r["HERKOMST"]) != "999":
        d["indv"] += x
    if alder not in ("-15", "65-66", "67-"):
        d["1664"] += x
        d["besk" if soc == "00" else ("ledig" if soc == "50" else "uden")] += x
if ras:
    vb = nyt_maal("beskfrek", "Beskæftigelsesfrekvens, 16-64 år", "pct.", "Beskæftigelse", "DST RAS201", 1, 1,
                  "Andel af de 16-64-årige, der er i beskæftigelse (ultimo november).")
    ve = nyt_maal("erhvfrek", "Erhvervsfrekvens, 16-64 år", "pct.", "Beskæftigelse", "DST RAS201", 1, 1,
                  "Andel af de 16-64-årige, der er i arbejdsstyrken (beskæftigede og ledige), ultimo november.")
    vi = nyt_maal("andel_indv", "Andel indvandrere og efterkommere", "pct.", "Befolkning", "DST RAS201", 1, 0,
                  "Indvandrere og efterkommere i procent af befolkningen (ultimo november).")
    for k, d in ras.items():
        for aar, x in d.items():
            if x["1664"]:
                vb[k][aar] = x["besk"] / x["1664"] * 100
                ve[k][aar] = (x["besk"] + x["ledig"]) / x["1664"] * 100
            if x["alle"]:
                vi[k][aar] = x["indv"] / x["alle"] * 100
else:
    p = ROD / "data" / "beskaeftigelse" / "RAS200.csv"
    if p.exists():
        v = nyt_maal("beskfrek", "Beskæftigelsesfrekvens, 16-64 år", "pct.", "Beskæftigelse",
                     "DST RAS200 (upload, 2014 og 2024)", 1, 1,
                     "Andel af de 16-64-årige, der er i beskæftigelse (ultimo november).")
        navn2kode = {k["navn"]: k["kode"] for k in kommuner}
        for raekke in csv.reader(open(p, encoding="utf-8")):
            if len(raekke) > 4 and raekke[2] in navn2kode:
                for aar, x in ((2014, raekke[3]), (2024, raekke[4])):
                    if tal(x) is not None:
                        v[navn2kode[raekke[2]]][aar] = tal(x)

# AUP01: fuldtidsledige i pct. af arbejdsstyrken, månedlig -> årsgennemsnit (kun hele år)
acc = defaultdict(lambda: defaultdict(list))
for r in rows("AUP01"):
    k = kode(r["OMRÅDE"])
    if k in ALLE and r["ALDER"].startswith("TOT") and r["KØN"].startswith("TOT"):
        x = tal(r["INDHOLD"])
        if x is not None:
            acc[k][int(r["TID"][:4])].append(x)
if acc:
    v = nyt_maal("ledighed", "Ledighed", "pct. af arbejdsstyrken", "Beskæftigelse", "DST AUP01", 1, -1,
                 "Fuldtidsledige (bruttoledighed) i procent af arbejdsstyrken, gennemsnit af årets 12 måneder.")
    for k, d in acc.items():
        for aar, xs in d.items():
            if len(xs) == 12:
                v[k][aar] = sum(xs) / 12

# RAS301: beskæftigede efter bopæl og branche -> 10 hovedbrancher
GRUPPER = [("Landbrug, skovbrug og fiskeri", "AB"), ("Industri, råstof og forsyning", "CDE"),
           ("Bygge og anlæg", "F"), ("Handel og transport mv.", "GHI"), ("Information og kommunikation", "J"),
           ("Finansiering, forsikring og ejendom", "KL"), ("Erhvervsservice", "MN"),
           ("Offentlig administration, undervisning og sundhed", "OPQ"), ("Kultur, fritid og anden service", "RS"),
           ("Uoplyst aktivitet", "X")]
erhv = defaultdict(lambda: defaultdict(lambda: [0.0] * len(GRUPPER)))
for r in rows("RAS301"):
    k = kode(r["OMRÅDE"])
    if k not in ALLE:
        continue
    b = kode(r["BRANCHE07"])
    # råstofindvinding (B) hører til "industri, råstof og forsyning" i DST's 10-gruppering
    i = 1 if b == "B" else next((n for n, (_, bogst) in enumerate(GRUPPER) if b[0] in bogst), None)
    if i is not None:
        erhv[k][int(r["TID"][:4])][i] += tal(r["INDHOLD"]) or 0
erhverv = {}
if erhv:
    for key, i, navn in (("andel_landbrug", 0, "Andel beskæftigede i landbrug, skovbrug og fiskeri"),
                         ("andel_industri", 1, "Andel beskæftigede i industri, råstof og forsyning"),
                         ("andel_offentlig", 7, "Andel beskæftigede i offentlig administration, undervisning og sundhed")):
        v = nyt_maal(key, navn, "pct.", "Erhverv", "DST RAS301", 1, 0,
                     "Beskæftigede med bopæl i kommunen (ultimo november), andel af alle beskæftigede.")
        for k, d in erhv.items():
            for aar, xs in d.items():
                if sum(xs):
                    v[k][aar] = xs[i] / sum(xs) * 100
    sidste = max(a for d in erhv.values() for a in d)
    erhverv = {"aar": sidste, "grupper": [g for g, _ in GRUPPER],
               "v": {k: [round(x / sum(d[sidste]) * 100, 1) for x in d[sidste]] for k, d in erhv.items()
                     if sum(d.get(sidste, [0]))}}

# ---------- indkomst ----------
p = ROD / "data" / "erhvervsindkomst" / "Erhvervsindkomst.csv"
if p.exists():
    v = nyt_maal("erhvervsindk", "Erhvervsindkomst, 18-64 år", "kr.", "Indkomst", "Upload (DST-baseret), 2008-2024", 0, 1,
                 "Gennemsnitlig erhvervsindkomst for 18-64-årige, løbende priser.")
    navn2kode = {k["navn"]: k["kode"] for k in kommuner}
    navn2kode.update({"Hele landet": "000", "Landsgennemsnit": "000"})
    aarliste = None
    for raekke in csv.reader(open(p, encoding="utf-8")):
        if len(raekke) > 2 and raekke[1] == "Kommune/år":
            aarliste = [int(x) if x.isdigit() else None for x in raekke[2:]]
            continue
        if aarliste and len(raekke) > 2 and raekke[1] in navn2kode:
            for aar, x in zip(aarliste, raekke[2:]):
                if aar and tal(x) is not None:
                    v[navn2kode[raekke[1]]][aar] = tal(x)

v = nyt_maal("dispindk", "Disponibel indkomst pr. person", "kr.", "Indkomst", "DST INDKP101", 0, 1,
             "Gennemsnitlig disponibel indkomst for alle personer (15+ år), løbende priser.")
for r in rows("INDKP101"):
    if not (r["ENHED"].startswith("116") and r["INDKOMSTTYPE"].startswith("100") and r["KOEN"].startswith("MOK")):
        continue
    k = kode(r["OMRÅDE"])
    aar = int(r["TID"][:4])
    if k in ALLE and aar >= FRA:
        v[k][aar] = tal(r["INDHOLD"])

# ---------- uddannelse (HFUDD11) ----------
ud = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
ALDRE_2564 = {"25-29", "30-34", "35-39", "40-44", "45-49", "50-54", "55-59", "60-64"}
for r in rows("HFUDD11"):
    if not (r["HERKOMST"].startswith("TOT") and r["KØN"].startswith("TOT")):
        continue
    if r["ALDER"].split(" ", 1)[0] not in ALDRE_2564:
        continue
    h = r["HFUDD"].split(" ", 1)[0]
    if h not in ("TOT", "H10", "H20", "H30", "H35", "H40", "H50", "H60", "H70", "H80", "H90"):
        continue
    k = kode(r["BOPOMR"])
    if k in ALLE:
        ud[k][int(r["TID"][:4])][h] += tal(r["INDHOLD"]) or 0
for key, navn, koder, ret in (
        ("videregaaende", "Andel med videregående uddannelse, 25-64 år", ("H40", "H50", "H60", "H70", "H80"), 1),
        ("lvu", "Andel med lang videregående uddannelse, 25-64 år", ("H70", "H80"), 1),
        ("erhvervsfaglig", "Andel med erhvervsfaglig uddannelse, 25-64 år", ("H30",), 0),
        ("grundskole", "Andel med grundskole som højeste uddannelse, 25-64 år", ("H10",), -1)):
    v = nyt_maal(key, navn, "pct.", "Uddannelse", "DST HFUDD11", 1, ret,
                 "Højest fuldførte uddannelse blandt 25-64-årige; personer med uoplyst uddannelse er udeladt.")
    for k, d in ud.items():
        for aar, a in d.items():
            grund = a["TOT"] - a["H90"]
            if grund > 0:
                v[k][aar] = sum(a[h] for h in koder) / grund * 100

# ---------- økonomi (REGK31 regnskab, BUDK32 budget) ----------
HOVEDKONTI = {"0": "Byudvikling, bolig og miljø", "1": "Forsyning", "2": "Transport og infrastruktur",
              "3": "Undervisning og kultur", "4": "Sundhed", "5": "Sociale opgaver og beskæftigelse",
              "6": "Administration og fællesudgifter"}


def oekonomi(tabel, omr_felt):
    drift = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    anlaeg = defaultdict(lambda: defaultdict(float))
    skat = defaultdict(lambda: defaultdict(float))
    udlig = defaultdict(lambda: defaultdict(float))
    for r in rows(tabel):
        if not r["ART"].startswith("TOT "):
            continue
        k = kode(r[omr_felt])
        if k not in ALLE:
            continue
        aar = int(r["TID"][:4])
        f = r["FUNKTION"].split(" ", 1)[0]
        d = r["DRANST"].split(" ", 1)[0]
        x = (tal(r["INDHOLD"]) or 0) * 1000
        hk = f[0]
        if hk in HOVEDKONTI and d in ("1", "2"):
            drift[k][aar][hk] += x
        elif hk in HOVEDKONTI and d == "3":
            anlaeg[k][aar] += x
        if f.startswith("768") and d == "7":
            skat[k][aar] -= x
        if f.startswith("762") and d == "7":
            udlig[k][aar] -= x
    return drift, anlaeg, skat, udlig


def pr_indb(k, aar):
    return bef[k].get(aar) or bef[k].get(aar + 1)


drift, anlaeg, skat, udlig = oekonomi("REGK31", "OMRÅDE")
v = nyt_maal("driftpr", "Nettodriftsudgifter pr. indbygger", "kr.", "Økonomi", "DST REGK31 (regnskab)", 0, 0,
             "Drift inkl. statsrefusion på hovedkonto 0-6, løbende priser, pr. indbygger 1. januar.")
fordeling = defaultdict(dict)
for k, d in drift.items():
    for aar, hk in d.items():
        n = pr_indb(k, aar)
        if n:
            v[k][aar] = sum(hk.values()) / n
            fordeling[k][aar] = [round(hk.get(h, 0) / n) for h in HOVEDKONTI]
for key, navn, src, besk, ret in (
        ("anlaegpr", "Nettoanlægsudgifter pr. indbygger", anlaeg, "Anlæg på hovedkonto 0-6, netto.", 0),
        ("skatpr", "Skatteindtægter pr. indbygger", skat, "Kommunens skatteindtægter (funktion 7.68).", 0),
        ("udligpr", "Tilskud og udligning pr. indbygger", udlig,
         "Generelle tilskud og udligning netto (funktion 7.62). Positivt tal = kommunen modtager.", 0)):
    v = nyt_maal(key, navn, "kr.", "Økonomi", "DST REGK31 (regnskab)", 0, ret, besk)
    for k, d in src.items():
        for aar, x in d.items():
            n = pr_indb(k, aar)
            if n:
                v[k][aar] = x / n

bdrift, banlaeg, bskat, budlig = oekonomi("BUDK32", "REGI07A")
v = nyt_maal("budgetdriftpr", "Budgetterede nettodriftsudgifter pr. indbygger", "kr.", "Økonomi",
             "DST BUDK32 (vedtaget budget)", 0, 0,
             "Vedtaget budget for drift inkl. statsrefusion på hovedkonto 0-6, pr. indbygger.")
for k, d in bdrift.items():
    for aar, hk in d.items():
        n = pr_indb(k, aar) or (bef[k] and aar > max(bef[k]) and bef[k][max(bef[k])])
        if n:
            v[k][aar] = sum(hk.values()) / n

for key, kd, navn, enhed, ret in (("skattepct", "KOM", "Kommunal skatteprocent", "pct.", -1),
                                   ("grundskyld", "GRUND", "Grundskyldspromille", "promille", -1)):
    v = nyt_maal(key, navn, enhed, "Økonomi", "DST PSKAT", 2, ret)
    for r in rows("PSKAT"):
        if r["SKATPCT"].startswith(kd + " "):
            k = kode(r["OMRÅDE"])
            if k in ALLE:
                v[k][int(r["TID"][:4])] = tal(r["INDHOLD"])

# NGLK: udvalgte kommunale regnskabsnøgletal (løbende priser)
# DRI, ANL og UDL springes over: de findes allerede som driftpr, anlaegpr og udligpr (beregnet af REGK31).
NGLK = {"SER": ("ng_service", "Serviceudgifter pr. indbygger"), "LAN": ("ng_gaeld", "Langfristet gæld pr. indbygger"),
        "ÆLD": ("ng_aeldre", "Ældreudgifter pr. 65+-årig"), "FOL": ("ng_folkeskole", "Folkeskoleudgifter pr. elev"),
        "DAG": ("ng_dagtilbud", "Dagtilbudsudgifter pr. 0-10-årig"), "SUN": ("ng_sundhed", "Sundhedsudgifter pr. indbygger"),
        "KUL": ("ng_kultur", "Kulturudgifter pr. indbygger"), "TRA": ("ng_transport", "Transport og infrastruktur pr. indbygger"),
        "ARB": ("ng_arbejdsmarked", "Arbejdsmarkedsudgifter pr. 16-64-årig")}
ng = info("NGLK")
if ng:
    tekster = {x["id"]: x["text"] for x in next(x for x in ng["variables"] if x["id"] == "BNØGLE")["values"]}
    ngv = defaultdict(lambda: defaultdict(dict))  # nøgle -> kommune -> år -> {NET/BRUT: værdi}
    for r in rows("NGLK"):
        k = kode(r["OMRÅDE"])
        nk = kode(r["BNØGLE"])
        if k in ALLE and nk in NGLK and r["PRISENHED"].startswith("AARPRIS"):
            ngv[nk][k].setdefault(int(r["TID"][:4]), {})[kode(r["BRUTNETUDG"])] = tal(r["INDHOLD"])
    for nk, (key, navn) in NGLK.items():
        if nk not in ngv:
            continue
        brug = "NET" if any("NET" in x for d in ngv[nk].values() for x in d.values()) else "BRUT"
        v = nyt_maal(key, navn, "kr.", "Kommunale nøgletal", "DST NGLK", 0, 0,
                     f"{tekster.get(nk, navn)} ({'nettoudgifter' if brug == 'NET' else 'bruttoudgifter'}, løbende priser).")
        for k, d in ngv[nk].items():
            for aar, x in d.items():
                if x.get(brug) is not None:
                    v[k][aar] = x[brug]

# ---------- pak målene ----------
ud_maal = {}
for key, m in maal.items():
    vals = m.pop("_v")
    aarset = sorted({a for d in vals.values() for a in d if a >= FRA})
    if not aarset:
        continue
    dec = m["decimaler"]
    m["aar"] = aarset
    m["v"] = {}
    for k in KODER + ["000"]:
        d = vals.get(k, {})
        if d:
            m["v"][k] = [None if d.get(a) is None else round(d[a], dec) if dec else round(d[a]) for a in aarset]
    ud_maal[key] = m

# budgetaftaler 2027
analyse = json.loads((ROD / "data/budgetaftaler/2027/analyse.json").read_text(encoding="utf-8"))
kilder = json.loads((ROD / "data/budgetaftaler/2027/kilder.json").read_text(encoding="utf-8"))
navn2kode = {k["navn"]: k["kode"] for k in kommuner}
for kort, lang in (("Nordfyn", "Nordfyns"), ("Vesthimmerland", "Vesthimmerlands")):
    navn2kode.setdefault(kort, navn2kode.get(lang, ""))
budget = {}
for navn, a in analyse.items():
    k = navn2kode.get(navn)
    if not k:
        print("!! ukendt kommune i analyse:", navn)
        continue
    kd = kilder.get(navn, {})
    links = [u.strip() for f in ("aftale", "regneark", "klima", "side") for u in (kd.get(f) or "").split("|") if u.strip()]
    budget[k] = {**{x: a.get(x) for x in ("budgetaar", "partier", "prioriteter", "besparelser", "finansiering",
                                          "skat", "klima", "resume", "kvalitet")},
                 "links": list(dict.fromkeys(links))[:6]}

ud = {
    "genereret": dt.date.today().isoformat(),
    "kommuner": kommuner,
    "hovedkonti": list(HOVEDKONTI.values()),
    "maal": ud_maal,
    "udgiftsfordeling": {k: {str(a): fordeling[k][a] for a in sorted(fordeling[k]) if a >= FRA} for k in fordeling},
    "budget2027": budget,
    "erhverv": erhverv,
}
UD.parent.mkdir(parents=True, exist_ok=True)
UD.write_text(json.dumps(ud, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
print(f"{UD}: {UD.stat().st_size // 1024} KB, {len(kommuner)} kommuner, mål: {', '.join(ud_maal)}")
for key, m in ud_maal.items():
    print(f"  {key:16} {m['aar'][0]}-{m['aar'][-1]}  {len(m['v'])} områder  land={m['v'].get('000', [None])[-1]}")
