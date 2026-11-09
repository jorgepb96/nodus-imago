# Modelos e inferencia

Actualizado el **9 de noviembre de 2026** tras ejecutar los pesos reales en macOS ARM64 (Apple M2, 16 GB, CPU, 512 dimensiones). Un catálogo o una verificación de archivo no bastan; las afirmaciones siguientes se apoyan en [real-models-macos-arm64.json](benchmarks/real-models-macos-arm64.json) o se marcan como límites.

## EmbeddingGemma 2

La [ficha oficial](https://huggingface.co/google/embeddinggemma-2) describe una arquitectura modular de 740 M: texto 270 M, visión 170 M y audio 300 M. Imago desactiva audio para cargar texto+visión. Se usa Sentence Transformers 6.2 con FP32 en CPU y sin conversiones ONNX no comprobadas. La revisión queda fijada en `shared/modelCatalog.json`.

Se admiten 768, 512 y 256 dimensiones, truncando antes de normalizar. La [guía oficial multimodal](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers) permite entradas de imagen y texto en un espacio común. Las consultas textuales reciben el prefijo de recuperación oficial; las imágenes no reciben prefijo textual. La mezcla texto+imagen de Imago promedia embeddings normalizados con igual peso; no se presenta como una inferencia intercalada nativa.

El presupuesto visual se fija en 280 tokens y forma parte del contrato. No se utiliza FP16: la documentación oficial advierte que no representa correctamente las activaciones. Metal/MPS se probó con EmbeddingGemma 2 en texto e imagen (512 dimensiones, vectores finitos); no se ha medido su rendimiento ni paridad numérica frente a CPU. CUDA sigue sin ejecutarse. LFM3 continúa usando llama.cpp en CPU.

### Cambios necesarios para ejecutar

- `modules.json` de la revisión f9972ac usa los nombres de Sentence Transformers 6.2 (`sentence_transformers.base.modules.*` y `sentence_transformers.sentence_transformer.modules.*`). El runtime acepta los tres módulos de datos (`Transformer`, `Pooling`, `Normalize`) por prefijo de paquete y clase, no una lista de cadenas obsoleta. Esto fue un fallo real de la primera validación: fallaba con `Unsupported sentence-transformer module` antes de cargar los pesos.
- El procesador visual de EmbeddingGemma 2 requiere **torchvision**; sin él, Transformers falla con `EmbeddingGemma2VideoProcessor requires the Torchvision library`. Se instaló `torchvision==0.29.2` compatible con `torch==2.15.0` y se añadió a `runtime/requirements.txt`. No se carga audio (`config_kwargs={"audio_config": None}`).
- La inferencia bloquea sockets en el proceso Python y usa `local_files_only=True`, `trust_remote_code=False`.

Mediciones reales: indexación en frío de tres imágenes 19,6 s (incluye carga del modelo); consulta textual en caliente 93 ms; consulta por imagen 3,0 s; texto+imagen/híbrida 3,4 s. La recuperación textual española devolvió el puente como primer resultado y la consulta por imagen devolvió la misma imagen con similitud ~1,0. Son tres imágenes, no un benchmark de calidad.

## LFM3-VL-2B

Modelo principal de descripción/clasificación, de acuerdo con la aclaración del encargo. Se ofrecen el [GGUF oficial de Liquid AI](https://huggingface.co/LiquidAI/LFM3-VL-2B-GGUF), Q4_K_M, y su proyector F16, descargados por separado del motor llama.cpp. La variante elegida ocupa aproximadamente 1,48 GB de descarga; el consumo de memoria de inferencia no se ha medido con precisión.

Se usa `llama-mtmd-cli` de llama.cpp **b11981**, sin puerto HTTP. El binario se descargó, verificó y ejecutó. La ayuda real confirma que las opciones `--single-turn`, `--simple-io` y `--no-display-prompt` ya no existen; Imago no las pasa. Se usa `--log-verbosity 0` para conservar la salida generada y reducir diagnósticos, `--temp 0`, `-c 4096`, `-ngl 0` en CPU y un límite de tiempo.

El CLI se abre en **modo chat persistente** (`Running in chat mode`). Imago no usa una consulta por celda: mantiene el proceso, espera el prompt `> `, envía `/clear`, después `/image <ruta>` y finalmente el prompt en una sola línea. La plantilla del GGUF se aplica en este modo, por lo que LFM3 puede razonar y envolver la respuesta en un sobre de herramienta. El parser se endureció con casos reales:

- Se eliminan bloques `<think>…</think>`, `<reasoning>…</reasoning>` y cierres huérfanos `</think>`/`</reasoning>`/`</analysis>`.
- Se eliminan cabeceras Markdown iniciales, banners de llama.cpp y tokens especiales.
- Se extrae el cuerpo de `<parameter name="description">…</parameter>` (y variantes `labels`/`categories`) cuando LFM3 usa `<minimax:tool_call>`; el sobre nunca se guarda.
- La descripción debe quedar como prosa; un JSON suelto o solo razonamiento se rechaza.
- La clasificación se fuerza con `--json-schema '{"type":"array","items":{"type":"string"}}'`. Además de `["Paisaje"]`, se aceptan objetos con `label`/`Label`/`category`/`value`/`name`, siempre que la etiqueta pertenezca al vocabulario exacto de la propiedad y no se supere el máximo de opciones. Las claves de etiqueta se reconocen sin distinguir mayúsculas; el JSON con claves sin comillas se rechaza.
- `--image-max-tokens 280` evita que una captura grande agote el contexto y haga caer el proceso. Se comprobó con una captura de 2880×1880 que antes terminaba en código 1.

El pool limita el total de sesiones según el perfil y el número de trabajos configurado (1 en light, 2 en balanced, hasta 4 en advanced), reutiliza la sesión libre y la cierra tras 60 s de inactividad. Una sesión de texto y otra JSON pueden coexistir para descripción y clasificación. Si se agota la capacidad, se desaloja una sesión inactiva de otra clave.

Mediciones reales (9 de noviembre de 2026): descripción 9,6 s y clasificación 8,5 s ejecutadas simultáneamente; dos celdas de descripción seguidas en un mismo pool 12,0 s; consulta tras reabrir 7,0 s. Se pausó la descripción, la clasificación terminó, y al reanudar la descripción se generó la propuesta correcta. La validación real incluye una imagen de 2880×1880 y dos celdas consecutivas. No se aceptan razonamientos, sobres de herramienta ni JSON inválido como valor de celda.

Su licencia es **LFM Open License 1.0**, no Apache ni AGPL. El instalador de la aplicación no incorpora los pesos. El texto de condiciones se conserva con los avisos y en la descarga del modelo.

## Alternativas

Las fichas oficiales de [SmolVLM2 256 M](https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct) y 500 M las licencian bajo Apache-2.0. La variante de 256 M es una alternativa compacta, con limitaciones de capacidad e idioma. La arquitectura está integrada, pero **no se han descargado ni ejecutado sus pesos**; no se afirma su calidad.

[Florence-2 Base](https://huggingface.co/microsoft/Florence-2-base) tiene licencia MIT y capacidades visuales útiles, pero su ruta histórica depende de código específico. Se mantiene como candidato, sin descarga disponible hasta cerrar una integración segura y probada.

## Modelos por tarea y propiedad

Las descripciones y clasificaciones tienen selecciones independientes en Ajustes. Cada columna puede sobrescribirlas y definir instrucciones y propiedad de imágenes de origen, siguiendo el patrón de `databaseAiColumn.ts` de Nodus. Una propiedad select devuelve como máximo una opción; multi-select devuelve varias dentro de su vocabulario.

El modelo se fija en el payload del trabajo. Las celdas se procesan progresivamente. Las columnas distintas pueden tener trabajos simultáneos; dos trabajos sobre la misma propiedad comparten un recurso de exclusión para no generar propuestas competidoras. El runtime Python compartido tiene una sola vía de inferencia; trabajos LFM3 y de APIs pueden avanzar en paralelo hasta el límite de memoria y configuración. La validación real comprobó dos trabajos LFM3 simultáneos (sesiones de texto y JSON), la pausa independiente de uno y la reutilización de una sesión para dos celdas.

**Límite de rendimiento:** el pool evita recargar el modelo por celda, pero no se ha medido una columna completa de miles de celdas ni 10.000 fotografías. El tope visual de 280 tokens reduce el detalle disponible en capturas muy densas. No se usa un servidor HTTP local; el protocolo es la entrada estándar del CLI.

Los proveedores API usan los constructores multimodales de Nodus y almacenan claves cifradas en el proceso principal. Existe un interruptor explícito de APIs remotas y no hay fallback. Los endpoints locales HTTP se limitan al propio equipo. Las llamadas de una misma cuenta/proveedor comparten un intervalo mínimo y la cola conserva cancelación y estado tras reiniciar. No se han probado claves reales ni llamadas facturables.

## Límites de plataforma

La validación se ejecutó únicamente en macOS ARM64/CPU. Metal/MPS, CUDA, macOS Intel, Windows x64 y Linux x64 no se han ejecutado. El motor llama.cpp descargado es el artefacto oficial macOS ARM64; las demás plataformas deben descargar su artefacto correspondiente. El entorno Python no está incluido en el instalador.
