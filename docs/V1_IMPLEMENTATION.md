# Implementación de la primera versión

## Estado vigente del candidato `6af64a0` — 13 de noviembre de 2026

Implementadas las fases 0, 1 y 2; retirado el aviso del sidebar y anclado Ajustes abajo (8 px observados). Suite local **103/103**, lint, tipos y build correctos. Los DMG/ZIP actuales de `release/v1-validation-6af64a0` pasan los siete recorridos cada uno; IA real empaquetada ARM64 también pasa sin Python. Evidencia: `final-local-packaged-e2e.log`, `final-local-packaged-ai.log`, manifiesto y SHA en esa carpeta. Son artefactos de prueba sin firma.

La auditoría autorizada de diez fotografías NASA y cinco modelos ha terminado: 100 respuestas reales, 96 propuestas admitidas y cuatro clasificaciones rechazadas correctamente. OpenRouter: **0,004380796 USD reportados**; Gemini: **0,001162600 USD estimados**, con máximo **1 USD independiente por API**. LFM3 y ONNX funcionan en CPU sin Python. Persistencia, procedencia, ensayos y exportación nativos correctos; estadísticas reales contrastadas con bibliotecas independientes a `1e-9`. Detalles, desacuerdos y límites en [AUTHORIZED-AI-AUDIT-2026-11-13.md](AUTHORIZED-AI-AUDIT-2026-11-13.md). No se inventa referencia humana ni se equipara cumplimiento de formato con precisión.

**CI final verde: 10/10 jobs**, [run 43363652116](https://github.com/jorgepb96/nodus-imago/actions/runs/43363652116), producto `6af64a0`. Pasan fuente, paquetes instalados/extraídos e IA real en macOS ARM64, macOS Intel, Windows x64, Linux x64 y Linux ARM64. Publicados diez artefactos de CI vigentes: cinco grupos de instaladores y cinco de evidencia CPU, todos de ese commit. La documentación posterior no cambia el producto probado. Resumen y metadatos descargados en `test-results/ci-final-{run,summary,artifacts}.json`.

Corrección del diagnóstico anterior: limpiar caché no resolvió las teselas en AppImage; el interceptor CDP no capturaba sus peticiones. La regresión aislada del paquete pasa al servir las teselas desde la sesión nativa de Electron, sin quitar aserciones (`scripts/map-tile-fixture.mjs`, run 43362233162). El run posterior pasó los siete recorridos AppImage de ambos Linux y detectó que `dpkg -i` no resolvía `libnotify4`; el instalador de pruebas ahora usa `apt-get install` del DEB para resolver sus dependencias. Los registros anteriores se conservan como historia y sus estados pendientes quedan subordinados a esta sección.

Se mantienen los límites autorizados: sin release pública, firma/notarización, CUDA ni corpus privado. RPM se extrae y ejecuta en Ubuntu; no se afirma instalación en una distribución RPM. El recordatorio de reanudación ya se disparó y fue eliminado; no hay seguimiento programado recurrente.


Encargo vigente: misma carpeta y rama, sin borrar historial, modelos, entornos, resultados ni instaladores. Base ce8f33a. Fase 0 en ed92185 y 98c3be4. La instrucción más reciente exige acumular las implementaciones y realizar una pasada final de pruebas; ningún cambio posterior a la fase 0 se considera validado todavía.

## Fase 1 implementada; validación conjunta en curso

- EmbeddingGemma ONNX Q8 multimodal: revisión daa72c51243991dfcaf9f9137d2c573d8f7790c0, alias Transformers.js 4.3.1 y ONNX Runtime 1.30.0 de Nodus. Texto e imagen utilizan los grafos oficiales; no audio. Manifiesto nuevo calculado con el árbol oficial de Hugging Face; 541.790.748 bytes. Descarga real, integridad, indexación y reapertura ONNX verificadas el 13 de noviembre en macOS ARM64; evidencia `test-results/v1-onboarding-e2e.json`.
- Contratos de Nodus reutilizados con extensión explícita de medios para Imago. Backend PyTorch anterior conservado como experimental; índices no mezclados. La normalización y reducción siguen el contrato MRL de Nodus.
- Inferencia ONNX en proceso Electron/Node aislado, sin red y sin Python. El worker empaquetado se lanza con el ejecutable de Electron; no requiere Node externo.
- Mac Intel: Harrier Q8_0, 1024 dimensiones, pooling last, contexto 8192 y prefijo exacto de Nodus. Para imágenes usa descripciones locales de LFM3 y un contrato diferente. Esta ruta necesita medir RAM y latencia en Intel; no se presume paridad visual con EmbeddingGemma.
- Linux ARM64: asset CPU oficial b11981 verificado mediante la API de releases de llama.cpp: llama-b11981-bin-ubuntu-arm64.tar.gz, 18.428.400 bytes, SHA-256 0ac963f7749054f1f668b2040f52f922a8a9b34cacac34f877878639ce709d5f.
- Gestor/onboarding: grafo de dependencias, licencia/tamaño/destino, consentimiento, espacio, descargas reanudables, SHA, cancelación y estado listo para indexar. Python queda para modos experimentales; literal sigue independiente.

## Validación y publicación pendientes de cerrar

- Mensajes, traducciones y procedencia implementados; comprobación local de traducciones correcta.
- E2E limpio de preparación real y fallos (cancelación, corrupción, red, espacio); paridad ONNX/PyTorch y mediciones Harrier.
- CI en macos-latest ARM64, macos-15-intel, windows-latest x64, ubuntu-22.04 x64 y ubuntu-24.04-arm ARM64. Ejecutables empaquetados y artefactos de prueba actuales; sin release ni firma.
- Publicar el historial actual sin force-push. Comprobación tras fetch: main inicial b567918 SÍ es ancestro del historial local; basta un fast-forward. Se corrige la sospecha previa de historiales no relacionados.

## Fase 2, en commits separados

Implementados en commits separados: editor visual Tiptap con historial/tablas/listas y modo Markdown opcional; árbol persistente de bloques y original importado inmutable; rollups vivos y detección de ciclos; automatizaciones opt-in, outbox duradero, acciones atómicas e historial. Las reglas de copias restauradas quedan desactivadas para exigir nueva activación. Suite local: 101 pruebas. Recorrido nativo `test-results/phase2-e2e.json` correcto en ARM64.

## Cierre obligatorio

Ejecutar la pasada conjunta y corregir fallos hasta donde exista evidencia. Diferenciar verificado, no verificado y pendiente. No ejecutar firma/notarización, APIs comerciales, CUDA ni corpus real. No declarar Windows/Linux compatibles solo por compilar. Mantener las copias antiguas restaurables y conservar los artefactos anteriores en release.

## Evidencia CPU de `6af64a0` en los cinco runners

[Run 43363652116](https://github.com/jorgepb96/nodus-imago/actions/runs/43363652116): los cinco jobs de IA real pasan desde aplicación empaquetada, con descargas limpias y sin Python para inferencia. Los JSON se descargaron en `test-results/ci-final-<runner>-evidence/`.

| Runner | Embeddings | Visión LFM3, dos imágenes | Consulta semántica |
|---|---|---:|---:|
| macos-latest | embeddinggemma2-onnx | 36.073 s | 3.577 s |
| macos-15-intel | harrier-oss-v1-0.6b-q8_0 | 32.767 s | 2.834 s |
| windows-latest | embeddinggemma2-onnx | 9.792 s | 1.204 s |
| ubuntu-22.04 | embeddinggemma2-onnx | 7.822 s | 0.857 s |
| ubuntu-24.04-arm | embeddinggemma2-onnx | 19.818 s | 1.576 s |

Mac Intel: primera indexación de dos imágenes vía descripciones LFM3 → Harrier **63,920 s**; máximo RSS muestreado del proceso Harrier **1.667.665.920 bytes** (28 muestras de un segundo), RSS posterior 1.640.574.976 bytes. No es la memoria total de Electron, LFM3 y Harrier ni garantiza el pico entre muestras. La ruta funciona en ese runner; no se precisa BGE-M3 para este recorrido. Son tiempos observados bajo carga de CI, no una promesa de latencia ni un benchmark del corpus real.
