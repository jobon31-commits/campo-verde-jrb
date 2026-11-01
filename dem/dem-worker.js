/* ============================================================
   CAMPO VERDE JRB · Web Worker DEM (BYOD)
   Recibe el archivo, lo parsea y calcula sin bloquear la UI.
   No guarda ni devuelve el DEM crudo: solo el resultado.
   ============================================================ */
"use strict";

importScripts("dem-core.js", "dem-file.js", "dem-compute.js");

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
