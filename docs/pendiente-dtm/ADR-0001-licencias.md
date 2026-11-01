# ADR 0001 · Licencias de DEM y modelo comercial

- **Estado:** propuesto, bloqueante para Fase 3
- **Fecha:** 2026-10-31
- **Rama:** `feat/pendiente-dtm`
- **Decisores:** titular del producto + revisión legal

## Contexto

La app CAMPO VERDE JRB es un producto comercial (avalúos y medición de predios). El módulo DEM necesita un DTM (terreno desnudo) y planea tres niveles:

| Nivel | Fuente prevista | Costo del dato | Licencia |
|---|---|---|---|
| Free 30 m | FABDEM v1.2 | €0 | CC BY-NC-SA 4.0 (no comercial) |
| Local gratis | IGAC LiDAR MDT 1–5 m | €0 | datos abiertos |
| Pro 5 m | WorldDEM Neo DTM | ~€9,64/km², mínimo 1 km² | comercial por proyecto |

El problema no es técnico: es de licencias. El prompt maestro v4 lo declara bloqueante y este ADR lo deja por escrito.

## Hallazgos

1. **FABDEM es CC BY-NC-SA 4.0.** La cláusula NC prohíbe el uso comercial. Si la app cobra el nivel Pro, el conjunto pasa a ser comercial y el nivel free sobre FABDEM queda en zona gris o en incumplimiento.
   - Salidas: licencia comercial **FABDEM+** (Fathom), restringir FABDEM a usuarios no comerciales, o usar solo fuentes de licencia abierta real en el free.
2. **WorldDEM Neo se licencia por proyecto/sitio.** Comprar €9,64/km² y revender a miles de usuarios no está cubierto por la licencia estándar. Se requiere licencia de distribución o de productos derivados negociada con Airbus o su distribuidor (UP42 / Apollo).
3. **BYOD** (el usuario compra su tesela con su cuenta y licencia) elimina el riesgo de reventa; la app solo cobra el procesamiento. Agrega fricción y no sirve para el nivel free.
4. **IGAC LiDAR** es la mejor opción donde cubre: DTM 1–5 m, abierto y gratuito. La cobertura es municipal parcial y debe verificarse tesela por tesela. Donde hay LiDAR local no se ofrece Pro.
5. **La capa de suelos IGAC/UPRA** (I–VIII, 1:100.000) es la base de la clase oficial. No es un DEM y no se infiere.

## Decisión propuesta

- **No habilitar el nivel pagado** ni publicar el panel DEM en `main` hasta tener por escrito:
  - licencia comercial para la fuente del free, y
  - licencia de distribución (o BYOD aprobado) para WorldDEM.
- **BYOD (A):** aprobado como modo local sin backend ni cobro. El usuario aporta
  su DEM y la app solo deriva pendiente y clase asistida; el archivo crudo no se
  guarda ni se redistribuye. Esto no habilita el nivel free ni el Pro.
- **Free:** no usar FABDEM en producción comercial mientras no exista FABDEM+ o una fuente abierta equivalente. El registro de fuentes ya marca el bloqueo (`license.blocker`).
- **Pro:** implementar primero el flujo de cotización y el modo BYOD; la compra/entrega automática queda para cuando exista contrato.
- **Local IGAC:** ruta gratuita prioritaria cuando la cobertura exista.
- **Trazabilidad:** cada resultado debe declarar fuente, producto (DTM/DSM), resolución, error vertical, año, licencia, atribución y validación.

## Alternativas consideradas

| Alternativa | Ventaja | Riesgo / costo |
|---|---|---|
| FABDEM+ comercial | free consistente y simple | costo de licencia y volumen |
| Free solo con datos abiertos (IGAC, 3DEP, IGN, AHN) | sin riesgo NC | cobertura limitada; sin global |
| Free deshabilitado | cero riesgo | producto incompleto |
| BYOD para todo | sin reventa | fricción alta; no hay free |
| No lanzar Pro | sin contrato de distribución | no hay ingreso |

## Consecuencias

- La Fase 1 puede avanzar en cálculo, registro, ruleset, UI y validación con datos sintéticos o DEM aportado por el usuario.
- La Fase 3 (cobro) queda bloqueada hasta resolver licencias.
- El informe no puede afirmar "5 m" ni "confirmado" sin fuente y validación verificables.
- Cualquier demo pública debe usar datos sintéticos o un DEM con licencia explícita, nunca FABDEM sin aclarar la restricción NC.

## Acciones pendientes

1. Cotizar FABDEM+ (Fathom) para uso comercial y evaluar volumen.
2. Cotizar licencia de distribución WorldDEM Neo (Airbus / UP42 / Apollo).
3. Definir si se adopta BYOD como respaldo y su flujo de compra.
4. Revisar términos de IGAC y de la capa de suelos para reventa del resultado derivado.
5. Registrar por escrito la decisión final en este ADR antes de la Fase 3.
