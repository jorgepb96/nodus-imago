# Propiedad «Patrimonio»: diseño

Fecha: 2026-11-20 · Estado: borrador para aprobación

## Intención

Muchas colecciones fotográficas ya etiquetan qué edificio, monumento, calle u obra de arte aparece en cada foto, pero como simples opciones de texto. Esta propiedad convierte cada etiqueta en un **elemento patrimonial identificado**: con identidad externa (Wikidata), coordenadas propias, tipología con icono y relación «forma parte de» con otros elementos. Con eso se consiguen tres cosas:

1. **Mapa más preciso.** Las fotos que hoy solo tienen una ubicación de ciudad (todas apiladas en el mismo punto) pueden situarse en el monumento que muestran.
2. **Estadística por elemento.** Cuántas fotos muestran cada monumento, con cuáles aparece, cómo evoluciona en el tiempo; contando o no sus partes.
3. **Estadística por tipología.** Religioso, civil, defensivo…; pintura, escultura… con los mismos gráficos que ya existen.

En cada foto un elemento puede **marcarse con un punto**, **con un rectángulo** o **no marcarse** (solo consta que aparece). Las tres formas cuentan igual para el mapa y la estadística.

## Objetivos

- Nuevo tipo de propiedad `heritage` («Patrimonio») que se comporta como una selección múltiple (filtros, orden, CSV, estadísticas existentes siguen funcionando) y cuyas opciones tienen ficha de elemento.
- Convertir una selección múltiple existente en Patrimonio **sin perder ni un valor** (mismos ids de opción, mismas celdas), y volver atrás.
- Vincular elementos a Wikidata uno a uno y **en lote con revisión**, obteniendo coordenadas, tipología sugerida y padre sugerido.
- Crear y editar elementos a mano (coordenadas, tipo, padre) para lo que no está en Wikidata o ha desaparecido.
- Jerarquía «forma parte de» entre elementos de la misma propiedad.
- Esquema de tipologías de dos niveles (grupo → tipo) con iconos, de serie y editable.
- Marcar elementos en la foto con punto o rectángulo, ligados al elemento.
- Mapa de fotos con selector de fuente: situar las fotos por su ubicación (cámara) o por sus elementos patrimoniales.
- Mapa de patrimonio aparte: un punto por elemento.
- Estadísticas a nivel Elemento / Tipo / Grupo, con interruptor «incluir sus partes».

## No objetivos (esta versión)

- Catálogos descargados (MonumentosES, OpenStreetMap/Overpass, catálogos autonómicos). Quedan para una versión posterior.
- Detección automática de monumentos por IA en las fotos.
- Calcular la importancia visual (proporción de la foto). El rectángulo guarda su tamaño para poder hacerlo después, pero no se calcula ni se muestra.
- Polígonos.
- Icono personalizado por elemento (el icono viene del tipo o del grupo).
- Un catálogo compartido entre bases de datos.
- Inferir la posición de la cámara a partir del monumento.

## Antiobjetivos (sería un fracaso aunque funcione)

- Perder etiquetas, enlaces de autoridad o anotaciones al convertir la propiedad o al editar opciones.
- Hacer peticiones de red sin una acción explícita del usuario, o desde el renderer.
- Mezclar sin avisar «dónde se hizo la foto» con «qué muestra»: la fuente usada en el mapa siempre es visible y elegible.
- Ralentizar la tabla, el mapa o las estadísticas en bases de miles de registros.
- Que cualquier dato, nombre, cifra o captura de la base de investigación del usuario llegue al repositorio (ver Restricciones).

## Restricciones

- **Confidencialidad absoluta de la base real.** Las pruebas con la base del usuario se hacen sobre una **copia de solo lectura fuera del repositorio** (directorio temporal de la sesión), sin escribir nunca en la base original. Ni la copia, ni consultas con resultados, ni nombres de elementos, ni cifras, ni capturas se commitean o se pegan en issues/PR. Los tests y fixtures del repo usan datos inventados. El guard local (`imago-private-guard.sh` + sondas) debe pasar en cada commit; si bloquea algo, se quita el dato, no se salta el guard.
- Red nunca desde el renderer: desde el proceso principal o desde el worker de la cola (como las descargas de modelos), con la misma política que `authoritySearch` (`electron/main.ts`): User-Agent de Wikimedia, reintentos en 429, sin datos del usuario en las URLs salvo el texto buscado. Lo obtenido se guarda en la base: tras vincular, todo funciona sin conexión.
- Coherencia con el sistema actual: tipos en `shared/databases.ts`, almacenamiento de celdas en `shared/databaseCellStorage.ts`, criterios en `shared/viewCriteria.ts` → `electron/db/viewQuery.ts`, estadísticas en `shared/statistics.ts`, iconos `lucide-react`, i18n es/en.
- Wikidata es CC0; los datos traídos se pueden guardar sin restricciones.

## Enfoques considerados

- **A. Nuevo tipo de propiedad «Patrimonio» sobre las opciones (elegido).** La celda guarda ids de opción como `multi_select`; la ficha de cada elemento vive en una tabla aparte. Reutiliza filtros, orden, estadísticas, CSV y los enlaces de autoridad. La conversión desde una selección múltiple conserva todo. Contrapartida: el catálogo pertenece a la propiedad; usarlo en otra base exige copiarlo.
- **B. Catálogo como base de datos aparte + propiedad Relación.** Fichas más ricas y reutilizables, pero hoy ni las estadísticas ni el mapa leen relaciones, la migración convierte opciones en registros y las marcas en la foto apuntarían a otra base. Mucho más trabajo. Descartado por coste.
- **C. Metadatos en `config_json` de la selección múltiple, por etiqueta** (como `optionLinks`). Barato, pero se pierde al renombrar y no permite consultar jerarquía ni tipología en SQL. Descartado.

El usuario eligió **A**.

## Diseño

### 1. Tipo y valores

- `heritage` se añade a `DatabaseColumnType` y a `COLUMN_TYPES` (etiqueta «Patrimonio», `hasOptions: true`, icono `Landmark`).
- El valor de celda es idéntico al de `multi_select` (array JSON de ids de opción, en `value_json`). En todos los sitios donde `multi_select` tiene tratamiento propio (codecs, `viewCriteria` kind, `viewQuery`, `MULTI_TYPES`/`CATEGORICAL_TYPES`, CSV, export, fórmulas, embeddings de registro, automatizaciones, sugerencias, IA de clasificación) `heritage` se trata igual salvo donde este documento diga otra cosa. El constructor debe recorrer los puntos de contacto que ya tiene `multi_select` (grep) y decidir uno a uno.
- `convertColumn` admite `multi_select ↔ heritage` conservando opciones, ids y celdas.
- Al pasar de `heritage` a `multi_select`, `select` o `status` (se conservan los ids de opción), la ficha de elementos y las marcas **no se borran**: dejan de mostrarse y reaparecen al volver a Patrimonio. Al pasar a `select`, las marcas de los elementos que se caen de la celda también se conservan ocultas.
- Al pasar a un tipo sin opciones (texto, etc.) las opciones desaparecen y con ellas la ficha y las marcas: el diálogo de conversión avisa de cuántos elementos enlazados y cuántas marcas se perderán antes de aplicar. No se intenta recuperar por etiqueta.
- Plantilla lista para usar en el menú «+»: «Patrimonio», con el esquema de tipologías por defecto (igual que las plantillas de proceso fotográfico y tipo de cámara).

### 2. Ficha de elemento

Nueva tabla (nombre orientativo):

```
heritage_elements(
  option_id TEXT PRIMARY KEY,          -- la opción de la propiedad
  column_id TEXT NOT NULL,
  parent_option_id TEXT,               -- «forma parte de», misma columna
  group_key TEXT, type_key TEXT,       -- tipología (claves del esquema)
  latitude REAL, longitude REAL,
  coord_source TEXT,                   -- 'wikidata' | 'manual'
  updated_at TEXT NOT NULL
)
```

- El enlace a Wikidata sigue en `option_authorities` (no se duplica). El QID, las coordenadas P625 y la etiqueta de Wikidata se toman de ahí.
- Igual que `option_authorities`, la ficha va aparte de las opciones para que editar/reordenar/renombrar opciones no la pierda. Borrar una opción borra su ficha y sus marcas (con el «Deshacer» habitual si existe para opciones).
- La jerarquía no admite ciclos (validar al guardar). El padre debe ser un elemento de la misma propiedad.
- **Unificar valores** (`electron/db/cleanup.ts`) sobre una propiedad Patrimonio: el elemento que se queda conserva su ficha y su enlace; los campos vacíos (enlace, coordenadas, tipología, padre) se completan con los del absorbido. Los hijos del absorbido pasan a colgar del que se queda (si eso creara un ciclo, ese hijo queda sin padre). Sus marcas pasan al que se queda. El deshacer de la unificación guarda y restaura también fichas, enlaces y marcas.
- Las coordenadas manuales tienen prioridad sobre las de Wikidata y no se sobrescriben al refrescar.
- Edición: desde el editor de opciones de la propiedad (`Properties.tsx`), cada elemento abre su ficha con: enlace Wikidata (buscar / quitar), coordenadas (mini mapa reutilizando `LocationMap`), tipo/grupo (selector con iconos), «forma parte de» (buscador entre los elementos).

### 3. Esquema de tipologías

- Por defecto en `shared/heritageTypology.ts`; copia editable por propiedad en `config_json` (`heritageScheme`). Claves estables, etiquetas es/en, icono lucide por grupo y opcionalmente por tipo.
- Esquema aprobado:

| Grupo | Icono | Tipos |
|---|---|---|
| Arquitectura religiosa | `Church` | catedral, iglesia, monasterio/convento, mezquita, sinagoga, ermita |
| Arquitectura civil | `Building2` | palacio, ayuntamiento, universidad/colegio, lonja, casa señorial, museo, plaza de toros, edificio moderno |
| Arquitectura defensiva | `Castle` | castillo, alcázar, muralla, torre, puerta/arco |
| Obra pública | `Milestone` | puente, acueducto, faro, puerto, estación |
| Arqueología | `Amphora` | teatro romano, yacimiento |
| Monumentos conmemorativos | `PersonStanding` | estatua, monumento, fuente |
| Espacios urbanos y paisaje | `Trees` | calle, plaza, parque, mirador, paraje |
| Obras de arte | `Palette` | pintura, escultura, retablo, tapiz |

- El usuario puede renombrar, añadir y quitar grupos y tipos. Quitar un tipo en uso deja esos elementos «Sin tipología» (avisando cuántos).
- Tabla de correspondencia Wikidata P31 (instancia de) → tipo, en `shared/` (p. ej. catedral Q2977, iglesia Q16970, monasterio Q44613, mezquita Q32815, sinagoga Q34627, palacio Q16560, castillo Q23413, muralla Q16748868, puente Q12280, acueducto Q474, faro Q39715, museo Q33506, fuente Q483453, estatua Q179700, pintura Q3305213, escultura Q860861, calle Q79007, plaza Q174782, parque Q22698). Se usa solo para **sugerir**; la lista exacta la completa el constructor.

### 4. Vinculación con Wikidata

- **Uno a uno:** desde la ficha, el buscador de autoridades existente (`AuthorityDialog`), limitado a Wikidata.
- **En lote:** acción «Identificar en Wikidata» sobre la propiedad. Para cada elemento sin enlace:
  - Interpreta la etiqueta con el patrón habitual «Elemento - Ciudad» (y «Obra - Autor - Lugar» para obras de arte) para construir la búsqueda; si no encaja, busca la etiqueta entera.
  - Pide candidatos a Wikidata, trae de los mejores P625, P31, P361 (forma parte de) y P131 (ubicado en) para desempatar por lugar.
  - Propone un candidato con una confianza (alta / media / baja), sin aplicar nada.
- **Revisión:** lista con elemento, candidato, descripción, lugar y mini mapa; aceptar, rechazar o elegir otro candidato; aceptar todos los de confianza alta. Al aplicar: enlace + coordenadas + tipo sugerido + padre sugerido (si P361 apunta a otro elemento ya enlazado de la misma propiedad). Cada lote aplicado queda registrado y se puede **revertir entero** con «Revertir esta vinculación» (devuelve enlaces, coordenadas, tipologías y padres a como estaban). No se integra en el Deshacer/Rehacer global, que hoy solo cubre celdas y opciones.
- Se ejecuta como trabajo de la cola existente, cancelable, con progreso, respetando el ritmo de Wikimedia. Solo arranca por acción explícita.

### 5. Marcas en la foto

- `image_annotations` gana dos columnas: `kind` (`'rect' | 'point'`, por defecto `'rect'` para las existentes) y `option_id` (elemento, nullable). Un punto guarda `w = h = 0`. Las anotaciones libres actuales no cambian.
- En el visor (`ImageViewer.tsx`), además de «Anotar», un modo «Patrimonio» con dos herramientas: **punto** (clic) y **rectángulo** (arrastrar). Tras marcar, se elige el elemento con un buscador entre los de la propiedad (o se crea uno nuevo).
- Marcar un elemento lo añade a la celda si no estaba. Quitar un elemento de la celda que tiene marcas pregunta antes y borra sus marcas.
- «Sin marcar» es simplemente tener el elemento en la celda sin marca.
- Las marcas se dibujan con el icono de la tipología y el nombre del elemento; el panel lateral las lista junto a las notas.
- Si hay varias propiedades Patrimonio en la base, el modo pregunta cuál usar (caso raro; basta un selector).

### 6. Mapa de fotos

- En `DatabaseMap.tsx`, el selector actual de columna de ubicación pasa a ser **«Situar las fotos según»** e incluye las propiedades de ubicación y las de Patrimonio.
- Con una propiedad Patrimonio como fuente: la foto aparece en **cada uno** de sus elementos con coordenadas. Un elemento sin coordenadas propias usa las del ancestro más cercano que las tenga (marcado como «posición del conjunto»). Si ninguno de sus elementos ni sus ancestros tiene coordenadas, se usa la ubicación de respaldo (la primera propiedad de ubicación, o la que el usuario elija como respaldo); si tampoco, no aparece.
- Los marcadores situados por patrimonio no dibujan flecha de dirección (la dirección es de la cámara). La agrupación (`shared/mapClusters.ts`) cuenta registros distintos, no apariciones, para no inflar los números cuando una foto está en varios elementos.
- La elección se recuerda por vista.

### 7. Mapa de patrimonio

- Modo nuevo dentro de la vista de mapa: **«Fotos / Patrimonio»**.
- Un marcador por elemento con coordenadas, con el icono de su tipo (o grupo) y tamaño según el número de fotos de la vista actual (respetando sus filtros) en que aparece. Interruptor «incluir sus partes».
- Filtro por grupo y tipo; leyenda con iconos y recuento.
- Al pulsar un elemento: nombre, tipología, enlace a Wikidata, padre e hijos, y la tira de fotos donde aparece (abre el registro).
- Las partes sin coordenadas propias no tienen marcador propio: suman en el de su ancestro situado más cercano (si «incluir sus partes» está activo) y figuran en su ficha.
- Elementos sin coordenadas propias ni heredadas: contador «N elementos sin situar» que lleva a la lista para completarlos.

### 8. Estadísticas

- `heritage` entra en `CATEGORICAL_TYPES` y `MULTI_TYPES`: frecuencia, tabla cruzada, coocurrencia y tendencia funcionan como con una selección múltiple.
- Para propiedades Patrimonio, el `StatSpec` gana:
  - `heritageLevel: 'element' | 'type' | 'group'`: el valor categórico pasa a ser el tipo o el grupo del elemento (sin tipología → «Sin tipología»). Una foto cuenta **una vez por categoría** aunque tenga varios elementos de la misma.
  - `includeParts: boolean` (solo a nivel elemento): cada foto cuenta también para todos los ancestros de sus elementos, una vez por ancestro.
- Los gráficos pueden mostrar el icono de tipología junto a la etiqueta cuando el nivel es tipo o grupo.

### 9. Filtros

- Los operadores de selección múltiple siguen valiendo para elementos.
- Nuevos criterios para Patrimonio: «es de tipo», «es de grupo», «incluye la parte de» (elemento o cualquiera de sus descendientes), «tiene marca en la foto», «sin enlazar a Wikidata». Compilados a SQL en `viewQuery.ts` contra `heritage_elements`.

### 10. Exportación

- CSV/exportación: la propiedad sale como la selección múltiple; las exportaciones que ya incluyen identificadores de autoridad incluyen el QID. Las marcas se exportan en la exportación W3C Web Annotation existente con el elemento como cuerpo (QID si lo hay).

## Pruebas

- Tests automáticos con datos sintéticos: conversión ida y vuelta sin pérdidas, ciclos en jerarquía, recuentos con `includeParts` y por nivel, fuente de mapa y respaldo, filtros nuevos, marcas punto/rectángulo, migración del esquema de `image_annotations`.
- Validación con la base real del usuario: solo sobre una copia de solo lectura en el directorio temporal de la sesión, con perfil aislado (`IMAGO_USER_DATA`). Se comprueba que la conversión conserva todo, cuánto acierta la vinculación en lote y cómo se reparte el mapa. Los resultados se comentan con el usuario en la conversación y **nunca** se escriben en el repositorio.

## Decisiones tomadas por el usuario

- Fuente del mapa elegible (monumento o lugar de la foto); propiedades separadas para ubicación y patrimonio.
- Mapa de patrimonio aparte, además del mapa de fotos.
- Marcar con punto, rectángulo (mismo botón conceptual) o sin marcar.
- Jerarquía «forma parte de» con interruptor en estadísticas.
- Esquema de tipologías de dos niveles tal como está arriba.
- Enfoque A.

## Decisiones propuestas por Claude (corregibles)

- Primera versión solo con Wikidata + alta manual; MonumentosES/OSM después.
- Vinculación en lote con revisión obligatoria (nunca se aplica sin revisar).
- Con fuente Patrimonio, la foto aparece en cada uno de sus elementos y, si no tiene ninguno situado, cae a su ubicación.
- Iconos por tipo/grupo, no por elemento.
- Un elemento sin coordenadas hereda las de su ancestro más cercano en el mapa.
- Conversión: la ficha y las marcas sobreviven entre tipos con opciones; hacia tipos sin opciones se avisa y se pierden.
- Unificar valores fusiona fichas, re-cuelga hijos y mueve marcas, con deshacer completo.
- La vinculación en lote se revierte con su propia acción, no con el Deshacer global.
- La red puede salir del worker de la cola (nunca del renderer).
- El rectángulo guarda tamaño para medir importancia visual en el futuro, sin calcularla ahora.

## Queda para el constructor

- Nombres exactos de tablas, columnas, IPC y componentes; migración de esquema.
- Lista completa de correspondencias P31 → tipo.
- Umbrales de confianza de la vinculación en lote.
- Diseño visual fino del modo Patrimonio del visor, de la ficha y de la leyenda.
- Reparto en PRs (sugerencia: 1) tipo + ficha + conversión + esquema; 2) Wikidata en lote; 3) marcas en la foto; 4) mapas; 5) estadísticas y filtros).
