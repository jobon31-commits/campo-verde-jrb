(() => {
  "use strict";

  /* ============================================================
     CAMPO VERDE JRB · medición y rectificación de áreas rurales
     Cálculos geodésicos, croquis georreferenciado, lotes, fotos,
     informe técnico y persistencia local.
     ============================================================ */

  const EARTH_R = 6371008.8;
  const DEG = Math.PI / 180;
  const CIRCLE_SEGMENTS = 64;
  const APP_NAME = "CAMPO VERDE JRB";
  const BRAND_LINE = "AVALÚOS INTEGRALES · Urbanos & Rurales";
  const STORAGE_KEY = "campoverdejr.state.v2";
  const LEGACY_STORAGE_KEY = "terralinde.state.v1";
  const CASES_KEY = "campoverdejr.cases.v1";
  const MAX_CASES = 15;
  const DEMO_REF = { lat: -34.9012, lon: -60.3011 };
  const DEMO_LOCALS = [[-95, -66], [95, -66], [88, 66], [-98, 66]];
  const MAX_PHOTOS = 8;
  const PHOTO_MAX_PX = 1280;
  const PHOTO_QUALITY = 0.72;
  const REF_SOURCES = ["Escritura / Título", "Catastro", "Medición anterior", "Otro"];
  const METHOD_LABELS = {
    demo: "Demostración",
    gps: "GPS",
    linderos: "Linderos",
    coords: "Coordenadas",
    none: "Sin método",
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const formatters = new Map();
  function fmt(value, digits = 2) {
    const number = Number.isFinite(value) ? value : 0;
    if (!formatters.has(digits)) {
      formatters.set(digits, new Intl.NumberFormat("es-ES", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }));
    }
    return formatters.get(digits).format(number);
  }
  const fmtInt = (value) => fmt(value, 0);

  // Escribe texto solo si cambió: evita invalidaciones y saltos de maquetación.
  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function signedHa(diffHa) {
    if (!Number.isFinite(diffHa)) return "—";
    const rounded = Math.abs(diffHa) < 0.00005 ? 0 : diffHa;
    if (rounded === 0) return "0,0000 ha";
    return `${rounded > 0 ? "+" : "−"}${fmt(Math.abs(rounded), 4)} ha`;
  }

  function parseDecimal(text) {
    if (typeof text === "number") return Number.isFinite(text) ? text : NaN;
    if (!text) return NaN;
    let value = String(text).trim().replace(/\s+/g, "").replace(/−/g, "-");
    if (!value) return NaN;
    const hasComma = value.includes(",");
    const hasDot = value.includes(".");
    if (hasComma && hasDot) {
      if (value.lastIndexOf(",") > value.lastIndexOf(".")) {
        value = value.replace(/\./g, "").replace(",", ".");
      } else {
        value = value.replace(/,/g, "");
      }
    } else if (hasComma) {
      value = value.replace(",", ".");
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function vertexLabel(index) {
    let n = index;
    let label = "";
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }

  function slugify(text) {
    return String(text || "predio")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "predio";
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  }

  function escapeXml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function csvCell(text) {
    const value = String(text ?? "");
    return /[",;\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }

  function escapeHtml(text) {
    return String(text ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function formatCoordDms(value, isLat, secondsDigits = 1) {
    if (!Number.isFinite(value)) return "—";
    const hemi = isLat ? (value >= 0 ? "N" : "S") : (value >= 0 ? "E" : "W");
    let abs = Math.abs(value);
    let deg = Math.floor(abs);
    let minutes = Math.floor((abs - deg) * 60);
    let seconds = ((abs - deg) * 60 - minutes) * 60;
    const factor = 10 ** secondsDigits;
    seconds = Math.round(seconds * factor) / factor;
    if (seconds >= 60) {
      seconds = 0;
      minutes += 1;
    }
    if (minutes >= 60) {
      minutes = 0;
      deg += 1;
    }
    const secText = seconds.toFixed(secondsDigits).replace(".", ",");
    return `${deg}°${String(minutes).padStart(2, "0")}′${secText}″${hemi}`;
  }

  function formatDateTime(value, withTime = true) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-ES", withTime
      ? { dateStyle: "medium", timeStyle: "short" }
      : { dateStyle: "medium" }).format(date);
  }

  function shortHash(hash) {
    return hash ? `${hash.slice(0, 16)}…` : "—";
  }

  /* SHA-256 síncrono: huella de integridad del proyecto y de los respaldos.
     Se implementa aquí para que funcione también al abrir el archivo como
     file://, donde crypto.subtle puede no estar disponible. */
  function sha256Hex(text) {
    const bytes = new TextEncoder().encode(String(text));
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    let h0 = 0x6a09e667;
    let h1 = 0xbb67ae85;
    let h2 = 0x3c6ef372;
    let h3 = 0xa54ff53a;
    let h4 = 0x510e527f;
    let h5 = 0x9b05688c;
    let h6 = 0x1f83d9ab;
    let h7 = 0x5be0cd19;
    const length = bytes.length;
    const total = (((length + 8) >> 6) + 1) << 6;
    const buffer = new Uint8Array(total);
    buffer.set(bytes);
    buffer[length] = 0x80;
    const view = new DataView(buffer.buffer);
    view.setUint32(total - 8, Math.floor(length / 0x20000000));
    view.setUint32(total - 4, (length << 3) >>> 0);
    const w = new Uint32Array(64);
    const rotr = (value, shift) => (value >>> shift) | (value << (32 - shift));
    for (let offset = 0; offset < total; offset += 64) {
      for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4);
      for (let i = 16; i < 64; i += 1) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = h0;
      let b = h1;
      let c = h2;
      let d = h3;
      let e = h4;
      let f = h5;
      let g = h6;
      let h = h7;
      for (let i = 0; i < 64; i += 1) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ (~e & g);
        const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) >>> 0;
      }
      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  function projectPayload(source = state) {
    return {
      app: APP_NAME,
      schema: 2,
      projectName: source.projectName || "Predio sin nombre",
      method: source.method,
      ref: source.ref ? { lat: source.ref.lat, lon: source.ref.lon } : null,
      points: source.points.map((point) => ({
        lat: point.lat,
        lon: point.lon,
        acc: Number.isFinite(point.acc) ? point.acc : null,
      })),
      refAreaHa: source.refAreaHa,
      refSource: source.refSource,
      lots: source.lots.map((lot) => ({ name: lot.name, crop: lot.crop, areaHa: lot.areaHa })),
      repetitions: source.repetitions.map((rep) => ({ areaHa: rep.areaHa, method: rep.method, at: rep.at })),
      photos: source.photos.map((photo) => ({
        caption: photo.caption,
        at: photo.at,
        lat: photo.lat,
        lon: photo.lon,
        data: photo.data,
      })),
      notes: source.notes,
      updatedAt: source.updatedAt,
    };
  }

  function payloadHash(payload = projectPayload()) {
    return sha256Hex(JSON.stringify(payload));
  }

  /* ---------- Geometría ---------- */

  function localToLatLon(x, y, ref) {
    const lat = ref.lat + (y / EARTH_R) / DEG;
    const lon = ref.lon + (x / (EARTH_R * Math.cos(ref.lat * DEG))) / DEG;
    return { lat, lon };
  }

  function latLonToLocal(point, ref) {
    const x = (point.lon - ref.lon) * DEG * EARTH_R * Math.cos(ref.lat * DEG);
    const y = (point.lat - ref.lat) * DEG * EARTH_R;
    return { x, y };
  }

  function centroid(points) {
    if (!points.length) return { lat: DEMO_REF.lat, lon: DEMO_REF.lon };
    let lat = 0;
    let lon = 0;
    for (const point of points) {
      lat += point.lat;
      lon += point.lon;
    }
    return { lat: lat / points.length, lon: lon / points.length };
  }

  function haversine(a, b) {
    const lat1 = a.lat * DEG;
    const lat2 = b.lat * DEG;
    const dLat = (b.lat - a.lat) * DEG;
    const dLon = (b.lon - a.lon) * DEG;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    const lat1 = a.lat * DEG;
    const lat2 = b.lat * DEG;
    const dLon = (b.lon - a.lon) * DEG;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) / DEG + 360) % 360;
  }

  function wrapLonDelta(delta) {
    let value = delta;
    while (value > Math.PI) value -= Math.PI * 2;
    while (value < -Math.PI) value += Math.PI * 2;
    return value;
  }

  function sphericalArea(points) {
    if (points.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const lat1 = a.lat * DEG;
      const lat2 = b.lat * DEG;
      const dLon = wrapLonDelta((b.lon - a.lon) * DEG);
      sum += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
    }
    return Math.abs(sum) * EARTH_R * EARTH_R / 2;
  }

  function heron(a, b, c) {
    const s = (a + b + c) / 2;
    const product = s * (s - a) * (s - b) * (s - c);
    return product > 0 ? Math.sqrt(product) : 0;
  }

  function triangleValid(a, b, c) {
    return a > 0 && b > 0 && c > 0 && a + b > c + 1e-9 && a + c > b + 1e-9 && b + c > a + 1e-9;
  }

  function segmentsIntersect(p1, p2, p3, p4) {
    const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const d1 = orient(p3, p4, p1);
    const d2 = orient(p3, p4, p2);
    const d3 = orient(p1, p2, p3);
    const d4 = orient(p1, p2, p4);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
  }

  function polygonSelfIntersects(points) {
    if (points.length < 4) return false;
    const ref = centroid(points);
    const xy = points.map((point) => latLonToLocal(point, ref));
    const n = xy.length;
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        if (j === i + 1 || (i === 0 && j === n - 1)) continue;
        if (segmentsIntersect(xy[i], xy[(i + 1) % n], xy[j], xy[(j + 1) % n])) return true;
      }
    }
    return false;
  }

  function simplifyPoints(points, tolerance) {
    if (points.length <= 3) return points.slice();
    const ref = centroid(points);
    const input = points.map((point) => ({ ...point, ...latLonToLocal(point, ref) }));
    const sqTolerance = tolerance * tolerance;
    const getSqSegDist = (p, a, b) => {
      let x = a.x;
      let y = a.y;
      let dx = b.x - x;
      let dy = b.y - y;
      if (dx !== 0 || dy !== 0) {
        const t = ((p.x - x) * dx + (p.y - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
          x = b.x;
          y = b.y;
        } else if (t > 0) {
          x += dx * t;
          y += dy * t;
        }
      }
      dx = p.x - x;
      dy = p.y - y;
      return dx * dx + dy * dy;
    };
    const simplifyDPStep = (first, last, output) => {
      let maxSqDist = sqTolerance;
      let index = -1;
      for (let i = first + 1; i < last; i += 1) {
        const sqDist = getSqSegDist(input[i], input[first], input[last]);
        if (sqDist > maxSqDist) {
          index = i;
          maxSqDist = sqDist;
        }
      }
      if (index > 0) {
        if (index - first > 1) simplifyDPStep(first, index, output);
        output.push(input[index]);
        if (last - index > 1) simplifyDPStep(index, last, output);
      }
    };
    const simplified = [input[0]];
    simplifyDPStep(0, input.length - 1, simplified);
    simplified.push(input[input.length - 1]);
    return simplified.map((point) => ({ lat: point.lat, lon: point.lon, acc: point.acc ?? null }));
  }

  /* ---------- Estado ---------- */

  function pointsFromLocal(locals, ref) {
    return locals.map(([x, y]) => {
      const geo = localToLatLon(x, y, ref);
      return { lat: geo.lat, lon: geo.lon, acc: null };
    });
  }

  function createDemoState() {
    return {
      projectName: "Predio de ejemplo",
      method: "demo",
      ref: { ...DEMO_REF },
      points: pointsFromLocal(centerLocals(DEMO_LOCALS), DEMO_REF),
      refAreaHa: null,
      refSource: "",
      lots: [],
      repetitions: [],
      photos: [],
      notes: "",
      updatedAt: null,
    };
  }

  function createEmptyState() {
    return {
      projectName: "Predio sin nombre",
      method: "none",
      ref: null,
      points: [],
      refAreaHa: null,
      refSource: "",
      lots: [],
      repetitions: [],
      photos: [],
      notes: "",
      updatedAt: null,
    };
  }

  let state = createDemoState();
  const view = { cx: 0, cy: 0, scale: 1.2, autoFit: true };
  const history = { undo: [], redo: [] };
  let cases = { activeId: null, items: [] };
  let needsInitialPersist = false;
  let casesSignature = "";
  let sidesSignature = "";
  let repsSignature = "";
  let lastHashValue = "";
  let lastMapW = 0;
  let lastMapH = 0;
  let resizeFrame = 0;
  let saveErrorShown = false;
  const gps = {
    active: false,
    paused: false,
    watchId: null,
    lastFix: null,
    elapsed: 0,
    segmentStart: 0,
    timer: null,
    wakeLock: null,
    rejected: 0,
  };
  let activeMode = "gps";
  let shapeType = "quad";
  let labelsOn = true;
  let gridOn = true;
  let mapGridInfo = null;
  let saveTimer = null;
  let hashTimer = null;
  let hashIdle = null;
  let toastTimer = null;
  let reportDirty = true;
  let deferredInstallPrompt = null;

  const el = {
    projectName: $("#projectName"),
    saveState: $("#saveState"),
    saveStateText: $("#saveStateText"),
    installBtn: $("#installBtn"),
    exportBtn: $("#exportBtn"),
    exportMenu: $("#exportMenu"),
    newBtn: $("#newBtn"),
    casesCount: $("#casesCount"),
    caseList: $("#caseList"),
    caseNew: $("#caseNew"),
    caseSave: $("#caseSave"),
    tabs: $$(".mode-tab"),
    panels: {
      gps: $("#panel-gps"),
      linderos: $("#panel-linderos"),
      coords: $("#panel-coords"),
    },
    gpsStatus: $("#gpsStatus"),
    gpsStatusTitle: $("#gpsStatusTitle"),
    gpsStatusText: $("#gpsStatusText"),
    gpsAccuracy: $("#gpsAccuracy"),
    gpsThreshold: $("#gpsThreshold"),
    gpsMinDistance: $("#gpsMinDistance"),
    gpsToggle: $("#gpsToggle"),
    gpsToggleText: $("#gpsToggleText"),
    gpsToggleIcon: $("#gpsToggle use"),
    gpsFinish: $("#gpsFinish"),
    gpsSimplify: $("#gpsSimplify"),
    gpsPoints: $("#gpsPoints"),
    gpsAverage: $("#gpsAverage"),
    gpsTimer: $("#gpsTimer"),
    shapeTabs: $$("#shapeTabs button"),
    shapeErrors: $("#shapeError"),
    shapeArea: $("#shapeArea"),
    shapePerimeter: $("#shapePerimeter"),
    shapeApply: $("#shapeApply"),
    shapeFields: $$(".shape-fields"),
    originLat: $("#originLat"),
    originLon: $("#originLon"),
    originGps: $("#originGps"),
    coordLat: $("#coordLat"),
    coordLon: $("#coordLon"),
    coordAdd: $("#coordAdd"),
    coordLocate: $("#coordLocate"),
    coordError: $("#coordError"),
    coordImport: $("#coordImport"),
    coordAppend: $("#coordAppend"),
    coordReplace: $("#coordReplace"),
    importError: $("#importError"),
    mapStage: $("#mapStage"),
    mapCanvas: $("#mapCanvas"),
    mapWarning: $("#mapWarning"),
    mapEmpty: $("#mapEmpty"),
    loadDemoBtn: $("#loadDemoBtn"),
    loadDemoText: $("#loadDemoText"),
    mapHint: $("#mapHint"),
    mapCoords: $("#mapCoords"),
    mapSubtitle: $("#mapSubtitle"),
    mapArea: $("#mapArea"),
    mapPerimeter: $("#mapPerimeter"),
    methodBadge: $("#methodBadge"),
    areaHa: $("#areaHa"),
    areaM2: $("#areaM2"),
    perimeter: $("#perimeter"),
    vertexCount: $("#vertexCount"),
    gpsPrecision: $("#gpsPrecision"),
    gpsAverageValue: $("#gpsAverageValue"),
    refArea: $("#refArea"),
    refSource: $("#refSource"),
    refResult: $("#refResult"),
    refDiffHa: $("#refDiffHa"),
    refDiffPct: $("#refDiffPct"),
    refHint: $("#refHint"),
    repAdd: $("#repAdd"),
    repList: $("#repList"),
    repMean: $("#repMean"),
    repU: $("#repU"),
    repDetail: $("#repDetail"),
    notes: $("#notes"),
    notesBox: $("#notesBox"),
    projectHash: $("#projectHash"),
    lotsSummary: $("#lotsSummary"),
    lotForm: $("#lotForm"),
    lotName: $("#lotName"),
    lotCrop: $("#lotCrop"),
    lotArea: $("#lotArea"),
    lotAdd: $("#lotAdd"),
    lotError: $("#lotError"),
    lotsBody: $("#lotsBody"),
    lotBalance: $("#lotBalance"),
    photoInput: $("#photoInput"),
    photoGrid: $("#photoGrid"),
    photoCount: $("#photoCount"),
    photoError: $("#photoError"),
    sideCount: $("#sideCount"),
    sidesBody: $("#sidesBody"),
    confirmDialog: $("#confirmDialog"),
    dialogTitle: $("#dialogTitle"),
    dialogText: $("#dialogText"),
    dialogConfirm: $("#dialogConfirm"),
    dialogCancel: $("#dialogCancel"),
    toast: $("#toast"),
    printReport: $("#printReport"),
    restoreInput: $("#restoreInput"),
  };

  function clonePoints(points) {
    return points.map((point) => ({
      lat: point.lat,
      lon: point.lon,
      acc: Number.isFinite(point.acc) ? point.acc : null,
    }));
  }

  function snapshot() {
    return {
      points: clonePoints(state.points),
      method: state.method,
      ref: state.ref ? { ...state.ref } : null,
    };
  }

  function normalizeLots(rawLots) {
    if (!Array.isArray(rawLots)) return [];
    return rawLots.slice(0, 40).map((lot) => {
      if (!lot || typeof lot !== "object") return null;
      const area = parseDecimal(lot.areaHa);
      if (!Number.isFinite(area) || area <= 0) return null;
      return {
        id: typeof lot.id === "string" && lot.id ? lot.id : uid(),
        name: String(lot.name || "Lote").slice(0, 40),
        crop: String(lot.crop || "").slice(0, 40),
        areaHa: clamp(area, 0.0001, 99999),
      };
    }).filter(Boolean);
  }

  function normalizeRepetitions(rawReps) {
    if (!Array.isArray(rawReps)) return [];
    return rawReps.slice(0, 30).map((rep) => {
      if (!rep || typeof rep !== "object") return null;
      const area = parseDecimal(rep.areaHa);
      if (!Number.isFinite(area) || area <= 0) return null;
      return {
        id: typeof rep.id === "string" && rep.id ? rep.id : uid(),
        areaHa: clamp(area, 0.0001, 99999),
        method: METHOD_LABELS[rep.method] ? rep.method : "none",
        at: typeof rep.at === "string" ? rep.at : new Date().toISOString(),
      };
    }).filter(Boolean);
  }

  function normalizePhotos(rawPhotos) {
    if (!Array.isArray(rawPhotos)) return [];
    return rawPhotos.slice(0, MAX_PHOTOS).map((photo) => {
      if (!photo || typeof photo !== "object") return null;
      if (typeof photo.data !== "string" || !/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(photo.data)) return null;
      return {
        id: typeof photo.id === "string" && photo.id ? photo.id : uid(),
        data: photo.data,
        caption: String(photo.caption || "Foto del predio").slice(0, 80),
        at: typeof photo.at === "string" ? photo.at : new Date().toISOString(),
        lat: Number.isFinite(+photo.lat) ? +photo.lat : null,
        lon: Number.isFinite(+photo.lon) ? +photo.lon : null,
      };
    }).filter(Boolean);
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== "object") return null;
    const points = Array.isArray(raw.points)
      ? raw.points
          .filter((point) => point && Number.isFinite(+point.lat) && Number.isFinite(+point.lon))
          .map((point) => ({
            lat: +point.lat,
            lon: +point.lon,
            acc: Number.isFinite(+point.acc) && point.acc !== null ? +point.acc : null,
          }))
      : [];
    let ref = raw.ref && Number.isFinite(+raw.ref.lat) && Number.isFinite(+raw.ref.lon)
      ? { lat: +raw.ref.lat, lon: +raw.ref.lon }
      : null;
    if (!ref && points.length) ref = centroid(points);
    const refAreaRaw = parseDecimal(raw.refAreaHa);
    const refAreaHa = Number.isFinite(refAreaRaw) && refAreaRaw > 0
      ? clamp(refAreaRaw, 0.0001, 99999)
      : null;
    return {
      projectName: String(raw.projectName || "Predio sin nombre").slice(0, 60),
      method: METHOD_LABELS[raw.method] ? raw.method : "none",
      ref,
      points,
      refAreaHa,
      refSource: REF_SOURCES.includes(raw.refSource) ? raw.refSource : "",
      lots: normalizeLots(raw.lots),
      repetitions: normalizeRepetitions(raw.repetitions),
      photos: normalizePhotos(raw.photos),
      notes: String(raw.notes || "").slice(0, 1200),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    };
  }

  function normalizeCaseRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    const project = normalizeState(raw.project || raw);
    if (!project) return null;
    const created = typeof raw.createdAt === "string" && !Number.isNaN(Date.parse(raw.createdAt))
      ? raw.createdAt
      : (project.updatedAt || new Date().toISOString());
    const updated = typeof raw.updatedAt === "string" && !Number.isNaN(Date.parse(raw.updatedAt))
      ? raw.updatedAt
      : (project.updatedAt || created);
    return {
      id: typeof raw.id === "string" && raw.id ? raw.id : uid(),
      createdAt: created,
      updatedAt: updated,
      project,
    };
  }

  function makeCaseRecord(source = state, createdAt) {
    const project = projectPayload(source);
    const stamp = createdAt || project.updatedAt || new Date().toISOString();
    return {
      id: uid(),
      createdAt: stamp,
      updatedAt: project.updatedAt || stamp,
      project,
    };
  }

  function activeCase() {
    return cases.items.find((item) => item.id === cases.activeId) || null;
  }

  function projectFromCase(record) {
    return record ? normalizeState(record.project) : null;
  }

  function caseAreaHa(project) {
    const points = project && Array.isArray(project.points) ? project.points : [];
    return points.length >= 3 ? sphericalArea(points) / 10000 : 0;
  }

  function caseDateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(date);
  }

  function loadState() {
    let storedSingle = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) storedSingle = normalizeState(JSON.parse(raw));
    } catch (error) {
      console.warn("No se pudo leer el estado guardado.", error);
    }
    if (!storedSingle) {
      try {
        const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacy) storedSingle = normalizeState(JSON.parse(legacy));
      } catch (error) {
        console.warn("No se pudo leer el estado anterior.", error);
      }
    }

    try {
      const raw = localStorage.getItem(CASES_KEY);
      if (raw) {
        const doc = JSON.parse(raw);
        const items = (doc && Array.isArray(doc.items) ? doc.items : [])
          .map(normalizeCaseRecord)
          .filter(Boolean);
        if (items.length) {
          cases = {
            activeId: items.some((item) => item.id === doc.activeId) ? doc.activeId : items[0].id,
            items,
          };
          const active = activeCase();
          // Si un guardado de emergencia es más reciente que el caso, se recupera.
          if (active && storedSingle) {
            const storedTime = Date.parse(storedSingle.updatedAt || "") || 0;
            const caseTime = Date.parse(active.project.updatedAt || "") || 0;
            if (storedTime > caseTime) {
              active.project = projectPayload(storedSingle);
              active.updatedAt = storedSingle.updatedAt;
              needsInitialPersist = true;
            }
          }
          const loaded = projectFromCase(active);
          if (loaded) {
            state = loaded;
            return "loaded";
          }
        }
      }
    } catch (error) {
      console.warn("No se pudieron leer los casos guardados.", error);
    }

    if (storedSingle) {
      const record = makeCaseRecord(storedSingle, storedSingle.updatedAt || undefined);
      cases = { activeId: record.id, items: [record] };
      state = projectFromCase(record);
      needsInitialPersist = true;
      return "legacy";
    }

    state = createDemoState();
    cases = { activeId: null, items: [] };
    needsInitialPersist = true;
    return "none";
  }

  function setSaveStatus(kind) {
    el.saveState.classList.remove("is-saving", "is-error", "is-partial");
    if (kind === "saving") {
      el.saveState.classList.add("is-saving");
      el.saveState.title = "";
      setText(el.saveStateText, "Guardando…");
    } else if (kind === "error") {
      el.saveState.classList.add("is-error");
      el.saveState.title = "No hay espacio para guardar todo el proyecto. Descarga un respaldo y elimina fotos o casos antiguos.";
      setText(el.saveStateText, "Solo en memoria");
    } else if (kind === "partial") {
      el.saveState.classList.add("is-partial");
      el.saveState.title = "El caso no cupo completo, pero tu medición actual quedó en el respaldo local.";
      setText(el.saveStateText, "Guardado parcial");
    } else {
      el.saveState.title = "Datos guardados en este dispositivo.";
      const time = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" }).format(new Date());
      setText(el.saveStateText, `Guardado ${time}`);
    }
  }

  function scheduleHashDisplay() {
    window.clearTimeout(hashTimer);
    if (hashIdle !== null && "cancelIdleCallback" in window) {
      window.cancelIdleCallback(hashIdle);
      hashIdle = null;
    }
    hashTimer = window.setTimeout(() => {
      const run = () => {
        hashIdle = null;
        const hash = payloadHash();
        if (hash === lastHashValue) return;
        lastHashValue = hash;
        setText(el.projectHash, shortHash(hash));
        el.projectHash.title = `SHA-256 del proyecto: ${hash}`;
      };
      if ("requestIdleCallback" in window) {
        hashIdle = window.requestIdleCallback(run, { timeout: 2200 });
      } else {
        run();
      }
    }, 900);
  }

  function persistState(options = {}) {
    const touch = options.touch !== false;
    try {
      if (touch || !state.updatedAt) state.updatedAt = new Date().toISOString();
      const payload = projectPayload();
      let record = activeCase();
      if (!record) {
        record = makeCaseRecord(payload, state.updatedAt || undefined);
        cases.items.unshift(record);
        cases.activeId = record.id;
      } else {
        record.project = payload;
        record.updatedAt = state.updatedAt;
      }
      const doc = {
        app: APP_NAME,
        schema: 1,
        activeId: cases.activeId,
        items: cases.items,
      };
      localStorage.setItem(CASES_KEY, JSON.stringify(doc));
      // Los formatos anteriores se retiran solo después de guardar el nuevo.
      try {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(LEGACY_STORAGE_KEY);
      } catch (cleanupError) {
        /* Sin importancia: son claves heredadas. */
      }
      saveErrorShown = false;
      setSaveStatus("saved");
      scheduleHashDisplay();
      renderCases();
      return true;
    } catch (error) {
      console.warn("No se pudo guardar el estado.", error);
      let partial = false;
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(projectPayload()));
        partial = true;
      } catch (fallbackError) {
        /* Tampoco cabe el respaldo mínimo. */
      }
      setSaveStatus(partial ? "partial" : "error");
      if (!saveErrorShown) {
        saveErrorShown = true;
        showToast("No hay espacio para guardar todo el proyecto. Descarga un respaldo JSON y elimina fotos o casos antiguos.", 5600);
      }
      return false;
    }
  }

  function renderCases(force = false) {
    if (!el.caseList) return;
    const count = cases.items.length;
    setText(el.casesCount, `${count} ${count === 1 ? "caso" : "casos"}`);
    const signature = cases.activeId + "|" + cases.items.map((item) => {
      const project = item.project;
      return [
        item.id,
        project.projectName,
        project.points.length,
        project.method,
        caseAreaHa(project).toFixed(4),
        project.lots.length,
        project.photos.length,
        item.createdAt,
      ].join(":");
    }).join(";");
    if (!force && signature === casesSignature) return;
    casesSignature = signature;

    if (!count) {
      el.caseList.innerHTML = '<p class="case-empty">Todavía no hay casos guardados.</p>';
      return;
    }

    const scrollTop = el.caseList.scrollTop;
    el.caseList.innerHTML = cases.items.map((item) => {
      const project = item.project;
      const active = item.id === cases.activeId;
      const vertices = project.points.length;
      const area = caseAreaHa(project);
      const meta = vertices
        ? `${vertices >= 3 ? `${fmt(area, 4)} ha` : "Sin superficie"} · ${vertices} ${vertices === 1 ? "vértice" : "vértices"} · ${caseDateLabel(item.createdAt)}`
        : `Sin medición · ${caseDateLabel(item.createdAt)}`;
      return `
        <div class="case-item${active ? " is-active" : ""}"${active ? ' aria-current="true"' : ""}>
          <button class="case-open" type="button" data-case-open="${item.id}" aria-label="Abrir caso ${escapeHtml(project.projectName)}">
            <span class="case-name">${escapeHtml(project.projectName)}</span>
            <span class="case-meta">${meta}</span>
          </button>
          <span class="case-tag">${active ? "En edición" : "Abrir"}</span>
          <button class="case-delete" type="button" data-case-delete="${item.id}" title="Eliminar caso" aria-label="Eliminar caso ${escapeHtml(project.projectName)}">
            <svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg>
          </button>
        </div>`;
    }).join("");
    el.caseList.scrollTop = scrollTop;
  }

  function scheduleSave() {
    setSaveStatus("saving");
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(persistState, 420);
  }

  function applyPoints(points, method, options = {}) {
    if ((gps.active || gps.paused) && method && method !== "gps") stopGpsForManual();
    history.undo.push(snapshot());
    if (history.undo.length > 60) history.undo.shift();
    history.redo.length = 0;

    // La referencia puede cambiar (por ejemplo, al añadir coordenadas se
    // recentra en el centroide). Guardamos el centro geográfico que se está
    // viendo para que el croquis no se desplace al cambiar de referencia.
    const previousRef = state.ref
      ? { ...state.ref }
      : (state.points.length ? centroid(state.points) : null);
    const previousCenter = previousRef
      ? localToLatLon(view.cx, view.cy, previousRef)
      : null;

    state.points = clonePoints(points);
    if (method) state.method = method;
    if (options.ref !== undefined) {
      state.ref = options.ref ? { ...options.ref } : null;
    } else if (!state.ref && state.points.length) {
      state.ref = { lat: state.points[0].lat, lon: state.points[0].lon };
    }

    if (previousCenter && previousRef && state.ref
      && (previousRef.lat !== state.ref.lat || previousRef.lon !== state.ref.lon)) {
      const center = latLonToLocal(previousCenter, state.ref);
      view.cx = center.x;
      view.cy = center.y;
    }

    state.updatedAt = new Date().toISOString();
    if (options.fit === false) {
      view.autoFit = false;
      if (options.follow) ensurePointVisible(options.follow);
    } else {
      view.autoFit = true;
    }
    render();
    scheduleSave();
  }

  function undo() {
    if (!history.undo.length) return;
    history.redo.push(snapshot());
    const previous = history.undo.pop();
    state.points = clonePoints(previous.points);
    state.method = previous.method;
    state.ref = previous.ref ? { ...previous.ref } : null;
    state.updatedAt = new Date().toISOString();
    view.autoFit = true;
    render();
    scheduleSave();
  }

  function redo() {
    if (!history.redo.length) return;
    history.undo.push(snapshot());
    const next = history.redo.pop();
    state.points = clonePoints(next.points);
    state.method = next.method;
    state.ref = next.ref ? { ...next.ref } : null;
    state.updatedAt = new Date().toISOString();
    view.autoFit = true;
    render();
    scheduleSave();
  }

  function showToast(message, duration = 2600) {
    el.toast.textContent = message;
    el.toast.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => el.toast.classList.remove("is-visible"), duration);
  }

  function askConfirm(title, text, confirmLabel = "Aceptar", options = {}) {
    if (typeof el.confirmDialog.showModal !== "function") {
      return Promise.resolve(window.confirm(`${title}\n\n${text}`));
    }
    if (el.confirmDialog.open) return Promise.resolve(false);
    return new Promise((resolve) => {
      el.dialogTitle.textContent = title;
      el.dialogText.textContent = text;
      el.dialogConfirm.textContent = options.info && confirmLabel === "Aceptar" ? "Cerrar" : confirmLabel;
      el.dialogCancel.hidden = Boolean(options.info);
      el.confirmDialog.returnValue = "";
      const onClose = () => {
        el.confirmDialog.removeEventListener("close", onClose);
        el.dialogCancel.hidden = false;
        resolve(options.info ? true : el.confirmDialog.returnValue === "confirm");
      };
      el.confirmDialog.addEventListener("close", onClose);
      el.confirmDialog.showModal();
    });
  }

  function showInfo(title, text, label = "Cerrar") {
    return askConfirm(title, text, label, { info: true });
  }

  function computeMetrics() {
    const points = state.points;
    const n = points.length;
    const edges = n >= 3 ? n : Math.max(0, n - 1);
    const sides = [];
    for (let i = 0; i < edges; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % n];
      sides.push({ index: i, distance: haversine(a, b), bearing: bearing(a, b) });
    }
    const areaM2 = n >= 3 ? sphericalArea(points) : 0;
    const perimeter = sides.reduce((sum, side) => sum + side.distance, 0);
    const accuracies = points.map((point) => point.acc).filter((acc) => Number.isFinite(acc));
    const avgAcc = accuracies.length ? accuracies.reduce((sum, acc) => sum + acc, 0) / accuracies.length : null;
    return {
      n,
      edges,
      sides,
      areaM2,
      areaHa: areaM2 / 10000,
      perimeter,
      avgAcc,
      intersects: n >= 4 && polygonSelfIntersects(points),
    };
  }

  function methodLabel() {
    return METHOD_LABELS[state.method] || METHOD_LABELS.none;
  }

  function methodClass() {
    return ["demo", "gps", "linderos", "coords"].includes(state.method) ? state.method : "none";
  }

  function render() {
    const metrics = computeMetrics();
    renderResult(metrics);
    renderReference(metrics);
    renderRepetitions(metrics);
    updateLotsComputed(metrics);
    updatePhotoCount();
    renderSides(metrics);
    renderMap(metrics);
    updateGpsMetrics(metrics);
    updateGpsButtons();
    updateHistoryButtons();
    syncOriginInputs();
    reportDirty = true;
  }

  function renderResult(metrics) {
    const { n, areaHa, areaM2, perimeter } = metrics;

    const badgeClass = `method-badge is-${methodClass()}`;
    if (el.methodBadge.className !== badgeClass) el.methodBadge.className = badgeClass;
    const badgeText = el.methodBadge.querySelector("span");
    if (badgeText) setText(badgeText, methodLabel());

    setText(el.areaHa, n >= 3 ? fmt(areaHa, 4) : "0,0000");
    setText(el.areaM2, `${fmtInt(n >= 3 ? areaM2 : 0)} m²`);
    setText(el.perimeter, `${fmt(perimeter, 2)} m`);
    setText(el.vertexCount, `${n} ${n === 1 ? "vértice" : "vértices"}`);

    const showAccuracy = state.method === "gps" && n > 0 && metrics.avgAcc !== null;
    if (el.gpsPrecision.hidden === showAccuracy) el.gpsPrecision.hidden = !showAccuracy;
    if (showAccuracy) setText(el.gpsAverageValue, `± ${fmt(metrics.avgAcc, 1)} m`);
  }

  function renderReference(metrics) {
    if (document.activeElement !== el.refArea) {
      el.refArea.value = state.refAreaHa ? fmt(state.refAreaHa, 4) : "";
    }
    if (document.activeElement !== el.refSource) el.refSource.value = state.refSource || "";

    const reference = state.refAreaHa;
    const sourceLabel = state.refSource || "sin fuente indicada";
    el.refResult.classList.toggle("is-empty", !reference);

    if (!reference) {
      setText(el.refDiffHa, "—");
      setText(el.refDiffPct, "");
      setText(el.refHint, "Opcional. La referencia no limita la medición: sirve para rectificar el área del título o del catastro.");
      return;
    }

    if (metrics.n < 3) {
      setText(el.refDiffHa, "—");
      setText(el.refDiffPct, "");
      setText(el.refHint, `Referencia ${fmt(reference, 4)} ha · ${sourceLabel}. Aún no hay superficie medida para comparar.`);
      return;
    }

    const diff = metrics.areaHa - reference;
    const pct = reference > 0 ? diff / reference * 100 : 0;
    const pctRounded = Math.abs(pct) < 0.005 ? 0 : pct;
    const diffM2 = Math.round(diff * 10000);
    setText(el.refDiffHa, signedHa(diff));
    setText(el.refDiffPct, `${pctRounded > 0 ? "+" : pctRounded < 0 ? "−" : ""}${fmt(Math.abs(pctRounded), 2)} % · ${diffM2 > 0 ? "+" : diffM2 < 0 ? "−" : ""}${fmtInt(Math.abs(diffM2))} m²`);
    setText(el.refHint, `Fuente: ${sourceLabel}. Diferencia = área medida − referencia. La referencia no limita la medición.`);
  }

  function repTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function renderRepetitions(metrics) {
    el.repAdd.disabled = metrics.n < 3;
    const reps = state.repetitions;
    const signature = reps.map((rep) => `${rep.id}:${rep.areaHa}:${rep.at}:${rep.method}`).join("|");
    if (signature !== repsSignature) {
      repsSignature = signature;
      if (!reps.length) {
        el.repList.innerHTML = '<span class="rep-empty">Sin repeticiones guardadas.</span>';
      } else {
        el.repList.innerHTML = reps.map((rep) => `
          <span class="rep-chip">
            <span class="rep-chip-value">${fmt(rep.areaHa, 4)} ha</span>
            <span class="rep-chip-meta">${METHOD_LABELS[rep.method] || "—"} · ${repTime(rep.at)}</span>
            <button type="button" data-rep-delete="${rep.id}" title="Eliminar repetición" aria-label="Eliminar repetición de ${fmt(rep.areaHa, 4)} hectáreas">×</button>
          </span>`).join("");
      }
    }

    const values = reps.map((rep) => rep.areaHa);
    if (!values.length) {
      setText(el.repMean, "—");
      setText(el.repU, "—");
      setText(el.repDetail, "Guarda al menos dos mediciones del mismo predio para estimar s y U = 2·s/√n.");
      return;
    }

    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    setText(el.repMean, `${fmt(mean, 4)} ha`);

    if (values.length < 2) {
      setText(el.repU, "—");
      setText(el.repDetail, "n = 1 · guarda otra medición para calcular la desviación típica s y la incertidumbre U.");
      return;
    }

    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const deviation = Math.sqrt(Math.max(0, variance));
    const standardError = deviation / Math.sqrt(values.length);
    const expanded = 2 * standardError;
    const cv = mean > 0 ? deviation / mean * 100 : 0;
    setText(el.repU, `${fmt(expanded, 4)} ha`);
    setText(el.repDetail, `n = ${values.length} · s = ${fmt(deviation, 4)} ha · u = s/√n = ${fmt(standardError, 4)} ha · CV = ${fmt(cv, 1)} %.`);
  }

  function renderLots() {
    if (!state.lots.length) {
      el.lotsBody.innerHTML = '<tr><td class="table-empty" colspan="4">Sin lotes declarados. Añade los cultivos que quieras desglosar.</td></tr>';
      return;
    }
    el.lotsBody.innerHTML = state.lots.map((lot) => `
      <tr data-lot-row="${lot.id}">
        <td class="lot-name-cell">
          <input class="lot-line" data-lot-field="name" data-lot-id="${lot.id}" value="${escapeHtml(lot.name)}" maxlength="40" aria-label="Nombre del lote">
          <input class="lot-line is-crop" data-lot-field="crop" data-lot-id="${lot.id}" value="${escapeHtml(lot.crop)}" maxlength="40" placeholder="Cultivo" aria-label="Cultivo del lote">
        </td>
        <td class="lot-area-cell">
          <input class="lot-area" data-lot-field="areaHa" data-lot-id="${lot.id}" value="${fmt(lot.areaHa, 4)}" inputmode="decimal" aria-label="Superficie del lote en hectáreas">
          <span>ha</span>
        </td>
        <td class="lot-pct" data-lot-pct="${lot.id}">—</td>
        <td><button type="button" class="row-delete" data-lot-delete="${lot.id}" title="Eliminar lote" aria-label="Eliminar lote ${escapeHtml(lot.name)}"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button></td>
      </tr>`).join("");
  }

  function updateLotsComputed(metrics) {
    const lots = state.lots;
    const summed = lots.reduce((sum, lot) => sum + lot.areaHa, 0);
    const total = metrics.n >= 3 ? metrics.areaHa : 0;

    setText(el.lotsSummary, lots.length
      ? `${lots.length} ${lots.length === 1 ? "lote" : "lotes"} · ${fmt(summed, 2)} ha`
      : "Sin lotes");

    for (const lot of lots) {
      const cell = $(`[data-lot-pct="${lot.id}"]`);
      if (cell) setText(cell, total > 0 ? `${fmt(lot.areaHa / total * 100, 1)} %` : "—");
    }

    el.lotBalance.classList.remove("is-over");
    if (!lots.length) {
      setText(el.lotBalance, "Sin lotes declarados. Añade cultivos para desglosar el predio.");
    } else if (total <= 0) {
      setText(el.lotBalance, `${lots.length} ${lots.length === 1 ? "lote" : "lotes"} · ${fmt(summed, 4)} ha declaradas. Mide el predio para comparar.`);
    } else {
      const remaining = total - summed;
      if (remaining < -1e-9) {
        el.lotBalance.classList.add("is-over");
        setText(el.lotBalance, `Los lotes superan el área medida en ${fmt(-remaining, 4)} ha (${fmt(Math.abs(remaining) / total * 100, 1)} %). Revisa las superficies.`);
      } else {
        setText(el.lotBalance, `Asignado ${fmt(summed, 4)} ha (${fmt(summed / total * 100, 1)} %) · Sin asignar ${fmt(remaining, 4)} ha (${fmt(remaining / total * 100, 1)} %).`);
      }
    }
  }

  function updatePhotoCount() {
    const count = state.photos.length;
    el.photoCount.textContent = `${count} / ${MAX_PHOTOS}`;
    el.photoInput.disabled = count >= MAX_PHOTOS;
    const label = $('label[for="photoInput"]');
    if (label) label.classList.toggle("is-disabled", count >= MAX_PHOTOS);
  }

  function renderPhotos() {
    updatePhotoCount();
    el.photoInput.value = "";
    if (!state.photos.length) {
      el.photoGrid.innerHTML = '<p class="photo-empty">Sin fotos. Añade una vista del predio, del lindero o del cultivo.</p>';
      return;
    }
    el.photoGrid.innerHTML = state.photos.map((photo) => {
      const coords = Number.isFinite(photo.lat) && Number.isFinite(photo.lon)
        ? `${formatCoordDms(photo.lat, true, 1)} ${formatCoordDms(photo.lon, false, 1)}`
        : "Sin coordenadas";
      return `
        <figure class="photo-card" data-photo-card="${photo.id}">
          <img src="${photo.data}" alt="${escapeHtml(photo.caption || "Foto del predio")}" loading="lazy">
          <figcaption>
            <input class="photo-caption" data-photo-caption="${photo.id}" value="${escapeHtml(photo.caption)}" maxlength="80" aria-label="Descripción de la foto">
            <span class="photo-meta" title="${escapeHtml(coords)}">${formatDateTime(photo.at)}</span>
          </figcaption>
          <button type="button" class="photo-delete" data-photo-delete="${photo.id}" title="Eliminar foto" aria-label="Eliminar foto"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button>
        </figure>`;
    }).join("");
  }

  function syncOriginInputs() {
    const origin = state.ref || DEMO_REF;
    if (document.activeElement !== el.originLat) el.originLat.value = fmt(origin.lat, 6);
    if (document.activeElement !== el.originLon) el.originLon.value = fmt(origin.lon, 6);
  }

  function renderSides(metrics) {
    const n = metrics.n;
    setText(el.sideCount, n >= 3
      ? `${n} ${n === 1 ? "lado" : "lados"}`
      : n === 2
        ? "1 lado"
        : "Sin lados");

    const signature = `${n}|${state.points.map((point) => `${point.lat.toFixed(8)},${point.lon.toFixed(8)}`).join(";")}`;
    if (signature === sidesSignature) return;
    sidesSignature = signature;

    const wrap = el.sidesBody.closest(".table-wrap");
    const scrollTop = wrap ? wrap.scrollTop : 0;

    if (!n) {
      el.sidesBody.innerHTML = '<tr><td class="table-empty" colspan="5">Todavía no hay vértices. Inicia un recorrido, define los linderos o importa coordenadas.</td></tr>';
      if (wrap) wrap.scrollTop = scrollTop;
      return;
    }

    const parts = [];
    for (let i = 0; i < n; i += 1) {
      const point = state.points[i];
      const side = metrics.sides[i];
      const label = vertexLabel(i);
      parts.push(`
        <tr>
          <td><span class="vertex-tag">${label}</span></td>
          <td class="coord-cell" title="${formatCoordDms(point.lat, true, 2)} ${formatCoordDms(point.lon, false, 2)}">${fmt(point.lat, 6)}<br>${fmt(point.lon, 6)}</td>
          <td class="side-cell">${side ? `${fmt(side.distance, 2)} m` : "—"}</td>
          <td class="bearing-cell">${side ? `${fmt(side.bearing, 1)}°` : "—"}</td>
          <td><button type="button" class="row-delete" data-delete-index="${i}" title="Eliminar vértice ${label}" aria-label="Eliminar vértice ${label}"><svg class="icon" aria-hidden="true"><use href="#i-trash"></use></svg></button></td>
        </tr>`);
    }
    el.sidesBody.innerHTML = parts.join("");
    if (wrap) wrap.scrollTop = scrollTop;
  }

  function updateGpsMetrics(metrics) {
    setText(el.gpsPoints, String(metrics.n));
    setText(el.gpsAverage, metrics.avgAcc !== null ? `± ${fmt(metrics.avgAcc, 1)}` : "—");
    el.gpsSimplify.disabled = state.method !== "gps" || metrics.n <= 4 || gps.active || gps.paused;
    el.gpsFinish.disabled = !(gps.active || gps.paused);
  }

  function updateHistoryButtons() {
    const undoBtn = $('[data-map="undo"]');
    const redoBtn = $('[data-map="redo"]');
    if (undoBtn) undoBtn.disabled = history.undo.length === 0;
    if (redoBtn) redoBtn.disabled = history.redo.length === 0;
    const labelsBtn = $('[data-map="labels"]');
    if (labelsBtn) {
      labelsBtn.classList.toggle("is-on", labelsOn);
      labelsBtn.setAttribute("aria-pressed", String(labelsOn));
    }
    const gridBtn = $('[data-map="grid"]');
    if (gridBtn) {
      gridBtn.classList.toggle("is-on", gridOn);
      gridBtn.setAttribute("aria-pressed", String(gridOn));
    }
  }

  /* ---------- Croquis ---------- */
  const canvas = el.mapCanvas;
  const ctx = canvas.getContext("2d");
  const pointers = new Map();
  let dragState = null;
  let pinchState = null;
  let mapMetrics = null;

  function mapSize() {
    const rect = el.mapStage.getBoundingClientRect();
    return { w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
  }

  function setupCanvas() {
    const { w, h } = mapSize();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const pixelW = Math.max(1, Math.round(w * dpr));
    const pixelH = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { w, h };
  }

  function ensureRef() {
    if (state.ref) return state.ref;
    if (state.points.length) {
      state.ref = centroid(state.points);
      return state.ref;
    }
    return DEMO_REF;
  }

  function niceStep(raw) {
    const power = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1e-6))));
    const value = raw / power;
    const multiplier = value <= 1.5 ? 1 : value <= 3.5 ? 2 : value <= 7.5 ? 5 : 10;
    return multiplier * power;
  }

  function fitView(w, h) {
    const ref = ensureRef();
    if (!state.points.length) {
      view.cx = 0;
      view.cy = 0;
      view.scale = clamp(Math.min(w, h) / 300, 0.15, 8);
      return;
    }
    const locals = state.points.map((point) => latLonToLocal(point, ref));
    const xs = locals.map((point) => point.x);
    const ys = locals.map((point) => point.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max(54, Math.min(90, Math.min(w, h) * 0.13));
    const spanX = Math.max(maxX - minX, 45);
    const spanY = Math.max(maxY - minY, 45);
    view.scale = clamp(Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY), 0.02, 26);
    view.cx = (minX + maxX) / 2;
    view.cy = (minY + maxY) / 2;
  }

  function toScreen(point, ref, w, h) {
    const local = latLonToLocal(point, ref);
    return {
      x: (local.x - view.cx) * view.scale + w / 2,
      y: h / 2 - (local.y - view.cy) * view.scale,
    };
  }

  // Mantiene la escala y desplaza el croquis solo lo imprescindible para que
  // el nuevo vértice no quede fuera de la vista. Evita el zoom brusco que
  // producía "saltar" el plano al añadir coordenadas o puntos GPS.
  function ensurePointVisible(point, margin = 48) {
    const { w, h } = mapSize();
    if (w < 2 || h < 2) return;
    const screen = toScreen(point, ensureRef(), w, h);
    const pad = Math.min(margin, Math.min(w, h) * 0.2);
    let dx = 0;
    let dy = 0;
    if (screen.x < pad) dx = pad - screen.x;
    else if (screen.x > w - pad) dx = (w - pad) - screen.x;
    if (screen.y < pad) dy = pad - screen.y;
    else if (screen.y > h - pad) dy = (h - pad) - screen.y;
    if (!dx && !dy) return;
    view.cx -= dx / view.scale;
    view.cy += dy / view.scale;
  }

  function screenToLocal(x, y, w, h) {
    return {
      x: view.cx + (x - w / 2) / view.scale,
      y: view.cy - (y - h / 2) / view.scale,
    };
  }

  function pathPolygon(points, close = true) {
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    if (close) ctx.closePath();
  }

  function haloText(text, x, y, font, color, align = "center", baseline = "middle") {
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = "rgba(251, 249, 242, 0.92)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function roundRectPath(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawGrid(w, h) {
    const gradient = ctx.createRadialGradient(w * 0.48, h * 0.42, 0, w * 0.48, h * 0.42, Math.max(w, h) * 0.8);
    gradient.addColorStop(0, "#fdfbf5");
    gradient.addColorStop(1, "#f6f1e3");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  }

  function lonToScreenX(lon, ref, w) {
    const local = (lon - ref.lon) * DEG * EARTH_R * Math.cos(ref.lat * DEG);
    return (local - view.cx) * view.scale + w / 2;
  }

  function latToScreenY(lat, ref, h) {
    const local = (lat - ref.lat) * DEG * EARTH_R;
    return h / 2 - (local - view.cy) * view.scale;
  }

  function drawGraticule(w, h, ref) {
    const targetPx = w < 520 ? 86 : 104;
    const latDegPerPx = 1 / (EARTH_R * DEG * view.scale);
    const lonDegPerPx = 1 / (EARTH_R * DEG * Math.cos(ref.lat * DEG) * view.scale);
    const step = niceStep(Math.max(latDegPerPx, lonDegPerPx) * targetPx);
    const metres = step * EARTH_R * DEG;
    mapGridInfo = { step, metres };
    if (!gridOn) return;

    const cosLat = Math.cos(ref.lat * DEG);
    const lonLeft = ref.lon + ((0 - w / 2) / view.scale + view.cx) / (DEG * EARTH_R * cosLat);
    const lonRight = ref.lon + ((w - w / 2) / view.scale + view.cx) / (DEG * EARTH_R * cosLat);
    const latBottom = ref.lat + ((view.cy - h / (2 * view.scale))) / (EARTH_R * DEG);
    const latTop = ref.lat + ((view.cy + h / (2 * view.scale))) / (EARTH_R * DEG);

    const lonStart = Math.ceil(lonLeft / step);
    const lonEnd = Math.floor(lonRight / step);
    const latStart = Math.ceil(latBottom / step);
    const latEnd = Math.floor(latTop / step);

    ctx.save();
    ctx.strokeStyle = "rgba(29, 106, 75, 0.17)";
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = lonStart; i <= lonEnd; i += 1) {
      const x = lonToScreenX(i * step, ref, w);
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let i = latStart; i <= latEnd; i += 1) {
      const y = latToScreenY(i * step, ref, h);
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
    ctx.restore();

    if (!gridOn || w < 560) return;

    const secondsDigits = step < 0.001 ? 1 : 0;
    ctx.save();
    for (let i = lonStart; i <= lonEnd; i += 1) {
      const lon = i * step;
      const x = lonToScreenX(lon, ref, w);
      if (x < 248 || x > w - 66) continue;
      haloText(formatCoordDms(lon, false, secondsDigits), x, 12, "600 8px 'Cascadia Mono', Consolas, monospace", "#557563");
    }
    for (let i = latStart; i <= latEnd; i += 1) {
      const lat = i * step;
      const y = latToScreenY(lat, ref, h);
      if (y < 52 || y > h - 58) continue;
      haloText(formatCoordDms(lat, true, secondsDigits), 7, y, "600 8px 'Cascadia Mono', Consolas, monospace", "#557563", "left");
    }
    ctx.restore();
  }

  function drawCenterReference(w, h, ref) {
    if (!gridOn || !state.points.length) return;
    const center = centroid(state.points);
    const point = toScreen(center, ref, w, h);
    if (point.x < -20 || point.x > w + 20 || point.y < -20 || point.y > h + 20) return;
    ctx.save();
    ctx.strokeStyle = "#b47c22";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(point.x - 10.5, point.y);
    ctx.lineTo(point.x - 3.5, point.y);
    ctx.moveTo(point.x + 3.5, point.y);
    ctx.lineTo(point.x + 10.5, point.y);
    ctx.moveTo(point.x, point.y - 10.5);
    ctx.lineTo(point.x, point.y - 3.5);
    ctx.moveTo(point.x, point.y + 3.5);
    ctx.lineTo(point.x, point.y + 10.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 1.7, 0, Math.PI * 2);
    ctx.fillStyle = "#b47c22";
    ctx.fill();
    ctx.restore();
    haloText("REF", point.x + 13, point.y - 12, "700 8px 'Segoe UI', sans-serif", "#8a5a12", "left");
  }

  function drawCoordinateOverlay(w, h) {
    if (!gridOn || !state.points.length) return;
    const center = centroid(state.points);
    const compact = w < 520;
    const boxW = compact ? 170 : 208;
    const boxH = 58;
    const x = w - boxW - 10;
    const y = h - boxH - 10;

    ctx.save();
    ctx.shadowColor = "rgba(18, 63, 44, 0.16)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgba(255, 253, 246, 0.94)";
    roundRectPath(ctx, x, y, boxW, boxH, 6);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(74, 89, 76, 0.24)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#b47c22";
    ctx.beginPath();
    ctx.arc(x + 11, y + 13, 2.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "700 7.5px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#6e7b6f";
    ctx.fillText("UBICACIÓN DEL PLANO", x + 18, y + 16);

    ctx.font = `600 ${compact ? 8.5 : 9}px 'Cascadia Mono', Consolas, monospace`;
    ctx.fillStyle = "#264d36";
    ctx.fillText(formatCoordDms(center.lat, true, 1), x + 10, y + 32);
    ctx.fillText(formatCoordDms(center.lon, false, 1), x + 10, y + 44);

    ctx.font = "500 7.5px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#6e7b6f";
    ctx.fillText("Centro del predio · WGS 84", x + 10, y + 54);
    ctx.restore();
  }

  function drawCompass(w) {
    const cx = w - 31;
    const cy = 31;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 15, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 253, 246, 0.88)";
    ctx.fill();
    ctx.strokeStyle = "rgba(74, 89, 76, 0.28)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx + 4.6, cy + 5);
    ctx.lineTo(cx, cy + 2.2);
    ctx.lineTo(cx - 4.6, cy + 5);
    ctx.closePath();
    ctx.fillStyle = "#1d6a4b";
    ctx.fill();
    ctx.font = "700 8px 'Segoe UI', sans-serif";
    ctx.fillStyle = "#6e7b6f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("N", cx, cy - 20);
    ctx.restore();
  }

  function drawScaleBar(w, h) {
    const targetPx = Math.min(112, Math.max(70, w * 0.17));
    const metres = niceStep(targetPx / view.scale);
    const px = metres * view.scale;
    const x = 18;
    const y = h - 21;
    ctx.save();
    ctx.fillStyle = "rgba(255, 253, 246, 0.84)";
    roundRectPath(ctx, x - 8, y - 26, px + 26, 34, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(74, 89, 76, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.strokeStyle = "#3f5445";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x, y + 4);
    ctx.moveTo(x + px, y - 4);
    ctx.lineTo(x + px, y + 4);
    ctx.stroke();

    ctx.font = "600 9px 'Cascadia Mono', Consolas, monospace";
    ctx.fillStyle = "#556455";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(`${fmt(metres, metres < 10 ? 1 : 0)} m`, x, y - 8);
    ctx.restore();
  }

  function drawGpsFix(w, h, ref) {
    if (!gps.lastFix || !(gps.active || gps.paused) || state.method !== "gps") return;
    const point = toScreen(gps.lastFix, ref, w, h);
    const radius = clamp((gps.lastFix.accuracy || 0) * view.scale, 6, 150);
    ctx.save();
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(47, 111, 169, 0.08)";
    ctx.fill();
    ctx.strokeStyle = "rgba(47, 111, 169, 0.32)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.6, 0, Math.PI * 2);
    ctx.fillStyle = "#2f6fa9";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#fdfbf5";
    ctx.stroke();
    ctx.restore();
  }

  function paintMap(metrics) {
    const { w, h } = setupCanvas();
    lastMapW = w;
    lastMapH = h;
    if (view.autoFit) fitView(w, h);
    drawGrid(w, h);

    const ref = ensureRef();
    drawGraticule(w, h, ref);
    const points = state.points.map((point) => toScreen(point, ref, w, h));
    const n = points.length;
    const screenCenter = n
      ? { x: points.reduce((sum, p) => sum + p.x, 0) / n, y: points.reduce((sum, p) => sum + p.y, 0) / n }
      : { x: w / 2, y: h / 2 };

    if (n >= 3) {
      pathPolygon(points, true);
      const fill = ctx.createLinearGradient(0, 0, w, h);
      fill.addColorStop(0, "rgba(44, 125, 89, 0.18)");
      fill.addColorStop(1, "rgba(180, 124, 34, 0.09)");
      ctx.save();
      ctx.shadowColor = "rgba(18, 63, 44, 0.16)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
      pathPolygon(points, true);
      ctx.strokeStyle = "#1d6a4b";
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      ctx.stroke();
    } else if (n === 2) {
      pathPolygon(points, false);
      ctx.strokeStyle = "#1d6a4b";
      ctx.lineWidth = 2.2;
      ctx.stroke();
    }

    if (labelsOn && n >= 3 && n <= 20) {
      for (let i = 0; i < n; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        let nx = mid.x - screenCenter.x;
        let ny = mid.y - screenCenter.y;
        const length = Math.hypot(nx, ny) || 1;
        nx /= length;
        ny /= length;
        const side = metrics.sides[i];
        if (!side || side.distance < 0.5) continue;
        haloText(`${fmt(side.distance, 2)} m`, mid.x + nx * 14, mid.y + ny * 14, "600 9.5px 'Cascadia Mono', Consolas, monospace", "#3e5547");
      }
    }

    if (labelsOn && n <= 24) {
      points.forEach((point, index) => {
        let dx = point.x - screenCenter.x;
        let dy = point.y - screenCenter.y;
        const length = Math.hypot(dx, dy) || 1;
        dx /= length;
        dy /= length;
        haloText(vertexLabel(index), point.x + dx * 14, point.y + dy * 14, "600 10.5px 'Palatino Linotype', Georgia, serif", "#264d36");
      });
    }

    points.forEach((point) => {
      ctx.save();
      ctx.beginPath();
      ctx.arc(point.x, point.y, n > 24 ? 3 : 4.3, 0, Math.PI * 2);
      ctx.fillStyle = "#fffdf6";
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = "#1d6a4b";
      ctx.stroke();
      ctx.restore();
    });

    if (n === 1) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(29, 106, 75, 0.14)";
      ctx.fill();
      ctx.restore();
    }

    drawGpsFix(w, h, ref);
    drawCenterReference(w, h, ref);
    drawCompass(w);
    drawScaleBar(w, h);
    drawCoordinateOverlay(w, h);
  }

  function renderMap(metrics) {
    mapMetrics = metrics;
    const n = metrics.n;
    setText(el.mapSubtitle, n
      ? `${n} ${n === 1 ? "vértice" : "vértices"} · ${methodLabel()}`
      : "Sin medición · elige un método");
    setText(el.mapArea, n >= 3 ? `${fmt(metrics.areaHa, 4)} ha` : "—");
    setText(el.mapPerimeter, n >= 2 ? `${fmt(metrics.perimeter, 2)} m de perímetro` : "Sin perímetro");
    if (el.mapWarning.hidden === metrics.intersects) el.mapWarning.hidden = !metrics.intersects;
    if (el.mapEmpty.hidden === (n > 0)) el.mapEmpty.hidden = n > 0;

    if (n) {
      const c = centroid(state.points);
      setText(el.mapCoords, `Centro ${formatCoordDms(c.lat, true, 1)} · ${formatCoordDms(c.lon, false, 1)} · WGS 84`);
      el.mapCoords.title = `Centroide del predio · WGS 84 (EPSG:4326) · ${fmt(c.lat, 7)}, ${fmt(c.lon, 7)}`;
    } else {
      setText(el.mapCoords, "—");
      el.mapCoords.removeAttribute("title");
    }
    paintMap(metrics);
  }

  function redrawMap() {
    renderMap(computeMetrics());
  }

  function zoomAt(px, py, factor) {
    const { w, h } = mapSize();
    const before = screenToLocal(px, py, w, h);
    view.scale = clamp(view.scale * factor, 0.02, 26);
    view.cx = before.x - (px - w / 2) / view.scale;
    view.cy = before.y + (py - h / 2) / view.scale;
    view.autoFit = false;
    redrawMap();
  }

  function updatePointerReadout(event) {
    if (!state.points.length) return;
    const ref = ensureRef();
    const rect = canvas.getBoundingClientRect();
    const local = screenToLocal(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
    const geo = localToLatLon(local.x, local.y, ref);
    el.mapCoords.textContent = `Puntero ${formatCoordDms(geo.lat, true, 1)} · ${formatCoordDms(geo.lon, false, 1)} · WGS 84`;
    el.mapCoords.title = `Coordenadas del puntero · WGS 84 (EPSG:4326) · ${fmt(geo.lat, 7)}, ${fmt(geo.lon, 7)}`;
  }

  function resetPointerReadout() {
    if (!state.points.length) {
      el.mapCoords.textContent = "—";
      el.mapCoords.removeAttribute("title");
      return;
    }
    const c = centroid(state.points);
    el.mapCoords.textContent = `Centro ${formatCoordDms(c.lat, true, 1)} · ${formatCoordDms(c.lon, false, 1)} · WGS 84`;
    el.mapCoords.title = `Centroide del predio · WGS 84 (EPSG:4326) · ${fmt(c.lat, 7)}, ${fmt(c.lon, 7)}`;
  }

  function pointerPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function initMapInteractions() {
    canvas.addEventListener("pointerdown", (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      canvas.setPointerCapture(event.pointerId);
      const point = pointerPoint(event);
      pointers.set(event.pointerId, point);
      if (pointers.size === 1) {
        dragState = { x: point.x, y: point.y, cx: view.cx, cy: view.cy, moved: false };
        el.mapStage.classList.add("is-dragging");
      } else if (pointers.size === 2) {
        const [a, b] = Array.from(pointers.values());
        const { w, h } = mapSize();
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        pinchState = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          scale: view.scale,
          anchor: screenToLocal(mid.x, mid.y, w, h),
        };
        dragState = null;
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, pointerPoint(event));
      const { w, h } = mapSize();

      if (pinchState && pointers.size >= 2) {
        const [a, b] = Array.from(pointers.values());
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchState.distance > 0) {
          view.scale = clamp(pinchState.scale * (distance / pinchState.distance), 0.02, 26);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          view.cx = pinchState.anchor.x - (mid.x - w / 2) / view.scale;
          view.cy = pinchState.anchor.y + (mid.y - h / 2) / view.scale;
          view.autoFit = false;
          redrawMap();
        }
        return;
      }

      if (dragState && pointers.size === 1) {
        const current = pointers.get(event.pointerId);
        if (!current) return;
        const dx = current.x - dragState.x;
        const dy = current.y - dragState.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) dragState.moved = true;
        view.cx = dragState.cx - dx / view.scale;
        view.cy = dragState.cy + dy / view.scale;
        view.autoFit = false;
        redrawMap();
        return;
      }

      updatePointerReadout(event);
    });

    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchState = null;
      if (pointers.size === 0) {
        dragState = null;
        el.mapStage.classList.remove("is-dragging");
      }
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("pointerleave", () => {
      if (!pointers.size) resetPointerReadout();
    });

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const point = pointerPoint(event);
      const factor = Math.exp(-event.deltaY * 0.0016);
      zoomAt(point.x, point.y, factor);
    }, { passive: false });

    canvas.addEventListener("dblclick", () => {
      view.autoFit = true;
      redrawMap();
    });

    el.mapStage.addEventListener("click", (event) => {
      const button = event.target.closest("[data-map]");
      if (!button) return;
      const action = button.dataset.map;
      if (action === "undo") undo();
      if (action === "redo") redo();
      if (action === "fit") {
        view.autoFit = true;
        redrawMap();
      }
      if (action === "labels") {
        labelsOn = !labelsOn;
        updateHistoryButtons();
        redrawMap();
      }
      if (action === "grid") {
        gridOn = !gridOn;
        updateHistoryButtons();
        redrawMap();
      }
      if (action === "zoom-in" || action === "zoom-out") {
        const { w, h } = mapSize();
        zoomAt(w / 2, h / 2, action === "zoom-in" ? 1.35 : 1 / 1.35);
      }
    });

    const scheduleResizeRedraw = () => {
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        const { w, h } = mapSize();
        if (Math.abs(w - lastMapW) < 0.5 && Math.abs(h - lastMapH) < 0.5) return;
        redrawMap();
      });
    };

    if ("ResizeObserver" in window) {
      const observer = new ResizeObserver(scheduleResizeRedraw);
      observer.observe(el.mapStage);
    } else {
      window.addEventListener("resize", scheduleResizeRedraw);
    }
  }

  /* ---------- GPS ---------- */

  function formatDuration(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function elapsedMs() {
    return gps.elapsed + (gps.active ? Date.now() - gps.segmentStart : 0);
  }

  function updateTimer() {
    setText(el.gpsTimer, formatDuration(elapsedMs()));
  }

  function startTimer() {
    window.clearInterval(gps.timer);
    gps.timer = window.setInterval(updateTimer, 1000);
    updateTimer();
  }

  function stopTimer() {
    window.clearInterval(gps.timer);
    gps.timer = null;
    updateTimer();
  }

  function setGpsStatus(kind, title, text) {
    const className = `gps-status${kind ? ` is-${kind}` : ""}`;
    if (el.gpsStatus.className !== className) el.gpsStatus.className = className;
    setText(el.gpsStatusTitle, title);
    setText(el.gpsStatusText, text);
  }

  function updateAccuracyPill() {
    setText(el.gpsAccuracy, gps.lastFix && Number.isFinite(gps.lastFix.accuracy)
      ? `± ${fmt(gps.lastFix.accuracy, 1)} m`
      : "± — m");
  }

  function updateGpsButtons() {
    setText(el.gpsToggleText, gps.active ? "Pausar" : gps.paused ? "Reanudar" : "Iniciar recorrido");
    el.gpsToggleIcon.setAttribute("href", gps.active ? "#i-pause" : "#i-play");
    el.gpsFinish.disabled = !(gps.active || gps.paused);
    updateAccuracyPill();
    updateTimer();
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !gps.wakeLock) {
        gps.wakeLock = await navigator.wakeLock.request("screen");
        gps.wakeLock.addEventListener("release", () => {
          gps.wakeLock = null;
        });
      }
    } catch (error) {
      /* Sin wake lock: no es crítico. */
    }
  }

  function releaseWakeLock() {
    try {
      if (gps.wakeLock) gps.wakeLock.release();
    } catch (error) {
      /* Ignorar. */
    }
    gps.wakeLock = null;
  }

  function stopGpsWatch() {
    if (gps.watchId !== null) {
      navigator.geolocation.clearWatch(gps.watchId);
      gps.watchId = null;
    }
  }

  function stopGpsForManual() {
    if (!(gps.active || gps.paused)) return;
    if (gps.active) gps.elapsed += Date.now() - gps.segmentStart;
    gps.active = false;
    gps.paused = false;
    stopGpsWatch();
    stopTimer();
    releaseWakeLock();
    setGpsStatus("", "GPS en espera", "Recorrido detenido. Puedes iniciarlo de nuevo cuando quieras.");
  }

  function beginGpsWatch() {
    if (!navigator.geolocation || gps.watchId !== null) return;
    try {
      gps.watchId = navigator.geolocation.watchPosition(onGpsFix, onGpsError, {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 20000,
      });
    } catch (error) {
      setGpsStatus("error", "GPS no disponible", "Este navegador no permite acceder a la ubicación.");
    }
  }

  function addGpsPoint(lat, lon, accuracy) {
    const next = [...state.points, { lat, lon, acc: Number.isFinite(accuracy) ? accuracy : null }];
    applyPoints(next, "gps", { fit: false, follow: { lat, lon } });
    if (navigator.vibrate) navigator.vibrate(35);
    const metrics = computeMetrics();
    const minDistance = Math.max(2, parseDecimal(el.gpsMinDistance.value) || 3);
    const nearStart = metrics.n >= 3 && haversine(state.points[0], state.points[state.points.length - 1]) < minDistance;
    setGpsStatus(
      "live",
      nearStart ? "De vuelta al inicio" : `Recorriendo · ${metrics.n} puntos`,
      nearStart
        ? "Estás cerca del punto de partida. Pulsa Finalizar para cerrar el recorrido."
        : `Último punto ± ${fmt(accuracy, 1)} m. Sigue el lindero y marca cada esquina.`
    );
  }

  function onGpsFix(position) {
    if (!(gps.active || gps.paused)) return;
    const coords = position.coords;
    gps.lastFix = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
    };
    updateAccuracyPill();

    if (gps.paused) {
      redrawMap();
      return;
    }

    const threshold = clamp(parseDecimal(el.gpsThreshold.value) || 8, 0.5, 100);
    const minDistance = clamp(parseDecimal(el.gpsMinDistance.value) || 3, 0.5, 100);
    const accuracy = gps.lastFix.accuracy;

    if (!Number.isFinite(accuracy) || accuracy > threshold) {
      gps.rejected += 1;
      const shown = Number.isFinite(accuracy) ? `± ${fmt(accuracy, 1)} m` : "sin dato";
      setGpsStatus(
        "warn",
        "Esperando mejor precisión",
        `Señal actual ${shown}; necesitas ≤ ± ${fmt(threshold, 0)} m. Busca un lugar abierto y espera unos segundos.`
      );
      redrawMap();
      return;
    }

    if (!state.points.length) {
      addGpsPoint(gps.lastFix.lat, gps.lastFix.lon, accuracy);
      setGpsStatus("live", "Punto de inicio registrado", `Precisión ± ${fmt(accuracy, 1)} m. Camina por el lindero.`);
      return;
    }

    const first = state.points[0];
    const current = { lat: gps.lastFix.lat, lon: gps.lastFix.lon };
    if (state.points.length >= 3 && haversine(first, current) < minDistance * 0.7) {
      setGpsStatus("live", "Recorrido completo", "Estás en el punto de inicio. Pulsa Finalizar para cerrar el croquis.");
      redrawMap();
      return;
    }

    const last = state.points[state.points.length - 1];
    const distance = haversine(last, current);
    if (distance < minDistance) {
      setGpsStatus(
        "live",
        `Recorriendo · ${state.points.length} puntos`,
        `Avanzaste ${fmt(distance, 1)} m. El próximo vértice se marca a los ${fmt(minDistance, 0)} m.`
      );
      redrawMap();
      return;
    }

    addGpsPoint(current.lat, current.lon, accuracy);
  }

  function onGpsError(error) {
    const messages = {
      1: ["Permiso denegado", "Autoriza la ubicación en el navegador. Si abriste el archivo directamente, sirve la app por HTTPS o localhost."],
      2: ["Sin señal GPS", "No se pudo obtener la posición. Sal a un espacio abierto o espera unos segundos."],
      3: ["GPS lento", "La señal tardó demasiado. Seguimos intentando; mantén el teléfono con vista al cielo."],
    };
    const [title, text] = messages[error.code] || ["Error de GPS", "No se pudo leer la ubicación."];
    if (error.code === 1) {
      stopGpsWatch();
      if (gps.active) gps.elapsed += Date.now() - gps.segmentStart;
      gps.active = false;
      gps.paused = false;
      stopTimer();
      releaseWakeLock();
      setGpsStatus("error", title, text);
      showToast("Permiso de ubicación denegado.");
    } else {
      setGpsStatus("warn", title, text);
    }
    render();
  }

  async function startGps() {
    if (!navigator.geolocation) {
      setGpsStatus("error", "GPS no disponible", "Este navegador no tiene acceso a la ubicación.");
      showToast("Este navegador no soporta geolocalización.");
      return;
    }
    if (state.points.length) {
      const ok = await askConfirm(
        "Nuevo recorrido GPS",
        "El croquis actual se reemplazará por el nuevo recorrido. Puedes deshacerlo después.",
        "Iniciar recorrido"
      );
      if (!ok) return;
    }

    stopGpsWatch();
    gps.active = false;
    gps.paused = false;
    gps.lastFix = null;
    gps.elapsed = 0;
    gps.segmentStart = Date.now();
    gps.rejected = 0;
    applyPoints([], "gps", { ref: null, fit: true });
    gps.active = true;
    startTimer();
    requestWakeLock();
    setGpsStatus("warn", "Buscando señal GPS…", "Mantén el teléfono con vista al cielo. El primer punto se marca al tener buena precisión.");
    render();
    beginGpsWatch();
  }

  function pauseGps() {
    if (!gps.active) return;
    gps.elapsed += Date.now() - gps.segmentStart;
    gps.active = false;
    gps.paused = true;
    stopGpsWatch();
    stopTimer();
    releaseWakeLock();
    setGpsStatus("", "Recorrido en pausa", "Puedes reanudar cuando quieras; los puntos ya registrados se conservan.");
    render();
  }

  function resumeGps() {
    if (!gps.paused) return;
    gps.paused = false;
    gps.active = true;
    gps.segmentStart = Date.now();
    startTimer();
    requestWakeLock();
    setGpsStatus("warn", "Buscando señal GPS…", "Retomando el recorrido. Espera una buena precisión antes de avanzar.");
    render();
    beginGpsWatch();
  }

  function finishGps() {
    if (!(gps.active || gps.paused)) return;
    if (gps.active) gps.elapsed += Date.now() - gps.segmentStart;
    gps.active = false;
    gps.paused = false;
    stopGpsWatch();
    stopTimer();
    releaseWakeLock();
    const metrics = computeMetrics();
    if (metrics.n >= 3) {
      setGpsStatus(
        "live",
        `Recorrido finalizado · ${metrics.n} puntos`,
        `${fmt(metrics.areaHa, 4)} ha medidas. Puedes simplificar el recorrido para quitar puntos redundantes.`
      );
    } else {
      setGpsStatus("warn", "Recorrido incompleto", "Necesitas al menos 3 puntos para calcular una superficie.");
      showToast("El recorrido necesita al menos 3 puntos.");
    }
    render();
  }

  function simplifyGps() {
    if (state.method !== "gps" || state.points.length <= 4) return;
    const metrics = computeMetrics();
    const tolerance = clamp(Math.max(1.2, (metrics.avgAcc || 2) * 0.65), 1.2, 6);
    const simplified = simplifyPoints(state.points, tolerance);
    if (simplified.length < 3 || simplified.length >= state.points.length) {
      showToast("No se encontraron puntos redundantes para quitar.");
      return;
    }
    const removed = state.points.length - simplified.length;
    applyPoints(simplified, "gps", { fit: true });
    setGpsStatus("live", "Recorrido simplificado", `Se quitaron ${removed} puntos redundantes. Revisa que el croquis mantenga las esquinas.`);
    showToast(`${removed} ${removed === 1 ? "punto eliminado" : "puntos eliminados"}.`);
  }

  async function handleGpsToggle() {
    if (gps.active) pauseGps();
    else if (gps.paused) resumeGps();
    else await startGps();
  }

  /* ---------- Linderos ---------- */

  function readShape() {
    const parseInput = (selector) => parseDecimal($(selector).value);
    if (shapeType === "quad") {
      const ab = parseInput('[data-quad="ab"]');
      const bc = parseInput('[data-quad="bc"]');
      const cd = parseInput('[data-quad="cd"]');
      const da = parseInput('[data-quad="da"]');
      const ac = parseInput('[data-quad="ac"]');
      if (![ab, bc, cd, da, ac].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error("Completa los cuatro lados y la diagonal con valores mayores que cero.");
      }
      if (!triangleValid(ab, bc, ac)) {
        throw new Error("La diagonal A–C no cierra el triángulo A–B–C. Revisa los lados A–B, B–C y la diagonal.");
      }
      if (!triangleValid(cd, da, ac)) {
        throw new Error("La diagonal A–C no cierra el triángulo A–C–D. Revisa los lados C–D, D–A y la diagonal.");
      }
      const xB = (ab * ab + ac * ac - bc * bc) / (2 * ac);
      const yB = Math.sqrt(Math.max(0, ab * ab - xB * xB));
      const xD = (da * da + ac * ac - cd * cd) / (2 * ac);
      const yD = -Math.sqrt(Math.max(0, da * da - xD * xD));
      return {
        name: "Cuadrilátero",
        locals: centerLocals([[0, 0], [xB, yB], [ac, 0], [xD, yD]]),
        area: heron(ab, bc, ac) + heron(cd, da, ac),
        perimeter: ab + bc + cd + da,
      };
    }
    if (shapeType === "triangle") {
      const ab = parseInput('[data-tri="ab"]');
      const bc = parseInput('[data-tri="bc"]');
      const ca = parseInput('[data-tri="ca"]');
      if (![ab, bc, ca].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error("Ingresa los tres lados con valores mayores que cero.");
      }
      if (!triangleValid(ab, bc, ca)) {
        throw new Error("Esos tres lados no forman un triángulo. La suma de dos lados debe superar al tercero.");
      }
      const xC = (ca * ca + ab * ab - bc * bc) / (2 * ab);
      const yC = Math.sqrt(Math.max(0, ca * ca - xC * xC));
      return {
        name: "Triángulo",
        locals: centerLocals([[0, 0], [ab, 0], [xC, yC]]),
        area: heron(ab, bc, ca),
        perimeter: ab + bc + ca,
      };
    }
    if (shapeType === "rect") {
      const width = parseInput('[data-rect="width"]');
      const height = parseInput('[data-rect="height"]');
      if (![width, height].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error("Ingresa el frente y el fondo con valores mayores que cero.");
      }
      return {
        name: "Rectángulo",
        locals: [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]],
        area: width * height,
        perimeter: 2 * (width + height),
      };
    }
    const radius = parseInput('[data-circle="radius"]');
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new Error("Ingresa un radio mayor que cero.");
    }
    const circle = circleShape(radius);
    return {
      name: "Círculo",
      locals: circle.locals,
      area: circle.area,
      perimeter: circle.perimeter,
    };
  }

  function centerLocals(locals) {
    const cx = locals.reduce((sum, point) => sum + point[0], 0) / locals.length;
    const cy = locals.reduce((sum, point) => sum + point[1], 0) / locals.length;
    return locals.map(([x, y]) => [x - cx, y - cy]);
  }

  // Un círculo se dibuja como un polígono regular. Ajustamos su radio para que
  // el área del polígono coincida con la del círculo ingresado: así la vista
  // previa y la superficie medida no difieren por la aproximación.
  function circleShape(radius, segments = CIRCLE_SEGMENTS) {
    const n = Math.max(8, Math.round(segments));
    const step = (Math.PI * 2) / n;
    const adjustedRadius = radius * Math.sqrt((Math.PI * 2) / (n * Math.sin(step)));
    const locals = [];
    for (let i = 0; i < n; i += 1) {
      const angle = i * step;
      locals.push([Math.cos(angle) * adjustedRadius, Math.sin(angle) * adjustedRadius]);
    }
    return {
      locals,
      area: Math.PI * radius * radius,
      perimeter: 2 * n * adjustedRadius * Math.sin(Math.PI / n),
    };
  }

  function updateShapePreview() {
    try {
      const shape = readShape();
      el.shapeArea.textContent = `${fmt(shape.area / 10000, 4)} ha`;
      el.shapePerimeter.textContent = `${fmt(shape.perimeter, 2)} m`;
      el.shapeErrors.hidden = true;
      el.shapeApply.disabled = false;
      return shape;
    } catch (error) {
      el.shapeArea.textContent = "—";
      el.shapePerimeter.textContent = "—";
      el.shapeErrors.textContent = error.message;
      el.shapeErrors.hidden = false;
      el.shapeApply.disabled = true;
      return null;
    }
  }

  function readOrigin() {
    const latText = el.originLat.value.trim();
    const lonText = el.originLon.value.trim();
    if (!latText && !lonText) return state.ref ? { ...state.ref } : { ...DEMO_REF };
    const lat = parseDecimal(latText);
    const lon = parseDecimal(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      throw new Error("Completa la latitud y la longitud del plano, o deja ambas casillas vacías.");
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      throw new Error("La latitud debe estar entre -90 y 90; la longitud, entre -180 y 180.");
    }
    return { lat, lon };
  }

  function applyShape() {
    const shape = readShape();
    let origin;
    try {
      origin = readOrigin();
    } catch (error) {
      el.shapeErrors.textContent = error.message;
      el.shapeErrors.hidden = false;
      return;
    }
    const points = pointsFromLocal(shape.locals, origin);
    applyPoints(points, "linderos", { ref: origin, fit: true });
    showToast(`${shape.name} de ${fmt(shape.area / 10000, 4)} ha dibujado en ${formatCoordDms(origin.lat, true, 1)}, ${formatCoordDms(origin.lon, false, 1)}.`);
  }

  function useGpsForOrigin() {
    if (!navigator.geolocation) {
      showToast("Este navegador no tiene acceso a la ubicación.");
      return;
    }
    const label = el.originGps.innerHTML;
    el.originGps.disabled = true;
    el.originGps.textContent = "Ubicando…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        el.originLat.value = fmt(position.coords.latitude, 7);
        el.originLon.value = fmt(position.coords.longitude, 7);
        el.originGps.disabled = false;
        el.originGps.innerHTML = label;
        showToast(`Ubicación capturada (± ${fmt(position.coords.accuracy, 1)} m). Pulsa Dibujar para aplicar.`);
      },
      () => {
        el.originGps.disabled = false;
        el.originGps.innerHTML = label;
        showToast("No se pudo obtener la ubicación. Revisa el permiso de GPS.");
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function setShapeType(type) {
    shapeType = type;
    el.shapeTabs.forEach((button) => button.classList.toggle("is-active", button.dataset.shape === type));
    el.shapeFields.forEach((field) => {
      field.hidden = field.dataset.shapeFields !== type;
    });
    updateShapePreview();
  }

  function loadExample() {
    const demo = createDemoState();
    if (!state.projectName || state.projectName === "Predio sin nombre") {
      state.projectName = demo.projectName;
      el.projectName.value = demo.projectName;
    }
    applyPoints(demo.points, "demo", { ref: demo.ref, fit: true });
    setGpsStatus("", "Ejemplo cargado", "El croquis es demostrativo. Sustitúyelo con tu propia medición.");
    showToast(`Ejemplo demostrativo de ${fmt(computeMetrics().areaHa, 4)} ha cargado. Sustitúyelo con tu propia medición.`);
  }

  /* ---------- Coordenadas ---------- */

  function coordsError(message) {
    el.coordError.textContent = message;
    el.coordError.hidden = !message;
  }

  function addCoordinate() {
    const lat = parseDecimal(el.coordLat.value);
    const lon = parseDecimal(el.coordLon.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      coordsError("Escribe una latitud y una longitud válidas.");
      return;
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      coordsError("La latitud debe estar entre -90 y 90; la longitud, entre -180 y 180.");
      return;
    }
    coordsError("");
    const point = { lat, lon, acc: null };
    const next = [...state.points, point];
    applyPoints(next, "coords", { ref: centroid(next), fit: false, follow: point });
    el.coordLat.value = "";
    el.coordLon.value = "";
    el.coordLat.focus({ preventScroll: true });
    showToast(`Vértice ${vertexLabel(state.points.length - 1)} añadido.`);
  }

  function useGpsForCoordinate() {
    if (!navigator.geolocation) {
      coordsError("Este navegador no tiene acceso a la ubicación.");
      return;
    }
    const label = el.coordLocate.querySelector("span");
    el.coordLocate.disabled = true;
    label.textContent = "Ubicando…";
    navigator.geolocation.getCurrentPosition(
      (position) => {
        el.coordLat.value = fmt(position.coords.latitude, 7);
        el.coordLon.value = fmt(position.coords.longitude, 7);
        coordsError("");
        showToast(`Ubicación capturada (± ${fmt(position.coords.accuracy, 1)} m). Revisa y añade el vértice.`);
        el.coordLocate.disabled = false;
        label.textContent = "Usar mi GPS";
      },
      () => {
        coordsError("No se pudo obtener la ubicación. Revisa el permiso de GPS.");
        el.coordLocate.disabled = false;
        label.textContent = "Usar mi GPS";
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  function parseCoordinateLine(line) {
    let clean = line.replace(/#.*$/, "").trim();
    if (!clean) return null;
    if (/^(lat|latitude|latitud)\b/i.test(clean)) return null;
    if (/^(v[eé]rtice|punto|point)\b/i.test(clean)) return null;
    // Encabezados como "Vértice, Latitud, Longitud" no contienen dígitos.
    if (!/\d/.test(clean) && /(lat|lon)/i.test(clean)) return null;
    // Permite una etiqueta inicial ("A, ...", "Punto 1; ...") al pegar desde
    // una planilla. Las coordenadas siempre empiezan con signo, dígito o coma.
    clean = clean.replace(/^[^\d+\-.,\s][^,;]*[,;]\s*/, "");
    if (!clean) return null;
    let parts;
    if (clean.includes(";")) {
      parts = clean.split(";").map((part) => part.trim().replace(/^,+|,+$/g, "")).filter(Boolean);
    } else if (/\s/.test(clean)) {
      parts = clean.split(/\s+/).map((part) => part.trim().replace(/^,+|,+$/g, "")).filter(Boolean);
    } else {
      parts = clean.split(",").map((part) => part.trim()).filter(Boolean);
      if (parts.length === 4) {
        parts = [`${parts[0]},${parts[1]}`, `${parts[2]},${parts[3]}`];
      }
    }
    if (parts.length !== 2) throw new Error("se esperaban dos valores separados");
    const lat = parseDecimal(parts[0]);
    const lon = parseDecimal(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("valores numéricos inválidos");
    if (Math.abs(lat) > 90) throw new Error(`latitud fuera de rango (${fmt(lat, 4)})`);
    if (Math.abs(lon) > 180) throw new Error(`longitud fuera de rango (${fmt(lon, 4)})`);
    return { lat, lon, acc: null };
  }

  function importCoordinates(replace) {
    const lines = el.coordImport.value.split(/\r?\n/);
    const points = [];
    const errors = [];
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const point = parseCoordinateLine(line);
        if (point) points.push(point);
      } catch (error) {
        if (errors.length < 4) errors.push(`Línea ${index + 1}: ${error.message}.`);
      }
    });

    if (errors.length) {
      el.importError.textContent = errors.join(" ");
      el.importError.hidden = false;
      return;
    }
    if (!points.length) {
      el.importError.textContent = "No se encontraron coordenadas válidas.";
      el.importError.hidden = false;
      return;
    }
    if (replace && points.length < 3) {
      el.importError.textContent = "Para reemplazar el croquis necesitas al menos 3 vértices.";
      el.importError.hidden = false;
      return;
    }

    el.importError.hidden = true;
    const next = replace ? points : [...state.points, ...points];
    const ref = centroid(next);
    applyPoints(next, "coords", { ref, fit: true });
    el.coordImport.value = "";
    showToast(`${points.length} ${points.length === 1 ? "vértice importado" : "vértices importados"}.`);
  }

  /* ---------- Exportación y reporte ---------- */

  function exportBaseName() {
    return `campo-verde-jrb-${slugify(state.projectName)}-${dateStamp()}`;
  }

  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCsv() {
    const metrics = computeMetrics();
    if (!metrics.n) {
      showToast("No hay vértices para exportar.");
      return;
    }
    const lines = ["vertice,latitud,longitud,lat_dms,lon_dms,lado_m,rumbo_deg,precision_m"];
    state.points.forEach((point, index) => {
      const side = metrics.sides[index];
      lines.push([
        vertexLabel(index),
        point.lat.toFixed(8),
        point.lon.toFixed(8),
        formatCoordDms(point.lat, true, 1),
        formatCoordDms(point.lon, false, 1),
        side ? side.distance.toFixed(2) : "",
        side ? side.bearing.toFixed(1) : "",
        Number.isFinite(point.acc) ? point.acc.toFixed(1) : "",
      ].map(csvCell).join(","));
    });
    downloadFile(`${exportBaseName()}-vertices.csv`, `\uFEFF${lines.join("\r\n")}\r\n`, "text/csv;charset=utf-8");
    showToast("CSV descargado con los vértices y linderos.");
  }

  function exportKml() {
    const metrics = computeMetrics();
    if (metrics.n < 3) {
      showToast("Necesitas al menos 3 vértices para exportar un polígono.");
      return;
    }
    const center = centroid(state.points);
    const ring = [...state.points, state.points[0]];
    const coordinates = ring.map((point) => `${point.lon.toFixed(8)},${point.lat.toFixed(8)},0`).join(" ");
    const reference = state.refAreaHa
      ? `Referencia: ${fmt(state.refAreaHa, 4)} ha (${state.refSource || "sin fuente"}) · diferencia ${signedHa(metrics.areaHa - state.refAreaHa)}`
      : "Referencia: sin declarar";
    const description = [
      `Superficie: ${fmt(metrics.areaHa, 4)} ha (${fmtInt(metrics.areaM2)} m²)`,
      `Perímetro: ${fmt(metrics.perimeter, 2)} m`,
      `Vértices: ${metrics.n}`,
      `Método: ${methodLabel()}`,
      reference,
      `Centro: ${formatCoordDms(center.lat, true, 1)} ${formatCoordDms(center.lon, false, 1)} · WGS 84`,
      `Huella: ${payloadHash().slice(0, 16)}…`,
    ].join("\n");
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(state.projectName || "Predio")}</name>
    <Placemark>
      <name>${escapeXml(state.projectName || "Predio")}</name>
      <description>${escapeXml(description)}</description>
      <Style>
        <LineStyle><color>ff4b6a1d</color><width>2</width></LineStyle>
        <PolyStyle><color>664b6a1d</color></PolyStyle>
      </Style>
      <Polygon>
        <tessellate>1</tessellate>
        <outerBoundaryIs>
          <LinearRing><coordinates>${coordinates}</coordinates></LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
    downloadFile(`${exportBaseName()}.kml`, kml, "application/vnd.google-earth.kml+xml;charset=utf-8");
    showToast("KML descargado. Ábrelo en Google Earth.");
  }

  function ringSignedArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.lon * b.lat - b.lon * a.lat;
    }
    return sum / 2;
  }

  function repetitionStats() {
    const values = state.repetitions.map((rep) => rep.areaHa);
    if (!values.length) return { n: 0, mean: null, deviation: null, standardError: null, expanded: null, cv: null };
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (values.length < 2) {
      return { n: 1, mean, deviation: null, standardError: null, expanded: null, cv: null };
    }
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
    const deviation = Math.sqrt(Math.max(0, variance));
    const standardError = deviation / Math.sqrt(values.length);
    return {
      n: values.length,
      mean,
      deviation,
      standardError,
      expanded: 2 * standardError,
      cv: mean > 0 ? deviation / mean * 100 : 0,
    };
  }

  function exportGeoJson() {
    const metrics = computeMetrics();
    if (metrics.n < 3) {
      showToast("Necesitas al menos 3 vértices para exportar un polígono.");
      return;
    }
    const center = centroid(state.points);
    const ring = state.points.map((point) => ({ lat: point.lat, lon: point.lon }));
    if (ringSignedArea(ring) < 0) ring.reverse();
    const coordinates = ring.map((point) => [Number(point.lon.toFixed(8)), Number(point.lat.toFixed(8))]);
    coordinates.push(coordinates[0]);
    const stats = repetitionStats();
    const feature = {
      type: "Feature",
      properties: {
        nombre: state.projectName || "Predio",
        metodo: methodLabel(),
        datum: "WGS 84 / EPSG:4326",
        superficie_m2: Number(metrics.areaM2.toFixed(2)),
        superficie_ha: Number(metrics.areaHa.toFixed(4)),
        perimetro_m: Number(metrics.perimeter.toFixed(2)),
        referencia_ha: state.refAreaHa,
        referencia_fuente: state.refSource || null,
        diferencia_ha: state.refAreaHa ? Number((metrics.areaHa - state.refAreaHa).toFixed(4)) : null,
        repeticiones: stats.n,
        incertidumbre_u_ha: stats.expanded !== null ? Number(stats.expanded.toFixed(4)) : null,
        centro_lat: Number(center.lat.toFixed(8)),
        centro_lon: Number(center.lon.toFixed(8)),
        vertices: metrics.n,
        lotes: state.lots.map((lot) => ({ lote: lot.name, cultivo: lot.crop, superficie_ha: lot.areaHa })),
        precision_gps_media_m: metrics.avgAcc !== null ? Number(metrics.avgAcc.toFixed(2)) : null,
        huella_sha256: payloadHash(),
        fecha: new Date().toISOString(),
      },
      geometry: { type: "Polygon", coordinates: [coordinates] },
    };
    const geojson = JSON.stringify({ type: "FeatureCollection", name: state.projectName || "Predio", features: [feature] }, null, 2);
    downloadFile(`${exportBaseName()}.geojson`, geojson, "application/geo+json;charset=utf-8");
    showToast("GeoJSON descargado en WGS 84.");
  }

  function summaryText() {
    const metrics = computeMetrics();
    const center = metrics.n ? centroid(state.points) : null;
    const stats = repetitionStats();
    const lines = [`${APP_NAME} — ${state.projectName || "Predio"}`];
    if (metrics.n >= 3) {
      lines.push(`Superficie: ${fmt(metrics.areaHa, 4)} ha (${fmtInt(metrics.areaM2)} m²)`);
      lines.push(`Perímetro: ${fmt(metrics.perimeter, 2)} m`);
    } else {
      lines.push("Superficie: sin datos (faltan vértices)");
      lines.push(`Perímetro: ${fmt(metrics.perimeter, 2)} m`);
    }
    if (center) lines.push(`Centro: ${formatCoordDms(center.lat, true, 1)} ${formatCoordDms(center.lon, false, 1)} · WGS 84 (${fmt(center.lat, 6)}, ${fmt(center.lon, 6)})`);
    if (state.refAreaHa && metrics.n >= 3) {
      const diff = metrics.areaHa - state.refAreaHa;
      lines.push(`Referencia: ${fmt(state.refAreaHa, 4)} ha (${state.refSource || "sin fuente"}) · diferencia ${signedHa(diff)} · ${fmt(diff / state.refAreaHa * 100, 2)} %`);
    } else if (state.refAreaHa) {
      lines.push(`Referencia: ${fmt(state.refAreaHa, 4)} ha (${state.refSource || "sin fuente"})`);
    }
    if (stats.n >= 2) lines.push(`Incertidumbre: ${fmt(stats.mean, 4)} ± ${fmt(stats.expanded, 4)} ha (U 95 %, n = ${stats.n})`);
    if (state.lots.length) {
      const summed = state.lots.reduce((sum, lot) => sum + lot.areaHa, 0);
      lines.push(`Lotes: ${state.lots.length} · ${fmt(summed, 4)} ha asignadas`);
    }
    lines.push(`Vértices: ${metrics.n}`);
    lines.push(`Método: ${methodLabel()}`);
    if (metrics.avgAcc !== null) lines.push(`Precisión GPS media: ± ${fmt(metrics.avgAcc, 1)} m`);
    lines.push(`Fecha: ${formatDateTime(new Date().toISOString())}`);
    lines.push(`Huella: ${shortHash(payloadHash())}`);
    return lines.join("\n");
  }

  async function copySummary() {
    const text = summaryText();
    let copied = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (error) {
      copied = false;
    }
    if (!copied) {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      area.style.pointerEvents = "none";
      document.body.appendChild(area);
      area.select();
      try {
        copied = document.execCommand("copy");
      } catch (error) {
        copied = false;
      }
      area.remove();
    }
    showToast(copied ? "Resumen copiado al portapapeles." : "No se pudo copiar el resumen.");
  }

  function buildPrintReport() {
    const metrics = computeMetrics();
    const center = metrics.n ? centroid(state.points) : null;
    const stats = repetitionStats();
    const hash = payloadHash();
    const reference = state.refAreaHa;
    const summedLots = state.lots.reduce((sum, lot) => sum + lot.areaHa, 0);
    const gridText = mapGridInfo
      ? `Grilla geográfica cada ${fmt(mapGridInfo.step, mapGridInfo.step < 0.001 ? 4 : 3)}° (≈ ${fmt(mapGridInfo.metres, mapGridInfo.metres < 10 ? 1 : 0)} m)`
      : "Grilla geográfica WGS 84";
    const anchorText = state.ref
      ? `${formatCoordDms(state.ref.lat, true, 2)} ${formatCoordDms(state.ref.lon, false, 2)} · ${fmt(state.ref.lat, 6)}, ${fmt(state.ref.lon, 6)}`
      : "sin anclaje definido";

    const vertexRows = state.points.map((point, index) => {
      const side = metrics.sides[index];
      return `<tr>
        <td><strong>${vertexLabel(index)}</strong></td>
        <td>${fmt(point.lat, 6)}<br><span class="pr-dms">${formatCoordDms(point.lat, true, 1)}</span></td>
        <td>${fmt(point.lon, 6)}<br><span class="pr-dms">${formatCoordDms(point.lon, false, 1)}</span></td>
        <td>${side ? `${fmt(side.distance, 2)} m` : "—"}</td>
        <td>${side ? `${fmt(side.bearing, 1)}°` : "—"}</td>
        <td>${Number.isFinite(point.acc) ? `± ${fmt(point.acc, 1)} m` : "—"}</td>
      </tr>`;
    }).join("");

    const lotRows = state.lots.map((lot, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(lot.name)}</td>
        <td>${escapeHtml(lot.crop || "—")}</td>
        <td>${fmt(lot.areaHa, 4)} ha</td>
        <td>${metrics.areaHa > 0 ? `${fmt(lot.areaHa / metrics.areaHa * 100, 1)} %` : "—"}</td>
      </tr>`).join("");

    const repetitionRows = state.repetitions.map((rep, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${fmt(rep.areaHa, 4)} ha</td>
        <td>${METHOD_LABELS[rep.method] || "—"}</td>
        <td>${formatDateTime(rep.at)}</td>
      </tr>`).join("");

    const photoCards = state.photos.map((photo) => `
      <figure class="pr-photo">
        <img src="${photo.data}" alt="${escapeHtml(photo.caption || "Foto del predio")}">
        <figcaption>
          <strong>${escapeHtml(photo.caption || "Foto del predio")}</strong>
          <span>${formatDateTime(photo.at)}${Number.isFinite(photo.lat) ? ` · ${formatCoordDms(photo.lat, true, 1)} ${formatCoordDms(photo.lon, false, 1)}` : ""}</span>
        </figcaption>
      </figure>`).join("");

    const referenceBlock = reference
      ? `<div class="pr-ref">
          <div><span>Área de referencia</span><strong>${fmt(reference, 4)} ha</strong><em>${escapeHtml(state.refSource || "Sin fuente indicada")}</em></div>
          <div><span>Diferencia medida − referencia</span><strong>${signedHa(metrics.areaHa - reference)}</strong><em>${fmt((metrics.areaHa - reference) / reference * 100, 2)} % · ${fmtInt(Math.round((metrics.areaHa - reference) * 10000))} m²</em></div>
        </div>`
      : '<p class="pr-note">No se declaró un área de referencia (título, catastro o medición anterior).</p>';

    const uncertaintyBlock = stats.n >= 2
      ? `<div class="pr-ref">
          <div><span>Área media de repeticiones</span><strong>${fmt(stats.mean, 4)} ha</strong><em>n = ${stats.n} · s = ${fmt(stats.deviation, 4)} ha</em></div>
          <div><span>Incertidumbre expandida U (95 %)</span><strong>± ${fmt(stats.expanded, 4)} ha</strong><em>U = 2·s/√n · CV = ${fmt(stats.cv, 1)} %</em></div>
        </div>`
      : `<p class="pr-note">${stats.n === 1
        ? "Hay una sola repetición guardada; se necesitan al menos dos para estimar la desviación típica y la incertidumbre."
        : "No hay repeticiones guardadas. Guarda el área después de cada recorrido para estimar la incertidumbre."}</p>`;

    const notes = state.notes
      ? escapeHtml(state.notes).replace(/\n/g, "<br>")
      : "Sin observaciones registradas.";

    const mapImage = canvas.width > 4
      ? `<img class="pr-map-image" src="${canvas.toDataURL("image/png")}" alt="Croquis del predio con grilla de coordenadas WGS 84">`
      : '<p class="pr-note">El croquis no está disponible en este momento. Vuelve a la vista principal y usa «Informe / imprimir PDF» para incluirlo.</p>';

    el.printReport.innerHTML = `
      <header class="pr-head">
        <div class="pr-brand">
          <svg class="pr-logo" viewBox="0 0 48 48" aria-hidden="true">
            <path d="M24 4 43 17 36 40 12 43 4 22Z"/>
            <path class="pr-logo-contour" d="M12 31c4.5-8.5 10-12 19-9M10 25c5-7.5 12-10.5 21-8"/>
            <circle cx="24" cy="23" r="3.4"/>
          </svg>
          <div>
            <p class="pr-name">${APP_NAME}</p>
            <p class="pr-brandline">${BRAND_LINE}</p>
            <p class="pr-tagline">Medición y rectificación de áreas de predios y cultivos</p>
          </div>
        </div>
        <div class="pr-meta">
          <span>Informe técnico de medición</span>
          <strong>${formatDateTime(new Date().toISOString())}</strong>
          <em>Datum WGS 84 · EPSG:4326</em>
        </div>
      </header>

      <div class="pr-title-block">
        <p class="pr-doctype">INFORME DE MEDICIÓN Y RECTIFICACIÓN DE ÁREAS</p>
        <h1>${escapeHtml(state.projectName || "Predio sin nombre")}</h1>
        <p class="pr-lead">Croquis georreferenciado, superficie, linderos, lotes y registro fotográfico del predio.</p>
      </div>

      <div class="pr-kpis">
        <div class="pr-kpi-main"><span>Superficie medida</span><strong>${fmt(metrics.areaHa, 4)} ha</strong><em>${fmtInt(metrics.areaM2)} m²</em></div>
        <div><span>Perímetro</span><strong>${fmt(metrics.perimeter, 2)} m</strong><em>${metrics.n} vértices</em></div>
        <div><span>Método</span><strong>${methodLabel()}</strong><em>${center ? `${formatCoordDms(center.lat, true, 1)} ${formatCoordDms(center.lon, false, 1)}` : "Sin ubicación"}</em></div>
        <div><span>Lotes declarados</span><strong>${state.lots.length ? fmt(summedLots, 4) : "—"} ${state.lots.length ? "ha" : ""}</strong><em>${state.lots.length ? `${state.lots.length} lote(s)` : "Sin desglose"}</em></div>
      </div>

      <section class="pr-section">
        <h2>1. Ubicación y croquis</h2>
        <figure class="pr-map">
          ${mapImage}
          <figcaption>
            <strong>Ubicación del plano:</strong> ${center ? `${formatCoordDms(center.lat, true, 2)} ${formatCoordDms(center.lon, false, 2)} · ${fmt(center.lat, 6)}, ${fmt(center.lon, 6)}` : "Sin coordenadas"} · WGS 84 (EPSG:4326).<br>
            <strong>Anclaje del croquis:</strong> ${anchorText}. ${gridText} · Escala gráfica en el croquis. El norte de la grilla corresponde al norte verdadero.
          </figcaption>
        </figure>
      </section>

      <section class="pr-section">
        <h2>2. Comparación con el área de referencia</h2>
        ${referenceBlock}
      </section>

      <section class="pr-section">
        <h2>3. Vértices y linderos</h2>
        <table class="pr-table">
          <thead><tr><th>Vértice</th><th>Latitud</th><th>Longitud</th><th>Lado</th><th>Rumbo</th><th>Precisión</th></tr></thead>
          <tbody>${vertexRows}</tbody>
        </table>
        <p class="pr-footnote">Coordenadas en grados decimales y en grados/minutos/segundos, datum WGS 84 (EPSG:4326). Rumbo desde el norte verdadero, en sentido horario.</p>
      </section>

      <section class="pr-section">
        <h2>4. Lotes y cultivos</h2>
        ${state.lots.length
          ? `<table class="pr-table">
              <thead><tr><th>#</th><th>Lote</th><th>Cultivo</th><th>Superficie</th><th>% del predio</th></tr></thead>
              <tbody>${lotRows}</tbody>
            </table>
            ${summedLots > metrics.areaHa ? `<p class="pr-alert">La suma de lotes supera el área medida en ${fmt(summedLots - metrics.areaHa, 4)} ha.</p>` : `<p class="pr-footnote">Asignado ${fmt(summedLots, 4)} ha · Sin asignar ${fmt(Math.max(0, metrics.areaHa - summedLots), 4)} ha.</p>`}`
          : '<p class="pr-note">Sin lotes ni cultivos declarados.</p>'}
      </section>

      <section class="pr-section">
        <h2>5. Repeticiones e incertidumbre</h2>
        ${uncertaintyBlock}
        ${state.repetitions.length
          ? `<table class="pr-table pr-table-compact">
              <thead><tr><th>#</th><th>Superficie</th><th>Método</th><th>Fecha</th></tr></thead>
              <tbody>${repetitionRows}</tbody>
            </table>`
          : ""}
      </section>

      <section class="pr-section">
        <h2>6. Registro fotográfico</h2>
        ${state.photos.length ? `<div class="pr-photos">${photoCards}</div>` : '<p class="pr-note">Sin fotografías adjuntas.</p>'}
      </section>

      <section class="pr-section">
        <h2>7. Observaciones</h2>
        <p class="pr-notes">${notes}</p>
      </section>

      <div class="pr-signatures">
        <div><span></span><strong>Ing. Agrónomo</strong><small>Firma y matrícula</small></div>
        <div><span></span><strong>Avaluador</strong><small>Firma y matrícula</small></div>
        <div><span></span><strong>Propietario / responsable</strong><small>Aclaración y firma</small></div>
      </div>

      <footer class="pr-footer">
        <p><strong>${APP_NAME}</strong> · ${BRAND_LINE} · Medición y rectificación de áreas de predios y cultivos.</p>
        <p>Medición orientativa con GPS de teléfono. No reemplaza una mensura legal ni un levantamiento GNSS/RTK. Verifica los linderos y la documentación antes de registrar el área.</p>
        <p class="pr-hash"><strong>Huella SHA-256 del proyecto:</strong> ${hash}</p>
        <p class="pr-hash-note">La huella permite comprobar que el archivo digital no fue alterado. Conserva el respaldo JSON junto con este informe.</p>
      </footer>`;
    reportDirty = false;
    el.printReport.dataset.dirty = "false";
  }

  async function printReport() {
    const metrics = computeMetrics();
    if (metrics.n < 3) {
      showToast("Necesitas al menos 3 vértices para generar el informe.");
      return;
    }
    if (!gridOn) {
      gridOn = true;
      updateHistoryButtons();
    }
    persistState();
    view.autoFit = true;
    renderMap(metrics);
    buildPrintReport();
    const image = el.printReport.querySelector(".pr-map-image");
    if (image && typeof image.decode === "function") {
      try {
        await image.decode();
      } catch (error) {
        /* Si la imagen no se puede decodificar, el navegador imprimirá el resto. */
      }
    }
    const previousTitle = document.title;
    document.title = `${state.projectName || "Predio"} · ${APP_NAME}`;
    let restored = false;
    const restore = () => {
      if (restored) return;
      restored = true;
      document.title = previousTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.setTimeout(restore, 20000);
    window.print();
  }

  function backupProject() {
    persistState();
    const payload = projectPayload();
    const hash = payloadHash(payload);
    const doc = {
      app: APP_NAME,
      brand: BRAND_LINE,
      schema: 2,
      exportedAt: new Date().toISOString(),
      hashAlgo: "SHA-256",
      hash,
      project: payload,
    };
    downloadFile(`${exportBaseName()}-respaldo.json`, JSON.stringify(doc, null, 2), "application/json;charset=utf-8");
    showToast("Respaldo JSON descargado con huella SHA-256.");
  }

  function applyRestoredState(next) {
    if (cases.items.length >= MAX_CASES) {
      showToast(`Hay ${MAX_CASES} casos guardados. Elimina uno antes de restaurar otro respaldo.`, 4600);
      return false;
    }
    const savedCurrent = persistState();
    if (!savedCurrent) {
      showToast("No hay espacio para guardar el caso actual. Descarga un respaldo o elimina fotos antes de restaurar.", 5600);
      return false;
    }
    stopActiveGps();
    const record = makeCaseRecord(next, new Date().toISOString());
    cases.items.unshift(record);
    cases.activeId = record.id;
    state = projectFromCase(record);
    history.undo.length = 0;
    history.redo.length = 0;
    view.autoFit = true;
    applyStateToUI();
    persistState({ touch: false });
    setGpsStatus("", "Respaldo restaurado", "El respaldo se abrió como un caso nuevo. El caso anterior sigue guardado.");
    return true;
  }

  async function restoreProjectFile(file) {
    let doc;
    try {
      doc = JSON.parse(await file.text());
    } catch (error) {
      showToast("El archivo no es un JSON válido.");
      return;
    }
    const payload = doc && typeof doc === "object" && doc.project ? doc.project : doc;
    const normalized = normalizeState(payload);
    if (!normalized) {
      showToast("El respaldo no contiene un proyecto reconocible.");
      return;
    }

    if (doc && typeof doc.hash === "string" && doc.hash) {
      const actual = payloadHash(payload);
      if (actual !== doc.hash) {
        const proceed = await askConfirm(
          "Huella distinta",
          "El contenido del respaldo no coincide con su huella SHA-256. El archivo pudo modificarse. ¿Restaurarlo de todos modos?",
          "Restaurar igualmente"
        );
        if (!proceed) return;
      }
    }

    if (applyRestoredState(normalized)) {
      showToast("Respaldo restaurado como un caso nuevo. El anterior sigue guardado.");
    }
  }

  function closeExportMenu() {
    el.exportMenu.hidden = true;
    el.exportBtn.setAttribute("aria-expanded", "false");
  }

  function toggleExportMenu() {
    const open = el.exportMenu.hidden;
    el.exportMenu.hidden = !open;
    el.exportBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      const first = el.exportMenu.querySelector("button");
      if (first) first.focus({ preventScroll: true });
    }
  }

  function handleExport(action) {
    if (action === "csv") exportCsv();
    if (action === "kml") exportKml();
    if (action === "geojson") exportGeoJson();
    if (action === "summary") copySummary();
    if (action === "print") printReport();
    if (action === "backup") backupProject();
    if (action === "restore") {
      el.restoreInput.value = "";
      el.restoreInput.click();
    }
  }

  /* ---------- Interfaz e inicio ---------- */

  function setActiveMode(mode, focusTab = false) {
    if (!el.panels[mode]) return;
    activeMode = mode;
    el.tabs.forEach((tab) => {
      const selected = tab.dataset.mode === mode;
      tab.classList.toggle("is-active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focusTab) tab.focus({ preventScroll: true });
    });
    Object.entries(el.panels).forEach(([key, panel]) => {
      panel.hidden = key !== mode;
    });
    if (mode === "linderos") updateShapePreview();
  }

  function initTabs() {
    el.tabs.forEach((tab, index, list) => {
      tab.addEventListener("click", () => setActiveMode(tab.dataset.mode));
      tab.addEventListener("keydown", (event) => {
        const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
        if (!keys.includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % list.length;
        if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + list.length) % list.length;
        if (event.key === "Home") next = 0;
        if (event.key === "End") next = list.length - 1;
        setActiveMode(list[next].dataset.mode, true);
      });
    });
  }

  function initReference() {
    el.refArea.addEventListener("input", () => {
      const value = parseDecimal(el.refArea.value);
      state.refAreaHa = Number.isFinite(value) && value > 0 ? clamp(value, 0.0001, 99999) : null;
      state.updatedAt = new Date().toISOString();
      renderReference(computeMetrics());
      scheduleSave();
    });
    el.refArea.addEventListener("blur", () => {
      el.refArea.value = state.refAreaHa ? fmt(state.refAreaHa, 4) : "";
    });
    el.refSource.addEventListener("change", () => {
      state.refSource = el.refSource.value;
      state.updatedAt = new Date().toISOString();
      renderReference(computeMetrics());
      scheduleSave();
    });
  }

  function initRepetitions() {
    el.repAdd.addEventListener("click", () => {
      const metrics = computeMetrics();
      if (metrics.n < 3) {
        showToast("Mide el predio antes de guardar una repetición.");
        return;
      }
      state.repetitions.push({
        id: uid(),
        areaHa: metrics.areaHa,
        method: state.method,
        at: new Date().toISOString(),
      });
      state.updatedAt = new Date().toISOString();
      renderRepetitions(metrics);
      scheduleSave();
      showToast(`Área guardada: ${fmt(metrics.areaHa, 4)} ha · n = ${state.repetitions.length}.`);
    });

    el.repList.addEventListener("click", (event) => {
      const button = event.target.closest("[data-rep-delete]");
      if (!button) return;
      const id = button.dataset.repDelete;
      const index = state.repetitions.findIndex((rep) => rep.id === id);
      if (index < 0) return;
      state.repetitions.splice(index, 1);
      state.updatedAt = new Date().toISOString();
      renderRepetitions(computeMetrics());
      scheduleSave();
      showToast("Repetición eliminada.");
    });
  }

  function initLots() {
    el.lotForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const area = parseDecimal(el.lotArea.value);
      if (!Number.isFinite(area) || area <= 0) {
        el.lotError.textContent = "Escribe una superficie mayor que cero, en hectáreas.";
        el.lotError.hidden = false;
        return;
      }
      el.lotError.hidden = true;
      state.lots.push({
        id: uid(),
        name: (el.lotName.value.trim() || `Lote ${state.lots.length + 1}`).slice(0, 40),
        crop: el.lotCrop.value.trim().slice(0, 40),
        areaHa: clamp(area, 0.0001, 99999),
      });
      el.lotName.value = "";
      el.lotCrop.value = "";
      el.lotArea.value = "";
      state.updatedAt = new Date().toISOString();
      renderLots();
      render();
      scheduleSave();
      el.lotName.focus({ preventScroll: true });
      showToast("Lote añadido al desglose del predio.");
    });

    el.lotsBody.addEventListener("input", (event) => {
      const input = event.target.closest("[data-lot-field]");
      if (!input) return;
      const lot = state.lots.find((item) => item.id === input.dataset.lotId);
      if (!lot) return;
      const field = input.dataset.lotField;
      if (field === "name") lot.name = input.value.slice(0, 40);
      if (field === "crop") lot.crop = input.value.slice(0, 40);
      if (field === "areaHa") {
        const value = parseDecimal(input.value);
        if (!Number.isFinite(value) || value <= 0) return;
        lot.areaHa = clamp(value, 0.0001, 99999);
      }
      state.updatedAt = new Date().toISOString();
      updateLotsComputed(computeMetrics());
      scheduleSave();
    });

    el.lotsBody.addEventListener("change", (event) => {
      const input = event.target.closest('[data-lot-field="areaHa"]');
      if (!input) return;
      const lot = state.lots.find((item) => item.id === input.dataset.lotId);
      if (lot) input.value = fmt(lot.areaHa, 4);
      else input.value = "";
    });

    el.lotsBody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-lot-delete]");
      if (!button) return;
      const id = button.dataset.lotDelete;
      const index = state.lots.findIndex((lot) => lot.id === id);
      if (index < 0) return;
      state.lots.splice(index, 1);
      state.updatedAt = new Date().toISOString();
      renderLots();
      render();
      scheduleSave();
      showToast("Lote eliminado.");
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
      reader.readAsDataURL(file);
    });
  }

  function compressPhoto(file) {
    return readFileAsDataUrl(file).then((dataUrl) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_PX / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const target = document.createElement("canvas");
        target.width = width;
        target.height = height;
        const context = target.getContext("2d");
        context.fillStyle = "#fffdf8";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        resolve(target.toDataURL("image/jpeg", PHOTO_QUALITY));
      };
      image.onerror = () => reject(new Error("El archivo no es una imagen válida."));
      image.src = dataUrl;
    }));
  }

  function photoError(message) {
    el.photoError.textContent = message;
    el.photoError.hidden = !message;
  }

  async function addPhotos(fileList) {
    const files = Array.from(fileList || []).filter((file) => /^image\//i.test(file.type || ""));
    if (!files.length) {
      photoError("Selecciona una imagen (JPG, PNG o WebP).");
      return;
    }
    const room = MAX_PHOTOS - state.photos.length;
    if (room <= 0) {
      photoError(`Ya hay ${MAX_PHOTOS} fotos. Elimina una para añadir otra.`);
      return;
    }
    photoError("");
    const chosen = files.slice(0, room);
    const center = state.points.length >= 3 ? centroid(state.points) : (state.ref || null);
    let added = 0;
    for (const file of chosen) {
      try {
        const data = await compressPhoto(file);
        const base = String(file.name || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
        const caption = base ? base.charAt(0).toUpperCase() + base.slice(1) : `Foto ${state.photos.length + 1}`;
        state.photos.push({
          id: uid(),
          data,
          caption: caption.slice(0, 80),
          at: new Date().toISOString(),
          lat: center ? center.lat : null,
          lon: center ? center.lon : null,
        });
        added += 1;
      } catch (error) {
        photoError(error.message || "No se pudo procesar la imagen.");
      }
    }
    el.photoInput.value = "";
    if (!added) return;
    state.updatedAt = new Date().toISOString();
    renderPhotos();
    const saved = persistState();
    if (!saved) {
      state.photos.splice(state.photos.length - added, added);
      renderPhotos();
      photoError("No hay espacio en este dispositivo para guardar las fotos. Elimina alguna o descarga un respaldo.");
      return;
    }
    if (files.length > room) {
      photoError(`Solo se añadieron ${room} fotos: el máximo es ${MAX_PHOTOS}.`);
    }
    showToast(`${added} ${added === 1 ? "foto añadida" : "fotos añadidas"} al proyecto.`);
  }

  function initPhotos() {
    el.photoInput.addEventListener("change", () => {
      addPhotos(el.photoInput.files);
    });
    el.photoGrid.addEventListener("input", (event) => {
      const input = event.target.closest("[data-photo-caption]");
      if (!input) return;
      const photo = state.photos.find((item) => item.id === input.dataset.photoCaption);
      if (!photo) return;
      photo.caption = input.value.slice(0, 80);
      state.updatedAt = new Date().toISOString();
      scheduleSave();
    });
    el.photoGrid.addEventListener("click", (event) => {
      const button = event.target.closest("[data-photo-delete]");
      if (!button) return;
      const id = button.dataset.photoDelete;
      const index = state.photos.findIndex((photo) => photo.id === id);
      if (index < 0) return;
      state.photos.splice(index, 1);
      state.updatedAt = new Date().toISOString();
      photoError("");
      renderPhotos();
      persistState();
      showToast("Foto eliminada.");
    });
  }

  function initNotes() {
    el.notes.addEventListener("input", () => {
      state.notes = el.notes.value.slice(0, 1200);
      state.updatedAt = new Date().toISOString();
      scheduleSave();
    });
  }

  function initOrigin() {
    el.originGps.addEventListener("click", useGpsForOrigin);
    [el.originLat, el.originLon].forEach((input) => {
      input.addEventListener("input", () => {
        el.shapeErrors.hidden = true;
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!updateShapePreview()) return;
        applyShape();
      });
    });
  }

  function initBackup() {
    el.restoreInput.addEventListener("change", () => {
      const file = el.restoreInput.files && el.restoreInput.files[0];
      el.restoreInput.value = "";
      if (file) restoreProjectFile(file);
    });
  }

  function initPrint() {
    window.addEventListener("beforeprint", () => {
      const metrics = computeMetrics();
      if (metrics.n < 3) return;
      const rect = el.mapStage.getBoundingClientRect();
      if (rect.width > 40 && rect.height > 40) {
        view.autoFit = true;
        renderMap(metrics);
      }
      if (reportDirty || el.printReport.dataset.dirty !== "false") buildPrintReport();
    });
  }

  function initGpsPanel() {
    el.gpsToggle.addEventListener("click", handleGpsToggle);
    el.gpsFinish.addEventListener("click", finishGps);
    el.gpsSimplify.addEventListener("click", simplifyGps);
    el.gpsMinDistance.addEventListener("blur", () => {
      const value = parseDecimal(el.gpsMinDistance.value);
      el.gpsMinDistance.value = String(clamp(Number.isFinite(value) ? value : 3, 1, 100));
    });
  }

  function initShapesPanel() {
    el.shapeTabs.forEach((button) => {
      button.addEventListener("click", () => setShapeType(button.dataset.shape));
    });
    $$("[data-quad], [data-tri], [data-rect], [data-circle]").forEach((input) => {
      input.addEventListener("input", updateShapePreview);
    });
    const form = $("#shapeForm");
    if (form) {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!updateShapePreview()) return;
        applyShape();
      });
    }
    el.shapeApply.addEventListener("click", () => {
      if (!updateShapePreview()) return;
      try {
        applyShape();
      } catch (error) {
        el.shapeErrors.textContent = error.message;
        el.shapeErrors.hidden = false;
      }
    });
  }

  function initCoordsPanel() {
    el.coordAdd.addEventListener("click", addCoordinate);
    el.coordLocate.addEventListener("click", useGpsForCoordinate);
    el.coordAppend.addEventListener("click", () => importCoordinates(false));
    el.coordReplace.addEventListener("click", () => importCoordinates(true));
    [el.coordLat, el.coordLon].forEach((input) => {
      input.addEventListener("input", () => coordsError(""));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addCoordinate();
        }
      });
    });
    el.coordImport.addEventListener("input", () => {
      el.importError.hidden = true;
    });
  }

  function initSidesPanel() {
    el.sidesBody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-index]");
      if (!button) return;
      const index = Number(button.dataset.deleteIndex);
      if (!Number.isInteger(index) || index < 0 || index >= state.points.length) return;
      const label = vertexLabel(index);
      const next = state.points.filter((_, pointIndex) => pointIndex !== index);
      let method = state.method;
      if (state.method === "demo") method = next.length ? "coords" : "none";
      if (!next.length) method = "none";
      applyPoints(next, method, { fit: false });
      showToast(`Vértice ${label} eliminado. Puedes deshacer con Ctrl+Z.`);
    });
  }

  function initHeader() {
    el.projectName.addEventListener("input", () => {
      state.projectName = el.projectName.value;
      state.updatedAt = new Date().toISOString();
      reportDirty = true;
      scheduleSave();
    });
    el.projectName.addEventListener("blur", () => {
      if (!el.projectName.value.trim()) {
        el.projectName.value = "Predio sin nombre";
        state.projectName = el.projectName.value;
        reportDirty = true;
        scheduleSave();
      }
    });

    el.exportBtn.addEventListener("click", toggleExportMenu);
    el.exportMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-export]");
      if (!button) return;
      closeExportMenu();
      handleExport(button.dataset.export);
    });
    document.addEventListener("pointerdown", (event) => {
      if (el.exportMenu.hidden) return;
      if (!event.target.closest(".menu-wrap")) closeExportMenu();
    });

    el.newBtn.addEventListener("click", newMeasurement);
    el.loadDemoBtn.addEventListener("click", loadExample);
  }

  function stopActiveGps() {
    stopGpsWatch();
    gps.active = false;
    gps.paused = false;
    gps.lastFix = null;
    gps.elapsed = 0;
    gps.segmentStart = 0;
    gps.rejected = 0;
    stopTimer();
    releaseWakeLock();
  }

  function applyStateToUI() {
    el.projectName.value = state.projectName;
    el.refArea.value = state.refAreaHa ? fmt(state.refAreaHa, 4) : "";
    el.refSource.value = state.refSource || "";
    el.notes.value = state.notes || "";
    el.notesBox.open = false;
    el.coordLat.value = "";
    el.coordLon.value = "";
    el.coordImport.value = "";
    el.lotName.value = "";
    el.lotCrop.value = "";
    el.lotArea.value = "";
    el.importError.hidden = true;
    el.coordError.hidden = true;
    el.lotError.hidden = true;
    el.shapeErrors.hidden = true;
    photoError("");
    sidesSignature = "";
    repsSignature = "";
    renderLots();
    renderPhotos();
    render();
    updateShapePreview();
    renderCases(true);
  }

  async function switchCase(id) {
    if (!id || id === cases.activeId) return;
    const target = cases.items.find((item) => item.id === id);
    if (!target) return;
    const next = projectFromCase(target);
    if (!next) {
      showToast("Ese caso no se pudo abrir.");
      return;
    }
    if (!persistState()) {
      const proceed = await askConfirm(
        "No se pudo guardar el caso actual",
        "No hay espacio suficiente para guardar todos los datos. Si abres otro caso podrías perder cambios del caso actual. ¿Continuar de todos modos?",
        "Abrir de todos modos"
      );
      if (!proceed) return;
    }
    stopActiveGps();
    cases.activeId = id;
    state = next;
    history.undo.length = 0;
    history.redo.length = 0;
    view.autoFit = true;
    applyStateToUI();
    persistState({ touch: false });
    setGpsStatus("", "Caso abierto", `«${state.projectName}». Revisa el croquis antes de continuar.`);
    showToast(`Caso «${state.projectName}» abierto.`);
  }

  async function deleteCase(id) {
    const item = cases.items.find((entry) => entry.id === id);
    if (!item) return;
    const index = cases.items.indexOf(item);
    const active = id === cases.activeId;
    const vertices = item.project.points.length;
    const area = caseAreaHa(item.project);
    const detail = vertices >= 3 ? `${fmt(area, 4)} ha · ${vertices} vértices` : "sin medición";
    const ok = await askConfirm(
      "Eliminar caso",
      `Se eliminará «${item.project.projectName}» (${detail}) de este dispositivo. Descarga antes un respaldo JSON si quieres conservarlo.`,
      "Eliminar caso"
    );
    if (!ok) return;

    cases.items.splice(index, 1);
    if (!cases.items.length) {
      const record = makeCaseRecord(createEmptyState(), new Date().toISOString());
      cases.items.push(record);
      cases.activeId = record.id;
      state = projectFromCase(record);
      stopActiveGps();
      view.autoFit = true;
      applyStateToUI();
    } else if (active) {
      const next = cases.items[Math.min(index, cases.items.length - 1)];
      cases.activeId = next.id;
      state = projectFromCase(next);
      stopActiveGps();
      view.autoFit = true;
      applyStateToUI();
    } else {
      renderCases(true);
    }
    persistState({ touch: false });
    showToast("Caso eliminado.");
  }

  function saveCaseNow() {
    if (persistState()) {
      showToast(`Caso guardado: ${state.projectName}.`);
    }
  }

  function initCases() {
    if (!el.caseList) return;
    el.caseList.addEventListener("click", (event) => {
      const remove = event.target.closest("[data-case-delete]");
      if (remove) {
        deleteCase(remove.dataset.caseDelete);
        return;
      }
      const open = event.target.closest("[data-case-open]");
      if (open) switchCase(open.dataset.caseOpen);
    });
    if (el.caseNew) el.caseNew.addEventListener("click", newMeasurement);
    if (el.caseSave) el.caseSave.addEventListener("click", saveCaseNow);
    renderCases(true);
  }

  async function showInstallInstructions() {
    const ua = navigator.userAgent;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/i.test(ua);
    let text;
    if (isIOS) {
      text = "1. Abre esta página en Safari.\n2. Toca el botón Compartir.\n3. Elige «Añadir a pantalla de inicio».\n4. Confirma con «Añadir».";
    } else if (isAndroid) {
      text = "1. Abre esta página en Chrome.\n2. Toca el menú ⋮ de la esquina superior derecha.\n3. Elige «Instalar aplicación» o «Añadir a pantalla de inicio».\n4. Confirma la instalación.";
    } else {
      text = "Abre este enlace en el móvil. En Chrome, usa el menú ⋮ > «Instalar aplicación»; en Safari, Compartir > «Añadir a pantalla de inicio».";
    }
    if (!(location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      text += "\n\nLa instalación automática necesita abrir la app desde un enlace HTTPS. Si abriste el archivo directamente, publica la carpeta en un servidor o en un alojamiento estático.";
    }
    await showInfo("Instalar la app en el móvil", text, "Entendido");
  }

  function initInstall() {
    if (!el.installBtn) return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    if (standalone) {
      el.installBtn.hidden = true;
      return;
    }
    el.installBtn.hidden = false;
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      el.installBtn.classList.add("is-ready");
    });
    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      el.installBtn.hidden = true;
      showToast("CAMPO VERDE JRB se instaló en tu dispositivo.");
    });
    el.installBtn.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        const prompt = deferredInstallPrompt;
        deferredInstallPrompt = null;
        el.installBtn.classList.remove("is-ready");
        prompt.prompt();
        try {
          await prompt.userChoice;
        } catch (error) {
          /* El navegador decidirá; no es crítico. */
        }
        return;
      }
      showInstallInstructions();
    });
  }

  function initServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.warn("No se pudo activar el modo sin conexión.", error);
      });
    });
  }

  async function newMeasurement() {
    const hasContent = state.points.length || state.lots.length || state.photos.length
      || state.repetitions.length || state.refAreaHa || state.notes || state.projectName !== "Predio sin nombre";
    if (!hasContent && !gps.active && !gps.paused) {
      showToast("El caso actual ya está vacío. Elige un método para empezar.");
      return;
    }
    if (cases.items.length >= MAX_CASES) {
      showToast(`Hay ${MAX_CASES} casos guardados. Elimina uno antiguo antes de crear otro.`, 4200);
      return;
    }
    const ok = await askConfirm(
      "Nuevo caso",
      "El caso actual seguirá guardado en «Casos guardados» y podrás abrirlo cuando quieras. Se creará un caso vacío con su propio croquis, lotes, fotos y observaciones.",
      "Crear caso vacío"
    );
    if (!ok) return;

    if (!persistState()) {
      const proceed = await askConfirm(
        "No se pudo guardar el caso actual",
        "No hay espacio suficiente para guardar todos los datos. Si creas otro caso podrías perder cambios del caso actual. ¿Continuar de todos modos?",
        "Crear de todos modos"
      );
      if (!proceed) return;
    }

    stopActiveGps();
    const record = makeCaseRecord(createEmptyState(), new Date().toISOString());
    cases.items.unshift(record);
    cases.activeId = record.id;
    state = projectFromCase(record);
    history.undo.length = 0;
    history.redo.length = 0;
    view.autoFit = true;
    applyStateToUI();
    persistState({ touch: false });

    setGpsStatus("", "GPS en espera", "Caso vacío. Inicia el recorrido al llegar a una esquina.");
    setActiveMode("gps");
    el.projectName.focus({ preventScroll: true });
    showToast("Caso vacío creado. El anterior quedó guardado.");
  }

  function initKeyboard() {
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !el.exportMenu.hidden) {
        closeExportMenu();
        el.exportBtn.focus();
        return;
      }
      const target = event.target;
      if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        event.preventDefault();
        redo();
      }
    });
  }

  function initVisibility() {
    window.addEventListener("pagehide", () => persistState());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") persistState();
      if (document.visibilityState === "visible" && gps.active) requestWakeLock();
    });
    window.addEventListener("afterprint", () => {
      view.autoFit = true;
      redrawMap();
    });
  }

  function init() {
    const loaded = loadState();
    el.projectName.value = state.projectName;
    el.refArea.value = state.refAreaHa ? fmt(state.refAreaHa, 4) : "";
    el.refSource.value = state.refSource || "";
    el.notes.value = state.notes || "";

    initHeader();
    initTabs();
    initReference();
    initRepetitions();
    initLots();
    initPhotos();
    initNotes();
    initOrigin();
    initBackup();
    initPrint();
    initGpsPanel();
    initShapesPanel();
    initCoordsPanel();
    initSidesPanel();
    initCases();
    initInstall();
    initServiceWorker();
    initKeyboard();
    initVisibility();
    initMapInteractions();

    setActiveMode("gps");
    updateShapePreview();
    updateAccuracyPill();
    if (!navigator.geolocation) {
      setGpsStatus("error", "GPS no disponible", "Este navegador no ofrece geolocalización. Usa linderos o coordenadas.");
    } else if (loaded !== "none" && state.points.length) {
      setGpsStatus("", "Caso recuperado", "Tu última medición se cargó desde este dispositivo. Inicia un recorrido para reemplazarla.");
    } else {
      setGpsStatus("", "GPS en espera", "Inicia el recorrido al llegar a una esquina del predio.");
    }

    renderLots();
    renderPhotos();
    view.autoFit = true;
    render();
    renderCases(true);

    if (needsInitialPersist) {
      persistState({ touch: false });
    } else {
      setSaveStatus("saved");
      scheduleHashDisplay();
    }

    if (loaded === "none") {
      window.setTimeout(() => {
        showToast("Ejemplo demostrativo cargado. Sustitúyelo con tu propia medición o crea un caso vacío.", 5200);
      }, 700);
    } else if (loaded === "legacy") {
      window.setTimeout(() => {
        showToast("Proyecto migrado y guardado como caso. Puedes crear más casos sin perder este.", 5200);
      }, 700);
    }
  }

  init();
})();

