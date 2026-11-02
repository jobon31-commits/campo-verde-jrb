# Módulo DEM · plan de trabajo

- **Rama:** `feat/pendiente-dtm` (no publicada)
- **Base:** `main` en `6c3d80e`; esta rama usa el service worker `campoverdejr-v8`
- **Fecha:** 2026-11-01
- **Estado:** BYOD (A) integrado y reconciliado con el contrato v1; free/pro siguen bloqueados por licencias

## Qué existe en esta rama

```
dem/
  sources.json          Registro de fuentes (Colombia + global) y lista prohibida
  rules.colombia.json   Ruleset I–VIII, bandas de pendiente y advertencias
  dem-core.js           Núcleo puro: proyección, Horn, blur, zonal, clase, hash
  dem-file.js           Lector BYOD: ESRI ASCII y GeoTIFF (EPSG:4326)
  dem-compute.js        Cálculo con sectores, huecos, área, ventana y hash
  dem-contract.js       Adaptador al contrato API v1 (`/slope`)
  dem-worker.js         Web Worker: lee, calcula y devuelve solo el resultado
tests/
  dem-core.test.js      31 pruebas numéricas, estados y contrato
  registry.test.js      11 pruebas de integridad del registro y ruleset
  dem-file.test.js      18 pruebas de ASC/GeoTIFF y rechazos
  dem-compute.test.js   28 pruebas de recorte, sectores, pendiente, clase y hash
docs/pendiente-dtm/
  ADR-0001-licencias.md Bloqueo legal y opciones
  CONTRATO.md           Mapeo de los 14 vectores y estados API
  PLAN.md               Este documento
```

La app ya incluye el panel **Pendiente del terreno** (BYOD), el informe y las
exportaciones. El DEM crudo nunca se persiste: solo la declaración y el
resultado compacto en `state.dem`. La rama no se ha publicado en `main`.

## Ejecutar pruebas

```powershell
cd C:\DEV\terralinde
node tests\dem-core.test.js
node tests\registry.test.js
node tests\dem-file.test.js
node tests\dem-compute.test.js
```

Resultado actual: **31/31**, **11/11**, **18/18** y **28/28**.

## Fases

### Fase 0 · Licencias y decisiones (en curso, bloqueante)

Hecho:
- Registro de fuentes con producto, cobertura, resolución, error, años, licencia, uso comercial y prioridad.
- FABDEM marcado `commercialUse:false` con bloqueo explícito.
- WorldDEM marcado `redistribution:false` con exigencia de licencia de distribución.
- ADR con alternativas y acciones.
- BYOD aprobado como modo local, sin backend ni costo variable; no habilita free30 ni pro5.

Pendiente:
- Cotizar FABDEM+ y la licencia de distribución WorldDEM.
- Aprobación escrita antes de Fase 3.

### Fase 1 · Free 30 m DTM (base técnica)

Hecho:
- Núcleo de cálculo sin DOM, testeable en Node y usable como `window.CVDem`.
- Horn 3×3 con grilla regular, proyección local equirectangular.
- Ventana adaptativa 10/25/50 m con incertidumbre orientativa.
- Estadística zonal por máscara y porcentaje por banda.
- Validación DTM (producto, bareEarth, resolución, huellas, sesgo).
- Resumen canónico sin fotos ni `updatedAt` para hash reproducible.
- Ruleset Colombia con umbrales 0–3–7–12–25–50–75 % y clases I–VIII.
- Lector BYOD `.asc`/GeoTIFF, Web Worker, panel, informe, GeoJSON/KML y caché PWA.
- Reconciliación de contrato: sectores con huecos/multipolígono, `areaHa`/`areaGrossHa`/`coverage`, `classesHa`/`classShare`, estados API y doble hash.
- Adaptador `dem/dem-contract.js` y pruebas de los invariantes aplicables de los vectores 13 y 14.

Pendiente:
- Backend `/slope` y COG para datos abiertos.
- Cobertura real IGAC/FABDEM, teselas y validación GEDI/ICESat-2.

### Fase 2 · Sectores y clase asistida

Hecho:
- `sectors` con anillo, huecos y multipolígono; rasterización por regla par-impar.
- Área efectiva, área bruta, cobertura, celdas válidas y celdas rasterizadas.
- Clase oficial IGAC/UPRA como base, semáforo y propuesta asistida.
- `class.finalClass` queda `null`: solo una confirmación humana puede fijarla.

Pendiente:
- Dibujo de sectores en el mapa, contención y detección de autointersección.
- MMU 0,25 ha en la interfaz y selección de sector activo.
- Confirmación firmada por profesional.

### Fase 3 · Pro 5 m

Bloqueada por licencias. No se implementa cobro hasta el ADR aprobado.

### Fase 4 · Endurecimiento

Pendiente:
- Migración de esquema y los cinco puntos de persistencia.
- Hash en Web Worker, CSP, accesibilidad y documentación final.

## Modelo de datos aplicado (BYOD)

```js
case.dem = {
  declaration: {
    sourceId: "byod", name, product: "DTM" | "DSM", bareEarth,
    fileName, format, license, attribution,
    acquisitionYear, verticalAccuracyM, officialClass,
    validation: { source, n, biasM, rmseM, date, status, declared }
  },
  result: {
    ok, partial, hash, resultHash, resultId, computedAt, computeMs,
    meta: { windowM, radiusCells, effectiveBaselineM, areaHa, areaGrossHa,
            coverage, cells, validCells, nodataPct, license, validation },
    dem, validation,
    slope: { meanPct, p50Pct, p95Pct, maxPct, classesPct, classesHa,
             classShare, uncertaintyPct, groundConfidencePct },
    sectors: [{
      id, name, cells, cellsGross, areaHa, areaGrossHa, coverage,
      status, statusEs, slope, class
    }],
    class: { slopeClass, officialClass, proposedClass, finalClass: null,
             status, statusEs, limitingFactor, consistency },
    warnings, summary, rulesId
  }
};
```

- `resultHash` es `sha256:<64 hex>` y se calcula sobre `summary` + `declaration`; no incluye `computedAt` ni `computeMs`.
- `hash` conserva el digest sin prefijo para compatibilidad con casos guardados. `payloadHash` sigue firmando el respaldo completo y es independiente.
- `areaHa` es área efectiva (solo celdas con pendiente válida); `areaGrossHa` incluye las celdas rasterizadas sin dato; `coverage = areaHa / areaGrossHa`.
- `classesHa` y `classShare` usan las etiquetas de intervalo (`0-3`, `3-7`, …, `>75`). `classesPct` queda como campo legado para casos antiguos.
- `status` usa códigos API; `statusEs` conserva la etiqueta en español para la interfaz.
- `class.finalClass` queda `null` salvo confirmación humana; la propuesta vive en `class.proposedClass`.
- El archivo crudo **nunca** se persiste; solo declaración y resultado compacto.
- `state.dem` entra en `projectPayload`, por lo que cambia la huella del proyecto.
- El resultado se valida al restaurar y se marca **sin recalcular** si cambió el croquis, la clase oficial o la declaración.
- Un caso puede existir sin DEM; el panel queda vacío y no bloquea la medición.

## Contrato API

`dem/dem-contract.js` traduce el resultado BYOD a la forma de `/slope` sin
recalcular. Los estados, la licencia BYOD, la ventana/base efectiva y el hash
están documentados en [`CONTRATO.md`](./CONTRATO.md).

## Modelo de datos previsto (sectores y backend)

```js
case.tier = "free30" | "local_lidar" | "pro5";

case.sectors = [{
  id, name, crop, color, ring: [[lat, lon]], holes: [[[lat, lon]]], areaHa,
  slope: { meanPct, p50Pct, p95Pct, maxPct, classesPct, classesHa, classShare,
           uncertaintyPct, groundConfidencePct },
  class: { slopeClass, officialClass, proposedClass, finalClass,
           limitingFactor, status: "proposed" | "topographic_limit" |
                   "not_determinable" | "confirmed",
           statusEs, ruleSetId, confirmedBy, confirmedAt }
}];

case.delta30vs5 = { changedClassPct, changedAreaHa, notes };
case.quote = { areaHa, bufferM, tileIds, ratePerKm2, minimumKm2, subtotal, iva, total, currency, quotedAt };
case.entitlement = { tier, orderId, provider, productId, tileIds, purchasedAt, price, status, license, slaHours };
```

Reglas de persistencia:
- Los resultados derivados van a IndexedDB (resumen, grillas Uint8, confianza, metadatos).
- **Nunca** el DEM crudo, ni en localStorage ni en IndexedDB.
- Al migrar hay que tocar `normalizeState`, `projectPayload`, `makeCaseRecord`, `renderCases` y `applyRestoredState`.
- Un caso free que pasa a Pro conserva ambos resultados para el diferencial.

## Contratos de backend previstos

- `POST /quote` · área, buffer, teselas, tarifa, mínimo, IVA, ETA.
- `POST /order` · pedido, estado y pago.
- `POST /slope` · polígono + sectores + fuente; devuelve JSON y hillshade PNG.
- `GET /order/:id` · estado y entrega.

Sin claves en el frontend. El frontend solo usa `fetch` al backend propio; el service worker cachea únicamente mismo origen.

## Cobertura de aceptación

| # | Requisito | Estado |
|---|---|---|
| 1 | DSM en bosque rechaza clase | Cubierto por núcleo y panel (DSM no apto) |
| 2 | FABDEM + GEDI declara RMSE/sesgo | Pendiente de datos y backend |
| 3 | 10 ha con 30 m advierte sectores < 9 ha | Cubierto por `minAreaHa`/`requiredCells`; falta UI de sectores |
| 4 | Oficial II + 18 % → revisar | Cubierto (propuesta IV, rojo, `finalClass:null`) |
| 5 | Sin DTM ni validación → no validado | Cubierto (API + español) |
| 6 | Mismo polígono → mismo hash y costo €0 | Hash cubierto; cotización pendiente |
| 7 | Sin red tras primer cálculo | PWA cachea el shell y calcula local; falta IndexedDB para grillas |
| 8 | Caso v1 intacto | Normalización tolerante; falta prueba de migración dedicada |
| 9–12 | Free/Pro, cotización, pedidos y teselas | Pendiente de backend y licencias |
| 13–14 | `/slope` free30/Pro y DSM | Invariantes de módulo y adaptador cubiertos; endpoints y licencias pendientes |
| 15–16 | Pendiente media 2 % ± 0,3 y clases | Núcleo cubierto; E2E BYOD con 10 % y clase III verificado |

## Próximo paso recomendado

1. Cerrar Fase 0 (licencias) o autorizar explícitamente un free solo con datos abiertos.
2. Probar la PWA BYOD en un móvil real (instalación, 390 px, workers, archivo grande, sonido).
3. Conectar IGAC/FABDEM y el nivel Pro solo después del ADR y con `/coverage`, `/quote` y `/order`.
