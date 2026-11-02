/* ============================================================
   CAMPO VERDE JRB · calculo DEM para BYOD
   Recorta el DEM al predio o a los sectores, rasteriza poligonos
   con huecos y multipoligonos (regla par-impar), calcula pendiente
   Horn 3x3 con ventana completa y collar, estadistica zonal por
   area, clase agrologica asistida y hash reproducible.
   Sin DOM. Se usa desde Node y desde el Web Worker.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const core = (typeof module === "object" && module.exports)
    ? require("./dem-core.js")
    : (root && root.CVDem);
  const contract = (typeof module === "object" && module.exports)
    ? require("./dem-contract.js")
    : (root && root.CVDemContract);
  const api = factory(core, contract);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CVDemCompute = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core, contract) {
  "use strict";

  if (!core) throw new Error("CVDemCompute necesita dem-core.js.");

  const COMPUTE_VERSION = "0.2.0";
  const EARTH_R = 6371008.8;
  const EARTH_M_PER_DEG = 111195.0802335329;
  const DEG = Math.PI / 180;
  const DEFAULT_WINDOWS = [10, 25, 50];
  const MAX_COMPUTE_CELLS = 6000000;
  const DEFAULT_MIN_CELLS = 100;
  const DEFAULT_TARGET_PCT = 7;
  const DEFAULT_RULES_ID = "co-igac-upra-2026.1";

  function fail(message, code) {
    const error = new Error(message);
    error.code = code || "DEM_COMPUTE";
    throw error;
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  }

  function roundOrNull(value, digits) {
    return Number.isFinite(Number(value)) ? round(value, digits) : null;
  }

  function roundMap(map, digits) {
    const out = {};
    Object.keys(map || {}).forEach((key) => {
      if (Number.isFinite(Number(map[key]))) out[key] = round(map[key], digits);
    });
    return out;
  }

  function optionalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isGeographic(grid) {
    const crs = String(grid && grid.crs ? grid.crs : "EPSG:4326");
    if (/4326|WGS|geographic|geografico/i.test(crs)) return true;
    if (/EPSG:3857|3857|UTM|projected|proyectad/i.test(crs)) return false;
    return true;
  }

  /* ---------- Geometria y rasterizacion ---------- */

  function normalizeRing(points) {
    if (!Array.isArray(points)) return [];
    const ring = [];
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      let lat;
      let lon;
      if (Array.isArray(point)) {
        lon = Number(point[0]);
        lat = Number(point[1]);
      } else if (point && typeof point === "object") {
        lat = Number(point.lat);
        lon = Number(point.lon);
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const last = ring[ring.length - 1];
      if (last && Math.abs(last.lat - lat) < 1e-12 && Math.abs(last.lon - lon) < 1e-12) continue;
      ring.push({ lat, lon });
    }
    if (ring.length > 1) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (Math.abs(first.lat - last.lat) < 1e-12 && Math.abs(first.lon - last.lon) < 1e-12) ring.pop();
    }
    return ring;
  }

  // Devuelve un arreglo de poligonos; cada poligono es [anilloExterior, ...huecos].
  // Acepta GeoJSON Polygon/MultiPolygon, un anillo [{lat,lon}], [lon,lat] o
  // { ring, holes } para no perder los huecos.
  function normalizeGeometry(input) {
    if (!input) return null;
    if (Array.isArray(input)) {
      const ring = normalizeRing(input);
      return ring.length >= 3 ? [[ring]] : null;
    }
    if (input.type === "Polygon" && Array.isArray(input.coordinates)) {
      const rings = input.coordinates.map(normalizeRing).filter((ring) => ring.length >= 3);
      return rings.length ? [rings] : null;
    }
    if (input.type === "MultiPolygon" && Array.isArray(input.coordinates)) {
      const polygons = input.coordinates.map((polygon) => {
        if (!Array.isArray(polygon)) return null;
        const rings = polygon.map(normalizeRing).filter((ring) => ring.length >= 3);
        return rings.length ? rings : null;
      }).filter(Boolean);
      return polygons.length ? polygons : null;
    }
    if (input.ring) {
      const outer = normalizeRing(input.ring);
      if (outer.length < 3) return null;
      const holes = Array.isArray(input.holes)
        ? input.holes.map(normalizeRing).filter((ring) => ring.length >= 3)
        : [];
      return [[outer, ...holes]];
    }
    return null;
  }

  function flattenRings(polygons) {
    const rings = [];
    polygons.forEach((polygon) => polygon.forEach((ring) => rings.push(ring)));
    return rings;
  }

  function bboxOfPolygons(polygons) {
    let west = Infinity;
    let east = -Infinity;
    let south = Infinity;
    let north = -Infinity;
    flattenRings(polygons).forEach((ring) => {
      ring.forEach((point) => {
        if (point.lon < west) west = point.lon;
        if (point.lon > east) east = point.lon;
        if (point.lat < south) south = point.lat;
        if (point.lat > north) north = point.lat;
      });
    });
    return { west, east, south, north };
  }

  function unionBbox(boxes) {
    return boxes.reduce((union, box) => ({
      west: Math.min(union.west, box.west),
      east: Math.max(union.east, box.east),
      south: Math.min(union.south, box.south),
      north: Math.max(union.north, box.north),
    }), { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity });
  }

  // Area esferica del anillo (m2). Aproximacion de exceso esferico por
  // trapecios; suficiente para predios y para contrastar el conteo de celdas.
  function sphericalAreaM2(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    let sum = 0;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      sum += (b.lon - a.lon) * DEG * (2 + Math.sin(a.lat * DEG) + Math.sin(b.lat * DEG));
    }
    return Math.abs(sum * EARTH_R * EARTH_R / 2);
  }

  function polygonAreaM2(polygons) {
    return polygons.reduce((total, polygon) => {
      if (!polygon.length) return total;
      const outer = sphericalAreaM2(polygon[0]);
      const holes = polygon.slice(1).reduce((sum, ring) => sum + sphericalAreaM2(ring), 0);
      return total + Math.max(0, outer - holes);
    }, 0);
  }

  function cellSizeMeters(grid, latitude) {
    if (!isGeographic(grid)) {
      const cellXm = Math.abs(Number(grid.cellX));
      const cellYm = Math.abs(Number(grid.cellY));
      if (!(cellXm > 0) || !(cellYm > 0)) fail("El tamano de celda del DEM no es valido.");
      return { cellXm, cellYm, resolutionM: (cellXm + cellYm) / 2 };
    }
    const lat = Number.isFinite(latitude) ? latitude : 0;
    const cellXm = Math.abs(grid.cellX) * EARTH_M_PER_DEG * Math.cos(lat * Math.PI / 180);
    const cellYm = Math.abs(grid.cellY) * EARTH_M_PER_DEG;
    if (!(cellXm > 0) || !(cellYm > 0)) fail("El tamano de celda del DEM no es valido.");
    return { cellXm, cellYm, resolutionM: (cellXm + cellYm) / 2 };
  }

  // Area exacta de una celda geografica en una franja de latitud. La
  // aproximacion local x*y se sesga en predios grandes; esta no.
  function cellAreaM2(grid, row) {
    const cellX = Math.abs(Number(grid.cellX));
    const cellY = Math.abs(Number(grid.cellY));
    if (!isGeographic(grid)) return cellX * cellY;
    const north = Number(grid.north) - row * cellY;
    const south = north - cellY;
    const dLon = cellX * DEG;
    return EARTH_R * EARTH_R * dLon
      * Math.abs(Math.sin(north * DEG) - Math.sin(south * DEG));
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

  // Rasteriza todos los anillos con regla par-impar. Los huecos se restan
  // de forma natural y los multipoligonos suman sus componentes.
  // Una celda entra si su centro cae dentro: borde izquierdo/inferior
  // inclusivo, derecho/superior exclusivo.
  function rasterizePolygons(polygons, win, mask) {
    const bbox = bboxOfPolygons(polygons);
    const eps = 1e-12;
    const west = win.west;
    const east = win.west + win.width * win.cellX;
    const north = win.north;
    const south = win.north - win.height * win.cellY;
    const intersects = !(bbox.east < west - eps || bbox.west > east + eps
      || bbox.north < south - eps || bbox.south > north + eps);
    const clipped = bbox.west < west - eps || bbox.east > east + eps
      || bbox.south < south - eps || bbox.north > north + eps;
    if (!intersects) {
      return { cells: 0, clipped: true, bbox, intersects: false, row0: 0, row1: -1, col0: 0, col1: -1 };
    }

    let row0 = Math.max(0, Math.ceil((north - bbox.north) / win.cellY - 0.5));
    let row1 = Math.min(win.height - 1, Math.floor((north - bbox.south) / win.cellY - 0.5));
    let col0 = Math.max(0, Math.ceil((bbox.west - west) / win.cellX - 0.5));
    let col1 = Math.min(win.width - 1, Math.floor((bbox.east - west) / win.cellX - 0.5));
    if (row0 > row1 || col0 > col1) {
      return { cells: 0, clipped, bbox, intersects: true, row0, row1, col0, col1 };
    }

    const edges = [];
    flattenRings(polygons).forEach((ring) => {
      for (let i = 0; i < ring.length; i += 1) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (a.lat === b.lat) continue;
        edges.push({
          a,
          b,
          ymin: Math.min(a.lat, b.lat),
          ymax: Math.max(a.lat, b.lat),
        });
      }
    });

    let cells = 0;
    const xs = [];
    for (let row = row0; row <= row1; row += 1) {
      const lat = north - (row + 0.5) * win.cellY;
      xs.length = 0;
      for (let e = 0; e < edges.length; e += 1) {
        const edge = edges[e];
        if (lat < edge.ymin || lat >= edge.ymax) continue;
        const t = (lat - edge.a.lat) / (edge.b.lat - edge.a.lat);
        xs.push(edge.a.lon + t * (edge.b.lon - edge.a.lon));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const rowStart = row * win.width;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const left = Math.max(col0, Math.ceil((xs[k] - west) / win.cellX - 0.5));
        const right = Math.min(col1, Math.ceil((xs[k + 1] - west) / win.cellX - 0.5) - 1);
        for (let col = left; col <= right; col += 1) {
          const index = rowStart + col;
          if (!mask[index]) {
            mask[index] = 1;
            cells += 1;
          }
        }
      }
    }
    return { cells, clipped, bbox, intersects: true, row0, row1, col0, col1 };
  }

  // Compatibilidad con la API anterior: un solo anillo exterior.
  function rasterizeRing(ring, win, mask) {
    const normalized = normalizeRing(ring);
    if (normalized.length < 3) return 0;
    return rasterizePolygons([[normalized]], win, mask).cells;
  }

  /* ---------- Ventana completa y collar ---------- */

  // Media movil de elevacion con ventana completa. Si falta una celda,
  // hay NODATA/NaN o la ventana toca el borde, la salida es NaN. No se
  // rellenan ventanas parciales: eso inventaria gradientes en el borde.
  function fullWindowMean(z, width, height, radius) {
    const r = Math.max(0, Math.trunc(radius));
    const total = width * height;
    const out = new Float32Array(total).fill(NaN);
    if (!r) {
      for (let i = 0; i < total; i += 1) out[i] = Number.isFinite(z[i]) ? z[i] : NaN;
      return out;
    }
    const span = 2 * r + 1;
    const tmp = new Float32Array(total).fill(NaN);

    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      let sum = 0;
      let count = 0;
      for (let k = -r; k <= r; k += 1) {
        if (k >= 0 && k < width) {
          const value = z[row + k];
          if (Number.isFinite(value)) { sum += value; count += 1; }
        }
      }
      for (let x = 0; x < width; x += 1) {
        tmp[row + x] = count === span ? sum / span : NaN;
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
        out[y * width + x] = count === span ? sum / span : NaN;
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
    const resolutionM = Number(input.resolutionM);
    if (!(resolutionM > 0)) fail("La resolucion del DEM no es valida.", "DEM_RESOLUTION");
    const requested = core.nearestWindow(input.windowM);
    const windows = requested ? [requested] : DEFAULT_WINDOWS.slice();
    const target = Number.isFinite(Number(input.targetPct)) && Number(input.targetPct) > 0
      ? Number(input.targetPct)
      : DEFAULT_TARGET_PCT;
    const choice = core.chooseWindow({
      windows,
      verticalAccuracyM: input.verticalAccuracyM,
      resolutionM,
      targetPct: target,
    });
    const windowM = core.nearestWindow(choice.windowM) || requested || DEFAULT_WINDOWS[1];
    const radius = Math.max(0, Math.round((windowM / resolutionM - 1) / 2));
    const effectiveBaselineM = core.effectiveBaselineM(windowM, resolutionM);
    return {
      windowM,
      radius,
      radiusCells: radius,
      effectiveBaselineM,
      effectiveWindowM: effectiveBaselineM,
      uncertaintyPct: core.slopeUncertaintyPct(input.verticalAccuracyM, windowM, resolutionM),
      possible: Boolean(choice.possible),
      marginal: Boolean(choice.marginal),
      targetPct: target,
      reason: choice.reason || null,
    };
  }

  /* ---------- Zonal por area ---------- */

  function boundsOfMask(mask, width, height) {
    let row0 = height;
    let row1 = -1;
    let col0 = width;
    let col1 = -1;
    for (let row = 0; row < height; row += 1) {
      const start = row * width;
      for (let col = 0; col < width; col += 1) {
        if (!mask[start + col]) continue;
        if (row < row0) row0 = row;
        if (row > row1) row1 = row;
        if (col < col0) col0 = col;
        if (col > col1) col1 = col;
      }
    }
    return { row0, row1, col0, col1 };
  }

  function zonalSector(input) {
    const mask = input.mask;
    const slope = input.slope;
    const win = input.win;
    const bands = input.bands || core.DEFAULT_BANDS;
    const minCells = Number.isFinite(Number(input.minCells))
      ? Number(input.minCells)
      : DEFAULT_MIN_CELLS;
    const raster = input.raster || {};
    const row0 = Math.max(0, Number.isFinite(raster.row0) ? raster.row0 : 0);
    const row1 = Math.min(win.height - 1, Number.isFinite(raster.row1) ? raster.row1 : win.height - 1);
    const col0 = Math.max(0, Number.isFinite(raster.col0) ? raster.col0 : 0);
    const col1 = Math.min(win.width - 1, Number.isFinite(raster.col1) ? raster.col1 : win.width - 1);

    let cellsGross = 0;
    let cells = 0;
    let areaGrossM2 = 0;
    let areaEffectiveM2 = 0;
    const counts = {};
    const classAreaM2 = {};
    bands.forEach((band) => {
      counts[band.id] = 0;
      classAreaM2[band.id] = 0;
    });

    for (let row = row0; row <= row1; row += 1) {
      const cellArea = cellAreaM2(win, row);
      const rowStart = row * win.width;
      for (let col = col0; col <= col1; col += 1) {
        const index = rowStart + col;
        if (!mask[index]) continue;
        cellsGross += 1;
        areaGrossM2 += cellArea;
        const value = slope[index];
        if (!Number.isFinite(value)) continue;
        cells += 1;
        areaEffectiveM2 += cellArea;
        const band = core.bandForSlope(value, bands);
        if (band) {
          counts[band.id] += 1;
          classAreaM2[band.id] += cellArea;
        }
      }
    }

    const stats = core.slopeStats(slope, mask);
    const classesPct = {};
    const classesHa = {};
    const classShare = {};
    bands.forEach((band) => {
      classesPct[band.id] = cells ? (counts[band.id] / cells) * 100 : 0;
      if (classAreaM2[band.id] > 0) {
        classesHa[band.id] = classAreaM2[band.id] / 10000;
        classShare[band.id] = areaEffectiveM2 > 0 ? classAreaM2[band.id] / areaEffectiveM2 : 0;
      }
    });

    const intersects = raster.intersects !== false;
    let status;
    if (!intersects) status = "no_coverage";
    else if (cellsGross === 0) status = "insufficient_resolution";
    else if (cells === 0) status = "no_valid_cells";
    else if (cells < minCells) status = "insufficient_resolution";
    else status = "ok";

    return {
      status,
      cells,
      cellsGross,
      clipped: Boolean(input.clipped ?? raster.clipped),
      areaHa: areaEffectiveM2 / 10000,
      areaGrossHa: areaGrossM2 / 10000,
      coverage: areaGrossM2 > 0 ? areaEffectiveM2 / areaGrossM2 : 0,
      slope: {
        count: stats.count,
        meanPct: stats.meanPct,
        p50Pct: stats.p50Pct,
        p95Pct: stats.p95Pct,
        maxPct: stats.maxPct,
        classesPct,
        classesHa,
        classShare,
        counts,
      },
    };
  }

  function buildSlopeBlock(zonal, window) {
    return {
      count: zonal.slope.count,
      meanPct: roundOrNull(zonal.slope.meanPct, 2),
      p50Pct: roundOrNull(zonal.slope.p50Pct, 2),
      p95Pct: roundOrNull(zonal.slope.p95Pct, 2),
      maxPct: roundOrNull(zonal.slope.maxPct, 2),
      classesPct: roundMap(zonal.slope.classesPct, 1),
      classesHa: roundMap(zonal.slope.classesHa, 4),
      classShare: roundMap(zonal.slope.classShare, 6),
      uncertaintyPct: roundOrNull(window.uncertaintyPct, 2),
      groundConfidencePct: round(zonal.coverage * 100, 2),
      targetPct: window.targetPct,
      windowPossible: window.possible,
      windowMarginal: window.marginal,
    };
  }

  /* ---------- Clase agrologica asistida ---------- */

  function sectorClass(input) {
    const validationOk = input.validation
      && (input.validation.status === "validado" || input.validation.status === "validated");
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

    let statusEs;
    let limitingFactor = evaluation.limitingFactor;
    let proposedClass = evaluation.proposedClass;
    let slopeClass = evaluation.slopeClass;

    if (input.product !== "DTM") {
      statusEs = "no apto";
      limitingFactor = "producto DSM";
      proposedClass = null;
      slopeClass = null;
    } else if (input.sectorStatus === "no_coverage") {
      statusEs = "no determinable";
      limitingFactor = "sin cobertura";
      proposedClass = null;
      slopeClass = null;
    } else if (input.sectorStatus === "no_valid_cells") {
      statusEs = "no determinable";
      limitingFactor = "sin celdas validas";
      proposedClass = null;
      slopeClass = null;
    } else if (gate.status === "resolucion insuficiente" || input.sectorStatus === "insufficient_resolution") {
      statusEs = "resolucion insuficiente";
      limitingFactor = "resolucion insuficiente";
      proposedClass = null;
      slopeClass = null;
    } else if (!input.officialClass) {
      statusEs = "no determinable";
      limitingFactor = "falta carta de suelos";
      proposedClass = null;
      slopeClass = null;
    } else if (!validationOk) {
      statusEs = "no validado";
      limitingFactor = "validacion";
    } else if (input.window && input.window.possible === false) {
      statusEs = "limitante topografica";
      limitingFactor = "pendiente";
    } else {
      statusEs = "propuesta";
    }

    const pair = core.statusPair("class", statusEs);
    const semaforo = proposedClass ? evaluation.semaforo : "sin datos";
    const consistency = core.consistencyFromSemaforo(semaforo);
    let consistencyNote;
    if (statusEs === "no apto") {
      consistencyNote = "DSM de superficie: no se evalua clase agrologica.";
    } else if (statusEs === "no determinable") {
      consistencyNote = "Falta la base oficial o no hay datos suficientes para comparar.";
    } else if (statusEs === "resolucion insuficiente") {
      consistencyNote = "El sector no alcanza el minimo de celdas para clasificar.";
    } else if (statusEs === "no validado") {
      consistencyNote = "La pendiente es una referencia; falta validacion de suelo desnudo con huellas.";
    } else if (statusEs === "limitante topografica") {
      consistencyNote = "La incertidumbre de la pendiente no permite distinguir el umbral con confianza.";
    } else {
      consistencyNote = "La clase propuesta es la mas restrictiva entre la oficial y la pendiente.";
    }

    return {
      status: pair.status,
      statusEs,
      officialClass: input.officialClass || null,
      slopeClass: slopeClass || null,
      proposedClass: proposedClass || null,
      finalClass: null,
      limitingFactor,
      semaforo,
      consistency,
      consistencyNote,
      delta: evaluation.delta,
      canConfirm: false,
      basis: "pendiente p95 dentro del sector",
      minCells: input.minCells,
      reasons: gate.reasons,
      ruleSetId: input.rulesId || null,
      officialSource: "IGAC/UPRA",
      officialScale: "1:100000",
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
    if (input.window && input.window.uncertaintyPct !== null && input.window.uncertaintyPct !== undefined) {
      if (input.window.marginal) {
        warnings.push(
          `Resultado marginal: incertidumbre orientativa de la pendiente ± ${round(input.window.uncertaintyPct, 2)} % `
          + `frente a un objetivo de ${input.window.targetPct} %. No permite distinguir umbrales finos.`
        );
      } else if (input.window.uncertaintyPct > 3) {
        warnings.push(
          `Incertidumbre orientativa de la pendiente ± ${round(input.window.uncertaintyPct, 2)} %: `
          + "no permite distinguir con confianza el umbral de 3 %."
        );
      }
      if (input.window.possible === false) {
        warnings.push(input.window.reason || "La incertidumbre supera el objetivo de calculo.");
      }
    }
    if (input.resolutionM > 12.5) {
      warnings.push(
        `Resolucion de ${round(input.resolutionM, 1)} m: sirve para pendiente general, no para umbrales finos de 3 % o 7 %.`
      );
    }
    if (input.nodataPct > 2) {
      warnings.push(
        `El ${round(input.nodataPct, 1)} % de las celdas del predio no tiene pendiente calculable `
        + "(NODATA o borde de la ventana) y se excluyo del calculo."
      );
    }
    if (input.coverage !== null && input.coverage < 0.95) {
      warnings.push(
        `Cobertura de datos del ${round(input.coverage * 100, 1)} %: `
        + "las celdas sin dato no se usan para la pendiente ni para la clase."
      );
    }
    warnings.push("La clase oficial IGAC/UPRA es la base; la pendiente solo puede empeorarla. La app no firma ni certifica la clase.");
    return warnings;
  }

  /* ---------- Analisis ---------- */

  /**
   * Analiza un DEM ya parseado.
   * @param {object} input
   * @param {object} input.grid  grilla de dem-file.js
   * @param {Array}  [input.polygon] anillo [{lat, lon}] para un solo predio
   * @param {object} [input.geometry] GeoJSON Polygon/MultiPolygon
   * @param {Array}  [input.sectors] [{id,name,crop,geometry|ring,holes}]
   * @param {object} input.dem    declaracion del usuario
   * @param {object} [input.options]
   * @param {Function} [input.onProgress]
   */
  async function analyze(input) {
    const started = Date.now();
    const options = input || {};
    const grid = options.grid;
    if (!grid || !grid.data || !grid.width || !grid.height) fail("Falta la grilla DEM.");
    const dem = options.dem || {};
    const opts = options.options || {};
    const minCells = Number.isFinite(Number(opts.minCells)) ? Number(opts.minCells) : DEFAULT_MIN_CELLS;
    const rules = opts.rules || core.DEFAULT_RULES;
    const bands = rules.slopeBands || core.DEFAULT_BANDS;
    const rulesId = opts.rulesId || options.rulesId || DEFAULT_RULES_ID;
    const officialClass = options.officialClass || dem.officialClass || null;
    const progress = typeof options.onProgress === "function" ? options.onProgress : null;
    const report = (stage, pct, message) => { if (progress) progress(stage, pct, message); };

    /* 1. Definir predio o sectores */
    const explicitSectors = Array.isArray(options.sectors) && options.sectors.length > 0;
    let definitions;
    if (explicitSectors) {
      const ids = new Set();
      definitions = options.sectors.map((sector, index) => {
        const source = sector || {};
        const geometryInput = source.geometry
          || (source.ring ? source : source.polygon);
        const polygons = normalizeGeometry(geometryInput);
        if (!polygons) {
          fail(`El sector ${source.id || index + 1} no tiene un poligono valido.`, "DEM_POLYGON");
        }
        const id = String(source.id || `sector-${index + 1}`);
        if (ids.has(id)) fail(`El identificador de sector "${id}" esta repetido.`, "DEM_SECTOR");
        ids.add(id);
        const bbox = bboxOfPolygons(polygons);
        return {
          id,
          name: source.name || `Sector ${index + 1}`,
          crop: source.crop || null,
          polygons,
          bbox,
          areaPolygonHa: polygonAreaM2(polygons) / 10000,
        };
      });
    } else {
      const geometryInput = options.geometry || options.polygon;
      const polygons = normalizeGeometry(geometryInput);
      if (!polygons) {
        fail("El predio necesita al menos 3 vertices para calcular la pendiente.", "DEM_POLYGON");
      }
      const bbox = bboxOfPolygons(polygons);
      ensureCoverage(grid, bbox);
      definitions = [{
        id: "predio",
        name: options.sectorName || "Predio completo",
        crop: null,
        polygons,
        bbox,
        areaPolygonHa: polygonAreaM2(polygons) / 10000,
      }];
    }

    /* 2. Ventana de calculo y recorte */
    let clipBbox;
    if (explicitSectors) {
      const union = unionBbox(definitions.map((definition) => definition.bbox));
      clipBbox = {
        west: Math.max(union.west, grid.west),
        east: Math.min(union.east, grid.east),
        south: Math.max(union.south, grid.south),
        north: Math.min(union.north, grid.north),
      };
      if (!(clipBbox.east > clipBbox.west && clipBbox.north > clipBbox.south)) {
        fail("Ningun sector intersecta el DEM. Revisa la cobertura o el croquis.", "DEM_COVERAGE");
      }
    } else {
      clipBbox = definitions[0].bbox;
    }

    const lat0 = (clipBbox.south + clipBbox.north) / 2;
    const size = cellSizeMeters(grid, lat0);
    const resolutionM = size.resolutionM;
    const window = pickWindow({
      resolutionM,
      windowM: opts.windowM,
      verticalAccuracyM: dem.verticalAccuracyM,
      targetPct: opts.targetPct,
    });

    report("clip", 10, "Recortando el DEM al predio");
    const margin = Math.max(2, window.radius + 1);
    const win = clipGrid(grid, clipBbox, margin);

    report("slope", 40, "Calculando pendiente con ventana completa");
    const smooth = fullWindowMean(win.data, win.width, win.height, window.radius);
    const slope = core.hornSlope(smooth, win.width, win.height, size.cellXm, size.cellYm);

    /* 3. Validacion declarada */
    const declaredValidation = dem.validation || {};
    const declaredN = Number(declaredValidation.n);
    const declaredBias = optionalNumber(declaredValidation.biasM);
    const declaredStatus = declaredValidation.status === "validado" || declaredValidation.status === "validated";
    const validationInput = {
      status: declaredStatus
        && Number.isFinite(declaredN) && declaredN > 0
        && declaredBias !== null ? "validated" : "not_validated",
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
    validation.source = validationInput.source;
    validation.n = validationInput.n;
    validation.biasM = validationInput.biasM;
    validation.rmseM = validationInput.rmseM;
    validation.date = validationInput.date;

    /* 4. Zonal por sector */
    report("sectors", 70, "Evaluando sectores");
    const overallMask = new Uint8Array(win.width * win.height);
    const sectors = definitions.map((definition) => {
      const mask = new Uint8Array(win.width * win.height);
      const raster = rasterizePolygons(definition.polygons, win, mask);
      for (let i = 0; i < mask.length; i += 1) {
        if (mask[i]) overallMask[i] = 1;
      }
      const zonal = zonalSector({
        grid,
        win,
        slope,
        mask,
        bands,
        minCells,
        raster,
        clipped: raster.clipped,
      });
      const referencePct = Number.isFinite(zonal.slope.p95Pct)
        ? zonal.slope.p95Pct
        : zonal.slope.meanPct;
      const classResult = sectorClass({
        product: dem.product,
        cells: zonal.cells,
        sectorStatus: zonal.status,
        officialClass,
        validation: validationInput,
        slopePct: referencePct,
        minCells,
        rules,
        window,
        rulesId,
      });
      return {
        id: definition.id,
        name: definition.name,
        crop: definition.crop,
        cells: zonal.cells,
        cellsGross: zonal.cellsGross,
        areaHa: round(zonal.areaHa, 4),
        areaGrossHa: round(zonal.areaGrossHa, 4),
        areaPolygonHa: round(definition.areaPolygonHa, 4),
        coverage: round(zonal.coverage, 6),
        clipped: zonal.clipped,
        status: zonal.status,
        statusEs: core.statusToEs("sector", zonal.status),
        slope: zonal.cells > 0 ? buildSlopeBlock(zonal, window) : null,
        class: classResult,
      };
    });

    const overallBounds = boundsOfMask(overallMask, win.width, win.height);
    const overall = zonalSector({
      grid,
      win,
      slope,
      mask: overallMask,
      bands,
      minCells: 1,
      raster: {
        ...overallBounds,
        intersects: overallBounds.row1 >= overallBounds.row0,
        clipped: sectors.some((sector) => sector.clipped),
      },
      clipped: sectors.some((sector) => sector.clipped),
    });
    const overallSlope = buildSlopeBlock(overall, window);
    const nodataPct = overall.cellsGross > 0
      ? ((overall.cellsGross - overall.cells) / overall.cellsGross) * 100
      : 0;
    const areaPolygonHa = definitions.reduce((sum, definition) => sum + definition.areaPolygonHa, 0);
    const partial = sectors.some((sector) => sector.status !== "ok")
      || overall.status !== "ok"
      || window.possible === false;

    /* 5. Advertencias */
    const warnings = buildWarnings({
      product: dem.product,
      validationOk: validation.ok,
      officialClass,
      window,
      resolutionM,
      nodataPct,
      coverage: overall.coverage,
      verticalAccuracyM: dem.verticalAccuracyM,
      acquisitionYear: dem.acquisitionYear,
      license: dem.license,
    });
    sectors.forEach((sector) => {
      if (sector.status === "insufficient_resolution") {
        warnings.push(
          `Sector ${sector.name}: ${sector.cells} celdas validas; el minimo es ${minCells}. No se clasifica.`
        );
      } else if (sector.status === "no_valid_cells") {
        warnings.push(`Sector ${sector.name}: las celdas del sector no tienen dato valido (NODATA). No se clasifica.`);
      } else if (sector.status === "no_coverage") {
        warnings.push(`Sector ${sector.name}: queda fuera de la cobertura del DEM. No se clasifica.`);
      }
      if (sector.clipped) {
        warnings.push(`Sector ${sector.name}: el poligono se extiende fuera del DEM y se recorto a la cobertura disponible.`);
      }
    });

    /* 6. Resumen canonico y hash */
    report("hash", 88, "Firmando el resultado");
    const summary = core.buildSummary({
      points: definitions[0].polygons[0][0],
      rulesId,
      dem: {
        sourceId: dem.sourceId || "byod",
        product: dem.product,
        bareEarth: dem.bareEarth === true,
        resolutionM: round(resolutionM, 3),
        verticalAccuracyM: dem.verticalAccuracyM ?? null,
        acquisitionYear: dem.acquisitionYear ?? null,
        windowM: window.windowM,
        radiusCells: window.radius,
        effectiveBaselineM: round(window.effectiveBaselineM, 3),
        algorithm: "Horn 3x3",
        classRuleSetId: rulesId,
      },
      sectors,
    });
    const declaration = core.canonicalize({
      fileName: dem.fileName || null,
      format: dem.format || (grid.meta && grid.meta.format) || null,
      license: dem.license || null,
      attribution: dem.attribution || null,
      product: dem.product || null,
      bareEarth: dem.bareEarth === true,
      verticalAccuracyM: dem.verticalAccuracyM ?? null,
      acquisitionYear: dem.acquisitionYear ?? null,
      validationStatus: validation.status,
      validationN: validation.n || 0,
      officialClass: officialClass || null,
    });
    const hash = await core.sha256Hex(core.canonicalJson({ summary, declaration }));

    const licenseInfo = contract.licenseBlock({ dem });
    const validationInfo = contract.validationBlock({ validation, meta: {} });
    const computedAt = new Date().toISOString();

    const result = {
      ok: true,
      partial,
      computeVersion: COMPUTE_VERSION,
      coreVersion: core.DEM_CORE_VERSION,
      contractVersion: contract.CONTRACT_VERSION,
      computedAt,
      computeMs: Date.now() - started,
      resultId: `byod-${hash.slice(0, 16)}`,
      resultHash: `sha256:${hash}`,
      hash,
      hashAlgorithm: "SHA-256",
      hashKind: "dem-result-v2",
      hashCovers: ["summary", "declaration"],
      meta: {
        sourceId: dem.sourceId || "byod",
        product: dem.product,
        bareEarth: dem.bareEarth === true,
        fileName: dem.fileName || null,
        format: dem.format || (grid.meta && grid.meta.format) || null,
        crs: grid.crs || "EPSG:4326",
        width: grid.width,
        height: grid.height,
        clipWidth: win.width,
        clipHeight: win.height,
        cellXm: round(size.cellXm, 3),
        cellYm: round(size.cellYm, 3),
        resolutionM: round(resolutionM, 3),
        verticalAccuracyM: dem.verticalAccuracyM ?? null,
        acquisitionYear: dem.acquisitionYear ?? null,
        windowM: window.windowM,
        radiusCells: window.radius,
        effectiveBaselineM: round(window.effectiveBaselineM, 3),
        effectiveWindowM: round(window.effectiveBaselineM, 3),
        smoothingRadiusCells: window.radius,
        algorithm: "Horn 3x3",
        classRuleSetId: rulesId,
        license: licenseInfo,
        validation: validationInfo,
        computedAt,
        cells: overall.cellsGross,
        validCells: overall.cells,
        nodataCells: overall.cellsGross - overall.cells,
        nodataPct: round(nodataPct, 2),
        areaHa: round(overall.areaHa, 4),
        areaGrossHa: round(overall.areaGrossHa, 4),
        areaPolygonHa: round(areaPolygonHa, 4),
        coverage: round(overall.coverage, 6),
        bbox: {
          west: round(win.west, 8),
          south: round(win.north - win.height * win.cellY, 8),
          east: round(win.west + win.width * win.cellX, 8),
          north: round(win.north, 8),
        },
      },
      grid: {
        crs: grid.crs || "EPSG:4326",
        width: grid.width,
        height: grid.height,
        cellXm: round(size.cellXm, 3),
        cellYm: round(size.cellYm, 3),
        resolutionM: round(resolutionM, 3),
        clipWidth: win.width,
        clipHeight: win.height,
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
        licenseInfo,
      },
      validation,
      slope: overallSlope,
      sectors,
      warnings,
      rulesId,
      delta: null,
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
    normalizeRing,
    normalizeGeometry,
    flattenRings,
    bboxOfPolygons,
    // Alias de compatibilidad con las pruebas y llamadas anteriores.
    bboxOf: bboxOfPolygons,
    unionBbox,
    sphericalAreaM2,
    polygonAreaM2,
    cellSizeMeters,
    cellAreaM2,
    ensureCoverage,
    clipGrid,
    rasterizePolygons,
    rasterizeRing,
    fullWindowMean,
    maskedBlur: fullWindowMean,
    pickWindow,
    zonalSector,
    buildSlopeBlock,
    sectorClass,
    buildWarnings,
  };
});
