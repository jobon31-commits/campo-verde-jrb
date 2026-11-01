/* Pruebas del calculo DEM BYOD. Ejecutar: node tests/dem-compute.test.js */
"use strict";

const assert = require("assert");
const core = require("../dem/dem-core.js");
const compute = require("../dem/dem-compute.js");

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

const CELL = 0.00005;
const WEST = -74.1;
const NORTH = 4.6;
const M_PER_DEG = 111195.0802335329;
const LAT0 = 4.6;
const CELL_XM = CELL * M_PER_DEG * Math.cos(LAT0 * Math.PI / 180);
const CELL_YM = CELL * M_PER_DEG;

function makeGrid(options) {
  const width = options.width || 40;
  const height = options.height || 40;
  const cell = options.cell || CELL;
  const west = options.west ?? WEST;
  const north = options.north ?? NORTH;
  const data = new Float32Array(width * height);
  const cellXm = cell * M_PER_DEG * Math.cos(LAT0 * Math.PI / 180);
  const cellYm = cell * M_PER_DEG;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const row = height - 1 - y; // y local desde el sur
      data[row * width + x] = options.value
        ? options.value(x, y, cellXm, cellYm)
        : x * cellXm * 0.10;
    }
  }
  return {
    width,
    height,
    cellX: cell,
    cellY: cell,
    x0: west,
    y0: north - height * cell,
    west,
    east: west + width * cell,
    south: north - height * cell,
    north,
    data,
    nodata: -9999,
    crs: "EPSG:4326",
    source: "test",
    meta: { format: "ASC" },
  };
}

// Rectangulo alineado a bordes de celda: columnas [col0, col1), filas [row0, row1)
function rect(grid, col0, row0, cols, rows) {
  const west = grid.west + col0 * grid.cellX;
  const east = grid.west + (col0 + cols) * grid.cellX;
  const north = grid.north - row0 * grid.cellY;
  const south = grid.north - (row0 + rows) * grid.cellY;
  return [
    { lat: north, lon: west },
    { lat: north, lon: east },
    { lat: south, lon: east },
    { lat: south, lon: west },
  ];
}

const DTM_DECL = {
  sourceId: "byod",
  name: "DEM de prueba",
  product: "DTM",
  bareEarth: true,
  fileName: "prueba.asc",
  format: "ASC",
  license: "Datos abiertos de prueba",
  attribution: "Prueba",
  acquisitionYear: 2024,
  verticalAccuracyM: 1.4,
  method: "LiDAR",
};

function validated(extra) {
  return {
    ...DTM_DECL,
    ...extra,
    validation: { source: "GEDI L2A", n: 120, biasM: 0.3, rmseM: 1.1, status: "validado" },
  };
}

test("Rasterizacion: rectangulo de 20 x 20 celdas da 400 celdas", () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const mask = new Uint8Array(grid.width * grid.height);
  const cells = compute.rasterizeRing(rect(grid, 10, 10, 20, 20), grid, mask);
  assert.strictEqual(cells, 400);
  assert.strictEqual(mask.reduce((sum, value) => sum + value, 0), 400);
});

test("Recorte: conserva georreferencia y margen", () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const win = compute.clipGrid(grid, compute.bboxOf([rect(grid, 10, 10, 20, 20)]), 3);
  assert.ok(win.width >= 26 && win.height >= 26);
  approx(win.west, grid.west + 7 * grid.cellX, 1e-12, "west");
  approx(win.north, grid.north - 7 * grid.cellY, 1e-12, "north");
});

test("Blur enmascarado: conserva un plano al 10 % y no propaga NaN", () => {
  const width = 30;
  const height = 30;
  const z = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) z[y * width + x] = x * CELL_XM * 0.10;
  }
  z[5 * width + 5] = NaN;
  const blurred = compute.maskedBlur(z, width, height, 2);
  assert.ok(Number.isFinite(blurred[5 * width + 6]), "el vecino del NaN debe tener dato");
  const slope = core.hornSlope(blurred, width, height, CELL_XM, CELL_YM);
  const mask = new Uint8Array(width * height);
  for (let y = 4; y < height - 4; y += 1) {
    for (let x = 4; x < width - 4; x += 1) mask[y * width + x] = 1;
  }
  const stats = core.slopeStats(slope, mask);
  approx(stats.meanPct, 10, 0.02, "media");
});

test("Ventana: 5 m con LE90 1,4 m elige 25 m", () => {
  const choice = compute.pickWindow({ resolutionM: 5, verticalAccuracyM: 1.4, targetPct: 7 });
  assert.strictEqual(choice.windowM, 25);
  assert.strictEqual(choice.possible, true);
  assert.strictEqual(choice.radius, 2);
  assert.ok(choice.effectiveWindowM > choice.windowM);
});

test("Ventana: 30 m con LE90 2,5 m no resuelve el 3 %", () => {
  const choice = compute.pickWindow({ resolutionM: 30, verticalAccuracyM: 2.5, targetPct: 3 });
  assert.strictEqual(choice.possible, false);
  assert.strictEqual(choice.marginal, false);
  assert.strictEqual(choice.windowM, 50);
});

test("Ventana: respeta una ventana pedida por el usuario", () => {
  const choice = compute.pickWindow({ resolutionM: 5, verticalAccuracyM: 1.4, windowM: 10, targetPct: 7 });
  assert.strictEqual(choice.windowM, 10);
  assert.strictEqual(choice.possible, false);
  assert.strictEqual(choice.marginal, false);
});

test("Clase: sin carta de suelos queda no determinable", () => {
  const result = compute.sectorClass({
    product: "DTM",
    cells: 400,
    officialClass: null,
    validation: { status: "validado" },
    slopePct: 5,
    minCells: 100,
  });
  assert.strictEqual(result.status, "no determinable");
  assert.strictEqual(result.finalClass, null);
  assert.strictEqual(result.semaforo, "sin datos");
});

test("Clase: DSM no es apto y no propone clase", () => {
  const result = compute.sectorClass({
    product: "DSM",
    cells: 400,
    officialClass: "II",
    validation: { status: "validado" },
    slopePct: 5,
    minCells: 100,
  });
  assert.strictEqual(result.status, "no apto");
  assert.strictEqual(result.semaforo, "sin datos");
  assert.strictEqual(result.canConfirm, false);
});

test("Clase: oficial II sin validacion -> no validado, aunque proponga IV", () => {
  const result = compute.sectorClass({
    product: "DTM",
    cells: 400,
    officialClass: "II",
    validation: { status: "pendiente" },
    slopePct: 18,
    minCells: 100,
  });
  assert.strictEqual(result.status, "no validado");
  assert.strictEqual(result.finalClass, "IV");
  assert.strictEqual(result.semaforo, "rojo");
});

test("Clase: DTM validado II + 18 % -> propuesta IV, nunca confirmada", () => {
  const result = compute.sectorClass({
    product: "DTM",
    cells: 400,
    officialClass: "II",
    validation: { status: "validado" },
    slopePct: 18,
    minCells: 100,
  });
  assert.strictEqual(result.status, "propuesta");
  assert.strictEqual(result.finalClass, "IV");
  assert.strictEqual(result.canConfirm, false);
});

testAsync("Analisis: plano al 10 % con DTM validado", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const polygon = rect(grid, 10, 10, 20, 20);
  const result = await compute.analyze({
    grid,
    polygon,
    dem: validated(),
    officialClass: "II",
    options: { windowM: 10, minCells: 100 },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.meta.cells, 400);
  assert.strictEqual(result.meta.validCells, 400);
  assert.strictEqual(result.meta.resolutionM, 5.551, "resolucion");
  approx(result.slope.meanPct, 10, 0.05, "media");
  approx(result.slope.p95Pct, 10, 0.05, "p95");
  approx(result.meta.areaHa, 400 * CELL_XM * CELL_YM / 10000, 1e-3, "area de celdas");
  approx(result.meta.areaPolygonHa, 400 * CELL_XM * CELL_YM / 10000, 0.02, "area del poligono");
  assert.strictEqual(result.sectors.length, 1);
  assert.strictEqual(result.sectors[0].class.status, "propuesta");
  assert.strictEqual(result.sectors[0].class.officialClass, "II");
  assert.strictEqual(result.sectors[0].class.slopeClass, "III");
  assert.strictEqual(result.sectors[0].class.finalClass, "III");
  assert.strictEqual(result.validation.ok, true);
  assert.strictEqual(result.hash.length, 64);
});

testAsync("Analisis: oficial II + 18 % -> IV rojo", async () => {
  const grid = makeGrid({
    width: 44,
    height: 44,
    value: (x, y, cellXm) => x * cellXm * 0.18,
  });
  const result = await compute.analyze({
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: validated(),
    officialClass: "II",
    options: { windowM: 10 },
  });
  assert.strictEqual(result.sectors[0].class.officialClass, "II");
  assert.strictEqual(result.sectors[0].class.slopeClass, "IV");
  assert.strictEqual(result.sectors[0].class.finalClass, "IV");
  assert.strictEqual(result.sectors[0].class.semaforo, "rojo");
  assert.strictEqual(result.sectors[0].class.delta, 2);
  assert.strictEqual(result.sectors[0].class.status, "propuesta");
});

testAsync("Analisis: 5 ha con 30 m -> resolucion insuficiente", async () => {
  const cell30 = 30 / (M_PER_DEG * Math.cos(LAT0 * Math.PI / 180));
  const grid = makeGrid({ width: 16, height: 16, cell: cell30 });
  const polygon = rect(grid, 3, 3, 8, 7); // 56 celdas ~ 5,04 ha
  const result = await compute.analyze({
    grid,
    polygon,
    dem: validated(),
    officialClass: "II",
    options: { windowM: 30, minCells: 100 },
  });
  assert.strictEqual(result.meta.cells, 56);
  assert.strictEqual(result.sectors[0].class.status, "resolucion insuficiente");
  assert.ok(result.warnings.some((text) => text.includes("minimo es 100")));
});

testAsync("Analisis: DSM calcula pendiente pero no clase", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const result = await compute.analyze({
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: { ...DTM_DECL, product: "DSM", bareEarth: false },
    officialClass: "II",
    options: { windowM: 10 },
  });
  assert.strictEqual(result.sectors[0].class.status, "no apto");
  assert.strictEqual(result.sectors[0].class.finalClass, null);
  assert.ok(result.warnings.some((text) => text.includes("DSM")));
});

testAsync("Analisis: sin carta de suelos -> no determinable", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const result = await compute.analyze({
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: validated(),
    options: { windowM: 10 },
  });
  assert.strictEqual(result.sectors[0].class.status, "no determinable");
  assert.ok(result.warnings.some((text) => text.includes("carta de suelos")));
});

testAsync("Analisis: sin validacion -> no validado", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const result = await compute.analyze({
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: { ...DTM_DECL, validation: { status: "pendiente" } },
    officialClass: "II",
    options: { windowM: 10 },
  });
  assert.strictEqual(result.validation.ok, false);
  assert.strictEqual(result.validation.status, "no validado");
  assert.strictEqual(result.sectors[0].class.status, "no validado");
});

testAsync("Analisis: DEM que no cubre el predio se rechaza", async () => {
  const grid = makeGrid({ width: 20, height: 20 });
  const outside = [
    { lat: grid.north - 2 * grid.cellY, lon: grid.west - 5 * grid.cellX },
    { lat: grid.north - 2 * grid.cellY, lon: grid.west + 5 * grid.cellX },
    { lat: grid.north - 8 * grid.cellY, lon: grid.west + 5 * grid.cellX },
    { lat: grid.north - 8 * grid.cellY, lon: grid.west - 5 * grid.cellX },
  ];
  await assert.rejects(
    () => compute.analyze({ grid, polygon: outside, dem: validated(), options: { windowM: 10 } }),
    (error) => error.code === "DEM_COVERAGE"
  );
});

testAsync("Analisis: NODATA se excluye y se advierte", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  for (let y = 15; y < 25; y += 1) {
    for (let x = 15; x < 25; x += 1) grid.data[y * grid.width + x] = NaN;
  }
  const result = await compute.analyze({
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: validated(),
    officialClass: "II",
    options: { windowM: 10 },
  });
  assert.ok(result.meta.nodataCells > 0);
  assert.ok(result.meta.validCells < result.meta.cells);
  assert.ok(result.warnings.some((text) => text.includes("NODATA")));
});

testAsync("Hash: mismo analisis -> mismo hash; cambia la clase oficial", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const input = {
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: validated(),
    options: { windowM: 10 },
  };
  const one = await compute.analyze(input);
  const two = await compute.analyze(input);
  assert.strictEqual(one.hash, two.hash);
  const other = await compute.analyze({ ...input, officialClass: "III" });
  assert.notStrictEqual(one.hash, other.hash);
});

testAsync("Analisis: progreso reporta etapas y termina en 100", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const stages = [];
  await compute.analyze({
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: validated(),
    options: { windowM: 10 },
    onProgress: (stage, pct) => stages.push({ stage, pct }),
  });
  assert.ok(stages.length >= 4);
  assert.strictEqual(stages[stages.length - 1].pct, 100);
  assert.ok(stages.some((item) => item.stage === "slope"));
});

testAsync("Analisis: avisa si faltan error vertical, año, licencia o clase V", async () => {
  const grid = makeGrid({ width: 44, height: 44 });
  const result = await compute.analyze({
    grid,
    polygon: rect(grid, 10, 10, 20, 20),
    dem: {
      ...validated(),
      verticalAccuracyM: null,
      acquisitionYear: null,
      license: null,
      officialClass: "V",
    },
    options: { windowM: 10 },
  });
  const text = result.warnings.join(" | ");
  assert.ok(text.includes("error vertical"), "debe avisar el error vertical");
  assert.ok(text.includes("ano de captura"), "debe avisar el ano");
  assert.ok(text.includes("licencia"), "debe avisar la licencia");
  assert.ok(text.includes("clase oficial V"), "debe avisar la clase V");
});

testAsync("Analisis: poligono con menos de 3 vertices se rechaza", async () => {
  const grid = makeGrid({ width: 20, height: 20 });
  await assert.rejects(
    () => compute.analyze({ grid, polygon: [{ lat: 4.6, lon: -74.1 }, { lat: 4.6, lon: -74.09 }], dem: validated() }),
    (error) => error.code === "DEM_POLYGON"
  );
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
