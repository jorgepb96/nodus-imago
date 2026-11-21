# Database kinds and two-way relations — design

## Intent

Collections of images rarely stand alone: a photograph appears in books, a book
holds photographs. Researchers should be able to:

- describe the works in their own database;
- link both ways without copying data;
- filter, count and study one through the other.

Existing databases keep working as they are.

## Decisions

### Kinds

A database has a kind: `images`, `sources` or `custom`.

- The kind lives in `db_databases.kind`, added by a guarded `ALTER TABLE`.
  Existing databases have none and behave as before.
- The kind only chooses the starting properties and a few defaults. Every
  property stays editable, and the kind can be changed later.
- The starting properties are:
  - **images:** Título, Imágenes, Autor, Fecha (historical date), Ubicación,
    Categorías (multi-select) and Archivo (select);
  - **sources:** Título, Tipo (Libro / Revista / Álbum / Folleto /
    Documento), Autor, Editorial, Lugar de edición, Año (number),
    Identificador and Cubierta (images);
  - **custom:** Título and Imágenes, the classic Imago database.
- Backups restore the core tables by the columns both sides share, so backups
  made before (and after) this change restore.

### Two-way relations

A relation property can have a twin on the target database, linked through
`relationInverseColumnId` on both columns (this config key already existed but
was not used).

- **Create:** a new relation can be made two-way at once ("also show in
  <target> as …").
- **Convert:** an existing relation can be made two-way. Its links are copied
  to the twin, in bulk, in one transaction.
- **Unlink:** an existing pair can be made one-way again. Both properties stay,
  and only the pairing goes.
- **Mirroring:** `setCell` keeps the twin in step. For each record added or
  removed on one side, the record on the other side gains or loses the link
  (only when it differs, so the mirroring ends). The twin's "one" cardinality
  is respected: linking replaces the old link, which is removed on its other
  side too.
  - The mirroring runs inside the same transaction.
  - Undo and redo replay `setCell`, so both sides undo together.
- **Delete:**
  - deleting one of the pair turns the other into a one-way relation;
  - deleting records removes them from every relation that points at them.
- **Self-relations:** a relation within a single database can be two-way too
  (for example, "part of" / "parts").

### Cross queries

- The filter "related to" already exists.
- **Show a related property:** an action on relation properties that creates a
  rollup bringing a property of the related records (for example, the book's
  year or publisher). Rollups can be filtered and sorted, and they are
  computed, not copied.
- **Statistics** accept relation properties. Their categories are the related
  records' titles, counted like a multi-select. Rollups already count.

### Sources in records and appearances

- A record of a `sources` database shows, in the record panel, the images of
  the records that link to it (its photographs).
- In «Obras en las que aparece», the work property is taken from a relation to
  a `sources` database first.

## Non-goals

- No relation to databases in other collections.
- No automatic matching of existing text values (for example, a book id typed
  in a text property) to records. That is a separate tool, which can be built
  once two-way relations exist.

## Checks

- **Unit:**
  - the kinds and their starting properties;
  - restoring a backup that has no `kind` column;
  - two-way relations: create, convert (with backfill), mirror on link and
    unlink, the "one" cardinality, undo and redo, delete a twin, delete
    records, self-relation;
  - statistics on a relation property;
  - appearances that prefer a sources database.
- **Desktop:** create a Sources database; make a two-way relation from images;
  link from one side and see it on the other; filter by a related property;
  count by relation in statistics; the source record's photographs.
