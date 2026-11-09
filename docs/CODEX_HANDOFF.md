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

- `release/Nodus-Imago-0.1.0-arm64.dmg` — SHA-256 `9172a98435e661f5e27b5410dd4dddb9d463d69c64789200a3d531f4ebcbc33f`.
- `release/Nodus-Imago-0.1.0-x64.dmg` — SHA-256 `1483a6c6d5e6f78a96a5b1543886e3ede62b0ba9e3bb4e1c3cde2a98ffcd9115`.
- Linux ARM64: AppImage `4fab85ad307a55f5f7128a0dbcab079c09c7f2522992b3cc10b4feb992e1d094`, DEB `5c6337214f26edc3b21213b679cf7ce2229b46b429ee17f0d180bbc4da5c9833`, RPM `6ce22e47b64d3827c54ee48a70e8500e41f6acce48fc4ed6936e9c75c5c9fea8`.
- Linux x64: AppImage `72712fc3557c8b5ad860882fac74481c44ea8429c836aeae13a84b6e597d4bb5`, DEB `a1b4b39a8be5cc94421d550a92daeeaed47bf03e890c1e23639d770e5f5006e6`, RPM `c03c072dc22cb2eba0d294d759ab9d782c16b341d7da5158eae725310ffa8426`.
- Windows x64 NSIS: `release/Nodus-Imago-0.1.0-x64.exe` — SHA-256 `b67921d8ccee0cade6963446208df258a5566029f69e9fc96e498ffe8e06e034`. Construido con ABI 148; smoke bajo Wine 11, no Windows nativo; instalador no ejecutado.

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
