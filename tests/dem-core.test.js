/* Pruebas del nucleo DEM. Ejecutar: node tests/dem-core.test.js */
"use strict";

const assert = require("assert");
const core = require("../dem/dem-core.js");

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

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL - ${name}\n  ${error.message}`);
  }
}

function approx(actual, expected, tolerance, label) {
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `${label || "valor"}: esperado ${expected} +/- ${tolerance}, obtenido ${actual}`
  );
}

function plane(width, height, cell, gradientPct) {
  const z = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      z[y * width + x] = x * cell * (gradientPct / 100);
    }
  }
  return z;
}

function interiorMask(width, height, margin) {
  const m = Math.max(1, Math.trunc(margin || 1));
  const mask = new Uint8Array(width * height);
  for (let y = m; y < height - m; y += 1) {
    for (let x = m; x < width - m; x += 1) mask[y * width + x] = 1;
  }
  return mask;
}

test("Horn: plano al 10 % con celdas de 5 m", () => {
  const w = 100;
  const h = 100;
  const slope = core.hornSlope(plane(w, h, 5, 10), w, h, 5, 5);
  const stats = core.slopeStats(slope, interiorMask(w, h));
  approx(stats.meanPct, 10, 1e-6, "media");
  approx(stats.p95Pct, 10, 1e-6, "p95");
});

test("Horn: plano al 2 % con celdas de 30 m", () => {
  const w = 60;
  const h = 60;
  const slope = core.hornSlope(plane(w, h, 30, 2), w, h, 30, 30);
  const stats = core.slopeStats(slope, interiorMask(w, h));
  approx(stats.meanPct, 2, 1e-6, "media");
});

test("Horn: superficie horizontal da pendiente cero", () => {
  const w = 20;
  const h = 20;
  const z = new Float64Array(w * h).fill(100);
  const slope = core.hornSlope(z, w, h, 5, 5);
  // El collar interior debe tener 0 pendiente
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) mask[y * w + x] = 1;
  }
  const stats = core.slopeStats(slope, mask);
  approx(stats.meanPct, 0, 1e-9, "media");
  assert.strictEqual(stats.maxPct, 0);
});

test("Box blur: preserva un plano inclinado en el interior", () => {
  const w = 60;
  const h = 60;
  const blurred = core.boxBlur(plane(w, h, 5, 10), w, h, 3);
  const slope = core.hornSlope(blurred, w, h, 5, 5);
  const stats = core.slopeStats(slope, interiorMask(w, h, 4));
  approx(stats.meanPct, 10, 0.05, "media");
});

test("Bandas: limites 3, 7, 12, 25, 50, 75 y > 75", () => {
  assert.strictEqual(core.bandForSlope(2.99).id, "0-3");
  assert.strictEqual(core.bandForSlope(3).id, "3-7");
  assert.strictEqual(core.bandForSlope(7).id, "7-12");
  assert.strictEqual(core.bandForSlope(12).id, "12-25");
  assert.strictEqual(core.bandForSlope(25).id, "25-50");
  assert.strictEqual(core.bandForSlope(50).id, "50-75");
  assert.strictEqual(core.bandForSlope(75).id, ">75");
  assert.strictEqual(core.bandForSlope(-1), null);
});

test("Zonal: porcentajes por clase suman 100 %", () => {
  const values = Float32Array.from([1.5, 5, 10, 20, 30, 60, 80]);
  const result = core.zonalStats(values, 7, 1, null);
  assert.strictEqual(result.cells, 7);
  const sum = Object.values(result.classesPct).reduce((total, value) => total + value, 0);
  approx(sum, 100, 1e-9, "suma");
  Object.values(result.classesPct).forEach((value) => approx(value, 100 / 7, 1e-9, "clase"));
});

test("Clase: oficial II + pendiente 18 % -> propuesta IV, rojo y final sin confirmar", () => {
  const result = core.evaluateClass({ officialClass: "II", slopePct: 18 });
  assert.strictEqual(result.officialClass, "II");
  assert.strictEqual(result.slopeClass, "IV");
  assert.strictEqual(result.proposedClass, "IV");
  assert.strictEqual(result.finalClass, null);
  assert.strictEqual(result.delta, 2);
  assert.strictEqual(result.semaforo, "rojo");
  assert.strictEqual(result.status, "propuesta");
});

test("Clase: oficial II + pendiente 5 % -> propuesta II, verde", () => {
  const result = core.evaluateClass({ officialClass: "II", slopePct: 5 });
  assert.strictEqual(result.proposedClass, "II");
  assert.strictEqual(result.finalClass, null);
  assert.strictEqual(result.semaforo, "verde");
  assert.strictEqual(result.limitingFactor, "ninguno por pendiente");
});

test("Clase: la pendiente no mejora una clase oficial mas restrictiva", () => {
  const result = core.evaluateClass({ officialClass: "IV", slopePct: 5 });
  assert.strictEqual(result.proposedClass, "IV");
  assert.strictEqual(result.finalClass, null);
  assert.strictEqual(result.delta, 0);
  assert.strictEqual(result.semaforo, "verde");
});

test("Clase: sin carta de suelos -> no determinable", () => {
  const result = core.evaluateClass({ officialClass: null, slopePct: 10 });
  assert.strictEqual(result.status, "no determinable");
  assert.strictEqual(result.finalClass, null);
  assert.strictEqual(result.semaforo, "sin datos");
});

test("Celdas: 100 celdas equivalen a 9 ha (30 m), 0,25 ha (5 m) y 1,56 ha (12,5 m)", () => {
  approx(core.minAreaHa(30), 9, 1e-9, "30 m");
  approx(core.minAreaHa(5), 0.25, 1e-9, "5 m");
  approx(core.minAreaHa(12.5), 1.5625, 1e-9, "12,5 m");
  assert.strictEqual(core.requiredCells(10, 30), 111);
});

test("Validacion: DTM con huellas y sesgo <= 2 m es valido", () => {
  const result = core.validateDtm({
    product: "DTM",
    bareEarth: true,
    resolutionM: 5,
    validation: { status: "validated", n: 120, biasM: 0.4, rmseM: 1.1 },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.status, "validated");
  assert.strictEqual(result.statusEs, "validado");
});

test("Validacion: DSM no es valido como suelo", () => {
  const result = core.validateDtm({
    product: "DSM",
    bareEarth: false,
    resolutionM: 5,
    validation: { status: "validado", n: 120, biasM: 0.4 },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.reasons.some((reason) => reason.includes("DTM")));
});

test("Validacion: sesgo > 2 m o sin huellas -> no validado", () => {
  const biased = core.validateDtm({
    product: "DTM",
    bareEarth: true,
    resolutionM: 30,
    validation: { status: "validado", n: 50, biasM: 2.4 },
  });
  assert.strictEqual(biased.ok, false);
  const noPoints = core.validateDtm({
    product: "DTM",
    bareEarth: true,
    resolutionM: 30,
    validation: { status: "validado", n: 0, biasM: 0.2 },
  });
  assert.strictEqual(noPoints.ok, false);
});

test("Sector: DSM -> no apto para clase", () => {
  const result = core.canClassifySector({
    product: "DSM",
    cells: 2000,
    officialClass: "II",
    validation: { status: "validado" },
  });
  assert.strictEqual(result.canClass, false);
  assert.strictEqual(result.status, "no apto");
});

test("Sector: 5 ha con 30 m -> resolucion insuficiente (55 celdas)", () => {
  const cells = core.requiredCells(5, 30);
  assert.strictEqual(cells, 55);
  const result = core.canClassifySector({
    product: "DTM",
    cells,
    officialClass: "II",
    validation: { status: "validado" },
  });
  assert.strictEqual(result.canClass, false);
  assert.strictEqual(result.status, "resolucion insuficiente");
});

test("Sector: sin clase oficial -> no determinable", () => {
  const result = core.canClassifySector({
    product: "DTM",
    cells: 400,
    officialClass: null,
    validation: { status: "validado" },
  });
  assert.strictEqual(result.canClass, false);
  assert.strictEqual(result.status, "no determinable");
});

test("Sector: DTM validado -> propuesta, nunca confirmada automaticamente", () => {
  const result = core.canClassifySector({
    product: "DTM",
    cells: 600,
    officialClass: "III",
    validation: { status: "validado" },
  });
  assert.strictEqual(result.status, "propuesta");
  assert.strictEqual(result.canConfirm, false);
});

test("Sector: DTM sin validacion -> no validado", () => {
  const result = core.canClassifySector({
    product: "DTM",
    cells: 600,
    officialClass: "III",
    validation: { status: "pendiente" },
  });
  assert.strictEqual(result.status, "no validado");
  assert.strictEqual(result.canConfirm, false);
});

test("Incertidumbre: 5 m / LE90 1,4 m / ventana 25 m ~ 6,6 %", () => {
  approx(core.slopeUncertaintyPct(1.4, 25, 5), 6.6, 0.1, "incertidumbre");
});

test("Ventana: 5 m resuelve 7 % con ventana de 25 m", () => {
  const result = core.chooseWindow({ verticalAccuracyM: 1.4, resolutionM: 5, targetPct: 7 });
  assert.strictEqual(result.possible, true);
  assert.strictEqual(result.windowM, 25);
});

test("Ventana: 30 m no resuelve 3 % ni con 50 m", () => {
  const result = core.chooseWindow({ verticalAccuracyM: 2.5, resolutionM: 30, targetPct: 3 });
  assert.strictEqual(result.possible, false);
  assert.strictEqual(result.marginal, false);
});

test("Ventana: 30 m solo alcanza un resultado marginal para 7 %", () => {
  const result = core.chooseWindow({ verticalAccuracyM: 2.5, resolutionM: 30, targetPct: 7 });
  assert.strictEqual(result.possible, true);
  assert.strictEqual(result.marginal, true);
});

test("Resumen canonico: el orden de las claves no cambia el JSON", () => {
  const a = core.canonicalJson({ b: 1, a: { d: 2, c: 3 } });
  const b = core.canonicalJson({ a: { c: 3, d: 2 }, b: 1 });
  assert.strictEqual(a, b);
});

test("Resumen: excluye fotos, updatedAt y datos ajenos", () => {
  const summary = core.buildSummary({
    points: [{ lat: -34.9, lon: -60.3 }],
    dem: { sourceId: "x", product: "DTM", resolutionM: 30, windowM: 50 },
    sectors: [],
    photos: [{ caption: "no debe entrar" }],
    updatedAt: "2026-10-31T00:00:00.000Z",
  });
  const text = core.canonicalJson(summary);
  assert.ok(!text.includes("caption"));
  assert.ok(!text.includes("updatedAt"));
  assert.ok(text.includes("dem-summary-v2"));
});

test("Horn: borde y NODATA quedan sin dato, sin inventar gradiente", () => {
  const w = 10;
  const h = 10;
  const z = new Float64Array(w * h).fill(10);
  z[4 * w + 4] = NaN;
  const slope = core.hornSlope(z, w, h, 5, 5);
  assert.ok(Number.isNaN(slope[0]), "borde superior izquierdo");
  assert.ok(Number.isNaN(slope[9]), "borde superior derecho");
  assert.ok(Number.isNaN(slope[3 * w + 4]), "vecino directo del NODATA");
  assert.ok(Number.isNaN(slope[4 * w + 4]), "celda NODATA");
  assert.ok(Number.isFinite(slope[2 * w + 2]), "interior con todos sus vecinos");
});

test("Estados: tabla unica API/espanol y pares sin perder la etiqueta", () => {
  assert.strictEqual(core.statusToApi("class", "propuesta"), "proposed");
  assert.strictEqual(core.statusToApi("class", "no validado"), "topographic_limit");
  assert.strictEqual(core.statusToApi("class", "no apto"), "not_determinable");
  assert.strictEqual(core.statusToEs("class", "proposed"), "propuesta");
  assert.strictEqual(core.statusToEs("sector", "insufficient_resolution"), "resolucion insuficiente");
  assert.deepStrictEqual(
    core.statusPair("class", "no validado"),
    { status: "topographic_limit", statusEs: "no validado" }
  );
  assert.deepStrictEqual(
    core.statusPair("class", "topographic_limit"),
    { status: "topographic_limit", statusEs: "limitante topografica" }
  );
  assert.strictEqual(core.consistencyFromSemaforo("verde"), "green");
  assert.strictEqual(core.consistencyFromSemaforo("amarillo"), "red");
});

test("Base efectiva: 25 m a 5 m = 30 m y 50 m a 5 m = 60 m", () => {
  approx(core.effectiveBaselineM(25, 5), 30, 1e-9, "25/5");
  approx(core.effectiveBaselineM(50, 5), 60, 1e-9, "50/5");
  approx(core.effectiveBaselineM(25, 30), 60, 1e-9, "25/30 colapsa a 60");
  assert.strictEqual(core.slopeUncertaintyPct(1.4, 25, 5), (100 * Math.SQRT2 * 1.4) / 30);
});

test("Resumen v2: publica area, cobertura y distribucion por area", () => {
  const summary = core.buildSummary({
    points: [{ lat: 4.6, lon: -74.1 }],
    dem: { sourceId: "byod", product: "DTM", bareEarth: true, resolutionM: 5, windowM: 25, radiusCells: 2, effectiveBaselineM: 30 },
    sectors: [{
      id: "predio",
      name: "Predio",
      cells: 100,
      cellsGross: 120,
      areaHa: 0.25,
      areaGrossHa: 0.3,
      coverage: 0.833333,
      status: "ok",
      slope: {
        meanPct: 10, p50Pct: 9, p95Pct: 18, maxPct: 25, uncertaintyPct: 6.6,
        classesHa: { "7-12": 0.2, "12-25": 0.05 },
        classShare: { "7-12": 0.8, "12-25": 0.2 },
      },
      class: { officialClass: "II", slopeClass: "IV", proposedClass: "IV", finalClass: null, status: "proposed" },
    }],
  });
  assert.strictEqual(summary.kind, "dem-summary-v2");
  assert.strictEqual(summary.sectors[0].areaGrossHa, 0.3);
  assert.strictEqual(summary.sectors[0].coverage, 0.833333);
  assert.deepStrictEqual(summary.sectors[0].slope.classesHa, { "12-25": 0.05, "7-12": 0.2 });
  assert.deepStrictEqual(summary.sectors[0].slope.classShare, { "12-25": 0.2, "7-12": 0.8 });
  assert.strictEqual(summary.sectors[0].class.finalClass, null);
  assert.ok(!core.canonicalJson(summary).includes("computedAt"));
  assert.ok(!core.canonicalJson(summary).includes("computeMs"));
});


(async () => {
  await testAsync("Hash: mismo resumen -> mismo SHA-256", async () => {
    const input = {
      points: [{ lat: -34.9015, lon: -60.3018 }, { lat: -34.9001, lon: -60.3002 }],
      dem: { sourceId: "global-fabdem-v1.2", product: "DTM", resolutionM: 30, windowM: 50 },
      sectors: [{ id: "s1", areaHa: 10, slope: { meanPct: 2, p50Pct: 2, p95Pct: 3, maxPct: 4 } }],
      rulesId: "co-igac-upra-2026.1",
    };
    const reordered = {
      rulesId: "co-igac-upra-2026.1",
      sectors: input.sectors,
      dem: input.dem,
      points: input.points,
    };
    const one = await core.sha256Hex(core.canonicalJson(core.buildSummary(input)));
    const two = await core.sha256Hex(core.canonicalJson(core.buildSummary(reordered)));
    assert.strictEqual(one, two);
    assert.strictEqual(one.length, 64);
  });

  await testAsync("Hash: un vertice distinto cambia el SHA-256", async () => {
    const base = { points: [{ lat: -34.9015, lon: -60.3018 }], dem: { resolutionM: 30 }, sectors: [] };
    const one = await core.sha256Hex(core.canonicalJson(core.buildSummary(base)));
    const two = await core.sha256Hex(core.canonicalJson(core.buildSummary({
      ...base,
      points: [{ lat: -34.9016, lon: -60.3018 }],
    })));
    assert.notStrictEqual(one, two);
  });

  console.log(`\n${passed} pruebas aprobadas, ${failures.length} fallidas.`);
  if (failures.length) {
    failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack}`));
    process.exitCode = 1;
  }
})();
