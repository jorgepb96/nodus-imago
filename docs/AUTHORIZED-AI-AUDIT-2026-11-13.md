# Auditoría real de IA — 13 de noviembre de 2026

Ensayo técnico en un perfil nativo aislado de macOS ARM64: diez fotografías públicas de NASA, cinco modelos, una columna de descripción y otra de categoría por modelo. Las claves permanecen cifradas y fuera de Git. No se utiliza el corpus privado del investigador.

## Condiciones

- Diez JPEG de prueba de hasta 960 px, derivados de las imágenes de NASA; fuentes, fechas y SHA-256 original/derivado en `test-results/authorized-api-audit-20261113/images.json`. Se reconocen NASA y los centros consignados en sus fichas como fuente; uso informativo conforme a sus [directrices de medios](https://www.nasa.gov/nasa-brand-center/images-and-media/).
- Títulos neutros «Imagen 01» a «Imagen 10»; sin introducir identidades, fechas o localizaciones del catálogo en las instrucciones.
- Cinco categorías instrumentales elegidas solo para este ensayo, sin añadir taxonomías predeterminadas al producto: personas y retratos; infraestructuras y tecnología; trabajo y actividad colectiva; paisajes y entorno natural; detalles y objetos.
- Misma instrucción de evidencia visible y vocabulario; nombre de columna con el identificador de cada modelo. No es una evaluación ciega con prompts idénticos byte a byte.
- Todas las respuestas permanecen como propuestas hasta terminar los cinco modelos. Ninguno recibe las etiquetas o descripciones aceptadas de otro en el contexto de su fila.
- API: máximo 512 tokens de salida; razonamiento desactivado en Qwen y Gemini. LFM3 usa el adaptador local normal en CPU. No se simula ninguna inferencia.
- Un dólar máximo POR API. Proxy de medición local con destinos HTTPS oficiales fijos, precio máximo de proveedor en OpenRouter, reserva duradera del contexto completo antes de cada petición y bloqueo de reintentos inciertos. No se adquieren créditos ni se cambia ningún límite de cuenta.

## Respuestas, cobertura y gasto

| Modelo | Descripciones admitidas | Etiquetas admitidas | Respuestas reales | Coste USD |
|---|---:|---:|---:|---:|
| `google/gemma-3-4b-it` | 10/10 | 10/10 | 20 | 0.000349240 reportado |
| `mistralai/ministral-3b-2512` | 10/10 | 9/10 | 20 | 0.002324940 reportado |
| `qwen/qwen3.5-9b` | 10/10 | 7/10 | 20 | 0.001706616 reportado |
| `gemini-2.5-flash-lite` | 10/10 | 10/10 | 20 | 0.001162600 estimado |
| `lfm3-vl-2b` | 10/10 | 10/10 | 20 | 0 (local) |

OpenRouter: **60 peticiones HTTP 200; 0,004380796 USD reportados** por `usage.cost`. Gemini: **20 peticiones HTTP 200; 0,001162600 USD estimados** a partir de 9.810 tokens de entrada y 454 de salida, con las [tarifas estándar de Flash Lite](https://aistudio.google.com/docs/pricing#gemini-2.5-flash-lite), 0,10/0,40 USD por millón. La estimación de Gemini no sustituye a la factura. Ambos importes están por debajo de su límite independiente de 1 USD. Precios y capacidades de OpenRouter contrastados con su [catálogo oficial](https://openrouter.ai/api/v1/models); límites de precio según su [documentación](https://openrouter.ai/docs/guides/routing/provider-selection#max-price).

Son **50 descripciones no vacías y 46 etiquetas conformes al formato/vocabulario**, no 50 descripciones correctas ni un 92 % de precisión. Ministral inventó una categoría («Ingeniería y control de sistemas»); Qwen produjo tres selecciones con demasiadas etiquetas. La app rechazó esos cuatro valores, conservó las 96 propuestas válidas, dejó las celdas rechazadas vacías y marcó sus colas con errores. No se eligió una etiqueta por ellos ni se ocultó el fallo.

## Concordancia real

Se incluyen los cinco modelos, también los que tienen respuestas ausentes tras el rechazo. En cada pareja se usan los casos válidos de ambos. Para unanimidad y Fleiss se exigen todos los evaluadores válidos.

| Pareja | Casos válidos | Acuerdo exacto | Cohen κ nominal |
|---|---:|---:|---:|
| google/gemma-3-4b-it / mistralai/ministral-3b-2512 | 9 | 66.7 % | 0.590909 |
| google/gemma-3-4b-it / qwen/qwen3.5-9b | 7 | 71.4 % | 0.650000 |
| google/gemma-3-4b-it / gemini-2.5-flash-lite | 10 | 60.0 % | 0.487179 |
| google/gemma-3-4b-it / lfm3-vl-2b | 10 | 60.0 % | 0.473684 |
| mistralai/ministral-3b-2512 / qwen/qwen3.5-9b | 6 | 100.0 % | 1.000000 |
| mistralai/ministral-3b-2512 / gemini-2.5-flash-lite | 9 | 77.8 % | 0.704918 |
| mistralai/ministral-3b-2512 / lfm3-vl-2b | 9 | 77.8 % | 0.709677 |
| qwen/qwen3.5-9b / gemini-2.5-flash-lite | 7 | 71.4 % | 0.631579 |
| qwen/qwen3.5-9b / lfm3-vl-2b | 7 | 85.7 % | 0.820513 |
| gemini-2.5-flash-lite / lfm3-vl-2b | 10 | 70.0 % | 0.571429 |

- Casos completos de los cinco modelos: **6/10**.
- Unanimidad: **3/6 = 50 %**; intervalo Wilson 95 % **18,76–81,24 %**.
- Fleiss nominal en los seis casos completos: **0,744318**.
- Alfa nominal de Krippendorff con datos disponibles: **0,627792**, diez unidades y 46 juicios.
- El acuerdo perfecto de Ministral/Qwen solo corresponde a **seis** fotografías. No se interpreta como acuerdo en las diez ni como precisión.
- Se guardaron ensayos de pares disponibles y de casos completos; exportaciones JSON/CSV y apertura del ensayo real desde la interfaz verificadas.

La referencia externa sobre ESTOS resultados también pasa con tolerancia `1e-9`: scikit-learn 1.9.1 (diez Cohen), statsmodels 0.15.0 (Fleiss y Wilson) y krippendorff 0.9.0 (alfa), NumPy 2.5.4. Evidencia: `independent-statistics.json` y su script en el perfil de prueba. Python se utiliza solo como referencia de test; la aplicación y su inferencia no lo requieren.

## Inspección cualitativa y límites

La fotografía 10 muestra dos personas ante una proyección de un astronauta. Gemma, Ministral y Qwen describen el motivo proyectado como un cohete; Gemini lo identifica como un astronauta. LFM3 omite elementos destacados en otras fotografías, y su última descripción excede las dos frases solicitadas. Ministral introduce listas, formato y referencias a «celda a rellenar» que no se pidieron. Estas observaciones verificadas sobre las imágenes de prueba muestran límites del contenido y del seguimiento de instrucciones; un resultado admitido por el parser no equivale a una descripción fiel.

No se ha inventado una clasificación humana. No se mide concordancia modelo/investigador ni precisión científica sobre este pequeño ensayo. Esa funcionalidad sí se prueba con fixtures independientes en la suite general. La muestra espacial de diez imágenes, las categorías instrumentales y los valores ausentes impiden extrapolar los porcentajes a cualquier corpus de investigación real.

## Flujo local y evidencias

- Modelos existentes reutilizados y verificados por SHA-256; no se descargan pesos adicionales para este ensayo. LFM3 genera las 20 respuestas en CPU en 123,4 s de tiempo de cola observado, incluida preparación; no es una medida de latencia aislada.
- ONNX indexa las diez imágenes en 80,98 s; búsqueda semántica real en español devuelve los diez registros. No se interpreta el mero retorno como una evaluación de relevancia.
- Cierre/reapertura con APIs desactivadas: títulos, propuestas aceptadas, procedencia, búsqueda literal y semántica conservados.
- Aviso de privacidad retirado del sidebar; Ajustes a 8 px del borde inferior, observado en la ventana real.
- `audit.json`: resultados, propuestas aceptadas, procedencia, estados de las colas, snapshots y costes sin claves.
- `concordancia.json` y `concordancia.csv`: exportaciones nativas.
- `agreement-five-models.png`: ensayo real abierto con cobertura, ausencias y unanimidad.
- `images.json`, `contact-sheet.png` e imágenes numeradas: procedencia y material de prueba.
- Perfil/evidencia: `test-results/authorized-api-audit-20261113/`, excluido de Git. Las credenciales no se incorporan al informe ni a los instaladores.

Los paquetes actuales y la matriz de cinco plataformas se documentan por separado en [VERIFICATION.md](VERIFICATION.md). No hay release pública firmada, notarización, validación CUDA ni auditoría del corpus privado.

La matriz final del producto `6af64a0` pasa **10/10 jobs** en [GitHub Actions](https://github.com/jorgepb96/nodus-imago/actions/runs/43363652116): los cinco targets y sus paquetes, además de IA real en cada uno. El informe general distingue las condiciones de ejecución y las validaciones reservadas para release.
