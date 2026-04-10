# GPX Video Overlay (Starter)

Dieses Starter-Projekt erzeugt eine 3D-Kamerafahrt entlang einer GPX-Route mit MapLibre GL JS und einem FastAPI-Backend.

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

## 5) Videoexport-Option A: Puppeteer (Canvas aufnehmen)

Idee:
1. Frontend-Route und Kameraanimation deterministic ablaufen lassen
2. In Chromium per Puppeteer Seite öffnen
3. Frames per `page.screenshot()` oder via MediaRecorder erfassen
4. Mit FFmpeg zu MP4 encoden

Minimaler Ablauf:
1. Starte Frontend lokal
2. Puppeteer-Skript lädt URL mit Query-Parametern (GPX/Timing)
3. Trigger `window.startRenderMode()`
4. 30/60 FPS Frames aufnehmen
5. `ffmpeg -framerate 30 -i frame-%06d.png -c:v libx264 -pix_fmt yuv420p out.mp4`

Vorteil:
- Bleibt nahe an deinem echten MapLibre-Canvas

Headless-Variante (ohne sichtbare Wiedergabe):

```bash
cd render
npm install
node render-headless.js --gpx ../sample.gpx --output ../out.mp4 --format portrait --duration 40 --fps 30
```

Parameter:
- `--format landscape|portrait` (`landscape` = 16:9, `portrait` = 9:16)
- `--duration` Animationsdauer in Sekunden
- `--fps` Ziel-FPS fuer die Ausgabe
- Optional: `--frontend-url` und `--api-url`

Voraussetzungen:
- Frontend und Backend muessen laufen (`5173` und `8000`)
- `ffmpeg` muss im PATH verfuegbar sein

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

## 7) Nächste Ausbaustufen

- GPX-Glättung (Douglas-Peucker / Catmull-Rom)
- Geschwindigkeitsabhängige Kamera (Zoom/Pitch variabel)
- Höhenprofil-Overlay
- Serverseitige Render-Queue (z. B. Celery + FFmpeg)

## API Response (Parse)

`POST /api/gpx/parse` liefert u. a.:
- `points`: Liste aus `lon`, `lat`, `ele`, `time`
- `line`: GeoJSON Feature (LineString)
- `pointCount`, `start`, `end`
