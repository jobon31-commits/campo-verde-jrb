/* ============================================================
   CAMPO VERDE JRB · importación de polígonos
   Lee GeoJSON, KML y listas de coordenadas (CSV/TXT) sin DOM.
   Devuelve un anillo exterior en [{ lat, lon }]. No proyecta ni
   calcula áreas: solo interpreta y valida el archivo.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CVGeoImport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "1.0.0";
  const MAX_DEPTH = 40;

  function invalid(message) {
    const error = new Error(message);
    error.code = "GEO_IMPORT";
    throw error;
  }

  function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
  }

  function toPoint(lon, lat, index) {
    const x = Number(lon);
    const y = Number(lat);
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      invalid(`La coordenada ${index + 1} no es numérica.`);
    }
    if (Math.abs(y) > 90) invalid(`La latitud ${index + 1} está fuera de rango.`);
    if (Math.abs(x) > 180) invalid(`La longitud ${index + 1} está fuera de rango.`);
    return { lat: y, lon: x, acc: null };
  }

  function samePoint(a, b) {
    return Math.abs(a.lat - b.lat) < 1e-12 && Math.abs(a.lon - b.lon) < 1e-12;
  }

  function cleanRing(points) {
    const out = [];
    points.forEach((point) => {
      if (!out.length || !samePoint(out[out.length - 1], point)) out.push(point);
    });
    if (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
    if (out.length < 3) {
      invalid("El polígono necesita al menos 3 vértices distintos.");
    }
    return out;
  }

  function ringFromGeoJson(ring) {
    if (!Array.isArray(ring) || ring.length < 3) {
      invalid("El anillo del polígono no tiene suficientes coordenadas.");
    }
    return cleanRing(ring.map((coordinate, index) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) {
        invalid(`La coordenada ${index + 1} del GeoJSON no tiene lon/lat.`);
      }
      return toPoint(coordinate[0], coordinate[1], index);
    }));
  }

  function findFirstPolygon(node, depth, inheritedName) {
    if (!node || typeof node !== "object" || depth > MAX_DEPTH) return null;
    const type = node.type;
    if (type === "Polygon" || type === "MultiPolygon") {
      return { geometry: node, name: inheritedName || null };
    }
    if (type === "Feature") {
      const name = node.properties && typeof node.properties.name === "string"
        ? node.properties.name
        : inheritedName;
      return findFirstPolygon(node.geometry, depth + 1, name);
    }
    if (type === "FeatureCollection") {
      const features = Array.isArray(node.features) ? node.features : [];
      for (const feature of features) {
        const found = findFirstPolygon(feature, depth + 1, inheritedName);
        if (found) return found;
      }
      return null;
    }
    if (type === "GeometryCollection") {
      const geometries = Array.isArray(node.geometries) ? node.geometries : [];
      for (const geometry of geometries) {
        const found = findFirstPolygon(geometry, depth + 1, inheritedName);
        if (found) return found;
      }
      return null;
    }
    if (Array.isArray(node)) {
      for (const item of node) {
        const found = findFirstPolygon(item, depth + 1, inheritedName);
        if (found) return found;
      }
    }
    return null;
  }

  function parseGeoJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      invalid("El archivo JSON no es válido.");
    }
    const found = findFirstPolygon(data, 0, null);
    if (!found) invalid("No se encontró un Polygon ni un MultiPolygon en el archivo.");
    const geometry = found.geometry;
    const warnings = [];
    let rings;
    if (geometry.type === "MultiPolygon") {
      if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length) {
        invalid("El MultiPolygon no tiene coordenadas.");
      }
      if (geometry.coordinates.length > 1) {
        warnings.push(`El archivo tiene ${geometry.coordinates.length} polígonos; se cargó el primero.`);
      }
      rings = geometry.coordinates[0];
    } else {
      rings = geometry.coordinates;
    }
    if (!Array.isArray(rings) || !rings.length) invalid("El polígono no tiene anillos.");
    if (rings.length > 1) {
      warnings.push("Se ignoraron los huecos del polígono; se mide el anillo exterior.");
    }
    return {
      points: ringFromGeoJson(rings[0]),
      format: "GeoJSON",
      warnings,
      name: found.name,
    };
  }

  function parseKml(text) {
    const scopeMatch = text.match(/<(?:\w+:)?Polygon\b[\s\S]*?<\/(?:\w+:)?Polygon>/i);
    const scope = scopeMatch ? scopeMatch[0] : text;
    const blocks = [];
    const pattern = /<coordinates[^>]*>([\s\S]*?)<\/coordinates>/gi;
    let match;
    while ((match = pattern.exec(scope))) blocks.push(match[1]);
    if (!blocks.length) invalid("El KML no contiene un bloque <coordinates>.");
    if (blocks.length > 1) {
      // El primer bloque suele ser el anillo exterior del primer Placemark.
    }
    const tuples = blocks[0].trim().split(/\s+/).filter(Boolean);
    if (!tuples.length) invalid("El bloque de coordenadas KML está vacío.");
    const points = tuples.map((tuple, index) => {
      const parts = tuple.split(",");
      if (parts.length < 2) invalid(`La coordenada KML ${index + 1} no tiene lon/lat.`);
      return toPoint(parts[0], parts[1], index);
    });
    return {
      points: cleanRing(points),
      format: "KML",
      warnings: blocks.length > 1
        ? [`El KML tiene ${blocks.length} bloques de coordenadas; se cargó el primero.`]
        : [],
      name: null,
    };
  }

  function parseDecimal(value) {
    let text = String(value == null ? "" : value).trim().replace(/\s+/g, "");
    if (!text) return NaN;
    if (/^-?\d{1,3}(\.\d{3})*,\d+$/.test(text)) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else if (text.includes(",") && !text.includes(".")) {
      text = text.replace(",", ".");
    }
    return Number(text);
  }

  function parseCoordinateLine(line) {
    let clean = String(line || "").replace(/#.*$/, "").trim();
    if (!clean) return null;
    if (/^(lat|latitude|latitud)\b/i.test(clean)) return null;
    if (/^(v[eé]rtice|punto|point)\b/i.test(clean)) return null;
    if (!/\d/.test(clean) && /(lat|lon)/i.test(clean)) return null;
    // Quita una etiqueta inicial ("A, ...", "Punto 1; ...") si existe.
    clean = clean.replace(/^[^\d+\-.,\s][^,;]*[,;]\s*/, "");
    if (!clean) return null;
    let parts;
    if (clean.includes(";")) {
      parts = clean.split(";");
    } else if (clean.includes(",")) {
      parts = clean.split(",");
    } else {
      parts = clean.split(/\s+/);
    }
    parts = parts.map((part) => part.trim()).filter(Boolean);
    if (parts.length > 2 && !/^[+\-.\d]/.test(parts[0])) parts = parts.slice(1);
    if (parts.length < 2) invalid("Se esperaban latitud y longitud.");
    let latText = parts[0];
    let lonText = parts[1];
    // Permite coma decimal cuando el par queda partido en cuatro trozos:
    // "-34,901, -60,301".
    if (parts.length === 4) {
      const latPair = `${parts[0]},${parts[1]}`;
      const lonPair = `${parts[2]},${parts[3]}`;
      if (Number.isFinite(parseDecimal(latPair)) && Number.isFinite(parseDecimal(lonPair))) {
        latText = latPair;
        lonText = lonPair;
      }
    }
    const lat = parseDecimal(latText);
    const lon = parseDecimal(lonText);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      invalid("La línea no tiene dos números válidos.");
    }
    if (Math.abs(lat) > 90) invalid(`La latitud ${fmtNumber(lat)} está fuera de rango.`);
    if (Math.abs(lon) > 180) invalid(`La longitud ${fmtNumber(lon)} está fuera de rango.`);
    return { lat, lon, acc: null };
  }

  function fmtNumber(value) {
    return Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : "?";
  }

  function parseCoordinateText(text) {
    const points = [];
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) return;
      try {
        const point = parseCoordinateLine(line);
        if (point) points.push(point);
      } catch (error) {
        invalid(`Línea ${index + 1}: ${error.message}`);
      }
    });
    return {
      points: cleanRing(points),
      format: "CSV/TXT",
      warnings: [],
      name: null,
    };
  }

  /**
   * Interpreta un archivo de polígono.
   * @param {string} text contenido
   * @param {string} [fileName] nombre para decidir el formato
   * @returns {{points: Array<{lat:number,lon:number}>, format:string, warnings:string[], name:string|null}}
   */
  function parsePolygonText(text, fileName) {
    const source = String(text == null ? "" : text).replace(/^\uFEFF/, "").trim();
    if (!source) invalid("El archivo está vacío.");
    const name = String(fileName || "").toLowerCase();
    if (name.endsWith(".kml") || /<kml[\s>]/i.test(source) || /<coordinates[\s>]/i.test(source)) {
      return parseKml(source);
    }
    if (name.endsWith(".json") || name.endsWith(".geojson") || /^[\[{]/.test(source)) {
      return parseGeoJson(source);
    }
    return parseCoordinateText(source);
  }

  return {
    VERSION,
    parsePolygonText,
    parseGeoJson,
    parseKml,
    parseCoordinateText,
    parseCoordinateLine,
  };
});
