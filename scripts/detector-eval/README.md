# Evaluación de detectores visuales

Herramientas con las que se comparó la detección de elementos visuales el 24 de noviembre de 2026. Las conclusiones están en [docs/VISUAL-DETECTION.md](../../docs/VISUAL-DETECTION.md). Imago no necesita Python: esto solo sirve para repetir o ampliar la evaluación.

**Privacidad.** Trabaja siempre sobre una **copia** de la carpeta de datos de Imago, nunca sobre la original. Los resultados (`*.json`) y las hojas de contacto (`*.jpg`) contienen imágenes y datos de la colección. Escríbelos fuera del repositorio; el `.gitignore` de esta carpeta los bloquea por si acaso.

## 1. Entorno aislado

```bash
python3 -m venv /ruta/fuera/del/repo/venv
```

```bash
/ruta/fuera/del/repo/venv/bin/python -I -m pip install -r scripts/detector-eval/requirements.txt
```

Variables para cada ejecución: telemetría desactivada y cachés en una carpeta propia.

```bash
export HF_HUB_DISABLE_TELEMETRY=1 HF_HOME=/ruta/fuera/del/repo/cache/hf CACTUS_TELEMETRY=0 DO_NOT_TRACK=1 XDG_CACHE_HOME=/ruta/fuera/del/repo/cache
```

`CACTUS_TELEMETRY=0` solo importa si se instala `cactus-compute` (Mirage): ese paquete envía estadísticas de uso por defecto.

## 2. Muestra

Un archivo de texto con una línea por imagen, `grupo|content_hash`. El grupo es solo una etiqueta para el informe; sirve para estratificar. Ejemplo de consulta sobre una copia de la base (`collection/imago.sqlite`), con seis imágenes por opción de una propiedad de selección:

```sql
WITH g AS (
  SELECT ce.row_id, o.label FROM db_cells ce
  JOIN db_columns c ON c.id = ce.column_id AND c.name = '<propiedad>'
  JOIN db_select_options o ON o.id = ce.value_text
), pick AS (
  SELECT g.label, a.content_hash,
         row_number() OVER (PARTITION BY g.label ORDER BY substr(a.content_hash, 9, 8)) rn
  FROM g JOIN image_assets a ON a.row_id = g.row_id AND a.position = 0
)
SELECT label || '|' || content_hash FROM pick WHERE rn <= 6 ORDER BY label, rn;
```

Ábrela en modo de solo lectura (`sqlite3 "file:/ruta/copia/imago.sqlite?immutable=1"`). Las imágenes se leen de `collection/thumbnails/<content_hash>-preview.webp`, la previsualización que genera Imago (≈1.300 px), sin tocar los originales.

## 3. Ejecutar

```bash
python -I scripts/detector-eval/run.py gdino sample.txt /ruta/copia/collection/thumbnails /ruta/fuera/gdino.json --coarse
```

- Modelos: `gdino` (Grounding DINO base), `owl` (OWLv2 base), `florence` (Florence-2 large), `mirage`.
- `--coarse` usa los términos generales (el modo recomendado para Grounding DINO); sin él, el vocabulario fino.
- `--limit N` para probar con pocas imágenes.
- Se imprime el tiempo de carga y el tiempo por imagen. Ejecuta los modelos de uno en uno: compartir CPU falsea los tiempos.

## 4. Revisar

```bash
python -I scripts/detector-eval/draw.py /ruta/fuera/gdino.json /ruta/copia/collection/thumbnails /ruta/fuera/hojas
```

Genera hojas de seis imágenes con los recuadros, la etiqueta y la puntuación. La revisión de 2026 fue visual. El siguiente paso, antes de construir nada, es una medición: etiquetar a mano unas 100 imágenes con las categorías generales y calcular precisión y cobertura por categoría y umbral.
