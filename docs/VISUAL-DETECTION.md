# Detección de elementos visuales (aplazada)

Estado: **no implementada**. Evaluada el **24 de noviembre de 2026**. Si se retoma, el modelo elegido es **Grounding DINO base**; Mirage, OWLv2 y Florence-2 quedan descartados.

Este documento recoge qué se probó, cómo, qué salió y cómo habría que construirlo. No contiene imágenes ni datos de ninguna colección: la muestra usada es privada y no se distribuye.

## Qué se quería

Detectar y localizar elementos (personas, animales, transportes, arquitectura, imágenes religiosas, industria…) en las fotografías, de forma local y en CPU, como complemento de lo que Imago ya tiene: embeddings por imagen, etiquetado con IA, descripciones y búsqueda de detalles. Los recuadros se mostrarían como una capa del visor, se validarían a mano y alimentarían buscador, filtros y estadísticas.

## Cómo se probó

- Equipo: Apple M2, 16 GB, **solo CPU** (como se ejecutaría en Imago).
- Muestra: unas cincuenta fotografías documentales de mediados del siglo XX, mayoritariamente en blanco y negro y reproducidas en libro (trama, grano, márgenes y pies de foto), estratificadas por tema. Se usaron las previsualizaciones que genera Imago (≈1.300 px de lado mayor), sin tocar los originales.
- Cada modelo se ejecutó en un entorno Python aislado, con las cachés y la telemetría bajo control (ver «Reproducir»). Los recuadros se dibujaron sobre cada imagen y se revisaron uno a uno. Es una **revisión visual cualitativa, no una medición de precisión y cobertura**.
- Scripts: [`scripts/detector-eval/`](../scripts/detector-eval/).

## Resultados

| Modelo | Licencia | Pesos | CPU (M2) por imagen | Veredicto |
|---|---|---|---|---|
| [Mirage](https://huggingface.co/Cactus-Compute/mirage) (Cactus Compute, 51,3 M) | Apache 2.0 | 22 MB, formato `.cact` | 0,12 s | Descartado |
| [OWLv2 base](https://huggingface.co/google/owlv2-base-patch16-ensemble) (Google) | Apache 2.0 | ≈600 MB | 2,7 s | Descartado |
| [Grounding DINO base](https://huggingface.co/IDEA-Research/grounding-dino-base) (IDEA Research) | Apache 2.0 | ≈900 MB | 5,9 s | **Elegido** |
| [Florence-2 large](https://huggingface.co/florence-community/Florence-2-large) (Microsoft) | MIT | ≈1,5 GB | 22 s | Descartado (lento; prueba cancelada) |

### Mirage

Rapidísimo y diminuto, pero nombra los objetos con su propio modelo de lenguaje y en este material **se inventa la clase**: animales de tiro como caballos o soldados, rebaños como «crowd», un zorro como canguro, torres de alta tensión como aerogeneradores, barricas como retratos, imágenes religiosas como humo, flores o «woman». La puntuación **no separa aciertos de errores** (errores con 0,5–0,95, aciertos con 0,4), así que un umbral no sirve. Su opción `keywords` empeora el resultado: fuerza palabras de la lista sin base visual. Acierta razonablemente personas visibles, mapas y bloques de texto. Solo se distribuye en formato propio con el motor Cactus (sin ONNX), y el paquete Python **trae telemetría activada por defecto** (`CACTUS_TELEMETRY=0` la desactiva).

### OWLv2

Detección por vocabulario de texto, pero con mucho ruido en este material: sombreros y rebaños donde no los hay, chimeneas industriales sobre torres de iglesia, castillos sobre claustros. Requeriría umbrales por clase y aun así sería poco fiable.

### Grounding DINO

**Localiza bien**: personas, animales, barcos, barricas, puentes e imágenes religiosas en procesión o en retablos. Con un vocabulario fino reparte mal la etiqueta entre términos parecidos (personas como «priest», «nun» o «soldier» casi al azar; cabras como «ox»). Con **términos generales** (`person`, `animal`, `religious statue`, `church`, `boat`, `barrel`, `electricity pylon`…) las etiquetas son correctas casi siempre. Su punto débil es la **cobertura**: en grupos densos puede no detectar a nadie y en escenas de trabajo pierde figuras parcialmente ocultas.

### Florence-2

Detección libre (como Mirage), con soporte nativo en transformers 5 (sin código remoto). A 22 s por imagen en CPU no es práctico para lotes; la prueba se canceló.

## Qué aporta frente a lo que ya existe

Para preguntas de **presencia o tema** («¿hay procesiones?», «¿aparece un carro?») bastan los embeddings, el etiquetado y las descripciones. Lo que solo da la detección es la **medida**:

1. **Recuento**: cuántas personas o animales, no solo si aparecen.
2. **Composición y escala**: posición y tamaño relativo de cada elemento; por ejemplo, si la figura humana es protagonista o un elemento de escala pintoresco.
3. **El objeto como unidad**: series de recortes (todos los carros, todas las imágenes religiosas) y comparación de cómo se recorta una misma fotografía en distintas publicaciones.
4. **Prueba verificable**: un recuadro señala dónde lo vio el modelo y se puede comprobar, corregir y citar.

Riesgos: el modelo mira con categorías actuales (no detectar ≠ no estar), cuenta mejor lo grande y cercano, y los roles y el género son lo que peor hace. Por eso las estadísticas solo deberían usar detecciones validadas o un margen de error medido.

## Cómo construirlo

### 1. Medir antes de construir

Etiquetar a mano unas 100 fotografías con 6–8 categorías generales y calcular precisión y cobertura por categoría y umbral. Esa cifra decide si la función sirve para estadísticas o solo como ayuda para anotar.

### 2. Arquitectura en dos pasos

1. **Detector** (Grounding DINO base) con categorías generales: Personas, Animales, Transportes, Imagen religiosa, Edificio religioso, Arquitectura, Industria, Textos. Un término de consulta por categoría o pocos términos por categoría; supresión de no máximos por categoría y fusión entre categorías para no duplicar recuadros.
2. **Clasificador sobre el recorte** para el detalle (burro, mula, caballo, oveja…; sacerdote, monja, soldado…), con el vocabulario editable del usuario. Candidatos: LFM3-VL (ya en Imago) o un modelo pequeño tipo CLIP. Sin este segundo paso, el vocabulario no tiene efecto real sobre lo que se detecta.

### 3. Ejecución en la app

- Mismo camino que EmbeddingGemma 2: proceso ONNX aparte sin red (`electron/ai/onnxWorker.ts`) con transformers.js sobre `onnxruntime-node`. transformers.js trae el tokenizador, el preprocesado y el posprocesado de Grounding DINO.
- **Por verificar**: que exista o se pueda exportar un ONNX de Grounding DINO *base* que funcione con `onnxruntime-node` 1.30 (hay exportaciones comunitarias de la versión *tiny*), y su paridad con PyTorch en esta misma muestra.
- Pesos en `shared/modelCatalog.json` con revisión fijada y SHA-256, descargados por el gestor de modelos. ≈900 MB en FP32; probar cuantización q8 y medir la pérdida.
- A ≈6 s por imagen, una base de varios miles de imágenes es una noche de trabajo en segundo plano.

### 4. Datos

Tabla propia, separada de las anotaciones manuales (`image_annotations`) y de las propiedades:

```sql
CREATE TABLE image_detections(
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES image_assets(id) ON DELETE CASCADE,
  model TEXT NOT NULL, revision TEXT NOT NULL,     -- un modelo futuro no pisa nada
  label_raw TEXT NOT NULL,                          -- lo que dijo el modelo
  category TEXT NOT NULL, element TEXT,             -- categoría y detalle asignados
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL, -- normalizadas 0–1
  score REAL,
  state TEXT NOT NULL DEFAULT 'pending',            -- pending | validated | corrected | rejected
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
```

Volver a ejecutar un modelo sustituye solo sus detecciones pendientes; las validadas y corregidas se conservan. Validar puede crear además una anotación manual.

### 5. Interfaz y fases

1. Botón en la barra del visor (junto a búsqueda, comentarios y patrimonio): detectar la foto abierta y mostrar u ocultar la capa (oculta por defecto). Recuadros con el color de su categoría; al pulsar uno, detalle, categoría, confianza y validar, corregir o eliminar. Filtro por categorías y umbral de confianza.
2. Lotes sobre una selección o toda la base en la cola de tareas, con pausa, reanudación y cancelación.
3. Buscador, filtros y estadísticas: frecuencia, recuento por imagen, área relativa, posición en el encuadre y cruces con las propiedades; por defecto solo con detecciones validadas.

## Reproducir

Ver [`scripts/detector-eval/README.md`](../scripts/detector-eval/README.md). Los resultados y las hojas de contacto contienen imágenes de la colección: se escriben fuera del repositorio y no deben subirse.
