// Citations and captions from a template.
import { test } from "node:test";
import assert from "node:assert/strict";
import { citationRoles, citationTemplate, renderCitation } from "../shared/citation";
import type { DatabaseColumn, DatabaseRow } from "../shared/databases";

const col = (id: string, name: string, type = "text"): DatabaseColumn =>
  ({ id, databaseId: "d", name, type, position: 0, config: {}, options: [] }) as unknown as DatabaseColumn;
const columns = [col("t", "Registro", "title"), col("a", "Creditos"), col("f", "Fecha", "historical_date"), col("s", "Fuente"), col("l", "Lugar")];
const row = (cells: Record<string, string | null>): DatabaseRow => ({ id: "r", databaseId: "d", position: 0, createdAt: "", updatedAt: "", cells }) as unknown as DatabaseRow;

test("roles are guessed from property names and types", () => {
  assert.deepEqual(citationRoles(columns), { author: "Creditos", date: "Fecha", holding: "Fuente", place: "Lugar", title: "Registro" });
  assert.equal(citationTemplate(columns), "{Creditos}, «{Registro}», {Lugar}, {Fecha}, {Fuente}.");
  assert.equal(citationTemplate(columns, "iso690"), "{Creditos}. {Registro} [fotografía]. {Lugar}, {Fecha}. {Fuente}.");
  assert.equal(citationTemplate(columns, "apa"), "{Creditos} ({Fecha}). {Registro} [Fotografía]. {Fuente}.");
});

test("empty properties leave no stray punctuation", () => {
  const full = row({ t: "REF-0042-A", a: "Ana Ejemplo", f: JSON.stringify({ text: "c. 1950", start: 1945, end: 1955, certainty: "approx" }), s: "Colección X", l: "Ronda" });
  const template = citationTemplate(columns);
  assert.equal(renderCitation(template, columns, full), "Ana Ejemplo, «REF-0042-A», Ronda, c. 1950, Colección X.");
  assert.equal(renderCitation(template, columns, row({ t: "REF-0042-A", s: "Colección X" })), "«REF-0042-A», Colección X.");
  assert.equal(renderCitation(template, columns, row({ t: "A", a: "B" })), "B, «A».");
  assert.equal(renderCitation(citationTemplate(columns, "iso690"), columns, row({ t: "A", f: "1950" })), "A [fotografía]. 1950.");
  assert.equal(renderCitation(citationTemplate(columns, "apa"), columns, row({ t: "A", a: "B" })), "B. A [Fotografía].");
  assert.equal(renderCitation("Fig.: {Registro} ({Fecha})", columns, row({ t: "A" })), "Fig.: A");
  assert.equal(renderCitation("{Desconocida}, {Registro}.", columns, row({ t: "A" })), "A.");
});

test("a property that holds file names is not taken as the archive", () => {
  const cols = [col("t", "Registro", "title"), col("a", "Autor"), col("f", "Archivo"), col("s", "Fuente")];
  const sample = [row({ t: "A", a: "B", f: "Fotos%20de%20viaje/A/2.jpg", s: "Colección X" })];
  assert.equal(citationRoles(cols).holding, "Archivo");
  assert.equal(citationRoles(cols, sample).holding, "Fuente");
  assert.equal(citationTemplate(cols, "chicago", sample), "{Autor}, «{Registro}», {Fuente}.");
});

test("option icons and stray spaces do not reach the citation", () => {
  const cols = [col("t", "Registro", "title"), col("s", "Fuente")];
  assert.equal(renderCitation("{Registro}. {Fuente}.", cols, row({ t: "A", s: "Colección X 📚" })), "A. Colección X.");
});
