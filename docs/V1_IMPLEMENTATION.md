# Implementación de la primera versión

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
- Publicar la rama actual conservando ambos historiales. El remoto no está vacío: main contiene un commit inicial b567918, no ancestro del historial local. No sobrescribir main ni forzar pushes.

## Fase 2, en commits separados

Implementados en commits separados: editor visual Tiptap con historial/tablas/listas y modo Markdown opcional; árbol persistente de bloques y original importado inmutable; rollups vivos y detección de ciclos; automatizaciones opt-in, outbox duradero, acciones atómicas e historial. Las reglas de copias restauradas quedan desactivadas para exigir nueva activación. Suite local: 100 pruebas. Recorrido nativo `test-results/phase2-e2e.json` correcto en ARM64.

## Cierre obligatorio

Ejecutar la pasada conjunta y corregir fallos hasta donde exista evidencia. Diferenciar verificado, no verificado y pendiente. No ejecutar firma/notarización, APIs comerciales, CUDA ni corpus real. No declarar Windows/Linux compatibles solo por compilar. Mantener las copias antiguas restaurables y conservar los artefactos anteriores en release.
