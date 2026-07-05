# GPX Video Overlay

Dieses Projekt erzeugt eine 3D-Kamerafahrt entlang einer GPX-Route mit MapLibre GL JS und einem FastAPI-Backend.

## Architektur

- `backend/`:
  - FastAPI-Endpunkt zum Upload und Parsen von GPX
  - Rückgabe von Trackpunkten + GeoJSON-Linie
- `frontend/`:
  - MapLibre 3D (Terrain + Satelliten-Style)
  - Route zeichnen
  - Kamera folgt der Route mit dynamischem Bearing/Pitch


## 1) Voraussetzungen

- Python 3.11+
- Node.js 20+ (für Videoexport mit Puppeteer/Remotion)
- MapTiler API Key (Free Tier)

## 2) Backend starten

```bash
cd backend
python -m venv .venv
.venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Test: `http://127.0.0.1:8000/health`

## 3) Frontend starten

Du kannst jeden statischen Server nutzen.

```bash
cd frontend
npx serve . -l 5173
```

Dann `http://127.0.0.1:5173` öffnen.

Wichtig:
- API-Key lokal ablegen:
  - `frontend/config.local.example.js` nach `frontend/config.local.js` kopieren
  - In `frontend/config.local.js` deinen echten `MAPTILER_KEY` eintragen
  - `frontend/config.local.js` ist in `.gitignore` und wird nicht nach GitHub gepusht
- Button `Animation aufnehmen & herunterladen` erzeugt einen direkten Download als `.webm`.
- Über `Format` kannst du zwischen `16:9` und `9:16` wechseln (wirkt auf Preview und Aufnahme).
- Oben links wird ein Höhenprofil aus der GPX angezeigt: bereits gefahrene Strecke farbig, restlicher Teil transparent.
- Highlights werden automatisch markiert: schnellster Abschnitt (⚡) und höchster Punkt (▲). Die Kamera verlangsamt dort kurz.
- Foto-Spots: Mit `Bild-Spot` ein Bild wählen und dann auf die Karte klicken. Der Spot erscheint als Marker und wird in der Fahrt kurz eingeblendet.
- Foto-Zeitpunkt-Erkennung: Wenn das Bild einen EXIF-Zeitstempel hat und die GPX Zeitdaten enthält, wird der Foto-Spot automatisch an den passenden Routenzeitpunkt gesetzt (sonst manueller Klick auf die Karte).

## 3b) Typischer Fehler: "NetworkError when attempting to fetch resource"

Der Fehler tritt auf, wenn das Frontend den API-Endpunkt nicht erreicht.

Checkliste:
- Läuft das Backend auf `http://127.0.0.1:8000`?
- Teste im Browser: `http://127.0.0.1:8000/health` (sollte `{"status":"ok"}` liefern)
- Frontend über `http://127.0.0.1:5173` aufrufen (nicht per `file://`)
- Firewall/Proxy prüfen, falls Portzugriff blockiert ist

## 3c) Animation oder Aufnahme haengt auf "laeuft ..."

Moegliche Ursachen:
- GPX hat sehr viele Punkte (mehrere 10k), dadurch wird das Zeichnen pro Frame zu teuer
- Browser blockiert `MediaRecorder`/`captureStream` oder hat GPU/WebGL-Probleme

Bereits im Code abgesichert:
- GPX-Punkte werden fuer die Animation automatisch auf max. 2500 Punkte gesampelt
- Linien-Updates werden zeitlich gedrosselt
- Failsafe beendet die Animation, falls sie das Zeitlimit deutlich ueberzieht

Was du tun kannst:
- Seite hart neu laden (`Ctrl+F5`), damit das neue JS sicher aktiv ist
- Mit kuerzerer Dauer (z. B. 20-40 Sekunden) testen
- Falls Aufnahme leer bleibt: Browser-Konsole auf Fehler pruefen und in Chrome/Edge testen

Hinweis zur Rechenleistung:
- Browser-Aufnahme ist immer Echtzeit und zeigt die Szene waehrenddessen an.
- Fuer echtes Rendern ohne Live-Anzeige nutze den Puppeteer/FFmpeg-Workflow (headless), damit das Encoding nicht an die interaktive Darstellung gebunden ist.

Hinweis zu 9:16 und Bildausschnitt:
- Das 9:16-Format nutzt eigene Kamera-Parameter, damit die Strecke besser im Bild bleibt.
- Vor der Animation werden relevante Streckenkacheln vorgeladen (Tile-Prewarm), um Nachladen und hochskalierte Kacheln waehrend des Videos zu reduzieren.

## 4) Kostenfreie Datenquellen

### Satellit (kostenfrei / low-cost)
- MapTiler Satellite (Free Tier): unkompliziert für den Start
- Sentinel-2 Tiles über öffentliche Endpunkte (mehr Setup-Aufwand)

### Terrain (DEM)
- MapTiler Terrain RGB (Free Tier)
- Alternativ: AWS Terrarium/Terrain-RGB kompatible öffentliche Quellen

## 5) Videoexport per Terminal (Puppeteer + FFmpeg)

Dies ist die zuverlässigste Methode und erzeugt direkt MP4-Dateien.

### Schritt-für-Schritt Anleitung

1. **Alle Dienste starten**:
   - **Backend**: Im `backend/`-Verzeichnis:
     ```bash
     cd backend
     .venv\Scripts\activate  # Windows
     # source .venv/bin/activate  # macOS/Linux
     uvicorn main:app --reload --host 127.0.0.1 --port 8000
     ```
   - **Frontend**: Im `frontend/`-Verzeichnis (in einem separaten Terminal):
     ```bash
     cd frontend
     npx serve . -l 5173
     ```

2. **Render-Abhängigkeiten installieren**:
   - Im `render`-Verzeichnis einmalig ausführen:
     ```bash
     cd render
     npm install
     npx puppeteer browsers install chrome
     ```

3. **FFmpeg installieren (falls nicht vorhanden)**:
   - **Windows**: Lade von https://ffmpeg.org/download.html herunter, extrahiere und füge den `bin/`-Ordner zum PATH hinzu, oder nutze Chocolatey: `choco install ffmpeg`
   - **macOS**: `brew install ffmpeg`
   - **Linux**: `sudo apt-get install ffmpeg` (Debian/Ubuntu)

4. **Render-Prozess starten**:
   - **Option A: Aus Projekt-Root (empfohlen)** (der Ordner mit `frontend/`, `backend/`, `render/`):
     ```bash
     # Beispiel für 16:9 Format:
     node render/render-headless.js --gpx pfad/zu/deiner.gpx --output mein-video.mp4 --format landscape --duration 40 --fps 30
     
     # Beispiel für 9:16 Format (Portrait):
     node render/render-headless.js --gpx pfad/zu/deiner.gpx --output mein-video-portrait.mp4 --format portrait --duration 40 --fps 30
     ```
   - **Option B: Aus render/-Verzeichnis**:
     ```bash
     cd render
     node render-headless.js --gpx ../pfad/zu/deiner.gpx --output ../mein-video.mp4 --format landscape --duration 40 --fps 30
     ```

### Parameter-Übersicht

| Parameter          | Beschreibung                                                                 | Standardwert                  |
|--------------------|-------------------------------------------------------------------------------|-------------------------------|
| `--gpx`            | Pfad zur GPX-Datei (erforderlich!)                                           | -                             |
| `--output`         | Pfad zur Ausgabe-MP4-Datei                                                    | `out.mp4`                     |
| `--format`         | `landscape` (16:9) oder `portrait` (9:16)                                     | `landscape`                   |
| `--duration`       | Animationsdauer in Sekunden                                                    | `40`                          |
| `--fps`            | Frames pro Sekunde für das fertige Video                                      | `30`                          |
| `--frontend-url`   | URL zum lokalen Frontend (nur ändern, falls du einen anderen Port nutzt)      | `http://127.0.0.1:5173`       |
| `--api-url`        | URL zum Backend (nur ändern, falls du einen anderen Port nutzt)               | `http://127.0.0.1:8000`       |

### Beispielaufrufe

- **Kurzes Testvideo**: `node render/render-headless.js --gpx test.gpx --output test.mp4 --duration 20`
- **HQ-Video (60 FPS)**: `node render/render-headless.js --gpx lang.gpx --output hq-video.mp4 --fps 60 --duration 60`
- **Portrait-Video**: `node render/render-headless.js --gpx social.gpx --output social.mp4 --format portrait`

### Fehlerbehebung beim Rendern

- **"Backend läuft nicht!"**: Überprüfe, ob Backend auf Port 8000 läuft (öffne http://127.0.0.1:8000/health im Browser - sollte `{"status":"ok"}` anzeigen)
- **"window.gpxOverlay is not available"**: Überprüfe, ob Frontend auf Port 5173 läuft (öffne http://127.0.0.1:5173 im Browser)
- **"ffmpeg not found"**: Stelle sicher, dass FFmpeg im PATH ist (öffne ein neues Terminal und teste mit `ffmpeg -version`)

Direkt aus der aktuellen App:
- Die Aufnahme erfolgt im Browser über `MediaRecorder` und wird als `.webm` gespeichert.
- Um `.mp4` zu erhalten, anschließend mit FFmpeg konvertieren:

```bash
ffmpeg -i gpx-flight-INPUT.webm -c:v libx264 -pix_fmt yuv420p gpx-flight.mp4
```

Qualitätstipps für bessere Exporte:
- Browserfenster vor der Aufnahme vergrößern (z. B. 2560x1440 statt 1280x720)
- Browser-Zoom auf 100% lassen
- In Chrome/Edge aufnehmen (meist bessere WebM-Qualität)
- Für finale MP4-Qualität mit höherer Qualität konvertieren:

```bash
ffmpeg -i gpx-flight-INPUT.webm -c:v libx264 -crf 16 -preset slow -pix_fmt yuv420p gpx-flight-hq.mp4
```

## 6) Videoexport-Option B: Remotion

Idee:
1. Remotion steuert den Timeline-Render
2. Pro Frame Position/Bearing aus GPX-Samples berechnen
3. MapLibre in Render-Komponente mit fixed camera params betreiben
4. Mit `remotion render` direkt MP4 ausgeben

Wichtig bei Remotion:
- Headless Rendering von WebGL kann je nach Umgebung GPU/Flags benötigen
- Für reproduzierbare Ergebnisse: framebasierte Interpolation statt realtime easing


## API Response (Parse)

`POST /api/gpx/parse` liefert u. a.:
- `points`: Liste aus `lon`, `lat`, `ele`, `time`
- `line`: GeoJSON Feature (LineString)
- `pointCount`, `start`, `end`
