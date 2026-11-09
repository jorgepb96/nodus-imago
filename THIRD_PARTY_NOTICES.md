# Atribuciones y licencias

## Nodus Research

Nodus Imago adapta código de Nodus Research, © Jorge Pérez Burgueño, bajo **AGPL-3.0-only**. Se conserva la misma licencia en esta aplicación. La revisión de origen y cada módulo están documentados en `docs/REUSE.md`. El motor de paletas, codecs de bases, CSV, exportación, fórmulas, contexto por columna y mensajes visuales se reutilizan como código, no solo como referencia visual.

## Bibliotecas

El inventario reproducible de producción está en `legal/dependency-inventory.json`; las licencias y avisos de los paquetes instalados se incluyen en `legal/THIRD_PARTY_LICENSES.txt`. Se generan desde `package-lock.json` con `npm run licenses`. Los paquetes opcionales específicos de otra arquitectura se resuelven y sus avisos se regeneran en esa plataforma antes de empaquetar.

Componentes principales: React y React DOM (MIT), Lucide (ISC y los avisos derivados de Feather), better-sqlite3 (MIT; SQLite es dominio público), Vite (MIT), Electron (MIT, con avisos de Chromium incluidos en su distribución), exifr (MIT), ExifReader 4.54.0 (MPL-2.0; fuente https://github.com/mattiasw/ExifReader, dependencia npm sin modificar), bmp-js (MIT), adm-zip (MIT), yauzl (MIT), archiver (MIT), Zod (MIT), sharp (Apache-2.0).

sharp se distribuye con libvips y otras bibliotecas nativas. El paquete precompilado `@img/sharp-libvips` usa LGPL-3.0-or-later para las bibliotecas con cláusula de versión posterior. Se incluyen los textos LGPL-3.0 y GPL-3.0 y el listado de versiones y fuentes. Sus bibliotecas compartidas quedan fuera de ASAR y pueden sustituirse; sus avisos se conservan en los paquetes `@img`. Las fuentes y scripts de construcción correspondientes se publican en [libvips](https://github.com/libvips/libvips) y [sharp-libvips](https://github.com/lovell/sharp-libvips), en las versiones identificadas por los paquetes instalados.

HEIC/HEIF se decodifican con `heic-decode` 2.1.0 (ISC; texto en `legal/ISC-heic-decode.txt`) y `libheif-js` 1.23.x (LGPL-3.0, WASM de libheif/libde265; texto LGPL-3.0 en `legal/LGPL-3.0.txt`). La biblioteca WASM se incluye como dependencia separable; sus fuentes están en [heic-decode](https://github.com/catdad-experiments/heic-decode) y [libheif-js](https://github.com/strukturag/libheif-js). El usuario puede sustituirla por otra implementación compatible. La licencia del conjunto de Imago sigue siendo AGPL-3.0-only.

## Modelos y motores opcionales

- **EmbeddingGemma 2**, Google DeepMind: Apache-2.0, repositorio oficial `google/embeddinggemma-2`. Se utilizan pesos originales, sin anunciar una conversión textual como multimodal.
- **SmolVLM2 256 M / 500 M**, Hugging Face: Apache-2.0, repositorios oficiales `HuggingFaceTB/SmolVLM2-*-Video-Instruct`.
- **LFM3-VL-2B**, Liquid AI: **LFM Open License 1.0**. Copia del texto en `legal/LFM-Open-License-1.0.txt`. Incluye condiciones para uso comercial por entidades que alcancen el umbral de ingresos indicado por la licencia. Es una dependencia de pesos opcional y separable; no se presenta como AGPL ni se incluyen sus pesos en el instalador.
- **llama.cpp**, ggml-org y colaboradores: MIT. Motor nativo opcional descargado de una revisión oficial fijada con SHA-256. Sus avisos acompañan al archivo de distribución.
- El adaptador Python usa PyTorch (BSD-3-Clause), torchvision (BSD-3-Clause), Transformers y Sentence Transformers (Apache-2.0), Pillow (HPND) y Accelerate (Apache-2.0). Es un entorno opcional instalado aparte; consulta sus distribuciones para los avisos transitivos. torchvision es necesario para el procesador visual de EmbeddingGemma 2. SmolVLM2 requiere además num2words (LGPL) en el entorno Python opcional.

Las revisiones y digests están en los catálogos del directorio `shared/`. Nunca se descarga ni ejecuta código remoto Python suministrado por un modelo. Las condiciones del proveedor de API corresponden al servicio elegido voluntariamente por el usuario.
