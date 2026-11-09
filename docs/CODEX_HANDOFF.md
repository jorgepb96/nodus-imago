# Handoff para revisión de Codex

**Repositorio:** `/Users/jorgepb96/Documents/GitHub/nodus-imago`  
**Rama:** `codex/imago-desktop`  
**HEAD:** rama `codex/imago-desktop`; commit base `353c43d` (`Guard complete translation coverage`) más este handoff.  
**Estado de trabajo:** limpio; los instaladores viven en `release/` y están ignorados por Git.  
**Fecha de la evidencia:** 9 de noviembre de 2026.

No he encontrado comentarios de Codex accesibles en el repositorio, refs, PRs/Issues o estado local. Este documento recoge los puntos abiertos de la auditoría y el estado real; si Codex dejó comentarios en la interfaz, deben cruzarse contra esta lista.

## Comprobaciones ejecutadas

- `npm run verify`: typecheck, ESLint, **55/55 pruebas** y build.
- E2E macOS ARM64 sin empaquetar, empaquetado y desde el DMG montado: pasa.
- E2E macOS x64 bajo Rosetta, empaquetado y desde el DMG: pasa.
- E2E Linux ARM64 y Linux x64 empaquetados en Docker con Xvfb: pasan.
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

- `release/Nodus-Imago-0.1.0-arm64.dmg` — SHA-256 `674f55a650f4b517d23f51122775cb582db1414b519ee707854cec2e86785b53`.
- `release/Nodus-Imago-0.1.0-x64.dmg` — SHA-256 `9931174b3e1172296153829f9f9b89f8544b25ec77a6d00db43b00d9b2d8e4c9`.
- Linux ARM64: AppImage `c1d2f082a5877bf17ee834e5b4941ffa48001d0d278520ddd6e18f785196e908`, DEB `e083c9169e827f4efba5580d08a005920bc4f5ba42f1cb19c3b46c16482cbfdb`, RPM `39e8dab18d5ca1053948e37981c059ea3de77b10fd0197b929a2bb20537001b3`.
- Linux x64: AppImage `8c3f8a37249dad629b9b12157df303eb99ceec20b408802e26a11c0dbdc818c0`, DEB `ff7438fc1f679eb6e314466eb0044342d026b9c4de87e481a4d1bb93c1e14910`, RPM `728ed29cc37e3933d565f6c633563bbfbc43ac18467049bdf4db661c1d5d97bb`.
- Windows x64 NSIS: `release/Nodus-Imago-0.1.0-x64.exe` — SHA-256 `27900cf4898c39f53f426f74e4c5337d18a1f451e13ee83cec3a73ea2925c741`. Construido con ABI 148; smoke bajo Wine 11, no Windows nativo; instalador no ejecutado.

## Límites que no deben declararse resueltos

- Windows x64 no se ha ejecutado en Windows nativo en este equipo. Hay un smoke bajo Wine 11 (UI, SQLite/IPC, creación de base y registro); el workflow de CI incluye ahora un E2E sobre la app Windows empaquetada en `windows-latest`, pero no se ha lanzado en un runner desde aquí. El instalador NSIS no se ha probado. macOS x64 sí se ejecutó bajo Rosetta.
- No se han probado APIs facturables, CUDA, SmolVLM2, un corpus de 10.000 fotografías reales ni una columna LFM3 completa de miles de celdas. EmbeddingGemma 2 sí se probó en Metal/MPS con texto e imagen; LFM3 sigue en CPU.
- HEIC no conserva EXIF; el editor de texto enriquecido no es WYSIWYG; Notion no reconstruye un árbol de bloques ni bases embebidas.
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
Revisa Nodus Imago en /Users/jorgepb96/Documents/GitHub/nodus-imago, rama codex/imago-desktop, commit base 353c43d y el commit de este handoff. No crees otra copia, no cambies de rama, no ejecutes git clean/reset --hard y no borres modelos, .venv, test-results ni release.

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

Entrega hallazgos P0/P1/P2 con archivo, líneas, evidencia reproducible y separación entre verificado y no verificado. No reescribas la implementación sin pedir confirmación. Comprueba que Windows sigue sin ejecutar, que HEIC no conserva EXIF, que Notion no reconstruye bloques y que el editor no es WYSIWYG; si encuentras una contradicción en docs/STATUS.md, señálala.
```
