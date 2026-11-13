# Auditoría de colas, copias y actualizaciones — 13 de noviembre de 2026

Revisión posterior al candidato `6af64a0`, en la carpeta y rama originales. No sustituye la evidencia histórica de DeepSeek ni borra sus correcciones. El último encargo reactiva expresamente las actualizaciones. No se ha lanzado una release, firmado, notarizado ni repetido la auditoría de APIs de pago.

## Colas

- Reanudar una tarea en marcha es idempotente. Reanudar todas solo incluye las pausadas; las fallidas necesitan un reintento explícito y las canceladas/completadas permanecen terminales.
- Un reintento conserva una selección durable de elementos fallidos/pendientes. No vuelve a leer originales externos de elementos ya importados ni repite sus llamadas a la API.
- FIFO estable, exclusión por columna y entre instalación de modelos e inferencia. Una tarea bloqueada no impide ejecutar otras independientes. Se mantienen los límites de memoria y concurrencia.
- Se rechazan progreso, JSON y selecciones de reintento inválidas sin romper el listado. Los fallos fatales quedan visibles.
- Cancelación durante espera/inicialización de llama.cpp y antes de persistir propuestas/vectores. El cierre espera la finalización del trabajo en curso.
- Estrés determinista con 60 tareas y 1.800 controles, además de las pruebas de concurrencia originales. El recorrido `queue-real-e2e.mjs` usa LFM3 y embeddings reales, pausa/cancelación, cierre/reapertura, revisión e indexación; no simula inferencia ni llama a APIs.

## Copias

Gestor de escritorio con carpeta externa al perfil, copia manual, programación por días/hora o intervalo, recuperación de programación pendiente e historial verificable. Las automáticas requieren contraseña guardada mediante el almacén seguro del sistema. Sin almacén seguro se admite contraseña por copia manual. Una contraseña incompleta o distinta de su confirmación bloquea la creación; nunca cae silenciosamente a texto claro.

El formato ZIP `nodus.imago/1` anterior sigue restaurándose. Las copias nuevas añaden SHA-256 de SQLite y de metadatos de aplicación. El contenedor cifrado propio `IMAGOENC1` usa scrypt (N=32768, r=8, p=1), sal aleatoria y AES-256-GCM. No se presenta como archivo `.nodus` intercambiable. Las claves de API solo se incluyen con cifrado y llevan además un contenedor cifrado interno. Las copias sin contraseña omiten las claves.

Incluye bases, IDs, relaciones, originales enlazados/gestionados, nombres de importaciones pendientes, contenido rico/árboles, criterios de vistas `imago.*`, preferencias, propuestas/historial, índices/contratos y ensayos. Incluye ajustes del gestor y del actualizador; la ruta de copias de otra máquina no se adopta. Los pesos y runtimes se descargan por separado.

Antes de aceptar una copia: preflight de espacio, snapshot, integridad y claves foráneas SQLite, esquema, hashes de todos los originales y verificación autenticada del resultado cifrado. Los destinos existentes no se sobrescriben. Se retiran únicamente los temporales propios. Archivar mueve archivos; no los elimina. La retención conserva al menos tres copias verificadas antes de archivar las antiguas.

Restauración: selección nativa, contraseña y comprobación previa vinculada al hash del archivo. Una sustitución requiere confirmación nativa y una copia cifrada verificada de la colección actual antes de la transacción. Se bloquean escrituras y se pausan trabajos durante la operación. Un fallo de transacción revierte los datos y retira solo originales nuevos no referenciados. Los originales antiguos se conservan. Los trabajos restaurados quedan pausados y las APIs, reglas y copias automáticas desactivadas. Las claves existentes se conservan y se añaden únicamente las ausentes. Un fallo posterior de ajustes/almacén seguro se comunica sin presentar la transacción restaurada como perdida.

El recorrido nativo conserva evidencia en `test-results/backups-native-*`: dos originales con hashes, notas jerárquicas, tema y estado de vistas, claves ficticias en el almacén real si está disponible, sustitución desde la interfaz, copia de rescate, cierre/reapertura, recuperación en un segundo perfil y una segunda copia/restauración en un tercero. Prueba contraseña incorrecta y corrupción autenticada sin mutación. No utiliza datos de investigación del usuario.

Pruebas adicionales: fallo de transacción inyectado, falta de original/destino, disco/preflight, archivo anterior compatible, manifest ambiguo, snapshot alterado, importación pausada con fuente ya ausente, archivos existentes, cancelación, desconexión de carpeta, cambios tras la previsualización, bloqueo de escrituras, programación y rotación de contraseña.

Se corrigió también la recarga posterior a restaurar: la protección de navegación impedía la recarga solicitada desde el renderer. Ahora la recarga la realiza Electron; se comprueba en el recorrido de interfaz.

## Actualizaciones

Referencia consultada en modo lectura: implementación y configuración de Nodus Research, incluido su ensamblaje de manifiestos macOS. Integración con `electron-updater`, feed fijo GitHub `jorgepb96/nodus-imago`, canales estable/beta, búsqueda y descarga configurables, progreso y aviso en el header. Nunca se permite downgrade ni instalación automática al cerrar la ventana.

Se exige un paquete compatible con SO/arquitectura/formato y SHA-512; se vuelve a comprobar antes y después de la copia previa. Instalar requiere confirmación, pausar escrituras/trabajos, copia cifrada verificada y cierre de SQLite/IA antes de entregar el control al instalador nativo. Si la copia falla, la instalación no continúa. Las compilaciones macOS sin Developer ID muestran el límite y no intentan instalar mediante el actualizador nativo.

`update-protocol-e2e.mjs` utiliza el proveedor, HTTP de Electron, caché y comprobación de electron-updater reales. Sirve un payload **no instalable**, detecta corrupción y feed ausente, comprueba el bloqueo ante copia fallida y el orden copia → cierre → entrega al instalador. La última frontera se intercepta deliberadamente; esto no equivale a instalar una release firmada.

El ensamblador de feeds exige versión coincidente, cinco targets, archivos presentes y hashes/tamaños reales. macOS combina ARM64/Intel con ARM64 primero y puntero ZIP; Linux mantiene feeds separados según arquitectura. El workflow manual de borrador firmado no se ejecuta automáticamente, exige credenciales al solicitar una release y solo crea un borrador. CI sigue generando artefactos de prueba sin firma.

## Evidencia y límites

- Suite ampliada: **164 pruebas**, sin omitidas, más typecheck, lint y build locales correctos.
- Nueve recorridos de escritorio pasan en fuente: general, auditoría, lugares, mapa, criterios, concordancia, fase 2, copias y transporte de actualizaciones.
- Inferencia real ARM64 con recuperación de cola e indexación sin Python comprobada. Se reutilizan modelos de pruebas ya descargados con licencia; gasto de APIs en esta revisión: cero.
- Los logs y perfiles se conservan en `test-results/`; no se publican claves, copias ni modelos en Git.
- Los resultados multiplataforma del candidato anterior no acreditan por sí solos este árbol. La ejecución de los cinco runners y sus artefactos debe identificarse por commit/run antes de declararlos actuales.
- Pendiente de la futura autorización de release: instalación nativa entre dos versiones firmadas/notarizadas y validación del instalador privilegiado en cada SO. Las pruebas con payload sintético no cubren esta frontera.
- Ninguna suite finita garantiza todos los fallos físicos de discos, pérdidas del almacén seguro o cambios futuros del sistema. Se conserva la necesidad de guardar la contraseña y una copia externa; no se afirma «100 %».
