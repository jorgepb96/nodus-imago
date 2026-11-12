# Verificación independiente de Codex — 12 de noviembre de 2026

## Validación conjunta iniciada el 13 de noviembre de 2026

- `npm run verify`: 100/100, typecheck, ESLint y build correctos (`test-results/v1-final-verify.log`). Se corrigieron dos errores de tipos y el acceso a ref durante render antes de obtener este resultado.
- Recorridos general, auditoría de nueve grupos, lugares, mapa, criterios y concordancia correctos (`v1-final-desktop.log`). El nuevo recorrido de fase 2 pasa por separado (`phase2-e2e.json`): formato visual, bloques anidados, regla creada/activada/ejecutada desde la interfaz y propagación de rollups. Se corrigió un selector del nuevo test, sin cambiar el comportamiento de la app.
- ONNX Q8 real, perfil limpio `test-results/v1-onboarding-native-20261113`, Python configurado a una ruta inexistente: descarga explícita 541.790.748 bytes Apache-2.0, SHA, cancelación/reanudación, corrupción de igual tamaño y reparación, indexación, consulta textual/imagen, cierre y reapertura. Dos imágenes, 23.114 ms de indexación; máximo RSS observado 1.132.986.368 bytes en 23 muestras de un segundo. No es un benchmark de calidad ni un pico exhaustivo (`v1-onboarding-e2e.json`).
- Referencia estadística externa: 180 casos, 17.010 comparaciones, tolerancia 1e-9, correcta (`v1-final-reference.log`).
- Pendiente al registrar esta nota: paridad ONNX/PyTorch completa, paquetes actuales, IA x64 y cinco runners. Los resultados nuevos prevalecen sobre declaraciones históricas de compatibilidad.

## Resultados finales de la revisión conjunta (12 de noviembre de 2026)

La pasada pendiente se ha ejecutado sobre el árbol actual:

- `npm run typecheck`, `npm run lint`, `npm run build` y `npm run verify`: pasan.
- `npm test`: **86/86 pruebas**, sin omitidas.
- E2E general, auditoría de 9 grupos, lugares, mapa, IA real, criterios/filtros y concordancia: pasan desde el código fuente.
- Referencia estadística independiente: **180 casos y 17.010 comparaciones**, tolerancia 1e-9, pasa.
- Benchmark de concordancia con 10.000 registros: pasa; el benchmark general de 10.000 registros también pasa.
- `npm audit` y `npm audit --omit=dev`: **0 avisos**.
- Paquete macOS ARM64 actual: pasan general, auditoría, lugares, mapa, criterios, concordancia e IA real.
- Paquete macOS x64 actual bajo Rosetta: pasan general, auditoría, lugares, mapa, criterios y concordancia. La IA real x64 no se declara pasada: el store de modelos compartido solo contiene el runtime llama.cpp ARM64; al preparar un runtime x64 el proceso se cerró durante la indexación y no se investigó más.

Quedan fuera de esta validación Windows nativo, los instaladores Linux actuales, la IA x64, APIs facturables, CUDA, la calidad con corpus real y la firma/notarización. Los límites de las secciones siguientes se conservan como historia y contexto, pero las cifras antiguas de pruebas no describen el árbol actual.

Repositorio: `/Users/jorgepb96/Documents/GitHub/nodus-imago`, rama `codex/imago-desktop`. Base revisada: `24e2df2`. La revisión incorpora correcciones posteriores a ese commit; no se ha publicado ni enviado ningún cambio al remoto. Nodus principal se ha consultado en modo de lectura.

La implementación de DeepSeek **tenía fallos reproducibles pese a pasar su suite anterior**. Se han corregido los siguientes casos y añadido pruebas que recorren las rutas afectadas. Esto no constituye una garantía de ausencia de cualquier defecto ni una validación de todas las plataformas y modelos posibles.

## Hallazgos corregidos

| Prioridad | Fallo observado | Corrección y evidencia |
| --- | --- | --- |
| P1 | Guardar o encolar una columna de selección existente enviaba `columnId` y `position` como parte de las opciones; el IPC estricto lo rechazaba. | El editor envía solo `id`, `label` y `color`. La auditoría de interfaz encola una columna con opciones y conserva los valores humanos. |
| P2 | El editor de expresiones exigía un operando que solo corresponde a las recetas aritméticas. | Las expresiones se validan por su propio AST. Se crea una expresión desde la UI y se comprueba su resultado. |
| P2 | Añadir registros, individualmente o por lotes, dejaba las fórmulas vacías hasta otra edición. | Se calculan e indexan al crear las filas. Regresión en `tests/core.test.ts`. |
| P1 | HEIC se importaba y mostraba, pero se entregaba sin convertir a Pillow/llama.cpp; fallaba la inferencia. Otros formatos y la orientación EXIF dependían del codec del runtime. | Ambos motores reciben un PNG RGB orientado de hasta 2.200 px. Las imágenes temporales se eliminan incluso tras un fallo. Indexación, consulta y descripción con un HEIC fotográfico real; regresiones de orientación y limpieza. |
| P1 | La restauración conserva originales por hash, sin extensión; HEIC y BMP perdían su decoder específico al reconstruir las vistas. | Detección por cabecera además del nombre. Regresión con ambos originales sin extensión. |
| P2 | Pausar las colas no permitía cambiar sus ajustes, pese al mensaje de la aplicación. | Se permite reconfigurar cuando no queda trabajo ejecutándose o en espera, tras resolver las peticiones interrumpidas. Las tareas pausadas se conservan; los índices mantienen su contrato. |
| P1 | Una restauración que fallaba después de leer la copia podía borrar búsquedas, vectores e historial del destino antes del rollback. | Las sustituciones forman parte de la transacción. Una copia con una tabla ausente falla y conserva el estado previo del destino. |
| P2 | Volver a vincular un original no recuperaba la imagen en pantalla hasta reabrir la ficha. | La vinculación cambia una revisión persistente del recurso y refresca sus vistas. Prueba UI: archivo ausente → diálogo nativo → recuperación inmediata → movimiento → quitar asociación conservando el original. |
| P2 | LFM3 podía producir restos de un sobre de herramienta que el parser aceptaba como descripción. | Se rechazan los fragmentos incompletos. La regresión utiliza una salida observada en inferencia real sobre una imagen sintética. No se sustituye el resultado por texto inventado. |
| P2 | Aceptar una clasificación múltiple vacía (`[]`) junto a otros cambios impedía deshacer el lote. | El historial registra el valor normalizado escrito y omite los cambios sin efecto. Regresión de aceptación y deshacer. |
| P2 | La auditoría actual detectó `GHSA-g3hv-75wg-m249` en dependencias indirectas de producción y desarrollo. | Se fija `minimatch` 11.0.8 para las ramas afectadas, preservando las ramas antiguas con otra API. Se regeneran las resoluciones afectadas y se verifica una instalación limpia. `npm audit` y `npm audit --omit=dev`: cero avisos. |
| P2 | El icono del Dock dependía de una actualización desde el renderer y macOS podía conservar el recurso antiguo durante el arranque. | Se aplica y persiste el objetivo con la N antes de crear la ventana; el E2E verifica el icono en un perfil nuevo antes de cargar la UI, el recurso del paquete y las variantes clara/oscura. En Linux se sincronizan el nombre del launcher y el identificador de ventana. |

Se ha colocado también el aviso sobre imágenes temporales en el diálogo de **Guardar búsqueda**, donde corresponde. Las esperas asíncronas de la auditoría consultan ahora el IPC desde el proceso de pruebas; se corrigieron carreras que se manifestaban al ejecutar bajo Rosetta.

**Ajuste visual posterior, por indicación del usuario:** la marca dentro de la ventana es únicamente el objetivo circular y la N, sobre transparencia. El Dock y el icono de la aplicación de macOS conservan el fondo cuadrado claro/oscuro. El punto amarillo está centrado sobre un punto del aro (`r=326`), en ambos diseños. Los recursos actuales usan `icon-mark.svg` dentro de la ventana, caché `camera-lens-tile-v5` para el Dock y `nodus-imago-camera-lens-v5.icns` en el paquete. Se ha vuelto a ejecutar el E2E con comprobaciones de transparencia dentro de la ventana y opacidad del fondo en el Dock. Los paquetes macOS se han reconstruido para este ajuste; las pruebas funcionales de Linux anteriores no se repiten por este cambio gráfico.

El preprocesamiento de imágenes forma parte de un **nuevo contrato vectorial**. Los índices anteriores se conservan, pero no se mezclan con el nuevo contrato. Para una colección con vectores anteriores hay que volver a ejecutar **Indexar imágenes**; no se modifican sus originales ni sus anotaciones.

## Cobertura funcional

### Nueva vista Mapa por base de datos

La pestaña **Mapa** se añade junto a Galería/Tabla. Usa una propiedad de ubicación elegible por base (preferencia local del dispositivo) y obtiene **todos** los registros que cumplen los filtros, sin la paginación de la tabla. El IPC entrega únicamente identificadores, títulos, ubicaciones, referencia de miniatura y recuento de imágenes; no entrega originales ni metadatos completos. La lectura usa una transacción coherente y rechaza propiedades de otra base o de tipo diferente.

El mapa agrupa registros cercanos según el zoom, también los que comparten exactamente las mismas coordenadas. Solo crea marcadores para grupos del área visible. Cada grupo permite consultar sus registros con miniaturas y abrir la ficha original; al editar o quitar una ubicación, se refrescan puntos y recuentos. Un panel separado permite abrir registros sin coordenadas para completarlos. Se incluyen ajuste al contenido, acercamiento al grupo y búsqueda en la lista. Los puntos y la lista siguen disponibles sin conexión; el fondo usa las mismas teselas y restricciones de red documentadas anteriormente.

Validación histórica de esta ampliación: **69/69 pruebas** en su momento; la suite actual es **86/86** (resultados finales arriba). Se han vuelto a ejecutar el E2E general y el flujo del selector de lugares. La prueba nativa `npm run test:map:e2e` importa **235 registros**, sitúa 233 inicialmente, comprueba la imagen de un grupo de 232 registros coincidentes y un registro posterior a la primera página, abre/edita la ficha, verifica los filtros, cambia la propiedad de ubicación y recupera la preferencia tras recargar. También comprueba geometría de encuadre, enlaces de atribución, zoom sin apertura accidental del navegador, desconexión, fallo de tesela/reintento, ventana mínima, modo oscuro, base sin propiedad y mapa vacío.

La nueva prueba detectó una carrera preexistente: una respuesta pendiente de `getRow` podía volver a abrir una ficha cerrada después de editarla. Las respuestas ahora se cancelan/ignoran cuando ya no corresponden a la ficha abierta. También se ha restringido la apertura externa en ambos mapas al enlace de copyright de OSM; los controles de zoom no abren el navegador.

Las teselas y sus errores se simulan en el E2E (incluida inyección de un evento de error de imagen); no se hace navegación automatizada sobre el servicio público. La cobertura no certifica su disponibilidad real. Evidencia: `test-results/codex-map-source.json`, `codex-map-unit.log`, `codex-map-general-e2e.log`, `codex-map-places-regression.log` y capturas `codex-database-map*.png`.

### Ampliación posterior: lugares de imágenes

Se reutiliza el catálogo GeoNames comprimido de la genealogía de Nodus, idéntico byte a byte. Se ofrece autocompletado local (acentos, municipios homónimos, región y país), selección por ratón o teclado y entrada manual. Elegir una sugerencia conserva su identificador, contexto administrativo y coordenadas; cambiar el texto por un lugar propio elimina el marcador anterior, incluso si se elige explícitamente texto propio con el mismo nombre. La ficha muestra una vista cuadrada de 200 px con ampliación, zoom y desplazamiento. La tabla ofrece acceso al mapa. Hay edición opcional y validada de coordenadas.

La lista funciona sin conexión. Solo el mapa usa la red: teselas HTTPS de OpenStreetMap, identificador de aplicación y caché HTTP normal, atribución visible, sin descarga de áreas ni servicio de geocodificación externo. El resto de las solicitudes de red del renderer continúa bloqueado. Un fallo del mapa no altera los datos guardados. El catálogo es un extracto de ciudades/poblaciones de GeoNames, no una lista exhaustiva de todas las direcciones o parajes; se admite texto libre para esos casos.

Validación de esta ampliación en macOS ARM64: **67/67 pruebas** en su momento, TypeScript y ESLint sin errores, build correcto y `npm audit` con cero avisos. Pasan el E2E general y los nueve grupos de la auditoría. `npm run test:places:e2e` recorre sugerencias, selección, texto libre, cambio/limpieza de coordenadas, cero geográfico, mapa pequeño/ampliado, centrado real del marcador, atribución segura, falta de conexión, fallo del servicio/reintento, tabla, persistencia tras reinicio, exportación JSON estructurada, tema oscuro y ventana mínima de 1000×680.

El centrado se comprueba geométricamente en la ficha y en el diálogo ampliado: Leaflet se inicializa después de que el contenedor sea visible y tenga tamaño, evitando un marcador proyectado en una esquina al abrir un diálogo nativo. Las pruebas de interfaz usan teselas sintéticas interceptadas; no descargan ni recorren mapas del servicio público de OSM y no acreditan su disponibilidad en tiempo real. Evidencia: `test-results/codex-places-unit.log`, `codex-places-e2e.json`, `codex-places-packaged-e2e.log` y capturas `codex-places-*.png`.

El flujo específico de lugares pasa también sobre los paquetes macOS ARM64 y x64; este último se ejecuta bajo Rosetta. Se confirma la arquitectura desde el proceso de la aplicación (`darwin arm64` y `darwin x64`), incluida la persistencia tras reinicio. Evidencia: `test-results/codex-places-arm64-packaged.json` y `codex-places-x64-packaged.json`. Se han reconstruido los DMG/ZIP de ambas arquitecturas y actualizado sus hashes.

Los demás resultados multiplataforma de la tabla siguiente corresponden a la auditoría anterior. Los paquetes Linux conservan su compilación anterior, sin el nuevo selector de lugares.

Resultados de la auditoría general previa a la ampliación de lugares:

| Comprobación | Resultado |
| --- | --- |
| TypeScript, ESLint, build y pruebas en macOS ARM64 (histórico) | **64/64**, sin pruebas omitidas |
| E2E original y auditoría ampliada de 9 grupos en macOS ARM64 | Pasan desde el código y desde la app empaquetada |
| E2E desde el DMG ARM64 montado en solo lectura | Pasa, incluido el recurso de icono versionado y el icono de arranque |
| macOS Intel empaquetado bajo Rosetta | Pasan el E2E y los 9 grupos de la auditoría; el ejecutable informa `darwin x64` |
| Linux ARM64 en Docker/Xvfb | **63 pasan, 1 omisión** (HEIC fotográfico externo); E2E y 9 grupos pasan antes y después del empaquetado |
| Dependencias de producción y desarrollo | `npm audit`: **0 avisos** en ambas auditorías |
| Modelos principales reales | EmbeddingGemma 2 y LFM3 en CPU; servicio y UI empaquetada verificados |

Los instaladores reconstruidos son DMG/ZIP de macOS ARM64 y x64, y AppImage/DEB/RPM de Linux ARM64. Sus tamaños y SHA-256 están en [artifacts-codex.json](benchmarks/artifacts-codex.json). Los binarios Windows/Linux x64 anteriores a estas correcciones se conservan en `release/previous-unverified-2026-11-09/`; **no se presentan como versiones actuales**. Esa carpeta contiene también los blockmaps x64 antiguos, que no deben acompañar a los nuevos DMG/ZIP. El script Intel copia ahora los blockmaps de sus futuras compilaciones.

Los logs `test-results/codex-*.log`, el informe de IA `test-results/codex-real-ai-e2e.json` y `test-results/linux-arm64/` contienen la evidencia local. En los JSON de la auditoría, `arch` identifica al controlador Node; la arquitectura de la aplicación Intel se comprobó por separado con su propio ejecutable, no se infiere de ese campo.

| Área | Evidencia ejecutable |
| --- | --- |
| Bases y propiedades | Creación, renombrado/esquema, tipos y codecs, opciones/colores/orden, selección múltiple, fórmulas y estadísticas, relaciones y jerarquía. Suite de dominio y ambos recorridos de escritorio. |
| Edición | Tabla, ficha, fechas, hora, checkbox, URL, ubicación, Markdown con vista previa, relación entre registros y persistencia. `scripts/audit-e2e.mjs`. |
| Importación | CSV con mapeo y rechazo atómico de tipos inválidos; Nodus SQLite sin modificar el origen; ZIP de Notion con CSV, páginas, imágenes y relación padre. `tests/core.test.ts`, `tests/files.test.ts`, E2E nativo. |
| Imágenes | JPEG/PNG/WebP/TIFF/BMP/HEIC, hash, copia/vínculo, duplicados, varias imágenes, columna de destino, imagen principal, correspondencias seguras/ambiguas, movimiento, borrado de asociación y recuperación del original. |
| Búsqueda literal | FTS, palabras/frase/fragmento, acentos, filtros, AND/OR, varias bases, equivalencias, orden, paginación, búsqueda guardada y retorno desde la ficha. Tests de dominio y E2E. |
| Recuperación multimodal | EmbeddingGemma 2 real en CPU, 256/512/768 dimensiones, normalización, texto, imagen temporal, combinación e imágenes similares. Servicio real y recorrido renderer → IPC → worker → runtime en la app empaquetada. |
| IA generativa | LFM3 real, descripción y clasificación según opciones existentes, procedencia, propuestas, aceptación, rechazo, conflictos y deshacer. Protección de valores humanos. |
| Colas | Persistencia, pausa/reanudación/cancelación, exclusión por columna, capacidad según perfil/memoria y varias colas. Dos sesiones LFM3 reales; también endpoint HTTP local con pausa independiente desde la UI. |
| APIs | Contratos de proveedores con respuestas controladas y endpoint HTTP real en loopback, catálogo, imágenes en la petición, modelo por tarea/columna, opt-in remoto y abort. **No son llamadas a un proveedor comercial real.** |
| Credenciales y aislamiento | Cifrado nativo de una clave ficticia y eliminación en macOS; negativa a guardar sin almacén seguro en Linux; IPC rechaza comandos privados; renderer sin `require` y sin acceso HTTP al endpoint local de prueba. |
| Exportación y recuperación | CSV, JSON y XLSX; copia completa y restauración en otro perfil vacío; IDs, opciones, relaciones, imágenes, vectores, historial y búsquedas. Se conserva el destino ante una copia inválida. |
| Rendimiento | 10.000 registros y vectores sintéticos. Importación/FTS ~1,7 s; página literal mediana 14 ms, p95 17 ms; correspondencias 16 ms; RSS ~213 MB. No mide 10.000 fotografías reales. |

## Continuidad visual con Nodus

Se ha contrastado el código del tema con `/Users/jorgepb96/Documents/GitHub/nodus/src/theme/themes.mjs`: **las 16 definiciones y los tokens calculados son idénticos** (las diferencias de archivo son de formato).

Se han inspeccionado capturas reales de Inicio, galería, tabla, ficha, Ajustes, proveedores y colas, en claro y oscuro. La estructura conserva el encabezado de 44 px, sidebar de 228 px, navegación por categorías en Ajustes, proveedores desplegables, botones, bordes, tipografía y colores de la familia Nodus. El icono de Imago ocupa la posición de la N y la cola se abre desde el encabezado. La auditoría comprueba también la ventana mínima de 1.000 × 680 y el plegado del sidebar.

La consulta nativa de `NSWorkspace.icon(forFile:)` a la app reconstruida devuelve el objetivo con la N: `test-results/codex-macos-file-icon.png`. Esto comprueba la resolución del icono por macOS, además de los archivos de diseño y del cambio del Dock desde el código. No se reinició ni se modificó la configuración global del Dock.

Las capturas de la auditoría están en `test-results/codex-audit-*.png`; la revisión de propuestas de LFM3 real, en `test-results/codex-real-ai-proposals.png`. Son datos temporales de prueba, no colecciones del usuario.

## Reproducir

```sh
export PATH=/Users/jorgepb96/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run verify
npm run test:e2e
npm run test:audit
node scripts/validate-models.mjs
npm run test:ai:e2e
npm run benchmark
npm audit
npm audit --omit=dev
```

Las pruebas de IA son optativas: requieren el entorno `.venv`, `test-results/model-store.json` y los fixtures ya disponibles. Reutilizan los pesos autorizados; no descargan modelos ni escriben en la colección del usuario. `test:audit` levanta exclusivamente un endpoint de prueba en `127.0.0.1`.

Para ejecutar las pruebas sobre un binario, establecer `IMAGO_E2E_EXECUTABLE` a su ejecutable. `scripts/audit-linux.sh` prepara una copia aislada dentro de un contenedor Debian ARM64, compila los paquetes y ejecuta los recorridos antes y después del empaquetado; el repositorio se monta en solo lectura. En ese entorno, el fixture HEIC fotográfico externo se omite en la suite; el HEIC sintético versionado sí se prueba.

## Límites y criterio de cierre

- El instalador Windows no se ha ejecutado en Windows nativo durante esta revisión. Wine y una configuración de CI no sustituyen esa prueba.
- Los ejecutables Intel se prueban bajo Rosetta y Linux bajo Docker/Xvfb; no equivalen a hardware Intel/Linux nativo. Hay que distinguir las pruebas de esta revisión de las que documentó DeepSeek el 9 de noviembre.
- No se han hecho llamadas facturables, pruebas CUDA, evaluación de calidad con un corpus representativo, una columna generativa de miles de celdas ni una campaña con 10.000 fotografías reales.
- La instalación de Python y sus paquetes sigue siendo externa al instalador. El funcionamiento sin conexión de la inferencia está implementado y probado con archivos locales; no se ha ejecutado un aislamiento de red del sistema operativo completo.
- Los instaladores siguen sin firma/notarización. No se han publicado.
- La integración completa de rollups, automatizaciones y editores avanzados de Nodus, la exportación nativa bidireccional a Nodus y la reconstrucción del árbol de bloques de Notion siguen fuera de lo implementado. No son capacidades verificadas por esta revisión.
- El modelo puede equivocarse sobre una imagen. El paso obligatorio de propuestas y revisión preserva la distinción entre una sugerencia de IA y una anotación confirmada.

Las limitaciones anteriores impiden afirmar que **todo el objetivo original esté verificado al 100 %**. El cierre correcto se apoya en las pruebas ejecutadas y sus límites, no en esa garantía.

## Fase 0 previa a la migración de IA

Partiendo de `ce8f33a` limpio: suite inicial de 86 pruebas y nueva suite de **89/89**, typecheck, lint y build pasan. Las nuevas regresiones cubren espacio insuficiente, destino existente, esquema HTTPS, consentimiento del endpoint y recuperación de originales/runtime tras fallos. Pasan E2E general y nueve grupos de auditoría, ampliados con confirmación nativa ficticia de endpoint y apertura HTTPS interceptada. Logs: `test-results/v1-baseline-verify.log`, `v1-phase0-verify.log`, `v1-phase0-general.log`, `v1-phase0-audit.log`.

Las pruebas de la arquitectura ONNX y de los cinco targets quedan para la pasada final solicitada por el usuario. No hay evidencia nueva de compatibilidad multiplataforma todavía.
