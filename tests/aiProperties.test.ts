import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLabelList,
  parseValueAnswer,
  repairMojibake,
  streamPreview,
} from "../shared/visionOutput";
import { aiPresetInstruction, aiPresetOf, aiPresetTask } from "../shared/databaseAi";
import { isAiColumn } from "../shared/databases";

test("a structured {value} answer keeps only the cell text", () => {
  assert.equal(parseValueAnswer('{"value": "Una mesa con flores."}'), "Una mesa con flores.");
  assert.equal(parseValueAnswer('{"value": ""}'), "");
  // Cut off by the token limit: the text written so far is kept.
  assert.equal(parseValueAnswer('{"value": "Una calle con\\nárboles'), "Una calle con\nárboles");
});

test("tags are matched to the allowed options without case or accents, up to the limit", () => {
  const allowed = ["Interior", "Retrato", "Religión"];
  assert.deepEqual(parseLabelList('["interior", "Otra", "religion"]', allowed, 5), ["Interior", "Religión"]);
  assert.deepEqual(parseLabelList('["a", "b", "c"]', null, 2), ["a", "b"]);
  assert.deepEqual(parseLabelList("mesa, flores\nherramientas", null, 8), ["mesa", "flores", "herramientas"]);
  assert.deepEqual(parseLabelList('["Mesa", "mesa"]', null, 8), ["Mesa"]);
});

test("text read with the wrong encoding is repaired before matching", () => {
  assert.equal(repairMojibake("religiÃ³n"), "religión");
  assert.equal(repairMojibake("religión"), "religión");
  assert.deepEqual(parseLabelList('["ReligiÃ³n"]', ["Religión"], 1), ["Religión"]);
});

test("the live preview skips the prompt's example and shows the model's text", () => {
  const echo = 'Formato: {"value": "..."} === DATOS ===';
  assert.equal(streamPreview(echo, "value"), "");
  assert.equal(streamPreview(echo + '\n\n{"value": "Una plaza con', "value"), "Una plaza con");
  assert.equal(streamPreview('["interior", "mes', "list"), "interior");
});

test("presets follow the interface language, the tag limit and the classification criteria", () => {
  const es = aiPresetInstruction({ aiPreset: "describe" }, "es", "español");
  assert.match(es.instruction, /No uses listas, guiones/);
  assert.equal(es.output, "value");
  const en = aiPresetInstruction({ aiPreset: "describe" }, "en", "English");
  assert.match(en.instruction, /Do not use lists, dashes/);

  const one = aiPresetInstruction({ aiPreset: "tags", aiTags: ["A", "B", "C"] }, "es", "español", 1);
  assert.equal(one.output, "list");
  assert.match(one.instruction, /la etiqueta que mejor corresponda/);
  const free = aiPresetTask("tags", "es", [], null);
  assert.match(free, /todas las etiquetas pertinentes/);
  assert.match(aiPresetTask("tags", "en", [], 3), /up to 3 tags/);

  const advanced = aiPresetInstruction(
    {
      aiPreset: "tags",
      aiTags: ["Montaña", "Ciudad"],
      aiCriteria: "Clasifica por el motivo principal.",
      aiTagDefinitions: [
        { label: "Montaña", definition: "Relieve natural sin edificios." },
        { label: "Ciudad", definition: "" },
      ],
    },
    "es",
    "español",
    1,
  );
  assert.match(advanced.instruction, /Criterios generales de clasificación[^\n]*:\nClasifica por el motivo principal\./);
  assert.match(advanced.instruction, /- Montaña: Relieve natural sin edificios\./);
  assert.doesNotMatch(advanced.instruction, /- Ciudad:/);
});

test("a property is an AI property when it is AI text or a selection with AI on", () => {
  assert.equal(aiPresetOf({}), "describe");
  assert.equal(aiPresetOf({ aiPrompt: "Haz esto" }), "custom");
  assert.equal(isAiColumn({ type: "ai", config: {} }), true);
  assert.equal(isAiColumn({ type: "multi_select", config: { aiEnabled: true } }), true);
  assert.equal(isAiColumn({ type: "multi_select", config: {} }), false);
  assert.equal(isAiColumn({ type: "text", config: { aiEnabled: true } }), false);
});
