from __future__ import annotations

from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Any
import re
import subprocess
import tempfile
import threading
import uuid
from fastapi.responses import FileResponse

import gpxpy
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
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

render_jobs: dict[str, dict[str, Any]] = {}


def _update_render_job_progress(job: dict[str, Any], line: str) -> None:
    text = line.strip()
    if not text:
        return

    job["last_log_line"] = text
    recent_logs = job.setdefault("recent_logs", [])
    recent_logs.append(text)
    if len(recent_logs) > 20:
        del recent_logs[:-20]

    if text.startswith("[1/5]"):
        job["stage"] = "parsing"
        job["message"] = "GPX wird verarbeitet..."
        job["progress"] = max(job.get("progress", 0), 5)
        return

    if text.startswith("[2/5]"):
        job["stage"] = "browser"
        job["message"] = "Headless Browser wird gestartet..."
        job["progress"] = max(job.get("progress", 0), 10)
        return

    if text.startswith("[3/5]"):
        job["stage"] = "prewarming"
        job["message"] = "Route wird geladen und Tiles werden vorbereitet..."
        job["progress"] = max(job.get("progress", 0), 18)
        return

    if text.startswith("[4/5]"):
        job["stage"] = "capturing"
        job["message"] = "Frames werden gerendert..."
        job["progress"] = max(job.get("progress", 0), 25)
        return

    if text.startswith("[5/5]"):
        job["stage"] = "encoding"
        job["message"] = "Video wird kodiert..."
        job["progress"] = max(job.get("progress", 0), 96)
        return

    total_match = re.search(r"Total frames to capture:\s*(\d+)", text)
    if total_match:
        total_frames = int(total_match.group(1))
        job["total_frames"] = total_frames
        job["message"] = f"0 von {total_frames} Frames gerendert"
        job["progress"] = max(job.get("progress", 0), 25)
        return

    frame_match = re.search(r"Captured frame\s+(\d+)\/(\d+)", text)
    if frame_match:
        current_frame = int(frame_match.group(1))
        total_frames = int(frame_match.group(2))
        job["stage"] = "capturing"
        job["current_frame"] = current_frame
        job["total_frames"] = total_frames
        capture_progress = 25 + round((current_frame / max(total_frames, 1)) * 68)
        job["progress"] = max(job.get("progress", 0), min(capture_progress, 93))
        job["message"] = f"{current_frame} von {total_frames} Frames gerendert"
        return

    if text.startswith("Done:"):
        job["stage"] = "done"
        job["message"] = "Rendern abgeschlossen"
        job["progress"] = 100


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


def _start_render_job(
    job_id: str,
    temp_dir: Path,
    gpx_path: Path,
    output_path: Path,
    duration: int,
    format: str,
    fps: int,
    show_altitude: bool,
) -> None:
    job = render_jobs[job_id]
    job["status"] = "running"

    import sys

    render_dir = Path(__file__).parent.parent / "render"
    script_path = render_dir / "render-headless.js"
    node_cmd = "node.exe" if sys.platform == "win32" else "node"

    cmd = [
        node_cmd,
        str(script_path.absolute()),
        "--gpx", str(gpx_path.absolute()),
        "--output", str(output_path.absolute()),
        "--duration", str(duration),
        "--fps", str(fps),
        "--format", format,
        "--show-altitude", "1" if show_altitude else "0",
        "--frontend-url", "http://127.0.0.1:5173",
        "--api-url", "http://127.0.0.1:8000",
    ]

    print(f"Starting render job {job_id}: {' '.join(cmd)}")
    print(f"Working directory: {render_dir.absolute()}")

    try:
        process = subprocess.Popen(
            cmd,
            cwd=str(render_dir.absolute()),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        output_lines: list[str] = []

        assert process.stdout is not None
        for line in process.stdout:
            output_lines.append(line)
            print(line, end="")
            _update_render_job_progress(job, line)
            job["updated_at"] = datetime.now().isoformat()

        return_code = process.wait()
        combined_output = "".join(output_lines)
        job["stdout"] = combined_output
        job["stderr"] = ""

        if return_code != 0:
            print(f"=== RENDER FAILED ({job_id}) ===")
            print(f"EXIT CODE: {return_code}")
            job["status"] = "error"
            job["error"] = f"Rendering failed!\nCode: {return_code}\nOutput: {combined_output}"
        else:
            job["status"] = "done"
            job["output_path"] = str(output_path.absolute())
            job["stage"] = "done"
            job["message"] = "Rendern abgeschlossen"
            job["progress"] = 100
    except Exception as exc:  # noqa: BLE001
        print(f"=== RENDER FAILED ({job_id}) ===")
        print(str(exc))
        job["status"] = "error"
        job["error"] = str(exc)
        job["message"] = "Rendern fehlgeschlagen"
        job["stderr"] = str(exc)
    finally:
        job["updated_at"] = datetime.now().isoformat()


@app.post("/api/gpx/render")
async def render_gpx(
    file: UploadFile = File(...),
    duration: int = 40,
    format: str = "landscape",
    fps: int = 30,
    show_altitude: int = Query(1, alias="showAltitude"),
):
    if not file.filename or not file.filename.lower().endswith(".gpx"):
        raise HTTPException(status_code=400, detail="Please upload a .gpx file.")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    # Create temp directory for this render job
    job_id = str(uuid.uuid4())
    temp_dir = Path(tempfile.gettempdir()) / "gpx-video" / job_id
    temp_dir.mkdir(parents=True, exist_ok=True)

    # Save the uploaded GPX
    gpx_path = temp_dir / "input.gpx"
    gpx_path.write_bytes(raw)

    output_path = temp_dir / "output.mp4"

    render_jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "stage": "queued",
        "progress": 0,
        "message": "Render-Job ist in der Warteschlange...",
        "current_frame": 0,
        "total_frames": None,
        "last_log_line": "",
        "recent_logs": [],
        "created_at": datetime.now().isoformat(),
        "updated_at": datetime.now().isoformat(),
        "temp_dir": str(temp_dir.absolute()),
        "output_path": str(output_path.absolute()),
        "stdout": "",
        "stderr": "",
        "error": None,
    }

    thread = threading.Thread(
        target=_start_render_job,
        args=(job_id, temp_dir, gpx_path, output_path, duration, format, fps, show_altitude != 0),
        daemon=True,
    )
    thread.start()

    return {"jobId": job_id, "status": "queued"}


@app.get("/api/gpx/render/{job_id}")
def get_render_job(job_id: str) -> dict[str, Any]:
    job = render_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Render job not found.")

    return {
        "jobId": job["job_id"],
        "status": job["status"],
        "stage": job["stage"],
        "progress": job["progress"],
        "message": job["message"],
        "currentFrame": job["current_frame"],
        "totalFrames": job["total_frames"],
        "lastLogLine": job["last_log_line"],
        "createdAt": job["created_at"],
        "updatedAt": job["updated_at"],
        "error": job["error"],
    }


@app.get("/api/gpx/render/{job_id}/download")
def download_render_job(job_id: str) -> FileResponse:
    job = render_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Render job not found.")
    if job["status"] != "done":
        raise HTTPException(status_code=409, detail="Render job is not finished yet.")

    output_path = Path(job["output_path"])
    if not output_path.exists():
        raise HTTPException(status_code=500, detail="Rendered video file is missing.")

    return FileResponse(
        path=str(output_path.absolute()),
        media_type="video/mp4",
        filename=f"gpx-video-{datetime.now().strftime('%Y%m%d-%H%M%S')}.mp4",
    )
