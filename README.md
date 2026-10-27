# CAMPO VERDE JRB

Aplicación web instalable en el móvil para **medir, documentar y rectificar superficies de predios rurales y cultivos**. Funciona sin conexión, no usa dependencias externas y guarda cada caso en el `localStorage` del navegador.

**AVALÚOS INTEGRALES · Urbanos & Rurales**

## Enlace publicado

**https://jobon31-commits.github.io/campo-verde-jrb/**

Repositorio: **https://github.com/jobon31-commits/campo-verde-jrb**

Abre el enlace en el móvil e instálala como PWA (ver más abajo).

## Qué hace

- **Tres métodos de medición**
  1. **GPS:** recorrido del lindero con el teléfono, con filtro de precisión y distancia mínima entre vértices.
  2. **Linderos:** cálculos a partir de medidas de cinta o estación total (cuadrilátero con diagonal, triángulo, rectángulo o círculo). El croquis se ancla en la **ubicación del plano** que indiques (latitud/longitud WGS 84) o en tu posición GPS actual.
  3. **Coordenadas:** carga manual o importación de una lista en grados decimales WGS 84.

- **Casos independientes:** cada caso guarda su propio croquis, método, ubicación, área de referencia, lotes, repeticiones, fotos y observaciones. Los cambios se guardan solos; puedes crear hasta 15 casos, abrirlos y eliminarlos desde el panel **«Casos guardados»**. El botón **Guardar ahora** fuerza el guardado.

- **Área de referencia opcional:** título, catastro o medición anterior. La app muestra la diferencia `ΔA = A_medida − A_referencia` en hectáreas, porcentaje y metros cuadrados. **La referencia no limita ni condiciona la medición.**

- **Repeticiones e incertidumbre:** guarda el área de cada recorrido y la app calcula la media, la desviación típica `s`, el error típico `u = s/√n` y la incertidumbre expandida `U = 2u` (95 %), además del coeficiente de variación.

- **Lotes y cultivos:** desglose del predio con superficie, porcentaje y balance entre lo asignado y lo que queda sin asignar.

- **Fotos del predio:** hasta 8 imágenes por caso, comprimidas a 1280 px (JPEG, calidad 0.72) y guardadas en el dispositivo. Cada foto hereda las coordenadas del centroide del predio.

- **Observaciones** del levantamiento y **huella SHA-256** del proyecto para verificar la integridad del archivo digital.

- **Informe técnico imprimible** (PDF): marca, croquis con grilla geográfica, coordenadas en grados decimales y DMS, comparación con la referencia, vértices y linderos, lotes, repeticiones, fotos, observaciones, firmas y huella.

- **Exportaciones:** CSV de vértices, KML para Google Earth, GeoJSON y resumen para el portapapeles. **Respaldo JSON** con huella SHA-256 y restauración con verificación. Al restaurar, el respaldo se abre como un caso nuevo y el caso anterior se conserva.

## Croquis y coordenadas

El croquis es una vista local en proyección equirectangular, adecuada para predios pequeños y medianos. Incluye:

- Grilla geográfica con paso adaptativo y etiquetas en grados/minutos/segundos.
- Caja **«UBICACIÓN DEL PLANO»** con las coordenadas del centroide.
- Lectura de coordenadas del puntero en el pie del croquis.
- Marcador **REF** en el centroide, escala gráfica, norte y control de capas (medidas y grilla).
- Al añadir un vértice se conserva la escala y el centro de la vista; el croquis solo se desplaza lo necesario para mostrar el punto nuevo. Esto evita el zoom y los saltos bruscos.

Las coordenadas se muestran en **grados decimales y DMS, datum WGS 84 (EPSG:4326)**.

## Instalar en el móvil

La app es una **PWA**: se instala desde un enlace HTTPS y queda como un icono más, a pantalla completa y con funcionamiento sin conexión después de la primera visita.

1. Abre el enlace en el móvil (Chrome en Android o Safari en iPhone).
2. **Android/Chrome:** menú ⋮ → **Instalar aplicación** (o usa el botón **Instalar** de la barra superior).
3. **iPhone/Safari:** botón **Compartir** → **Añadir a pantalla de inicio** → **Añadir**.
4. Abre **CAMPO VERDE JRB** desde el icono. Ya funciona como app.

> La instalación automática y el GPS requieren **HTTPS** o `localhost`. Abrir `index.html` con doble clic (`file://`) permite usar la app, pero no instalar ni acceder al GPS.

### Publicar el enlace

Sube **toda la carpeta** (incluida la subcarpeta `icons/`) a cualquier alojamiento estático con HTTPS:

- **Netlify Drop** (`app.netlify.com/drop`): arrastra la carpeta y obtienes un enlace HTTPS al instante.
- **GitHub Pages:** sube el contenido a un repositorio y activa Pages.
- **Cloudflare Pages**, **Vercel** o tu propio hosting con HTTPS.

No requiere compilación ni servidor especial: son archivos estáticos. Para probar en la computadora:

```powershell
python -m http.server 8899
```

Luego abre `http://localhost:8899/`.

## Almacenamiento

- Los casos se guardan en `campoverdejr.cases.v1`, con `activeId` y una lista de hasta 15 casos.
- El estado anterior (`campoverdejr.state.v2`) y la versión antigua (`terralinde.state.v1`) se migran automáticamente a un caso la primera vez. Las claves viejas se retiran después de guardar correctamente.
- Si el guardado de la lista falla por falta de espacio, la app intenta conservar la medición activa en `campoverdejr.state.v2` y la recupera al abrir si es más reciente.
- El **respaldo JSON** incluye `hash`, `hashAlgo` y `project`. Al restaurar, la app compara la huella y avisa si el archivo cambió.
- Los datos viven **en este dispositivo y navegador**. Para pasarlos a otro teléfono, descarga el respaldo JSON y restáuralo allí. Borrar los datos del navegador elimina los casos.

## Límites y uso profesional

- El GPS del teléfono es **orientativo**: su precisión típica es de ±3 a 10 m y el área puede variar entre recorridos. Usa las repeticiones para estimar la incertidumbre.
- La app **no reemplaza una mensura legal** ni un levantamiento con GNSS/RTK. Para escrituras, deslindes o trámites, consulta a un agrimensor matriculado.
- La proyección local del croquis es una representación de trabajo; no sustituye un plano georreferenciado en un sistema de proyección oficial.
- Verifica siempre linderos, documentación y superficies de título antes de registrar un área.

## Estructura

```
index.html        Estructura, paneles, PWA e informe imprimible
styles.css        Diseño, croquis, tablas, adaptación móvil e impresión
app.js            Estado, casos, cálculos geodésicos, croquis, fotos, informe y persistencia
manifest.json     Manifest de instalación (nombre, iconos, colores)
sw.js             Service worker: caché y funcionamiento sin conexión
icons/            Iconos 192/512, maskable, Apple Touch y favicon
README.md         Este documento
docs/             Informe de mercado y hoja de ruta de mejoras
```
