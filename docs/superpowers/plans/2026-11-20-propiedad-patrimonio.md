# Propiedad «Patrimonio»: plan de implementación

> Ejecución: nativa, en esta sesión. Orden pedido por el usuario: todo el código por fases consecutivas (un commit por fase), después los tests, después la validación sobre una copia de solo lectura de la base real, después informe. Un único PR, que no se abre hasta que el usuario lo diga.

**Objetivo:** convertir una selección múltiple en un catálogo de elementos patrimoniales con ficha (Wikidata, coordenadas, tipología, padre), marcas en la foto, mapas y estadísticas.

**Arquitectura:** «Patrimonio» es una `multi_select` con `config.heritage = true` (no un `DatabaseColumnType` nuevo): hereda sin cambios filtros, orden, CSV, IA, fórmulas, unificación y conversión, y pasar de selección múltiple a Patrimonio y vuelta es cambiar la bandera, sin tocar celdas. La ficha vive en `heritage_elements` (por `option_id`), el enlace sigue en `option_authorities`, las marcas en `image_annotations` (+`kind`, +`option_id`).

**Spec:** `docs/superpowers/specs/2026-11-20-propiedad-patrimonio-design.md`

## Restricciones globales

- Ningún dato, nombre, cifra o captura de la base real en el repo; el guard local debe pasar en cada commit.
- Red nunca desde el renderer; Wikidata con `WIKIMEDIA_USER_AGENT` y reintento en 429, como `authoritySearch`.
- Textos en español en el código, traducción inglesa en `src/i18n*.ts`.
- Iconos `lucide-react`.

## Interfaces compartidas (fijadas en la fase 1)

- `shared/heritage.ts`
  - `isHeritageColumn(c: { type; config }): boolean`
  - `type HeritageScheme = { groups: HeritageGroup[] }`, `HeritageGroup = { key; label; labelEn; icon; types: HeritageType[] }`, `HeritageType = { key; label; labelEn; icon? }`
  - `DEFAULT_HERITAGE_SCHEME`, `heritageScheme(config): HeritageScheme`
  - `WIKIDATA_TYPES: Record<string /*Q-id*/, string /*type key*/>`, `typeFromInstances(qids: string[]): { group; type } | null`
  - `type HeritageElement = { optionId; parentId: string | null; group: string | null; type: string | null; latitude: number | null; longitude: number | null; coordSource: "wikidata" | "manual" | null }`
  - `ancestors(id, byId): string[]` (sin ciclos), `wouldCycle(id, parentId, byId): boolean`
  - `resolvedPosition(id, byId): { latitude; longitude; inherited: boolean } | null`
  - `heritageQuery(label): { query: string; place: string | null }`
- `electron/db/heritage.ts` → `class Heritage { elements(columnId): Record<optionId, HeritageElement>; save(columnId, items: HeritageElement[]): number; ... }`
- Comandos: `heritageElements`, `heritageSave`, `heritageCandidates` (main, red), `heritageApplyLinks`, `heritageLinkBatches`, `heritageRevertBatch`, `heritageMap`.

## Fases

1. **Base.** `shared/heritage.ts`; tabla `heritage_elements` y `heritage_link_batches`; `Heritage` (leer, guardar con validación de ciclos y padre de la misma columna); comandos `heritageElements`/`heritageSave`; plantilla «Patrimonio» en el menú «+»; interruptor Patrimonio en el editor de propiedad; icono y etiqueta del tipo; aviso de pérdida al convertir a tipo sin opciones; la unificación fusiona fichas, re-cuelga hijos, mueve marcas y lo deshace.
2. **Ficha y celdas.** Editor de ficha (Wikidata uno a uno, coordenadas con mini mapa, tipo/grupo, padre) desde el editor de opciones; icono de tipología en las etiquetas de la celda; editor del esquema de tipologías.
3. **Wikidata en lote.** `AuthorityLink` gana `instances` (P31) y `partOf` (P361); `heritageCandidates` (bloques de ≤20 elementos, cancelable desde el renderer) con confianza alta/media/baja; diálogo de revisión; aplicar = enlace + coordenadas + tipo + padre en una transacción con instantánea en `heritage_link_batches`; revertir lote.
4. **Marcas en la foto.** Migración `image_annotations.kind`/`option_id`; puntos (`w=h=0`); modo Patrimonio del visor (punto / rectángulo / buscador de elemento); marcar añade a la celda; quitar de la celda con marcas pregunta y las borra.
5. **Mapas.** Selector «Situar las fotos según» (ubicación o Patrimonio, con respaldo); herencia de coordenadas del ancestro; sin flecha para posiciones de patrimonio; recuentos de grupo por registro distinto; modo «Patrimonio» con un marcador por elemento, icono, tamaño, filtro grupo/tipo, interruptor de partes y panel del elemento.
6. **Estadísticas y filtros.** `StatSpec.heritageLevel` y `includeParts`; criterios «es de tipo», «es de grupo», «incluye la parte de», «tiene marca», «sin enlazar».
7. **Exportación e i18n.** QID en exportaciones; marcas con elemento en W3C; traducciones.

Después: tests (sintéticos, en `tests/heritage.test.ts`), `npm run verify`, validación con copia de la base real en el directorio temporal, informe.
