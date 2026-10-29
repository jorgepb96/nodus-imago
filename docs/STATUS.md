# Estado verificable y trabajo pendiente

Actualizado el **29 de octubre de 2026** tras ejecutar la suite, la prueba E2E y la validación con pesos reales en un Apple M2 (16 GB, macOS ARM64, CPU). El encargo completo **no se declara terminado**: hay capacidades verificadas, capacidades integradas con límites y plataformas sin ejecutar.

## Cambios de alcance confirmados

- APIs opcionales para descripción y clasificación, con credenciales cifradas propias de Imago; local sigue siendo el modo inicial.
- LFM3-VL-2B y EmbeddingGemma 2 como modelos principales, sin otro Gemma generativo.
- Clasificación de propiedades y columnas completas con contexto, instrucciones y fuentes de imagen de Nodus.
- Encabezado, sidebar, Inicio y Ajustes siguiendo las capturas de Nodus proporcionadas. Icono propio en la posición de la N; navegación simplificada, panel de ajustes por categorías y proveedores desplegables.
- Varias colas simultáneas, visibles desde el header, con pausa individual y límite de trabajos configurable. La selección de Búsqueda permanece como área independiente del encargo original.

## Evidencia de la última ejecución

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| `npm run typecheck` | pasa | compilación TypeScript estricta sin errores |
| `npm test` | **44/44** | Electron real, `test-results/unit/` |
| `npm run test:e2e` | pasa | CSV, imágenes, tabla/galería, búsqueda, ficha, exportación, tema y reinicio; capturas `test-results/01..07` |
| E2E sobre app empaquetada macOS ARM64 | pasa | `IMAGO_E2E_EXECUTABLE` sobre `release/mac-arm64/Nodus Imago.app` |
| E2E desde el DMG montado | pasa | `release/Nodus-Imago-0.1.0-arm64.dmg` montado en solo lectura |
| `node scripts/validate-models.mjs` | **pasa** | [real-models-macos-arm64.json](benchmarks/real-models-macos-arm64.json) |
| EmbeddingGemma 2 real | 512 dims, CPU FP32, 3 imágenes indexadas, texto/imagen/híbrida | `semanticIndexed: 3`, consultas con el resultado esperado |
| LFM3-VL-2B real | descripción y clasificación, vocabulario permitido | propuestas con modelo/revisión/instrucciones; sin razonamiento en el valor |
| Concurrencia real | 2 trabajos iniciados; pausa de uno; el otro termina; reanudación | `results.concurrency` |
| Persistencia real | cierre y reapertura; 3 filas, 3 imágenes, 3 vectores y valores aceptados | `results.persistence` |
| `npm run benchmark` | pasa | [local.json](benchmarks/local.json), 10.000 registros sintéticos |

Medidas reales de referencia (Apple M2, 16 GB, CPU, 512 dimensiones, corpus de tres imágenes): indexación en frío 39,1 s; consulta textual en caliente 152 ms; consulta por imagen 7,3 s; texto+imagen 8,4 s; descripción 24,6 s; clasificación 21,1 s; consulta tras reabrir 7,7 s (varían con la carga del equipo). No son un benchmark de calidad ni de 10.000 fotografías reales.

## Correcciones de la auditoría del 29 de octubre

- Los filtros y el orden de `unique_id`, `created_time` y `last_edited_time` usan ahora el valor mostrado (celda almacenada o valor calculado), no una celda inexistente.
- Crear una columna de fórmula calcula las filas existentes; borrar filas recalcula fórmulas de tabla y limpia el historial huérfano.
- Restaurar una copia admite historial de trabajos completados y sustituye vectores/búsquedas huérfanas sin colisiones de claves.
- `pauseAll` es atómico: no arranca un trabajo en espera mientras pausa los demás. Un trabajo con algún fallo queda en `failed` y se puede reanudar.
- CSV: los checkbox aceptan `1/0`, `sí/no`, `true/false`; un valor desconocido detiene la importación en vez de convertirse silenciosamente en falso. La exportación conserva números negativos y neutraliza fórmulas.
- Las miniaturas y vistas previas se escriben de forma atómica; al borrar o mover imágenes se normalizan las posiciones y la imagen principal.
- Se corrigieron el título del diálogo de renombrado, la navegación de «Bases de datos» a la lista, el icono de tema, el contador de colas con historial y el acceso a Ajustes en inglés.

## Fases

| Fase | Estado |
| --- | --- |
| 1. Núcleo e interfaz | Aplicación Electron ejecutable, SQLite real, temas de Nodus y composición especializada; probada en macOS ARM64 |
| 2. Importación y gestión | CSV con mapeo de nombres/tipos, Nodus SQLite de solo lectura, Notion CSV+imágenes, opciones editables, tabla/galería/ficha y asociación; pruebas unitarias y E2E |
| 3. Búsqueda literal | FTS5, frases, fragmentos, ámbito de varias bases, filtros por esquema, orden y búsquedas guardadas; probado |
| 4. Motor multimodal | EmbeddingGemma 2 real, indexación incremental, búsqueda por texto/imagen, texto+imagen y RRF; **validado en macOS ARM64/CPU con tres imágenes** |
| 5. Descripción/clasificación | LFM3 real, SmolVLM2 integrado sin pesos, APIs por contrato, propiedades con modelo/instrucciones, cola por columnas, revisión y deshacer; **validado localmente con LFM3** |
| 6. Rendimiento/distribución | Benchmark sintético de 10.000 registros, pruebas, DMG macOS ARM64. macOS Intel, Windows y Linux: configuración/CI, no ejecución |

## Criterios del encargo original

1. **Instaladores para todos los sistemas:** solo macOS ARM64 está construido y probado (DMG + E2E sobre la app empaquetada). macOS Intel, Windows x64 y Linux x64 (DEB/RPM/AppImage) tienen configuración de electron-builder y matriz de CI, pero **no se han ejecutado en este entorno**. Firma y notarización pendientes.
2. **Base con propiedades, multi-select y adjuntos:** probado. El editor de texto enriquecido muestra y conserva el valor textual; no incorpora un editor de formato completo.
3. **Imágenes y vinculación masiva:** probado con archivos y lotes pequeños; el benchmark de 10.000 registros es sintético y no incluye originales fotográficos. Faltan campañas con 10.000 fotografías reales y equipos modestos.
4. **Tabla y galería:** probadas en Electron. Paginación de 100 evita cargar la colección completa en la UI; no se afirma virtualización infinita.
5. **Descargar y ejecutar EmbeddingGemma 2:** descarga verificada y ejecución real en macOS ARM64/CPU con Sentence Transformers 6.2 y `torchvision` 0.29.2. El entorno Python es externo al instalador.
6. **Indexar y recuperar semánticamente:** probado con tres imágenes y consultas españolas; la calidad y el rendimiento con corpus grandes no están medidos.
7. **Consulta por imagen:** probada con una imagen temporal que no se incorpora a la colección.
8. **Texto+imagen, filtros y varias bases:** combinación de vectores, fusión RRF y filtros probados; la validación real usó una sola base y tres imágenes.
9. **Búsqueda literal sin modelos:** probada.
10. **Privacidad/offline:** el núcleo funciona sin modelos; el renderer bloquea HTTP(S) y el runtime Python bloquea sockets. La inferencia real se ejecutó con archivos locales. No se ha hecho una prueba de red a nivel de sistema operativo (cortafuegos/aviones).
11. **Reapertura/persistencia:** probada para registros, FTS, preferencias, tareas y vectores; la validación real cierra y reabre el servicio y vuelve a recuperar. Los trabajos pausados se reanudan; los modelos no se recargan entre procesos.
12. **Exportación/interoperabilidad:** CSV/JSON/XLSX y copia nativa `.imago` implementados; restauración con IDs, opciones, relaciones, originales y vectores probada. Exportar a Nodus mediante un paquete nativo bidireccional sigue pendiente; los formatos tabulares son compatibles.

## Límites explícitos

- **HEIC/HEIF no se admite.** El `libheif` de sharp 0.35.5 abre el contenedor, pero no incluye el decodificador HEVC (`libde265`). Un HEIC real generado con macOS 768×768 falló al generar la miniatura con `Support for this compression format has not been built in: HEVC`. Se retiró de las extensiones aceptadas para no prometer una importación que no puede completarse. JPEG/PNG/WebP/TIFF/BMP sí tienen ruta real.
- La importación Notion no incorpora documentos Markdown de páginas ni reconstruye información que su CSV no contiene.
- Rollups, comparaciones, botones y automatizaciones avanzadas de Nodus se conservan como configuración/datos cuando se importan, pero no se ofrecen como servicios equivalentes activos. Las relaciones externas de otros vaults no se resuelven.
- El editor de fórmulas permite aritmética; se reutiliza el evaluador de Nodus, pero no todo su editor avanzado de expresiones, estadísticas y condicionales.
- Se admite filtrado por columnas concretas de cada base; faltan equivalencias configurables entre esquemas heterogéneos.
- Se guardan consultas textuales y filtros; una imagen temporal de consulta no se incluye en una búsqueda guardada.
- Las traducciones principales ES/EN cubren la navegación y muchos controles, pero varias superficies nuevas conservan textos españoles y faltan los demás idiomas de Nodus.
- `sqlite-vec` y HNSW aún no tienen un benchmark comparativo; se usa un escaneo vectorial exacto en el worker como línea base.
- Las APIs se verifican con pruebas de contrato inyectadas. No se han probado llamadas facturables ni claves reales del usuario.
- El model manager está validado con los archivos ya descargados y verificados; no se ha medido la descarga completa sobre una conexión lenta ni la reanudación tras un corte de red real.
- No se ha validado Metal/MPS, CUDA, macOS Intel, Windows ni Linux. El motor llama.cpp solo se ha ejecutado en macOS ARM64. SmolVLM2 está integrado pero no se han descargado ni ejecutado sus pesos.
- La inferencia real se ha probado con tres imágenes de fixtures, no con un corpus fotográfico heterogéneo. No se han inventado métricas de precisión, sesgo o calidad.
- Cada celda LFM3 lanza un proceso `llama-mtmd-cli` y vuelve a cargar el modelo. La validación mide una celda por columna; procesar una columna completa es funcional, pero no tiene rendimiento medido y necesitará reutilizar el proceso para producción.
