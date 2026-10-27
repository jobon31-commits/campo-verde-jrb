# De la medición al avalúo

## Informe de mercado y oportunidades para la app de predios rurales

**Preparado para:** Ing. Agrónomo y avaluador — *Avalúos Integrales · Urbanos & Rurales*  
**Fecha:** 26 de octubre de 2026  
**Versión:** 1.0  
**Alcance:** aplicaciones y software de medición de superficies, GIS de campo, datos de parcelas, agricultura satelital y avalúo. Foco en Latinoamérica y España, con referencias de Estados Unidos como mercado maduro.  
**Documento base:** `C:\DEV\terralinde` (index.html, styles.css, app.js).

---

## 1. Resumen ejecutivo

1. **Medir un área ya no es un diferenciador.** GPS Fields Area Measure supera las **10 millones de descargas** y las **199 mil reseñas**; en Google Play en español hay **más de 20 apps** con nombres casi idénticos ("medir área", "calculadora de área", "GPS field area"). La mayoría son gratuitas, con anuncios y funciones equivalentes.

2. **El mercado profesional está partido en dos.** Por un lado, apps simples que miden pero no documentan (GPS Fields, Easy Area). Por otro, GIS de campo que documentan muy bien pero exigen conocimientos técnicos y no hablan de avalúo (QField, Mergin Maps, Mapit GIS, SW Maps).

3. **Los mejores productos de parcelas y avalúo son estadounidenses.** LandGlide, Regrid y Land id tienen millones de parcelas, comparables de venta y flujos de trabajo para avaluadores. Su ventaja depende de datos catastrales que en Latinoamérica están fragmentados por país, provincia y municipio.

4. **Nadie, en español, resuelve el flujo completo:** medir → comparar con el área de título y catastro → declarar incertidumbre → medir cultivos dentro del predio → emitir un informe con evidencia. Ese es el hueco real.

5. **La app actual tiene una base sólida:** GPS con umbral de precisión, separación mínima entre vértices, wake lock, exportación a KML/GeoJSON/CSV, croquis georreferenciado, impresión, deshacer/rehacer, casos guardados por separado, instalación como PWA y funcionamiento sin conexión. Lo que falta no es "medir más", sino **convertir la medición en un documento defendible**.

6. **El argumento central del producto debería ser la incertidumbre.** Una sola pasada de GPS con ±5 m en un cuadrado de 3 ha puede mover el área del orden de **±0,35 ha (±12 %)**. Si la app muestra "3,0000 ha" sin decir cuánto puede variar, el número es engañoso. Ninguna app masiva lo declara; muy pocos profesionales lo calculan.

7. **Medir cultivos dentro del predio es un hueco específico.** La agtech satelital mide campos completos y requiere suscripción y conectividad; los GIS permiten lotear, pero con una curva de aprendizaje alta. Un flujo simple de "predio → lotes/cultivos → superficie y porcentaje" es valioso para arrendamientos, seguros agrícolas y avalúos.

8. **Google Earth Pro dejará de descargarse el 25 de junio de 2027.** Es una ventana de oportunidad para una herramienta web/móvil que haga lo esencial —medir, documentar, exportar KML— sin la complejidad de un GIS de escritorio.

9. **Hay espacio de precio.** Las referencias van de **COP 53.000** (pago único, app masiva) a **US$170/año** (Avenza Pro) y **€190–€336/año** (QFieldCloud, Mergin Maps). Un Pro con informe profesional a **US$15–25/año** o **COP 69.000–119.000/año** es defendible si ahorra tiempo y respalda una transacción.

10. **Nombres recomendados:** **Tasalia** (marca principal), **Linderos** (autoridad técnica) y **CampoClaro** (entrada masiva). Recomendación: **Tasalia**, con el sello *"por Avalúos Integrales · Urbanos & Rurales"*.

---

## 2. Objetivo, método y límites

### 2.1 Pregunta de investigación

¿Qué hacen las aplicaciones similares, qué valoran los profesionales del campo y del avalúo, y qué debería agregar la app para pasar de "medir un área" a "documentar y respaldar una superficie"?

### 2.2 Criterios de selección

Se relevaron productos que cumplen al menos dos de estos criterios:

- miden superficies rurales con GPS, mapa, coordenadas o imágenes;
- permiten documentar, exportar o compartir el resultado;
- agregan datos de parcela, catastro, cultivo o valor;
- son usados por agrónomos, agrimensores, avaluadores o técnicos de campo;
- tienen presencia real en Latinoamérica, España o Estados Unidos.

### 2.3 Fuentes

Se consultaron páginas oficiales, tiendas de aplicaciones y sitios de precios (ver sección 13). Cuando un sitio bloqueó el acceso, se indica. Los precios se relevaron el **26/10/2026** y pueden variar por país, impuestos, tipo de cambio y promociones.

### 2.4 Límites de este informe

- **No se hizo búsqueda de antecedentes marcarios.** El entorno no tuvo buscador web general disponible. Antes de registrar una marca o dominio, hay que consultar los registros nacionales y la base global de la OMPI.
- **No se probaron todas las apps en campo.** La comparación se basa en documentación pública, tiendas y experiencia de uso de la app propia.
- **Los precios de Estados Unidos no son trasladables** a Latinoamérica: allí el dato catastral es un negocio maduro; aquí no.
- **AcreValue y LandGlide bloquearon el acceso** desde este entorno (403 y 503). Se usan datos de relevamientos previos y de Google Play, con la salvedad correspondiente.
- **La investigación no reemplaza una validación con clientes.** Las prioridades propuestas son hipótesis a probar con 5–10 profesionales.

---

## 3. El problema profesional, bien encuadrado

El usuario no necesita "una app para medir". Necesita resolver tres trabajos distintos, con el mismo instrumento:

| Trabajo | Pregunta que responde | Resultado que entrega | Riesgo si se hace mal |
|---|---|---|---|
| **Rectificar un área** | ¿El área real coincide con la de título o catastro? | Área medida, diferencia, porcentaje, conclusión | Discusión legal, diferencias patrimoniales, peritaje débil |
| **Medir un cultivo** | ¿Cuántas hectáreas de cada cultivo hay dentro del predio? | Lotes, superficie, % del predio, croquis | Seguros, arrendamientos y costos mal calculados |
| **Respaldar un avalúo** | ¿Qué evidencia sostiene la superficie y el valor? | Ficha técnica, fotos, archivos, informe firmable | Avalúo cuestionado, pérdida de credibilidad |

La cadena de valor real es:

```text
campo → dato → evidencia → comparación → informe → decisión (venta, crédito, sucesión, seguro, litigio)
```

La mayoría de las apps compiten en el primer eslabón (el dato). El valor profesional está en los últimos cuatro.

### 3.1 Qué hace defendible un informe de superficie

Un informe que resiste una revisión técnica o legal debería incluir:

- identificación del predio, propietario/solicitante, matrícula o folio, ubicación y coordenadas;
- objeto y alcance (rectificación, verificación, medición de cultivo, avalúo);
- método e instrumento (GPS de teléfono, GNSS/RTK, estación total, cinta, imagen satelital);
- datum y proyección (WGS 84, MAGNA-SIRGAS, POSGAR, SIRGAS);
- número de vértices, separación, precisión declarada y **repeticiones**;
- superficie bruta, superficie neta y perímetro;
- tabla de vértices, lados y rumbos;
- comparación con área de título y catastral: diferencia absoluta y relativa;
- **incertidumbre** de la medición y su interpretación;
- croquis acotado, fotos georreferenciadas y archivos digitales;
- declaración de limitaciones y firma del profesional.

La app actual cubre una parte de los puntos 1, 3, 5, 6, 7 y 10. Los puntos 8, 9, 11 y 12 son la oportunidad.

---

## 4. Mapa del mercado

### 4.1 Apps masivas de medición GPS: el segmento commodity

| App | Escala | Precio | Fortaleza | Límite para el uso profesional |
|---|---|---|---|---|
| **GPS Fields Area Measure** (Farmis) | 10 M+ descargas, 199 K reseñas | Gratis con anuncios; PRO COP 53.000 | Muy simple; mide área, distancia y perímetro; exporta | Sin informe técnico, sin comparación con título, sin incertidumbre |
| **GPS Fields Area Measure PRO** | 10 K+ descargas | COP 53.000 (pago único) | Quita anuncios; mismas funciones base | Sigue siendo una calculadora, no un documento |
| **Easy Area** (Marothia Techs) | 1 M+ descargas, 16 K reseñas | Gratis con anuncios; compras internas | Mide por GPS, desde dimensiones, por foto/plano; exporta KML/KMZ/GPX/GeoJSON/DXF/Shapefile | Interfaz genérica; sin flujo de avalúo ni evidencia |
| **Medir área de tierra / GLandGo / GPS Field Area Measure (JSK)** | 1 M+ / 100 K+ / variable | Gratis con anuncios | Nombres y funciones casi idénticas | Competencia por precio y anuncios, no por confianza |

**Hallazgo:** en la búsqueda de Google Play en español aparecieron **más de 20 resultados** con nombres como "Medir área de tierra", "Medir Área y Distancia GPS", "Medición de campo GPS", "Medir terrenos con GPS", "Calculadora de área de terreno", "Medida de área GPS". Es un mercado de clones, con economías de anuncios y baja diferenciación.

**Consecuencia estratégica:** competir por "medir mejor" es una carrera al fondo. La diferenciación tiene que estar en el **informe**, la **evidencia** y el **flujo profesional**.

### 4.2 GIS de campo profesional: el segmento técnico

| Herramienta | Precio de referencia | Fortaleza | Límite para el usuario |
|---|---|---|---|
| **QField + QFieldCloud** | Gratis 100 MB; planes por usuario/mes (aprox. €18–€28) | QGIS en el móvil; formularios, capas, offline, sincronización; estándar en agrimensura y ambiente | Requiere preparar el proyecto en QGIS; no es una app de avalúo |
| **Mergin Maps** | Premium €15,8/usuario/mes (anual); prueba 14 días | QGIS + móvil + web; trabajo offline; historial de proyecto; exportación | Curva de aprendizaje; pensado para equipos técnicos |
| **Mapit GIS** | Freemium / suscripción | GeoPackage nativo, más de 10 formatos de exportación, GNSS submétrico, RTK/NTRIP, offline | Interfaz técnica; no tiene flujo de avalúo ni informe comercial |
| **SW Maps** | Gratis, sin anuncios | RTK por Bluetooth/USB, shapefile/GeoJSON/GPKG/KMZ, atributos, fotos, audio; 1 M+ descargas | Configuración técnica; su propio flujo no es "predio + cultivo + avalúo" |
| **Avenza Maps** | Gratis; Plus US$34,99/año; Pro desde US$169,99/año por dispositivo | Mapas georreferenciados (GeoPDF/GeoTIFF), offline, capas, exportación | Precio alto; orientado a mapas, no a informes de superficie |

**Hallazgo:** estas herramientas demuestran que el profesional **sí paga** por rigor, offline y exportación. Pero ninguna está pensada para el agrónomo/avalúador que necesita un informe en una tarde, no un proyecto GIS.

**Dato concreto del mercado latinoamericano:** en una reseña reciente de SW Maps en Google Play, un usuario colombiano reporta problemas de reproyección con **MAGNA-SIRGAS 2018 / Origen Nacional (EPSG:9377)**. Es una señal de que el manejo de datum local es una necesidad real y una fuente de errores en la región.

### 4.3 Datos de parcelas y avalúo: el modelo estadounidense

| Producto | Precio de referencia | Fortaleza | Límite en Latinoamérica |
|---|---|---|---|
| **LandGlide** | US$9,99/mes o US$99,99/año; 1 M+ descargas | 160 M de parcelas, linderos, datos de propiedad, búsqueda | Depende de catastros de EE.UU.; no hay equivalente regional |
| **Regrid** | Gratis + Pro aprox. US$10/mes; 500 K+ descargas | 157 M de parcelas, datos de propiedad, uso del suelo | Igual limitación: dato catastral estadounidense |
| **Land id** | US$7–US$66,67/mes según plan (anual); 50 K+ profesionales | Parcelas, propietarios, comparables, "deed plotting", informes de avalúo, mapas de marca | Enfoque EE.UU.; precio en dólares; no resuelve medición de campo |
| **AcreValue** | No accesible desde este entorno (403) | Referente en valores de tierra y comparables | Mismo límite geográfico |

**Hallazgo:** el "paquete completo" de parcela + propietario + comparables + informe existe, pero es estadounidense y vive de un catastro unificado. En Latinoamérica no se puede copiar el dato; sí se puede copiar el **flujo de trabajo**: parcela → comparables → informe de marca.

### 4.4 Agtech satelital: el cultivo visto desde arriba

| Plataforma | Precio de referencia | Fortaleza | Límite |
|---|---|---|---|
| **OneSoil** | Gratis + Pro con prueba de 14 días; precio por región/hectáreas | Lotes, NDVI, monitoreo, prescripciones; 140 K+ agricultores | Requiere conectividad y suscripción; mide campos, no subparcelas con rigor documental |
| **EOSDA Crop Monitoring** | Monitoreo gratuito; planes comerciales a cotización | Sentinel-2 y PlanetScope, NDVI y otros índices, reportes, VRA | Plataforma de agricultura de precisión, no de avalúo |
| **Auravant** | Gratis + planes premium | Plataforma agrícola en español; ambiente, nutrición, reportes | Foco agronómico; no genera un acta de medición |
| **Climate FieldView (Bayer)** | Hardware y planes comerciales | Datos de maquinaria, siembra, cosecha | Ecosistema cerrado; no es una herramienta de medición de predios |

**Hallazgo:** la agtech satelital resuelve "¿cómo está el cultivo?", no "¿cuántas hectáreas de este cultivo hay dentro de este predio y cómo lo documento?". Ese es un espacio libre para una app simple y offline.

### 4.5 Calculadoras web y escritorio

| Herramienta | Precio | Fortaleza | Límite |
|---|---|---|---|
| **Google Earth Pro** | Gratis | Medición de polígonos, imágenes históricas, importación/exportación GIS, KML | Descarga de escritorio termina el **25/06/2027**; no genera informe técnico |
| **QGIS** | Gratis, open source | Análisis, edición, layouts, más de 2.000 plugins, reportes | Curva de aprendizaje alta; no es móvil por sí solo |
| **DaftLogic Area Calculator** | Gratis | Rápido, exporta KML, varias áreas | Anuncios invasivos; sin cuenta profesional ni informe |
| **CALCMAPS y similares** | Gratis | Medición rápida sobre mapa | Sin evidencia, sin incertidumbre, sin flujo de avalúo |

**Hallazgo:** la calculadora web es el "usuario cero" del mercado: gratis, inmediata y sin memoria. La oportunidad no es vencerla en velocidad, sino en **trazabilidad**.

### 4.6 Software de avalúo y oficina

No hay un líder claro en español para avalúo rural con medición integrada. La práctica se reparte entre:

- plantillas de Excel y procesadores de texto;
- QGIS/Google Earth para mapas;
- software de avalúo urbano o bancario, con módulos rurales limitados;
- servicios de agrimensura contratados por separado.

Ese es el espacio natural de la app: **el puente entre el campo y el informe de avalúo**.

---

## 5. Tabla comparativa general

| Herramienta | Categoría | Precio | Fuerte | Límite para tu caso | Qué copiar |
|---|---|---|---|---|---|
| GPS Fields Area Measure | Medición masiva | Gratis / COP 53.000 | Simplicidad, escala | Sin informe ni incertidumbre | Onboarding de 1 minuto |
| Easy Area | Medición masiva | Gratis / IAP | Muchos formatos de exportación | Interfaz genérica | Exportar KML/GPX/DXF |
| QField | GIS de campo | Gratis + nube | Offline, capas, formularios | Complejo de configurar | Rigor y trabajo offline |
| Mergin Maps | GIS colaborativo | €15,8/usuario/mes | QGIS + móvil + web | Curva técnica | Historial y sincronización |
| Mapit GIS | GIS móvil | Freemium | GeoPackage, RTK, 10+ formatos | Técnico | Soporte GNSS externo |
| SW Maps | GIS móvil | Gratis | RTK, atributos, fotos | Configuración | Evidencia por punto |
| Avenza Maps | Mapas offline | US$34,99–169,99/año | Mapas georreferenciados | Precio; no es medición de predios | Importar mapas propios |
| LandGlide | Parcelas EE.UU. | US$9,99/mes | Datos de propiedad | No aplica en LatAm | Búsqueda por parcela |
| Regrid | Parcelas EE.UU. | Gratis / ~US$10/mes | 157 M parcelas | No aplica en LatAm | Datos de uso y valor |
| Land id | Avalúo EE.UU. | US$7–66,67/mes | Comparables, informe, marca | No aplica en LatAm | Flujo de avalúo y mapas de marca |
| OneSoil | Agtech satelital | Gratis / Pro | NDVI, lotes, prescripciones | No documenta subparcelas | Monitoreo satelital |
| EOSDA | Agtech satelital | Gratis / cotización | Índices, reportes | Precio y conectividad | Reportes automáticos |
| Google Earth Pro | Escritorio | Gratis | Medición e imágenes históricas | Sin informe; termina en 2027 | KML e imágenes |
| QGIS | Escritorio GIS | Gratis | Análisis y layouts | Curva alta | Plantillas de mapa |
| DaftLogic | Web | Gratis | Rapidez | Sin trazabilidad | Simplicidad |

---

## 6. Hallazgos principales

### 6.1 La medición está commoditizada

Más de 20 apps en español hacen lo mismo, muchas gratis y con anuncios. El usuario casual no paga por medir; el profesional paga por **confiar** en lo que entrega. La app no debe competir por "más funciones de medición", sino por **calidad del documento**.

### 6.2 El valor está en el informe, no en el polígono

Land id cobra US$33–66/mes por mapas de marca, comparables e informes. Avenza cobra US$170/año por mapas y exportación. QFieldCloud cobra por sincronización y colaboración. Nadie cobra por "dibujar un polígono". El dinero está en el flujo posterior a la medición.

### 6.3 Nadie compara título, catastro y campo

Es la función que define la "rectificación de área" y no existe en las apps de consumo. Debería ser el corazón del producto:

```text
Área de título:      3,0000 ha
Área catastral:      2,9500 ha
Área medida:         3,0120 ha
Diferencia vs título: +0,0120 ha (+0,40 %)
Diferencia vs catastro: +0,0620 ha (+2,10 %)
Tolerancia:          ±1,00 %
Resultado:           Dentro de tolerancia vs título / Fuera vs catastro
```

### 6.4 Nadie declara incertidumbre

Las apps muestran un número con cuatro decimales y una "precisión GPS" genérica. Un profesional necesita saber **cuánto puede variar ese número**. La incertidumbre no es un lujo académico: es lo que diferencia un dato de una opinión.

### 6.5 El cultivo dentro del predio es un hueco real

Las apps miden el predio completo. La agtech satelital mide campos completos. Los GIS permiten lotear, pero con fricción. Un flujo de "predio → lotes/cultivos → superficie y porcentaje" resuelve arrendamientos, seguros, costos y avalúos.

### 6.6 Las herramientas profesionales son demasiado complejas

QField, Mergin y Mapit son excelentes, pero exigen preparar capas, formularios y proyectos. El agrónomo/avalúador que necesita un resultado en una tarde no va a montar un GIS. La simplicidad es una ventaja competitiva, no una concesión.

### 6.7 El dato catastral de EE.UU. no es trasladable

LandGlide, Regrid y Land id dependen de un catastro unificado. En Latinoamérica el dato está fragmentado por país, provincia y municipio. Copiar el producto es inviable; copiar el **flujo** (parcela → comparables → informe) sí es posible.

### 6.8 Offline es una ventaja en el campo latinoamericano

Las mejores apps profesionales son offline-first. La app actual también. Eso es correcto. El riesgo es que `localStorage` se borre o se pierda el teléfono: hay que agregar **respaldo exportable** y, más adelante, sincronización opcional.

### 6.9 Google Earth Pro se retira en 2027

La versión de escritorio dejará de descargarse el **25/06/2027**. Miles de profesionales usan Earth Pro para medir y exportar KML. Una app web/móvil que reciba y produzca KML, con un informe simple, puede ocupar ese espacio sin pretender ser un GIS.

### 6.10 Hay espacio de precio, pero el cliente latinoamericano es sensible

Las referencias van de COP 53.000 (pago único) a US$170/año. El precio no puede basarse en el valor del inmueble, sino en el **ahorro de tiempo** y en la **credibilidad del entregable**. Un Pro de US$15–25/año o COP 69.000–119.000/año es razonable; un pago único de lanzamiento de COP 149.000 también.

---

## 7. Oportunidad y posicionamiento

### 7.1 Propuesta de valor

> **"Medí, compará y documentá cada hectárea con evidencia."**

No es una app de medición. Es una herramienta de **verificación y documentación de superficies rurales** para agrónomos, avaluadores y técnicos que necesitan respaldar un número.

### 7.2 Tres posicionamientos posibles

| Posicionamiento | Mensaje | Cliente | Riesgo |
|---|---|---|---|
| **"Peritaje express"** | De la caminata al informe firmable en una tarde | Avaluadores, abogados, bancos | Exige rigor y disclaimers legales |
| **"Control de superficie"** | Sabé si el área coincide con el título y el catastro | Propietarios, compradores, sucesiones | Mercado más chico, pero Dolores claros |
| **"Agro medido"** | Medí lotes y cultivos, y llevá el mapa al informe | Agrónomos, productores, arrendatarios | Competencia con agtech gratuita |

**Recomendación:** liderar con **"peritaje express"** y usar "control de superficie" como caso de entrada. El primero justifica el precio; el segundo es fácil de explicar.

### 7.3 Cliente ideal inicial

1. **Avaluador rural solo o estudio pequeño** (tu perfil): necesita medir, comparar y emitir informe sin depender de un GIS.
2. **Agrónomo de campo** que controla superficies de cultivo, arrendamientos y seguros.
3. **Comprador/vendedor de campo** que quiere una segunda opinión antes de escriturar.

### 7.4 Por qué ahora

- El GPS de los teléfonos mejoró y el costo de un GNSS externo bajó.
- El trabajo remoto y la firma digital se normalizaron.
- Google Earth Pro se retira en 2027.
- Las apps masivas no evolucionaron hacia el informe.
- La presión por transparentar superficies y valores rurales creció.

---

## 8. Brechas de la app actual

### 8.1 Lo que ya está bien

- Medición GPS con umbral de precisión y separación mínima.
- Wake lock (mantener pantalla activa) y pausa/reanudación.
- Croquis a escala con zoom, desplazamiento y etiquetas.
- Exportación CSV, KML y GeoJSON.
- Impresión/PDF y resumen para copiar.
- Deshacer/rehacer y persistencia local.
- Demo de un predio irregular de ~2,48 ha, sin objetivo ni tolerancia de superficie.
- Casos independientes con guardado automático y PWA instalable.
- Interfaz en español, responsive y offline.

### 8.2 Lo que falta para ser profesional

| Capacidad | Estado actual | Referencia que lo hace bien | Prioridad |
|---|---|---|---|
| Predio + lotes/cultivos | No existe | QField, Land id (parcelas) | **P0** |
| Área de referencia (título/catastro) | Solo "objetivo" | Land id, LandGlide | **P0** |
| Repeticiones e incertidumbre | Solo precisión media | QField, SW Maps | **P0** |
| Fotos georreferenciadas | No existe | SW Maps, Mapit | **P0** |
| Informe con marca y firma | Impresión genérica | Land id, Avenza | **P0** |
| Respaldo/exportación de proyecto | Solo localStorage | QField, Mergin | **P0** |
| Importar KML/KMZ/GPX | Solo CSV de coordenadas | Easy Area, Avenza | P1 |
| Rumbos y distancias con cierre | Figuras cerradas simples | QGIS, agrimensura | P1 |
| Medición sobre mapa/imagen | No existe | Google Earth, DaftLogic | P1 |
| Unidades locales | Solo ha/m² | Práctica regional | P1 |
| Superficie neta (deducciones) | No existe | GIS | P1 |
| Exportar DXF/SHP | KML/GeoJSON/CSV | Mapit, SW Maps | P2 |
| Módulo de avalúo | No existe | Land id | P2 |
| Nube/cuentas/compartir | No existe | Mergin, QFieldCloud | P2 |
| Integración catastral | No existe | LandGlide, Regrid | P3 |
| GNSS externo/RTK | No existe | SW Maps, Mapit | P3 |

---

## 9. Mejoras recomendadas

### 9.1 P0 — MVP profesional (4–6 semanas)

#### A. Predio + lotes/cultivos

**Qué:** permitir dibujar o definir varios lotes dentro del predio, asignarles nombre, cultivo, color y superficie; calcular área y porcentaje del predio; restar caminos, canales o viviendas.

**Por qué:** es el caso de uso "medir el área de un cultivo dentro del predio" y no existe en la app.

**Cómo:** modelo de datos `project { parcel, lots[] }`; cada lote es un polígono con `name`, `crop`, `color`, `area`, `notes`. Validar que no se superpongan; si se superponen, advertir. Mostrar total de lotes y "% del predio".

**Criterio de aceptación:** un predio de 3 ha con dos lotes de 1,2 ha y 1,5 ha muestra 40 % y 50 %, y 0,3 ha "sin asignar".

#### B. Área de referencia y comparación

**Qué:** campos para área de título, área catastral y área de una medición anterior; fecha y fuente; tolerancia configurable; veredicto automático.

**Por qué:** es la esencia de la rectificación.

**Cómo:**

```text
Δ = A_medida − A_referencia
δ% = (Δ / A_referencia) × 100
```

Mostrar Δ en m² y ha, δ% y estado ("Dentro"/"Fuera" de tolerancia). Permitir comparar contra varias referencias a la vez.

**Criterio de aceptación:** con título 3,0000 ha, medición 3,0120 ha y tolerancia 1 %, muestra +120 m², +0,40 %, "Dentro".

#### C. Repeticiones e incertidumbre

**Qué:** guardar cada recorrido como una "pasada"; calcular media, desviación estándar y incertidumbre expandida; mostrar "Área informada: 3,012 ha ± 0,045 ha (k=2, n=3)".

**Por qué:** convierte un número en un dato defendible.

**Cómo:**

```text
s = desviación estándar muestral de las áreas
u = s / √n
U = k · u        (k = 2 para ~95 % de cobertura)
```

Si n = 1, no declarar incertidumbre por repetición: informar la precisión GPS y una sensibilidad.

**Criterio de aceptación:** con tres pasadas de 3,00 / 3,03 / 3,01 ha, muestra media 3,013 ha, s 0,015 ha, U 0,018 ha y n = 3.

#### D. Evidencia fotográfica

**Qué:** adjuntar fotos por vértice o por lote; guardar fecha, hora, coordenadas y precisión; comprimir; incluir en el informe.

**Por qué:** una foto con geotag y hora es la evidencia más simple y convincente.

**Cómo:** usar `IndexedDB` para las imágenes (no `localStorage`, que tiene límite de tamaño). Redimensionar a 1.600 px de lado y JPEG 0,8.

**Criterio de aceptación:** una foto tomada en un vértice aparece en el informe con coordenadas y hora.

#### E. Informe profesional

**Qué:** plantilla A4 con logo, encabezado, metodología, tabla de vértices, croquis, fotos, comparación, incertidumbre, hash y bloque de firma.

**Por qué:** es el entregable que el cliente paga.

**Cómo:** reutilizar la impresión actual, pero con:

- portada y datos del profesional;
- sección "Objeto y alcance";
- sección "Método e instrumento";
- tabla de resultados;
- comparación con referencias;
- incertidumbre;
- evidencia;
- declaración de limitaciones;
- firma y matrícula.

**Criterio de aceptación:** el PDF se imprime en A4, sin cortes, con logo y número de páginas.

#### F. Respaldo e integridad

**Qué:** exportar/importar el proyecto completo en `.json`; calcular un hash SHA-256 del conjunto de datos y mostrarlo en el informe; autosave en `IndexedDB`; aviso si el almacenamiento es local.

**Por qué:** `localStorage` se puede borrar; un proyecto perdido es un cliente perdido. El hash agrega una capa de integridad barata y diferencial.

**Cómo:** `crypto.subtle.digest('SHA-256', ...)` sobre el JSON canónico; mostrar los primeros 16 caracteres en el informe.

**Criterio de aceptación:** exportar, borrar el navegador, importar y recuperar el mismo proyecto y el mismo hash.

### 9.2 P1 — Producto completo (6–10 semanas)

| Mejora | Qué resuelve | Esfuerzo |
|---|---|---|
| Importar KML/KMZ/GPX/GeoJSON | Traer linderos existentes y comparar | 1–2 semanas |
| Rumbos y distancias con cierre | Mensura con estación total/cinta | 2 semanas |
| Medición sobre mapa o imagen | Predios sin caminata; fotos aéreas | 2–3 semanas |
| Unidades locales | Manzana, fanegada, cuadra, tarea, vara² | 3–5 días |
| Superficie neta | Descontar caminos, canales, vivienda | 1 semana |
| Modo campo | Botones grandes, distancia al próximo vértice, audio/háptico | 1–2 semanas |
| Exportar DXF/SHP | Integración con CAD y GIS | 1–2 semanas |

**Unidades locales:** la manzana, la fanegada, la cuadra y la tarea **varían por país y a veces por municipio**. La app no debe imponer un factor: debe permitir definirlo y guardarlo por proyecto. Un factor mal puesto es peor que no tener la unidad.

### 9.3 P2 — Valor y colaboración (2–4 meses)

- **Módulo de avalúo:** comparables, valor por hectárea, capitalización, costos; exportar al informe.
- **Nube opcional:** cuentas, sincronización, copia de seguridad, compartir un enlace de solo lectura.
- **Equipos:** plantillas, roles, firma del estudio.
- **Integraciones catastrales:** WMS/ArcGIS REST por país (IGAC en Colombia, catastro provincial en Argentina, SII en Chile).
- **GNSS externo:** importar NMEA/CSV de RTK; a futuro, Bluetooth.
- **Ortomosaicos de dron:** importar imagen, georreferenciar por dos puntos, medir.

### 9.4 P3 — Especialización

- Índices de vegetación (NDVI) y comparación con superficie declarada.
- Certificación de medición con sello de tiempo.
- API para estudios de avalúo y bancos.
- Módulo de servidumbres y derechos de paso.

---

## 10. La incertidumbre, explicada para el informe

### 10.1 Por qué una sola pasada no alcanza

Para un cuadrado de 3 ha (173,21 m de lado, perímetro 692,82 m), si el límite se desplaza en promedio `a` metros, el área cambia aproximadamente:

```text
ΔA ≈ P × a
```

| Precisión GPS (a) | ΔA aproximado | En hectáreas | % de 3 ha |
|---:|---:|---:|---:|
| ±3 m | 2.078 m² | 0,21 ha | 6,9 % |
| ±5 m | 3.464 m² | 0,35 ha | 11,5 % |
| ±8 m | 5.543 m² | 0,55 ha | 18,5 % |
| ±10 m | 6.928 m² | 0,69 ha | 23,1 % |

*Estimación de primer orden; el desplazamiento real depende de la forma, la orientación y la distribución del error. Para una banda de ancho `a`, el valor exacto incluye los vértices (+πa²), despreciable frente a P·a.*

**Lectura:** un área de 3 ha medida con ±5 m puede variar un 12 % sin que la app lo diga. Eso no invalida la medición, pero obliga a declararla y, cuando el uso es legal, a repetir o usar RTK.

### 10.2 Cómo reportar

Para **n pasadas**:

```text
Ā = (A₁ + A₂ + ... + Aₙ) / n
s = desviación estándar muestral
u = s / √n
U = 2 · u
```

Informar: `A = Ā ± U (k = 2, n = ...)`, más la precisión GPS media y el método.

Para **una sola pasada**: no inventar una incertidumbre por repetición. Informar la precisión del receptor y una **sensibilidad** (tabla como la anterior) o el resultado de una segunda pasada de control.

### 10.3 Error de cierre

Para una poligonal con rumbos y distancias:

```text
coordenada calculada del último vértice ≈ coordenada del primero
error de cierre c = distancia entre ambos
precisión relativa = c / perímetro
```

Si `c/P` supera el umbral del método (por ejemplo 1:500 con teléfono, 1:2.000 con estación total), advertir y no cerrar el polígono.

---

## 11. Modelo de negocio y precios

### 11.1 Referencias de precio

| Producto | Precio | Modelo |
|---|---|---|
| GPS Fields Area Measure PRO | COP 53.000 | Pago único |
| Avenza Maps Plus / Pro | US$34,99 / US$169,99 por año | Suscripción por dispositivo |
| Land id | US$7–66,67/mes | Suscripción por usuario |
| LandGlide | US$9,99/mes o US$99,99/año | Suscripción |
| Regrid Pro | ~US$10/mes | Suscripción |
| QFieldCloud | Gratis 100 MB; ~€18–28/usuario/mes | Suscripción |
| Mergin Maps | €15,8/colaborador/mes (anual) | Suscripción |

### 11.2 Propuesta de planes

| Plan | Precio sugerido | Incluye |
|---|---|---|
| **Gratis** | $0 | 1 proyecto, medición, KML/CSV, marca de agua |
| **Pro** | COP 69.000–99.000/año o US$19/año | Proyectos ilimitados, lotes/cultivos, referencia, incertidumbre, fotos, informe con logo, respaldo |
| **Pro de por vida** | COP 149.000 (lanzamiento) | Todo lo anterior, sin renovación |
| **Estudio** | COP 199.000/año o US$49/año | 3 usuarios, plantillas, firma del estudio, soporte |
| **Servicio** | A cotizar | Informe firmado, rectificación, avalúo |

**Anclaje de precio:** el Pro anual debería costar menos que **una hora** de honorario profesional. Si una medición y un informe ahorran 2–4 horas, el retorno es inmediato.

### 11.3 Distribución

- **Google Play** con Trusted Web Activity (TWA) o PWA instalable; la app ya es web.
- **WhatsApp**: enviar el PDF y un resumen de texto; es el canal natural del cliente rural.
- **Gremios y colegios**: Colegios de Ingenieros Agrónomos, Lonjas de Propiedad Raíz, asociaciones de avaluadores, cámaras inmobiliarias.
- **Ferias y capacitaciones**: demostración en vivo con un predio de 3 ha.
- **Alianzas**: agrimensores, notarías, bancos, aseguradoras agrícolas.

### 11.4 Métricas

- error medio vs. área de referencia (RTK/título);
- tiempo por medición e informe;
- % de proyectos que generan informe;
- conversión gratis → Pro;
- retención a 30/90 días;
- NPS de profesionales.

---

## 12. Nombres comerciales

### 12.1 Criterios

Un buen nombre para este producto debe ser:

1. pronunciable y corto en español;
2. distinto de los clones ("GPS Area Measure", "Medir área");
3. creíble en un informe y en una factura;
4. suficientemente amplio para crecer de medición a avalúo;
5. registrable como marca y dominio;
6. compatible con *Avalúos Integrales · Urbanos & Rurales*.

### 12.2 Los tres finalistas

| Nombre | Idea | Tagline | Fortalezas | Riesgos |
|---|---|---|---|---|
| **Tasalia** | *tasar* + sufijo que evoca lugar | **"La medida y el valor del campo, con respaldo."** | Corto, propio, premium; funciona en app, informe y factura; no encasilla en "medir" | Puede sonar a nombre de persona; "tasa" puede confundirse con tasa de interés; verificar marca |
| **Linderos** | Límites del predio; término de agrimensura y derecho | **"Cada lindero, con su prueba."** | Autoridad técnica inmediata; ideal para rectificación; buen SEO semántico | Palabra común: difícil de registrar y posicionar; muchas empresas homónimas; suena más a agrimensura que a avalúo |
| **CampoClaro** | Campo + claridad/transparencia | **"El campo, medido y documentado."** | Memorables; fácil de decir por WhatsApp; amable para clientes no técnicos | Muy descriptivo; alta densidad de marcas con "Campo"; menos premium |

### 12.3 Recomendación

**Marca principal: Tasalia.**

Arquitectura sugerida:

```text
Avalúos Integrales · Urbanos & Rurales     ← marca profesional / empresa
Tasalia                                     ← producto / app
"Medición y documentación de predios rurales" ← descriptor
Acta de Linderos                            ← nombre del documento que emite la app
"por Avalúos Integrales"                    ← sello de respaldo
```

Ventajas:

- **Tasalia** da marca y permite crecer a valor y avalúo.
- **Linderos** queda como nombre del **documento** ("Acta de Linderos"), donde la palabra genérica no necesita registro y aporta autoridad.
- **CampoClaro** queda como marca de entrada o versión gratuita si se busca volumen.
- El sello "por Avalúos Integrales" transfiere credibilidad y conecta con el logo circular (casa, surcos, árbol, grilla).

### 12.4 Alternativas consideradas

| Nombre | Por qué se consideró | Por qué no quedó en el podio |
|---|---|---|
| **Agrovalúa** | Une agro + avalúo; claro para el nicho | Suena a servicio/empresa más que a app; alta probabilidad de colisión y baja distintividad |
| **Mensura** | Término técnico de medición legal; máxima autoridad | Muy asociado a agrimensura; probable colisión con software de topografía; puede alejar a clientes no técnicos |
| **Prediaria** | Predio + -aria; propio y elegante | Menos evidente; puede confundirse con "predial"/directorio |

### 12.5 Verificación pendiente antes de invertir

- Búsqueda de marca en **SIC** (Colombia), **INPI** (Argentina), **INAPI** (Chile), **IMPI** (México) y **OMPI Global Brand Database**.
- Disponibilidad de dominios `.com`, `.app`, `.com.co`, `.com.ar`.
- Búsqueda en Google Play y App Store.
- Registro de cuenta de desarrollador y nombre del paquete Android.

---

## 13. Riesgos legales y técnicos

### 13.1 Legales

- **La app no sustituye una mensura legal.** Debe decirlo en la interfaz, en el informe y en los términos.
- **La firma es del profesional.** La app es un instrumento de apoyo; la responsabilidad es de quien firma.
- **Normas locales:** cada país tiene su catastro, su organismo y sus requisitos. El informe debe declarar el alcance y la norma aplicable.
- **Datos personales:** nombres de propietarios, coordenadas y fotos son datos sensibles. Almacenamiento local por defecto; consentimiento y política de privacidad si hay nube.
- **Publicidad engañosa:** no prometer "área exacta" ni "validez legal" si no hay RTK ni agrimensor.

### 13.2 Técnicos

- **Precisión GPS:** ±3–10 m en teléfono; no reemplaza RTK. Mitigar con repeticiones, umbral de precisión, GNSS externo y declaración de incertidumbre.
- **Datum:** WGS 84 vs. MAGNA-SIRGAS, POSGAR, SIRGAS. Para Catastro, la diferencia puede importar. Declarar el datum y, a futuro, permitir elegir sistema de referencia.
- **Almacenamiento:** `localStorage` es frágil; migrar a `IndexedDB` y exportar.
- **Offline:** las capas satelitales requieren caché y licencias; no prometer offline total si se usan tiles.
- **Navegadores:** iOS limita algunas APIs; probar Safari y Chrome Android.
- **Rendimiento:** fotos y polígonos grandes pueden agotar memoria; comprimir y paginar.

### 13.3 Comerciales

- **Competencia gratuita:** los clones con anuncios no se vencen con más funciones, sino con confianza y entregable.
- **Soporte:** un solo profesional no puede dar soporte 24/7; documentación y videos.
- **Estacionalidad:** el campo tiene temporadas; el flujo de caja puede ser irregular.
- **Dependencia de Google Play:** mantener la PWA como canal alternativo.

---

## 14. Hoja de ruta de 90 días

| Semana | Entregable | Criterio de éxito |
|---|---|---|
| 1–2 | Nombre, marca, plantilla de informe, demo de 3 ha | Logo y plantilla aprobados |
| 3–5 | Lotes/cultivos + área de referencia + comparación | Predio de 3 ha con 2 lotes y 3 referencias |
| 6–8 | Repeticiones/incertidumbre + fotos + informe + respaldo/hash | PDF de 4–6 páginas con evidencia |
| 9–10 | Validación en 3 predios (3, 10 y 50 ha) | Error < 2–3 % con 3 pasadas vs. RTK/título |
| 11–12 | Beta con 5 profesionales; ajustes de UX | 5 informes reales generados |
| 13 | Publicación (PWA/Play) y precio de lanzamiento | Primeros 10 usuarios |

### 14.1 Protocolo de validación

1. Elegir 3 predios con área conocida (título, catastro o RTK).
2. Medir cada uno con 3 pasadas independientes, misma separación y umbral.
3. Calcular media, s, U y error vs. referencia.
4. Repetir con un GNSS externo si hay disponible.
5. Documentar tiempo total y cantidad de fotos.
6. Ajustar el flujo antes de la beta.

### 14.2 Criterios de "listo para vender"

- El informe se entiende sin explicación adicional.
- El error es declarado, no escondido.
- El proyecto se exporta y se recupera.
- El cliente puede enviar el PDF por WhatsApp.
- El profesional firmaría el documento.

---

## 15. Preguntas abiertas para definir el producto

1. **¿En qué país operás principalmente?** Define unidades locales, catastro, normas y integraciones.
2. **¿El cliente principal es el propietario, el banco, el juzgado o el comprador?** Define el tono y el rigor del informe.
3. **¿Querés vender la app o usarla internamente?** Define si el precio es suscripción o licencia.
4. **¿Aceptás un pago único de lanzamiento?** En Latinoamérica suele convertir mejor que la suscripción.
5. **¿Tenés acceso a un GNSS/RTK o a un agrimensor aliado?** Define la promesa de precisión.
6. **¿El nombre debe convivir con "Avalúos Integrales" o reemplazarlo?** Recomendación: convivir, con Tasalia como producto.

---

## 16. Fuentes

Todas consultadas el **26/10/2026**, salvo indicación.

### Tiendas y apps

- Google Play — GPS Fields Area Measure: https://play.google.com/store/apps/details?id=lt.noframe.fieldsareameasure
- Google Play — GPS Fields Area Measure PRO: https://play.google.com/store/apps/details?id=lt.noframe.fieldsareameasure.pro
- Google Play — Easy Area: https://play.google.com/store/apps/details?id=easyarea.landcalculator.measuremap.gpsfieldgeo
- Google Play — LandGlide: https://play.google.com/store/apps/details?id=com.reportallusa.landglide
- Google Play — Regrid: https://play.google.com/store/apps/details?id=com.loveland.pr
- Google Play — SW Maps: https://play.google.com/store/apps/details?id=np.com.softwel.swmaps
- Google Play — búsqueda "medir terreno área": https://play.google.com/store/search?q=medir%20terreno%20%C3%A1rea&c=apps

### GIS y campo

- QField: https://qfield.org/
- QFieldCloud y precios: https://qfield.cloud/pricing
- Mergin Maps y precios: https://merginmaps.com/pricing
- Mapit GIS: https://mapitgis.com/
- Avenza Maps y precios: https://www.avenzamaps.com/pricing
- QGIS: https://qgis.org/en/site/about/features.html

### Parcelas y avalúo

- Land id y precios: https://land.id/pricing
- LandGlide: https://www.landglide.com/ (no disponible: 503)
- Regrid: https://www.regrid.com/
- AcreValue: https://www.acrevalue.com/ (no disponible: 403)

### Agtech y satélite

- OneSoil: https://onesoil.ai/
- EOSDA Crop Monitoring: https://eos.com/products/crop-monitoring/
- Auravant: https://www.auravant.com/
- Climate FieldView: https://climate.com/

### Escritorio y web

- Google Earth Versions: https://www.google.com/earth/versions/
- DaftLogic Area Calculator: https://www.daftlogic.com/projects-google-maps-area-calculator-tool.htm

### Catastro y referencia regional

- IGAC (Colombia), catastro multipropósito: https://www.igac.gov.co/
- IGAC, certificado catastral: https://tramites.igac.gov.co/geltramitesyservicios/home.seam
- IGAC, red geodésica: https://redgeodesica.igac.gov.co/

### Nota sobre precios

Los precios son referencias públicas al 26/10/2026. Pueden variar por país, impuestos, tipo de cambio, promociones y plan anual/mensual. Antes de fijar el precio propio, conviene relevar el mercado local y hacer una prueba de disposición a pagar con 10 profesionales.

---

## Anexo A — Checklist del informe de medición

- [ ] Nombre del predio y del solicitante
- [ ] Matrícula, folio o partida
- [ ] Ubicación y coordenadas del centro
- [ ] Fecha, hora y profesional
- [ ] Objeto y alcance
- [ ] Método e instrumento
- [ ] Datum y proyección
- [ ] Número de vértices y separación
- [ ] Precisión declarada y repeticiones
- [ ] Superficie bruta y neta
- [ ] Perímetro
- [ ] Tabla de vértices, lados y rumbos
- [ ] Croquis acotado
- [ ] Área de título y catastral
- [ ] Diferencia absoluta y relativa
- [ ] Tolerancia y veredicto
- [ ] Incertidumbre (U, k, n)
- [ ] Lotes/cultivos y porcentajes
- [ ] Fotos georreferenciadas
- [ ] Archivos KML/GeoJSON/CSV
- [ ] Hash de integridad
- [ ] Declaración de limitaciones
- [ ] Firma y matrícula

---

## Anexo B — Unidades y conversiones

| Unidad | Equivalencia | Nota |
|---|---|---|
| 1 ha | 10.000 m² | Unidad base |
| 1 acre | 4.046,8564 m² | 0,40468564 ha |
| 1 m² | 0,0001 ha | |
| Manzana | Variable | Depende del país y a veces del municipio |
| Fanegada | Variable | Colombia y otros países; no usar un factor único |
| Cuadra | Variable | Argentina, Uruguay, Paraguay y otros |
| Tarea | Variable | Caribe; varía por país |
| Vara² | Variable | La vara también varía (aprox. 0,83–0,86 m) |

**Recomendación:** permitir que el usuario defina el factor por proyecto y que el informe declare la equivalencia usada. No hardcodear unidades locales.

---

## Anexo C — Glosario

- **Predio:** inmueble rural delimitado.
- **Lindero:** límite del predio.
- **Mensura:** medición técnica y legal de un inmueble.
- **Rectificación de área:** corrección de la superficie registrada o catastral.
- **Avalúo/tasación:** estimación de valor.
- **Catastro:** registro público de inmuebles y su superficie.
- **GNSS:** sistema global de navegación por satélite (GPS, GLONASS, Galileo, BeiDou).
- **RTK:** posicionamiento cinemático en tiempo real, con corrección; precisión centimétrica.
- **NTRIP:** protocolo de correcciones GNSS por internet.
- **WGS 84:** sistema de referencia global usado por el GPS.
- **MAGNA-SIRGAS:** sistema de referencia oficial de Colombia.
- **POSGAR:** sistema de referencia oficial de Argentina.
- **Incertidumbre:** margen en el que probablemente se encuentra el valor verdadero.
- **Error de cierre:** diferencia entre el punto final calculado y el inicial en una poligonal.

---

*Fin del informe.*
