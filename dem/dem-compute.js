/* ============================================================
   CAMPO VERDE JRB · calculo DEM para BYOD
   Recorta el DEM al predio, rasteriza el poligono, calcula
   pendiente Horn 3x3 con ventana adaptativa, estadistica zonal,
   clase agrologica asistida y hash reproducible.
   Sin DOM. Se usa desde Node y desde el Web Worker.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const core = (typeof module === "object" && module.exports)
    ? require("./dem-core.js")
    : (root && root.CVDem);
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CVDemCompute = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  if (!core) throw new Error("CVDemCompute necesita dem-core.js.");

  const COMPUTE_VERSION = "0.1.0";
  const EARTH_M_PER_DEG = 111195.0802335329;
  const DEFAULT_WINDOWS = [10, 25, 50];
  const MAX_COMPUTE_CELLS = 6000000;
  const DEFAULT_MIN_CELLS = 100;
  const DEFAULT_TARGET_PCT = 7;

  function fail(message, code) {
    const error = new Error(message);
    error.code = code || "DEM_COMPUTE";
    throw error;
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function uniqueRing(points) {
    if (!Array.isArray(points)) return [];
    const ring = points
      .filter((point) => point && Number.isFinite(+point.lat) && Number.isFinite(+point.lon))
      .map((point) => ({ lat: +point.lat, lon: +point.lon }));
    if (ring.length > 1) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (Math.abs(first.lat - last.lat) < 1e-12 && Math.abs(first.lon - last.lon) < 1e-12) ring.pop();
    }
    return ring;
  }

  function bboxOf(rings) {
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    rings.forEach((ring) => {
      ring.forEach((point) => {
        if (point.lon < west) west = point.lon;
        if (point.lon > east) east = point.lon;
        if (point.lat < south) south = point.lat;
        if (point.lat > north) north = point.lat;
      });
    });
    return { west, east, south, north };
  }

  // Area esferica del anillo (m2). Aproximacion de exceso esferico
  // por trapecios; suficiente para predios y para contrastar el conteo
  // de celdas. Para tramites, usar el area geodesica oficial.
  function sphericalAreaM2(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    const rad = Math.PI / 180;
    let sum = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      sum += (b.lon - a.lon) * rad * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
    }
    return Math.abs(sum * 6371008.8 * 6371008.8 / 2);
  }

  function cellSizeMeters(grid, latitude) {
    const lat = Number.isFinite(latitude) ? latitude : 0;
    const cellXm = Math.abs(grid.cellX) * EARTH_M_PER_DEG * Math.cos(lat * Math.PI / 180);
    const cellYm = Math.abs(grid.cellY) * EARTH_M_PER_DEG;
    if (!(cellXm > 0) || !(cellYm > 0)) fail("El tamano de celda del DEM no es valido.");
    return { cellXm, cellYm, resolutionM: (cellXm + cellYm) / 2 };
  }

  function ensureCoverage(grid, bbox) {
    const tol = Math.max(Math.abs(grid.cellX), Math.abs(grid.cellY)) * 1.01;
    if (bbox.west < grid.west - tol || bbox.east > grid.east + tol
      || bbox.south < grid.south - tol || bbox.north > grid.north + tol) {
      fail(
        "El DEM no cubre todo el predio. Amplia la descarga o recorta un DEM que incluya el poligono completo.",
        "DEM_COVERAGE"
      );
    }
  }

  function clipGrid(grid, bbox, marginCells) {
    const margin = Math.max(1, Math.trunc(marginCells || 1));
    const eps = 1e-9;
    const col0 = Math.max(0, Math.min(grid.width - 1, Math.floor((bbox.west - grid.west) / grid.cellX + eps) - margin));
    const col1 = Math.max(0, Math.min(grid.width - 1, Math.ceil((bbox.east - grid.west) / grid.cellX - eps) + margin));
    const row0 = Math.max(0, Math.min(grid.height - 1, Math.floor((grid.north - bbox.north) / grid.cellY + eps) - margin));
    const row1 = Math.max(0, Math.min(grid.height - 1, Math.ceil((grid.north - bbox.south) / grid.cellY - eps) + margin));
    const width = col1 - col0 + 1;
    const height = row1 - row0 + 1;
    if (width < 2 || height < 2) fail("El predio ocupa menos de 2 x 2 celdas del DEM.", "DEM_RESOLUTION");
    if (width * height > MAX_COMPUTE_CELLS) {
      fail(`El recorte tiene ${width * height} celdas; el limite de calculo es ${MAX_COMPUTE_CELLS}.`, "DEM_RESOLUTION");
    }
    const data = new Float32Array(width * height);
    for (let row = 0; row < height; row += 1) {
      const sourceRow = row0 + row;
      const sourceStart = sourceRow * grid.width + col0;
      data.set(grid.data.subarray(sourceStart, sourceStart + width), row * width);
    }
    return {
      width,
      height,
      cellX: grid.cellX,
      cellY: grid.cellY,
      west: grid.west + col0 * grid.cellX,
      north: grid.north - row0 * grid.cellY,
      data,
      row0,
      col0,
    };
  }

  // Relleno por scanline: para cada fila de centros de celda se cortan
  // las aristas del anillo y se marcan los tramos interiores. O(filas x aristas).
  function rasterizeRing(ring, win, mask) {
    const n = ring.length;
    if (n < 3) return 0;
    const edges = [];
    for (let i = 0; i < n; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % n];
      if (a.lat !== b.lat) edges.push(a, b);
    }
    let cells = 0;
    for (let row = 0; row < win.height; row += 1) {
      const lat = win.north - (row + 0.5) * win.cellY;
      const xs = [];
      for (let e = 0; e < edges.length; e += 2) {
        const a = edges[e];
        const b = edges[e + 1];
        if ((a.lat <= lat && b.lat > lat) || (b.lat <= lat && a.lat > lat)) {
          const t = (lat - a.lat) / (b.lat - a.lat);
          xs.push(a.lon + t * (b.lon - a.lon));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const rowStart = row * win.width;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let col0 = Math.ceil((xs[k] - win.west) / win.cellX - 0.5);
        let col1 = Math.floor((xs[k + 1] - win.west) / win.cellX - 0.5);
        col0 = Math.max(0, col0);
        col1 = Math.min(win.width - 1, col1);
        for (let col = col0; col <= col1; col += 1) {
          if (!mask[rowStart + col]) {
            mask[rowStart + col] = 1;
            cells += 1;
          }
        }
      }
    }
    return cells;
  }

  // Media movil separable que ignora NaN. Evita que un borde sin datos
  // contamine toda la ventana (a diferencia de un blur con NaN).
  function maskedBlur(z, width, height, radius) {
    const r = Math.max(0, Math.trunc(radius));
    if (!r) return Float32Array.from(z);
    const tmp = new Float32Array(width * height);
    const out = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      let sum = 0;
      let count = 0;
      const row = y * width;
      for (let k = -r; k <= r; k += 1) {
        if (k >= 0 && k < width) {
          const value = z[row + k];
          if (Number.isFinite(value)) { sum += value; count += 1; }
        }
      }
      for (let x = 0; x < width; x += 1) {
        tmp[row + x] = count ? sum / count : NaN;
        const outX = x - r;
        if (outX >= 0) {
          const value = z[row + outX];
          if (Number.isFinite(value)) { sum -= value; count -= 1; }
        }
        const inX = x + r + 1;
        if (inX < width) {
          const value = z[row + inX];
          if (Number.isFinite(value)) { sum += value; count += 1; }
        }
      }
    }
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -r; k <= r; k += 1) {
        if (k >= 0 && k < height) {
          const value = tmp[k * width + x];
          if (Number.isFinite(value)) { sum += value; count += 1; }
        }
      }
      for (let y = 0; y < height; y += 1) {
        out[y * width + x] = count ? sum / count : NaN;
        const outY = y - r;
        if (outY >= 0) {
          const value = tmp[outY * width + x];
          if (Number.isFinite(value)) { sum -= value; count -= 1; }
        }
        const inY = y + r + 1;
        if (inY < height) {
          const value = tmp[inY * width + x];
          if (Number.isFinite(value)) { sum += value; count += 1; }
        }
      }
    }
    return out;
  }

  function pickWindow(input) {
    const resolutionM = input.resolutionM;
    const requested = input.windowM;
    const target = Number.isFinite(Number(input.targetPct)) && Number(input.targetPct) > 0
      ? Number(input.targetPct)
      : DEFAULT_TARGET_PCT;
    let windows;
    if (requested) {
      windows = [Number(requested)];
    } else {
      const set = new Set([resolutionM, ...DEFAULT_WINDOWS].filter((value) => value >= resolutionM * 0.98));
      windows = Array.from(set).sort((a, b) => a - b);
    }
    const choice = core.chooseWindow({
      windows,
      verticalAccuracyM: input.verticalAccuracyM,
      resolutionM,
      targetPct: target,
    });
    const windowM = choice.windowM || resolutionM;
    const radius = Math.max(0, Math.round((windowM / resolutionM - 1) / 2));
    return {
      windowM,
      radius,
      effectiveWindowM: (2 * radius + 3) * resolutionM,
      uncertaintyPct: choice.uncertaintyPct,
      possible: choice.possible,
      marginal: choice.marginal,
      targetPct: target,
      reason: choice.reason || null,
    };
  }

  function sectorClass(input) {
    const gate = core.canClassifySector({
      product: input.product,
      cells: input.cells,
      officialClass: input.officialClass,
      validation: input.validation,
      minCells: input.minCells,
    });
    const evaluation = core.evaluateClass({
      officialClass: input.officialClass,
      slopePct: input.slopePct,
      rules: input.rules,
    });
    let status = gate.status;
    if (evaluation.status === "no determinable") status = "no determinable";
    else if (gate.status === "no apto") status = "no apto";
    else if (gate.status === "resolucion insuficiente") status = "resolucion insuficiente";
    else if (!input.validation || input.validation.status !== "validado") status = "no validado";
    else status = "propuesta";
    return {
      ...evaluation,
      status,
      semaforo: status === "no apto" || status === "no determinable" || status === "resolucion insuficiente"
        ? "sin datos"
        : evaluation.semaforo,
      canConfirm: false,
      minCells: input.minCells,
      reasons: gate.reasons,
    };
  }

  function buildWarnings(input) {
    const warnings = [];
    if (input.product === "DSM") {
      warnings.push("DSM: pendiente de superficie (incluye vegetacion y edificaciones). No es apta para clase agrologica.");
    }
    if (!input.validationOk) {
      warnings.push("Sin validacion de suelo desnudo con huellas: el resultado queda como no validado.");
    }
    if (!Number.isFinite(Number(input.verticalAccuracyM)) || Number(input.verticalAccuracyM) <= 0) {
      warnings.push("Falta el error vertical LE90 declarado: no se puede estimar la incertidumbre de la pendiente.");
    }
    if (optionalNumber(input.acquisitionYear) === null) {
      warnings.push("Falta el ano de captura del DEM.");
    }
    if (!input.license || input.license === "No declarada") {
      warnings.push("Falta la licencia o autorizacion del DEM.");
    }
    if (!input.officialClass) {
      warnings.push("Sin carta de suelos IGAC/UPRA: la clase oficial es no determinable. La pendiente sola no define la clase.");
    } else if (input.officialClass === "V" || input.officialClass === "VIII") {
      warnings.push(
        `La clase oficial ${input.officialClass} requiere evidencia de limitantes especiales (inundacion, pedregosidad, salinidad u otras). `
        + "El DEM no la determina: la propuesta queda sujeta a la carta de suelos y a revision profesional."
      );
    }
    if (input.window && input.window.uncertaintyPct !== null && input.window.uncertaintyPct > 3) {
      warnings.push(
        `Incertidumbre orientativa de la pendiente ± ${round(input.window.uncertaintyPct, 2)} %: `
        + "no permite distinguir con confianza el umbral de 3 %."
      );
    }
    if (input.window && input.window.possible === false) {
      warnings.push(input.window.reason || "La incertidumbre supera el objetivo de calculo.");
    }
    if (input.resolutionM > 12.5) {
      warnings.push(
        `Resolucion de ${round(input.resolutionM, 1)} m: sirve para pendiente general, no para umbrales finos de 3 % o 7 %.`
      );
    }
    if (input.nodataPct > 2) {
      warnings.push(`El ${round(input.nodataPct, 1)} % de las celdas del predio no tiene dato (NODATA) y se excluyo del calculo.`);
    }
    if (input.officialClass && input.sector && input.sector.cells < input.minCells) {
      warnings.push(`El sector tiene ${input.sector.cells} celdas validas; el minimo es ${input.minCells}. No se clasifica.`);
    }
    warnings.push("La clase oficial IGAC/UPRA es la base; la pendiente solo puede empeorarla. La app no firma ni certifica la clase.");
    return warnings;
  }

  /**
   * Analiza un DEM ya parseado.
   * @param {object} input
   * @param {object} input.grid  grilla de dem-file.js
   * @param {Array}  input.polygon anillo [{lat, lon}]
   * @param {object} input.dem    declaracion del usuario
   * @param {object} [input.options]
   * @param {Function} [input.onProgress]
   */
  async function analyze(input) {
    const options = input || {};
    const grid = options.grid;
    if (!grid || !grid.data || !grid.width || !grid.height) fail("Falta la grilla DEM.");
    const ring = uniqueRing(options.polygon);
    if (ring.length < 3) fail("El predio necesita al menos 3 vertices para calcular la pendiente.", "DEM_POLYGON");
    const dem = options.dem || {};
    const opts = options.options || {};
    const minCells = Number.isFinite(Number(opts.minCells)) ? Number(opts.minCells) : DEFAULT_MIN_CELLS;
    const progress = typeof options.onProgress === "function" ? options.onProgress : null;
    const report = (stage, pct, message) => { if (progress) progress(stage, pct, message); };

    const bbox = bboxOf([ring]);
    ensureCoverage(grid, bbox);
    const lat0 = (bbox.south + bbox.north) / 2;
    const size = cellSizeMeters(grid, lat0);
    const resolutionM = size.resolutionM;
    const polygonAreaHa = sphericalAreaM2(ring) / 10000;
    const window = pickWindow({
      resolutionM,
      windowM: opts.windowM,
      verticalAccuracyM: dem.verticalAccuracyM,
      targetPct: opts.targetPct,
    });

    report("clip", 10, "Recortando el DEM al predio");
    const margin = Math.max(2, window.radius + 1);
    const win = clipGrid(grid, bbox, margin);

    report("raster", 22, "Rasterizando el poligono");
    const mask = new Uint8Array(win.width * win.height);
    const polygonCells = rasterizeRing(ring, win, mask);
    if (!polygonCells) fail("El poligono no cubre ninguna celda del DEM.", "DEM_POLYGON");

    report("slope", 40, "Calculando pendiente");
    const smooth = window.radius > 0 ? maskedBlur(win.data, win.width, win.height, window.radius) : win.data;
    const slope = core.hornSlope(smooth, win.width, win.height, size.cellXm, size.cellYm);

    const overall = core.slopeStats(slope, mask);
    const zonal = core.zonalStats(slope, win.width, win.height, mask);
    let validCells = 0;
    let nodataCells = 0;
    for (let i = 0; i < mask.length; i += 1) {
      if (!mask[i]) continue;
      if (Number.isFinite(slope[i])) validCells += 1;
      else nodataCells += 1;
    }
    const nodataPct = polygonCells ? (nodataCells / polygonCells) * 100 : 0;
    const cellAreaM2 = size.cellXm * size.cellYm;
    const cellAreaHa = (validCells * cellAreaM2) / 10000;

    const declaredValidation = dem.validation || {};
    const declaredN = Number(declaredValidation.n);
    const declaredBias = optionalNumber(declaredValidation.biasM);
    const validationInput = {
      status: declaredValidation.status === "validado"
        && Number.isFinite(declaredN) && declaredN > 0
        && declaredBias !== null ? "validado" : "pendiente",
      n: Number.isFinite(declaredN) ? declaredN : 0,
      biasM: declaredBias,
      rmseM: optionalNumber(declaredValidation.rmseM),
      source: declaredValidation.source || null,
      date: declaredValidation.date || null,
      declared: true,
    };
    const validation = core.validateDtm({
      product: dem.product,
      bareEarth: dem.bareEarth,
      resolutionM,
      validation: validationInput,
    });

    report("sectors", 70, "Evaluando el predio");
    const officialClass = options.officialClass || dem.officialClass || null;
    const slopePct = Number.isFinite(overall.p95Pct) ? overall.p95Pct : overall.meanPct;
    const classResult = sectorClass({
      product: dem.product,
      cells: validCells,
      officialClass,
      validation: validationInput,
      slopePct,
      minCells,
      rules: options.rules,
    });

    const sector = {
      id: "predio",
      name: options.sectorName || "Predio completo",
      cells: validCells,
      areaHa: round(cellAreaHa, 4),
      areaPolygonHa: round(polygonAreaHa, 4),
      slope: {
        count: overall.count,
        meanPct: overall.meanPct === null ? null : round(overall.meanPct, 2),
        p50Pct: overall.p50Pct === null ? null : round(overall.p50Pct, 2),
        p95Pct: overall.p95Pct === null ? null : round(overall.p95Pct, 2),
        maxPct: overall.maxPct === null ? null : round(overall.maxPct, 2),
        classesPct: Object.fromEntries(Object.entries(zonal.classesPct).map(([key, value]) => [key, round(value, 1)])),
        uncertaintyPct: window.uncertaintyPct === null ? null : round(window.uncertaintyPct, 2),
      },
      class: {
        status: classResult.status,
        officialClass: classResult.officialClass,
        slopeClass: classResult.slopeClass,
        proposedClass: classResult.proposedClass,
        finalClass: dem.product === "DTM" ? classResult.finalClass : null,
        limitingFactor: classResult.limitingFactor,
        semaforo: classResult.semaforo,
        delta: classResult.delta,
        canConfirm: false,
        basis: "pendiente p95 dentro del sector",
      },
    };

    const warnings = buildWarnings({
      product: dem.product,
      validationOk: validation.ok,
      officialClass,
      window,
      resolutionM,
      nodataPct,
      sector,
      minCells,
      verticalAccuracyM: dem.verticalAccuracyM,
      acquisitionYear: dem.acquisitionYear,
      license: dem.license,
    });

    report("hash", 88, "Firmando el resultado");
    const summary = core.buildSummary({
      points: ring,
      rulesId: options.rulesId || "co-igac-upra-2026.1",
      dem: {
        sourceId: dem.sourceId || "byod",
        product: dem.product,
        resolutionM: round(resolutionM, 3),
        verticalAccuracyM: dem.verticalAccuracyM ?? null,
        acquisitionYear: dem.acquisitionYear ?? null,
        windowM: window.windowM,
        algorithm: "Horn 3x3",
      },
      sectors: [sector],
    });
    const declaration = core.canonicalize({
      fileName: dem.fileName || null,
      format: dem.format || null,
      license: dem.license || null,
      attribution: dem.attribution || null,
      validationStatus: validation.status,
    });
    const hash = await core.sha256Hex(core.canonicalJson({ summary, declaration }));

    const result = {
      ok: true,
      computeVersion: COMPUTE_VERSION,
      coreVersion: core.DEM_CORE_VERSION,
      computedAt: new Date().toISOString(),
      meta: {
        fileName: dem.fileName || null,
        format: dem.format || grid.meta && grid.meta.format || null,
        crs: grid.crs || "EPSG:4326",
        width: grid.width,
        height: grid.height,
        clipWidth: win.width,
        clipHeight: win.height,
        cellXm: round(size.cellXm, 3),
        cellYm: round(size.cellYm, 3),
        resolutionM: round(resolutionM, 3),
        windowM: round(window.windowM, 2),
        effectiveWindowM: round(window.effectiveWindowM, 2),
        smoothingRadiusCells: window.radius,
        algorithm: "Horn 3x3",
        cells: polygonCells,
        validCells,
        nodataCells,
        nodataPct: round(nodataPct, 2),
        areaHa: round(cellAreaHa, 4),
        areaPolygonHa: round(polygonAreaHa, 4),
        bbox: {
          west: round(win.west, 8),
          south: round(win.north - win.height * win.cellY, 8),
          east: round(win.west + win.width * win.cellX, 8),
          north: round(win.north, 8),
        },
      },
      dem: {
        sourceId: dem.sourceId || "byod",
        name: dem.name || "DEM propio",
        product: dem.product,
        bareEarth: dem.bareEarth === true,
        resolutionM: round(resolutionM, 3),
        declaredResolutionM: optionalNumber(dem.declaredResolutionM),
        verticalAccuracyM: optionalNumber(dem.verticalAccuracyM),
        acquisitionYear: optionalNumber(dem.acquisitionYear),
        publicationYear: optionalNumber(dem.publicationYear),
        method: dem.method || "No declarado",
        license: dem.license || "No declarada",
        attribution: dem.attribution || "No declarada",
        commercialUse: dem.commercialUse ?? null,
      },
      validation,
      slope: {
        count: overall.count,
        meanPct: overall.meanPct === null ? null : round(overall.meanPct, 2),
        p50Pct: overall.p50Pct === null ? null : round(overall.p50Pct, 2),
        p95Pct: overall.p95Pct === null ? null : round(overall.p95Pct, 2),
        maxPct: overall.maxPct === null ? null : round(overall.maxPct, 2),
        classesPct: sector.slope.classesPct,
        uncertaintyPct: window.uncertaintyPct === null ? null : round(window.uncertaintyPct, 2),
        targetPct: window.targetPct,
        windowPossible: window.possible,
        windowMarginal: window.marginal,
      },
      sectors: [sector],
      warnings,
      rulesId: options.rulesId || "co-igac-upra-2026.1",
      hash,
      summary,
    };

    report("done", 100, "Listo");
    return result;
  }

  return {
    COMPUTE_VERSION,
    DEFAULT_WINDOWS,
    MAX_COMPUTE_CELLS,
    analyze,
    uniqueRing,
    bboxOf,
    sphericalAreaM2,
    cellSizeMeters,
    ensureCoverage,
    clipGrid,
    rasterizeRing,
    maskedBlur,
    pickWindow,
    sectorClass,
  };
});
