/* Integridad del registro de fuentes y del ruleset Colombia. */
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const core = require("../dem/dem-core.js");

const demDir = path.join(__dirname, "..", "dem");
const sources = JSON.parse(fs.readFileSync(path.join(demDir, "sources.json"), "utf8"));
const rules = JSON.parse(fs.readFileSync(path.join(demDir, "rules.colombia.json"), "utf8"));

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

const REQUIRED = [
  "id", "country", "name", "product", "coverage", "resolutionM",
  "verticalAccuracyM", "acquisitionYear", "publicationYear", "method",
  "license", "tier", "priority", "url",
];

test("Todas las fuentes tienen los campos obligatorios", () => {
  sources.sources.forEach((source) => {
    REQUIRED.forEach((field) => {
      assert.ok(Object.prototype.hasOwnProperty.call(source, field), `${source.id} carece de ${field}`);
    });
    assert.ok(["DTM", "DSM", "SOIL"].includes(source.product), `${source.id}: product invalido`);
    assert.ok(source.license && typeof source.license.commercialUse === "boolean", `${source.id}: licencia incompleta`);
  });
});

test("Existe una sola fuente free30, una pro5 y al menos una local", () => {
  const count = (tier) => sources.sources.filter((source) => source.tier === tier).length;
  assert.strictEqual(count("free30"), 1);
  assert.strictEqual(count("pro5"), 1);
  assert.ok(count("local_lidar") >= 1);
});

test("FABDEM esta marcado como no comercial y con bloqueo explicito", () => {
  const fabdem = sources.sources.find((source) => source.id === "global-fabdem-v1.2");
  assert.ok(fabdem);
  assert.strictEqual(fabdem.license.commercialUse, false);
  assert.ok(fabdem.license.blocker.includes("FABDEM+"));
});

test("WorldDEM Neo exige licencia de distribucion", () => {
  const worlddem = sources.sources.find((source) => source.id === "global-worlddem-neo-dtm");
  assert.ok(worlddem);
  assert.strictEqual(worlddem.product, "DTM");
  assert.strictEqual(worlddem.license.redistribution, false);
  assert.ok(worlddem.license.blocker.includes("distribucion"));
});

test("IGAC LiDAR es DTM, gratuito y de prioridad 1", () => {
  const igac = sources.sources.find((source) => source.id === "co-igac-lidar-mdt");
  assert.ok(igac);
  assert.strictEqual(igac.product, "DTM");
  assert.strictEqual(igac.tier, "local_lidar");
  assert.strictEqual(igac.priority, 1);
  assert.strictEqual(igac.coverage.checkRequired, true);
});

test("La capa de suelos no se registra como DEM", () => {
  const soils = sources.sources.find((source) => source.id === "co-igac-upra-suelos");
  assert.ok(soils);
  assert.strictEqual(soils.product, "SOIL");
  assert.strictEqual(soils.scale, "1:100000");
});

test("Productos prohibidos declarados (SRTM, GLO-30, ALOS, RTC)", () => {
  const text = JSON.stringify(sources.forbiddenAsGround);
  ["SRTM", "GLO-30", "AW3D30", "PALSAR RTC"].forEach((name) => {
    assert.ok(text.includes(name), `Falta ${name} en la lista prohibida`);
  });
});

test("Ruleset: bandas ordenadas y sin huecos", () => {
  const bands = rules.slopeBands;
  assert.strictEqual(bands[0].min, 0);
  assert.strictEqual(bands[bands.length - 1].max, null);
  for (let i = 1; i < bands.length; i += 1) {
    assert.strictEqual(bands[i].min, bands[i - 1].max, `Hueco entre ${bands[i - 1].id} y ${bands[i].id}`);
  }
});

test("Ruleset: clases I a VIII y la pendiente no mejora", () => {
  assert.deepStrictEqual(rules.classOrder, ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]);
  assert.strictEqual(rules.evaluation.slopeCanImproveClass, false);
  assert.strictEqual(rules.evaluation.combine, "mostRestrictive");
});

test("Integracion: oficial II + 18 % -> IV con semaforo rojo", () => {
  const result = core.evaluateClass({ officialClass: "II", slopePct: 18, rules });
  assert.strictEqual(result.finalClass, "IV");
  assert.strictEqual(result.semaforo, "rojo");
  assert.strictEqual(result.status, "propuesta");
});

test("Integracion: las advertencias de escala 1:100.000 estan presentes", () => {
  const text = rules.warnings.join(" ");
  assert.ok(text.includes("1:100.000"));
  assert.ok(text.includes("5 m"));
  assert.ok(text.includes("30 m"));
});

console.log(`\n${passed} pruebas aprobadas, ${failures.length} fallidas.`);
if (failures.length) {
  failures.forEach(({ name, error }) => console.error(`\n${name}\n${error.stack}`));
  process.exitCode = 1;
}
