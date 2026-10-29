# ⛽ Spritpreise Klagenfurt Nord & Tamsweg

Statische Website (GitHub Pages), die die aktuellen **Diesel**- und **Super-95**-Preise der Tankstellen rund um
Klagenfurt Nord vergleicht. Datenquelle: [E-Control Spritpreisrechner](https://www.spritpreisrechner.at).

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Seite Klagenfurt Nord (Tailwind CSS via CDN) – **muss genau so heißen** |
| `tamsweg/index.html` | Seite Tamsweg (gleicher Code, `data-location="tamsweg"`) |
| `locations.json` | Alle Standorte: Name, Koordinaten, Unterseite, Datenordner |
| `app.js` | Laden, Sortieren, Anzeigen der Preise, Modals – für alle Standorte |
| `data/prices.json` | Aktuelle Preisdaten, werden automatisch von der GitHub Action aktualisiert |
| `data/history.json` | Preisverlauf: pro Abruf Günstigster/Ø/Teuerster und Einzelpreise je Tankstelle |
| `data/tamsweg/…` | Dasselbe für Tamsweg |
| `scripts/fetch-prices.mjs` | Node-Skript, das die E-Control-API abfragt |
| `.github/workflows/update-prices.yml` | Läuft 3× täglich (Vormittag, Mittag, später Nachmittag) |
| `.nojekyll` | Verhindert, dass GitHub Pages Jekyll verwendet |

## Standorte

| Standort | URL |
|---|---|
| Klagenfurt Nord | `https://<benutzername>.github.io/petrol-compare/` |
| Tamsweg | `https://<benutzername>.github.io/petrol-compare/tamsweg/` |

Weiteren Standort hinzufügen:
1. Eintrag in `locations.json` (`id`, `name`, `path` = Unterordner mit `/`, `dataDir`, `latitude`, `longitude`).
   Optional `postalCodes` (z. B. `["5580"]`): nur Tankstellen mit diesen Postleitzahlen anzeigen – Tamsweg nutzt das.
2. `tamsweg/index.html` in den neuen Ordner kopieren und `data-location`, `<title>` und Meta-Description anpassen.
3. Die Action legt beim nächsten Lauf `data/<ort>/prices.json` und `history.json` automatisch an.

## Auf GitHub Pages veröffentlichen

1. Alle Dateien in den `main`-Branch des Repositorys legen (Struktur wie oben, `index.html` im Hauptverzeichnis).
2. **Settings → Pages**: *Source* = „Deploy from a branch“, Branch = `main`, Ordner = `/ (root)` → Speichern.
3. **Settings → Actions → General → Workflow permissions**: „Read and write permissions“ aktivieren
   (damit die Action `data/prices.json` committen darf).
4. **Actions → „Spritpreise aktualisieren“ → Run workflow** einmal manuell starten, um sofort Daten zu haben.
5. Die Seite ist danach unter `https://<benutzername>.github.io/<repository>/` erreichbar.

## Aktualisierungszeiten

Abgerufen wird einmal je Zeitfenster (österreichische Zeit, Sommer-/Winterzeit automatisch):

| Fenster | Zeit |
|---|---|
| Vormittag | 08:00–12:00 |
| Mittag | 12:00–16:00 (Preiserhöhungen sind nur um 12:00 erlaubt) |
| Später Nachmittag | 16:00–20:00 |

GitHub startet geplante Läufe oft mit stundenlanger Verspätung. Die Action läuft deshalb **stündlich**
(`17 * * * *`), und `scripts/fetch-prices.mjs` ruft nur ab, wenn im aktuellen Fenster für den Standort noch kein
Abruf in `history.json` steht – sonst endet der Lauf ohne Commit. Ein manueller Start („Run workflow“) ruft immer ab.

Ist `data/prices.json` leer oder älter als 14 Stunden, fragt die Seite die E-Control zusätzlich direkt im Browser ab.

Hinweis: GitHub deaktiviert geplante Workflows in Repositories ohne Aktivität nach 60 Tagen – die automatischen
Commits der Action zählen als Aktivität.

## Preisverlauf

Jeder Abruf der Action hängt einen Eintrag an `data/history.json` an (seit 10.10.2026). Die Seite zeigt daraus
ein Diagramm mit günstigstem und durchschnittlichem Preis (7 Tage / 30 Tage / alles) samt Tabellenansicht.
Mehrere Abrufe innerhalb von 30 Minuten (z. B. ein manueller Start) ersetzen den jeweils letzten Eintrag.
Die Datei wächst um etwa 300 KB pro Jahr.

## Lokal testen

```bash
node scripts/fetch-prices.mjs      # Preise holen (Node ≥ 18)
python3 -m http.server 8000        # dann http://localhost:8000 öffnen
```
