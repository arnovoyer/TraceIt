from __future__ import annotations

from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Any
import subprocess
import tempfile
import threading
import uuid
from fastapi.responses import FileResponse

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

render_jobs: dict[str, dict[str, Any]] = {}


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
        "--frontend-url", "http://127.0.0.1:5173",
        "--api-url", "http://127.0.0.1:8000",
    ]

    print(f"Starting render job {job_id}: {' '.join(cmd)}")
    print(f"Working directory: {render_dir.absolute()}")

    try:
        result = subprocess.run(
            cmd,
            cwd=str(render_dir.absolute()),
            check=True,
            capture_output=True,
            text=True,
        )
        job["status"] = "done"
        job["stdout"] = result.stdout
        job["stderr"] = result.stderr
        job["output_path"] = str(output_path.absolute())
    except subprocess.CalledProcessError as e:
        print(f"=== RENDER FAILED ({job_id}) ===")
        print(f"EXIT CODE: {e.returncode}")
        print(f"STDOUT: {e.stdout}")
        print(f"STDERR: {e.stderr}")
        job["status"] = "error"
        job["stdout"] = e.stdout
        job["stderr"] = e.stderr
        job["error"] = (
            f"Rendering failed!\nCode: {e.returncode}\nStdout: {e.stdout}\nStderr: {e.stderr}"
        )
    except Exception as exc:  # noqa: BLE001
        job["status"] = "error"
        job["error"] = str(exc)
    finally:
        job["updated_at"] = datetime.now().isoformat()


@app.post("/api/gpx/render")
async def render_gpx(
    file: UploadFile = File(...),
    duration: int = 40,
    format: str = "landscape",
    fps: int = 30
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
        args=(job_id, temp_dir, gpx_path, output_path, duration, format, fps),
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
