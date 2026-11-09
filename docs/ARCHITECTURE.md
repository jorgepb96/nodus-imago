# Arquitectura

## Separación

`src/` contiene React, vistas y controles; `shared/` contiene dominio, codecs, CSV, exportaciones, fórmulas, filtros, validación y contratos; `electron/` aloja persistencia, servicios y procesos locales; `runtime/` contiene el adaptador Python; `tests/`, `scripts/` y `build/` separan pruebas, automatización y empaquetado.

El proceso principal Electron gestiona ventanas, diálogos y credenciales cifradas. Un worker de Node ejecuta SQLite, importaciones, búsqueda y la cola persistente. No se realiza trabajo de imagen ni escaneo vectorial en el renderer. Python carga un modelo a la vez y libera el proceso tras inactividad. LFM3 se ejecuta con el CLI de llama.cpp en modo chat y un proyector de visión explícito; un pool acotado mantiene las sesiones cargadas entre celdas y las cierra tras un minuto de inactividad.

Las solicitudes de API atraviesan un broker en el proceso principal: el worker transmite el contenido de la solicitud y recibe el resultado, sin recibir claves. La misma cola sirve a modelos locales y APIs, con control de cancelación. El proveedor se fija por tarea/celda; no se sustituye automáticamente.

La salida de los modelos de visión no se guarda tal cual. `shared/visionOutput.ts` elimina razonamiento (`<think>`, `<reasoning>`, cierres huérfanos), cabeceras Markdown iniciales, banners del CLI, tokens especiales y el sobre `<minimax:tool_call>` cuando LFM3 lo usa. Las descripciones deben quedar como prosa; las clasificaciones se extraen como JSON, se fuerzan con `--json-schema` y se validan contra las opciones exactas de la propiedad. Un valor inválido hace fallar la celda y queda registrado en la tarea, sin propuesta.

## Datos y archivos

La colección se guarda en `userData/collection/` de una aplicación con identificador propio (`app.nodus.imago`). `IMAGO_USER_DATA` permite perfiles aislados para desarrollo y pruebas.

| Ubicación | Contenido |
| --- | --- |
| `imago.sqlite` | Tablas EAV `db_databases`, `db_columns`, `db_select_options`, `db_rows`, `db_cells`; relaciones, activos, FTS5, vectores, propuestas, historial y trabajos |
| `originals/` | Copias inmutables identificadas por SHA-256; sin imágenes BLOB en la base principal |
| Rutas externas | Originales vinculados por elección del usuario; su identidad se comprueba con hash al indexar y revincular |
| `thumbnails/` | Miniaturas WebP y previsualizaciones; se reconstruyen desde originales |
| `models/` | Revisiones independientes de modelos y runtimes, con marcas de integridad |
| `staging/` | Copias temporales y restauración verificada |
| `userData/secrets/` | Credenciales cifradas; separadas de la colección |

Se reutiliza la representación de Nodus: texto canónico por celda, IDs para selecciones y JSON de IDs para multi-select. Se mantienen columnas tipadas auxiliares para filtros numéricos y temporales. SQLite usa WAL, claves foráneas y transacciones. Se rechaza una versión de esquema desconocida en vez de migrarla implícitamente.

Los adjuntos genéricos de Nodus se conservan aunque no sea posible generar miniatura. La gestión visual se centra en imágenes. JPEG, PNG, WebP, TIFF y BMP tienen decodificación verificada; HEIC/HEIF no se ofrece porque el libheif de sharp 0.35.5 no incluye el decodificador HEVC necesario para la miniatura. El JSON/CSV/XLSX tabular utiliza el comportamiento de Nodus; la copia nativa es la vía que conserva IDs, estructura y originales.

## Importación y asociación

CSV se analiza en el worker y el renderer recibe una muestra y un token; no necesita mantener 10.000 filas en memoria. Nodus se abre de solo lectura y se importa desde una instantánea, con escritura transaccional en Imago. Los ZIP se inspeccionan con límites y se leen en streaming; las rutas de sus entradas nunca se usan como destinos de extracción sin validación. Un ZIP de Notion se convierte en bases CSV y, además, en una base de páginas Markdown con texto plano e imágenes referenciadas; no se reconstruyen bloques ni jerarquía.

Las correspondencias son primero exactas, después códigos de catálogo. Cada clave mantiene un conjunto de candidatos; más de una fila produce ambigüedad. Los patrones admiten expresiones lineales y plantillas; se rechazan grupos, alternativas y referencias inversas. La similitud parcial es explícita, limitada por número de comparaciones y nunca se confirma sin revisión.

Las importaciones de imágenes se encolan como listas persistentes. Tras una interrupción, el cursor y la deduplicación permiten volver a procesar el último archivo sin crear otro registro. Los archivos fallidos no bloquean los válidos. Un error de autenticación de API sí detiene el trabajo para evitar repetir solicitudes fallidas a toda la columna.

## Búsqueda

FTS5 indexa títulos, propiedades, etiquetas resueltas, nombres de archivo, EXIF y texto/descripciones importados. Se sincroniza mediante `search_documents` y triggers. Las consultas son parametrizadas; las palabras y frases se escapan como términos FTS. Las búsquedas parciales escapan los comodines de SQL.

Los filtros específicos se agrupan por base. Se admite AND/OR dentro de un esquema y any/all para multi-select. Ajustes permite declarar grupos de equivalencia entre columnas de texto de bases distintas; el filtro de grupo combina las columnas con OR y deja pasar las bases no incluidas. No se infieren equivalencias automáticamente.

El índice vectorial inicial usa BLOBs Float32 por hash de original y contrato completo. El contrato incluye modelo, revisión, dimensiones, backend, precisión y presupuesto visual. No se mezclan vectores de distintos contratos. MRL se trunca antes de normalizar. La búsqueda filtra primero y escanea vectores en el worker. El ranking por registro usa la mejor imagen; texto+imagen promedia vectores normalizados con pesos iguales. Híbrida usa Reciprocal Rank Fusion ponderada, con constante 60. Las puntuaciones no son probabilidades.

Esta primera versión usa un escaneo exacto, adecuado para establecer corrección y una línea base distribuible sin otra extensión nativa. `sqlite-vec` y HNSW son candidatos pendientes de comparación real; no se afirma haber realizado ese benchmark comparativo. Tampoco se afirma rendimiento de inferencia a partir de los vectores sintéticos del benchmark.

## Cambios automáticos

La cola de IA trabaja celda a celda y solo sobre valores vacíos. Las selecciones se validan contra las opciones de la propiedad; una salida no válida se registra como fallo. Los resultados van a `proposals`, conservando modelo, revisión o endpoint, instrucciones y fecha. La aceptación comprueba que el valor humano no cambió desde la generación. El historial permite deshacer un lote sin sobrescribir cambios posteriores. La ficha del registro consulta `provenance` y muestra las propuestas pendientes y aceptadas de esa fila.

La cola persiste el cursor de cada trabajo. Pausar un trabajo aborta su proceso y deja su estado en `paused`; los demás trabajos independientes siguen. Reanudar vuelve a encolar desde el cursor. La validación real comprobó esta separación con dos sesiones LFM3 (texto y JSON) y comprobó que, tras cerrar y reabrir el servicio, las filas, imágenes, valores aceptados y vectores siguen disponibles.

## Seguridad de modelos y copias

El catálogo incorpora revisiones fijas, tamaño esperado y digest SHA-256 de pesos o digest Git de configuraciones. No se carga código Python de los repositorios. Los módulos Sentence Transformers deben pertenecer al paquete `sentence_transformers` y ser `Transformer`, `Pooling` o `Normalize`; se aceptan los nombres antiguos y los de 6.2. El runtime Python bloquea sockets y exige `verified.json`. El motor nativo se obtiene de una publicación oficial fijada y verificada. La extracción TAR separa archivos y enlaces: primero extrae los datos y después crea solo enlaces relativos internos, rechazando rutas absolutas, `..`, unidades Windows y enlaces que salgan del directorio.

Las copias `.imago` contienen una instantánea SQLite y originales identificados por hash. La restauración exige una colección vacía, verifica integridad SQLite, referencias y archivos, y realiza la importación transaccional. Los trabajos importados se pausan y los ajustes del dispositivo y credenciales no se sustituyen. Los originales que no pueden leerse impiden crear una copia completa: no se produce una copia que finja incluirlos.
