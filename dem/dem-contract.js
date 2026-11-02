/* ============================================================
   CAMPO VERDE JRB · adaptador de contrato API v1
   Traduce el resultado del calculo DEM (BYOD) a la forma del
   contrato /slope. No recalcula: renombra, completa estados y
   declara la licencia BYOD. No inventa precision ni clase.
   ============================================================ */
(function (root, factory) {
  "use strict";
  const core = (typeof module === "object" && module.exports)
    ? require("./dem-core.js")
    : (root && root.CVDem);
  const api = factory(core);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CVDemContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (core) {
  "use strict";

  if (!core) throw new Error("CVDemContract necesita dem-core.js.");

  const CONTRACT_VERSION = "1.0.0";
  const BAND_IDS = ["0-3", "3-7", "7-12", "12-25", "25-50", "50-75", ">75"];

  function finite(value) {
    return Number.isFinite(Number(value));
  }

  function numberOrNull(value) {
    return finite(value) ? Number(value) : null;
  }

  function integer(value) {
    return finite(value) ? Math.max(0, Math.trunc(Number(value))) : 0;
  }

  function round(value, digits) {
    if (!finite(value)) return value;
    const factor = 10 ** digits;
    return Math.round(Number(value) * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function licenseBlock(result) {
    const meta = result && result.meta ? result.meta : {};
    const dem = result && result.dem ? result.dem : {};
    if (meta.license && typeof meta.license === "object") {
      const block = { ...meta.license };
      if (block.declared === undefined) {
        block.declared = dem.license || "No declarada";
      }
      return block;
    }
    return {
      licenseId: "byod-user-declared",
      holder: dem.attribution || "Usuario BYOD",
      type: "byod",
      redistribution: false,
      attribution: dem.attribution || dem.license || "No declarada",
      declared: dem.license || "No declarada",
    };
  }

  function validationBlock(result) {
    const validation = result && result.validation ? result.validation : {};
    const metaValidation = result && result.meta && result.meta.validation
      ? result.meta.validation
      : {};
    const source = validation.source || metaValidation.source || "none";
    const out = {
      source: source === "GEDI L2A" || source === "ICESat-2 ATL08" ? source : "none",
      n: integer(validation.n ?? metaValidation.n),
      status: core.statusToApi("validation", validation.status || metaValidation.status)
        || "not_validated",
      declared: Boolean((result && result.validation) || Object.keys(metaValidation).length),
    };
    const rmse = numberOrNull(validation.rmseM ?? metaValidation.rmseM);
    const bias = numberOrNull(validation.biasM ?? metaValidation.biasM);
    const p95 = numberOrNull(validation.p95M ?? metaValidation.p95M);
    if (rmse !== null) out.rmseM = rmse;
    if (bias !== null) out.biasM = bias;
    if (p95 !== null) out.p95M = p95;
    if (validation.date || metaValidation.date) out.date = validation.date || metaValidation.date;
    return out;
  }

  function metaBlock(result) {
    const meta = result && result.meta ? result.meta : {};
    const dem = result && result.dem ? result.dem : {};
    const resolutionM = numberOrNull(meta.resolutionM ?? dem.resolutionM);
    const rawWindow = numberOrNull(meta.windowM);
    const windowM = core.nearestWindow(rawWindow);
    const radiusCells = finite(meta.radiusCells)
      ? integer(meta.radiusCells)
      : (windowM && resolutionM
        ? Math.max(0, Math.round((windowM / resolutionM - 1) / 2))
        : 0);
    const effectiveBaseline = numberOrNull(meta.effectiveBaselineM ?? meta.effectiveWindowM)
      ?? (windowM && resolutionM ? core.effectiveBaselineM(windowM, resolutionM) : null);
    const product = dem.product === "DTM" || dem.product === "DSM" ? dem.product : null;
    return {
      sourceId: String(meta.sourceId || dem.sourceId || "byod"),
      product,
      bareEarth: dem.bareEarth === true,
      resolutionM,
      verticalAccuracyM: numberOrNull(dem.verticalAccuracyM ?? meta.verticalAccuracyM),
      acquisitionYear: dem.acquisitionYear ?? meta.acquisitionYear ?? null,
      windowM,
      radiusCells,
      effectiveBaselineM: effectiveBaseline,
      algorithm: meta.algorithm || "Horn 3x3",
      classRuleSetId: meta.classRuleSetId || result.rulesId || "co-igac-upra-2026.1",
      license: licenseBlock(result),
      validation: validationBlock(result),
      computedAt: result.computedAt || null,
    };
  }

  function slopeBlock(slope, areaHa) {
    const source = slope || {};
    const out = {
      meanPct: numberOrNull(source.meanPct),
      p50Pct: numberOrNull(source.p50Pct),
      p95Pct: numberOrNull(source.p95Pct),
      maxPct: numberOrNull(source.maxPct),
      uncertaintyPct: numberOrNull(source.uncertaintyPct),
      groundConfidencePct: numberOrNull(source.groundConfidencePct),
      classesHa: {},
      classShare: {},
    };
    let classesHa = source.classesHa && typeof source.classesHa === "object"
      ? source.classesHa
      : null;
    let classShare = source.classShare && typeof source.classShare === "object"
      ? source.classShare
      : null;
    // Compatibilidad con resultados anteriores al contrato: si solo hay
    // clasesPct, se convierten a area y proporcion. Es una derivacion
    // aritmetica, no una medicion nueva.
    if ((!classesHa || !classShare) && source.classesPct && finite(areaHa)) {
      classesHa = classesHa || {};
      classShare = classShare || {};
      BAND_IDS.forEach((id) => {
        const pct = numberOrNull(source.classesPct[id]);
        if (pct === null) return;
        if (!finite(classesHa[id])) classesHa[id] = round((areaHa * pct) / 100, 6);
        if (!finite(classShare[id])) classShare[id] = round(pct / 100, 9);
      });
    }
    BAND_IDS.forEach((id) => {
      const ha = classesHa ? numberOrNull(classesHa[id]) : null;
      const share = classShare ? numberOrNull(classShare[id]) : null;
      if (ha !== null) out.classesHa[id] = round(ha, 6);
      if (share !== null) out.classShare[id] = round(clamp(share, 0, 1), 9);
    });
    return out;
  }

  function classBlock(value) {
    const cls = value || {};
    const status = core.statusToApi("class", cls.status) || "not_determinable";
    const proposed = cls.proposedClass || cls.finalClass || null;
    return {
      slopeClass: cls.slopeClass || null,
      officialClass: cls.officialClass || null,
      proposedClass: proposed,
      finalClass: cls.finalClass || null,
      limitingFactor: cls.limitingFactor || "ninguno",
      status,
      consistency: cls.consistency || core.consistencyFromSemaforo(cls.semaforo),
      consistencyNote: cls.consistencyNote || "",
      officialSource: cls.officialSource || "IGAC/UPRA",
      officialScale: cls.officialScale || "1:100000",
    };
  }

  function sectorBlock(value) {
    const sector = value || {};
    const areaHa = numberOrNull(sector.areaHa ?? sector.areaEffectiveHa) ?? 0;
    const areaGrossHa = numberOrNull(sector.areaGrossHa) ?? areaHa;
    const cells = integer(sector.cells);
    const cellsGross = integer(sector.cellsGross ?? cells);
    const coverage = numberOrNull(sector.coverage)
      ?? (areaGrossHa > 0 ? areaHa / areaGrossHa : 0);
    const status = core.statusToApi("sector", sector.status)
      || (cells > 0 ? "ok" : "no_valid_cells");
    const out = {
      id: String(sector.id || "predio"),
      areaHa: round(areaHa, 6),
      cells,
      cellsGross,
      areaGrossHa: round(areaGrossHa, 6),
      coverage: round(clamp(coverage, 0, 1), 9),
      clipped: Boolean(sector.clipped),
      status,
    };
    if (sector.slope && cells > 0) out.slope = slopeBlock(sector.slope, areaHa);
    if (sector.class) {
      const block = classBlock(sector.class);
      // El esquema ClassBlock exige clases romanas no nulas. Si la clase
      // no es determinable, se omite el bloque y se conserva el estado.
      if (block.slopeClass && block.officialClass && block.proposedClass) {
        out.class = block;
      } else {
        out.classStatus = block.status;
      }
    }
    return out;
  }

  function toSlopeResponse(result) {
    const source = result || {};
    const hash = String(source.resultHash || source.hash || "").replace(/^sha256:/, "");
    const sectors = (Array.isArray(source.sectors) ? source.sectors : []).map(sectorBlock);
    const partial = typeof source.partial === "boolean"
      ? source.partial
      : sectors.some((sector) => sector.status !== "ok");
    const meta = metaBlock(source);
    const contract = {
      resultId: source.resultId || (hash ? `byod-${hash.slice(0, 16)}` : "byod-unknown"),
      resultHash: source.resultHash || (hash ? `sha256:${hash}` : null),
      partial,
      meta,
      grid: source.grid || {},
      sectors,
      delta: source.delta ?? null,
      warnings: Array.isArray(source.warnings) ? source.warnings : [],
      computeMs: finite(source.computeMs) ? Math.max(0, Math.trunc(source.computeMs)) : 0,
      contractVersion: CONTRACT_VERSION,
    };
    contract.contractComplete = Boolean(
      (meta.product === "DTM" || meta.product === "DSM")
      && meta.resolutionM > 0
      && meta.verticalAccuracyM > 0
      && meta.acquisitionYear !== null
      && meta.license
      && meta.license.declared
      && meta.license.declared !== "No declarada"
      && meta.validation
      && meta.validation.declared !== false
      && typeof meta.computedAt === "string"
      && !Number.isNaN(Date.parse(meta.computedAt))
      && contract.resultHash
      && /^sha256:[a-f0-9]{64}$/.test(String(contract.resultHash))
      && sectors.length > 0
    );
    return contract;
  }

  return {
    CONTRACT_VERSION,
    BAND_IDS,
    licenseBlock,
    validationBlock,
    metaBlock,
    slopeBlock,
    classBlock,
    sectorBlock,
    toSlopeResponse,
  };
});
