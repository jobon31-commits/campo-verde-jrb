/* Genera dem/igac-index.json desde los ImageServer públicos del IGAC.
   Uso: node tools/build-igac-index.js
   Requiere internet. No se ejecuta en la app. */
"use strict";

const fs = require("fs");
const path = require("path");

const SEARCH_URL = "https://www.arcgis.com/sharing/rest/search";
const PROJECT_URL = "https://utility.arcgisonline.com/arcgis/rest/services/Geometry/GeometryServer/project";
const QUERY = 'owner:IGAC-Admin title:"Modelo Digital de Terreno" type:"Image Service"';
const PAGE_SIZE = 100;
const PROJECT_BATCH = 40;

async function getJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  const json = await response.json();
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  return json;
}

async function searchAll() {
  const results = [];
  let start = 1;
  let total = null;
  while (total === null || start <= total) {
    const params = new URLSearchParams({
      q: QUERY,
      num: String(PAGE_SIZE),
      start: String(start),
      f: "json",
    });
    const json = await getJson(`${SEARCH_URL}?${params}`);
    total = Number(json.total) || 0;
    (json.results || []).forEach((item) => results.push(item));
    if (!json.nextStart || json.nextStart < 0) break;
    start = json.nextStart;
  }
  return { total, results };
}

function sourceCrs(item) {
  const raw = String(item.spatialReference || "");
  if (/4326|wgs/i.test(raw)) return 4326;
  if (/9377|origen/i.test(raw)) return 9377;
  if (/3857|102100|web.?mercator/i.test(raw)) return 3857;
  return null;
}

function normalizeUrl(url) {
  return String(url || "")
    .replace("https://mapas.igac.gov.co/", "https://mapas2.igac.gov.co/")
    .replace("http://mapas.igac.gov.co/", "https://mapas2.igac.gov.co/");
}

function parseResolution(title) {
  const match = String(title || "").match(/Resoluci[oó]n\s+([\d.,]+)\s*(cm|m|metros?)/i);
  if (!match) return null;
  const value = Number(match[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  return /cm/i.test(match[2]) ? value / 100 : value;
}

function parseYear(item) {
  const text = `${item.title || ""} ${item.description || ""}`;
  const match = text.match(/(?:Año|año)\s+(\d{4})/);
  return match ? Number(match[1]) : null;
}

function coverageType(item) {
  const text = `${item.title || ""} ${item.description || ""}`;
  if (/cabecera municipal|centro poblado/i.test(text)) return "partial";
  if (/parcialmente|cobertura parcial/i.test(text)) return "partial";
  return "municipal";
}

function municipalityName(item) {
  const text = String(item.title || "").replace(/^Modelo Digital de Terreno\.?\s*/i, "");
  const match = text.match(/Municipio(?:s)? de ([^.]+)/i);
  return match ? match[1].trim() : null;
}

function envelopeFor(item) {
  const extent = item.extent;
  if (!Array.isArray(extent) || extent.length < 2) return null;
  const [a, b] = extent;
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const xmin = Number(a[0]);
  const ymin = Number(a[1]);
  const xmax = Number(b[0]);
  const ymax = Number(b[1]);
  if (![xmin, ymin, xmax, ymax].every(Number.isFinite)) return null;
  if (!(xmax > xmin) || !(ymax > ymin)) return null;
  return { xmin, ymin, xmax, ymax };
}

async function projectBatch(items, inSR) {
  const body = new URLSearchParams();
  body.set("f", "json");
  body.set("inSR", String(inSR));
  body.set("outSR", "4326");
  body.set("geometries", JSON.stringify({
    geometryType: "esriGeometryEnvelope",
    geometries: items.map((item) => ({
      ...item.envelope,
      spatialReference: { wkid: inSR },
    })),
  }));
  const json = await getJson(PROJECT_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  return json.geometries || [];
}

async function projectAll(records) {
  const groups = new Map();
  records.forEach((record) => {
    if (!groups.has(record.inSR)) groups.set(record.inSR, []);
    groups.get(record.inSR).push(record);
  });
  for (const [inSR, group] of groups) {
    if (inSR === 4326) {
      group.forEach((record) => {
        record.bbox = [
          record.envelope.xmin,
          record.envelope.ymin,
          record.envelope.xmax,
          record.envelope.ymax,
        ];
      });
      continue;
    }
    for (let i = 0; i < group.length; i += PROJECT_BATCH) {
      const batch = group.slice(i, i + PROJECT_BATCH);
      process.stderr.write(`Proyectando ${i + 1}-${Math.min(i + batch.length, group.length)} de ${group.length} (EPSG:${inSR})…\n`);
      const projected = await projectBatch(batch, inSR);
      projected.forEach((geometry, index) => {
        if (!geometry || !Number.isFinite(geometry.xmin)) return;
        batch[index].bbox = [geometry.xmin, geometry.ymin, geometry.xmax, geometry.ymax];
      });
    }
  }
}

async function main() {
  const { total, results } = await searchAll();
  process.stderr.write(`IGAC: ${results.length} de ${total} servicios.\n`);
  const records = [];
  results.forEach((item) => {
    const envelope = envelopeFor(item);
    const inSR = sourceCrs(item);
    if (!envelope || !inSR || !item.url) return;
    records.push({
      itemId: item.id,
      envelope,
      inSR,
      title: item.title || "",
      url: normalizeUrl(item.url),
      description: item.description || "",
      created: item.created,
    });
  });
  await projectAll(records);
  const items = records
    .filter((record) => Array.isArray(record.bbox) && record.bbox.length === 4)
    .map((record) => {
      const title = record.title;
      return {
        id: `igac-${record.itemId}`,
        itemId: record.itemId,
        name: municipalityName(record) || title.replace(/^Modelo Digital de Terreno\.?\s*/i, "").slice(0, 90),
        title,
        url: record.url,
        bbox: record.bbox.map((value) => Math.round(value * 1e8) / 1e8),
        resolutionM: parseResolution(title),
        year: parseYear(record),
        coverage: coverageType(record),
        product: "DTM",
        source: "IGAC",
        license: "Datos abiertos IGAC",
        licenseUrl: "https://www.igac.gov.co/datos-abiertos/",
        attribution: "Instituto Geográfico Agustín Codazzi (IGAC)",
        commercialUse: true,
        redistribution: true,
        verticalAccuracyM: null,
        validation: "not_validated",
        tier: "local_lidar",
      };
    })
    .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);

  const output = {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    source: "IGAC ArcGIS Online · ImageServer MDT",
    query: QUERY,
    count: items.length,
    items,
  };
  const target = path.resolve(__dirname, "..", "dem", "igac-index.json");
  fs.writeFileSync(target, `${JSON.stringify(output)}\n`, "utf8");
  process.stderr.write(`Escrito ${target} con ${items.length} servicios.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
