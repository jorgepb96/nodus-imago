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

El formato ZIP `nodus.imago/1` anterior sigue restaurándose. Las copias nuevas añaden SHA-256 de SQLite y de metadatos de aplicación. El contenedor cifrado propio `IMAGOENC1` usa scrypt (N=32768, r=8, p=1), sal aleatoria y AES-256-GCM. No se presenta como archivo `.nodus` intercambiable. Las claves de API solo se incluyen con cifrado y llevan además un contenedor cifrado interno. Las copias sin contraseña omiten las claves. El ZIP temporal sin cifrar se prepara exclusivamente dentro del perfil privado; nunca se crea en la carpeta externa/sincronizada de destino.

Incluye bases, IDs, relaciones, originales enlazados/gestionados, nombres de importaciones pendientes, contenido rico/árboles, criterios de vistas `imago.*`, preferencias, propuestas/historial, índices/contratos y ensayos. Incluye ajustes del gestor y del actualizador; la ruta de copias de otra máquina no se adopta. Los pesos y runtimes se descargan por separado.

Antes de aceptar una copia: preflight de espacio, snapshot, integridad y claves foráneas SQLite, esquema, hashes de todos los originales y verificación autenticada del resultado cifrado. Los destinos existentes no se sobrescriben, incluso si aparecen después del preflight: publicación exclusiva por enlace duro o copia con `COPYFILE_EXCL` cuando el sistema de archivos no admite enlaces. Antes de retirar el origen se verifica el destino. Esto también se aplica al archivado. Se retiran únicamente los temporales propios. Archivar mueve archivos; no los elimina. La retención conserva al menos tres copias verificadas antes de archivar las antiguas.

Restauración: selección nativa, contraseña y comprobación previa vinculada al hash del archivo. Una sustitución requiere confirmación nativa y una copia cifrada verificada de la colección actual antes de la transacción. Se bloquean escrituras y se pausan trabajos durante la operación. Un fallo de transacción revierte los datos y retira solo originales nuevos no referenciados. Los originales antiguos se conservan. Los trabajos restaurados quedan pausados y las APIs, reglas y copias automáticas desactivadas, incluidas las copias antiguas sin metadatos de aplicación. Las claves existentes se conservan y se añaden únicamente las ausentes. Las copias registradas pueden abrirse con la versión de contraseña conservada en el almacén seguro, incluida la restauración posterior a una rotación de contraseña. Un fallo posterior de ajustes/almacén seguro se comunica sin presentar la transacción restaurada como perdida.

El recorrido nativo conserva evidencia en `test-results/backups-native-*`: dos originales con hashes, notas jerárquicas, tema y estado de vistas, claves ficticias en el almacén real si está disponible, sustitución desde la interfaz, copia de rescate, cierre/reapertura, recuperación en un segundo perfil y una segunda copia/restauración en un tercero. Prueba contraseña incorrecta y corrupción autenticada sin mutación. No utiliza datos de investigación del usuario.

Pruebas adicionales: fallo de transacción inyectado, falta de original/destino, disco/preflight, archivo anterior compatible, manifest ambiguo, snapshot alterado, importación pausada con fuente ya ausente, archivos existentes y carreras de publicación, sistemas de archivos sin enlaces duros, temporales privados fuera de carpetas sincronizadas, agotamiento de disco inyectado, cancelación, desconexión de carpeta, cambios tras la previsualización, bloqueo de escrituras, programación y rotación de contraseña.

Se corrigió también la recarga posterior a restaurar: la protección de navegación impedía la recarga solicitada desde el renderer. Ahora la recarga la realiza Electron; se comprueba en el recorrido de interfaz.

## Actualizaciones

Referencia consultada en modo lectura: implementación y configuración de Nodus Research, incluido su ensamblaje de manifiestos macOS. Integración con `electron-updater`, feed fijo GitHub `jorgepb96/nodus-imago`, canales estable/beta, búsqueda y descarga configurables, progreso y aviso en el header. Nunca se permite downgrade ni instalación automática al cerrar la ventana.

Se exige un paquete compatible con SO/arquitectura/formato y SHA-512; se vuelve a comprobar antes y después de la copia previa. Instalar requiere confirmación, pausar escrituras/trabajos, copia cifrada verificada y cierre de SQLite/IA antes de entregar el control al instalador nativo. Si la copia falla, la instalación no continúa. Las compilaciones macOS sin Developer ID muestran el límite y no intentan instalar mediante el actualizador nativo.

`update-protocol-e2e.mjs` utiliza el proveedor, HTTP de Electron, caché y comprobación de electron-updater reales. Sirve un payload **no instalable**, detecta corrupción y feed ausente, comprueba el bloqueo ante copia fallida y el orden copia → cierre → entrega al instalador. La última frontera se intercepta deliberadamente; esto no equivale a instalar una release firmada.

El ensamblador de feeds exige versión coincidente, cinco targets, los once instaladores presentes y hashes/tamaños reales. La integración con los artefactos reales del run `43410521506` detectó y permitió corregir los sufijos nativos de Linux: x64 usa `x86_64` en AppImage/RPM y `amd64` en DEB; ARM64 usa `aarch64` en RPM y `arm64` en AppImage/DEB. El cliente y el ensamblador comparten esa correspondencia. La comprobación posterior verifica SHA-512 y tamaño de los once instaladores y selección correcta en nueve combinaciones SO/arquitectura/formato. Evidencia: `test-results/actual-update-feeds-{before,after}.log` y `test-results/actual-update-compatibility-after.json`. macOS combina ARM64/Intel con ARM64 primero y puntero ZIP; Linux mantiene feeds separados según arquitectura. El workflow manual de borrador firmado no se ejecuta automáticamente, exige credenciales al solicitar una release y solo crea un borrador. CI sigue generando artefactos de prueba sin firma.

## Evidencia y límites

- Suite ampliada: **173 pruebas**, sin omitidas, más typecheck, lint y build locales correctos.
- Nueve recorridos de escritorio pasan en fuente: general, auditoría, lugares, mapa, criterios, concordancia, fase 2, copias y transporte de actualizaciones.
- Inferencia real y recuperación de cola con indexación sin Python comprobadas en los cinco runners. Se reutilizan modelos de pruebas ya descargados con licencia; gasto de APIs en esta revisión: cero.
- Los logs y perfiles se conservan en `test-results/`; no se publican claves, copias ni modelos en Git.
- Producto final `d72e716`: **10/10 jobs correctos**, [run 43424372795](https://github.com/jorgepb96/nodus-imago/actions/runs/43424372795), diez artefactos de ese commit. Los resultados anteriores se conservan como historia.
- Pendiente de la futura autorización de release: instalación nativa entre dos versiones firmadas/notarizadas y validación del instalador privilegiado en cada SO. Las pruebas con payload sintético no cubren esta frontera.
- Ninguna suite finita garantiza todos los fallos físicos de discos, pérdidas del almacén seguro o cambios futuros del sistema. Se conserva la necesidad de guardar la contraseña y una copia externa; no se afirma «100 %».

## Cierre del producto `d72e716`

Los cinco jobs desktop pasan 173 pruebas cada uno, tipos/lint/build, 17.010 comparaciones estadísticas independientes por runner, los ocho recorridos de aplicación en fuente y sobre sus paquetes actuales, más el protocolo independiente de actualización con Electron. Los otros cinco jobs pasan descargas verificadas desde perfil limpio, migración de contratos, inferencia real sin Python y recuperación de colas con LFM3 y ONNX/Harrier.

| Destino | Paquetes ejercitados | IA real |
| --- | --- | --- |
| macOS ARM64 | DMG de solo lectura y ZIP | LFM3 + EmbeddingGemma ONNX |
| macOS Intel | DMG de solo lectura y ZIP | LFM3 + Harrier |
| Windows x64 | NSIS instalado | LFM3 + EmbeddingGemma ONNX |
| Linux x64 | AppImage extraído, DEB instalado con dependencias, RPM extraído | LFM3 + EmbeddingGemma ONNX |
| Linux ARM64 | AppImage extraído, DEB instalado con dependencias, RPM extraído | LFM3 + EmbeddingGemma ONNX |

En el runner Intel, Harrier registró 1.640.488.960 bytes de RSS del proceso de embeddings (aprox. 1,53 GiB), consulta de 1,879 s y dos descripciones LFM3 en 28,891 s. No incluye toda la RAM de Electron/LFM3 ni garantiza esas cifras en otro equipo. Evidencia nativa de los cinco sistemas en `test-results/d72e716-ai-evidence/`.

Localmente, los DMG/ZIP de `release/audit-d72e716` pasan los ocho recorridos de aplicación; el protocolo independiente de actualización también pasa. Manifiesto y SHA-256 en esa carpeta. El primer intento local cerró el proceso al comprobar el tema tras reabrir la app. No hubo informe de crash nuevo y no se reprodujo al repetir el recorrido completo con el mismo paquete. Se conservan `d72e716-packaged.log` (incidencia) y `d72e716-packaged-recheck.log` (repetición correcta); la CI de ambos Mac también pasa. La causa de ese cierre aislado no se ha determinado y no se presenta como fallo corregido.

Después de finalizar la CI, se repitió la recuperación completa desde el ejecutable final: copia cifrada, comprobación, sustitución desde la interfaz con copia de rescate, cierre/reapertura, recuperación en otro perfil y segunda copia/restauración en un tercero; originales verificados por SHA-256 y contenido/configuración recuperados. Evidencia: `test-results/d72e716-last-backup-verification.log`, último perfil `test-results/backups-native-1794580605427/evidence.json`.

Cierre verificable: `test-results/reliability-final-closure.json`, `d72e716-ci.json`, `d72e716-ci.log` y `d72e716-ci-artifacts.json`. Los once instaladores de los cinco destinos están en los artefactos del run; no se suben pesos, perfiles, copias ni instaladores al historial Git. La documentación de cierre posterior no modifica el producto probado. No se ha creado ninguna release pública ni ejecutado firma/notarización. La instalación nativa entre versiones firmadas y las comprobaciones reservadas para release siguen pendientes de esa autorización.
