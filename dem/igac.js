/* ============================================================
   CAMPO VERDE JRB · cobertura IGAC y exportación de DEM
   Selecciona un ImageServer público del IGAC que cubra el
   polígono y construye la solicitud exportImage en EPSG:4326.
   No hace red por sí solo: el llamador usa fetch.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CVIGAC = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "1.0.0";
  const EARTH_M_PER_DEG = 111195.0802335329;
  const DEFAULT_MARGIN_M = 60;
  const DEFAULT_MAX_SIZE = 2048;
  const EPS = 1e-7;

  function invalid(message) {
    const error = new Error(message);
    error.code = "IGAC";
    throw error;
  }

  function finite(value) {
    return Number.isFinite(Number(value));
  }

  function pointLatLon(point) {
    if (!point) return null;
    if (Array.isArray(point)) {
      const lon = Number(point[0]);
      const lat = Number(point[1]);
      return finite(lat) && finite(lon) ? { lat, lon } : null;
    }
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    return finite(lat) && finite(lon) ? { lat, lon } : null;
  }

  function bboxFromPoints(points) {
    const list = Array.isArray(points) ? points : [];
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    list.forEach((point) => {
      const normalized = pointLatLon(point);
      if (!normalized) return;
      if (normalized.lon < west) west = normalized.lon;
      if (normalized.lon > east) east = normalized.lon;
      if (normalized.lat < south) south = normalized.lat;
      if (normalized.lat > north) north = normalized.lat;
    });
    if (![west, south, east, north].every(Number.isFinite)) return null;
    if (!(east > west) || !(north > south)) return null;
    return [west, south, east, north];
  }

  function bboxContains(outer, inner, epsilon = EPS) {
    if (!Array.isArray(outer) || !Array.isArray(inner)) return false;
    return inner[0] >= outer[0] - epsilon
      && inner[1] >= outer[1] - epsilon
      && inner[2] <= outer[2] + epsilon
      && inner[3] <= outer[3] + epsilon;
  }

  function bboxIntersects(a, b) {
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
  }

  function bboxArea(bbox) {
    return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
  }

  function indexItems(index) {
    if (Array.isArray(index)) return index;
    if (index && Array.isArray(index.items)) return index.items;
    return [];
  }

  function selectSource(index, polygonBbox) {
    if (!Array.isArray(polygonBbox) || polygonBbox.length !== 4) {
      invalid("El polígono no tiene un bbox válido.");
    }
    const items = indexItems(index)
      .filter((item) => item && Array.isArray(item.bbox) && item.url)
      .filter((item) => bboxContains(item.bbox, polygonBbox));
    if (!items.length) {
      const partial = indexItems(index)
        .filter((item) => item && Array.isArray(item.bbox) && item.url)
        .filter((item) => bboxIntersects(item.bbox, polygonBbox));
      return {
        source: null,
        alternatives: [],
        partial,
        reason: partial.length
          ? "Hay teselas IGAC cercanas, pero ninguna cubre todo el predio."
          : "No hay cobertura IGAC para este polígono.",
      };
    }
    items.sort((a, b) => {
      const ra = finite(a.resolutionM) ? Number(a.resolutionM) : Infinity;
      const rb = finite(b.resolutionM) ? Number(b.resolutionM) : Infinity;
      if (ra !== rb) return ra - rb;
      const ya = finite(a.year) ? Number(a.year) : -Infinity;
      const yb = finite(b.year) ? Number(b.year) : -Infinity;
      if (ya !== yb) return yb - ya;
      return bboxArea(a.bbox) - bboxArea(b.bbox);
    });
    return {
      source: items[0],
      alternatives: items.slice(1),
      partial: [],
      reason: null,
    };
  }

  function expandBbox(polygonBbox, marginM) {
    const [west, south, east, north] = polygonBbox;
    const lat0 = (south + north) / 2;
    const dLat = marginM / EARTH_M_PER_DEG;
    const dLon = marginM / (EARTH_M_PER_DEG * Math.max(0.01, Math.cos(lat0 * Math.PI / 180)));
    return [
      west - dLon,
      south - dLat,
      east + dLon,
      north + dLat,
    ];
  }

  function buildExportImageUrl(source, polygonBbox, options) {
    if (!source || !source.url) invalid("Falta la fuente IGAC.");
    if (!Array.isArray(polygonBbox) || polygonBbox.length !== 4) {
      invalid("El polígono no tiene un bbox válido.");
    }
    const opts = options || {};
    const marginM = finite(opts.marginM) && Number(opts.marginM) >= 0
      ? Number(opts.marginM)
      : DEFAULT_MARGIN_M;
    const maxSize = finite(opts.maxSize) && Number(opts.maxSize) > 1
      ? Math.trunc(Number(opts.maxSize))
      : DEFAULT_MAX_SIZE;
    const sourceResolution = finite(source.resolutionM) && Number(source.resolutionM) > 0
      ? Number(source.resolutionM)
      : 10;
    const bbox = expandBbox(polygonBbox, marginM);
    const lat0 = (bbox[1] + bbox[3]) / 2;
    const widthM = Math.max(1, (bbox[2] - bbox[0]) * EARTH_M_PER_DEG * Math.cos(lat0 * Math.PI / 180));
    const heightM = Math.max(1, (bbox[3] - bbox[1]) * EARTH_M_PER_DEG);
    let width = Math.max(2, Math.ceil(widthM / sourceResolution));
    let height = Math.max(2, Math.ceil(heightM / sourceResolution));
    const largest = Math.max(width, height);
    if (largest > maxSize) {
      const factor = largest / maxSize;
      width = Math.max(2, Math.round(width / factor));
      height = Math.max(2, Math.round(height / factor));
    }
    const effectiveResolutionM = Math.max(widthM / width, heightM / height);
    const endpoint = String(source.url).replace(/\/+$/, "") + "/exportImage";
    const query = new URLSearchParams({
      bbox: bbox.map((value) => value.toFixed(8)).join(","),
      bboxSR: "4326",
      imageSR: "4326",
      size: `${width},${height}`,
      format: "tiff",
      pixelType: "F32",
      interpolation: "RSP_BilinearInterpolation",
      f: "json",
    });
    return {
      url: `${endpoint}?${query.toString()}`,
      endpoint,
      bbox,
      polygonBbox: polygonBbox.slice(),
      width,
      height,
      marginM,
      sourceResolutionM: sourceResolution,
      effectiveResolutionM,
    };
  }

  function decodeHtml(value) {
    return String(value || "")
      .replace(/&#x2F;/gi, "/")
      .replace(/&#47;/g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  function parseExportResponse(json) {
    if (!json || !json.href) invalid("IGAC no devolvió el archivo del DEM.");
    return {
      href: decodeHtml(json.href),
      width: finite(json.width) ? Number(json.width) : null,
      height: finite(json.height) ? Number(json.height) : null,
      extent: json.extent || null,
    };
  }

  function declarationFor(source, request) {
    if (!source) invalid("Falta la fuente IGAC.");
    return {
      sourceId: source.id || "co-igac-lidar-mdt",
      name: `IGAC MDT · ${source.name || "tesela"}`,
      product: "DTM",
      bareEarth: true,
      fileName: `igac-${source.itemId || "mdt"}.tif`,
      format: "GeoTIFF",
      license: source.license || "Datos abiertos IGAC",
      attribution: source.attribution || "Instituto Geográfico Agustín Codazzi (IGAC)",
      acquisitionYear: source.year || null,
      verticalAccuracyM: source.verticalAccuracyM ?? null,
      sourceUrl: source.url || null,
      sourceTitle: source.title || null,
      sourceCoverage: source.coverage || "municipal",
      validation: "not_validated",
      request: request ? {
        bbox: request.bbox,
        width: request.width,
        height: request.height,
        marginM: request.marginM,
        effectiveResolutionM: Math.round(request.effectiveResolutionM * 1000) / 1000,
      } : null,
    };
  }

  return {
    VERSION,
    DEFAULT_MARGIN_M,
    DEFAULT_MAX_SIZE,
    bboxFromPoints,
    bboxContains,
    bboxIntersects,
    bboxArea,
    selectSource,
    expandBbox,
    buildExportImageUrl,
    decodeHtml,
    parseExportResponse,
    declarationFor,
  };
});
