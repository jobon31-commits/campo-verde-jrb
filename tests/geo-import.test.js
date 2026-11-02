/* Pruebas de importacion de poligonos. Ejecutar: node tests/geo-import.test.js */
"use strict";

const assert = require("assert");
const geo = require("../geo/import.js");

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL - ${name}\n  ${error.message}`);
  }
}

test("GeoJSON Polygon: lee el anillo exterior y quita el cierre", () => {
  const text = JSON.stringify({
    type: "Feature",
    properties: { name: "Lote norte" },
    geometry: {
      type: "Polygon",
      coordinates: [[
        [-60.301, -34.901],
        [-60.300, -34.901],
        [-60.300, -34.900],
        [-60.301, -34.900],
        [-60.301, -34.901],
      ]],
    },
  });
  const result = geo.parsePolygonText(text, "lote.geojson");
  assert.strictEqual(result.format, "GeoJSON");
  assert.strictEqual(result.points.length, 4);
  assert.strictEqual(result.name, "Lote norte");
  assert.strictEqual(result.points[0].lat, -34.901);
  assert.strictEqual(result.points[0].lon, -60.301);
});

test("GeoJSON Polygon: avisa si hay huecos y usa el exterior", () => {
  const text = JSON.stringify({
    type: "Polygon",
    coordinates: [
      [[-60.301, -34.901], [-60.300, -34.901], [-60.300, -34.900], [-60.301, -34.900]],
      [[-60.3006, -34.9008], [-60.3004, -34.9008], [-60.3004, -34.9006], [-60.3006, -34.9006]],
    ],
  });
  const result = geo.parsePolygonText(text, "hueco.json");
  assert.strictEqual(result.points.length, 4);
  assert.ok(result.warnings.some((text) => text.includes("huecos")));
});

test("GeoJSON MultiPolygon: carga el primero y avisa", () => {
  const text = JSON.stringify({
    type: "MultiPolygon",
    coordinates: [
      [[[-60.301, -34.901], [-60.300, -34.901], [-60.300, -34.900], [-60.301, -34.900]]],
      [[[-60.299, -34.899], [-60.298, -34.899], [-60.298, -34.898], [-60.299, -34.898]]],
    ],
  });
  const result = geo.parsePolygonText(text, "multi.geojson");
  assert.strictEqual(result.points.length, 4);
  assert.strictEqual(result.points[0].lon, -60.301);
  assert.ok(result.warnings.some((text) => text.includes("2 polígonos")));
});

test("KML: lee el polígono y no una línea anterior", () => {
  const text = `<?xml version="1.0"?><kml><Document>
    <Placemark><LineString><coordinates>-60.900,-34.900,0 -60.800,-34.900,0 -60.800,-34.800,0</coordinates></LineString></Placemark>
    <Placemark><Polygon><outerBoundaryIs><LinearRing><coordinates>
    -60.301,-34.901,0 -60.300,-34.901,0 -60.300,-34.900,0 -60.301,-34.900,0 -60.301,-34.901,0
  </coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Document></kml>`;
  const result = geo.parsePolygonText(text, "lote.kml");
  assert.strictEqual(result.format, "KML");
  assert.strictEqual(result.points.length, 4);
  assert.strictEqual(result.points[0].lat, -34.901);
  assert.strictEqual(result.points[0].lon, -60.301);
});

test("CSV/TXT: acepta encabezado, etiquetas y separadores", () => {
  const text = [
    "Vertice, Latitud, Longitud",
    "A, -34.901, -60.301",
    "B; -34.901; -60.300",
    "C -34.900 -60.300",
    "D, -34.900, -60.301",
  ].join("\n");
  const result = geo.parsePolygonText(text, "lote.csv");
  assert.strictEqual(result.format, "CSV/TXT");
  assert.strictEqual(result.points.length, 4);
  assert.strictEqual(result.points[1].lon, -60.300);
  assert.strictEqual(result.points[2].lat, -34.900);
});

test("CSV/TXT: acepta coma decimal en pares", () => {
  const text = "-34,901, -60,301\n-34,901, -60,300\n-34,900, -60,300";
  const result = geo.parsePolygonText(text, "lote.txt");
  assert.strictEqual(result.points.length, 3);
  assert.strictEqual(result.points[0].lat, -34.901);
  assert.strictEqual(result.points[0].lon, -60.301);
});

test("Errores: JSON invalido, sin poligono, menos de 3 vertices y rango", () => {
  assert.throws(() => geo.parsePolygonText("{", "x.geojson"), /JSON/);
  assert.throws(() => geo.parsePolygonText(JSON.stringify({ type: "Point", coordinates: [0, 0] }), "x.json"), /Polygon/);
  assert.throws(() => geo.parsePolygonText("1, 2\n3, 4", "x.csv"), /3 vértices/);
  assert.throws(() => geo.parsePolygonText("95, -60\n-34, -60\n-34, -59", "x.csv"), /latitud/);
});

console.log(`\n${passed} pruebas aprobadas, ${failures.length} fallidas.`);
if (failures.length) {
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack}`));
  process.exitCode = 1;
}
