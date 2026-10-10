# ⛽ Spritpreise Klagenfurt Nord

Statische Website (GitHub Pages), die die aktuellen **Diesel**- und **Super-95**-Preise der Tankstellen rund um
Klagenfurt Nord vergleicht. Datenquelle: [E-Control Spritpreisrechner](https://www.spritpreisrechner.at).

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die Seite (Tailwind CSS via CDN) – **muss genau so heißen** |
| `app.js` | Laden, Sortieren, Anzeigen der Preise, Modals |
| `data/prices.json` | Preisdaten, werden automatisch von der GitHub Action aktualisiert |
| `scripts/fetch-prices.mjs` | Node-Skript, das die E-Control-API abfragt |
| `.github/workflows/update-prices.yml` | Läuft 3× täglich (Vormittag, Mittag, später Nachmittag) |
| `.nojekyll` | Verhindert, dass GitHub Pages Jekyll verwendet |

## Auf GitHub Pages veröffentlichen

1. Alle Dateien in den `main`-Branch des Repositorys legen (Struktur wie oben, `index.html` im Hauptverzeichnis).
2. **Settings → Pages**: *Source* = „Deploy from a branch“, Branch = `main`, Ordner = `/ (root)` → Speichern.
3. **Settings → Actions → General → Workflow permissions**: „Read and write permissions“ aktivieren
   (damit die Action `data/prices.json` committen darf).
4. **Actions → „Spritpreise aktualisieren“ → Run workflow** einmal manuell starten, um sofort Daten zu haben.
5. Die Seite ist danach unter `https://<benutzername>.github.io/<repository>/` erreichbar.

## Aktualisierungszeiten

GitHub-Cron läuft in UTC (Ausführung kann sich um einige Minuten verzögern):

| Cron (UTC) | Winterzeit (MEZ) | Sommerzeit (MESZ) |
|---|---|---|
| `0 7 * * *` | 08:00 | 09:00 |
| `30 11 * * *` | 12:30 | 13:30 |
| `0 15 * * *` | 16:00 | 17:00 |

Der Mittagslauf liegt bewusst nach 12:00 Uhr, da österreichische Tankstellen ihre Preise nur dann erhöhen dürfen.
Ist `data/prices.json` leer oder älter als 8 Stunden, fragt die Seite die E-Control zusätzlich direkt im Browser ab.

Hinweis: GitHub deaktiviert geplante Workflows in Repositories ohne Aktivität nach 60 Tagen – die automatischen
Commits der Action zählen als Aktivität.

## Lokal testen

```bash
node scripts/fetch-prices.mjs      # Preise holen (Node ≥ 18)
python3 -m http.server 8000        # dann http://localhost:8000 öffnen
```
