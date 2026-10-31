# Módulo DEM · plan de trabajo

- **Rama:** `feat/pendiente-dtm` (no publicada)
- **Base:** `main` en `6c3d80e`, service worker `campoverdejr-v6`
- **Fecha:** 2026-10-31
- **Estado:** Fase 0 en curso; Fase 1 con base técnica, sin UI ni backend

## Qué existe en esta rama

```
dem/
  sources.json          Registro de fuentes (Colombia + global) y lista prohibida
  rules.colombia.json   Ruleset I–VIII, bandas de pendiente y advertencias
  dem-core.js           Núcleo puro: proyección, Horn, blur, zonal, clase, hash
tests/
  dem-core.test.js      27 pruebas numéricas y de contrato
  registry.test.js      11 pruebas de integridad del registro y ruleset
docs/pendiente-dtm/
  ADR-0001-licencias.md Bloqueo legal y opciones
  PLAN.md               Este documento
```

No se modificó `app.js`, `index.html`, `styles.css`, `sw.js` ni `main`. La app publicada no cambia.

## Ejecutar pruebas

```powershell
cd C:\DEV\terralinde
node tests\dem-core.test.js
node tests\registry.test.js
```

Resultado actual: **27/27** y **11/11**.

## Fases

### Fase 0 · Licencias y decisiones (en curso, bloqueante)

Hecho:
- Registro de fuentes con producto, cobertura, resolución, error, años, licencia, uso comercial y prioridad.
- FABDEM marcado `commercialUse:false` con bloqueo explícito.
- WorldDEM marcado `redistribution:false` con exigencia de licencia de distribución.
- ADR con alternativas y acciones.

Pendiente:
- Cotizar FABDEM+ y la licencia de distribución WorldDEM.
- Decidir BYOD.
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

Pendiente:
- Backend `/slope` y COG (o BYOD/GeoTIFF + WASM).
- Cobertura real IGAC/FABDEM, teselas y validación GEDI/ICESat-2.
- Panel, badge, IndexedDB, informe y caso de ejemplo.

### Fase 2 · Sectores y clase asistida

Pendiente:
- `sectors` con anillo, dibujo en mapa, contención y autointersección.
- Rasterización de sectores y MMU 0,25 ha.
- Clase oficial IGAC/UPRA y semáforo.
- Confirmación firmada por profesional.

### Fase 3 · Pro 5 m

Bloqueada por licencias. No se implementa cobro hasta el ADR aprobado.

### Fase 4 · Endurecimiento

Pendiente:
- Migración de esquema y los cinco puntos de persistencia.
- Hash en Web Worker, CSP, accesibilidad y documentación final.

## Modelo de datos propuesto (todavía no aplicado)

```js
case.tier = "free30" | "local_lidar" | "pro5";

case.dem = {
  sourceId, product: "DTM" | "DSM", bareEarth,
  resolutionM, verticalAccuracyM, acquisitionYear, publicationYear,
  method, license, commercialUse, attribution,
  validation: { source, n, rmseM, biasM, p95M, date, status },
  windowM, algorithm: "Horn 3x3", hash
};

case.sectors = [{
  id, name, crop, color, ring: [[lat, lon]], areaHa,
  slope: { meanPct, p50Pct, p95Pct, maxPct, classesPct, uncertaintyPct, groundConfidencePct },
  class: { slopeClass, officialClass, proposedClass, finalClass, limitingFactor,
           status, ruleSetId, confirmedBy, confirmedAt }
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
| 1 | DSM en bosque rechaza clase | Cubierto por núcleo (`canClassifySector`); falta UI |
| 2 | FABDEM + GEDI declara RMSE/sesgo | Pendiente de datos y backend |
| 3 | 10 ha con 30 m advierte sectores < 9 ha | Cubierto por `minAreaHa`/`requiredCells`; falta UI |
| 4 | Oficial II + 18 % → revisar | Cubierto (rojo, IV) |
| 5 | Sin DTM ni validación → no validado | Cubierto |
| 6 | Mismo polígono → mismo hash y costo €0 | Hash cubierto; cotización pendiente |
| 7 | Sin red tras primer cálculo | Pendiente de IndexedDB |
| 8 | Caso v1 intacto | Pendiente de migración |
| 9–14 | Free/Pro, cotización, teselas, reembolso, IGAC, informe | Pendiente de backend y licencias |
| 15–16 | Pendiente media 2 % ± 0,3 y clases | Núcleo cubierto; falta integración completa |

## Próximo paso recomendado

1. Cerrar Fase 0 (licencias) o autorizar explícitamente un free solo con datos abiertos.
2. Implementar la variante **BYOD**: el usuario aporta un GeoTIFF/COG y el cálculo corre en un Web Worker, sin backend ni costo variable. Permite probar todo el flujo real sin comprometer licencias.
3. Recién después conectar IGAC/FABDEM y el nivel Pro.
