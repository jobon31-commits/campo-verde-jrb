/* Pruebas del lector BYOD: ASC y GeoTIFF sinteticos.
   Ejecutar: node tests/dem-file.test.js */
"use strict";

const assert = require("assert");
const zlib = require("zlib");
const demFile = require("../dem/dem-file.js");

let passed = 0;
const failures = [];
const queue = [];

function test(name, fn) {
  queue.push({ name, fn });
}

function testAsync(name, fn) {
  queue.push({ name, fn });
}

function approx(actual, expected, tolerance, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label || "valor"}: esperado ${expected} +/- ${tolerance}, obtenido ${actual}`
  );
}

/* ---------- Constructor de TIFF sintetico ---------- */

const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
const BIG = { 3: false, 4: false, 11: false, 12: false };

function encodeBlock(values, cols, rows, bits, format, predictor, little) {
  const bypp = bits / 8;
  const out = Buffer.alloc(cols * rows * bypp);
  for (let r = 0; r < rows; r += 1) {
    const row = values.slice(r * cols, (r + 1) * cols);
    if (predictor === 3) {
      if (bits !== 32) throw new Error("predictor 3 solo Float32");
      const planes = [new Uint8Array(cols), new Uint8Array(cols), new Uint8Array(cols), new Uint8Array(cols)];
      for (let c = 0; c < cols; c += 1) {
        const b = Buffer.alloc(4);
        if (little) b.writeFloatLE(row[c]); else b.writeFloatBE(row[c]);
        for (let p = 0; p < 4; p += 1) planes[p][c] = b[p];
      }
      for (let p = 0; p < 4; p += 1) {
        let previous = planes[p][0];
        for (let c = 1; c < cols; c += 1) {
          const current = planes[p][c];
          planes[p][c] = (current - previous) & 255;
          previous = current;
        }
        out.set(planes[p], r * cols * 4 + p * cols);
      }
      continue;
    }
    let previous = 0;
    for (let c = 0; c < cols; c += 1) {
      const raw = row[c];
      let value = raw;
      if (predictor === 2) {
        value = raw - previous;
        previous = raw;
      }
      const offset = (r * cols + c) * bypp;
      if (bits === 32 && format === 3) {
        if (little) out.writeFloatLE(value, offset); else out.writeFloatBE(value, offset);
      } else if (bits === 32 && format === 2) {
        if (little) out.writeUInt32LE(value >>> 0, offset); else out.writeUInt32BE(value >>> 0, offset);
      } else if (bits === 32) {
        if (little) out.writeUInt32LE(value >>> 0, offset); else out.writeUInt32BE(value >>> 0, offset);
      } else if (bits === 16) {
        if (little) out.writeUInt16LE(value & 0xffff, offset); else out.writeUInt16BE(value & 0xffff, offset);
      } else if (bits === 8) {
        out.writeUInt8(value & 255, offset);
      } else {
        throw new Error(`bits ${bits} no soportado por el test`);
      }
    }
  }
  return out;
}

function normalizeEntryValues(type, values) {
  if (type === 2) {
    const text = String(values);
    return Array.from(text, (ch) => ch.charCodeAt(0));
  }
  return Array.from(values);
}

function buildGeoTiff(options) {
  const opts = {
    width: 4,
    height: 3,
    cellX: 0.0001,
    cellY: 0.0001,
    west: -74.1,
    north: 4.6,
    bits: 32,
    format: 3,
    compression: 1,
    predictor: 1,
    tileW: 0,
    tileH: 0,
    rowsPerStrip: 0,
    modelType: 2,
    geographicType: 4326,
    projectedType: null,
    samples: 1,
    nodataText: null,
    little: true,
    ...options,
  };
  if (!opts.values) throw new Error("faltan values");

  const blocks = [];
  const offsets = [];
  const counts = [];
  let cursor = 8;
  const pushBlock = (bytes) => {
    blocks.push(bytes);
    offsets.push(cursor);
    counts.push(bytes.length);
    cursor += bytes.length;
  };
  const pack = (bytes) => (opts.compression === 1 ? bytes : zlib.deflateSync(bytes));

  if (opts.tileW && opts.tileH) {
    const across = Math.ceil(opts.width / opts.tileW);
    const down = Math.ceil(opts.height / opts.tileH);
    for (let ty = 0; ty < down; ty += 1) {
      for (let tx = 0; tx < across; tx += 1) {
        const tile = new Float64Array(opts.tileW * opts.tileH);
        for (let r = 0; r < opts.tileH; r += 1) {
          for (let c = 0; c < opts.tileW; c += 1) {
            const gx = tx * opts.tileW + c;
            const gy = ty * opts.tileH + r;
            if (gx < opts.width && gy < opts.height) {
              tile[r * opts.tileW + c] = opts.values[gy * opts.width + gx];
            }
          }
        }
        pushBlock(pack(encodeBlock(tile, opts.tileW, opts.tileH, opts.bits, opts.format, opts.predictor, opts.little)));
      }
    }
  } else {
    const rowsPerStrip = opts.rowsPerStrip || opts.height;
    for (let y = 0; y < opts.height; y += rowsPerStrip) {
      const rows = Math.min(rowsPerStrip, opts.height - y);
      const chunk = new Float64Array(rows * opts.width);
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < opts.width; c += 1) {
          chunk[r * opts.width + c] = opts.values[(y + r) * opts.width + c];
        }
      }
      pushBlock(pack(encodeBlock(chunk, opts.width, rows, opts.bits, opts.format, opts.predictor, opts.little)));
    }
  }

  const geoKeys = [1, 1, 0, 4, 1024, 0, 1, opts.modelType, 1025, 0, 1, 1];
  if (opts.modelType === 1) geoKeys.push(3072, 0, 1, opts.projectedType || 32633);
  else geoKeys.push(2048, 0, 1, opts.geographicType, 2054, 0, 1, 9102);

  const entries = [];
  const add = (tag, type, values) => {
    const list = normalizeEntryValues(type, values);
    entries.push({ tag, type, values: list, count: list.length });
  };
  add(256, 4, [opts.width]);
  add(257, 4, [opts.height]);
  add(258, 3, [opts.bits]);
  add(259, 3, [opts.compression]);
  add(262, 3, [1]);
  add(277, 3, [opts.samples]);
  add(284, 3, [1]);
  add(317, 3, [opts.predictor]);
  add(339, 3, [opts.format]);
  add(33550, 12, [opts.cellX, opts.cellY, 0]);
  add(33922, 12, [0, 0, 0, opts.west, opts.north, 0]);
  add(34735, 3, geoKeys);
  if (opts.tileW && opts.tileH) {
    add(322, 3, [opts.tileW]);
    add(323, 3, [opts.tileH]);
    add(324, 4, offsets);
    add(325, 4, counts);
  } else {
    add(273, 4, offsets);
    add(278, 4, [opts.rowsPerStrip || opts.height]);
    add(279, 4, counts);
  }
  if (opts.nodataText !== null) add(42113, 2, opts.nodataText);
  entries.sort((a, b) => a.tag - b.tag);

  const ifdOffset = cursor;
  const ifdSize = 2 + entries.length * 12 + 4;
  let extraCursor = ifdOffset + ifdSize;
  const extras = [];
  entries.forEach((entry) => {
    const byteLength = TYPE_BYTES[entry.type] * entry.count;
    if (byteLength > 4) {
      entry.offset = extraCursor;
      extras.push(entry);
      extraCursor += byteLength + (byteLength % 2);
    }
  });

  const total = extraCursor;
  const out = Buffer.alloc(total);
  if (opts.little) {
    out.write("II", 0, "ascii");
    out.writeUInt16LE(42, 2);
    out.writeUInt32LE(ifdOffset, 4);
  } else {
    out.write("MM", 0, "ascii");
    out.writeUInt16BE(42, 2);
    out.writeUInt32BE(ifdOffset, 4);
  }
  blocks.forEach((bytes, index) => {
    out.set(bytes, offsets[index]);
  });

  const writeEntryValues = (entry, offset) => {
    entry.values.forEach((value, index) => {
      const at = offset + index * TYPE_BYTES[entry.type];
      if (entry.type === 1 || entry.type === 2) out.writeUInt8(value, at);
      else if (entry.type === 3) {
        if (opts.little) out.writeUInt16LE(value, at); else out.writeUInt16BE(value, at);
      } else if (entry.type === 4) {
        if (opts.little) out.writeUInt32LE(value >>> 0, at); else out.writeUInt32BE(value >>> 0, at);
      } else if (entry.type === 11) {
        if (opts.little) out.writeFloatLE(value, at); else out.writeFloatBE(value, at);
      } else if (entry.type === 12) {
        if (opts.little) out.writeDoubleLE(value, at); else out.writeDoubleBE(value, at);
      }
    });
  };

  if (opts.little) out.writeUInt16LE(entries.length, ifdOffset);
  else out.writeUInt16BE(entries.length, ifdOffset);
  entries.forEach((entry, index) => {
    const at = ifdOffset + 2 + index * 12;
    if (opts.little) {
      out.writeUInt16LE(entry.tag, at);
      out.writeUInt16LE(entry.type, at + 2);
      out.writeUInt32LE(entry.count, at + 4);
    } else {
      out.writeUInt16BE(entry.tag, at);
      out.writeUInt16BE(entry.type, at + 2);
      out.writeUInt32BE(entry.count, at + 4);
    }
    if (entry.offset !== undefined) {
      if (opts.little) out.writeUInt32LE(entry.offset, at + 8);
      else out.writeUInt32BE(entry.offset, at + 8);
      writeEntryValues(entry, entry.offset);
    } else {
      writeEntryValues(entry, at + 8);
    }
  });
  if (opts.little) out.writeUInt32LE(0, ifdOffset + 2 + entries.length * 12);
  else out.writeUInt32BE(0, ifdOffset + 2 + entries.length * 12);
  return out;
}

function bufferOf(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/* ---------- ASC ---------- */

const ASC_BASIC = [
  "ncols 4",
  "nrows 3",
  "xllcorner -74.1000",
  "yllcorner 4.6000",
  "cellsize 0.0001",
  "NODATA_value -9999",
  "1 2 3 4",
  "5 -9999 7 8",
  "9 10 11 12",
].join("\n");

test("ASC: lee encabezado, datos, bbox y nodata", () => {
  const grid = demFile.parseAsc(ASC_BASIC, "predio.asc");
  assert.strictEqual(grid.width, 4);
  assert.strictEqual(grid.height, 3);
  approx(grid.cellX, 0.0001, 1e-12, "cellX");
  approx(grid.west, -74.1, 1e-12, "west");
  approx(grid.south, 4.6, 1e-12, "south");
  approx(grid.east, -74.0996, 1e-12, "east");
  approx(grid.north, 4.6003, 1e-12, "north");
  assert.strictEqual(grid.crs, "EPSG:4326");
  assert.strictEqual(grid.source, "byod-asc");
  assert.strictEqual(grid.data[0], 1);
  assert.strictEqual(grid.data[3], 4);
  assert.strictEqual(grid.data[11], 12);
  assert.ok(Number.isNaN(grid.data[5]), "nodata debe ser NaN");
  assert.strictEqual(grid.nodata, -9999);
});

test("ASC: admite xllcenter/yllcenter y coma decimal", () => {
  const text = [
    "NCOLS 2",
    "NROWS 2",
    "XLLCENTER -74,0500",
    "YLLCENTER 4,0500",
    "CELLSIZE 0,0001",
    "NODATA_value -9999",
    "10 20",
    "30 40",
  ].join("\r\n");
  const grid = demFile.parseAsc(text, "centro.asc");
  approx(grid.west, -74.05005, 1e-12, "west");
  approx(grid.south, 4.04995, 1e-12, "south");
  assert.strictEqual(grid.data[3], 40);
});

test("ASC: rechaza encabezado incompleto", () => {
  assert.throws(() => demFile.parseAsc("ncols 4\nnrows 3\n1 2 3 4", "malo.asc"), /cellsize/);
});

test("ASC: rechaza menos celdas que las declaradas", () => {
  const text = "ncols 4\nnrows 3\nxllcorner -74\nyllcorner 4\ncellsize 0.0001\n1 2 3";
  assert.throws(() => demFile.parseAsc(text, "corto.asc"), /declara 12 celdas/);
});

test("ASC: rechaza coordenadas proyectadas (UTM)", () => {
  const text = "ncols 2\nnrows 2\nxllcorner 500000\nyllcorner 900000\ncellsize 30\n1 2 3 4";
  assert.throws(() => demFile.parseAsc(text, "utm.asc"), /EPSG:4326/);
});

test("ASC: rechaza grillas de una sola celda o demasiado grandes", () => {
  const small = "ncols 1\nnrows 1\nxllcorner -74\nyllcorner 4\ncellsize 0.0001\n1";
  assert.throws(() => demFile.parseAsc(small, "uno.asc"), /2 x 2/);
  const huge = "ncols 5000\nnrows 4000\nxllcorner -74\nyllcorner 4\ncellsize 0.0001\n1";
  assert.throws(() => demFile.parseAsc(huge, "enorme.asc"), /16000000/);
});

/* ---------- GeoTIFF ---------- */

const VALUES_4x3 = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

testAsync("GeoTIFF: Float32 sin comprimir, dos tiras", async () => {
  const buffer = buildGeoTiff({ values: VALUES_4x3, rowsPerStrip: 2 });
  const grid = await demFile.parseGeoTiff(bufferOf(buffer), "plano.tif");
  assert.strictEqual(grid.width, 4);
  assert.strictEqual(grid.height, 3);
  assert.strictEqual(grid.source, "byod-geotiff");
  assert.strictEqual(grid.meta.format, "GeoTIFF");
  approx(grid.west, -74.1, 1e-12, "west");
  approx(grid.north, 4.6, 1e-12, "north");
  approx(grid.south, 4.5997, 1e-12, "south");
  VALUES_4x3.forEach((value, index) => approx(grid.data[index], value, 1e-6, `celda ${index}`));
});

testAsync("GeoTIFF: DEFLATE con predictor 3 (Float32)", async () => {
  const buffer = buildGeoTiff({
    values: VALUES_4x3,
    compression: 8,
    predictor: 3,
    rowsPerStrip: 2,
  });
  const grid = await demFile.parseGeoTiff(bufferOf(buffer), "predictor.tif");
  assert.strictEqual(grid.meta.compression, 8);
  assert.strictEqual(grid.meta.predictor, 3);
  VALUES_4x3.forEach((value, index) => approx(grid.data[index], value, 1e-6, `celda ${index}`));
});

testAsync("GeoTIFF: teselas con Int16, predictor 2 y NODATA", async () => {
  const values = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
  const withNoData = values.slice();
  withNoData[6] = -9999;
  const buffer = buildGeoTiff({
    values: withNoData,
    bits: 16,
    format: 2,
    compression: 8,
    predictor: 2,
    tileW: 2,
    tileH: 2,
    nodataText: "-9999",
  });
  const grid = await demFile.parseGeoTiff(bufferOf(buffer), "teselas.tif");
  assert.strictEqual(grid.meta.bits, 16);
  assert.strictEqual(grid.meta.sampleFormat, 2);
  assert.ok(Number.isNaN(grid.data[6]), "NODATA debe ser NaN");
  assert.strictEqual(grid.data[0], 100);
  assert.strictEqual(grid.data[5], 105);
  assert.strictEqual(grid.data[11], 111);
});

testAsync("GeoTIFF: big-endian Float32 sin comprimir", async () => {
  const buffer = buildGeoTiff({ values: VALUES_4x3, little: false });
  const grid = await demFile.parseGeoTiff(bufferOf(buffer), "big.tif");
  VALUES_4x3.forEach((value, index) => approx(grid.data[index], value, 1e-6, `celda ${index}`));
});

testAsync("GeoTIFF: rechaza coordenadas proyectadas", async () => {
  const buffer = buildGeoTiff({
    values: VALUES_4x3,
    modelType: 1,
    projectedType: 32633,
    cellX: 30,
    cellY: 30,
    west: 500000,
    north: 900000,
  });
  await assert.rejects(
    () => demFile.parseGeoTiff(bufferOf(buffer), "utm.tif"),
    /proyectadas|EPSG:4326/
  );
});

testAsync("GeoTIFF: rechaza compresion LZW", async () => {
  const buffer = buildGeoTiff({ values: VALUES_4x3, compression: 5 });
  await assert.rejects(() => demFile.parseGeoTiff(bufferOf(buffer), "lzw.tif"), /Compresion TIFF/);
});

testAsync("GeoTIFF: rechaza BigTIFF", async () => {
  const buffer = Buffer.alloc(32);
  buffer.write("II", 0, "ascii");
  buffer.writeUInt16LE(43, 2);
  buffer.writeUInt32LE(8, 4);
  await assert.rejects(() => demFile.parseGeoTiff(bufferOf(buffer), "big.tiff"), /BigTIFF/);
});

testAsync("GeoTIFF: rechaza mas de un canal", async () => {
  const buffer = buildGeoTiff({ values: VALUES_4x3, samples: 2 });
  await assert.rejects(() => demFile.parseGeoTiff(bufferOf(buffer), "multicanal.tif"), /un canal/);
});

testAsync("GeoTIFF: rechaza EPSG distinto de 4326", async () => {
  const buffer = buildGeoTiff({ values: VALUES_4x3, geographicType: 4258 });
  await assert.rejects(() => demFile.parseGeoTiff(bufferOf(buffer), "etrs.tif"), /EPSG:4258/);
});

/* ---------- parseFile ---------- */

testAsync("parseFile: despacha .asc y .tif por extension", async () => {
  const asc = {
    name: "predio.asc",
    text: async () => ASC_BASIC,
  };
  const ascGrid = await demFile.parseFile(asc);
  assert.strictEqual(ascGrid.width, 4);

  const buffer = buildGeoTiff({ values: VALUES_4x3 });
  const tif = {
    name: "predio.TIF",
    arrayBuffer: async () => bufferOf(buffer),
  };
  const tifGrid = await demFile.parseFile(tif);
  assert.strictEqual(tifGrid.height, 3);
});

testAsync("parseFile: rechaza formatos no soportados", async () => {
  await assert.rejects(
    () => demFile.parseFile({ name: "predio.zip", arrayBuffer: async () => new ArrayBuffer(0) }),
    /Formato no soportado/
  );
});

testAsync("GeoTIFF: rechaza archivo truncado", async () => {
  const buffer = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00]);
  await assert.rejects(() => demFile.parseGeoTiff(bufferOf(buffer), "truncado.tif"), /truncado/);
});

(async () => {
  for (const item of queue) {
    try {
      await item.fn();
      passed += 1;
      console.log(`ok - ${item.name}`);
    } catch (error) {
      failures.push({ name: item.name, error });
      console.error(`FAIL - ${item.name}\n  ${error.message}`);
    }
  }

  console.log(`\n${passed} pruebas aprobadas, ${failures.length} fallidas.`);
  if (failures.length) {
    failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack}`));
    process.exitCode = 1;
  }
})();
