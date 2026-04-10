const API_BASE_URL = "http://127.0.0.1:8000";

const MAPTILER_KEY = window.APP_CONFIG?.MAPTILER_KEY || "";
if (!MAPTILER_KEY) {
  throw new Error("Missing MAPTILER_KEY. Create frontend/config.local.js based on frontend/config.local.example.js.");
}

const statusText = document.getElementById("statusText");
const gpxInput = document.getElementById("gpxInput");
const playButton = document.getElementById("playButton");
const recordButton = document.getElementById("recordButton");
const durationInput = document.getElementById("durationInput");
const formatSelect = document.getElementById("formatSelect");
const mapFrame = document.getElementById("mapFrame");
const altitudeOverlay = document.getElementById("altitudeOverlay");
const altitudeAreaBg = document.getElementById("altitudeAreaBg");
const altitudeAreaDone = document.getElementById("altitudeAreaDone");
const altitudeLineBg = document.getElementById("altitudeLineBg");
const altitudeLineDone = document.getElementById("altitudeLineDone");
const altitudeClipRect = document.getElementById("altitudeClipRect");
const altitudeProgressLabel = document.getElementById("altitudeProgressLabel");
const altitudeMin = document.getElementById("altitudeMin");
const altitudeMax = document.getElementById("altitudeMax");

let routePoints = [];
let cameraPoints = [];
let animationFrameId = null;
let isRecording = false;
let altitudeOverlayState = null;

const MAX_ANIMATION_POINTS = 2500;
const MAX_DENSE_POINTS = 9000;
const MAX_ALTITUDE_POINTS = 700;
const TRAIL_UPDATE_INTERVAL_MS = 16;

const CAMERA_CONFIG = {
  pitch: 74,
  zoom: 14.2,
  sideOffsetM: 420,
  backOffsetM: 360,
  centerSmoothing: 0.032,
  bearingSmoothing: 0.038,
  lookAheadPoints: 56,
  focusAheadPoints: 18,
  bearingWindow: 30,
  maxBearingSpeedDegPerSec: 16,
  outroPitch: 16,
  outroBearing: 0,
  outroPadding: 68,
};

const FORMAT_CAMERA_OVERRIDES = {
  landscape: {
    sideOffsetM: 420,
    backOffsetM: 360,
    zoom: 14.2,
    pitch: 74,
    outroPitch: 16,
    outroPadding: 68,
  },
  portrait: {
    sideOffsetM: 300,
    backOffsetM: 240,
    zoom: 13.6,
    pitch: 72,
    lookAheadPoints: 62,
    focusAheadPoints: 22,
    bearingWindow: 34,
    maxBearingSpeedDegPerSec: 13,
    outroPitch: 6,
    outroPadding: {
      top: 145,
      bottom: 145,
      left: 58,
      right: 58,
    },
  },
};

const FORMAT_CONFIG = {
  landscape: { label: "16:9" },
  portrait: { label: "9:16" },
};

function setStatus(text) {
  statusText.textContent = text;
}

function createStyleUrl() {
  return `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`;
}

const map = new maplibregl.Map({
  container: "map",
  style: createStyleUrl(),
  center: [11.5755, 48.1374],
  zoom: 11,
  pitch: 65,
  bearing: 0,
  antialias: true,
});

function applySelectedFormat() {
  const selected = formatSelect?.value === "portrait" ? "portrait" : "landscape";
  mapFrame.classList.toggle("portrait", selected === "portrait");
  mapFrame.classList.toggle("landscape", selected === "landscape");

  requestAnimationFrame(() => {
    map.resize();
  });

  return selected;
}

function getSelectedFormatKey() {
  return formatSelect?.value === "portrait" ? "portrait" : "landscape";
}

function getActiveCameraConfig() {
  const formatKey = getSelectedFormatKey();
  return { ...CAMERA_CONFIG, ...(FORMAT_CAMERA_OVERRIDES[formatKey] || {}) };
}

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

map.on("load", () => {
  map.addSource("terrainSource", {
    type: "raster-dem",
    // MapTiler terrain-rgb source in free tier.
    tiles: [
      `https://api.maptiler.com/tiles/terrain-rgb-v2/{z}/{x}/{y}.webp?key=${MAPTILER_KEY}`,
    ],
    tileSize: 256,
    maxzoom: 14,
  });

  map.setTerrain({ source: "terrainSource", exaggeration: 1.2 });

  map.addLayer({
    id: "sky",
    type: "sky",
    paint: {
      "sky-type": "atmosphere",
      "sky-atmosphere-sun-intensity": 10,
    },
  });
});

function computeBearing(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const toDeg = (rad) => (rad * 180) / Math.PI;

  const lon1 = toRad(a.lon);
  const lat1 = toRad(a.lat);
  const lon2 = toRad(b.lon);
  const lat2 = toRad(b.lat);

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function interpolatePoint(p1, p2, t) {
  return {
    lon: p1.lon + (p2.lon - p1.lon) * t,
    lat: p1.lat + (p2.lat - p1.lat) * t,
    ele: p1.ele + (p2.ele - p1.ele) * t,
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function shortestAngleDelta(fromDeg, toDeg) {
  return ((toDeg - fromDeg + 540) % 360) - 180;
}

function createLineFeature(coords) {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: coords,
    },
    properties: {},
  };
}

function createPointFeature(lon, lat, properties = {}) {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [lon, lat],
    },
    properties,
  };
}

function buildAltitudePathData(points) {
  if (!points || points.length < 2) {
    return null;
  }

  const stride = Math.max(1, Math.ceil(points.length / MAX_ALTITUDE_POINTS));
  const sampled = [];
  for (let i = 0; i < points.length; i += stride) {
    sampled.push(points[i]);
  }
  if (sampled[sampled.length - 1] !== points[points.length - 1]) {
    sampled.push(points[points.length - 1]);
  }

  const distances = [0];
  let totalDistance = 0;
  for (let i = 1; i < sampled.length; i += 1) {
    totalDistance += distanceMeters(sampled[i - 1], sampled[i]);
    distances.push(totalDistance);
  }

  if (totalDistance <= 0) {
    return null;
  }

  let minEle = Number.POSITIVE_INFINITY;
  let maxEle = Number.NEGATIVE_INFINITY;
  sampled.forEach((p) => {
    minEle = Math.min(minEle, p.ele);
    maxEle = Math.max(maxEle, p.ele);
  });

  if (!Number.isFinite(minEle) || !Number.isFinite(maxEle)) {
    return null;
  }

  const width = 320;
  const height = 96;
  const topPad = 8;
  const bottomPad = 10;
  const plotHeight = height - topPad - bottomPad;
  const elevationRange = Math.max(1, maxEle - minEle);

  const coords = sampled.map((p, idx) => {
    const x = (distances[idx] / totalDistance) * width;
    const eleNorm = (p.ele - minEle) / elevationRange;
    const y = topPad + (1 - eleNorm) * plotHeight;
    return { x, y };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return {
    linePath,
    areaPath,
    width,
    height,
    minEle,
    maxEle,
  };
}

function updateAltitudeOverlayProgress(progress) {
  if (!altitudeOverlayState || !altitudeClipRect) {
    return;
  }

  const clamped = Math.min(1, Math.max(0, progress));
  altitudeClipRect.setAttribute("width", String(altitudeOverlayState.width * clamped));
  altitudeProgressLabel.textContent = `${Math.round(clamped * 100)}%`;
}

function renderAltitudeOverlay(points) {
  const data = buildAltitudePathData(points);
  altitudeOverlayState = data;

  if (!data) {
    altitudeOverlay.classList.add("hidden");
    return;
  }

  altitudeAreaBg.setAttribute("d", data.areaPath);
  altitudeAreaDone.setAttribute("d", data.areaPath);
  altitudeLineBg.setAttribute("d", data.linePath);
  altitudeLineDone.setAttribute("d", data.linePath);
  altitudeClipRect.setAttribute("height", String(data.height));

  altitudeMin.textContent = `${Math.round(data.minEle)} m`;
  altitudeMax.textContent = `${Math.round(data.maxEle)} m`;
  updateAltitudeOverlayProgress(0);
  altitudeOverlay.classList.remove("hidden");
}

function sanitizeAndSamplePoints(points) {
  const cleaned = points.filter(
    (p) => Number.isFinite(p.lon) && Number.isFinite(p.lat) && Number.isFinite(p.ele)
  );

  if (cleaned.length <= MAX_ANIMATION_POINTS) {
    return cleaned;
  }

  const sampled = [];
  const stride = Math.ceil(cleaned.length / MAX_ANIMATION_POINTS);

  for (let i = 0; i < cleaned.length; i += stride) {
    sampled.push(cleaned[i]);
  }

  const last = cleaned[cleaned.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }

  return sampled;
}

function smoothRoutePoints(points, windowSize = 6) {
  if (points.length < 3) {
    return points;
  }

  const smoothed = [];
  for (let i = 0; i < points.length; i += 1) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(points.length - 1, i + windowSize);

    let sumLon = 0;
    let sumLat = 0;
    let sumEle = 0;
    let count = 0;

    for (let j = start; j <= end; j += 1) {
      sumLon += points[j].lon;
      sumLat += points[j].lat;
      sumEle += points[j].ele;
      count += 1;
    }

    smoothed.push({
      lon: sumLon / count,
      lat: sumLat / count,
      ele: sumEle / count,
    });
  }

  smoothed[0] = points[0];
  smoothed[smoothed.length - 1] = points[points.length - 1];
  return smoothed;
}

function distanceMeters(a, b) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusM = 6371000;

  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);

  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  return 2 * earthRadiusM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function densifyRoutePoints(points, maxStepMeters = 18) {
  if (points.length < 2) {
    return points;
  }

  const dense = [points[0]];

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const segmentMeters = distanceMeters(a, b);
    const steps = Math.max(1, Math.ceil(segmentMeters / maxStepMeters));

    for (let s = 1; s <= steps; s += 1) {
      dense.push(interpolatePoint(a, b, s / steps));
    }
  }

  if (dense.length <= MAX_DENSE_POINTS) {
    return dense;
  }

  const sampledDense = [];
  const stride = Math.ceil(dense.length / MAX_DENSE_POINTS);
  for (let i = 0; i < dense.length; i += stride) {
    sampledDense.push(dense[i]);
  }

  const last = dense[dense.length - 1];
  if (sampledDense[sampledDense.length - 1] !== last) {
    sampledDense.push(last);
  }

  return sampledDense;
}

function buildRouteBounds(points) {
  const bounds = new maplibregl.LngLatBounds();
  points.forEach((p) => bounds.extend([p.lon, p.lat]));
  return bounds;
}

function playRouteOutro(durationMs = 2600) {
  return new Promise((resolve) => {
    if (routePoints.length < 2) {
      resolve();
      return;
    }

    const bounds = buildRouteBounds(routePoints);
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };

    const cfg = getActiveCameraConfig();
    map.once("moveend", finish);
    map.fitBounds(bounds, {
      padding: cfg.outroPadding,
      duration: durationMs,
      pitch: cfg.outroPitch,
      bearing: cfg.outroBearing,
      maxZoom: 12.5,
    });

    setTimeout(finish, durationMs + 300);
  });
}

function resetAnimatedRouteLine() {
  if (!map.getSource("route") || routePoints.length === 0) {
    return;
  }

  const first = routePoints[0];
  map.getSource("route").setData(createLineFeature([[first.lon, first.lat]]));
}

function updateRouteHead(currentPoint, currentBearing) {
  const headSource = map.getSource("routeHead");
  if (!headSource) {
    return;
  }

  headSource.setData(createPointFeature(currentPoint.lon, currentPoint.lat, { bearing: currentBearing }));
}

function getStableBearing(points, segmentIndex) {
  const cfg = getActiveCameraConfig();
  const fromIndex = Math.max(0, segmentIndex - cfg.bearingWindow);
  const toIndex = Math.min(points.length - 1, segmentIndex + cfg.bearingWindow);

  const from = points[fromIndex];
  const to = points[toIndex];

  return computeBearing(from, to);
}

function addHelicopterOffset(point, bearingDeg) {
  const cfg = getActiveCameraConfig();
  const latRad = (point.lat * Math.PI) / 180;
  const metersPerDegLat = 111320;
  const metersPerDegLon = 111320 * Math.max(0.2, Math.cos(latRad));

  const backRad = ((bearingDeg + 180) * Math.PI) / 180;
  const sideRad = ((bearingDeg + 90) * Math.PI) / 180;

  const offsetNorthM =
    Math.cos(backRad) * cfg.backOffsetM +
    Math.cos(sideRad) * cfg.sideOffsetM;
  const offsetEastM =
    Math.sin(backRad) * cfg.backOffsetM +
    Math.sin(sideRad) * cfg.sideOffsetM;

  return {
    lon: point.lon + offsetEastM / metersPerDegLon,
    lat: point.lat + offsetNorthM / metersPerDegLat,
  };
}

function clearExistingRoute() {
  if (map.getLayer("routeHeadGlow")) {
    map.removeLayer("routeHeadGlow");
  }
  if (map.getLayer("routeHead")) {
    map.removeLayer("routeHead");
  }
  if (map.getLayer("routeLine")) {
    map.removeLayer("routeLine");
  }
  if (map.getSource("routeHead")) {
    map.removeSource("routeHead");
  }
  if (map.getSource("route")) {
    map.removeSource("route");
  }
}

function drawRouteLine() {
  clearExistingRoute();

  const initialCoords = routePoints.length > 0 ? [[routePoints[0].lon, routePoints[0].lat]] : [];

  map.addSource("route", {
    type: "geojson",
    lineMetrics: true,
    data: createLineFeature(initialCoords),
  });

  map.addSource("routeHead", {
    type: "geojson",
    data: createPointFeature(routePoints[0].lon, routePoints[0].lat),
  });

  map.addLayer({
    id: "routeLine",
    type: "line",
    source: "route",
    paint: {
      "line-color": "#80ffdb",
      "line-width": 5,
      "line-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "routeHeadGlow",
    type: "circle",
    source: "routeHead",
    paint: {
      "circle-radius": 18,
      "circle-color": "#ffe000",
      "circle-opacity": 0.4,
      "circle-blur": 0.85,
    },
  });

  map.addLayer({
    id: "routeHead",
    type: "circle",
    source: "routeHead",
    paint: {
      "circle-radius": 6,
      "circle-color": "#fff36d",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#fffef4",
    },
  });
}

function fitMapToRoute() {
  const bounds = new maplibregl.LngLatBounds();
  routePoints.forEach((p) => bounds.extend([p.lon, p.lat]));
  map.fitBounds(bounds, { padding: 80, duration: 1200, pitch: 60 });
}

function waitForMapIdle(timeoutMs = 260) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      resolve();
    };

    map.once("idle", finish);
    setTimeout(finish, timeoutMs);
  });
}

function pointAtProgress(points, progress) {
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return points[0];
  }

  const segmentCount = points.length - 1;
  const scaled = Math.min(1, Math.max(0, progress)) * segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = scaled - segmentIndex;
  return interpolatePoint(points[segmentIndex], points[segmentIndex + 1], localT);
}

async function prewarmRouteTiles() {
  if (routePoints.length < 2) {
    return;
  }

  const activePoints = cameraPoints.length >= 2 ? cameraPoints : routePoints;
  const cfg = getActiveCameraConfig();
  const sampleCount = 18;
  const originalCamera = {
    center: map.getCenter(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
    zoom: map.getZoom(),
  };

  setStatus("Satellitenkacheln werden vorgeladen ...");

  for (let i = 0; i < sampleCount; i += 1) {
    const progress = sampleCount === 1 ? 1 : i / (sampleCount - 1);
    const current = pointAtProgress(activePoints, progress);
    if (!current) {
      continue;
    }

    const segmentIndex = Math.min(
      activePoints.length - 1,
      Math.floor(progress * Math.max(1, activePoints.length - 1))
    );
    const lookAheadIndex = Math.min(activePoints.length - 1, segmentIndex + cfg.lookAheadPoints);
    const bearing = getStableBearing(activePoints, lookAheadIndex);
    const focusIndex = Math.min(activePoints.length - 1, segmentIndex + cfg.focusAheadPoints);
    const focusPoint = activePoints[focusIndex];
    const offsetCenter = addHelicopterOffset(focusPoint, bearing);

    map.jumpTo({
      center: [offsetCenter.lon, offsetCenter.lat],
      bearing,
      pitch: cfg.pitch,
      zoom: cfg.zoom,
    });

    await waitForMapIdle(220);
  }

  map.jumpTo({
    center: originalCamera.center,
    bearing: originalCamera.bearing,
    pitch: originalCamera.pitch,
    zoom: originalCamera.zoom,
  });
}

async function applyParsedGpxData(data) {
  const sampledPoints = sanitizeAndSamplePoints(data.points);
  routePoints = densifyRoutePoints(sampledPoints, 10);
  cameraPoints = smoothRoutePoints(routePoints, 8);
  renderAltitudeOverlay(sampledPoints);

  if (!map.isStyleLoaded()) {
    await new Promise((resolve) => map.once("load", resolve));
  }

  drawRouteLine();
  fitMapToRoute();
  await waitForMapIdle(450);
  await prewarmRouteTiles();

  playButton.disabled = false;
  recordButton.disabled = false;

  if (sampledPoints.length < data.pointCount) {
    setStatus(
      `GPX geladen: ${data.pointCount} Punkte (fuer fluessige Animation auf ${sampledPoints.length} gesampelt, auf ${routePoints.length} Zwischenpunkte verdichtet).`
    );
  } else {
    setStatus(
      `GPX geladen: ${data.pointCount} Punkte (auf ${routePoints.length} Zwischenpunkte verdichtet).`
    );
  }
}

function stopAnimation() {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

function startAnimation() {
  return new Promise((resolve) => {
    if (routePoints.length < 2) {
      setStatus("Zu wenige Punkte fuer Animation.");
      resolve(false);
      return;
    }

    stopAnimation();

    const durationSeconds = Number(durationInput.value || 40);
    const durationMs = Math.max(5000, durationSeconds * 1000);
    const activePoints = cameraPoints.length >= 2 ? cameraPoints : routePoints;
    const cfg = getActiveCameraConfig();
    const segmentCount = activePoints.length - 1;
    const startTime = performance.now();
    const hardStopTime = startTime + durationMs + 3000;
    let smoothedBearing = null;
    let smoothedCenter = null;
    let lastFrameAt = startTime;
    let lastDrawnSegment = 0;
    let lastTrailUpdateAt = 0;
    const trailCoords = [[routePoints[0].lon, routePoints[0].lat]];

    resetAnimatedRouteLine();
    updateRouteHead(routePoints[0], 0);
    updateAltitudeOverlayProgress(0);

    const animate = (now) => {
      try {
        const elapsed = now - startTime;
        const dtMs = Math.max(1, now - lastFrameAt);
        lastFrameAt = now;
        const timedOut = now >= hardStopTime;
        const progress = timedOut ? 1 : Math.min(1, Math.max(0, elapsed / durationMs));
        updateAltitudeOverlayProgress(progress);

        const scaled = progress * segmentCount;
        const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
        const localT = scaled - segmentIndex;

        const current = interpolatePoint(
          activePoints[segmentIndex],
          activePoints[segmentIndex + 1],
          localT
        );
        const lookAheadIndex = Math.min(
          activePoints.length - 1,
          segmentIndex + cfg.lookAheadPoints
        );
        const rawBearing = getStableBearing(activePoints, lookAheadIndex);

        if (smoothedBearing === null) {
          smoothedBearing = rawBearing;
        } else {
          const delta = shortestAngleDelta(smoothedBearing, rawBearing);
          const smoothedDelta = delta * cfg.bearingSmoothing;
          const maxStep = (cfg.maxBearingSpeedDegPerSec * dtMs) / 1000;
          const limitedDelta = Math.max(-maxStep, Math.min(maxStep, smoothedDelta));
          smoothedBearing += limitedDelta;
        }

        if (!Number.isFinite(smoothedBearing)) {
          smoothedBearing = rawBearing;
        }

        const focusIndex = Math.min(
          activePoints.length - 1,
          segmentIndex + cfg.focusAheadPoints
        );
        const focusPoint = activePoints[focusIndex];
        const offsetCenter = addHelicopterOffset(focusPoint, smoothedBearing);
        if (!smoothedCenter) {
          smoothedCenter = offsetCenter;
        } else {
          smoothedCenter = {
            lon: lerp(smoothedCenter.lon, offsetCenter.lon, cfg.centerSmoothing),
            lat: lerp(smoothedCenter.lat, offsetCenter.lat, cfg.centerSmoothing),
          };
        }

        if (segmentIndex > lastDrawnSegment) {
          for (let i = lastDrawnSegment + 1; i <= segmentIndex; i += 1) {
            trailCoords.push([routePoints[i].lon, routePoints[i].lat]);
          }
          lastDrawnSegment = segmentIndex;
        }

        const shouldUpdateTrail =
          progress >= 1 || now - lastTrailUpdateAt >= TRAIL_UPDATE_INTERVAL_MS;
        if (shouldUpdateTrail && map.getSource("route")) {
          const animatedCoords = trailCoords.concat([[current.lon, current.lat]]);
          map.getSource("route").setData(createLineFeature(animatedCoords));
          lastTrailUpdateAt = now;
        }

        updateRouteHead(current, smoothedBearing);

        map.jumpTo({
          center: [smoothedCenter.lon, smoothedCenter.lat],
          bearing: smoothedBearing,
          pitch: cfg.pitch,
          zoom: cfg.zoom,
          duration: 0,
        });

        if (progress < 1) {
          animationFrameId = requestAnimationFrame(animate);
        } else {
          animationFrameId = null;
          if (map.getSource("route")) {
            const finalCoords = routePoints.map((p) => [p.lon, p.lat]);
            map.getSource("route").setData(createLineFeature(finalCoords));
          }
          const lastPoint = routePoints[routePoints.length - 1];
          updateRouteHead(lastPoint, smoothedBearing ?? map.getBearing());

          const outroDuration = Math.min(3200, Math.max(1800, durationMs * 0.18));
          setStatus("Route fertig, Kamera zoomt fuer Gesamtansicht raus ...");

          playRouteOutro(outroDuration).then(() => {
            updateAltitudeOverlayProgress(1);
            if (timedOut) {
              setStatus("Animation mit Failsafe beendet (Zeitlimit erreicht). Gesamtansicht gesetzt.");
            } else {
              setStatus("Animation abgeschlossen.");
            }
            resolve(true);
          });
        }
      } catch (error) {
        animationFrameId = null;
        setStatus(`Animation abgebrochen: ${error.message}`);
        resolve(false);
      }
    };

    setStatus("Animation laeuft ...");
    animationFrameId = requestAnimationFrame(animate);
  });
}

function selectRecordingMimeType() {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return candidates.find((mime) => MediaRecorder.isTypeSupported(mime)) || "video/webm";
}

function getCurrentFormatLabel() {
  const key = formatSelect?.value === "portrait" ? "portrait" : "landscape";
  return FORMAT_CONFIG[key].label;
}

function toTimestamp() {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

async function recordAnimationAndDownload() {
  if (isRecording) {
    return;
  }

  if (routePoints.length < 2) {
    setStatus("Bitte zuerst eine GPX-Datei laden.");
    return;
  }

  const canvas = map.getCanvas();
  if (!canvas.captureStream) {
    setStatus("Aufnahme im Browser nicht unterstuetzt (captureStream fehlt).");
    return;
  }

  const stream = canvas.captureStream(60);
  const mimeType = selectRecordingMimeType();
  const targetBitrate = Math.max(12000000, Math.floor(canvas.width * canvas.height * 6));
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: targetBitrate,
  });

  isRecording = true;
  playButton.disabled = true;
  recordButton.disabled = true;
  setStatus(
    `Aufnahme laeuft ... ${getCurrentFormatLabel()} (${Math.round(targetBitrate / 1000000)} Mbps, ${canvas.width}x${canvas.height})`
  );

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopPromise = new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });

  try {
    recorder.start();

    const finished = await startAnimation();
    recorder.stop();
    await stopPromise;

    if (!finished) {
      setStatus("Aufnahme beendet, aber Animation ist fehlgeschlagen.");
      return;
    }

    if (chunks.length === 0) {
      setStatus("Keine Videodaten aufgenommen. Bitte Browser-Konsole pruefen.");
      return;
    }

    const blob = new Blob(chunks, { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `gpx-flight-${toTimestamp()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    setStatus("Aufnahme fertig. Download gestartet (.webm). Fuer .mp4 bitte FFmpeg nutzen.");
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    isRecording = false;
    playButton.disabled = routePoints.length < 2;
    recordButton.disabled = routePoints.length < 2;
  }
}

async function uploadGpx(file) {
  const form = new FormData();
  form.append("file", file);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/gpx/parse`, {
      method: "POST",
      body: form,
    });
  } catch (error) {
    throw new Error(
      "Backend nicht erreichbar. Bitte pruefen, ob FastAPI auf http://127.0.0.1:8000 laeuft."
    );
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Upload fehlgeschlagen" }));
    throw new Error(err.detail || "Upload fehlgeschlagen");
  }

  return response.json();
}

gpxInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    setStatus("GPX wird verarbeitet ...");
    const data = await uploadGpx(file);
    await applyParsedGpxData(data);
  } catch (error) {
    playButton.disabled = true;
    recordButton.disabled = true;
    setStatus(`Fehler: ${error.message}`);
  }
});

formatSelect.addEventListener("change", () => {
  const selected = applySelectedFormat();
  setStatus(`Format umgestellt auf ${FORMAT_CONFIG[selected].label}.`);
});

applySelectedFormat();

window.gpxOverlay = {
  applyFormat: (formatKey) => {
    if (formatKey === "portrait" || formatKey === "landscape") {
      formatSelect.value = formatKey;
    }
    return applySelectedFormat();
  },
  loadParsedData: async (parsedData) => {
    await applyParsedGpxData(parsedData);
    return true;
  },
  prewarmTiles: async () => {
    await prewarmRouteTiles();
    return true;
  },
  play: async () => {
    return startAnimation();
  },
};

playButton.addEventListener("click", () => {
  startAnimation();
});

recordButton.addEventListener("click", () => {
  recordAnimationAndDownload();
});
