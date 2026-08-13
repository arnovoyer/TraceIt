const API_BASE_URL = "http://127.0.0.1:8000";

const MAPTILER_KEY = window.APP_CONFIG?.MAPTILER_KEY || "";
if (!MAPTILER_KEY) {
  throw new Error("Missing MAPTILER_KEY. Create frontend/config.local.js based on frontend/config.local.example.js.");
}

const statusText = document.getElementById("statusText");
const gpxInput = document.getElementById("gpxInput");
const playButton = document.getElementById("playButton");
const recordButton = document.getElementById("recordButton");
const altitudeToggleButton = document.getElementById("altitudeToggleButton");
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
const altitudeMarkers = document.getElementById("altitudeMarkers");
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
let uploadedGpxFile = null;
let isRenderMode = false;
let altitudeOverlayState = null;
let routeInsights = null;
let highlightMarkers = [];
let photoSpots = [];
let photoMarkers = [];
let pendingPhotoFile = null;
let routeIconLayerReady = false;
let renderCameraState = {
  lastProgress: null,
  smoothedBearing: null,
  smoothedCenter: null,
};
let renderOutroState = null;
let previewCanvasSize = { width: null, height: null };
let renderZoomOffset = 0;
let isAltitudeOverlayVisible = true;

const MAX_ANIMATION_POINTS = 2500;
const MAX_DENSE_POINTS = 9000;
const MAX_ALTITUDE_POINTS = 700;
const TRAIL_UPDATE_INTERVAL_MS = 16;
const HIGHLIGHT_SLOWDOWN_RADIUS = 55;
const HIGHLIGHT_SLOWDOWN_STRENGTH = 0.56;
const PHOTO_SLOWDOWN_RADIUS = 42;
const PHOTO_SLOWDOWN_STRENGTH = 0.46;
const PROXIMITY_VISIBLE_RADIUS = 9;
const SHOW_HIGHEST_INSIGHT = false;

const ALTITUDE_SVG = {
  width: 320,
  height: 118,
  leftPad: 28,
  rightPad: 4,
  topPad: 8,
  bottomPad: 24,
  minKmLabelGap: 34,
  minEleLabelGap: 15,
};

const ALTITUDE_VISIBILITY_STORAGE_KEY = "traceit.altitudeOverlayVisible";
isAltitudeOverlayVisible = loadAltitudeOverlayPreference();

const CAMERA_CONFIG = {
  pitch: 60, // Less steep
  zoom: 15.3,
  sideOffsetM: 40,
  backOffsetM: 60,
  centerSmoothing: 0.015, // Even more ultra smooth drone-like
  bearingSmoothing: 0.015, // Even more ultra smooth drone-like
  lookAheadPoints: 120, // Look way further ahead
  focusAheadPoints: 60,
  bearingWindow: 30, // Larger window for bearing calculation
  maxBearingSpeedDegPerSec: 10, // Very slow, controlled turn speed
  outroPitch: 16,
  outroBearing: 0,
  outroPadding: 68,
};

const FORMAT_CAMERA_OVERRIDES = {
  landscape: {
    sideOffsetM: 38,
    backOffsetM: 58,
    zoom: 15.3,
    pitch: 60,
    lookAheadPoints: 120,
    focusAheadPoints: 60,
    bearingSmoothing: 0.015,
    centerSmoothing: 0.015,
    maxBearingSpeedDegPerSec: 10,
    headAnchorX: 0.5,
    headAnchorY: 0.62, // Higher
    outroPitch: 16,
    outroPadding: 68,
  },
  portrait: {
    sideOffsetM: 32,
    backOffsetM: 62,
    zoom: 15.1,
    pitch: 59,
    lookAheadPoints: 125,
    focusAheadPoints: 62,
    bearingWindow: 30,
    maxBearingSpeedDegPerSec: 9,
    bearingSmoothing: 0.015,
    centerSmoothing: 0.015,
    headAnchorX: 0.5,
    headAnchorY: 0.63, // Higher up, not too low
    viewportMarginX: 0.08,
    viewportMarginTop: 0.06,
    viewportMarginBottom: 0.05,
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

function loadAltitudeOverlayPreference() {
  try {
    return window.localStorage.getItem(ALTITUDE_VISIBILITY_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

function storeAltitudeOverlayPreference() {
  try {
    window.localStorage.setItem(
      ALTITUDE_VISIBILITY_STORAGE_KEY,
      isAltitudeOverlayVisible ? "1" : "0"
    );
  } catch {
    // Ignore storage errors and keep the current in-memory toggle.
  }
}

function syncAltitudeToggleButton() {
  if (!altitudeToggleButton) {
    return;
  }

  altitudeToggleButton.textContent = isAltitudeOverlayVisible
    ? "Hoehenprofil ausblenden"
    : "Hoehenprofil einblenden";
  altitudeToggleButton.setAttribute("aria-pressed", String(isAltitudeOverlayVisible));
}

function syncAltitudeOverlayVisibility() {
  if (!altitudeOverlay) {
    return;
  }

  const shouldShow = Boolean(altitudeOverlayState) && isAltitudeOverlayVisible;
  altitudeOverlay.classList.toggle("hidden", !shouldShow);
  syncAltitudeToggleButton();
}

function setAltitudeOverlayVisible(visible, { persist = true } = {}) {
  isAltitudeOverlayVisible = Boolean(visible);
  if (persist) {
    storeAltitudeOverlayPreference();
  }
  syncAltitudeOverlayVisibility();
  return isAltitudeOverlayVisible;
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
    capturePreviewCanvasSize();
  });

  return selected;
}

function getSelectedFormatKey() {
  return formatSelect?.value === "portrait" ? "portrait" : "landscape";
}

function getActiveCameraConfig() {
  const formatKey = getSelectedFormatKey();
  const config = { ...CAMERA_CONFIG, ...(FORMAT_CAMERA_OVERRIDES[formatKey] || {}) };
  if (isRenderMode) {
    const extraPortraitBoost = formatKey === "portrait" ? 0.42 : 0;
    config.zoom += renderZoomOffset + extraPortraitBoost;

    if (formatKey === "portrait" && isAltitudeOverlayVisible) {
      config.viewportMarginTop = Math.max(config.viewportMarginTop ?? 0, 0.33);
      config.viewportMarginX = Math.max(config.viewportMarginX ?? 0, 0.11);
      config.headAnchorY = Math.max(config.headAnchorY ?? 0, 0.715);
      config.backOffsetM = Math.max(config.backOffsetM ?? 0, 82);
    }
  }
  return config;
}

function getRouteLineWidthExpression(stops, scale = 1) {
  return [
    "interpolate",
    ["linear"],
    ["zoom"],
    stops[0], stops[1] * scale,
    stops[2], stops[3] * scale,
    stops[4], stops[5] * scale,
    stops[6], stops[7] * scale,
  ];
}

function syncRouteLineAppearance() {
  const mainScale = isRenderMode ? 1.18 : 1;
  const glowScale = isRenderMode ? 1.12 : 1;
  const edgeScale = isRenderMode ? 1.15 : 1;

  if (map.getLayer("route-line-glow")) {
    map.setPaintProperty(
      "route-line-glow",
      "line-width",
      getRouteLineWidthExpression([12, 6, 14, 10, 16, 16, 18, 22], glowScale)
    );
  }

  if (map.getLayer("route-line")) {
    map.setPaintProperty(
      "route-line",
      "line-width",
      getRouteLineWidthExpression([12, 2.5, 14, 4, 16, 6, 18, 8.5], mainScale)
    );
  }

  if (map.getLayer("route-line-edge")) {
    map.setPaintProperty(
      "route-line-edge",
      "line-width",
      getRouteLineWidthExpression([12, 0.8, 14, 1.2, 16, 1.8, 18, 2.5], edgeScale)
    );
  }
}

function resetRenderCameraState() {
  renderCameraState = {
    lastProgress: null,
    smoothedBearing: null,
    smoothedCenter: null,
  };
  renderOutroState = null;
}

function capturePreviewCanvasSize() {
  if (isRenderMode) {
    return;
  }
  const canvas = map.getCanvas?.();
  if (!canvas) {
    return;
  }
  previewCanvasSize = { width: canvas.width, height: canvas.height };
}

function computeRenderZoomOffset() {
  renderZoomOffset = 0;
  const canvas = map.getCanvas?.();
  if (!canvas || !previewCanvasSize?.width) {
    return;
  }

  const ratio = canvas.width / previewCanvasSize.width;
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return;
  }

  const offset = Math.log(ratio) / Math.log(2);
  if (!Number.isFinite(offset)) {
    return;
  }

  renderZoomOffset = Math.max(0, Math.min(1.8, offset));
}

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");

map.on("load", async () => {
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

  await ensureMarkerImages();
  ensureMarkerLayers();
  syncRouteLineAppearance();
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

function easeInOutCubic(t) {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped < 0.5
    ? 4 * clamped * clamped * clamped
    : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
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

  if (kind === "start") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="80" height="100" viewBox="0 0 80 100">
        <defs>
          <linearGradient id="startGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#FFD600"/>
            <stop offset="100%" stop-color="#FFB300"/>
          </linearGradient>
          <radialGradient id="startGlow" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stop-color="#FFEB3B" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#FFD600" stop-opacity="0"/>
          </radialGradient>
          <filter id="startShadow" x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#FFC107" flood-opacity="0.5"/>
          </filter>
        </defs>
        <circle cx="40" cy="38" r="28" fill="url(#startGlow)"/>
        <circle cx="40" cy="38" r="20" fill="url(#startGrad)" stroke="#FFFFFF" stroke-width="3" filter="url(#startShadow)"/>
        <circle cx="40" cy="38" r="12" fill="#FFFFFF"/>
        <text x="40" y="44" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#FF8F00">S</text>
        <path d="M40 68 L27 46 H53 Z" fill="url(#startGrad)" stroke="#FFFFFF" stroke-width="2"/>
      </svg>
    `;
  }

  if (kind === "target") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="80" height="100" viewBox="0 0 80 100">
        <defs>
          <linearGradient id="targetGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#FF5252"/>
            <stop offset="100%" stop-color="#D32F2F"/>
          </linearGradient>
          <radialGradient id="targetGlow" cx="50%" cy="40%" r="50%">
            <stop offset="0%" stop-color="#FF8A80" stop-opacity="0.8"/>
            <stop offset="100%" stop-color="#FF5252" stop-opacity="0"/>
          </radialGradient>
          <filter id="targetShadow" x="-100%" y="-100%" width="300%" height="300%">
            <feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#F44336" flood-opacity="0.5"/>
          </filter>
        </defs>
        <circle cx="40" cy="38" r="28" fill="url(#targetGlow)"/>
        <circle cx="40" cy="38" r="20" fill="url(#targetGrad)" stroke="#FFFFFF" stroke-width="3" filter="url(#targetShadow)"/>
        <circle cx="40" cy="38" r="12" fill="#FFFFFF"/>
        <text x="40" y="44" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#C62828">Z</text>
        <path d="M40 68 L27 46 H53 Z" fill="url(#targetGrad)" stroke="#FFFFFF" stroke-width="2"/>
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

async function ensureMarkerImages() {
  const specs = [
    ["highlight-speed", makeMarkerSvg("speed")],
    ["highlight-elevation", makeMarkerSvg("elevation")],
    ["photo-spot", makeMarkerSvg("photo")],
    ["marker-start", makeMarkerSvg("start")],
    ["marker-target", makeMarkerSvg("target")],
  ];

  for (const [name, svg] of specs) {
    if (!map.hasImage(name)) {
      const image = new Image();
      image.decoding = "async";
      const loaded = new Promise((resolve, reject) => {
        image.onload = () => resolve(image);
        image.onerror = reject;
      });
      image.src = createSvgDataUrl(svg);
      await loaded;
      map.addImage(name, image);
    }
  }
}

function ensureMarkerLayers() {
  if (!map.getSource("route")) {
    map.addSource("route", {
      type: "geojson",
      lineMetrics: true,
      data: createLineFeature([]),
    });
  }

  if (!map.getLayer("route-line-glow")) {
    map.addLayer({
      id: "route-line-glow",
      type: "line",
      source: "route",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#FBC02D",
        "line-opacity": 0.2,
        "line-blur": 8,
        "line-width": getRouteLineWidthExpression([12, 6, 14, 10, 16, 16, 18, 22]),
      },
    });
  }

  if (!map.getLayer("route-line")) {
    map.addLayer({
      id: "route-line",
      type: "line",
      source: "route",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#FFD600",
        "line-opacity": 0.95,
        "line-width": getRouteLineWidthExpression([12, 2.5, 14, 4, 16, 6, 18, 8.5]),
      },
    });
  }

  if (!map.getLayer("route-line-edge")) {
    map.addLayer({
      id: "route-line-edge",
      type: "line",
      source: "route",
      layout: {
        "line-join": "round",
        "line-cap": "round",
      },
      paint: {
        "line-color": "#FFFFFF",
        "line-opacity": 0.8,
        "line-width": getRouteLineWidthExpression([12, 0.8, 14, 1.2, 16, 1.8, 18, 2.5]),
      },
    });
  }

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

  if (!map.getSource("routeEndpoints")) {
    map.addSource("routeEndpoints", {
      type: "geojson",
      data: createFeatureCollection([]),
    });
  }

  if (!map.getLayer("routeEndpointsLayer")) {
    map.addLayer({
      id: "routeEndpointsLayer",
      type: "symbol",
      source: "routeEndpoints",
      layout: {
        "icon-image": ["match", ["get", "kind"], "start", "marker-start", "marker-target"],
        "icon-size": 0.7,
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "bottom",
        "icon-pitch-alignment": "viewport",
        "icon-rotation-alignment": "viewport",
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
  if (SHOW_HIGHEST_INSIGHT && routeInsights?.highest) {
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

  const endpointFeatures = [];
  if (routePoints.length >= 1) {
    const start = routePoints[0];
    endpointFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [start.lon, start.lat] },
      properties: { kind: "start" },
    });
  }
  if (routePoints.length >= 2) {
    const finish = routePoints[routePoints.length - 1];
    endpointFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [finish.lon, finish.lat] },
      properties: { kind: "target" },
    });
  }

  const highlightSource = map.getSource("highlightPoints");
  const photoSource = map.getSource("photoPoints");
  const endpointSource = map.getSource("routeEndpoints");
  if (highlightSource) {
    highlightSource.setData(createFeatureCollection(highlightFeatures));
  }
  if (photoSource) {
    photoSource.setData(createFeatureCollection(photoFeatures));
  }
  if (endpointSource) {
    endpointSource.setData(createFeatureCollection(endpointFeatures));
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
  if (SHOW_HIGHEST_INSIGHT) {
    maxElevationValue.textContent = routeInsights.highest ? "Noch gesperrt" : "-";
  }

  maxSpeedRow?.classList.add("hidden-row", "muted");
  maxSpeedRow?.classList.remove("unlocked");
  if (SHOW_HIGHEST_INSIGHT) {
    maxElevationRow?.classList.add("hidden-row", "muted");
    maxElevationRow?.classList.remove("unlocked");
  } else {
    maxElevationRow?.classList.add("hidden-row");
  }
  photoSpotCount.textContent = String(photoSpots.length);

  photoRow?.classList.add("hidden-row", "muted");
  photoRow?.classList.remove("unlocked");
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
  const nearHighest = SHOW_HIGHEST_INSIGHT && isNearIndex(segmentIndex, routeInsights.highestRouteIndex);
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

  if (kind === "highest" && !SHOW_HIGHEST_INSIGHT) {
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
  if (Number.isInteger(routeInsights.highestRouteIndex) && routeInsights.highestRouteIndex >= 0 && SHOW_HIGHEST_INSIGHT) {
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

function pickKmInterval(totalDistanceM) {
  const totalKm = totalDistanceM / 1000;
  if (totalKm <= 1.2) {
    return 0.25;
  }
  if (totalKm <= 2.5) {
    return 0.5;
  }
  if (totalKm <= 6) {
    return 1;
  }
  if (totalKm <= 15) {
    return 2;
  }
  return 5;
}

function pickElevationInterval(rangeM) {
  if (rangeM <= 20) {
    return 5;
  }
  if (rangeM <= 50) {
    return 10;
  }
  if (rangeM <= 120) {
    return 20;
  }
  if (rangeM <= 300) {
    return 50;
  }
  return 100;
}

function filterNonOverlappingLabels(labels, minGap, axis = "x") {
  if (!labels.length) {
    return [];
  }

  const sorted = [...labels].sort((a, b) => a[axis] - b[axis]);
  const kept = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = kept[kept.length - 1];
    const current = sorted[i];
    if (Math.abs(current[axis] - prev[axis]) >= minGap) {
      kept.push(current);
    }
  }

  return kept;
}

function formatKmLabel(km) {
  if (Math.abs(km - Math.round(km)) < 0.05) {
    return `${Math.round(km)} km`;
  }
  return `${km.toFixed(1)} km`;
}

function getAltitudeOverlaySafeBottomPx(canvasEl) {
  const fallback = (canvasEl?.height || 0) * 0.33;
  const widget = document.getElementById("altitudeOverlay");
  if (!widget || widget.classList.contains("hidden")) {
    return fallback;
  }
  const wRect = widget.getBoundingClientRect();
  if (!canvasEl) return Math.max(fallback, wRect.bottom + 90);
  const cRect = canvasEl.getBoundingClientRect();
  const widgetBottomInCanvas = wRect.bottom - cRect.top;
  const safetyBuffer = 140;
  return Math.max(fallback, widgetBottomInCanvas + safetyBuffer);
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

  const { width, height, leftPad, rightPad, topPad, bottomPad } = ALTITUDE_SVG;
  const plotWidth = width - leftPad - rightPad;
  const plotHeight = height - topPad - bottomPad;
  const elevationRange = Math.max(1, maxEle - minEle);

  const coords = sampled.map((p, idx) => {
    const x = leftPad + (distances[idx] / totalDistance) * plotWidth;
    const eleNorm = (p.ele - minEle) / elevationRange;
    const y = topPad + (1 - eleNorm) * plotHeight;
    return { x, y };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");
  const areaPath = `${linePath} L ${leftPad + plotWidth} ${height - bottomPad + 4} L ${leftPad} ${height - bottomPad + 4} Z`;

  const kmInterval = pickKmInterval(totalDistance);
  const kmCandidates = [];
  for (let km = 0; km <= totalDistance / 1000 + 0.001; km += kmInterval) {
    const x = leftPad + (Math.min(km * 1000, totalDistance) / totalDistance) * plotWidth;
    kmCandidates.push({
      x,
      y: height - bottomPad + 14,
      text: formatKmLabel(km),
      kind: "km",
    });
  }
  const kmLabels = filterNonOverlappingLabels(kmCandidates, ALTITUDE_SVG.minKmLabelGap, "x");

  const eleInterval = pickElevationInterval(elevationRange);
  const eleStart = Math.ceil(minEle / eleInterval) * eleInterval;
  const eleCandidates = [];
  for (let ele = eleStart; ele <= maxEle + 0.001; ele += eleInterval) {
    const eleNorm = (ele - minEle) / elevationRange;
    const y = topPad + (1 - eleNorm) * plotHeight;
    eleCandidates.push({
      x: leftPad - 6,
      y: y + 3,
      text: `${Math.round(ele)} m`,
      kind: "ele",
    });
  }
  const eleLabels = filterNonOverlappingLabels(eleCandidates, ALTITUDE_SVG.minEleLabelGap, "y");

  return {
    linePath,
    areaPath,
    width,
    height,
    minEle,
    maxEle,
    totalDistance,
    kmLabels,
    eleLabels,
  };
}

function renderAltitudeMarkers(data) {
  if (!altitudeMarkers) {
    return;
  }

  altitudeMarkers.replaceChildren();

  if (!data) {
    return;
  }

  const allLabels = [...(data.kmLabels || []), ...(data.eleLabels || [])];
  for (const label of allLabels) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(label.x));
    text.setAttribute("y", String(label.y));
    text.setAttribute("class", label.kind === "km" ? "altitude-km-label" : "altitude-ele-label");
    text.textContent = label.text;
    if (label.kind === "km") {
      text.setAttribute("text-anchor", "middle");
    } else {
      text.setAttribute("text-anchor", "end");
    }
    altitudeMarkers.appendChild(text);

    if (label.kind === "km") {
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("x1", String(label.x));
      tick.setAttribute("x2", String(label.x));
      tick.setAttribute("y1", String(ALTITUDE_SVG.topPad + (ALTITUDE_SVG.height - ALTITUDE_SVG.topPad - ALTITUDE_SVG.bottomPad)));
      tick.setAttribute("y2", String(ALTITUDE_SVG.height - ALTITUDE_SVG.bottomPad + 2));
      tick.setAttribute("class", "altitude-km-tick");
      altitudeMarkers.appendChild(tick);
    } else {
      const tick = document.createElementNS("http://www.w3.org/2000/svg", "line");
      tick.setAttribute("x1", String(ALTITUDE_SVG.leftPad - 2));
      tick.setAttribute("x2", String(ALTITUDE_SVG.leftPad + 4));
      tick.setAttribute("y1", String(label.y - 3));
      tick.setAttribute("y2", String(label.y - 3));
      tick.setAttribute("class", "altitude-ele-tick");
      altitudeMarkers.appendChild(tick);
    }
  }
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
    syncAltitudeOverlayVisibility();
    return;
  }

  altitudeAreaBg.setAttribute("d", data.areaPath);
  altitudeAreaDone.setAttribute("d", data.areaPath);
  altitudeLineBg.setAttribute("d", data.linePath);
  altitudeLineDone.setAttribute("d", data.linePath);
  altitudeClipRect.setAttribute("height", String(data.height));
  renderAltitudeMarkers(data);
  updateAltitudeOverlayProgress(0);
  syncAltitudeOverlayVisibility();
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

function smoothRoutePoints(points, windowSize = 12) {
  if (points.length < 3) {
    return points;
  }

  let currentPoints = [...points];
  
  // Apply smoothing multiple times for ultra-smooth result
  for (let pass = 0; pass < 3; pass++) {
    const smoothed = [];
    for (let i = 0; i < currentPoints.length; i += 1) {
      const start = Math.max(0, i - windowSize);
      const end = Math.min(currentPoints.length - 1, i + windowSize);

      let sumLon = 0;
      let sumLat = 0;
      let sumEle = 0;
      let count = 0;

      for (let j = start; j <= end; j += 1) {
        sumLon += currentPoints[j].lon;
        sumLat += currentPoints[j].lat;
        sumEle += currentPoints[j].ele;
        count += 1;
      }

      smoothed.push({
        lon: sumLon / count,
        lat: sumLat / count,
        ele: sumEle / count,
      });
    }

    smoothed[0] = currentPoints[0];
    smoothed[smoothed.length - 1] = currentPoints[currentPoints.length - 1];
    currentPoints = smoothed;
  }

  return currentPoints;
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

function densifyRoutePoints(points, maxStepMeters = 3) {
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

  if (dense.length <= MAX_DENSE_POINTS * 2) {
    return dense;
  }

  const sampledDense = [];
  const stride = Math.ceil(dense.length / (MAX_DENSE_POINTS * 2));
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

function getOutroPadding() {
  const cfg = getActiveCameraConfig();
  const padding = cfg.outroPadding;

  if (!isRenderMode) {
    return padding;
  }

  if (typeof padding === "number") {
    return Math.max(42, Math.round(padding * 0.82));
  }

  return {
    top: Math.max(48, Math.round((padding.top ?? 80) * 0.72)),
    bottom: Math.max(48, Math.round((padding.bottom ?? 80) * 0.72)),
    left: Math.max(30, Math.round((padding.left ?? 60) * 0.74)),
    right: Math.max(30, Math.round((padding.right ?? 60) * 0.74)),
  };
}

function getOutroMaxZoom() {
  const formatKey = getSelectedFormatKey();

  if (isRenderMode) {
    return formatKey === "portrait" ? 13.6 : 13.35;
  }

  return formatKey === "portrait" ? 12.8 : 12.5;
}

function prepareRouteOutroState() {
  if (routePoints.length < 2) {
    renderOutroState = null;
    return null;
  }

  const cfg = getActiveCameraConfig();
  const bounds = buildRouteBounds(routePoints);
  const targetCamera = map.cameraForBounds(bounds, {
    padding: getOutroPadding(),
    bearing: cfg.outroBearing,
    pitch: cfg.outroPitch,
    maxZoom: getOutroMaxZoom(),
  });

  if (!targetCamera?.center) {
    renderOutroState = null;
    return null;
  }

  const center = map.getCenter();
  renderOutroState = {
    startCenter: { lon: center.lng, lat: center.lat },
    startZoom: map.getZoom(),
    startPitch: map.getPitch(),
    startBearing: map.getBearing(),
    targetCenter: { lon: targetCamera.center.lng, lat: targetCamera.center.lat },
    targetZoom: targetCamera.zoom,
    liftZoom: Math.max(0, targetCamera.zoom - (isRenderMode ? 0.38 : 0.26)),
    targetPitch: cfg.outroPitch,
    targetBearing: cfg.outroBearing,
  };

  return renderOutroState;
}

function setOutroProgress(progress) {
  const clamped = Math.min(1, Math.max(0, progress));
  const state = renderOutroState ?? prepareRouteOutroState();
  if (!state) {
    return false;
  }

  const riseT = easeInOutCubic(Math.min(1, clamped / 0.42));
  const centerT = easeInOutCubic(Math.max(0, (clamped - 0.12) / 0.88));
  const settleT = easeInOutCubic(Math.max(0, (clamped - 0.28) / 0.72));
  const rotateT = easeInOutCubic(Math.max(0, (clamped - 0.18) / 0.82));
  const flattenT = easeInOutCubic(Math.max(0, (clamped - 0.4) / 0.6));
  const zoomBlendT = easeInOutCubic(Math.max(0, (clamped - 0.18) / 0.82));
  const bearingDelta = shortestAngleDelta(state.startBearing, state.targetBearing);
  const liftedZoom = lerp(state.startZoom, state.liftZoom, riseT);
  const settledZoom = lerp(state.liftZoom, state.targetZoom, settleT);
  const currentZoom = lerp(liftedZoom, settledZoom, zoomBlendT);

  map.jumpTo({
    center: [
      lerp(state.startCenter.lon, state.targetCenter.lon, centerT),
      lerp(state.startCenter.lat, state.targetCenter.lat, centerT),
    ],
    zoom: currentZoom,
    pitch: lerp(state.startPitch, state.targetPitch, flattenT),
    bearing: state.startBearing + bearingDelta * rotateT,
    duration: 0,
  });

  updateAltitudeOverlayProgress(1);
  return true;
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
    renderOutroState = null;
    map.once("moveend", finish);
    map.fitBounds(bounds, {
      padding: getOutroPadding(),
      duration: durationMs,
      pitch: cfg.outroPitch,
      bearing: cfg.outroBearing,
      maxZoom: getOutroMaxZoom(),
    });

    setTimeout(finish, durationMs + 300);
  });
}

function getRenderedRouteProgress(progress) {
  if (routePoints.length < 2) {
    return 0;
  }

  const activePoints = cameraPoints.length >= 2 ? cameraPoints : routePoints;
  const segmentCount = Math.max(1, activePoints.length - 1);
  const clampedProgress = Math.min(1, Math.max(0, progress));
  const scaled = clampedProgress * segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = scaled - segmentIndex;

  const currentRouteIdx = segmentIndex;
  const nextRouteIdx = Math.min(segmentIndex + 1, routePoints.length - 1);
  let routeAlpha = localT;

  const currentRoutePt = routePoints[currentRouteIdx];
  const nextRoutePt = routePoints[nextRouteIdx];
  const elevationGain =
    Number.isFinite(currentRoutePt?.ele) && Number.isFinite(nextRoutePt?.ele)
      ? nextRoutePt.ele - currentRoutePt.ele
      : 0;

  if (elevationGain > 0) {
    const slopeFactor = Math.max(0.4, 1.0 - elevationGain * 0.3);
    routeAlpha = localT * slopeFactor;
  }

  return Math.min(1, Math.max(0, (segmentIndex + routeAlpha) / Math.max(1, segmentCount)));
}

function resetAnimatedRouteLine() {
  if (!map.getSource("route") || routePoints.length === 0) {
    return;
  }

  const first = routePoints[0];
  map.getSource("route").setData(createLineFeature([[first.lon, first.lat]]));
}

function getStableBearing(points, segmentIndex) {
  const cfg = getActiveCameraConfig();
  
  // Dynamically reduce window size near the end of the route to prevent off-track issues
  const distanceFromEnd = points.length - 1 - segmentIndex;
  const dynamicWindow = Math.min(cfg.bearingWindow, Math.max(5, distanceFromEnd / 2));
  
  const fromIndex = Math.max(0, segmentIndex - Math.floor(dynamicWindow));
  const toIndex = Math.min(points.length - 1, segmentIndex + Math.floor(dynamicWindow));

  const from = points[fromIndex];
  const to = points[toIndex];

  if (!from || !to || fromIndex === toIndex) {
    return 0;
  }

  const bearing = computeBearing(from, to);
  return Number.isFinite(bearing) ? bearing : 0;
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

function keepRouteHeadInViewport(rawCenter, headPoint, bearing, pitch, zoom) {
  const canvas = map.getCanvas();
  if (!canvas?.width || !headPoint) {
    return rawCenter;
  }

  const formatKey = getSelectedFormatKey();
  const cfg = getActiveCameraConfig();
  const isPortrait = formatKey === "portrait";

  let marginX = cfg.viewportMarginX ?? (isPortrait ? 0.1 : 0.08);
  let marginTop = cfg.viewportMarginTop ?? (isPortrait ? 0.1 : 0.08);
  let marginBottom = cfg.viewportMarginBottom ?? (isPortrait ? 0.08 : 0.06);
  let anchorX = cfg.headAnchorX ?? 0.5;
  let anchorY = cfg.headAnchorY ?? (isPortrait ? 0.75 : 0.65);

  const needsHardAltitudeSafeY = isRenderMode && isPortrait && isAltitudeOverlayVisible;
  if (needsHardAltitudeSafeY) {
    marginTop = Math.max(marginTop, 0.33);
    anchorY = Math.max(anchorY, 0.715);
    marginX = Math.max(marginX, 0.11);
  }

  let pullStrength = isPortrait ? 0.19 : 0.08;
  if (needsHardAltitudeSafeY) {
    pullStrength = 0.34;
  }

  map.jumpTo({
    center: [rawCenter.lon, rawCenter.lat],
    bearing,
    pitch,
    zoom,
    duration: 0,
  });

  const headPx = map.project([headPoint.lon, headPoint.lat]);
  const w = canvas.width;
  const h = canvas.height;

  let minY = h * marginTop;
  if (needsHardAltitudeSafeY) {
    minY = getAltitudeOverlaySafeBottomPx(canvas);
  }

  const minX = w * marginX;
  const maxX = w * (1 - marginX);
  const maxY = h * (1 - marginBottom);
  const targetX = w * anchorX;
  const targetY = h * anchorY;

  let dx = 0;
  let dy = 0;

  if (headPx.x < minX) {
    dx = headPx.x - minX;
  } else if (headPx.x > maxX) {
    dx = headPx.x - maxX;
  } else {
    dx = (headPx.x - targetX) * pullStrength;
  }

  if (headPx.y < minY) {
    dy = headPx.y - minY;
    if (needsHardAltitudeSafeY) {
      dy -= 10;
    }
  } else if (headPx.y > maxY) {
    dy = headPx.y - maxY;
  } else {
    dy = (headPx.y - targetY) * pullStrength;
  }

  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    return rawCenter;
  }

  const centerPx = map.project([rawCenter.lon, rawCenter.lat]);
  let adjusted = map.unproject([centerPx.x + dx, centerPx.y + dy]);
  let resultCenter = { lon: adjusted.lng, lat: adjusted.lat };

  if (needsHardAltitudeSafeY) {
    for (let guard = 0; guard < 5; guard += 1) {
      map.jumpTo({
        center: [resultCenter.lon, resultCenter.lat],
        bearing,
        pitch,
        zoom,
        duration: 0,
      });
      const verifyHeadPx = map.project([headPoint.lon, headPoint.lat]);
      if (verifyHeadPx.y >= minY - 4) {
        break;
      }
      const stepBoost = guard >= 2 ? 60 : 28;
      const safetyDeltaPx = minY - verifyHeadPx.y + stepBoost;
      const safetyCenterPx = map.project([resultCenter.lon, resultCenter.lat]);
      adjusted = map.unproject([safetyCenterPx.x, safetyCenterPx.y + safetyDeltaPx]);
      resultCenter = { lon: adjusted.lng, lat: adjusted.lat };
    }
  }

  return resultCenter;
}

function clearExistingRoute() {
  clearInsightMarkers();

  if (map.getLayer("route-line-floating-glow")) map.removeLayer("route-line-floating-glow");
  if (map.getLayer("route-line-shadow")) map.removeLayer("route-line-shadow");
  if (map.getLayer("route-line-bottom")) map.removeLayer("route-line-bottom");
  if (map.getLayer("route-line-middle")) map.removeLayer("route-line-middle");
  if (map.getLayer("route-line-top")) map.removeLayer("route-line-top");
  if (map.getLayer("route-line-top-highlight")) map.removeLayer("route-line-top-highlight");
  if (map.getLayer("route-line-front-glow")) map.removeLayer("route-line-front-glow");
  if (map.getLayer("route-line-front")) map.removeLayer("route-line-front");
  if (map.getLayer("route-line-glow")) map.removeLayer("route-line-glow");
  if (map.getLayer("route-line-glow-inner")) map.removeLayer("route-line-glow-inner");
  if (map.getLayer("route-line")) map.removeLayer("route-line");
  if (map.getLayer("route-line-glow-outer")) map.removeLayer("route-line-glow-outer");
  if (map.getLayer("route-line-glow-middle")) map.removeLayer("route-line-glow-middle");
  if (map.getLayer("route-line-base")) map.removeLayer("route-line-base");
  if (map.getLayer("route-line-main")) map.removeLayer("route-line-main");
  if (map.getLayer("route-line-highlight")) map.removeLayer("route-line-highlight");
  if (map.getLayer("route-line-edge")) map.removeLayer("route-line-edge");
  
  if (map.getSource("route")) {
    map.getSource("route").setData(createLineFeature([]));
  }
}

function drawRouteLine() {
  clearExistingRoute();
  ensureMarkerLayers();
  syncRouteLineAppearance();

  const initialCoords = routePoints.length > 0 ? [[routePoints[0].lon, routePoints[0].lat]] : [];
  const routeSource = map.getSource("route");
  if (routeSource) {
    routeSource.setData(createLineFeature(initialCoords));
  }
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
    const routeHead = pointAtProgress(routePoints, progress);
    const offsetCenter = keepRouteHeadInViewport(
      addHelicopterOffset(focusPoint, bearing),
      routeHead,
      bearing,
      cfg.pitch,
      cfg.zoom
    );

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
  routePoints = densifyRoutePoints(sampledPoints); // Use 3m steps
  cameraPoints = smoothRoutePoints(routePoints); // Use 3-pass, 12 window smoothing
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
    let lastTrailUpdateAt = 0;
    const reachedHighlight = {
      fastest: false,
      highest: false,
    };
    const reachedPhotoSpotIds = new Set();

    resetAnimatedRouteLine();
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

        // 3) Interpolate between route segments with slope-dependent braking
        const currentRouteIdx = segmentIndex;
        const nextRouteIdx = Math.min(segmentIndex + 1, routePoints.length - 1);
        let cameraAlpha = localT;
        let routeAlpha = localT;

        const currentRoutePt = routePoints[currentRouteIdx];
        const nextRoutePt = routePoints[nextRouteIdx];
        const elevationGain =
          Number.isFinite(currentRoutePt?.ele) && Number.isFinite(nextRoutePt?.ele)
            ? nextRoutePt.ele - currentRoutePt.ele
            : 0;

        if (elevationGain > 0) {
          const slopeFactor = Math.max(0.4, 1.0 - elevationGain * 0.3);
          cameraAlpha = localT * slopeFactor;
          routeAlpha = localT * slopeFactor;
        }

        const smoothCam = interpolatePoint(
          activePoints[segmentIndex],
          activePoints[segmentIndex + 1],
          cameraAlpha
        );
        const smoothRoute = interpolatePoint(
          routePoints[currentRouteIdx],
          routePoints[nextRouteIdx],
          routeAlpha
        );

        // Dynamically adjust lookahead based on position in route to prevent off-track issues
        const distanceFromEnd = activePoints.length - 1 - segmentIndex;
        const dynamicLookAhead = Math.min(cfg.lookAheadPoints, Math.max(3, distanceFromEnd));
        const dynamicFocusAhead = Math.min(cfg.focusAheadPoints, Math.max(2, Math.floor(distanceFromEnd / 2)));
        
        const lookAheadIndex = Math.min(
          activePoints.length - 1,
          segmentIndex + dynamicLookAhead
        );
        const rawBearing = getStableBearing(activePoints, lookAheadIndex);

        if (smoothedBearing === null || !Number.isFinite(smoothedBearing)) {
          smoothedBearing = rawBearing;
        } else {
          const delta = shortestAngleDelta(smoothedBearing, rawBearing);
          const smoothedDelta = delta * cfg.bearingSmoothing;
          const maxStep = (cfg.maxBearingSpeedDegPerSec * dtMs) / 1000;
          const limitedDelta = Math.max(-maxStep, Math.min(maxStep, smoothedDelta));
          smoothedBearing += limitedDelta;
          
          // Normalize to 0-360 range
          smoothedBearing = ((smoothedBearing % 360) + 360) % 360;
        }

        if (!Number.isFinite(smoothedBearing)) {
          smoothedBearing = rawBearing || 0;
        }

        const focusIndex = Math.min(
          activePoints.length - 1,
          segmentIndex + dynamicFocusAhead
        );
        const focusPoint = elevationGain > 0 ? smoothCam : activePoints[focusIndex];
        const offsetCenter = keepRouteHeadInViewport(
          addHelicopterOffset(focusPoint, smoothedBearing),
          smoothRoute,
          smoothedBearing,
          cfg.pitch,
          cfg.zoom
        );
        if (!smoothedCenter) {
          smoothedCenter = offsetCenter;
        } else {
          smoothedCenter = {
            lon: lerp(smoothedCenter.lon, offsetCenter.lon, cfg.centerSmoothing),
            lat: lerp(smoothedCenter.lat, offsetCenter.lat, cfg.centerSmoothing),
          };
        }

        if (!reachedHighlight.fastest && routeInsights?.fastest && routeInsights.fastestRouteIndex >= 0) {
          if (Math.abs(segmentIndex - routeInsights.fastestRouteIndex) <= 5) {
            reachedHighlight.fastest = true;
            unlockInsight("fastest");
            setHighlightMarkerUnlocked("fastest", true);
            showInsightEvent(`⚡ Schnellster Abschnitt: ${formatSpeedKmh(routeInsights.fastest.speedMps)}`);
          }
        }

        if (SHOW_HIGHEST_INSIGHT && !reachedHighlight.highest && routeInsights?.highest && routeInsights.highestRouteIndex >= 0) {
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
          // Build trail from scratch to avoid leftover artifacts!
          const animatedCoords = [];
          for (let i = 0; i <= segmentIndex; i += 1) {
            animatedCoords.push([routePoints[i].lon, routePoints[i].lat]);
          }
          animatedCoords.push([smoothRoute.lon, smoothRoute.lat]);
          map.getSource("route").setData(createLineFeature(animatedCoords));
          lastTrailUpdateAt = now;
        }

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enterRenderMode() {
  capturePreviewCanvasSize();
  isRenderMode = true;
  resetRenderCameraState();
  document.body.classList.add("render-mode");
  map.resize();
  computeRenderZoomOffset();
  syncRouteLineAppearance();
}

function leaveRenderMode() {
  isRenderMode = false;
  resetRenderCameraState();
  document.body.classList.remove("render-mode");
  renderZoomOffset = 0;
  map.resize();
  capturePreviewCanvasSize();
  syncRouteLineAppearance();
}

async function recordAnimationAndDownload() {
  if (isRecording) {
    return;
  }

  if (routePoints.length < 2) {
    setStatus("Bitte zuerst eine GPX-Datei laden.");
    return;
  }

  isRecording = true;
  playButton.disabled = true;
  recordButton.disabled = true;
  recordButton.textContent = "Rendert...";

  // Hide map and show progress bar
  const mapStage = document.getElementById("mapStage");
  const mapFrame = document.getElementById("mapFrame");
  
  let progressInterval = null;
  
  if (mapStage && mapFrame) {
    mapStage.style.display = "none";
    
    // Create progress bar container
    const progressContainer = document.createElement("div");
    progressContainer.id = "renderProgress";
    progressContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 500px;
      gap: 20px;
    `;
    
    const progressText = document.createElement("p");
    progressText.id = "renderProgressText";
    progressText.textContent = "Video wird im Hintergrund gerendert (das kann ein paar Minuten dauern)...";
    progressText.style.fontSize = "18px";
    progressText.style.color = "#374151";
    
    const progressBar = document.createElement("div");
    progressBar.style.cssText = `
      width: 300px;
      height: 20px;
      background: #e5e7eb;
      border-radius: 10px;
      overflow: hidden;
    `;
    
    const progressFill = document.createElement("div");
    progressFill.id = "progressFill";
    progressFill.style.cssText = `
      width: 0%;
      height: 100%;
      background: linear-gradient(90deg, #FBBF24, #F59E0B);
      transition: width 0.5s ease;
    `;
    
    const progressPercent = document.createElement("p");
    progressPercent.id = "progressPercent";
    progressPercent.textContent = "0%";
    progressPercent.style.fontSize = "16px";
    progressPercent.style.color = "#6b7280";

    const progressDetail = document.createElement("p");
    progressDetail.id = "renderProgressDetail";
    progressDetail.textContent = "Warte auf Render-Start...";
    progressDetail.style.fontSize = "15px";
    progressDetail.style.color = "#4b5563";
    
    progressBar.appendChild(progressFill);
    progressContainer.appendChild(progressText);
    progressContainer.appendChild(progressBar);
    progressContainer.appendChild(progressPercent);
    progressContainer.appendChild(progressDetail);
    
    mapStage.parentNode.insertBefore(progressContainer, mapStage);
  }

  try {
    const durationSeconds = Number(durationInput.value || 40);
    const formatKey = getSelectedFormatKey();
    const fps = 30;

    setStatus("Video wird im Hintergrund gerendert...");
    
    // Keep the uploaded GPX in memory so a failed render does not lose it.
    const gpxFile = uploadedGpxFile || gpxInput.files?.[0];
    if (!gpxFile) {
      throw new Error("Keine GPX-Datei gefunden. Bitte erneut hochladen.");
    }

    // Check health endpoint to make sure backend is up!
    try {
      const healthCheck = await fetch(`${API_BASE_URL}/health`);
      if (!healthCheck.ok) {
        throw new Error("Backend ist nicht erreichbar!");
      }
    } catch {
      throw new Error("Backend läuft nicht! Bitte starte das Backend auf Port 8000 und das Frontend auf Port 5173.");
    }

    const formData = new FormData();
    formData.append("file", gpxFile);

    console.log("Starting render job...");
    const response = await fetch(
      `${API_BASE_URL}/api/gpx/render?duration=${encodeURIComponent(durationSeconds)}&format=${encodeURIComponent(formatKey)}&fps=${encodeURIComponent(fps)}&showAltitude=${encodeURIComponent(isAltitudeOverlayVisible ? 1 : 0)}`,
      { method: "POST", body: formData }
    );

    if (!response.ok) {
      let errorText = "";
      try {
        errorText = await response.text();
      } catch {}
      throw new Error(errorText || `Rendern fehlgeschlagen (Status ${response.status})`);
    }

    const jobData = await response.json();
    const jobId = jobData?.jobId;
    if (!jobId) {
      throw new Error("Backend hat keine Render-Job-ID zurueckgegeben.");
    }

    setStatus("Render-Job gestartet. Warte auf Fertigstellung...");

    while (true) {
      await delay(1000);

      const statusResponse = await fetch(
        `${API_BASE_URL}/api/gpx/render/${encodeURIComponent(jobId)}`
      );
      if (!statusResponse.ok) {
        throw new Error(
          `Render-Status konnte nicht abgefragt werden (Status ${statusResponse.status}).`
        );
      }

      const job = await statusResponse.json();
      if (job.status === "done") {
        break;
      }
      if (job.status === "error") {
        throw new Error(job.error || "Render-Job ist fehlgeschlagen.");
      }

      const runningFill = document.getElementById("progressFill");
      const runningPercent = document.getElementById("progressPercent");
      const runningText = document.getElementById("renderProgressText");
      const runningDetail = document.getElementById("renderProgressDetail");
      const progressValue = Math.max(0, Math.min(100, Number(job.progress ?? 0)));
      if (runningFill) runningFill.style.width = `${progressValue}%`;
      if (runningPercent) runningPercent.textContent = `${Math.round(progressValue)}%`;
      if (runningText) runningText.textContent = job.message || "Render-Job laeuft...";

      if (runningDetail) {
        if (Number.isFinite(job.currentFrame) && Number.isFinite(job.totalFrames) && job.totalFrames > 0) {
          runningDetail.textContent = `${job.currentFrame} von ${job.totalFrames} Frames gerendert`;
        } else if (job.lastLogLine) {
          runningDetail.textContent = job.lastLogLine;
        } else {
          runningDetail.textContent = `Status: ${job.status}`;
        }
      }

      setStatus(job.message || `Render-Job laeuft im Hintergrund (${job.status})...`);
    }

    // Set progress to 100%
    const fill = document.getElementById("progressFill");
    const percent = document.getElementById("progressPercent");
    if (fill) fill.style.width = "100%";
    if (percent) percent.textContent = "100%";
    
    // Download the video after the background render is finished.
    console.log("Downloading rendered video...");
    const downloadResponse = await fetch(
      `${API_BASE_URL}/api/gpx/render/${encodeURIComponent(jobId)}/download`
    );
    if (!downloadResponse.ok) {
      let errorText = "";
      try {
        errorText = await downloadResponse.text();
      } catch {}
      throw new Error(errorText || `Download fehlgeschlagen (Status ${downloadResponse.status})`);
    }

    const blob = await downloadResponse.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `gpx-video-${toTimestamp()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    setStatus("Video fertig heruntergeladen (.mp4).");
  } catch (error) {
    console.error("Render error:", error);
    setStatus(`Fehler beim Rendern: ${error.message}`);
  } finally {
    // Restore UI
    if (progressInterval) clearInterval(progressInterval);
    const progressContainer = document.getElementById("renderProgress");
    if (progressContainer) {
      progressContainer.remove();
    }
    if (mapStage && mapFrame) {
      mapStage.style.display = "";
    }
    
    isRecording = false;
    recordButton.textContent = "Animation aufnehmen & herunterladen";
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

  uploadedGpxFile = file;

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

altitudeToggleButton?.addEventListener("click", () => {
  const visible = setAltitudeOverlayVisible(!isAltitudeOverlayVisible);
  setStatus(`Hoehenprofil ${visible ? "eingeblendet" : "ausgeblendet"}.`);
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

function setProgress(progress) {
  if (routePoints.length < 2) {
    return false;
  }

  stopAnimation();

  const durationSeconds = Number(durationInput.value || 40);
  const durationMs = Math.max(5000, durationSeconds * 1000);
  const activePoints = cameraPoints.length >= 2 ? cameraPoints : routePoints;
  const cfg = getActiveCameraConfig();
  const segmentCount = activePoints.length - 1;

  const clampedProgress = Math.min(1, Math.max(0, progress));
  const shouldResetSmoothing =
    renderCameraState.lastProgress === null ||
    clampedProgress < renderCameraState.lastProgress ||
    clampedProgress - renderCameraState.lastProgress > 0.1;
  if (shouldResetSmoothing) {
    resetRenderCameraState();
  }

  const scaled = clampedProgress * segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = scaled - segmentIndex;

  updateStatsVisibilityByProximity(segmentIndex);

  const currentRouteIdx = segmentIndex;
  const nextRouteIdx = Math.min(segmentIndex + 1, routePoints.length - 1);
  let cameraAlpha = localT;
  let routeAlpha = localT;

  const currentRoutePt = routePoints[currentRouteIdx];
  const nextRoutePt = routePoints[nextRouteIdx];
  const elevationGain =
    Number.isFinite(currentRoutePt?.ele) && Number.isFinite(nextRoutePt?.ele)
      ? nextRoutePt.ele - currentRoutePt.ele
      : 0;

  if (elevationGain > 0) {
    const slopeFactor = Math.max(0.4, 1.0 - elevationGain * 0.3);
    cameraAlpha = localT * slopeFactor;
    routeAlpha = localT * slopeFactor;
  }

  const effectiveProgress = Math.min(
    1,
    Math.max(0, (segmentIndex + routeAlpha) / Math.max(1, segmentCount))
  );
  updateAltitudeOverlayProgress(effectiveProgress);

  const smoothCam = interpolatePoint(
    activePoints[segmentIndex],
    activePoints[segmentIndex + 1],
    cameraAlpha
  );
  const smoothRoute = interpolatePoint(
    routePoints[currentRouteIdx],
    routePoints[nextRouteIdx],
    routeAlpha
  );

  // Dynamically adjust lookahead based on position in route to prevent off-track issues
  const distanceFromEnd = activePoints.length - 1 - segmentIndex;
  const dynamicLookAhead = Math.min(cfg.lookAheadPoints, Math.max(3, distanceFromEnd));
  const dynamicFocusAhead = Math.min(cfg.focusAheadPoints, Math.max(2, Math.floor(distanceFromEnd / 2)));
  
  const lookAheadIndex = Math.min(
    activePoints.length - 1,
    segmentIndex + dynamicLookAhead
  );
  const rawBearing = getStableBearing(activePoints, lookAheadIndex);

  const progressDelta =
    renderCameraState.lastProgress === null ? 0 : Math.max(0, clampedProgress - renderCameraState.lastProgress);
  const dtMs = Math.max(16, progressDelta * durationMs);
  let smoothedBearing = renderCameraState.smoothedBearing;

  if (smoothedBearing === null || !Number.isFinite(smoothedBearing)) {
    smoothedBearing = rawBearing;
  } else {
    const delta = shortestAngleDelta(smoothedBearing, rawBearing);
    const smoothedDelta = delta * cfg.bearingSmoothing;
    const maxStep = (cfg.maxBearingSpeedDegPerSec * dtMs) / 1000;
    const limitedDelta = Math.max(-maxStep, Math.min(maxStep, smoothedDelta));
    smoothedBearing += limitedDelta;
    smoothedBearing = ((smoothedBearing % 360) + 360) % 360;
  }

  if (!Number.isFinite(smoothedBearing)) {
    smoothedBearing = rawBearing || 0;
  }

  const focusIndex = Math.min(
    activePoints.length - 1,
    segmentIndex + dynamicFocusAhead
  );
  const focusPoint = elevationGain > 0 ? smoothCam : activePoints[focusIndex];
  const offsetCenter = keepRouteHeadInViewport(
    addHelicopterOffset(focusPoint, smoothedBearing),
    smoothRoute,
    smoothedBearing,
    cfg.pitch,
    cfg.zoom
  );

  let smoothedCenter = renderCameraState.smoothedCenter;
  if (!smoothedCenter) {
    smoothedCenter = offsetCenter;
  } else {
    smoothedCenter = {
      lon: lerp(smoothedCenter.lon, offsetCenter.lon, cfg.centerSmoothing),
      lat: lerp(smoothedCenter.lat, offsetCenter.lat, cfg.centerSmoothing),
    };
  }

  // Update trail
  const trailCoords = [];
  for (let i = 0; i <= segmentIndex; i += 1) {
    trailCoords.push([routePoints[i].lon, routePoints[i].lat]);
  }
  trailCoords.push([smoothRoute.lon, smoothRoute.lat]);

  if (map.getSource("route")) {
    map.getSource("route").setData(createLineFeature(trailCoords));
  }

  map.jumpTo({
    center: [smoothedCenter.lon, smoothedCenter.lat],
    bearing: smoothedBearing,
    pitch: cfg.pitch,
    zoom: cfg.zoom,
    duration: 0,
  });

  renderCameraState.lastProgress = clampedProgress;
  renderCameraState.smoothedBearing = smoothedBearing;
  renderCameraState.smoothedCenter = smoothedCenter;

  return true;
}

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
  playOutro: async (durationMs) => {
    await playRouteOutro(durationMs);
    updateAltitudeOverlayProgress(1);
    return true;
  },
  setAltitudeOverlayVisible: (visible, persist = false) => {
    return setAltitudeOverlayVisible(visible, { persist });
  },
  setOutroProgress,
  getRenderedRouteProgress,
  setProgress: setProgress,
  enterRenderMode,
  leaveRenderMode,
};

syncAltitudeToggleButton();

playButton.addEventListener("click", () => {
  startAnimation();
});

recordButton.addEventListener("click", () => {
  recordAnimationAndDownload();
});
