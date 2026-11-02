/* ============================================================
   CAMPO VERDE JRB · nucleo DEM (sin DOM, sin dependencias)
   Pendiente Horn 3x3, ventana adaptativa, estadistica zonal,
   clase agrologica asistida y resumen canonico para hash.
   Se puede probar en Node: require("./dem/dem-core.js")
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CVDem = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEM_CORE_VERSION = "0.2.0";
  const EARTH_R = 6371008.8;
  const DEG = Math.PI / 180;

  const DEFAULT_BANDS = [
    { id: "0-3", min: 0, max: 3, maxClass: "I" },
    { id: "3-7", min: 3, max: 7, maxClass: "II" },
    { id: "7-12", min: 7, max: 12, maxClass: "III" },
    { id: "12-25", min: 12, max: 25, maxClass: "IV" },
    { id: "25-50", min: 25, max: 50, maxClass: "V" },
    { id: "50-75", min: 50, max: 75, maxClass: "VI" },
    { id: ">75", min: 75, max: null, maxClass: "VII" },
  ];

  const DEFAULT_RULES = {
    classOrder: ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"],
    slopeBands: DEFAULT_BANDS,
  };

  // Tabla unica de estados. La API v1 usa codigos en ingles; la interfaz
  // conserva la etiqueta en espanol. Ningun estado se deduce por texto libre:
  // todo pasa por esta tabla y las pruebas cubren ambos sentidos.
  const STATUS_TABLE = {
    sector: [
      { api: "ok", es: "ok" },
      { api: "insufficient_resolution", es: "resolucion insuficiente" },
      { api: "no_valid_cells", es: "sin celdas validas" },
      { api: "no_coverage", es: "sin cobertura" },
    ],
    class: [
      { api: "proposed", es: "propuesta" },
      { api: "confirmed", es: "confirmada" },
      { api: "topographic_limit", es: "limitante topografica" },
      { api: "not_determinable", es: "no determinable" },
      { api: "topographic_limit", es: "no validado" },
      { api: "topographic_limit", es: "resolucion insuficiente" },
      { api: "not_determinable", es: "no apto" },
    ],
    validation: [
      { api: "validated", es: "validado" },
      { api: "not_validated", es: "no validado" },
      { api: "failed", es: "fallido" },
    ],
  };

  function normalizeStatusKey(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }

  function statusToApi(kind, value) {
    const key = normalizeStatusKey(value);
    if (!key) return null;
    const rows = STATUS_TABLE[kind] || [];
    const found = rows.find((row) => normalizeStatusKey(row.api) === key)
      || rows.find((row) => normalizeStatusKey(row.es) === key);
    return found ? found.api : null;
  }

  function statusToEs(kind, value) {
    const key = normalizeStatusKey(value);
    if (!key) return null;
    const rows = STATUS_TABLE[kind] || [];
    const found = rows.find((row) => normalizeStatusKey(row.api) === key)
      || rows.find((row) => normalizeStatusKey(row.es) === key);
    return found ? found.es : null;
  }

  function statusPair(kind, value) {
    const key = normalizeStatusKey(value);
    const rows = STATUS_TABLE[kind] || [];
    const exactEs = rows.find((row) => normalizeStatusKey(row.es) === key);
    const api = statusToApi(kind, value);
    const es = (exactEs && exactEs.es) || statusToEs(kind, api) || (api ? null : String(value || "")) || null;
    return { status: api, statusEs: es };
  }

  function consistencyFromSemaforo(semaforo) {
    const key = normalizeStatusKey(semaforo);
    if (key === "verde" || key === "green") return "green";
    if (key === "ambar" || key === "amber") return "amber";
    return "red";
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function haversine(a, b) {
    if (!a || !b) return 0;
    const dLat = (b.lat - a.lat) * DEG;
    const dLon = (b.lon - a.lon) * DEG;
    const lat1 = a.lat * DEG;
    const lat2 = b.lat * DEG;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Proyeccion local equirectangular con cos(lat). Suficiente para predios
  // pequenos y medianos; para calculos oficiales se usara UTM.
  function projectLocal(points) {
    const list = Array.isArray(points) ? points : [];
    if (!list.length) return [];
    const lat0 = list.reduce((sum, p) => sum + Number(p.lat), 0) / list.length;
    const lon0 = list.reduce((sum, p) => sum + Number(p.lon), 0) / list.length;
    const mPerDegLat = EARTH_R * DEG;
    const mPerDegLon = EARTH_R * DEG * Math.cos(lat0 * DEG);
    return list.map((point) => ({
      x: (Number(point.lon) - lon0) * mPerDegLon,
      y: (Number(point.lat) - lat0) * mPerDegLat,
    }));
  }

  // Pendiente de Horn 3x3. Entrada: grilla row-major (z), ancho, alto y
  // tamanos de celda en metros. Salida: porcentaje de pendiente.
  // Disciplina de collar: el borde de la grilla y cualquier celda con un
  // vecino sin dato quedan en NaN. No se inventan gradientes en el borde.
  function hornSlope(z, width, height, cellX, cellY) {
    const w = Math.trunc(width);
    const h = Math.trunc(height);
    if (!z || w < 1 || h < 1) return new Float32Array(0);
    if (z.length < w * h) throw new Error("La grilla DEM es menor que width*height.");
    const dx = Number(cellX);
    const dy = Number(cellY);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || dx <= 0 || dy <= 0) {
      throw new Error("Los tamanos de celda deben ser mayores que cero.");
    }
    const out = new Float32Array(w * h).fill(NaN);
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const a = z[(y - 1) * w + (x - 1)];
        const b = z[(y - 1) * w + x];
        const c = z[(y - 1) * w + (x + 1)];
        const d = z[y * w + (x - 1)];
        const e = z[y * w + x];
        const f = z[y * w + (x + 1)];
        const g = z[(y + 1) * w + (x - 1)];
        const hh = z[(y + 1) * w + x];
        const i = z[(y + 1) * w + (x + 1)];
        if (![a, b, c, d, e, f, g, hh, i].every(Number.isFinite)) continue;
        const dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * dx);
        const dzdy = ((g + 2 * hh + i) - (a + 2 * b + c)) / (8 * dy);
        out[y * w + x] = Math.hypot(dzdx, dzdy) * 100;
      }
    }
    return out;
  }

  // Suavizado box blur separable con bordes replicados. Se usa para la
  // ventana adaptativa (10 / 25 / 50 m) antes de calcular Horn.
  function boxBlur(z, width, height, radius) {
    const w = Math.trunc(width);
    const h = Math.trunc(height);
    const r = Math.max(0, Math.trunc(radius));
    if (!z || w < 1 || h < 1) return new Float32Array(0);
    if (!r) return Float32Array.from(z.slice(0, w * h));
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    const span = r * 2 + 1;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        for (let k = -r; k <= r; k += 1) sum += z[y * w + clamp(x + k, 0, w - 1)];
        tmp[y * w + x] = sum / span;
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let sum = 0;
        for (let k = -r; k <= r; k += 1) sum += tmp[clamp(y + k, 0, h - 1) * w + x];
        out[y * w + x] = sum / span;
      }
    }
    return out;
  }

  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (base + 1 < sorted.length) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    }
    return sorted[base];
  }

  function slopeStats(values, mask) {
    const list = [];
    for (let i = 0; i < values.length; i += 1) {
      if (mask && !mask[i]) continue;
      const value = values[i];
      if (Number.isFinite(value)) list.push(value);
    }
    if (!list.length) {
      return { count: 0, meanPct: null, p50Pct: null, p95Pct: null, maxPct: null };
    }
    const sorted = list.slice().sort((a, b) => a - b);
    const mean = list.reduce((sum, value) => sum + value, 0) / list.length;
    return {
      count: list.length,
      meanPct: mean,
      p50Pct: quantile(sorted, 0.5),
      p95Pct: quantile(sorted, 0.95),
      maxPct: sorted[sorted.length - 1],
    };
  }

  function bandForSlope(pct, bands) {
    const list = bands || DEFAULT_BANDS;
    const value = Number(pct);
    if (!Number.isFinite(value) || value < 0) return null;
    for (let i = 0; i < list.length; i += 1) {
      const band = list[i];
      if (value < band.min) continue;
      if (band.max === null || band.max === undefined || value < band.max) return band;
    }
    return list.length ? list[list.length - 1] : null;
  }

  // Estadistica zonal simple: cada celda pesa lo mismo (grilla proyectada).
  function zonalStats(slope, width, height, mask, bands) {
    const list = bands || DEFAULT_BANDS;
    const total = Math.trunc(width) * Math.trunc(height);
    if (!slope || slope.length < total) throw new Error("La grilla de pendiente es menor que width*height.");
    const counts = {};
    list.forEach((band) => { counts[band.id] = 0; });
    let cells = 0;
    let sum = 0;
    for (let i = 0; i < total; i += 1) {
      if (mask && !mask[i]) continue;
      const value = slope[i];
      if (!Number.isFinite(value)) continue;
      cells += 1;
      sum += value;
      const band = bandForSlope(value, list);
      if (band) counts[band.id] += 1;
    }
    const classes = {};
    list.forEach((band) => {
      classes[band.id] = cells ? (counts[band.id] / cells) * 100 : 0;
    });
    return {
      cells,
      meanPct: cells ? sum / cells : null,
      classesPct: classes,
      counts,
    };
  }

  function classRank(name, rules) {
    const order = (rules && rules.classOrder) || DEFAULT_RULES.classOrder;
    const index = order.indexOf(name);
    return index < 0 ? null : index + 1;
  }

  function mostRestrictiveClass(a, b, rules) {
    const rankA = classRank(a, rules);
    const rankB = classRank(b, rules);
    if (rankA === null) return rankB === null ? null : b;
    if (rankB === null) return a;
    return rankA >= rankB ? a : b;
  }

  // La clase oficial es la base. La pendiente solo puede empeorarla.
  function evaluateClass(input) {
    const options = input || {};
    const rules = options.rules || DEFAULT_RULES;
    const official = options.officialClass || null;
    const slopePct = Number(options.slopePct);
    if (!official) {
      return {
        status: "no determinable",
        officialClass: null,
        slopeClass: null,
        proposedClass: null,
        finalClass: null,
        limitingFactor: "falta carta de suelos",
        semaforo: "sin datos",
        delta: null,
      };
    }
    if (classRank(official, rules) === null) {
      throw new Error(`Clase oficial desconocida: ${official}`);
    }
    const band = bandForSlope(slopePct, rules.slopeBands);
    if (!band) {
      return {
        status: "no determinable",
        officialClass: official,
        slopeClass: null,
        proposedClass: official,
        finalClass: null,
        limitingFactor: "pendiente no disponible",
        semaforo: "sin datos",
        delta: 0,
      };
    }
    const proposed = mostRestrictiveClass(official, band.maxClass, rules);
    const delta = classRank(proposed, rules) - classRank(official, rules);
    return {
      status: "propuesta",
      officialClass: official,
      slopeClass: band.maxClass,
      proposedClass: proposed,
      // La clase final solo la fija una confirmacion humana. El calculo
      // propone; no certifica.
      finalClass: null,
      slopeBand: band.id,
      limitingFactor: delta > 0 ? `pendiente ${band.id} %` : "ninguno por pendiente",
      semaforo: delta >= 2 ? "rojo" : delta === 1 ? "ambar" : "verde",
      delta,
    };
  }

  function minAreaHa(resolutionM, minCells) {
    const res = Number(resolutionM);
    const cells = Number.isFinite(Number(minCells)) ? Number(minCells) : 100;
    if (!Number.isFinite(res) || res <= 0) return null;
    return (cells * res * res) / 10000;
  }

  function requiredCells(areaHa, resolutionM) {
    const area = Number(areaHa);
    const res = Number(resolutionM);
    if (!Number.isFinite(area) || !Number.isFinite(res) || res <= 0) return null;
    return Math.floor((area * 10000) / (res * res));
  }

  // Validacion de suelo desnudo. No alcanza con el nombre comercial:
  // se exige DTM, bareEarth y validacion con huellas.
  function validateDtm(dem, options) {
    const data = dem || {};
    const opts = options || {};
    const maxBias = Number.isFinite(opts.maxBiasM) ? opts.maxBiasM : 2;
    const validation = data.validation || {};
    const checks = [];
    const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail });

    add("product-dtm", data.product === "DTM", "El producto debe ser DTM (superficie del terreno desnudo).");
    add("bare-earth", data.bareEarth === true, "Debe declararse bareEarth=true.");
    add("resolution", Number.isFinite(Number(data.resolutionM)) && Number(data.resolutionM) > 0, "Falta la resolucion espacial.");
    add("validation-status", validation.status === "validado" || validation.status === "validated", "La validacion debe estar en estado 'validado'.");
    add("validation-n", Number.isFinite(Number(validation.n)) && Number(validation.n) > 0, "Faltan huellas de validacion (GEDI/ICESat-2).");
    add(
      "validation-bias",
      Number.isFinite(Number(validation.biasM)) && Math.abs(Number(validation.biasM)) <= maxBias,
      `El sesgo debe ser <= ${maxBias} m en valor absoluto.`
    );

    const reasons = checks.filter((check) => !check.ok).map((check) => check.detail);
    const ok = reasons.length === 0;
    return {
      ok,
      status: ok ? "validated" : "not_validated",
      statusEs: ok ? "validado" : "no validado",
      checks,
      reasons,
    };
  }

  function canClassifySector(input) {
    const options = input || {};
    const minCells = Number.isFinite(Number(options.minCells)) ? Number(options.minCells) : 100;
    const cells = Number(options.cells);
    const reasons = [];

    if (options.product !== "DTM") {
      reasons.push("DSM: pendiente de superficie, no apta para clase agrologica.");
      return { canSlope: true, canClass: false, status: "no apto", reasons };
    }
    if (!Number.isFinite(cells) || cells < minCells) {
      reasons.push(`Se requieren al menos ${minCells} celdas por sector; hay ${Number.isFinite(cells) ? cells : 0}.`);
      return { canSlope: false, canClass: false, status: "resolucion insuficiente", reasons };
    }
    if (!options.officialClass) {
      reasons.push("Falta la clase oficial IGAC/UPRA: no se inventa la clase.");
      return { canSlope: true, canClass: false, status: "no determinable", reasons };
    }
    const validationOk = options.validation
      && (options.validation.status === "validado" || options.validation.status === "validated");
    if (!validationOk) {
      reasons.push("Sin validacion de suelo desnudo: la clase queda como no validada.");
      return { canSlope: true, canClass: true, canConfirm: false, status: "no validado", reasons };
    }
    return { canSlope: true, canClass: true, canConfirm: false, status: "propuesta", reasons };
  }

  // Base efectiva del gradiente: la ventana completa exige un collar de
  // radio + 1 celdas; el gradiente de Horn usa despues un anillo adicional.
  // Formula del contrato v1: 2 * (radio + 1) * resolucion.
  function effectiveBaselineM(windowM, resolutionM) {
    const windowSize = Number(windowM);
    const res = Number(resolutionM);
    if (!(windowSize > 0) || !(res > 0)) return null;
    const radius = Math.max(0, Math.round((windowSize / res - 1) / 2));
    return 2 * (radius + 1) * res;
  }

  // Incertidumbre conservadora de la pendiente por error vertical.
  // Supone errores independientes en los extremos de la base efectiva:
  // error = 100 * sqrt(2) * sigmaZ / baseEfectiva. No promete exactitud:
  // es una cota orientativa para decidir si el umbral es distinguible.
  function slopeUncertaintyPct(verticalAccuracyM, windowM, resolutionM) {
    const sigma = Number(verticalAccuracyM);
    const baseline = effectiveBaselineM(windowM, resolutionM);
    if (!(sigma > 0) || !(baseline > 0)) return null;
    return (100 * Math.SQRT2 * sigma) / baseline;
  }

  function nearestWindow(windowM) {
    const list = [10, 25, 50];
    const value = Number(windowM);
    if (!Number.isFinite(value) || value <= 0) return null;
    return list.reduce((best, item) => (
      Math.abs(item - value) < Math.abs(best - value) ? item : best
    ), list[0]);
  }

  function chooseWindow(input) {
    const options = input || {};
    const windows = Array.isArray(options.windows) && options.windows.length ? options.windows : [10, 25, 50];
    const target = Number(options.targetPct);
    if (!Number.isFinite(target) || target <= 0) throw new Error("targetPct debe ser mayor que cero.");
    const limit = target / 3;
    const evaluated = windows.map((windowM) => ({
      windowM,
      uncertaintyPct: slopeUncertaintyPct(options.verticalAccuracyM, windowM, options.resolutionM),
      effectiveBaselineM: effectiveBaselineM(windowM, options.resolutionM),
    })).filter((item) => item.uncertaintyPct !== null);

    const good = evaluated.find((item) => item.uncertaintyPct <= limit);
    if (good) {
      return { ...good, possible: true, marginal: false, targetPct: target, reason: null };
    }
    const marginal = evaluated.find((item) => item.uncertaintyPct <= target);
    if (marginal) {
      return {
        ...marginal,
        possible: true,
        marginal: true,
        targetPct: target,
        reason: "Solo alcanza para un resultado marginal; no permite clasificar con confianza.",
      };
    }
    // Sin ventana que alcance el objetivo: se informa la de menor
    // incertidumbre. En empate se prefiere 25 m, la ventana de referencia.
    const fallback = evaluated.slice().sort((a, b) => (
      a.uncertaintyPct - b.uncertaintyPct
      || Math.abs(a.windowM - 25) - Math.abs(b.windowM - 25)
    ))[0] || null;
    return {
      ...(fallback || { windowM: null, uncertaintyPct: null, effectiveBaselineM: null }),
      possible: false,
      marginal: false,
      targetPct: target,
      reason: "La incertidumbre supera el umbral; se necesita un DEM de mayor resolucion o no clasificar.",
    };
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      const out = {};
      Object.keys(value).sort().forEach((key) => {
        if (value[key] !== undefined) out[key] = canonicalize(value[key]);
      });
      return out;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.round(value * 1e9) / 1e9;
    }
    return value;
  }

  function canonicalJson(value) {
    return JSON.stringify(canonicalize(value));
  }

  async function sha256Hex(text) {
    const source = String(text);
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
      return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    if (typeof require === "function") {
      const nodeCrypto = require("crypto");
      return nodeCrypto.createHash("sha256").update(source, "utf8").digest("hex");
    }
    throw new Error("SHA-256 no disponible en este entorno.");
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  }

  // Resumen canonico para hash reproducible: excluye computedAt, computeMs,
  // fotos y la grilla completa. El hash del resultado se calcula sobre
  // canonicalJson({ summary, declaration }) y no cambia entre ejecuciones
  // identicas. Es distinto de payloadHash, que firma el respaldo completo.
  function buildSummary(input) {
    const options = input || {};
    const points = Array.isArray(options.points) ? options.points : [];
    const sectors = Array.isArray(options.sectors) ? options.sectors : [];
    const dem = options.dem || {};
    return canonicalize({
      app: "CAMPO VERDE JRB",
      kind: "dem-summary-v2",
      rulesId: options.rulesId || null,
      points: points.map((point) => [round(point.lat, 6), round(point.lon, 6)]),
      dem: {
        sourceId: dem.sourceId || null,
        product: dem.product || null,
        bareEarth: dem.bareEarth === true,
        resolutionM: dem.resolutionM || null,
        verticalAccuracyM: dem.verticalAccuracyM ?? null,
        acquisitionYear: dem.acquisitionYear ?? null,
        windowM: dem.windowM ?? null,
        radiusCells: dem.radiusCells ?? null,
        effectiveBaselineM: dem.effectiveBaselineM ?? null,
        algorithm: dem.algorithm || null,
        classRuleSetId: dem.classRuleSetId || null,
      },
      sectors: sectors.map((sector) => ({
        id: sector.id,
        name: sector.name || null,
        cells: sector.cells ?? null,
        cellsGross: sector.cellsGross ?? null,
        areaHa: round(sector.areaHa || 0, 4),
        areaGrossHa: round(sector.areaGrossHa || 0, 4),
        coverage: round(sector.coverage || 0, 6),
        status: sector.status || null,
        slope: sector.slope ? {
          meanPct: round(sector.slope.meanPct ?? 0, 2),
          p50Pct: round(sector.slope.p50Pct ?? 0, 2),
          p95Pct: round(sector.slope.p95Pct ?? 0, 2),
          maxPct: round(sector.slope.maxPct ?? 0, 2),
          uncertaintyPct: sector.slope.uncertaintyPct ?? null,
          classesHa: sector.slope.classesHa || null,
          classShare: sector.slope.classShare || null,
        } : null,
        class: sector.class ? {
          officialClass: sector.class.officialClass || null,
          slopeClass: sector.class.slopeClass || null,
          proposedClass: sector.class.proposedClass || null,
          finalClass: sector.class.finalClass || null,
          status: sector.class.status || null,
          limitingFactor: sector.class.limitingFactor || null,
        } : null,
      })),
    });
  }

  return {
    DEM_CORE_VERSION,
    DEFAULT_BANDS,
    DEFAULT_RULES,
    STATUS_TABLE,
    clamp,
    haversine,
    projectLocal,
    hornSlope,
    boxBlur,
    slopeStats,
    bandForSlope,
    zonalStats,
    classRank,
    mostRestrictiveClass,
    evaluateClass,
    minAreaHa,
    requiredCells,
    validateDtm,
    canClassifySector,
    effectiveBaselineM,
    slopeUncertaintyPct,
    nearestWindow,
    chooseWindow,
    statusToApi,
    statusToEs,
    statusPair,
    consistencyFromSemaforo,
    canonicalize,
    canonicalJson,
    sha256Hex,
    buildSummary,
  };
});
