# Kommunedata fra uploads (befolkning, erhvervsindkomst, uddannelse, beskæftigelse)

Originalfilerne ligger i `kilde_uploads/`. Hvert ark er lagt som rå CSV (UTF-8) i emnemappen:

- `befolkning/`: udvikling pr. kommune (FRKM226), alder 2008/2026 (Befolking_alder_-_kommune), landstal (FRDK225), sygehusbenyttelse (SBR01)
- `erhvervsindkomst/`: gennemsnitlig erhvervsindkomst 18-64 år pr. kommune 2008-2024
- `uddannelse/`: HFUDD16 (2014 og 2024) samt summeret socioøkonomisk status pr. kommune
- `beskaeftigelse/`: RAS200, pendling (PEND101, AFSTB4), kontanthjælp (KY24), offentligt forsørgede m.fl.
- `oekonomi/`: udvalgte regnskabstal (NGLK)
- `vaerktoej_data/`: arket Data fra Værktøj.xlsx (befolkning, tilvækst, erhvervsindkomst, beskæftigelse pr. område og år)

Arkene har overskrifter i flere rækker, så de er gemt uden omstrukturering. De ryddes til lang format, når hjemmesiden bygges.
