/* Pruebas de cobertura IGAC. Ejecutar: node tests/igac.test.js */
"use strict";

const assert = require("assert");
const igac = require("../dem/igac.js");

let passed = 0;
const failures = [];
const queue = [];

function test(name, fn) { queue.push({ name, fn }); }
function approx(actual, expected, tolerance, label) {
  assert.ok(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label || "valor"}: esperado ${expected} +/- ${tolerance}, obtenido ${actual}`);
}

const index = {
  items: [
    {
      id: "igac-30", name: "Municipio 30", url: "https://example.test/mdt30/ImageServer",
      bbox: [-74.2, 4.0, -73.2, 5.0], resolutionM: 30, year: 2018, coverage: "municipal",
      license: "Datos abiertos IGAC", attribution: "IGAC", itemId: "i30", verticalAccuracyM: null,
    },
    {
      id: "igac-10", name: "Municipio 10", url: "https://example.test/mdt10/ImageServer",
      bbox: [-73.8, 4.1, -73.6, 4.4], resolutionM: 10, year: 2024, coverage: "municipal",
      license: "Datos abiertos IGAC", attribution: "IGAC", itemId: "i10", verticalAccuracyM: null,
    },
    {
      id: "igac-1", name: "Cabecera 1", url: "https://example.test/mdt1/ImageServer",
      bbox: [-73.72, 4.2, -73.68, 4.3], resolutionM: 1, year: 2023, coverage: "partial",
      license: "Datos abiertos IGAC", attribution: "IGAC", itemId: "i1", verticalAccuracyM: null,
    },
  ],
};

test("Cobertura: elige la mejor resolución que cubre todo el predio", () => {
  const result = igac.selectSource(index, [-73.71, 4.22, -73.69, 4.28]);
  assert.strictEqual(result.source.id, "igac-1");
  assert.strictEqual(result.source.resolutionM, 1);
  assert.ok(result.alternatives.some((item) => item.id === "igac-10"));
});

test("Cobertura: si no hay tesela completa, informa candidatas parciales", () => {
  const result = igac.selectSource(index, [-74.3, 4.2, -73.5, 4.4]);
  assert.strictEqual(result.source, null);
  assert.ok(result.partial.some((item) => item.id === "igac-10"));
  assert.ok(result.reason.includes("cubre"));
});

test("Cobertura: fuera del índice no inventa fuente", () => {
  const result = igac.selectSource(index, [-70, 0, -69, 1]);
  assert.strictEqual(result.source, null);
  assert.deepStrictEqual(result.partial, []);
});

test("BBox: acepta puntos lat/lon y calcula extremos", () => {
  const bbox = igac.bboxFromPoints([
    { lat: 4.2, lon: -73.7 },
    { lat: 4.3, lon: -73.6 },
    { lat: 4.25, lon: -73.65 },
  ]);
  approx(bbox[0], -73.7, 1e-12, "west");
  approx(bbox[1], 4.2, 1e-12, "south");
  approx(bbox[2], -73.6, 1e-12, "east");
  approx(bbox[3], 4.3, 1e-12, "north");
});

test("ExportImage: agrega margen, tamaño y formato GeoTIFF", () => {
  const request = igac.buildExportImageUrl(index.items[1], [-73.7, 4.2, -73.65, 4.25], {
    marginM: 60,
    maxSize: 512,
  });
  assert.ok(request.url.startsWith("https://example.test/mdt10/ImageServer/exportImage?"));
  assert.ok(request.url.includes("bboxSR=4326"));
  assert.ok(request.url.includes("imageSR=4326"));
  assert.ok(request.url.includes("format=tiff"));
  assert.ok(request.url.includes("pixelType=F32"));
  assert.ok(request.width >= 2 && request.height >= 2);
  assert.ok(request.width <= 512 && request.height <= 512);
  assert.ok(request.bbox[0] < -73.7 && request.bbox[2] > -73.65);
  assert.ok(request.bbox[1] < 4.2 && request.bbox[3] > 4.25);
  assert.ok(request.effectiveResolutionM >= 10);
});

test("ExportImage: limita propiedades grandes y reporta resolución efectiva", () => {
  const request = igac.buildExportImageUrl(index.items[0], [-74.1, 4.0, -73.3, 4.9], {
    marginM: 60,
    maxSize: 256,
  });
  assert.ok(request.width <= 256 && request.height <= 256);
  assert.ok(request.effectiveResolutionM > request.sourceResolutionM);
});

test("Respuesta IGAC: decodifica href y arma declaración DTM", () => {
  const parsed = igac.parseExportResponse({
    href: "https://mapas2.igac.gov.co/a&#x2F;b.tif",
    width: 120,
    height: 90,
    extent: { xmin: -73.7, ymin: 4.2, xmax: -73.6, ymax: 4.3 },
  });
  assert.strictEqual(parsed.href, "https://mapas2.igac.gov.co/a/b.tif");
  const declaration = igac.declarationFor(index.items[1], {
    bbox: [-73.7, 4.2, -73.6, 4.3],
    width: 120,
    height: 90,
    marginM: 60,
    effectiveResolutionM: 10.2,
  });
  assert.strictEqual(declaration.product, "DTM");
  assert.strictEqual(declaration.bareEarth, true);
  assert.strictEqual(declaration.sourceId, "igac-10");
  assert.strictEqual(declaration.validation, "not_validated");
  assert.strictEqual(declaration.request.effectiveResolutionM, 10.2);
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
