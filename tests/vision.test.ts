import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanVisionText,
  parseClassification,
  parseDescription,
} from "../shared/visionOutput";
import { cleanChatOutput, extractChatAnswer } from "../electron/ai/llama";

test("reasoning blocks and llama.cpp console noise never become cell values", () => {
  const raw =
    "llama_mtmd_cli: loading model\n<think>The bridge is red and spans the water. I should answer Paisaje.</think>\nPaisaje";
  assert.equal(cleanVisionText(raw), "Paisaje");
  assert.equal(
    parseDescription(
      "print_info: loaded\n<think>internal reasoning that must not leak</think>\nUna mujer y dos niños junto a una casa.",
    ),
    "Una mujer y dos niños junto a una casa.",
  );
  assert.throws(
    () => parseDescription("<think>sólo razonamiento, sin respuesta</think>"),
    /descripción/,
  );
  assert.equal(
    parseDescription(
      "### Análise de la Imagen\nLa estructura es roja.\n</think>La fotografía muestra una estructura roja sobre el agua.",
    ),
    "La fotografía muestra una estructura roja sobre el agua.",
  );
});
test("classification accepts label strings and objects, enforces vocabulary and cardinality", () => {
  assert.deepEqual(
    parseClassification(
      '```json\n["Paisaje", "Arquitectura"]\n```',
      ["Paisaje", "Arquitectura", "Interiores"],
      5,
    ),
    ["Paisaje", "Arquitectura"],
  );
  assert.deepEqual(
    parseClassification(
      '[{"id":"image","label":"Paisaje"}]',
      ["Paisaje", "Interiores"],
      5,
    ),
    ["Paisaje"],
  );
  assert.deepEqual(
    parseClassification(
      '[{"type":"image","name":"GoldenGate.png","category":"Paisaje"}]',
      ["Paisaje", "Interiores"],
      5,
    ),
    ["Paisaje"],
  );
  assert.deepEqual(
    parseClassification(
      '[{"U":0,"V":0,"W":0,"Title":"Categorías","Image":"GoldenGate.png","Label":"Paisaje"}]',
      ["Paisaje", "Interiores"],
      5,
    ),
    ["Paisaje"],
  );
  assert.deepEqual(
    parseClassification(
      '{"U":0,"V":0,"Title":"Categorías","Label":"Paisaje"}',
      ["Paisaje", "Interiores"],
      5,
    ),
    ["Paisaje"],
  );
  assert.deepEqual(
    parseClassification(
      '<think>I will choose one</think>{"labels":["paisaje"]}',
      ["Paisaje", "Interiores"],
      5,
    ),
    ["Paisaje"],
  );
  assert.throws(
    () => parseClassification('["Paisaje inventado"]', ["Paisaje"], 5),
    /vocabulario/,
  );
  assert.throws(
    () => parseClassification('["Paisaje", "Interiores"]', ["Paisaje", "Interiores"], 1),
    /máximo 1/,
  );
  assert.throws(
    () => parseClassification("La imagen muestra un paisaje.", ["Paisaje"], 5),
    /clasificación/,
  );
  assert.throws(
    () => parseClassification('["Paisaje", "Interiores"', ["Paisaje"], 5),
    /clasificación/,
  );
});
test("description rejects bare JSON and unwraps explicit description fields", () => {
  assert.throws(
    () => parseDescription('["Paisaje"]'),
    /JSON en lugar de una descripción/,
  );
  assert.equal(
    parseDescription('{"description":"Un puente rojo sobre el agua."}'),
    "Un puente rojo sobre el agua.",
  );
  assert.equal(
    parseDescription("```\nUn puente rojo sobre el agua.\n```"),
    "Un puente rojo sobre el agua.",
  );
  assert.equal(
    parseDescription(
      "=== DATOS DE LA FILA ===\nTítulo: Documento A\nImágenes: GoldenGate.png\nUn puente rojo sobre el agua.",
    ),
    "Un puente rojo sobre el agua.",
  );
  assert.equal(
    parseDescription(
      '<minimax:tool_call>\n<invoke>\n<parameter name="description">Se observa un puente rojo.</parameter>\n</invoke>\n</minimax:tool_call>',
    ),
    "Se observa un puente rojo.",
  );
  assert.deepEqual(
    parseClassification(
      '<minimax:tool_call><invoke><parameter name="labels">["Paisaje"]</parameter></invoke></minimax:tool_call>',
      ["Paisaje"],
      5,
    ),
    ["Paisaje"],
  );
});

test("persistent llama chat output separates prompt echo from the answer", () => {
  assert.equal(
    extractChatAnswer(
      "Describe the photograph.\n\nA red bridge crosses the water.\n\n",
      "Describe the photograph.",
    ),
    "A red bridge crosses the water.",
  );
  assert.equal(
    extractChatAnswer(
      "/image /tmp/a.png image loaded\nDescribe the photograph.\n\nA red bridge.\n",
      "Describe the photograph.",
    ),
    "A red bridge.",
  );
  assert.equal(
    cleanChatOutput("\u001b[32mAnswer\u001b[0m\b\b"),
    "Answer",
  );
  assert.throws(
    () => extractChatAnswer("Describe the photograph.\n\n", "Describe the photograph."),
    /no devolvió texto/,
  );
});
