# Variants and appearances in the record panel — design

## Intent

From any photograph, a researcher should see at once every version of it held in
their databases and where it was reproduced, without leaving the record. Machine
detection proposes; the researcher decides, and their decisions are kept apart
from the detection so that a study can say which links were confirmed by hand.

## What exists

- `Variants` (electron/db/variants.ts) finds images that are the same photograph:
  - the same file (`identical`);
  - a copy or another scan (fingerprint, `near`);
  - a crop, retouched or similar version (vectors confirmed on pixels, `similar`).
- `image_pair_checks` caches the automatic pixel check. It is not a decision.
- The Variants view groups families for a database. Comparison boards show
  images side by side.

## Approaches considered

1. **A tab in the record panel on top of the existing engine, with a separate
   store of researcher verdicts (chosen).** It reuses detection, keeps
   decisions auditable, and the Variants view and backups pick up the same
   verdicts.
2. **Persisted families (a family table the researcher edits).** It is closer to
   a catalogue of "photographic families", but it duplicates what detection
   recomputes, and it goes stale when images are added.
3. **Only a list of similar images (no verdicts).** It is too little: it cannot
   record that a match is wrong, or that two unmatched images are the same.

## Design

### Data

- `variant_verdicts(pair PK, a, b, verdict 'same'|'different', kind, created_at, updated_at)`
  - The key is a pair of content hashes, sorted. A verdict therefore holds for
    the same file wherever it is attached.
  - `kind` is the researcher's name for the relation: `copy`, `crop`,
    `retouch`, `reproduction` or `other_take`. It is optional.
  - `same` links two images even if detection did not. `different` removes an
    automatic match.
- `image_appearances(id PK, content_hash, work, author, year, page, caption, note, created_at, updated_at)`
  - These are appearances added by hand: a reproduction known from a book or
    magazine whose image is not in the collection. They belong to an image (its
    content hash).

Both tables are part of backups and are restored 1:1.

### Family of one image

The family of an image consists of:

- the anchor;
- every image detection matches with it directly, minus pairs marked
  `different`;
- everything reachable from these through `same` verdicts (confirmed links
  chain, automatic ones do not).

Each member carries:

- its automatic match (`identical` / `near` / `similar`, or `confirmed` when
  only a verdict links it);
- the verdict and kind, if any.

Members the researcher rejected are returned apart, so they can be undone.

The Variants view applies the same verdicts: `different` pairs are removed,
and `same` pairs are added as links.

### Appearances ("Obras en las que aparece")

There is one line per record of the family, the anchor's own record included,
plus the manual ones. Each line shows:

- **work:** the record's work property. By default this is the first relation
  to another database (the related row's title, with its author and year when
  those columns exist), or else a property named like *obra / fuente / libro /
  source / work*. The researcher can choose another property, per database.
- **year:** the record's date (the same detection as comparison boards).
- **page:** a property named like *página / page*, or one the researcher chooses.
- **caption:** a property named like *pie / caption / leyenda / título*, or one
  the researcher chooses. Without one, the record title is used.

Lines are sorted by year, so the first appearance comes first.

### Interface

- The record panel gets two tabs: **Ficha** and **Variantes y apariciones (n)**.
- The variants tab shows:
  - the image the panel is on (a record with several images switches with the
    panel's arrows);
  - a sensitivity setting;
  - members grouped as identical / copies / crops-retouches-similar /
    confirmed by hand, with a folded group for rejected members;
  - a card per member: image, record, database, year, match label;
    *Confirmar* / *Descartar* / undo; the kind once confirmed; *Abrir ficha*;
    and a tick to select it;
  - **Comparar (2)**, which opens the selected images on a comparison board;
  - **Añadir a la familia…**, a search across databases that picks an image
    and records a `same` verdict.
- **Obras en las que aparece:** the table described above, with:
  - a settings popover (work, page and caption property per database);
  - **Añadir aparición** (work, author, year, page, caption, note), with edit
    and delete for manual lines.

## Non-goals

- No automatic tell-apart of crops from retouches: the automatic label stays
  "recorte, retoque o similar", and the researcher names the kind.
- No new "Sources" database is created automatically. Any database linked by a
  relation works as one.

## Checks

- **Unit:**
  - verdicts change a family (reject, confirm unmatched, chain), and both the
    per-image family and the Variants view follow them;
  - appearance lines resolve work, page and caption (relation, named property,
    chosen property, fallback);
  - manual appearances are saved, edited and deleted;
  - backups restore both tables.
- **Desktop:** the tab in a real window. Confirm, reject and undo; compare two;
  add to the family; set the work property; add and delete a manual appearance.
