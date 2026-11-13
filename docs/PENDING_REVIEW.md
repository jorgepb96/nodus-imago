# Cambios acumulados para revisión final

## Revisión vigente de fiabilidad — 13 de noviembre de 2026

Se han ampliado colas, copias y actualizaciones según el encargo reactivado. Suite local **164/164**, tipos, lint y build correctos; nueve recorridos de escritorio pasan en fuente. Restauración nativa entre tres perfiles, cifrado e integridad de originales y recuperación de cola con IA real sin Python comprobados. Ver [RELIABILITY-AUDIT-2026-11-13.md](RELIABILITY-AUDIT-2026-11-13.md) para cambios, evidencia y límites. La instalación entre releases firmadas queda reservada a la futura autorización de release. La nueva CI multiplataforma debe identificarse por su run; la CI histórica inferior corresponde al producto anterior.


## Estado vigente del candidato `6af64a0` — 13 de noviembre de 2026

Implementadas las fases 0, 1 y 2; retirado el aviso del sidebar y anclado Ajustes abajo (8 px observados). Suite local **103/103**, lint, tipos y build correctos. Los DMG/ZIP actuales de `release/v1-validation-6af64a0` pasan los siete recorridos cada uno; IA real empaquetada ARM64 también pasa sin Python. Evidencia: `final-local-packaged-e2e.log`, `final-local-packaged-ai.log`, manifiesto y SHA en esa carpeta. Son artefactos de prueba sin firma.

La auditoría autorizada de diez fotografías NASA y cinco modelos ha terminado: 100 respuestas reales, 96 propuestas admitidas y cuatro clasificaciones rechazadas correctamente. OpenRouter: **0,004380796 USD reportados**; Gemini: **0,001162600 USD estimados**, con máximo **1 USD independiente por API**. LFM3 y ONNX funcionan en CPU sin Python. Persistencia, procedencia, ensayos y exportación nativos correctos; estadísticas reales contrastadas con bibliotecas independientes a `1e-9`. Detalles, desacuerdos y límites en [AUTHORIZED-AI-AUDIT-2026-11-13.md](AUTHORIZED-AI-AUDIT-2026-11-13.md). No se inventa referencia humana ni se equipara cumplimiento de formato con precisión.

**CI final verde: 10/10 jobs**, [run 43363652116](https://github.com/jorgepb96/nodus-imago/actions/runs/43363652116), producto `6af64a0`. Pasan fuente, paquetes instalados/extraídos e IA real en macOS ARM64, macOS Intel, Windows x64, Linux x64 y Linux ARM64. Publicados diez artefactos de CI vigentes: cinco grupos de instaladores y cinco de evidencia CPU, todos de ese commit. La documentación posterior no cambia el producto probado. Resumen y metadatos descargados en `test-results/ci-final-{run,summary,artifacts}.json`.

Corrección del diagnóstico anterior: limpiar caché no resolvió las teselas en AppImage; el interceptor CDP no capturaba sus peticiones. La regresión aislada del paquete pasa al servir las teselas desde la sesión nativa de Electron, sin quitar aserciones (`scripts/map-tile-fixture.mjs`, run 43362233162). El run posterior pasó los siete recorridos AppImage de ambos Linux y detectó que `dpkg -i` no resolvía `libnotify4`; el instalador de pruebas ahora usa `apt-get install` del DEB para resolver sus dependencias. Los registros anteriores se conservan como historia y sus estados pendientes quedan subordinados a esta sección.

Se mantienen los límites autorizados: sin release pública, firma/notarización, CUDA ni corpus privado. RPM se extrae y ejecuta en Ubuntu; no se afirma instalación en una distribución RPM. El recordatorio de reanudación ya se disparó y fue eliminado; no hay seguimiento programado recurrente.


## Cierre de recorridos y recursos — 13 de noviembre

Run 43357893269: los cinco jobs de IA real empaquetada pasan. Desktop/instalador Windows NSIS y macOS ARM64 DMG/ZIP pasan completos. Intel pasó DMG y falló en ZIP una aserción que leía las pestañas antes de terminar la carga; Linux x64/ARM64 pasó fuente, construyó AppImage/DEB/RPM y falló en AppImage al no observar peticiones de teselas servidas desde caché. Se añaden espera de pestañas y limpieza de caché de la sesión de prueba antes de interceptar teselas; no se retira ninguna aserción. Se prepara otra ejecución para terminar esos instaladores.

Además de las 103 pruebas y los benchmarks sintéticos de 10.000 registros (`resumed-benchmark.log`, `resumed-research-benchmark.log`), pasan dos fallos nativos de onboarding sin mocks de inferencia: volumen HFS+ aislado de 128 MiB sin espacio para pesos (`disk-preflight-e2e.json`) y proxy local que deniega una conexión de descarga real (`network-preflight-e2e.json`). La interfaz impide preparar modelos con poco espacio; literal sigue funcionando. La descarga sin conexión conserva parciales y muestra instrucciones de reanudación. Se incorporan estos recorridos al job de IA (el volumen físico, solo macOS).

Localmente `release/v1-validation-bb0d76a` pasa todos los recorridos desde DMG de solo lectura y ZIP, e IA real empaquetada. El manifiesto y SHA están en esa carpeta; los artefactos no se presentan como release ni se suben a Git. La auditoría de APIs posterior continúa autorizada con 1 USD por proveedor; aún no se han hecho llamadas de inferencia facturables.

## Reanudación — 13 de noviembre, 04 h (Europe/Madrid)

El run [43328859188](https://github.com/jorgepb96/nodus-imago/actions/runs/43328859188) confirma inferencia real sin Python desde la app empaquetada en LOS CINCO targets: ONNX/LFM3 en macOS ARM64, Windows x64, Linux x64 y Linux ARM64; Harrier/LFM3 en Mac Intel. Desktop ARM64 completo también pasó. El run global no pasó: Windows encontró una carrera al reconstruir miniaturas compartidas tras restaurar, Linux falló una selección de texto del nuevo E2E y el paquete Intel produjo dos DMG por una arquitectura arm64 fijada en el target.

Corregidos: reconstrucción única por hash/variante con promesa compartida (regresión de concurrencia); targets macOS con arquitectura nativa/CLI; selección de texto con teclas de flecha, prueba de contenido Markdown que conserva negrita y guardado al salir con Escape. Se conserva el manejo previo de ciclos solo de fórmulas al calcular rollups y se ignoran bases no afectadas. `test-results/resumed-verify.log`: 103/103, tipos/lint/build correctos. `resumed-phase2.log`: recorrido ampliado correcto, incluyendo enlace visual y cierre inmediato de ficha. Falta la nueva CI de este árbol y los instaladores actuales; no se afirma cierre total.

La autorización posterior para auditoría externa es de 1 USD POR API (OpenRouter y Gemini), con límites separados. No cambia la prohibición de release/firma/CUDA. Las credenciales permanecen cifradas y fuera de Git.

**Evidencia adicional de CI (13 de noviembre):** el run 43326874728 pasa IA real desde aplicación empaquetada en macOS ARM64, Windows x64, Linux ARM64 y macOS Intel. Harrier Intel: 108.250 ms para dos imágenes mediante descripciones LFM3; máximo RSS observado del proceso de embeddings 1.671.184.384 bytes (51 muestras de un segundo, no memoria total de todos los procesos); consulta posterior 3.735 ms. No hace falta el fallback BGE-M3 para este recorrido. Evidencia descargada bajo `test-results/ci-first-*-evidence/` (ignorada en Git).

La suite completa de ese primer run NO pasa: referencia Python sin preparar, SQLite precompilado incompatible con glibc 2.35 en Ubuntu 22.04 y tres fixtures de Windows/Intel. Se corrigen mediante entorno estadístico de test explícito, compilación nativa SQLite con clang-15, nombres .exe en fixtures, fixture de descarga independiente del backend y desactivación de la caché de archivos libvips en Windows. Se prepara una nueva ejecución; no se presentan instaladores antiguos como actuales.

La revisión conjunta pendiente se ha ejecutado el 12 de noviembre de 2026. Resultado: **86/86 pruebas unitarias**, TypeScript, ESLint, build, E2E general, auditoría, lugares, mapa, IA real, criterios/filtros y concordancia pasan; la referencia estadística independiente y los benchmarks también pasan. Los únicos pendientes son los límites de plataforma indicados al final.

## Implementado desde la última tanda de pruebas

- Área **Concordancia** desde las tres vistas de la base: varios modelos/evaluadores y referencia humana independiente, categoría única o multietiqueta, cobertura, casos disponibles por pareja o completos para todos, normalización y equivalencias explícitas.
- Unanimidad, al menos uno/todos frente al humano, mayoría estricta, Cohen nominal y ordinal declarado, Fleiss y alfa nominal; Jaccard y kappa binario por categoría para multietiqueta. Wilson 95% para acuerdo exacto; indefinidos con motivo.
- Desglose por categoría, confusiones, precisión/sensibilidad/F1, revisión paginada de discrepancias con imágenes y apertura de la ficha original. Las modificaciones no alteran la instantánea.
- Ensayos persistentes con datos originales y procedencia, comparación de hasta cuatro, exportaciones JSON/CSV nativas y tabla opcional compatible con copias antiguas. Método y límites en [CONCORDANCE.md](CONCORDANCE.md). Pruebas estadísticas y de repositorio ejecutadas: pasan, incluida la referencia independiente de 180 casos y 17.010 comparaciones.
- Orden de pestañas: Tabla, Galería, Mapa; Árbol después, cuando existe.
- Botón único **Filtrar y ordenar**, con panel flotante y pestañas de filtros/ordenamientos.
- Selectores con buscador, estilo de Nodus, teclado, selección simple/múltiple, colores de opciones y sugerencias locales paginadas. También se aplican al selector de ubicación del mapa y al ámbito/tipo de coincidencia de Búsqueda.
- Condiciones por tipo, comparaciones negativas, rangos, fechas relativas, vacíos, imágenes, personas, relaciones y presencia de coordenadas. Los operandos incompletos permanecen pendientes. Se pueden desactivar y duplicar condiciones.
- Grupos Y/O hasta tres niveles; ordenamientos por varias propiedades, con prioridades, arrastre y botones de subir/bajar.
- Atajos alfabéticos, incorporación, modificación y recuento de imágenes; orden natural de identificadores, números y fechas; opciones por posición configurada; vacíos al final.
- Configuración local por base compartida entre Tabla, Galería y Mapa, restauración y retirada de referencias a propiedades eliminadas.
- Compilación SQL común antes de paginar; Mapa recibe también los ordenamientos para su lista sin recentrar por un cambio de orden. Catálogos de valores locales, sin API externa.
- Ordenamiento explícito tras recuperar candidatos semánticos/híbridos, manteniendo puntuaciones. Los candidatos y listas múltiples usan parámetros JSON para evitar límites de variables SQLite.
- Las altas, bajas, cambios de principal, revinculaciones y movimientos de imágenes actualizan las fechas de modificación de los registros afectados.

Referencia de interacción: [documentación oficial de Notion](https://www.notion.com/help/views-filters-and-sorts). Se adapta a las propiedades y al funcionamiento local de Imago, sin presuponer paridad con todo el servicio.

## Revisión conjunta pendiente

- Ejecutar `tests/agreement.test.ts` y contrastar índices con implementaciones de referencia en casos nominales, ordinales y multietiqueta; no usar cifras de investigaciones reales como salidas simuladas.
- Concordancia E2E: elegir columnas, taxonomías con UUID distintos, referencia independiente, configuración incompleta, alias y escalas, filtros anidados, más de 200 registros, excluir imágenes, cobertura, búsqueda/paginación y dos referencias humanas como evaluadores.
- Guardar, cerrar, reabrir, comparar y recalcular ensayos; editar y borrar columnas/registros tras guardar, aviso de filtros distintos, descargar CSV/JSON mediante diálogos nativos, cancelarlos, escape de fórmulas y valores Unicode. Validar cohorte y denominadores en cada exportación.
- Abrir y editar fichas desde discrepancias, regresar a la instantánea y recalcular de forma explícita; no confundir los resultados históricos con las celdas actuales.
- Copia/restauración con ensayos y sin la tabla opcional de ensayos (copia antigua), incluyendo rollback ante fallos. Borrado de base elimina sus ensayos por FK.
- Rendimiento de concordancia con 7.000–10.000 registros, categorías de texto numerosas, ocho evaluadores, cálculos repetidos, sin llamadas a IA/API; revisar inglés/español, claro/oscuro, temas, accesibilidad y ventana mínima.
- TypeScript, ESLint y suite de dominio ejecutados: pasan (86/86).
- Adaptar los E2E que usan `.filter-panel`, `selectOption` o el antiguo selector de orden al nuevo panel/combobox.
- Popovers anidados: buscadores, acentos, selección múltiple, teclado, Escape, Tab, clic exterior, desplazamiento, estados vacíos, nombres largos y ventana mínima; claro/oscuro e inglés/español.
- Tipos, fórmulas numéricas/booleanas/fecha, vacíos, ceros, negativos, rangos y literales LIKE con `%`, `_` y barras.
- Fechas relativas con calendario local, semanas desde lunes, cambio de mes/año, años bisiestos y cambio horario; compatibilidad de búsquedas guardadas antiguas.
- Grupos Y/O, campos equivalentes y aislamiento por base; OR entre esquemas diferentes no debe convertirse en una condición siempre verdadera.
- Personas, relaciones y opciones de varias propiedades: etiquetas al recuperar selecciones, paginación de sugerencias y opciones eliminadas.
- Más de 100 registros y varias páginas; misma selección en Tabla/Galería/Mapa, prioridades, vacíos y navegación entre bases sin datos de otra.
- Persistencia, ámbito de Búsqueda, búsquedas guardadas y propiedades eliminadas. En Búsqueda se confirman los filtros con Buscar; el orden se aplica a los resultados ejecutados.
- Semántica/híbrida con y sin ordenamientos y muchos candidatos; evitar inferencias de pago o descargas nuevas innecesarias.
- Fechas al editar celdas y operar con imágenes; creación conserva su fecha. Integridad de originales, historial y copias.
- Rendimiento del mapa y SQL con 10.000 registros y catálogos amplios, con datos aislados; mapas automatizados con teselas simuladas.
- Reconstruir instaladores al terminar. Los binarios actuales no contienen todos estos cambios acumulados; actualizar hashes e informes al validar.


## Resultado de la revisión conjunta

- `npm test`: 86/86.
- `npm run verify`: typecheck, lint, tests y build correctos.
- E2E de código fuente: general, auditoría, lugares, mapa, IA real, criterios y concordancia.
- Paquete macOS ARM64: todos los recorridos anteriores, incluida IA real.
- Paquete macOS x64 bajo Rosetta: general, auditoría, lugares, mapa, criterios y concordancia. La IA x64 no se declara probada: el store compartido solo tiene runtime llama.cpp ARM64; un runtime x64 de prueba cerró la app durante la indexación.
- `npm audit` y `npm audit --omit=dev`: 0 avisos.

No se ha ejecutado Windows nativo ni se han reconstruido/probado los instaladores Linux actuales en esta pasada. La firma/notarización, las APIs facturables, CUDA y el corpus real siguen fuera del alcance verificado.
