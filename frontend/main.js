const API_BASE_URL = "http://127.0.0.1:8000";

const MAPTILER_KEY = window.APP_CONFIG?.MAPTILER_KEY || "";
if (!MAPTILER_KEY) {
  throw new Error("Missing MAPTILER_KEY. Create frontend/config.local.js based on frontend/config.local.example.js.");
}

const statusText = document.getElementById("statusText");
const gpxInput = document.getElementById("gpxInput");
const playButton = document.getElementById("playButton");
const recordButton = document.getElementById("recordButton");
const photoInput = document.getElementById("photoInput");
const durationInput = document.getElementById("durationInput");
const formatSelect = document.getElementById("formatSelect");
const mapFrame = document.getElementById("mapFrame");
const altitudeOverlay = document.getElementById("altitudeOverlay");
const altitudeAreaBg = document.getElementById("altitudeAreaBg");
const altitudeAreaDone = document.getElementById("altitudeAreaDone");
const altitudeLineBg = document.getElementById("altitudeLineBg");
const altitudeLineDone = document.getElementById("altitudeLineDone");
const altitudeClipRect = document.getElementById("altitudeClipRect");
const insightPanel = document.getElementById("insightPanel");
const maxSpeedValue = document.getElementById("maxSpeedValue");
const maxElevationValue = document.getElementById("maxElevationValue");
const maxSpeedRow = document.getElementById("maxSpeedRow");
const maxElevationRow = document.getElementById("maxElevationRow");
const photoRow = document.getElementById("photoRow");
const photoSpotCount = document.getElementById("photoSpotCount");
const insightEvent = document.getElementById("insightEvent");

let routePoints = [];
let cameraPoints = [];
let animationFrameId = null;
let isRecording = false;
let altitudeOverlayState = null;
let routeInsights = null;
let highlightMarkers = [];
let photoSpots = [];
let photoMarkers = [];
let pendingPhotoFile = null;
let routeIconLayerReady = false;

const MAX_ANIMATION_POINTS = 2500;
const MAX_DENSE_POINTS = 9000;
const MAX_ALTITUDE_POINTS = 700;
const TRAIL_UPDATE_INTERVAL_MS = 16;
const HIGHLIGHT_SLOWDOWN_RADIUS = 55;
const HIGHLIGHT_SLOWDOWN_STRENGTH = 0.56;
const PHOTO_SLOWDOWN_RADIUS = 42;
const PHOTO_SLOWDOWN_STRENGTH = 0.46;
const PROXIMITY_VISIBLE_RADIUS = 9;

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

  ensureMarkerImages();
  ensureMarkerLayers();
  syncMarkerLayers();
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

function createFeatureCollection(features = []) {
  return {
    type: "FeatureCollection",
    features,
  };
}

function createSvgDataUrl(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function makeMarkerSvg(kind) {
  if (kind === "photo") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="84" viewBox="0 0 64 84">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="100%" stop-color="#f8fafc"/>
          </linearGradient>
        </defs>
        <circle cx="32" cy="30" r="20" fill="#facc15"/>
        <circle cx="32" cy="30" r="14" fill="url(#g)"/>
        <path d="M32 58 L23 41 H41 Z" fill="#facc15"/>
        <rect x="22" y="22" width="20" height="14" rx="2.5" fill="#6b7280"/>
        <circle cx="32" cy="29" r="5" fill="#d1d5db"/>
      </svg>
    `;
  }

  if (kind === "speed") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="84" viewBox="0 0 64 84">
        <circle cx="32" cy="30" r="20" fill="#facc15"/>
        <circle cx="32" cy="30" r="14" fill="#ffffff"/>
        <path d="M32 58 L23 41 H41 Z" fill="#facc15"/>
        <path d="M27 34 L31 27 L29 27 L33 21 L32 29 L35 29 Z" fill="#1f2937"/>
      </svg>
    `;
  }

  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="84" viewBox="0 0 64 84">
      <circle cx="32" cy="30" r="20" fill="#facc15"/>
      <circle cx="32" cy="30" r="14" fill="#ffffff"/>
      <path d="M32 58 L23 41 H41 Z" fill="#facc15"/>
      <path d="M25 33 L32 22 L39 33 Z" fill="#1f2937"/>
    </svg>
  `;
}

function ensureMarkerImages() {
  const specs = [
    ["highlight-speed", makeMarkerSvg("speed")],
    ["highlight-elevation", makeMarkerSvg("elevation")],
    ["photo-spot", makeMarkerSvg("photo")],
  ];

  for (const [name, svg] of specs) {
    if (!map.hasImage(name)) {
      const image = new Image();
      image.decoding = "async";
      image.src = createSvgDataUrl(svg);
      map.addImage(name, image);
    }
  }
}

function ensureMarkerLayers() {
  if (!map.getSource("highlightPoints")) {
    map.addSource("highlightPoints", {
      type: "geojson",
      data: createFeatureCollection([]),
    });
  }

  if (!map.getLayer("highlightPointsLayer")) {
    map.addLayer({
      id: "highlightPointsLayer",
      type: "symbol",
      source: "highlightPoints",
      layout: {
        "icon-image": ["match", ["get", "kind"], "speed", "highlight-speed", "highlight-elevation"],
        "icon-size": 0.78,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "bottom",
        "icon-pitch-alignment": "viewport",
        "icon-rotation-alignment": "viewport",
      },
      paint: {
        "icon-opacity": ["case", ["==", ["get", "unlocked"], true], 1, 0.42],
      },
    });
  }

  if (!map.getSource("photoPoints")) {
    map.addSource("photoPoints", {
      type: "geojson",
      data: createFeatureCollection([]),
    });
  }

  if (!map.getLayer("photoPointsLayer")) {
    map.addLayer({
      id: "photoPointsLayer",
      type: "symbol",
      source: "photoPoints",
      layout: {
        "icon-image": "photo-spot",
        "icon-size": 0.72,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "bottom",
        "icon-pitch-alignment": "viewport",
        "icon-rotation-alignment": "viewport",
      },
      paint: {
        "icon-opacity": ["case", ["==", ["get", "unlocked"], true], 1, 0.42],
      },
    });
  }

  routeIconLayerReady = true;
}

function syncMarkerLayers() {
  if (!routeIconLayerReady) {
    return;
  }

  const highlightFeatures = [];
  if (routeInsights?.fastest) {
    highlightFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [routeInsights.fastest.lon, routeInsights.fastest.lat] },
      properties: { kind: "speed", unlocked: Boolean(routeInsights.unlockedFastest) },
    });
  }
  if (routeInsights?.highest) {
    highlightFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [routeInsights.highest.lon, routeInsights.highest.lat] },
      properties: { kind: "elevation", unlocked: Boolean(routeInsights.unlockedHighest) },
    });
  }

  const photoFeatures = photoSpots.map((spot) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [spot.lon, spot.lat] },
    properties: { id: spot.id, unlocked: Boolean(spot.unlocked), name: spot.name },
  }));

  const highlightSource = map.getSource("highlightPoints");
  const photoSource = map.getSource("photoPoints");
  if (highlightSource) {
    highlightSource.setData(createFeatureCollection(highlightFeatures));
  }
  if (photoSource) {
    photoSource.setData(createFeatureCollection(photoFeatures));
  }
}

function parseTimeMs(value) {
  if (!value) {
    return null;
  }
  const timeMs = new Date(value).getTime();
  return Number.isFinite(timeMs) ? timeMs : null;
}

function parseExifDateFromJpeg(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) {
    return null;
  }

  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffda || marker === 0xffd9) {
      break;
    }

    const segmentLength = view.getUint16(offset, false);
    if (!Number.isFinite(segmentLength) || segmentLength < 2) {
      return null;
    }

    if (marker === 0xffe1 && segmentLength >= 10) {
      const exifStart = offset + 2;
      const exifHeader = [
        view.getUint8(exifStart),
        view.getUint8(exifStart + 1),
        view.getUint8(exifStart + 2),
        view.getUint8(exifStart + 3),
      ];

      if (String.fromCharCode(...exifHeader) === "Exif") {
        const tiffOffset = exifStart + 6;
        const isLittleEndian = view.getUint16(tiffOffset, false) === 0x4949;
        const read16 = (pos) => view.getUint16(pos, isLittleEndian);
        const read32 = (pos) => view.getUint32(pos, isLittleEndian);
        const firstIfdRel = read32(tiffOffset + 4);
        const firstIfd = tiffOffset + firstIfdRel;

        if (firstIfd + 2 >= view.byteLength) {
          return null;
        }

        const entryCount = read16(firstIfd);
        let exifIfdRel = null;
        for (let i = 0; i < entryCount; i += 1) {
          const entry = firstIfd + 2 + i * 12;
          if (entry + 12 > view.byteLength) {
            break;
          }
          const tag = read16(entry);
          if (tag === 0x8769) {
            exifIfdRel = read32(entry + 8);
            break;
          }
        }

        if (!Number.isFinite(exifIfdRel)) {
          return null;
        }

        const exifIfd = tiffOffset + exifIfdRel;
        if (exifIfd + 2 >= view.byteLength) {
          return null;
        }

        const exifEntryCount = read16(exifIfd);
        for (let i = 0; i < exifEntryCount; i += 1) {
          const entry = exifIfd + 2 + i * 12;
          if (entry + 12 > view.byteLength) {
            break;
          }
          const tag = read16(entry);
          if (tag !== 0x9003 && tag !== 0x0132) {
            continue;
          }

          const count = read32(entry + 4);
          const valueOffsetRel = read32(entry + 8);
          const textOffset = tiffOffset + valueOffsetRel;
          if (textOffset + count > view.byteLength || count < 8) {
            continue;
          }

          let text = "";
          for (let c = 0; c < count; c += 1) {
            const code = view.getUint8(textOffset + c);
            if (code === 0) {
              break;
            }
            text += String.fromCharCode(code);
          }

          const match = text.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/);
          if (!match) {
            continue;
          }

          const [, y, m, d, hh, mm, ss] = match;
          const utcMs = Date.UTC(
            Number(y),
            Number(m) - 1,
            Number(d),
            Number(hh),
            Number(mm),
            Number(ss)
          );

          return Number.isFinite(utcMs) ? utcMs : null;
        }
      }
    }

    offset += segmentLength;
  }

  return null;
}

async function extractPhotoTimestampMs(file) {
  if (!file) {
    return null;
  }

  const isJpeg = /jpe?g/i.test(file.type || "") || /\.jpe?g$/i.test(file.name || "");
  if (isJpeg) {
    try {
      const buffer = await file.arrayBuffer();
      const exifMs = parseExifDateFromJpeg(buffer);
      if (Number.isFinite(exifMs)) {
        return exifMs;
      }
    } catch {
      // ignore and fall back
    }
  }

  return Number.isFinite(file.lastModified) ? file.lastModified : null;
}

function findRoutePointByTimestampMs(targetMs) {
  if (!Number.isFinite(targetMs) || routePoints.length < 2) {
    return null;
  }

  let bestPoint = null;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const point of routePoints) {
    const pointMs = parseTimeMs(point.time);
    if (!Number.isFinite(pointMs)) {
      continue;
    }
    const delta = Math.abs(pointMs - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestPoint = point;
    }
  }

  return bestPoint;
}

function hasRouteTimeData() {
  return routePoints.some((p) => Number.isFinite(parseTimeMs(p.time)));
}

function formatSpeedKmh(valueMps) {
  if (!Number.isFinite(valueMps) || valueMps <= 0) {
    return "-";
  }
  return `${(valueMps * 3.6).toFixed(1)} km/h`;
}

function formatElevationMeters(valueM) {
  if (!Number.isFinite(valueM)) {
    return "-";
  }
  return `${Math.round(valueM)} m`;
}

function hideInsightEvent() {
  if (!insightEvent) {
    return;
  }
  insightEvent.classList.add("hidden");
  insightEvent.textContent = "";
}

function showInsightEvent(text) {
  if (!insightEvent) {
    return;
  }
  insightEvent.textContent = text;
  insightEvent.classList.remove("hidden");
  insightPanel?.classList.remove("hidden");
}

function updateInsightsPanel() {
  if (!insightPanel || !maxSpeedValue || !maxElevationValue) {
    return;
  }

  if (!routeInsights) {
    insightPanel.classList.add("hidden");
    maxSpeedValue.textContent = "-";
    maxElevationValue.textContent = "-";
    hideInsightEvent();
    return;
  }

  maxSpeedValue.textContent = routeInsights.fastest ? "In Naehe sichtbar" : "Keine Zeitdaten";
  maxElevationValue.textContent = routeInsights.highest ? "Noch gesperrt" : "-";
  photoSpotCount.textContent = String(photoSpots.length);

  maxSpeedRow?.classList.add("hidden-row", "muted");
  maxSpeedRow?.classList.remove("unlocked");
  maxElevationRow?.classList.add("hidden-row", "muted");
  maxElevationRow?.classList.remove("unlocked");
  photoRow?.classList.add("hidden-row", "muted");
  photoRow?.classList.remove("unlocked");

  hideInsightEvent();
  insightPanel.classList.add("hidden");
}

function setSpeedRowByProximity(isNear) {
  if (!maxSpeedValue || !maxSpeedRow || !routeInsights?.fastest) {
    return;
  }

  if (isNear) {
    maxSpeedRow.classList.remove("hidden-row");
    maxSpeedValue.textContent = formatSpeedKmh(routeInsights.fastest.speedMps);
  } else {
    maxSpeedRow.classList.add("hidden-row");
    maxSpeedValue.textContent = "In Naehe sichtbar";
  }
}

function updateStatsVisibilityByProximity(segmentIndex) {
  if (!insightPanel || !routeInsights) {
    return;
  }

  const nearFast = isNearIndex(segmentIndex, routeInsights.fastestRouteIndex);
  const nearHighest = isNearIndex(segmentIndex, routeInsights.highestRouteIndex);
  const nearPhoto = photoSpots.some((spot) => isNearIndex(segmentIndex, spot.routeIndex));

  if (nearFast && routeInsights.fastest) {
    maxSpeedRow?.classList.remove("hidden-row");
    setSpeedRowByProximity(true);
  } else {
    maxSpeedRow?.classList.add("hidden-row");
    setSpeedRowByProximity(false);
  }

  if (nearHighest && routeInsights.highest) {
    maxElevationRow?.classList.remove("hidden-row");
    if (!routeInsights.unlockedHighest) {
      maxElevationValue.textContent = formatElevationMeters(routeInsights.highest.ele);
    }
  } else {
    maxElevationRow?.classList.add("hidden-row");
  }

  if (nearPhoto && photoSpots.length > 0) {
    photoRow?.classList.remove("hidden-row");
  } else {
    photoRow?.classList.add("hidden-row");
  }

  const eventVisible = insightEvent && !insightEvent.classList.contains("hidden");
  const anyRowVisible =
    (maxSpeedRow && !maxSpeedRow.classList.contains("hidden-row")) ||
    (maxElevationRow && !maxElevationRow.classList.contains("hidden-row")) ||
    (photoRow && !photoRow.classList.contains("hidden-row"));

  insightPanel.classList.toggle("hidden", !anyRowVisible && !eventVisible);
}

function triggerUnlockPulse(element) {
  if (!element) {
    return;
  }
  element.classList.remove("pulse-on-unlock");
  // Force reflow so repeated unlock pulses can retrigger reliably.
  void element.offsetWidth;
  element.classList.add("pulse-on-unlock");
}

function unlockInsight(kind) {
  if (!routeInsights) {
    return;
  }

  if (kind === "fastest") {
    routeInsights.unlockedFastest = true;
    maxSpeedRow?.classList.remove("muted");
    maxSpeedRow?.classList.add("unlocked");
    syncMarkerLayers();
    return;
  }

  if (kind === "highest") {
    routeInsights.unlockedHighest = true;
    if (routeInsights.highest) {
      maxElevationValue.textContent = formatElevationMeters(routeInsights.highest.ele);
    }
    maxElevationRow?.classList.remove("muted");
    maxElevationRow?.classList.add("unlocked");
    syncMarkerLayers();
  }
}

function setHighlightMarkerUnlocked(kind, unlocked) {
  const wasUnlocked = kind === "fastest" ? routeInsights?.unlockedFastest : routeInsights?.unlockedHighest;
  if (kind === "fastest") {
    routeInsights.unlockedFastest = Boolean(unlocked);
  } else if (kind === "highest") {
    routeInsights.unlockedHighest = Boolean(unlocked);
  }

  syncMarkerLayers();
  if (unlocked && !wasUnlocked) {
    triggerUnlockPulse(kind === "fastest" ? maxSpeedRow : maxElevationRow);
  }
}

function setPhotoMarkerUnlocked(spotId, unlocked) {
  const spot = photoSpots.find((item) => item.id === spotId);
  if (!spot) {
    return;
  }

  const wasUnlocked = Boolean(spot.unlocked);
  spot.unlocked = Boolean(unlocked);
  syncMarkerLayers();

  if (unlocked && !wasUnlocked) {
    triggerUnlockPulse(photoRow);
  }
}

function updatePhotoCount() {
  if (!photoSpotCount) {
    return;
  }
  photoSpotCount.textContent = String(photoSpots.length);
}

function findNearestPointIndex(points, targetPoint) {
  if (!targetPoint || points.length === 0) {
    return -1;
  }

  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const dist = distanceMeters(points[i], targetPoint);
    if (dist < bestDistance) {
      bestDistance = dist;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function computeRouteInsights(points) {
  if (!points || points.length < 2) {
    return null;
  }

  let highest = null;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!Number.isFinite(point.ele)) {
      continue;
    }
    if (!highest || point.ele > highest.ele) {
      highest = { ...point, index: i };
    }
  }

  let fastest = null;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const prevMs = parseTimeMs(prev.time);
    const currMs = parseTimeMs(current.time);
    if (prevMs === null || currMs === null) {
      continue;
    }

    const dtSec = (currMs - prevMs) / 1000;
    if (!Number.isFinite(dtSec) || dtSec <= 0) {
      continue;
    }

    const distM = distanceMeters(prev, current);
    const speedMps = distM / dtSec;
    if (!Number.isFinite(speedMps) || speedMps <= 0) {
      continue;
    }

    if (!fastest || speedMps > fastest.speedMps) {
      fastest = {
        ...current,
        index: i,
        speedMps,
      };
    }
  }

  return {
    highest,
    fastest,
    unlockedFastest: false,
    unlockedHighest: false,
  };
}

function clearInsightMarkers() {
  highlightMarkers = [];
}

function clearPhotoMarkers() {
  photoMarkers = [];
}

function clearPhotoSpots() {
  clearPhotoMarkers();
  photoSpots.forEach((spot) => {
    if (spot.url) {
      URL.revokeObjectURL(spot.url);
    }
  });
  photoSpots = [];
  updatePhotoCount();
}

function createInsightMarker(type, point, label) {
  if (!point || !routeIconLayerReady) {
    return;
  }

  highlightMarkers.push({ kind: type === "speed" ? "fastest" : "highest", point, label });
}

function createPhotoSpotMarker(spot) {
  if (!routeIconLayerReady) {
    return;
  }

  photoMarkers.push({ spotId: spot.id, point: spot });
}

function addPhotoSpotAt(lngLat, file) {
  const spot = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    lon: lngLat.lng,
    lat: lngLat.lat,
    name: file.name || `Spot ${photoSpots.length + 1}`,
    url: URL.createObjectURL(file),
    routeIndex: -1,
    unlocked: false,
  };

  if (routePoints.length >= 2) {
    spot.routeIndex = findNearestPointIndex(routePoints, spot);
  }

  photoSpots.push(spot);
  createPhotoSpotMarker(spot);
  updatePhotoCount();
  updateInsightsPanel();
  syncMarkerLayers();
}

function renderInsightMarkers() {
  clearInsightMarkers();
  syncMarkerLayers();
}

function computeHighlightSlowdown(segmentIndex) {
  if (!routeInsights) {
    return computePhotoSlowdown(segmentIndex);
  }

  const indices = [];
  if (Number.isInteger(routeInsights.fastestRouteIndex) && routeInsights.fastestRouteIndex >= 0) {
    indices.push(routeInsights.fastestRouteIndex);
  }
  if (Number.isInteger(routeInsights.highestRouteIndex) && routeInsights.highestRouteIndex >= 0) {
    indices.push(routeInsights.highestRouteIndex);
  }

  if (indices.length === 0) {
    return 1;
  }

  let factor = 1;
  for (const idx of indices) {
    const distanceIdx = Math.abs(segmentIndex - idx);
    if (distanceIdx > HIGHLIGHT_SLOWDOWN_RADIUS) {
      continue;
    }

    const proximity = 1 - distanceIdx / HIGHLIGHT_SLOWDOWN_RADIUS;
    const localFactor = 1 - proximity * HIGHLIGHT_SLOWDOWN_STRENGTH;
    factor = Math.min(factor, localFactor);
  }

  return Math.max(0.38, factor) * computePhotoSlowdown(segmentIndex);
}

function computePhotoSlowdown(segmentIndex) {
  if (!photoSpots.length) {
    return 1;
  }

  let factor = 1;
  for (const spot of photoSpots) {
    if (!Number.isInteger(spot.routeIndex) || spot.routeIndex < 0) {
      continue;
    }
    const distanceIdx = Math.abs(segmentIndex - spot.routeIndex);
    if (distanceIdx > PHOTO_SLOWDOWN_RADIUS) {
      continue;
    }

    const proximity = 1 - distanceIdx / PHOTO_SLOWDOWN_RADIUS;
    const localFactor = 1 - proximity * PHOTO_SLOWDOWN_STRENGTH;
    factor = Math.min(factor, localFactor);
  }

  return Math.max(0.42, factor);
}

function isNearIndex(segmentIndex, targetIndex, radius = PROXIMITY_VISIBLE_RADIUS) {
  return Number.isInteger(targetIndex) && targetIndex >= 0 && Math.abs(segmentIndex - targetIndex) <= radius;
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
  clearInsightMarkers();

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
      "line-color": "#FBBF24",
      "line-width": 5.2,
      "line-opacity": 0.95,
    },
  });

  map.addLayer({
    id: "routeHeadGlow",
    type: "circle",
    source: "routeHead",
    paint: {
      "circle-radius": 20,
      "circle-color": "#FBBF24",
      "circle-opacity": 0.35,
      "circle-blur": 1.2,
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
  clearPhotoSpots();

  const sampledPoints = sanitizeAndSamplePoints(data.points);
  routePoints = densifyRoutePoints(sampledPoints, 10);
  cameraPoints = smoothRoutePoints(routePoints, 8);
  routeInsights = computeRouteInsights(sampledPoints);
  if (routeInsights?.fastest) {
    routeInsights.fastestRouteIndex = findNearestPointIndex(routePoints, routeInsights.fastest);
  } else {
    routeInsights.fastestRouteIndex = -1;
  }
  if (routeInsights?.highest) {
    routeInsights.highestRouteIndex = findNearestPointIndex(routePoints, routeInsights.highest);
  } else {
    routeInsights.highestRouteIndex = -1;
  }

  updateInsightsPanel();
  renderAltitudeOverlay(sampledPoints);

  if (!map.isStyleLoaded()) {
    await new Promise((resolve) => map.once("load", resolve));
  }

  drawRouteLine();
  renderInsightMarkers();
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
  hideInsightEvent();
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
    const hardStopTime = startTime + Math.max(durationMs + 3000, durationMs * 1.9);
    let smoothedBearing = null;
    let smoothedCenter = null;
    let lastFrameAt = startTime;
    let virtualElapsed = 0;
    let lastDrawnSegment = 0;
    let lastTrailUpdateAt = 0;
    const trailCoords = [[routePoints[0].lon, routePoints[0].lat]];
    const reachedHighlight = {
      fastest: false,
      highest: false,
    };
    const reachedPhotoSpotIds = new Set();

    resetAnimatedRouteLine();
    updateRouteHead(routePoints[0], 0);
    updateAltitudeOverlayProgress(0);

    const animate = (now) => {
      try {
        const dtMs = Math.max(1, now - lastFrameAt);
        lastFrameAt = now;
        const timedOut = now >= hardStopTime;

        const progressBefore = Math.min(1, Math.max(0, virtualElapsed / durationMs));
        const scaledBefore = progressBefore * segmentCount;
        const segmentBefore = Math.min(segmentCount - 1, Math.floor(scaledBefore));
        const speedFactor = computeHighlightSlowdown(segmentBefore);
        virtualElapsed += dtMs * speedFactor;

        const progress = timedOut ? 1 : Math.min(1, Math.max(0, virtualElapsed / durationMs));
        updateAltitudeOverlayProgress(progress);

        const scaled = progress * segmentCount;
        const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
        const localT = scaled - segmentIndex;

        updateStatsVisibilityByProximity(segmentIndex);
        setSpeedRowByProximity(isNearIndex(segmentIndex, routeInsights?.fastestRouteIndex));

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

        if (!reachedHighlight.fastest && routeInsights?.fastest && routeInsights.fastestRouteIndex >= 0) {
          if (Math.abs(segmentIndex - routeInsights.fastestRouteIndex) <= 5) {
            reachedHighlight.fastest = true;
            unlockInsight("fastest");
            setHighlightMarkerUnlocked("fastest", true);
            showInsightEvent(`⚡ Schnellster Abschnitt: ${formatSpeedKmh(routeInsights.fastest.speedMps)}`);
          }
        }

        if (!reachedHighlight.highest && routeInsights?.highest && routeInsights.highestRouteIndex >= 0) {
          if (Math.abs(segmentIndex - routeInsights.highestRouteIndex) <= 5) {
            reachedHighlight.highest = true;
            unlockInsight("highest");
            setHighlightMarkerUnlocked("highest", true);
            showInsightEvent(`⛰ Hoechster Punkt: ${formatElevationMeters(routeInsights.highest.ele)}`);
          }
        }

        for (const spot of photoSpots) {
          if (reachedPhotoSpotIds.has(spot.id) || !Number.isInteger(spot.routeIndex) || spot.routeIndex < 0) {
            continue;
          }
          if (Math.abs(segmentIndex - spot.routeIndex) <= 5) {
            reachedPhotoSpotIds.add(spot.id);
            spot.unlocked = true;
            setPhotoMarkerUnlocked(spot.id, true);
            showInsightEvent(`📷 Foto-Spot: ${spot.name}`);
          }
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
            hideInsightEvent();
            insightPanel?.classList.add("hidden");
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

photoInput.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  const photoTimestampMs = await extractPhotoTimestampMs(file);
  const autoPoint = hasRouteTimeData() && Number.isFinite(photoTimestampMs)
    ? findRoutePointByTimestampMs(photoTimestampMs)
    : null;

  if (autoPoint) {
    addPhotoSpotAt({ lng: autoPoint.lon, lat: autoPoint.lat }, file);
    const dateText = new Date(photoTimestampMs).toLocaleString("de-AT");
    setStatus(`Foto-Spot automatisch per Zeitstempel gesetzt (${dateText}).`);
    pendingPhotoFile = null;
    photoInput.value = "";
    map.getCanvas().style.cursor = "";
    return;
  }

  pendingPhotoFile = file;
  map.getCanvas().style.cursor = "crosshair";
  setStatus(`Bild bereit: ${file.name}. Kein passender Zeitstempel gefunden, bitte Spot auf der Karte setzen.`);
});

map.on("click", (event) => {
  if (!pendingPhotoFile) {
    return;
  }

  addPhotoSpotAt(event.lngLat, pendingPhotoFile);
  setStatus(`Foto-Spot hinzugefuegt: ${pendingPhotoFile.name}`);
  pendingPhotoFile = null;
  photoInput.value = "";
  map.getCanvas().style.cursor = "";
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
