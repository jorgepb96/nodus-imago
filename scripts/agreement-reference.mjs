// Independent numerical audit. Python reference packages live only in test-results.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
await fs.mkdir('test-results/reference', { recursive: true });
await build({ entryPoints: ['shared/agreement.ts'], outfile: 'test-results/reference/agreement.cjs', bundle: true, platform: 'node', format: 'cjs' });
const require = createRequire(import.meta.url);
const { calculateAgreement, defaultAgreementConfig } = require(path.resolve('test-results/reference/agreement.cjs'));
let seed = 13271112;
const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
const cases = [];
for (let index = 0; index < 180; index++) {
  const mode = index < 120 ? 'nominal' : 'multilabel';
  const raters = 2 + random(5), categories = 2 + random(7), count = index < 3 ? index : 3 + random(75);
  const ids = Array.from({ length: raters }, (_, i) => 'c' + i);
  const data = Array.from({ length: count }, () => ids.map(() => random(9) === 0 ? null : mode === 'nominal' ? [String(index === 3 ? 0 : random(categories))] : Array.from({ length: categories }, (_, j) => String(j)).filter(() => random(3) === 0)));
  const config = { ...defaultAgreementConfig(), mode, emptySetValid: true, cohort: index % 2 ? 'complete' : 'pairwise', weight: mode === 'nominal' ? ['none', 'linear', 'quadratic'][index % 3] : 'none', categoryOrder: Array.from({ length: categories }, (_, i) => String(i)), raters: ids.slice(0, -1).map(columnId => ({ columnId, label: columnId, model: '', prompt: '' })), referenceId: ids.at(-1) };
  const snapshot = { format: 'nodus.imago.agreement/1', createdAt: '2026-11-12T12:00:00Z', database: { id: 'fixture', name: 'Reference' }, input: { databaseId: 'fixture', config }, columns: ids.map((id, position) => ({ id, databaseId: 'fixture', name: id, type: 'text', position, config: {}, options: [] })), rows: data.map((labels, i) => ({ id: 'r' + i, title: 'r' + i, updatedAt: '2026-11-12', imageCount: 1, image: null, cells: Object.fromEntries(ids.map((id, j) => [id, labels[j] === null ? null : labels[j].length ? labels[j].join(';') : ';'])) })), matched: data.length, provenance: [] };
  const report = calculateAgreement(snapshot);
  cases.push({ data, ids, categories, config, report: { models: report.models, all: report.all, human: report.human, pairs: report.pairs } });
}
const python = spawnSync(path.resolve('.venv/bin/python'), ['scripts/agreement-reference.py'], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 16 * 2 ** 20 });
if (python.status !== 0) { process.stderr.write(python.stderr); process.stdout.write(python.stdout); process.exit(python.status ?? 1); }
const result = JSON.parse(python.stdout);
await fs.writeFile('test-results/agreement-reference.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
