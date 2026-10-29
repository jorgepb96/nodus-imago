# Nodus Imago

**Research through images.** Gestor de bases de datos para investigación visual, independiente de [Nodus Research](https://github.com/jorgepb96/nodus), gratuito y bajo **AGPL-3.0-only**.

Versión de desarrollo **0.1.0**. La aplicación Electron, SQLite, la importación, la búsqueda literal, la búsqueda multimodal, la descripción y la clasificación por columnas son funcionales. El **29 de octubre de 2026** se validaron con pesos reales EmbeddingGemma 2 y LFM3-VL-2B en macOS ARM64 (CPU), además de la suite automatizada y la prueba de escritorio. La matriz de aceptación y los límites exactos están en [docs/STATUS.md](docs/STATUS.md).

## Empezar

Requisitos de desarrollo: Node.js **22.12 o posterior**, npm y las herramientas de compilación nativa de la plataforma si no hay un binario precompilado de SQLite. No requiere tener instalado Nodus.

```sh
npm ci
npm run dev
```

Para ejecutar la versión compilada:

```sh
npm run build
npm start
```

`postinstall` prepara `better-sqlite3` para el ABI de Electron. Las pruebas usan ese mismo Electron; no es necesario alternar entre compilaciones nativas de Node y Electron.

## Qué se puede hacer

- Crear, renombrar y eliminar varias bases de datos; añadir propiedades personalizadas.
- Importar CSV/TSV con previsualización, detección de tipos y corrección del esquema. Los valores incompatibles detienen la importación en lugar de perderse silenciosamente.
- Editar texto, números, fechas, casillas, selección, selección múltiple, estados, ubicación y relaciones. Las opciones tienen identificadores estables, colores y orden; no se pueden eliminar opciones que aún estén en uso.
- Reutilizar fórmulas de Nodus; el editor permite operaciones aritméticas y conserva las configuraciones importadas de otros tipos, con los límites descritos en la matriz.
- Importar carpetas o archivos de imágenes, también mediante arrastrar y soltar sobre una base abierta. Copiar los originales al almacenamiento gestionado o vincular sus ubicaciones. Crear miniaturas y vistas previas, extraer EXIF y detectar duplicados con SHA-256.
- Asociar imágenes a filas mediante la columna elegida, nombres, códigos de catálogo o patrones lineales. Las referencias duplicadas se marcan como ambiguas. Las coincidencias parciales requieren revisión.
- Ver tabla y galería sobre los mismos registros; editar fichas, elegir imagen principal, reasignar imágenes y volver a vincular originales ausentes verificando su hash.
- Buscar en una o varias bases mediante SQLite FTS5: palabras, frases y fragmentos. Filtrar campos y listas de opciones, ordenar y guardar búsquedas. Funciona sin modelos ni conexión.
- Exportar CSV/JSON/XLSX. Crear copias nativas `.imago` con originales, estructura, opciones, relaciones, propuestas, historial y vectores. Restaurarlas en una colección vacía con comprobaciones de integridad.
- Gestionar modelos con revisión fijada y verificaciones por archivo. Las descargas son opcionales, explícitas, reanudables y cancelables.
- Encolar descripciones y clasificaciones para registros seleccionados o **columnas completas**. Cada propiedad puede configurar modelo, instrucciones e imágenes de origen. Se reutilizan los constructores de contexto y mensajes multimodales de Nodus.
- Revisar y aceptar/rechazar propuestas individuales o en lote. Se conservan modelo, revisión, instrucciones y fecha; la ficha del registro muestra su procedencia. No se sustituyen anotaciones humanas y se pueden deshacer los cambios aceptados.
- Pausar, reanudar y cancelar trabajos individuales. Dos columnas distintas pueden procesarse a la vez dentro de los límites de memoria y perfil.
- Elegir temas y modos claro/oscuro/sistema con el motor de paletas original de Nodus.

## IA local y APIs opcionales

La configuración inicial es local y **las APIs remotas están desactivadas**. No se hacen comprobaciones de modelos ni solicitudes de inferencia al abrir la aplicación. Los embeddings y la recuperación semántica permanecen locales.

Los modelos principales preconfigurados son:

| Tarea | Modelo | Ejecución |
| --- | --- | --- |
| Embeddings multimodales | Google EmbeddingGemma 2, texto + visión, aproximadamente 440 M de parámetros activos | Python, Sentence Transformers 6.2, FP32, 512 dimensiones, sin codificador de audio |
| Descripción y clasificación | LiquidAI LFM3-VL-2B, Q4_K_M + proyector F16 oficial | llama.cpp b11981, proceso nativo local, CPU |
| Alternativas compactas | SmolVLM2 256 M y 500 M | Python, Transformers, FP32 |

**Los pesos no se incluyen en el instalador.** Se descargan desde Ajustes, desde una URL oficial fijada por revisión, o con:

```sh
node scripts/download-models.mjs --yes
```

Ese comando descarga unos 3 GB y solo debe ejecutarse tras una decisión explícita. Las descargas de la aplicación muestran progreso y se pueden pausar, reanudar o cancelar; cada archivo se verifica antes de marcarse como instalado.

### Entorno Python opcional

EmbeddingGemma 2 y SmolVLM2 requieren un intérprete con las dependencias de `runtime/requirements.txt`. `torchvision` es necesario porque el procesador visual de EmbeddingGemma 2 lo carga al construir las entradas de imagen.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r runtime/requirements.txt
```

En Windows usa `.venv\Scripts\python.exe`. Introduce la ruta absoluta del intérprete en **Ajustes → Rendimiento** y pulsa **Comprobar** para ver las versiones de `torch`, `transformers` y `sentence-transformers`. La instalación de paquetes requiere conexión; la inferencia utiliza exclusivamente archivos locales, `trust_remote_code=False`, variables de modo offline y conexiones de socket bloqueadas. El entorno Python todavía no se incluye en los instaladores.

### LFM3 y razonamiento

Para LFM3, descarga **Motor de visión local · llama.cpp** y el modelo desde **Ajustes → Modelos locales**. La aplicación usa `llama-mtmd-cli` como proceso de consola, sin abrir un puerto. CPU es la configuración predeterminada; las aceleraciones se ofrecen como experimentales hasta verificarlas en cada plataforma.

El CLI b11981 no admite `--single-turn`, `--simple-io` ni `--no-display-prompt`; esas opciones se han eliminado. Imago usa `--log-verbosity 0` y no aplica la plantilla Jinja con `--jinja`: el modo de una sola consulta recibe la imagen y el prompt directamente. Aun así, LFM3 puede anteponer un bloque de razonamiento terminado en `</think>` o una cabecera Markdown. `shared/visionOutput.ts` lo elimina antes de validar el valor; si solo queda razonamiento, el trabajo falla y no se crea ninguna propuesta. Una clasificación debe ser un JSON de etiquetas del vocabulario exacto de la propiedad; se aceptan tanto cadenas como objetos con `label`/`category`.

### APIs opcionales

Para usar APIs: abre **Ajustes → Proveedores**, activa su uso remoto, guarda las credenciales, configura un modelo con visión y selecciónalo para descripciones o clasificación. Puedes sustituirlo por propiedad en **Propiedades → IA de la propiedad**. No hay cambio automático de local a remoto. Ollama, LM Studio y endpoints compatibles del propio equipo también se pueden configurar.

Las claves siguen el patrón de Nodus: ficheros independientes por proveedor cifrados con `safeStorage`, escrituras atómicas y ningún respaldo en texto plano. Son **credenciales propias de Imago**; no se leen ni modifican las de Nodus. La interfaz solo recibe el estado de configuración, nunca una clave guardada. Las copias de colecciones no incluyen credenciales. Si Linux solo dispone del backend `basic_text`, el almacenamiento de claves falla de forma explícita.

Los proveedores pueden aplicar costes y sus propias condiciones de tratamiento de datos. El envío solo se produce al encolar una tarea con el proveedor elegido y las APIs habilitadas. Las pruebas usan respuestas de contrato controladas, sin llamadas reales ni claves del usuario.

## Validación real de modelos

El validador usa una colección independiente (`test-results/local-ai-validation`) y enlaza los modelos ya descargados sin escribir en la colección del usuario:

```sh
node scripts/validate-models.mjs
```

Comprueba, con los pesos reales:

1. Indexación de tres imágenes y recuperación por texto en español.
2. Consulta mediante una imagen temporal que no se incorpora a la colección.
3. Texto + imagen y fusión híbrida.
4. Descripción y clasificación con LFM3, vocabulario permitido y propuestas.
5. Dos trabajos de columnas distintas a la vez; pausa de uno sin detener el otro; reanudación.
6. Aceptación de propuestas y conservación de valores humanos.
7. Cierre y reapertura: registros, imágenes, valores aceptados e índice vectorial.
8. Que la descripción no contenga razonamiento, cabeceras del prompt ni JSON.

El informe reproducible está en [docs/benchmarks/real-models-macos-arm64.json](docs/benchmarks/real-models-macos-arm64.json). La ejecución de referencia (Apple M2, 16 GB, CPU, 512 dimensiones) midió: indexación en frío de tres imágenes 39,1 s; consulta textual en caliente 152 ms; consulta por imagen 7,3 s; consulta combinada 8,4 s; descripción 24,6 s; clasificación 21,1 s; consulta tras reabrir 7,7 s. Los tiempos varían con la carga del equipo y no son extrapolables. Son medidas de un corpus de tres imágenes, no un benchmark de calidad ni de un corpus de 10.000 fotografías.

Si falla, el diagnóstico se escribe en `test-results/real-models-failure.json`. No se sustituyen pesos por mocks para declarar que la inferencia funciona.

## Compatibilidad con Nodus y Notion

**Copiar datos de Nodus** abre el archivo SQLite mediante una conexión de solo lectura y obtiene una instantánea consistente. No se ejecutan migraciones en Nodus. Se conservan IDs de bases, columnas, opciones, filas, relaciones y adjuntos; se admiten blobs históricos y el almacenamiento deduplicado `db_blobs.data` de v135. Una importación con IDs existentes se rechaza para impedir colisiones.

Las relaciones hacia Zotero u otros vaults se conservan como referencias externas sin resolver. Páginas, automatizaciones y funciones ajenas a la investigación visual no se importan como servicios activos. La versión de Nodus inspeccionada y los módulos adaptados se documentan en [REUSE.md](docs/REUSE.md).

Notion ZIP admite las tablas CSV e imágenes referenciadas por rutas relativas. Los CSV de Notion no codifican sus IDs de opciones, fórmulas ni relaciones tipadas; no se afirma una reconstrucción sin pérdida de esos datos. Los documentos de página Markdown aún no se incorporan.

## Formatos de imagen

JPEG, PNG, WebP, TIFF y BMP tienen rutas reales de decodificación, miniatura y metadatos. **HEIC/HEIF no se ofrece**: el `libheif` incluido en sharp 0.35.5 lee el contenedor, pero no incorpora el decodificador HEVC (`libde265`) necesario para generar la miniatura. Se comprobó con un HEIC real generado por macOS y la importación falló con `Support for this compression format has not been built in: HEVC`. No se añadió una biblioteca adicional por licencias, tamaño y coste de distribución. Consulta [docs/STATUS.md](docs/STATUS.md).

## Pruebas y mediciones

```sh
npm test               # 44 pruebas en Electron
npm run build
npm run test:e2e       # requiere entorno gráfico
npm run benchmark
```

La batería cubre celdas, CSV, selección múltiple, filtros, FTS, persistencia, fórmulas, relaciones, asociación de imágenes, deduplicación, copias, restauración, importación Nodus/Notion, colas, privacidad, credenciales, clasificación por columnas, extracción segura de runtimes y análisis de la salida de visión. La prueba de escritorio usa Electron real y datos de prueba aislados; también se ejecuta sobre la aplicación macOS ARM64 empaquetada y desde el DMG montado en solo lectura.

El benchmark de [docs/benchmarks/local.json](docs/benchmarks/local.json) mide **10.000 registros sintéticos**, búsquedas y correspondencias. No representa 10.000 fotografías reales ni un benchmark de inferencia.

## Compilar instaladores

```sh
npm run dist:mac       # DMG y ZIP, ARM64 y x64
npm run dist:win       # NSIS, x64
npm run dist:linux     # AppImage, DEB y RPM, x64
```

Compila en el sistema destino; los módulos nativos requieren el ABI y la arquitectura correctos. La [automatización de CI](.github/workflows/ci.yml) define esa matriz, pero **una configuración de CI no equivale a una plataforma comprobada**. En este entorno solo se ha construido y ejecutado macOS ARM64; macOS Intel, Windows y Linux no se han ejecutado. Firma, notarización y publicación requieren las credenciales del mantenedor y no se han realizado.

## Documentación y licencia

[Arquitectura](docs/ARCHITECTURE.md) · [Estado y fases](docs/STATUS.md) · [Reutilización de Nodus](docs/REUSE.md) · [Modelos](docs/MODELS.md) · [Privacidad](PRIVACY.md) · [Dependencias y atribuciones](THIRD_PARTY_NOTICES.md) · [Código fuente](SOURCE_CODE.md).

Nodus Imago: © Jorge Pérez Burgueño, [AGPL-3.0-only](LICENSE). Las dependencias y los modelos conservan sus licencias. EmbeddingGemma 2 y SmolVLM2 se ofrecen bajo Apache-2.0. LFM3 usa [LFM Open License 1.0](legal/LFM-Open-License-1.0.txt), que incluye condiciones comerciales; no se presenta como un modelo con licencia AGPL ni se redistribuyen sus pesos dentro del programa.
