/* ============================================================
   CAMPO VERDE JRB · lectura de DEM propio (BYOD)
   Formatos: ESRI ASCII Grid (.asc) y GeoTIFF (.tif/.tiff)
   GeoTIFF soportado: clásico, una banda, sin comprimir o DEFLATE,
   tiras o teselas, Float32 / Int16 / UInt16 / Int32, predictor 1-3.
   Solo EPSG:4326 (grados). No usa CDN ni dependencias.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CVDemFile = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const FILE_VERSION = "0.1.0";
  const MAX_CELLS = 16000000;
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

  function fail(message) {
    const error = new Error(message);
    error.code = "DEM_FILE";
    throw error;
  }

  function toNumber(token) {
    if (typeof token === "number") return token;
    const text = String(token).trim().replace(",", ".");
    const value = Number(text);
    return Number.isFinite(value) ? value : NaN;
  }

  function assertGrid(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
      fail("El DEM debe tener al menos 2 x 2 celdas.");
    }
    if (width * height > MAX_CELLS) {
      fail(`El DEM tiene ${width * height} celdas; el limite es ${MAX_CELLS}. Recorta la zona o usa una resolucion mayor.`);
    }
  }

  function finalizeGrid(input) {
    const width = Math.trunc(input.width);
    const height = Math.trunc(input.height);
    assertGrid(width, height);
    const cellX = toNumber(input.cellX);
    const cellY = toNumber(input.cellY);
    const x0 = toNumber(input.x0);
    const y0 = toNumber(input.y0);
    if (![cellX, cellY, x0, y0].every(Number.isFinite) || cellX <= 0 || cellY <= 0) {
      fail("La georreferencia del DEM no es valida.");
    }
    const data = input.data;
    if (!data || data.length !== width * height) fail("La grilla no coincide con width*height.");
    const west = x0;
    const east = x0 + width * cellX;
    const south = y0;
    const north = y0 + height * cellY;
    const looksGeographic = west >= -180 && east <= 180 && south >= -90 && north <= 90 && cellX < 1 && cellY < 1;
    if (!looksGeographic) {
      fail("El DEM no esta en grados WGS 84. Exportalo en EPSG:4326 y vuelve a intentarlo.");
    }
    return {
      width,
      height,
      cellX,
      cellY,
      x0,
      y0,
      west,
      east,
      south,
      north,
      data,
      nodata: Number.isFinite(input.nodata) ? input.nodata : null,
      crs: "EPSG:4326",
      source: input.source || "byod",
      meta: input.meta || {},
    };
  }

  /* ---------- ESRI ASCII Grid ---------- */

  function parseAsc(text, name) {
    if (typeof text !== "string" || !text.trim()) fail("El archivo ASC esta vacio.");
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    const header = {};
    let index = 0;
    while (index < lines.length && index < 40) {
      const line = lines[index].trim();
      if (!line) { index += 1; continue; }
      const match = line.match(/^([A-Za-z_]+)\s+(-?[\d.,]+)\s*$/);
      if (!match) break;
      header[match[1].toLowerCase()] = match[2];
      index += 1;
    }
    const ncols = Math.trunc(toNumber(header.ncols));
    const nrows = Math.trunc(toNumber(header.nrows));
    const cellsize = toNumber(header.cellsize);
    if (!Number.isInteger(ncols) || !Number.isInteger(nrows) || !Number.isFinite(cellsize) || cellsize <= 0) {
      fail("Faltan ncols, nrows o cellsize en el encabezado ASC.");
    }
    assertGrid(ncols, nrows);

    let x0;
    let y0;
    if (header.xllcorner !== undefined) x0 = toNumber(header.xllcorner);
    else if (header.xllcenter !== undefined) x0 = toNumber(header.xllcenter) - cellsize / 2;
    else fail("Falta xllcorner o xllcenter en el ASC.");
    if (header.yllcorner !== undefined) y0 = toNumber(header.yllcorner);
    else if (header.yllcenter !== undefined) y0 = toNumber(header.yllcenter) - cellsize / 2;
    else fail("Falta yllcorner o yllcenter en el ASC.");

    const nodata = header.nodata_value !== undefined ? toNumber(header.nodata_value) : -9999;
    const body = lines.slice(index).join(" ").trim();
    const tokens = body ? body.split(/\s+/) : [];
    if (tokens.length < ncols * nrows) {
      fail(`El ASC declara ${ncols * nrows} celdas y contiene ${tokens.length}.`);
    }
    const data = new Float32Array(ncols * nrows);
    for (let i = 0; i < data.length; i += 1) {
      const value = toNumber(tokens[i]);
      data[i] = Number.isFinite(value) && value !== nodata ? value : NaN;
    }
    return finalizeGrid({
      width: ncols,
      height: nrows,
      cellX: cellsize,
      cellY: cellsize,
      x0,
      y0,
      data,
      nodata,
      source: "byod-asc",
      meta: { fileName: name || null, format: "ASC", nodata },
    });
  }

  /* ---------- GeoTIFF ---------- */

  function typeSize(type) {
    return TYPE_SIZE[type] || 1;
  }

  function readValues(view, entry, little) {
    const { type, count, valueOffset } = entry;
    const size = typeSize(type) * count;
    const start = size <= 4 ? valueOffset : view.getUint32(valueOffset, little);
    if (type === 2) {
      let text = "";
      for (let i = 0; i < count; i += 1) {
        const code = view.getUint8(start + i);
        if (!code) break;
        text += String.fromCharCode(code);
      }
      return text;
    }
    const values = [];
    for (let i = 0; i < count; i += 1) {
      const offset = start + i * typeSize(type);
      switch (type) {
        case 1: case 7: values.push(view.getUint8(offset)); break;
        case 3: values.push(view.getUint16(offset, little)); break;
        case 4: values.push(view.getUint32(offset, little)); break;
        case 6: values.push(view.getInt8(offset)); break;
        case 8: values.push(view.getInt16(offset, little)); break;
        case 9: values.push(view.getInt32(offset, little)); break;
        case 11: values.push(view.getFloat32(offset, little)); break;
        case 12: values.push(view.getFloat64(offset, little)); break;
        case 5: values.push(view.getUint32(offset, little) / (view.getUint32(offset + 4, little) || 1)); break;
        case 10: values.push(view.getInt32(offset, little) / (view.getInt32(offset + 4, little) || 1)); break;
        default: values.push(view.getUint8(offset));
      }
    }
    return values;
  }

  function readIfd(view, offset, little) {
    if (offset <= 0 || offset + 2 > view.byteLength) fail("IFD de TIFF fuera de rango.");
    const count = view.getUint16(offset, little);
    if (offset + 2 + count * 12 > view.byteLength) fail("IFD de TIFF truncado.");
    const tags = new Map();
    for (let i = 0; i < count; i += 1) {
      const entryOffset = offset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, little);
      const type = view.getUint16(entryOffset + 2, little);
      const valueCount = view.getUint32(entryOffset + 4, little);
      const valueOffset = entryOffset + 8;
      tags.set(tag, { tag, type, count: valueCount, valueOffset });
    }
    const nextOffset = view.getUint32(offset + 2 + count * 12, little);
    return { tags, nextOffset };
  }

  function tagValue(tags, tag, view, little) {
    const entry = tags.get(tag);
    if (!entry) return null;
    return readValues(view, entry, little);
  }

  function tagNumber(tags, tag, view, little, fallback) {
    const value = tagValue(tags, tag, view, little);
    if (Array.isArray(value)) return value.length ? Number(value[0]) : fallback;
    return value === null || value === undefined ? fallback : Number(value);
  }

  async function inflate(bytes) {
    if (typeof DecompressionStream !== "function") {
      fail("Este navegador no puede descomprimir DEFLATE. Usa un GeoTIFF sin comprimir o actualiza el navegador.");
    }
    const attempt = async (format) => {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
    try {
      return await attempt("deflate");
    } catch (error) {
      return attempt("deflate-raw");
    }
  }

  function reconstructFloatPredictor(bytes, cols, rows, little) {
    const out = new Float32Array(cols * rows);
    const rowBytes = cols * 4;
    for (let row = 0; row < rows; row += 1) {
      const base = row * rowBytes;
      const planes = [0, 1, 2, 3].map((plane) => {
        const start = base + plane * cols;
        for (let x = 1; x < cols; x += 1) {
          bytes[start + x] = (bytes[start + x] + bytes[start + x - 1]) & 255;
        }
        return start;
      });
      for (let x = 0; x < cols; x += 1) {
        const offset = row * cols + x;
        const b0 = bytes[planes[0] + x];
        const b1 = bytes[planes[1] + x];
        const b2 = bytes[planes[2] + x];
        const b3 = bytes[planes[3] + x];
        out[offset] = little
          ? uint32ToFloat(b0 | (b1 << 8) | (b2 << 16) | (b3 << 24))
          : uint32ToFloat(((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0);
      }
    }
    return out;
  }

  const floatScratch = new DataView(new ArrayBuffer(4));
  function uint32ToFloat(value) {
    floatScratch.setUint32(0, value >>> 0, true);
    return floatScratch.getFloat32(0, true);
  }

  function decodeSamples(bytes, cols, rows, bits, format, predictor, little) {
    const bytesPerSample = bits / 8;
    if (![1, 2, 4].includes(bytesPerSample)) {
      fail(`Profundidad de bits no soportada: ${bits}.`);
    }
    if (predictor === 3) {
      if (bits !== 32) fail("El predictor 3 solo se admite con Float32.");
      return reconstructFloatPredictor(bytes, cols, rows, little);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = new Float32Array(cols * rows);
    const rowStride = cols * bytesPerSample;
    for (let row = 0; row < rows; row += 1) {
      let previous = 0;
      for (let col = 0; col < cols; col += 1) {
        const offset = row * rowStride + col * bytesPerSample;
        let value;
        if (bits === 32 && format === 3) value = view.getFloat32(offset, little);
        else if (bits === 32 && format === 2) value = view.getInt32(offset, little);
        else if (bits === 32) value = view.getUint32(offset, little);
        else if (bits === 16 && format === 2) value = view.getInt16(offset, little);
        else if (bits === 16) value = view.getUint16(offset, little);
        else if (format === 2) value = view.getInt8(offset);
        else value = view.getUint8(offset);
        if (predictor === 2) {
          value += previous;
          if (bits === 16) value = (value << 16) >> 16;
          else if (bits === 8) value &= 255;
          else if (bits === 32) value = format === 2 ? (value | 0) : (value >>> 0);
          previous = value;
        }
        out[row * cols + col] = value;
      }
    }
    return out;
  }

  function parseGeoKeys(tags, view, little) {
    const raw = tagValue(tags, 34735, view, little);
    if (!Array.isArray(raw) || raw.length < 8) return { modelType: null, geographicType: null };
    const keyCount = raw[3];
    const keys = {};
    for (let i = 0; i < keyCount; i += 1) {
      const base = 4 + i * 4;
      if (base + 3 >= raw.length) break;
      keys[raw[base]] = raw[base + 3];
    }
    return {
      modelType: keys[1024] ?? null,
      geographicType: keys[2048] ?? null,
      projectedType: keys[3072] ?? null,
    };
  }

  function georeference(tags, view, little, width, height) {
    const scale = tagValue(tags, 33550, view, little);
    const tie = tagValue(tags, 33922, view, little);
    const transform = tagValue(tags, 34264, view, little);
    let cellX;
    let cellY;
    let x0;
    let y0;

    if (Array.isArray(transform) && transform.length >= 8) {
      const [a, b, , d, e, f, , h] = transform;
      if (Math.abs(b) > 1e-12 || Math.abs(e) > 1e-12) {
        fail("El GeoTIFF tiene rotacion; exportalo norte-arriba.");
      }
      cellX = Math.abs(a);
      cellY = Math.abs(f);
      x0 = d;
      y0 = h - height * cellY;
    } else if (Array.isArray(scale) && scale.length >= 2) {
      cellX = Math.abs(scale[0]);
      cellY = Math.abs(scale[1]);
      if (Array.isArray(tie) && tie.length >= 6) {
        const [i, j, , x, y] = tie;
        x0 = x - i * cellX;
        const north = y + j * cellY;
        y0 = north - height * cellY;
      } else {
        fail("El GeoTIFF no tiene tiepoint ni transformacion.");
      }
    } else {
      fail("El GeoTIFF no tiene georreferencia (ModelPixelScale/Tiepoint).");
    }

    const geoKeys = parseGeoKeys(tags, view, little);
    if (geoKeys.modelType === 1) {
      fail("El GeoTIFF esta en coordenadas proyectadas. Exportalo en EPSG:4326.");
    }
    if (geoKeys.geographicType && geoKeys.geographicType !== 4326) {
      fail(`El GeoTIFF usa EPSG:${geoKeys.geographicType}. Exportalo en EPSG:4326.`);
    }
    return { cellX, cellY, x0, y0, geoKeys };
  }

  async function parseGeoTiff(buffer, name) {
    const view = new DataView(buffer);
    if (view.byteLength < 16) fail("El archivo TIFF esta truncado.");
    const order = view.getUint16(0, false);
    const little = order === 0x4949;
    if (!little && order !== 0x4d4d) fail("No es un archivo TIFF valido.");
    const magic = view.getUint16(2, little);
    if (magic === 43) fail("BigTIFF no soportado. Guarda el GeoTIFF en formato clasico.");
    if (magic !== 42) fail("No es un archivo TIFF valido.");

    const ifdOffset = view.getUint32(4, little);
    const { tags } = readIfd(view, ifdOffset, little);
    const width = tagNumber(tags, 256, view, little, 0);
    const height = tagNumber(tags, 257, view, little, 0);
    assertGrid(width, height);

    const samples = tagNumber(tags, 277, view, little, 1);
    if (samples !== 1) fail("Solo se admite un canal por DEM.");
    const bits = tagNumber(tags, 258, view, little, 32);
    const sampleFormat = tagNumber(tags, 339, view, little, 1);
    const compression = tagNumber(tags, 259, view, little, 1);
    const predictor = tagNumber(tags, 317, view, little, 1);
    if (![1, 8, 32946].includes(compression)) {
      fail(`Compresion TIFF no soportada (${compression}). Usa DEFLATE o sin comprimir.`);
    }

    const { cellX, cellY, x0, y0, geoKeys } = georeference(tags, view, little, width, height);
    const data = new Float32Array(width * height).fill(NaN);
    const load = async (chunk) => (compression === 1 ? new Uint8Array(chunk) : inflate(new Uint8Array(chunk)));

    const tileW = tagNumber(tags, 322, view, little, 0);
    const tileH = tagNumber(tags, 323, view, little, 0);
    if (tileW && tileH) {
      const offsets = tagValue(tags, 324, view, little) || [];
      const counts = tagValue(tags, 325, view, little) || [];
      const tilesAcross = Math.ceil(width / tileW);
      const tilesDown = Math.ceil(height / tileH);
      if (offsets.length < tilesAcross * tilesDown) fail("Faltan teselas en el GeoTIFF.");
      for (let ty = 0; ty < tilesDown; ty += 1) {
        for (let tx = 0; tx < tilesAcross; tx += 1) {
          const index = ty * tilesAcross + tx;
          const offset = Number(offsets[index]);
          const count = Number(counts[index]);
          if (!offset || !count) continue;
          const bytes = await load(buffer.slice(offset, offset + count));
          const values = decodeSamples(bytes, tileW, tileH, bits, sampleFormat, predictor, little);
          for (let row = 0; row < tileH; row += 1) {
            const targetRow = ty * tileH + row;
            if (targetRow >= height) continue;
            for (let col = 0; col < tileW; col += 1) {
              const targetCol = tx * tileW + col;
              if (targetCol >= width) continue;
              data[targetRow * width + targetCol] = values[row * tileW + col];
            }
          }
        }
      }
    } else {
      const rowsPerStrip = tagNumber(tags, 278, view, little, height);
      const offsets = tagValue(tags, 273, view, little) || [];
      const counts = tagValue(tags, 279, view, little) || [];
      if (!offsets.length) fail("El GeoTIFF no tiene tiras de datos.");
      for (let strip = 0; strip < offsets.length; strip += 1) {
        const offset = Number(offsets[strip]);
        const count = Number(counts[strip]);
        if (!offset || !count) continue;
        const rows = Math.min(rowsPerStrip, height - strip * rowsPerStrip);
        if (rows <= 0) continue;
        const bytes = await load(buffer.slice(offset, offset + count));
        const values = decodeSamples(bytes, width, rows, bits, sampleFormat, predictor, little);
        data.set(values, strip * rowsPerStrip * width);
      }
    }

    const nodataText = tagValue(tags, 42113, view, little);
    const nodata = nodataText !== null && nodataText !== undefined && String(nodataText).trim() !== ""
      ? toNumber(String(nodataText).trim())
      : null;
    if (Number.isFinite(nodata)) {
      for (let i = 0; i < data.length; i += 1) {
        if (data[i] === nodata) data[i] = NaN;
      }
    }

    return finalizeGrid({
      width,
      height,
      cellX,
      cellY,
      x0,
      y0,
      data,
      nodata,
      source: "byod-geotiff",
      meta: {
        fileName: name || null,
        format: "GeoTIFF",
        compression,
        predictor,
        bits,
        sampleFormat,
        geographicType: geoKeys.geographicType,
      },
    });
  }

  async function parseFile(file) {
    if (!file || !file.name) fail("No se recibio ningun archivo.");
    const name = file.name;
    const lower = name.toLowerCase();
    if (lower.endsWith(".asc") || lower.endsWith(".txt")) {
      const text = file.text ? await file.text() : new TextDecoder("utf-8").decode(file.buffer);
      return parseAsc(text, name);
    }
    if (lower.endsWith(".tif") || lower.endsWith(".tiff")) {
      const buffer = file.buffer || await file.arrayBuffer();
      return parseGeoTiff(buffer, name);
    }
    fail("Formato no soportado. Usa .asc, .tif o .tiff.");
  }

  return {
    FILE_VERSION,
    MAX_CELLS,
    parseAsc,
    parseGeoTiff,
    parseFile,
  };
});
