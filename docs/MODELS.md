# Modelos e inferencia

Actualizado el **29 de octubre de 2026** tras ejecutar los pesos reales en macOS ARM64 (Apple M2, 16 GB, CPU, 512 dimensiones). Un catálogo o una verificación de archivo no bastan; las afirmaciones siguientes se apoyan en [real-models-macos-arm64.json](benchmarks/real-models-macos-arm64.json) o se marcan como límites.

## EmbeddingGemma 2

La [ficha oficial](https://huggingface.co/google/embeddinggemma-2) describe una arquitectura modular de 740 M: texto 270 M, visión 170 M y audio 300 M. Imago desactiva audio para cargar texto+visión. Se usa Sentence Transformers 6.2 con FP32 en CPU y sin conversiones ONNX no comprobadas. La revisión queda fijada en `shared/modelCatalog.json`.

Se admiten 768, 512 y 256 dimensiones, truncando antes de normalizar. La [guía oficial multimodal](https://ai.google.dev/gemma/docs/embeddinggemma/multimodal-embeddinggemma-with-sentence-transformers) permite entradas de imagen y texto en un espacio común. Las consultas textuales reciben el prefijo de recuperación oficial; las imágenes no reciben prefijo textual. La mezcla texto+imagen de Imago promedia embeddings normalizados con igual peso; no se presenta como una inferencia intercalada nativa.

El presupuesto visual se fija en 280 tokens y forma parte del contrato. No se utiliza FP16: la documentación oficial advierte que no representa correctamente las activaciones. Metal y CUDA se ofrecen como opciones experimentales, sin promesas de paridad de calidad ni rendimiento.

### Cambios necesarios para ejecutar

- `modules.json` de la revisión f9972ac usa los nombres de Sentence Transformers 6.2 (`sentence_transformers.base.modules.*` y `sentence_transformers.sentence_transformer.modules.*`). El runtime acepta los tres módulos de datos (`Transformer`, `Pooling`, `Normalize`) por prefijo de paquete y clase, no una lista de cadenas obsoleta. Esto fue un fallo real de la primera validación: fallaba con `Unsupported sentence-transformer module` antes de cargar los pesos.
- El procesador visual de EmbeddingGemma 2 requiere **torchvision**; sin él, Transformers falla con `EmbeddingGemma2VideoProcessor requires the Torchvision library`. Se instaló `torchvision==0.29.2` compatible con `torch==2.15.0` y se añadió a `runtime/requirements.txt`. No se carga audio (`config_kwargs={"audio_config": None}`).
- La inferencia bloquea sockets en el proceso Python y usa `local_files_only=True`, `trust_remote_code=False`.

Mediciones reales: indexación en frío de tres imágenes 39,1 s (incluye carga del modelo); consulta textual en caliente 152 ms; consulta por imagen 7,3 s; texto+imagen/híbrida 8,4 s. La recuperación textual española devolvió el puente como primer resultado y la consulta por imagen devolvió la misma imagen con similitud ~1,0. Son tres imágenes, no un benchmark de calidad.

## LFM3-VL-2B

Modelo principal de descripción/clasificación, de acuerdo con la aclaración del encargo. Se ofrecen el [GGUF oficial de Liquid AI](https://huggingface.co/LiquidAI/LFM3-VL-2B-GGUF), Q4_K_M, y su proyector F16, descargados por separado del motor llama.cpp. La variante elegida ocupa aproximadamente 1,48 GB de descarga; el consumo de memoria de inferencia no se ha medido con precisión.

Se usa `llama-mtmd-cli` de llama.cpp **b11981**, sin puerto HTTP. El binario se descargó, verificó y ejecutó. La ayuda real confirma que las opciones `--single-turn`, `--simple-io` y `--no-display-prompt` ya no existen; Imago no las pasa. Se usa `--log-verbosity 0` para conservar la salida generada y reducir diagnósticos, `--temp 0`, `-c 4096`, `-ngl 0` en CPU y un límite de tiempo.

El CLI entra en modo de una sola consulta al recibir imagen y prompt. La plantilla oficial del GGUF habilita razonamiento por defecto (`enable_thinking=true`), pero Imago no aplica Jinja en este modo. Aun así, en ejecuciones reales LFM3 antepuso un bloque de análisis terminado en `</think>` y, en otra, una cabecera `### Análise de la Imagen`. Ambos se detectaron en la validación real y obligaron a endurecer el parser:

- Se eliminan bloques `<think>…</think>`, `<reasoning>…</reasoning>` y cierres huérfanos `</think>`/`</reasoning>`/`</analysis>`.
- Se eliminan cabeceras Markdown iniciales, banners de llama.cpp y tokens especiales.
- La descripción debe quedar como prosa; un JSON suelto o solo razonamiento se rechaza.
- La clasificación acepta `["Paisaje"]` y `[{"type":"image","name":"GoldenGate.png","category":"Paisaje"}]`, pero valida cada etiqueta contra el vocabulario exacto de la propiedad y el máximo de opciones. Un objeto con `name` de archivo y `category` de etiqueta se interpreta por `category`.

Mediciones reales: descripción 24,6 s y clasificación 21,1 s ejecutadas simultáneamente en dos procesos independientes. Se pausó la descripción, la clasificación terminó, y al reanudar la descripción se generó la propuesta correcta. No se aceptan razonamientos, banners ni JSON inválido como valor de celda.

Su licencia es **LFM Open License 1.0**, no Apache ni AGPL. El instalador de la aplicación no incorpora los pesos. El texto de condiciones se conserva con los avisos y en la descarga del modelo.

## Alternativas

Las fichas oficiales de [SmolVLM2 256 M](https://huggingface.co/HuggingFaceTB/SmolVLM2-256M-Video-Instruct) y 500 M las licencian bajo Apache-2.0. La variante de 256 M es una alternativa compacta, con limitaciones de capacidad e idioma. La arquitectura está integrada, pero **no se han descargado ni ejecutado sus pesos**; no se afirma su calidad.

[Florence-2 Base](https://huggingface.co/microsoft/Florence-2-base) tiene licencia MIT y capacidades visuales útiles, pero su ruta histórica depende de código específico. Se mantiene como candidato, sin descarga disponible hasta cerrar una integración segura y probada.

## Modelos por tarea y propiedad

Las descripciones y clasificaciones tienen selecciones independientes en Ajustes. Cada columna puede sobrescribirlas y definir instrucciones y propiedad de imágenes de origen, siguiendo el patrón de `databaseAiColumn.ts` de Nodus. Una propiedad select devuelve como máximo una opción; multi-select devuelve varias dentro de su vocabulario.

El modelo se fija en el payload del trabajo. Las celdas se procesan progresivamente. Las columnas distintas pueden tener trabajos simultáneos; dos trabajos sobre la misma propiedad comparten un recurso de exclusión para no generar propuestas competidoras. El runtime Python compartido tiene una sola vía de inferencia; trabajos LFM3 y de APIs pueden avanzar en paralelo hasta el límite de memoria y configuración. La validación real comprobó dos procesos LFM3 simultáneos y la pausa independiente de uno.

**Límite de rendimiento:** cada celda LFM3 arranca un `llama-mtmd-cli` y recarga el GGUF. La validación mide una celda; una columna completa es funcional pero no tiene un benchmark de extremo a extremo. Reutilizar el proceso o usar un servidor local sin exponerlo son líneas de trabajo pendientes, no una capacidad ya medida.

Los proveedores API usan los constructores multimodales de Nodus y almacenan claves cifradas en el proceso principal. Existe un interruptor explícito de APIs remotas y no hay fallback. Los endpoints locales HTTP se limitan al propio equipo. Las llamadas de una misma cuenta/proveedor comparten un intervalo mínimo y la cola conserva cancelación y estado tras reiniciar. No se han probado claves reales ni llamadas facturables.

## Límites de plataforma

La validación se ejecutó únicamente en macOS ARM64/CPU. Metal/MPS, CUDA, macOS Intel, Windows x64 y Linux x64 no se han ejecutado. El motor llama.cpp descargado es el artefacto oficial macOS ARM64; las demás plataformas deben descargar su artefacto correspondiente. El entorno Python no está incluido en el instalador.
