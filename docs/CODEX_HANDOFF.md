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

- `release/Nodus-Imago-0.1.0-arm64.dmg` — SHA-256 `e05c106afb72ff0f8dcc83eddf27542160a338902d77e16cead3cdd098c4492f`.
- `release/Nodus-Imago-0.1.0-x64.dmg` — SHA-256 `406971bee57c5dd1508537cc44680a75e9850e7300ebaa78c6048404ec716f58`.
- Linux ARM64: AppImage `a271ac3232cc0dc6859968ccee4b6d4fc0932492961f85d434e0260d464b7b31`, DEB `9da500ea8b43c1810c76006d3e59c3e49b1866415bd16458ea1f9f4165c1d642`, RPM `ebb3a147383fab923788ab9b8cce5e945ed19a8ee2fb4b1d040f362e36ab0f57`.
- Linux x64: AppImage `99a37a16663d3df2a2be01395d90b3fc0aa40e34d9a495dc08ed9db1137af84a`, DEB `8ecfcc21876703c0a549a0b8ff169b91080933ff8e611f42f68ff7770d3899b1`, RPM `b440f80f2f6ef5d468788a092fc6238647c11bfeac13d0352e4f9f1e5062a032`.
- Windows x64 NSIS: `release/Nodus-Imago-0.1.0-x64.exe` — SHA-256 `f5baa0fc905499326090ec6fe26d93598cdd1bcbff393a64b2526e172089dc04`. Construido con ABI 148; no ejecutado.

## Límites que no deben declararse resueltos

- Windows x64 no se ha ejecutado; solo está construido. macOS x64 sí se ejecutó bajo Rosetta.
- No se han probado APIs facturables, Metal/CUDA, SmolVLM2, un corpus de 10.000 fotografías reales ni una columna LFM3 completa de miles de celdas.
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
