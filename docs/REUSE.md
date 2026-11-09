# Reutilización efectiva de Nodus Research

Fuente inspeccionada en el checkout local `../nodus`, revisión **393fb7b23ca893cdafceb5dac7e614c23a2072fe** (Nodus 5.16.1). No es una dependencia en tiempo de ejecución ni se ha modificado ese repositorio.

## Código adaptado o reutilizado

| Nodus | Imago | Adaptación |
| --- | --- | --- |
| `shared/databases.ts` | misma ruta | Mismos tipos, IDs y codecs; referencias a proveedores se conservan como datos sin importar el sistema general de Nodus |
| `shared/databaseProperties.ts`, `databaseCellStorage.ts` | mismas rutas | Codecs estructurados y almacenamiento tipado |
| `shared/databaseCsv.ts` | misma ruta | Detección de tipos, opciones e importación sin pérdida silenciosa |
| `shared/databaseBulk.ts` | misma ruta + `shared/imageMatching.ts` | Códigos y plantillas; se sustituye la política de primera coincidencia por detección de referencias ambiguas |
| `shared/databaseExport.ts` | misma ruta | Serialización tabular y protección contra fórmulas CSV |
| `shared/databaseFormula*.ts`, `databaseFilters.ts`, `databaseQuery.ts`, `databaseViewConfig.ts` | mismas rutas | Modelo y evaluador de fórmulas, condiciones y tipos de vistas; no se importa la navegación completa |
| `electron/extraction/tabular.ts` | `shared/csvParser.ts` | Parser CSV y detección de delimitador aislados |
| `electron/export/databaseExport.ts` | `electron/export/xlsx.ts` | Escritor OOXML sin dependencias de páginas ni automatizaciones |
| `shared/databaseAi.ts` | misma ruta | Construcción de contexto, instrucciones por celda y presets; tipo de idiomas aislado |
| `shared/imageAnalysis.ts` | `shared/visionContent.ts` | Mensajes multimodales OpenAI compatibles y Anthropic |
| `src/theme/themes.mjs`, `tokens.css` | mismas rutas | Paletas, rampas, contraste y tokens; aplicación al renderer especializado |
| `electron/secrets/secretStore.ts` | `electron/secrets/store.ts` | Patrón de secretos por proveedor, cifrado del sistema y escrituras atómicas; sin migración ni lectura del perfil de Nodus |
| `shared/providers.ts`, `electron/ai/providers.ts` | `shared/aiConfig.ts`, `electron/ai/apiProviders.ts` | Identificadores y endpoints de proveedores; transporte reducido a inferencia visual y consulta explícita del catálogo |
| `electron/ai/databaseAiColumn.ts` | `electron/ai/engine.ts` | Orquestación por propiedad y fuente de imagen; cola persistente, propuestas y protección de anotaciones añadidas |
| — (nuevo) | `shared/visionOutput.ts` | Parser estricto para la salida real de LFM3: razonamiento, cabeceras, sobres `minimax:tool_call` y vocabulario de clasificación. No se copia de Nodus; se añade tras la validación con pesos |

## Rutas estudiadas que no se copiaron completas

- `electron/db/databasesRepo.ts`: EAV, opciones, relaciones, valores canónicos y consultas. Su dependencia de vaults cruzados, páginas, cálculos, investigación y automatizaciones hace inadecuado importarlo entero. Imago conserva sus formatos y tablas fundamentales en un repositorio independiente.
- `shared/api/databases.ts`, `electron/ipc/databases.ts`, `electron/preload/databases.ts`: separación dominio/IPC/preload. Imago expone una superficie explícita y validada para las funciones utilizadas.
- `electron/import/notionZipImport.ts`: límites del archivo, saneamiento de rutas, CSV y resolución de adjuntos. Se adapta la parte tabular y visual; no se copian los servicios de páginas.
- `src/views/DatabasesView.tsx`, `src/components/dbGrid.tsx`: edición por propiedad, selección y vistas sobre los mismos datos. Están acoplados al API general, chat, vaults y muchos diálogos. Se implementa una composición menor utilizando el dominio y evaluadores originales, sus tokens, dimensiones y patrones.
- `docs/appearance.md`, `src/index.css`: modo y paleta independientes, rampas neutral/indigo, bordes, controles y jerarquía. La hoja completa de Nodus contiene muchos módulos ajenos; se reutiliza el motor y una hoja especializada de Imago.
- Configuración de Vite, preloads CJS autocontenidos, Electron seguro, `better-sqlite3`, construcción y targets de Nodus. Imago usa identificadores, recursos y publicación propios.
- Motor local de Nodus: separación modelo/proyector y runtimes por plataforma. La revisión ONNX de EmbeddingGemma que usa Nodus es textual; **no se anuncia como multimodal en Imago**. El backend visual emplea la implementación oficial sin conversión de pesos.

© Jorge Pérez Burgueño. Todos los módulos reutilizados de Nodus mantienen **AGPL-3.0-only**. Los encabezados de los módulos y la licencia raíz conservan esta atribución.
