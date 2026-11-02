/* ============================================================
   CAMPO VERDE JRB · Web Worker DEM (BYOD)
   Recibe el archivo, lo parsea y calcula sin bloquear la UI.
   No guarda ni devuelve el DEM crudo: solo el resultado.
   ============================================================ */
"use strict";

importScripts(
  "dem-core.js?v=1.4.0",
  "dem-file.js?v=1.4.0",
  "dem-contract.js?v=1.4.0",
  "dem-compute.js?v=1.4.0"
);

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type !== "analyze") return;
  const id = message.id;
  const post = (payload) => self.postMessage({ id, ...payload });

  try {
    post({ type: "progress", stage: "read", pct: 2, message: "Leyendo el DEM" });
    const grid = await self.CVDemFile.parseFile(message.file);
    const result = await self.CVDemCompute.analyze({
      grid,
      polygon: message.polygon,
      geometry: message.geometry || null,
      sectors: Array.isArray(message.sectors) ? message.sectors : null,
      sectorName: message.sectorName || null,
      dem: message.dem,
      officialClass: message.officialClass,
      options: message.options || {},
      onProgress: (stage, pct, detail) => post({
        type: "progress",
        stage,
        pct,
        message: detail,
      }),
    });
    post({ type: "result", result });
  } catch (error) {
    post({
      type: "error",
      error: {
        message: error && error.message ? error.message : "No se pudo procesar el DEM.",
        code: error && error.code ? error.code : null,
      },
    });
  }
};
