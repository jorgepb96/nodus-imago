# Handoff para revisión de Codex

**Revisado por Codex el 12 de noviembre de 2026.** Este documento conserva el handoff histórico de DeepSeek. Los hallazgos, correcciones, pruebas actuales y límites están en [VERIFICATION.md](VERIFICATION.md); sus resultados prevalecen sobre las afirmaciones y hashes antiguos de este archivo.

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

- `npm run verify`: typecheck, ESLint, **86/86 pruebas** y build.
- E2E macOS ARM64 sin empaquetar, empaquetado y desde el DMG montado: pasa, incluidos filtros, mapa, lugares, concordancia y vista Árbol.
- E2E macOS x64 bajo Rosetta: pasa salvo la IA real x64, que no se declara pasada por el store de modelos ARM64.
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

- `release/Nodus-Imago-0.1.0-arm64.dmg` — SHA-256 `05fbc92140e6c77c664398aec481842e93cf55a71f967f8f554b4732e9f0b9c8`.
- `release/Nodus-Imago-0.1.0-x64.dmg` — SHA-256 `48d5980bff71d9430b279a82f3efca45e685870cfe1d78bd1d31dbbcdcd92b8a`.
- Linux ARM64: AppImage `f8b97f56bcb27293be48f06b816246949cabbae358ede58ed4f5ef1ac759ad62`, DEB `affbe0f98eda0fb9499edbef97c477656eecc7ead7dfe88a4a36a931d8a8748f`, RPM `6cbe2d43ff72fabdf9b7de0bb4d3ab2cdd18fd0769536896c070045de812c1a3`.
- Linux x64: AppImage `6b5c91f145a296acc7ea028ff33681d40ea262ac6448e7bfcb546e699953f7fa`, DEB `1ea96a3100386cb4896e0aced2d493f12a0d23aa461e33d3158f47a92dd799c9`, RPM `2406555bbde81ed811e8fbfa24976b5b75705911f7fdb02e735e63b6cccca732`.
- Windows x64 NSIS: `release/Nodus-Imago-0.1.0-x64.exe` — SHA-256 `454428ee13bfd568fb9ac97766b5bfd9126c2406020e775fa61af53d3d13f517`. Construido con ABI 148; smoke bajo Wine 11, no Windows nativo; instalador no ejecutado.

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

## Continuidad de implementación v1

Se conserva el repositorio, rama `codex/imago-desktop`, historial local y artefactos previos. Base `ce8f33a`; fase 0 corregida y verificada con 89 pruebas, typecheck, lint, build y recorridos general/auditoría. Las correcciones previas de DeepSeek en filtros, Leaflet, modelos corruptos e ignore se conservan. La instrucción más reciente pide implementar lo pendiente y ejecutar las siguientes pruebas juntas al final. No ejecutar firma/notarización, APIs comerciales, CUDA ni corpus real; no publicar una release.
