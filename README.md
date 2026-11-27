# Kommunedata

Data til en oversigt over de 98 danske kommuner: økonomi, befolkning, beskæftigelse, indkomst og uddannelse.

## Indhold

| Mappe | Indhold |
|---|---|
| `data/kommuner.txt` | De 98 kommuner |
| `data/budgetaftaler/<år>/kilder.json` | Links pr. kommune til aftaletekst, budgetoversigt (regneark/PDF), klimabudget og budgetside |
| `data/budgetaftaler/<år>/analyse.json` | Udtræk pr. aftale: partier, top 10 prioriteter, besparelser, finansiering, skat, klima, resumé |
| `data/budgetaftaler/<år>/filer/<Kommune>/` | Originalfilerne, hentet automatisk |
| `data/budgetaftaler/<år>/tekst/<Kommune>/` | Tekstudgaver af PDF'erne (scannede PDF'er er OCR-læst) |
| `data/budgetaftaler/<år>/manifest.csv` | Status for hver fil (hentet/fejl, HTTP-kode, sha256) |
| `data/dst/<TABEL>/<år>.csv.gz` | Tal fra Danmarks Statistik pr. år (semikolon-CSV, kode og tekst). Nuller udeladt |
| `data/dst/<TABEL>/tableinfo.json` | Tabellens variabler og koder |

## DST-tabeller (fra 2007)

- BUDK32: kommunernes budgetter efter funktion, dranst og art
- REGK31: kommunernes regnskaber efter funktion, dranst og art
- FOLK1AM: befolkning pr. måned efter køn og alder
- RAS300: beskæftigede efter branche
- AUL01: fuldtidsledige
- INDKP101: personindkomster
- HFUDD11: højest fuldførte uddannelse
- PSKAT: kommunale skatteprocenter
- ARE207: areal (km²)
- FOLK1A: befolkning 1. kvartal efter alder
- BEV107: befolkningsregnskab (fødte, døde, flytninger)
- RAS201: befolkningen efter socioøkonomisk status, herkomst, alder og køn
- RAS301: beskæftigede efter bopæl og branche
- AUP01: fuldtidsledige i pct. af arbejdsstyrken (månedlig)
- NGLK: udvalgte kommunale regnskabsnøgletal
- Flere kommunetal: GALDER (gennemsnitsalder), HISB77 (middellevetid), FRKM126 (befolkningsfremskrivning), KM6 (folkekirken), IFOR12P og IFOR41 (lavindkomst og ulighed), AFSTB4 (pendling), ERHV2A (arbejdspladser), AUH01 (offentligt forsørgede), DEMO19 (nye virksomheder), KVOTIEN (klassestørrelse), ANB7 (anbragte børn), AED21 og AED16 (ældrepleje), STRAF11 (anmeldte forbrydelser), BOL106, BYGV33 og EJEN88 (boliger og boligsalg), BIL707 og BIL710 (biler og elbiler), TURIST (overnatninger), IDRAKT02 (idrætsmedlemskaber), AREALDK2 (arealdække), KVRES (kommunalvalg)

`data/dst/_katalog.json` er en liste over alle aktive tabeller i Statistikbanken med deres variabler.

## Hjemmesiden (Kommuneblik)

Mappen `site/` er en statisk hjemmeside uden byggetrin: `index.html`, `style.css`, `app.js` og tre datafiler.

| Fil | Laves af |
|---|---|
| `site/data/data.json` | `python scripts/byg_site_data.py` (læser `data/dst`, uploads og budgetanalysen) |
| `site/data/kort.json` | `python scripts/byg_kort.py` (kommunegrænser, kører kun ved behov; kræver `shapely`) |
| `site/data/forklaringer.json` | Skrevet i hånden: teksten bag infotegnene, én pr. mål. Ret den direkte; afsnit adskilles med en tom linje (`\n\n`). |

Workflowet bygger `data.json` igen efter hver DST-opdatering.

Prøv siden lokalt med `python -m http.server -d site` og åbn http://localhost:8000.

**Netlify:** Opret et nyt site fra dette repo. `netlify.toml` sætter publiceringsmappen til `site`, så der skal ikke angives byggekommando.

## Automatisk opdatering

Workflowet `.github/workflows/hent-data.yml` kører hver mandag, når `kilder.json` eller scripts ændres, og manuelt under *Actions → Hent kommunedata → Run workflow*. Det henter kun nye filer og de to nyeste år fra DST.

Udtrækkene i `analyse.json` er lavet automatisk ud fra aftaleteksterne. Tjek dem mod originalen, før de bruges.
