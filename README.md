# Nodus Imago

**Research through images.** Gestor de bases de datos para investigación visual, independiente de [Nodus Research](https://github.com/jorgepb96/nodus), gratuito y bajo **AGPL-3.0-only**.

Versión de desarrollo **0.1.0**. La aplicación Electron, SQLite, la importación, la búsqueda literal, la búsqueda multimodal, la descripción y la clasificación por columnas son funcionales. La [revisión independiente del 12 de noviembre de 2026](docs/VERIFICATION.md) amplía las pruebas y corrige fallos de la implementación anterior; incluye EmbeddingGemma 2 y LFM3-VL-2B reales en macOS ARM64 (CPU), también desde la interfaz empaquetada. La matriz de aceptación y los límites exactos están en [docs/STATUS.md](docs/STATUS.md).

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

- Comparar clasificaciones de varios modelos y del investigador desde **Concordancia**: porcentajes de acuerdo, kappa, alfa nominal, multietiqueta, categorías y discrepancias; ensayos reproducibles y exportación CSV/JSON. [Método y límites](docs/CONCORDANCE.md). Implementado en código fuente, pendiente de la revisión conjunta.

La ampliación más reciente de filtros y ordenamientos está implementada en el código y pendiente de la revisión conjunta solicitada por el usuario: [cambios y comprobaciones pendientes](docs/PENDING_REVIEW.md).

- Crear, renombrar y eliminar varias bases de datos; añadir propiedades personalizadas.
- Buscar lugares con el catálogo local GeoNames usado en la genealogía de Nodus, incluso sin conexión; elegir una sugerencia o escribir un lugar propio. La ficha muestra un mapa cuadrado de OpenStreetMap ampliable cuando hay coordenadas y conexión. También se admiten coordenadas manuales.
- Abrir la vista **Mapa** de cada base de datos: todos los registros con coordenadas que cumplen los filtros, agrupación de imágenes cercanas, miniaturas y acceso a las fichas. Se puede elegir la propiedad de ubicación y consultar los registros sin coordenadas. Los puntos y la lista permanecen disponibles sin conexión; el fondo cartográfico requiere conexión o teselas ya almacenadas en caché.
- Importar CSV/TSV con previsualización, detección de tipos y corrección del esquema. Los valores incompatibles detienen la importación en lugar de perderse silenciosamente.
- Editar texto, números, fechas, casillas, selección, selección múltiple, estados, ubicación y relaciones. Las celdas de texto enriquecido incluyen barra Markdown (negrita, cursiva, título, lista, enlace, código) y vista previa segura. Las opciones tienen identificadores estables, colores y orden; no se pueden eliminar opciones que aún estén en uso.
- Reutilizar fórmulas de Nodus; el editor permite operaciones aritméticas, estadísticas de columna y expresiones seguras, y conserva como solo lectura las recetas importadas que aún no edita.
- Importar carpetas o archivos de imágenes, también mediante arrastrar y soltar sobre una base abierta. Copiar los originales al almacenamiento gestionado o vincular sus ubicaciones. Crear miniaturas y vistas previas, extraer EXIF y detectar duplicados con SHA-256.
- Asociar imágenes a filas mediante la columna elegida, nombres, códigos de catálogo o patrones lineales. Las referencias duplicadas se marcan como ambiguas. Las coincidencias parciales requieren revisión.
- Ver tabla y galería sobre los mismos registros; editar fichas, elegir imagen principal, reasignar imágenes y volver a vincular originales ausentes verificando su hash.
- Buscar en una o varias bases mediante SQLite FTS5: palabras, frases y fragmentos. Filtrar campos y listas de opciones, ordenar y guardar búsquedas. Funciona sin modelos ni conexión.
- Exportar CSV/JSON/XLSX. Crear copias nativas `.imago` con originales, estructura, opciones, relaciones, propuestas, historial y vectores. Restaurarlas en una colección vacía con comprobaciones de integridad.
- Gestionar modelos con revisión fijada y verificaciones por archivo. Las descargas son opcionales, explícitas, reanudables y cancelables.
- Encolar descripciones y clasificaciones para registros seleccionados o **columnas completas**. Cada propiedad puede configurar modelo, instrucciones e imágenes de origen. Se reutilizan los constructores de contexto y mensajes multimodales de Nodus.
- Añadir **varios registros vacíos a la vez** (hasta 1.000) y adjuntar una imagen a un registro directamente desde la tabla o la galería.
- Revisar y aceptar/rechazar propuestas individuales o en lote. Se conservan modelo, revisión, instrucciones y fecha; la ficha del registro muestra su procedencia. No se sustituyen anotaciones humanas y se pueden deshacer los cambios aceptados.
- Pausar, reanudar y cancelar trabajos individuales. Dos columnas distintas pueden procesarse a la vez dentro de los límites de memoria y perfil.
- Elegir temas y modos claro/oscuro/sistema con el motor de paletas original de Nodus.
- Icono de objetivo fotográfico con la N canónica de Nodus: variante clara y oscura, con el icono del Dock de macOS adaptándose al tema resuelto.

## IA local y APIs opcionales

La configuración inicial es local y **las APIs remotas están desactivadas**. No se hacen comprobaciones de modelos ni solicitudes de inferencia al abrir la aplicación. Los embeddings y la recuperación semántica permanecen locales.

Los modelos principales preconfigurados son:

| Tarea | Modelo | Ejecución |
| --- | --- | --- |
| Embeddings multimodales | EmbeddingGemma 2 ONNX Q8, texto + visión, 541,8 MB | Transformers.js 4.3.1 y ONNX Runtime 1.30.0 integrados, CPU, 256/512/768 dimensiones; sin Python ni audio |
| Embeddings en Mac Intel | Harrier OSS v1 0.6B Q8_0, 639,4 MB | llama.cpp CPU, pooling last, 1024 dimensiones; imágenes mediante descripciones locales de LFM3 |
| Descripción y clasificación | LiquidAI LFM3-VL-2B, Q4_K_M + proyector F16 oficial | llama.cpp b11981, proceso nativo local, CPU |
| Alternativas experimentales | PyTorch anterior y SmolVLM2 256 M/500 M | Python opcional, instalación manual; fuera del flujo principal |

**Los pesos no se incluyen en el instalador.** En **Inicio → Preparar búsqueda local** o **Ajustes → Modelos**, el gestor muestra modelo/runtime, procedencia, licencia, tamaño, espacio disponible y destino antes de pedir autorización. Descarga las dependencias bajo demanda con progreso, pausa/cancelación, reanudación y SHA-256. La búsqueda literal funciona sin modelos. Mac Intel selecciona Harrier porque el runtime ONNX fijado no ofrece binario darwin-x64.

Los vectores PyTorch anteriores se conservan bajo su contrato. Al cambiar backend o dimensiones hay que reindexar; la interfaz muestra los vectores de otros contratos y nunca los mezcla con el índice activo. Las copias anteriores siguen siendo restaurables.

### Entorno Python opcional

Solo el modo experimental PyTorch anterior y SmolVLM2 requieren `runtime/requirements.txt`. El flujo principal ONNX/Harrier/LFM3 no usa este intérprete. El CLI histórico `node scripts/download-models.mjs --yes` descarga los pesos de compatibilidad (~3 GB), no sustituye al gestor ONNX actual. `torchvision` se necesita únicamente en ese modo experimental para las entradas visuales.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r runtime/requirements.txt
```

En Windows usa `.venv\Scripts\python.exe`. Introduce la ruta absoluta del intérprete en **Ajustes → Rendimiento** y pulsa **Comprobar** para ver las versiones de `torch`, `transformers` y `sentence-transformers`. La instalación de paquetes requiere conexión; la inferencia utiliza exclusivamente archivos locales, `trust_remote_code=False`, variables de modo offline y conexiones de socket bloqueadas. El entorno Python todavía no se incluye en los instaladores.

### LFM3 y razonamiento

Para LFM3, descarga **Motor de visión local · llama.cpp** y el modelo desde **Ajustes → Modelos locales**. La aplicación usa `llama-mtmd-cli` en su modo de chat persistente, sin abrir un puerto: mantiene el GGUF y el proyector cargados entre celdas y envía `/clear`, `/image` y el prompt por la entrada estándar. El pool se limita por perfil y número de trabajos; las sesiones inactivas se cierran tras un minuto. CPU es la configuración predeterminada. La ruta principal ONNX y Harrier utiliza CPU. Las pruebas históricas de Metal/MPS corresponden al modo PyTorch experimental; CUDA no se ha ejecutado.

El CLI b11981 no admite `--single-turn`, `--simple-io` ni `--no-display-prompt`. Imago usa `--log-verbosity 0`, `--image-max-tokens 280` para acotar el coste visual y, en clasificación, `--json-schema` para exigir un array de cadenas. LFM3 puede anteponer un bloque de razonamiento terminado en `</think>`, una cabecera Markdown o un sobre `<minimax:tool_call>`; `shared/visionOutput.ts` extrae el cuerpo útil y elimina el resto antes de validar. Si solo queda razonamiento o JSON inválido, el trabajo falla y no se crea ninguna propuesta. Una clasificación debe pertenecer al vocabulario exacto de la propiedad; se aceptan etiquetas en objetos con claves como `label`, `Label` o `category`.

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

El informe reproducible está en [docs/benchmarks/real-models-macos-arm64.json](docs/benchmarks/real-models-macos-arm64.json). La ejecución de referencia (Apple M2, 16 GB, CPU, 512 dimensiones, 9 de noviembre de 2026) midió: indexación en frío de tres imágenes 19,6 s; consulta textual en caliente 93 ms; consulta por imagen 3,0 s; consulta combinada 3,4 s; descripción 9,6 s; clasificación 8,5 s; dos celdas de descripción seguidas 12,0 s; consulta tras reabrir 7,0 s. Los tiempos varían con la carga del equipo y no son extrapolables. Son medidas de un corpus de tres imágenes, no un benchmark de calidad ni de un corpus de 10.000 fotografías.

Si falla, el diagnóstico se escribe en `test-results/real-models-failure.json`. No se sustituyen pesos por mocks para declarar que la inferencia funciona.

## Compatibilidad con Nodus y Notion

**Copiar datos de Nodus** abre el archivo SQLite mediante una conexión de solo lectura y obtiene una instantánea consistente. No se ejecutan migraciones en Nodus. Se conservan IDs de bases, columnas, opciones, filas, relaciones y adjuntos; se admiten blobs históricos y el almacenamiento deduplicado `db_blobs.data` de v135. Una importación con IDs existentes se rechaza para impedir colisiones.

Las relaciones hacia Zotero u otros vaults se conservan como referencias externas sin resolver. Páginas, automatizaciones y funciones ajenas a la investigación visual no se importan como servicios activos. La versión de Nodus inspeccionada y los módulos adaptados se documentan en [REUSE.md](docs/REUSE.md).

Notion ZIP admite las tablas CSV, las imágenes referenciadas por rutas relativas y las páginas Markdown. Las páginas se incorporan como una base «Páginas Notion» con título, contenido enriquecido, carpeta de origen, relación «Página padre» y las imágenes que referencian. El contenido conserva un árbol real de bloques anidados, incluidos listas, tareas, citas, tablas, referencias de imagen y tokens de formato. El original importado se mantiene para consulta tras las ediciones visuales. El HTML desconocido se conserva como dato y no se ejecuta; no se garantiza una reconstrucción de bloques exclusivos de la API de Notion que su exportación Markdown no contiene. Las bases con una relación a sí mismas ofrecen también una vista «Árbol» navegable. Los CSV de Notion no codifican sus IDs de opciones, fórmulas ni relaciones tipadas; no se afirma una reconstrucción sin pérdida de esos datos. Al importar imágenes se puede elegir la propiedad de adjuntos de destino.

## Edición y automatización

Las propiedades de texto enriquecido usan un editor visual con historial, listas anidadas, tablas, enlaces HTTPS y modo Markdown opcional. **Propiedades → Rollup** permite elegir relación, propiedad y agregación; los resultados se recalculan con las ediciones y eliminaciones, y no dependen de los filtros de la vista.

**Automatizaciones** admite reglas por creación, cambio, intervalo o ejecución manual, condiciones con los mismos filtros de las vistas y acciones de asignación, copia o análisis en la cola de IA. Las reglas requieren activación expresa, conservan los valores existentes por defecto, no encadenan otras reglas y registran resultados. Las acciones de IA generan propuestas para revisión. Las copias restauran las reglas desactivadas para exigir nueva activación.

## Formatos de imagen

JPEG, PNG, WebP, TIFF, BMP, HEIC y HEIF tienen rutas reales de decodificación, miniatura y extracción EXIF; los HEIC usan ExifReader para leer el elemento Exif del contenedor. El `libheif` incluido en sharp 0.35.5 no incorpora el decodificador HEVC, así que HEIC/HEIF se decodifican con el WASM de `heic-decode`/`libheif-js` y se entregan a sharp como RGBA. La prueba usa un HEIC sintético y se ha comprobado también con una foto real de 5712×4284. Consulta [docs/STATUS.md](docs/STATUS.md).

## Pruebas y mediciones

```sh
npm run lint           # ESLint sin errores
npm test               # 86 pruebas en Electron (un fixture HEIC externo es optativo)
npm run verify         # typecheck + lint + pruebas + build
npm run build
npm run test:e2e       # requiere entorno gráfico
npm run test:audit     # flujos ampliados de UI, IPC, API local, copias y recuperación
npm run test:ai:e2e    # optativo: IA real desde Electron con los pesos ya instalados
npm run benchmark
```

La batería cubre celdas, CSV, selección múltiple, filtros, equivalencias de campos, FTS, persistencia, fórmulas aritméticas/estadísticas/expresiones, relaciones, asociación y movimiento masivo de imágenes, deduplicación, copias, restauración, importación Nodus/Notion —incluidas páginas Markdown—, colas, privacidad, credenciales, clasificación por columnas, extracción segura de runtimes y análisis de la salida de visión. La prueba de escritorio usa Electron real y datos de prueba aislados; también se ejecuta sobre la aplicación macOS ARM64 empaquetada, desde el DMG montado en solo lectura, sobre la app macOS x64 bajo Rosetta y sobre los paquetes Linux ARM64 y x64 en Docker con Xvfb.

El benchmark de [docs/benchmarks/local.json](docs/benchmarks/local.json) mide **10.000 registros sintéticos**, búsquedas y correspondencias. No representa 10.000 fotografías reales ni un benchmark de inferencia.

## Compilar instaladores

```sh
npm run dist:mac       # DMG y ZIP, ARM64
npm run dist:mac:x64   # DMG y ZIP, Intel x64 (ejecutar en Intel nativo)
npm run dist:win       # NSIS, x64
npm run dist:linux     # AppImage, DEB y RPM, arquitectura actual, x64 o ARM64
```

Compila en el sistema destino; los módulos nativos requieren el ABI y la arquitectura correctos. La [CI](.github/workflows/ci.yml) ejecuta cinco targets nativos: macOS ARM64/Intel, Windows x64 y Linux x64/ARM64. Construye instaladores de prueba sin firma y ejercita sus ejecutables; los jobs de IA descargan pesos explícitamente en perfiles limpios, sin caché de pesos. La evidencia vigente y los fallos aún abiertos están en [VERIFICATION.md](docs/VERIFICATION.md). Un build o una matriz configurada no acreditan por sí solos compatibilidad. No se ha solicitado una release pública firmada, notarización, APIs comerciales ni CUDA.

## Documentación y licencia

[Arquitectura](docs/ARCHITECTURE.md) · [Estado y fases](docs/STATUS.md) · [Handoff para Codex](docs/CODEX_HANDOFF.md) · [Reutilización de Nodus](docs/REUSE.md) · [Modelos](docs/MODELS.md) · [Privacidad](PRIVACY.md) · [Dependencias y atribuciones](THIRD_PARTY_NOTICES.md) · [Código fuente](SOURCE_CODE.md).

Nodus Imago: © Jorge Pérez Burgueño, [AGPL-3.0-only](LICENSE). Las dependencias y los modelos conservan sus licencias. EmbeddingGemma 2 y SmolVLM2 se ofrecen bajo Apache-2.0. LFM3 usa [LFM Open License 1.0](legal/LFM-Open-License-1.0.txt), que incluye condiciones comerciales; no se presenta como un modelo con licencia AGPL ni se redistribuyen sus pesos dentro del programa.
