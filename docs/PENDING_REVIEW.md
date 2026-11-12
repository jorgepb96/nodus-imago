# Cambios acumulados para revisión final

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
