# Contrato API v1 · mapeo BYOD

- **Esquema fuente:** `api-contract/schemas.json` (JSON Schema 2020-12).
- **Implementación local:** `dem/dem-contract.js`.
- **Alcance:** traduce el resultado BYOD a la forma de `SlopeResponse` sin recalcular.
- **Estado:** los invariantes de módulo y los vectores 13–14 están cubiertos. Los vectores 1–12 dependen de los endpoints `/coverage`, `/quote` y `/order` de la fase B.

## Vectores del contrato

| # | Vector | Estado en esta rama |
|---|---|---|
| 1 | `/coverage` sin LiDAR | Pendiente de B: cobertura y tres niveles |
| 2 | `/coverage` dentro de LiDAR IGAC | Pendiente de B: teselas y municipio |
| 3 | `/coverage` geometría inválida | Pendiente de B: validación de endpoint |
| 4 | `/quote` área pequeña en EUR | Pendiente de B: cotización |
| 5 | `/quote` área grande en COP/USD | Pendiente de B: cotización y FX |
| 6 | `/quote` área > 50 km² | Pendiente de B: límites |
| 7 | `/order` sin `Idempotency-Key` | Pendiente de B: pedidos |
| 8 | `/order` sin aceptar licencia | Pendiente de B: pedidos |
| 9 | `/order` feliz + polling | Pendiente de B: pedidos |
| 10 | `/order` idempotencia | Pendiente de B: pedidos |
| 11 | `/order` cotización de un solo uso | Pendiente de B: pedidos |
| 12 | `/order` cotización vencida | Pendiente de B: pedidos |
| 13 | `/slope` free30 con sector diminuto | Cubierto en módulo: 30 m, base 60 m, `partial`, `insufficient_resolution`, clase `topographic_limit` |
| 14 | `/slope` pro5 + DSM | Cubierto en módulo: 5 m, base 30 m, clase propuesta y DSM sin clase. El pago y la licencia Pro siguen bloqueados |

Los vectores 13–14 no se publican como endpoint: BYOD corre en el dispositivo y
el adaptador produce el mismo cuerpo para poder conectar B sin duplicar lógica.

## Mapeo de campos

| Módulo / resultado BYOD | Contrato `/slope` |
|---|---|
| `sector.areaHa` (área efectiva) | `sector.areaHa` |
| `sector.areaGrossHa` | `sector.areaGrossHa` |
| `sector.coverage` | `sector.coverage` |
| `sector.cells` / `sector.cellsGross` | `sector.cells` / `sector.cellsGross` |
| `sector.status` | `sector.status` (`ok`, `insufficient_resolution`, `no_valid_cells`, `no_coverage`) |
| `slope.meanPct` … `slope.maxPct` | `slope.meanPct` … `slope.maxPct` |
| `slope.classesHa` | `slope.classesHa` |
| `slope.classShare` | `slope.classShare` (proporción, no probabilidad) |
| `slope.uncertaintyPct` | `slope.uncertaintyPct` |
| `slope.groundConfidencePct` | `slope.groundConfidencePct` |
| `class.{slope,official,proposed,final}Class` | `class.*` |
| `class.status` / `class.statusEs` | `class.status` / etiqueta de interfaz |
| `validation.*` | `meta.validation` |
| `dem.licenseInfo` | `meta.license` |
| `result.resultHash` | `resultHash` (`sha256:<64 hex>`) |
| `result.resultId` | `resultId` |
| `result.computeMs` | `computeMs` |

`classesHa` y `classShare` usan las etiquetas `0-3`, `3-7`, `7-12`, `12-25`,
`25-50`, `50-75`, `>75`. `class.slopeClass` usa la clase romana I–VIII. No se
mezclan ambas en la interfaz ni en el informe.

## Estados

| Español | API |
|---|---|
| propuesta | `proposed` |
| confirmada | `confirmed` |
| limitante topográfica | `topographic_limit` |
| no validado | `topographic_limit` |
| resolucion insuficiente | `topographic_limit` |
| no determinable | `not_determinable` |
| no apto | `not_determinable` |
| ok | `ok` |
| resolución insuficiente | `insufficient_resolution` |
| sin celdas válidas | `no_valid_cells` |
| sin cobertura | `no_coverage` |
| validado | `validated` |
| no validado | `not_validated` |
| fallido | `failed` |

La etiqueta española se conserva en `statusEs`. Los casos guardados antiguos
pueden traer el estado en español: la interfaz acepta ambos.

## Ventana, collar y base efectiva

- `radiusCells = max(0, round((windowM / resolutionM - 1) / 2))`.
- `effectiveBaselineM = 2 * (radiusCells + 1) * resolutionM`.
- La media de elevación exige la ventana completa: si falta una celda, hay
  NODATA o la ventana toca el borde, la salida es NODATA.
- El margen de recorte es `max(2, radius + 1)` celdas.
- Incertidumbre conservadora: `100 * sqrt(2) * sigmaZ / effectiveBaselineM`.
- A 30 m, una ventana de 25 m colapsa a 60 m de base. A 5 m, 25 m da 30 m.
- `windowM` se normaliza a 10, 25 o 50; la base efectiva se reporta aparte.

La resolución no es precisión. `resolutionM` describe el paso de la grilla;
`verticalAccuracyM` es el error vertical declarado (LE90) y
`uncertaintyPct` es una cota orientativa de la pendiente, no una promesa.

## Licencia BYOD

`meta.license` declara:

```json
{
  "licenseId": "byod-user-declared",
  "type": "byod",
  "redistribution": false,
  "attribution": "fuente declarada por el usuario",
  "declared": "licencia o autorización declarada"
}
```

No se habilitan free30 ni pro5. No se redistribuye el DEM. Si falta la licencia,
`contractComplete` es `false`; no se rellena con una licencia inventada.

## Hash

- `resultHash = "sha256:" + sha256(canonicalJson({ summary, declaration }))`.
- `summary.kind = "dem-summary-v2"`.
- No entran `computedAt`, `computeMs`, fotos, `updatedAt` ni la grilla cruda.
- `result.hash` conserva el digest sin prefijo para compatibilidad.
- `payloadHash` del proyecto firma el respaldo completo y es independiente del
  hash del análisis DEM.

Dos análisis idénticos devuelven el mismo `resultHash` y el mismo `resultId`.
Cambiar la clase oficial, la declaración o los vértices cambia el hash.

## Clase agrológica

- La clase oficial IGAC/UPRA es la base.
- La pendiente solo puede empeorar la clase, nunca mejorarla.
- Sin carta de suelos: `not_determinable`; no se inventa una clase.
- DSM: `not_determinable` / “no apto”; no se evalúa clase agrológica.
- `class.finalClass` queda `null` salvo confirmación humana; la propuesta vive
  en `class.proposedClass`.
- Si la clase no se puede expresar con las clases romanas requeridas por el
  esquema, el adaptador omite `class` y publica `classStatus` en el sector.
- `classShare` no es una probabilidad y no se publica `classProbabilities`.

## Criterio de `contractComplete`

El adaptador devuelve `contractComplete: true` solo si existen producto DTM/DSM,
resolución, error vertical, año, licencia declarada, validación declarada,
`computedAt` válido, `resultHash` con formato correcto y al menos un sector.

## Pruebas

- `node tests/dem-compute.test.js` cubre sectores, huecos, multipolígono,
  área/cobertura, ventana, hash y adaptador.
- `node tests/dem-core.test.js` cubre estados, Horn estricto, base efectiva,
  incertidumbre y resumen canónico.
- `node tests/registry.test.js` y `node tests/dem-file.test.js` cubren fuentes,
  ruleset y lectura de archivos.

## Pendiente para B

1. `/coverage` con teselas IGAC/FABDEM y verificación municipal.
2. `/quote` con área, buffer, mínimo, IVA, moneda y expiración.
3. `/order` con idempotencia, aceptación de licencia y polling.
4. Licencia comercial FABDEM/Fathom y distribución WorldDEM.
5. Validación de `resultHash` contra un GeoTIFF real y `gdaldem slope`.
