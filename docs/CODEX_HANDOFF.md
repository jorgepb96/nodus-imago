# Handoff para revisión de Codex

**Repositorio:** `/Users/jorgepb96/Documents/GitHub/nodus-imago`  
**Rama:** `codex/imago-desktop`  
**HEAD de referencia:** rama `codex/imago-desktop`; último commit funcional `6bce161` (`Validate SmolVLM2 500M runtime`), más los commits de documentación del handoff que vengan después.  
**Estado de trabajo:** limpio; los instaladores viven en `release/` y están ignorados por Git.  
**Fecha de la evidencia:** 9 de noviembre de 2026.

No he encontrado comentarios de Codex accesibles en el repositorio, refs, PRs/Issues o estado local. Este documento recoge los puntos abiertos de la auditoría y el estado real; si Codex dejó comentarios en la interfaz, deben cruzarse contra esta lista.

## Estado de cierre

La implementación y las pruebas locales están completas para lo que puede verificarse en este equipo. La validación completa del objetivo sigue **bloqueada por el entorno**, no por una decisión de producto:

- No hay un host ni runner Windows accesible desde esta sesión para ejecutar el instalador NSIS y la app en Windows nativo. Wine 11 solo permitió un smoke de la app, no del instalador.
- No hay claves/cuentas de APIs facturables ni hardware CUDA para validar esas rutas.
- No hay un corpus real de 10.000 fotografías ni presupuesto para ejecutar LFM3 sobre una columna completa de miles de celdas.
- No hay credenciales de firma/notarización macOS/Windows.

No se declara completado lo que depende de esas validaciones externas.

## Comprobaciones ejecutadas

- `npm run verify`: typecheck, ESLint, **57/57 pruebas** y build.
- E2E macOS ARM64 sin empaquetar, empaquetado y desde el DMG montado: pasa, incluida la vista Árbol.
- E2E macOS x64 bajo Rosetta, empaquetado y desde el DMG: pasa.
- E2E Linux ARM64 y Linux x64 empaquetados en Docker con Xvfb: pasan, incluida la vista Árbol.
- Validación real con LFM3/EmbeddingGemma: `node scripts/validate-models.mjs` pasa; informe en `docs/benchmarks/real-models-macos-arm64.json`.
- Benchmark sintético de 10.000 registros: `npm run benchmark` pasa; no es un corpus real.
- El E2E comprueba el cambio persistido del icono claro/oscuro en macOS.

## Cambios principales desde la base `9716471`

- Pool persistente de `llama-mtmd-cli` en modo chat, sin HTTP, con `--json-schema` en clasificación y `--image-max-tokens 280`.
- Parser estricto de razonamiento, cabeceras, banners y sobres `minimax:tool_call`.
- HEIC/HEIF mediante `heic-decode`/`libheif-js` WASM, con miniatura y prueba real.
- Fórmulas aritméticas, estadísticas y expresiones seguras; recetas importadas no editables se conservan.
- Equivalencias de campos entre bases con filtro OR y limpieza al borrar columnas/bases.
- Columna de destino al importar imágenes y movimiento/borrado masivo.
- Notion ZIP con CSV, imágenes y páginas Markdown planas con carpeta de origen.
- Icono de objetivo fotográfico con la N canónica de Nodus; variantes clara/oscura y Dock mac adaptativo.
- macOS x64 reproducible con `npm run dist:mac:x64`: aísla sharp x64 y better-sqlite3 ABI 148.
- Cobertura de traducciones `t()` protegida por prueba: 0 claves visibles sin inglés.

## Modelos y backend

- EmbeddingGemma 2: revisión `f9972ac22e696a105c482202646979e33e4b5a1e`, 512 dimensiones, CPU FP32, Sentence Transformers 6.2, torch 2.15.0, torchvision 0.29.2.
- LFM3-VL-2B: revisión `b36554cfd35854b06429900131730cd80f092cdb`, llama.cpp `b11981`, CPU, Q4_K_M, proyector F16.
- Python 3.13 en `.venv`; el entorno Python y los pesos son externos al instalador.

## Artefactos

Todos sin firma ni notarización.

- `release/Nodus-Imago-0.1.0-arm64.dmg` — SHA-256 `6568518089d8774d46fcbcfce24aeb584d8a6aa6b198c24b8909796f6ff34d3b`.
- `release/Nodus-Imago-0.1.0-x64.dmg` — SHA-256 `1933c999b46f35e0a0f79445717ec3bdb7c35a5bb45b5fe9ee467375859b8935`.
- Linux ARM64: AppImage `3114ed3fee8ac176f12ed7367289a14d35b4cef077161601ef2f32238d5f6e59`, DEB `2c74f6aa1bd8f0142195fb6931bec58d7417e6f9a95dbbd02fe53888e1414340`, RPM `9d6705edfd312b6c3fe54a52330dfa6ea8ce0d207da9144f7ba12f289096c712`.
- Linux x64: AppImage `41262cbc72bb1cc0fd90b0c441d3a693d47e667eb6ca9820d2af56148f9cd098`, DEB `4525413acd73b83a16c0050c8a2a9c0182f204205c3f7ad8ecdf07323c999526`, RPM `455fcb8f422b04b1ba56dd95910c987a1fcc07833e7fb05831a759025250ee0f`.
- Windows x64 NSIS: `release/Nodus-Imago-0.1.0-x64.exe` — SHA-256 `78cd388d2d10c7784cae92bc6c91d10246350c4e6f13ec9a7e315edf90b8f572`. Construido con ABI 148; smoke bajo Wine 11, no Windows nativo; instalador no ejecutado.

## Límites que no deben declararse resueltos

- Windows x64 no se ha ejecutado en Windows nativo en este equipo. Hay un smoke bajo Wine 11 (UI, SQLite/IPC, creación de base y registro); el workflow de CI incluye ahora un E2E sobre la app Windows empaquetada en `windows-latest`, pero no se ha lanzado en un runner desde aquí. El instalador NSIS no se ha probado. macOS x64 sí se ejecutó bajo Rosetta.
- No se han probado APIs facturables, CUDA, un corpus de 10.000 fotografías reales ni una columna LFM3 completa de miles de celdas. SmolVLM2 256M y 500M se ejecutaron en CPU; en inglés ambos describieron el Golden Gate, pero la calidad multilingüe no está validada. EmbeddingGemma 2 sí se probó en Metal/MPS con texto e imagen; LFM3 sigue en CPU.
- HEIC conserva ahora el EXIF del contenedor mediante ExifReader; el editor de texto enriquecido es Markdown con vista previa, no WYSIWYG; Notion conserva la relación padre y ofrece vista Árbol, pero no reconstruye el árbol de bloques ni bases embebidas.
- Python, pesos y runtimes nativos son externos; los instaladores no están firmados ni notarizados.
- E2E Linux se ejecutó en Docker/QEMU con Xvfb, no en hardware Linux nativo.
- El icono dinámico se limita al Dock de macOS; Windows/Linux usan el icono empaquetado.

## Reproducción

```sh
export PATH=/Users/jorgepb96/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run verify
npm run test:e2e
IMAGO_E2E_EXECUTABLE="$PWD/release/mac-arm64/Nodus Imago.app/Contents/MacOS/Nodus Imago" npm run test:e2e
node scripts/validate-models.mjs
npm run benchmark
```

Para Linux: ejecutar los paquetes en Docker con Xvfb y `IMAGO_E2E_NO_SANDBOX=1`; ARM64 en Docker arm64, x64 con `--platform linux/amd64`.

## Prompt para Codex

```text
Revisa Nodus Imago en /Users/jorgepb96/Documents/GitHub/nodus-imago, rama codex/imago-desktop, HEAD actual; último commit funcional 6bce161. No crees otra copia, no cambies de rama, no ejecutes git clean/reset --hard y no borres modelos, .venv, test-results ni release.

Lee docs/STATUS.md, docs/MODELS.md, docs/CODEX_HANDOFF.md y README.md. Contrasta la implementación real con esas afirmaciones. Revisa especialmente:
- Pool persistente de llama-mtmd-cli: /clear, /image, prompt por stdin, JSON schema, cierre por inactividad, límites de concurrencia y parser de minimax:tool_call.
- Paquetes macOS x64: sharp-darwin-x64, better-sqlite3 ABI 148, script scripts/package-mac-x64.mjs y conservación de symlinks.
- Icono adaptativo: N canónica de Nodus, build/icon-light.svg, build/icon-dark.svg, IPC imago:app-icon y persistencia del Dock.
- Fórmulas, equivalencias, importación de imágenes con columna de destino, movimiento masivo, Notion Markdown y HEIC.
- Cobertura de traducciones y pruebas.

Comprobaciones:
export PATH=/Users/jorgepb96/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH
npm run verify
npm run test:e2e
IMAGO_E2E_EXECUTABLE='/Users/jorgepb96/Documents/GitHub/nodus-imago/release/mac-arm64/Nodus Imago.app/Contents/MacOS/Nodus Imago' npm run test:e2e
node scripts/validate-models.mjs

Entrega hallazgos P0/P1/P2 con archivo, líneas, evidencia reproducible y separación entre verificado y no verificado. No reescribas la implementación sin pedir confirmación. Comprueba que Windows sigue sin ejecutar, que Notion no reconstruye el árbol de bloques, que la vista Árbol solo cubre relaciones a sí mismas y que el editor es Markdown con vista previa, no WYSIWYG, y que HEIC sí extrae EXIF de contenedor. Si encuentras una contradicción en docs/STATUS.md, señálala.
```
