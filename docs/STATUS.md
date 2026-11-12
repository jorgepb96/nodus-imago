# Estado verificable y trabajo pendiente

**Actualización del 13 de noviembre de 2026 (trabajo en curso):** implementadas la ruta ONNX sin Python, Harrier para Intel, gestor de dependencias/modelos, los cinco targets de CI y las cuatro funciones de fase 2 (edición visual, bloques, rollups y automatizaciones). La suite local pasa 100 pruebas, typecheck, lint y build. Los recorridos generales, auditoría de nueve grupos, lugares, mapa, criterios, concordancia y fase 2 pasan en macOS ARM64. La primera instalación ONNX real sin Python pasa descarga, SHA, reparación, indexación, búsqueda y reapertura. La referencia estadística independiente pasa 17.010 comparaciones. Siguen pendientes la paridad completa ONNX/PyTorch, IA de visión actual, paquetes actuales y ejecución de los cinco runners; no se declara compatibilidad comprobada por compilar. Ver `V1_IMPLEMENTATION.md` y la evidencia local indicada allí. Las cifras históricas inferiores se conservan como historial.

**Revisión conjunta ejecutada el 12 de noviembre de 2026:** filtros/ordenamientos, nuevo orden de pestañas y concordancia están cubiertos por la suite actual. **86/86 pruebas**, typecheck, lint, build, E2E de código fuente y paquetes macOS ARM64; x64 pasa todo salvo IA real. Ver [VERIFICATION.md](VERIFICATION.md) y [PENDING_REVIEW.md](PENDING_REVIEW.md).

**Revisión independiente del 12 de noviembre de 2026:** [VERIFICATION.md](VERIFICATION.md) recoge los fallos encontrados y corregidos por Codex, la suite ampliada de **86 pruebas**, los recorridos nuevos de interfaz, la inferencia real y los límites pendientes. Esa revisión prevalece sobre las cifras y afirmaciones históricas que siguen. Los artefactos solo se consideran actuales si figuran como reconstruidos y probados en ese informe.

Actualizado el **9 de noviembre de 2026** tras ejecutar la suite, el lint, la prueba E2E y la validación con pesos reales en un Apple M2 (16 GB, macOS ARM64, CPU), más macOS x64 bajo Rosetta y paquetes Linux ARM64/x64 en Docker. El encargo completo **no se declara terminado**: hay capacidades verificadas, capacidades integradas con límites y plataformas sin ejecutar.

## Cambios de alcance confirmados

- APIs opcionales para descripción y clasificación, con credenciales cifradas propias de Imago; local sigue siendo el modo inicial.
- Lugares: el mismo catálogo GeoNames local de genealogía; sugerencias sin conexión, texto propio, coordenadas manuales y mapa OpenStreetMap pequeño/ampliable. Ver la actualización de cobertura en `docs/VERIFICATION.md` y ejecutar `npm run test:places:e2e`.
- Nueva vista **Mapa** en cada base: registros de toda la base, filtros, selector de propiedad de ubicación, agrupación por proximidad/zoom, miniaturas, apertura de fichas y consulta de registros sin coordenadas. Prueba específica: `npm run test:map:e2e`.
- LFM3-VL-2B y EmbeddingGemma 2 como modelos principales, sin otro Gemma generativo.
- Clasificación de propiedades y columnas completas con contexto, instrucciones y fuentes de imagen de Nodus.
- Encabezado, sidebar, Inicio y Ajustes siguiendo las capturas de Nodus proporcionadas. Icono propio en la posición de la N; navegación simplificada, panel de ajustes por categorías y proveedores desplegables.
- Varias colas simultáneas, visibles desde el header, con pausa individual y límite de trabajos configurable. La selección de Búsqueda permanece como área independiente del encargo original.

## Evidencia de la ejecución inicial (9 de noviembre)

La validación posterior y las ampliaciones de lugares/vista Mapa están documentadas en [VERIFICATION.md](VERIFICATION.md): 69 pruebas en macOS ARM64, E2E general y pruebas específicas de lugares y mapa. La tabla siguiente conserva la evidencia histórica; no acredita que las vistas nuevas se hayan probado en Linux o Windows.

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| `npm run typecheck` | pasa | TypeScript estricto sin errores |
| `npm run lint` | pasa | ESLint 9, sin errores ni avisos |
| `npm test` | **58/58** | Electron real, `test-results/unit/` |
| `npm run test:e2e` | pasa | CSV, columna de destino, fórmula, HEIC/HEIF, icono adaptativo, imágenes, tabla/galería, búsqueda, ficha, exportación, equivalencias, tema y reinicio; capturas `test-results/01..09` |
| E2E sobre app empaquetada macOS ARM64 | pasa | `IMAGO_E2E_EXECUTABLE` sobre `release/mac-arm64/Nodus Imago.app` |
| E2E desde el DMG montado | pasa | `release/Nodus-Imago-0.1.0-arm64.dmg` montado en solo lectura |
| E2E Linux ARM64 empaquetado | pasa | AppImage/DEB/RPM en Docker arm64 con Xvfb; incluye HEIC |
| E2E Linux x64 empaquetado | pasa | AppImage/DEB/RPM en Docker amd64 (QEMU) con Xvfb; incluye HEIC |
| E2E macOS Intel (x64) | pasa | app x64 bajo Rosetta, con sharp-darwin-x64 y better-sqlite3 x64 |
| Windows x64 bajo Wine 11 | smoke pasa | app x64 abre, crea una base y un registro vía UI/IPC; captura `test-results/windows-wine-smoke.png`; **no es Windows nativo** |
| Instalador Windows x64 | construido | `release/Nodus-Imago-0.1.0-x64.exe`; NSIS, binario nativo ABI 148; instalador no ejecutado |
| `node scripts/validate-models.mjs` | **pasa** | [real-models-macos-arm64.json](benchmarks/real-models-macos-arm64.json) |
| HEIC/HEIF | decodificación WASM y miniatura | fixture sintético 96×64; foto real 5712×4284 |
| EmbeddingGemma 2 real | 512 dims, CPU FP32, 3 imágenes indexadas, texto/imagen/híbrida | `semanticIndexed: 3`, consultas con el resultado esperado |
| LFM3-VL-2B real | descripción, clasificación y dos celdas en un mismo pool | propuestas con modelo/revisión/instrucciones; JSON válido y sin razonamiento en el valor |
| Concurrencia real | 2 trabajos iniciados; pausa de uno; el otro termina; reanudación; dos sesiones de chat LFM3 reutilizadas | `results.concurrency`, `results.multiCell` |
| Persistencia real | cierre y reapertura; 3 filas, 3 imágenes, 3 vectores y valores aceptados | `results.persistence` |
| `npm run benchmark` | pasa | [local.json](benchmarks/local.json), 10.000 registros sintéticos |

Medidas reales de referencia (Apple M2, 16 GB, CPU, 512 dimensiones, corpus de tres imágenes, 9 de noviembre de 2026): indexación en frío 19,6 s; consulta textual en caliente 93 ms; consulta por imagen 3,0 s; texto+imagen 3,4 s; descripción 9,6 s; clasificación 8,5 s; dos celdas de descripción en un mismo pool 12,0 s; consulta tras reabrir 7,0 s (varían con la carga del equipo). No son un benchmark de calidad ni de 10.000 fotografías reales.

## Correcciones de la auditoría y de la revisión posterior

- Los filtros y el orden de `unique_id`, `created_time` y `last_edited_time` usan ahora el valor mostrado (celda almacenada o valor calculado), no una celda inexistente.
- Crear una columna de fórmula calcula las filas existentes; borrar filas recalcula fórmulas de tabla y limpia el historial huérfano.
- Restaurar una copia admite historial de trabajos completados y sustituye vectores/búsquedas huérfanas sin colisiones de claves.
- `pauseAll` es atómico: no arranca un trabajo en espera mientras pausa los demás. Un trabajo con algún fallo queda en `failed` y se puede reanudar.
- CSV: los checkbox aceptan `1/0`, `sí/no`, `true/false`; un valor desconocido detiene la importación en vez de convertirse silenciosamente en falso. La exportación conserva números negativos y neutraliza fórmulas.
- Las miniaturas y vistas previas se escriben de forma atómica; al borrar o mover imágenes se normalizan las posiciones y la imagen principal.
- Se corrigieron el título del diálogo de renombrado, la navegación de «Bases de datos» a la lista, el icono de tema, el contador de colas con historial y el acceso a Ajustes en inglés.
- LFM3 usa ahora un pool de sesiones de chat persistentes: no recarga el modelo por celda, limita las imágenes con `--image-max-tokens 280` y fuerza JSON con `--json-schema` en clasificación. Se validaron dos celdas seguidas y el sobre `minimax:tool_call`.
- La importación de imágenes permite elegir una propiedad de adjuntos existente; el registro puede mover todas sus imágenes de una vez y el repositorio borra o reasigna lotes de forma atómica.
- El editor de fórmulas incorpora operaciones, estadísticas de columna y expresiones validadas; las recetas importadas que aún no se editan se conservan intactas y se muestran como solo lectura.
- Ajustes permite crear grupos de campos equivalentes entre bases y Búsqueda puede filtrar por el grupo con semántica OR; las columnas no emparejadas conservan su comportamiento.
- Las páginas Markdown de un ZIP de Notion se importan como texto plano, con su carpeta de origen, relación «Página padre» e imágenes referenciadas. La jerarquía de carpetas queda enlazada y las bases con relación a sí mismas muestran una vista «Árbol»; no se reconstruye el árbol de bloques.
- El paquete macOS x64 incluía por error sharp arm64 y no abría ventana; se reconstruyó con sharp-darwin-x64 y better-sqlite3 ABI 148, y se validó con E2E bajo Rosetta y desde el DMG.
- El icono de la app usa la N canónica de Nodus dentro de un objetivo fotográfico; hay variantes clara y oscura y el Dock de macOS se actualiza al cambiar el tema. El E2E comprueba que el PNG persistido cambia entre modos.

## Fases

| Fase | Estado |
| --- | --- |
| 1. Núcleo e interfaz | Aplicación Electron ejecutable, SQLite real, temas de Nodus y composición especializada; probada en macOS ARM64 |
| 2. Importación y gestión | CSV con mapeo de nombres/tipos, Nodus SQLite de solo lectura, Notion CSV+imágenes+páginas Markdown, columna de destino, opciones editables, tabla/galería/ficha y asociación; pruebas unitarias y E2E |
| 3. Búsqueda literal | FTS5, frases, fragmentos, ámbito de varias bases, filtros por esquema, equivalencias de campos, orden y búsquedas guardadas; probado |
| 4. Motor multimodal | EmbeddingGemma 2 real, indexación incremental, búsqueda por texto/imagen, texto+imagen y RRF; **validado en macOS ARM64/CPU con tres imágenes** |
| 5. Descripción/clasificación | LFM3 real con pool persistente y JSON schema, SmolVLM2 integrado sin pesos, APIs por contrato, propiedades con modelo/instrucciones, cola por columnas, revisión y deshacer; **validado localmente con LFM3** |
| 6. Rendimiento/distribución | Benchmark sintético de 10.000 registros, pruebas, DMG/ZIP macOS ARM64 y x64, AppImage/DEB/RPM Linux ARM64 y x64, NSIS Windows x64. macOS ARM64, macOS x64 y Linux ARM64/x64 ejecutados con E2E; Windows x64 con smoke bajo Wine, sin Windows nativo |

## Criterios del encargo original

1. **Instaladores para todos los sistemas:** macOS ARM64 está construido, empaquetado y probado con E2E (incluido el DMG montado). macOS Intel x64 está construido como DMG/ZIP con dependencias x64 aisladas (`npm run dist:mac:x64`) y **probado con E2E bajo Rosetta**. Linux ARM64 y Linux x64 están construidos (AppImage, DEB y RPM) y **probados con E2E empaquetado** en Docker con Xvfb. Windows x64 está construido como NSIS con el binario nativo ABI 148 y ha superado un smoke bajo Wine 11 (UI, SQLite, IPC, creación de base/registro), pero **no se ha ejecutado en Windows nativo ni se ha probado el instalador**. La configuración y matriz de CI existen para las variantes restantes. Firma y notarización pendientes; los artefactos no están firmados ni notarizados.
2. **Base con propiedades, multi-select y adjuntos:** probado. Alta masiva de hasta 1.000 registros vacíos desde la UI. El editor de texto enriquecido conserva Markdown, ofrece barra de formato y vista previa segura; no es un editor WYSIWYG completo.
3. **Imágenes y vinculación masiva:** probado con archivos y lotes pequeños, importación directa a un registro desde tabla/galería, columna de destino y movimiento de todas las imágenes de un registro; el benchmark de 10.000 registros es sintético y no incluye originales fotográficos. Faltan campañas con 10.000 fotografías reales y equipos modestos.
4. **Tabla y galería:** probadas en Electron. Paginación de 100 evita cargar la colección completa en la UI; no se afirma virtualización infinita.
5. **Descargar y ejecutar EmbeddingGemma 2:** descarga verificada y ejecución real en macOS ARM64/CPU con Sentence Transformers 6.2 y `torchvision` 0.29.2. El entorno Python es externo al instalador.
6. **Indexar y recuperar semánticamente:** probado con tres imágenes y consultas españolas; la calidad y el rendimiento con corpus grandes no están medidos.
7. **Consulta por imagen:** probada con una imagen temporal que no se incorpora a la colección.
8. **Texto+imagen, filtros y varias bases:** combinación de vectores, fusión RRF y filtros probados; la validación real usó una sola base y tres imágenes.
9. **Búsqueda literal sin modelos:** probada.
10. **Privacidad/offline:** el núcleo funciona sin modelos; el renderer bloquea HTTP(S) y el runtime Python bloquea sockets. La inferencia real se ejecutó con archivos locales. No se ha hecho una prueba de red a nivel de sistema operativo (cortafuegos/aviones).
11. **Reapertura/persistencia:** probada para registros, FTS, preferencias, tareas y vectores; la validación real cierra y reabre el servicio y vuelve a recuperar. Los trabajos pausados se reanudan. El pool reutiliza el modelo dentro del proceso; tras reiniciar la aplicación el proceso de visión se vuelve a cargar una sola vez por sesión.
12. **Exportación/interoperabilidad:** CSV/JSON/XLSX y copia nativa `.imago` implementados; restauración con IDs, opciones, relaciones, originales y vectores probada. Notion ZIP incorpora tablas, imágenes y páginas Markdown como texto plano. Exportar a Nodus mediante un paquete nativo bidireccional sigue pendiente; los formatos tabulares son compatibles.

## Límites explícitos

- HEIC/HEIF se admite con `heic-decode`/`libheif-js` (WASM) antes de sharp, porque el `libheif` nativo de sharp 0.35.5 no incluye el decodificador HEVC. El EXIF del contenedor se extrae con ExifReader (Make, Model, fechas, GPS y orientación). El WASM añade ~9 MB al paquete y decodifica en CPU; no se ha medido una carpeta completa de HEIC. JPEG/PNG/WebP/TIFF/BMP conservan su ruta nativa.
- La importación Notion incorpora las páginas Markdown como texto plano con carpeta, imágenes y relación padre; la vista Árbol muestra relaciones de la base consigo misma, pero no reconstruye bloques, bases embebidas ni formato enriquecido. Los CSV no contienen IDs de opciones, fórmulas ni relaciones tipadas.
- Rollups, comparaciones, botones y automatizaciones avanzadas de Nodus se conservan como configuración/datos cuando se importan, pero no se ofrecen como servicios equivalentes activos. Las relaciones externas de otros vaults no se resuelven.
- El editor de fórmulas permite aritmética, estadísticas de columna y expresiones seguras. Las recetas importadas de condicionales, concatenaciones y otras variantes se conservan sin edición visual; no se ha replicado todo el editor de Nodus.
- Las equivalencias de campos se configuran para columnas de texto y se filtran con semántica OR; no se infieren automáticamente ni abarcan opciones tipadas de selección.
- Se guardan consultas textuales y filtros; una imagen temporal de consulta no se incluye en una búsqueda guardada.
- Las traducciones principales ES/EN cubren la navegación y muchos controles, pero varias superficies nuevas conservan textos españoles y faltan los demás idiomas de Nodus.
- `sqlite-vec` y HNSW aún no tienen un benchmark comparativo; se usa un escaneo vectorial exacto en el worker como línea base.
- Las APIs se verifican con pruebas de contrato inyectadas. No se han probado llamadas facturables ni claves reales del usuario.
- El model manager está validado con los archivos ya descargados y verificados; no se ha medido la descarga completa sobre una conexión lenta ni la reanudación tras un corte de red real.
- Se ha validado macOS ARM64, Linux ARM64 y Linux x64/CPU; EmbeddingGemma 2 también se probó en Metal/MPS con texto e imagen. No CUDA, hardware Intel nativo ni Windows nativo. SmolVLM2 256M y 500M se ejecutaron en CPU; la descripción en inglés fue correcta en ambos, pero la calidad en español de 500M no es fiable y no se ha medido. macOS x64 se ejecutó bajo Rosetta; Windows x64 se ejecutó solo bajo Wine 11 y su instalador no se ha probado. El motor llama.cpp solo se ha ejecutado en macOS ARM64.
- La inferencia real se ha probado con tres imágenes de fixtures, no con un corpus fotográfico heterogéneo. No se han inventado métricas de precisión, sesgo o calidad.
- LFM3 usa un pool persistente de `llama-mtmd-cli` en modo chat, con un máximo por perfil y cierre por inactividad. La validación mide dos celdas consecutivas en 12,0 s, pero no una columna completa de miles de celdas ni un corpus de 10.000 fotografías. El tope de 280 tokens visuales puede reducir detalles en imágenes muy densas.

## Inicio de la primera versión sin Python obligatorio

Base de trabajo `ce8f33a`, misma rama y carpeta. La fase 0 corrige runtime no atómico, originales huérfanos al fallar una restauración, preflight de ZIP, apertura HTTPS de Markdown y autorización de endpoints con claves. Suite anterior a la migración: 89/89, typecheck, lint, build, E2E general y auditoría pasan. Ver seguimiento en `AUDIT-2026-11-12.md`.

Por nueva instrucción del usuario, las implementaciones restantes se acumulan antes de la siguiente pasada de pruebas. ONNX multimodal, alternativa Intel, onboarding, matriz de cinco runners y funcionalidades de fase 2 **no se consideran implementados ni verificados todavía**. Python sigue siendo necesario en la arquitectura actual hasta completar la migración. No se ha creado una release.
