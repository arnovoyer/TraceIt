from __future__ import annotations

from datetime import datetime
from io import StringIO
from typing import Any

import gpxpy
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="GPX Video Overlay API", version="0.1.0")

# Development CORS setup for local frontend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _isoformat_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/gpx/parse")
async def parse_gpx(file: UploadFile = File(...)) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".gpx"):
        raise HTTPException(status_code=400, detail="Please upload a .gpx file.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        text = raw.decode("utf-8", errors="ignore")
        gpx = gpxpy.parse(StringIO(text))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid GPX format: {exc}") from exc

    coordinates: list[list[float]] = []
    points_data: list[dict[str, Any]] = []

    for track in gpx.tracks:
        for segment in track.segments:
            for point in segment.points:
                lon = float(point.longitude)
                lat = float(point.latitude)
                ele = float(point.elevation) if point.elevation is not None else 0.0

                coordinates.append([lon, lat, ele])
                points_data.append(
                    {
                        "lon": lon,
                        "lat": lat,
                        "ele": ele,
                        "time": _isoformat_or_none(point.time),
                    }
                )

    if not coordinates:
        for route in gpx.routes:
            for point in route.points:
                lon = float(point.longitude)
                lat = float(point.latitude)
                ele = float(point.elevation) if point.elevation is not None else 0.0

                coordinates.append([lon, lat, ele])
                points_data.append(
                    {
                        "lon": lon,
                        "lat": lat,
                        "ele": ele,
                        "time": None,
                    }
                )

    if not coordinates:
        raise HTTPException(status_code=400, detail="No track/route points found in GPX.")

    # GeoJSON line for easy MapLibre consumption.
    route_geojson = {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [[c[0], c[1]] for c in coordinates],
        },
        "properties": {},
    }

    return {
        "filename": file.filename,
        "pointCount": len(coordinates),
        "start": points_data[0],
        "end": points_data[-1],
        "points": points_data,
        "line": route_geojson,
    }
