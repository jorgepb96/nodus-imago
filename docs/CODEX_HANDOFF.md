# Handoff para revisión de Codex

**Repositorio:** `/Users/jorgepb96/Documents/GitHub/nodus-imago`  
**Rama:** `codex/imago-desktop`  
**HEAD:** rama `codex/imago-desktop`; commit base `353c43d` (`Guard complete translation coverage`) más este handoff.  
**Estado de trabajo:** limpio; los instaladores viven en `release/` y están ignorados por Git.  
**Fecha de la evidencia:** 9 de noviembre de 2026.

No he encontrado comentarios de Codex accesibles en el repositorio, refs, PRs/Issues o estado local. Este documento recoge los puntos abiertos de la auditoría y el estado real; si Codex dejó comentarios en la interfaz, deben cruzarse contra esta lista.

## Comprobaciones ejecutadas

- `npm run verify`: typecheck, ESLint, **56/56 pruebas** y build.
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

- `release/Nodus-Imago-0.1.0-arm64.dmg` — SHA-256 `0f70f1a62052dab9914a51f7494e6053a9ffef7e655b84ac492b1b2e4ac773f2`.
- `release/Nodus-Imago-0.1.0-x64.dmg` — SHA-256 `465b7eb44ddca32f22e020df5ed3cdcfa28999368c3656309bda452e21cc0add`.
- Linux ARM64: AppImage `7ad85cdfef5befa057329656b327f4d569ae8fd902799c4f2c9909771e28f824`, DEB `a5ec24847ffcdb818f423d9eafcb75f9f21cb6f5fa2846811e8c9a20bb6bea94`, RPM `f71bbb3853d5e61327d7fb3abbf4ca1340f5d938c4fd029655c34000f7f4532f`.
- Linux x64: AppImage `f147d5227090872505cf5a2911d15b36cd51c07d12d34dd605e259ea022e6cae`, DEB `3a791f4e6ef5b44ddf4b3cb07684b8626c6534658ae9ee2b9f7b0112ea6b27a2`, RPM `808fdb1c0468008c854c72c88e5d2029c2d17e8dfed7cbff8efd8e0c4204dbe8`.
- Windows x64 NSIS: `release/Nodus-Imago-0.1.0-x64.exe` — SHA-256 `a1f0b138a29544b5b60c850537c268697c44d2edaf2072925e6ad4d8b8876361`. Construido con ABI 148; smoke bajo Wine 11, no Windows nativo; instalador no ejecutado.

## Límites que no deben declararse resueltos

- Windows x64 no se ha ejecutado en Windows nativo en este equipo. Hay un smoke bajo Wine 11 (UI, SQLite/IPC, creación de base y registro); el workflow de CI incluye ahora un E2E sobre la app Windows empaquetada en `windows-latest`, pero no se ha lanzado en un runner desde aquí. El instalador NSIS no se ha probado. macOS x64 sí se ejecutó bajo Rosetta.
- No se han probado APIs facturables, CUDA, SmolVLM2, un corpus de 10.000 fotografías reales ni una columna LFM3 completa de miles de celdas. EmbeddingGemma 2 sí se probó en Metal/MPS con texto e imagen; LFM3 sigue en CPU.
- HEIC conserva ahora el EXIF del contenedor mediante ExifReader; el editor de texto enriquecido no es WYSIWYG; Notion no reconstruye un árbol de bloques ni bases embebidas.
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
