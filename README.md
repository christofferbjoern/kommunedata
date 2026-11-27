# Kommunedata

Data til en oversigt over de 98 danske kommuner: økonomi, befolkning, beskæftigelse, indkomst og uddannelse.

## Indhold

| Mappe | Indhold |
|---|---|
| `data/kommuner.txt` | De 98 kommuner |
| `data/budgetaftaler/<år>/kilder.json` | Links pr. kommune til aftaletekst, budgetoversigt (regneark/PDF), klimabudget og budgetside |
| `data/budgetaftaler/<år>/analyse.json` | Udtræk pr. aftale: partier, top 10 prioriteter, besparelser, finansiering, skat, klima, resumé |
| `data/budgetaftaler/<år>/filer/<Kommune>/` | Originalfilerne, hentet automatisk |
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

## Automatisk opdatering

Workflowet `.github/workflows/hent-data.yml` kører hver mandag, når `kilder.json` eller scripts ændres, og manuelt under *Actions → Hent kommunedata → Run workflow*. Det henter kun nye filer og de to nyeste år fra DST.

Udtrækkene i `analyse.json` er lavet automatisk ud fra aftaleteksterne. Tjek dem mod originalen, før de bruges.
