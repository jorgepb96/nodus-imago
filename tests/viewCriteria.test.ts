import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Repository } from '../electron/db/repository';
import { relativeDateRange, restoreViewCriteria, pruneViewCriteria } from '../shared/viewCriteria';
import { encodeDatabaseLocation, encodeDatabasePeople } from '../shared/databaseProperties';
import type { PropertyFilter, SearchInput } from '../shared/imago';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imago-criteria-')), repo = new Repository(root);
  const detail = repo.create('Criteria'), databaseId = detail.database.id;
  const title = detail.columns.find(c => c.type === 'title')!;
  const text = repo.addColumn(databaseId, 'Texto', 'text'), number = repo.addColumn(databaseId, 'Número', 'number');
  const date = repo.addColumn(databaseId, 'Fecha', 'date'), time = repo.addColumn(databaseId, 'Hora', 'time'), check = repo.addColumn(databaseId, 'Casilla', 'checkbox');
  const tags = repo.addColumn(databaseId, 'Temas', 'multi_select'), place = repo.addColumn(databaseId, 'Lugar', 'location'), person = repo.addColumn(databaseId, 'Autor', 'person');
  repo.saveOptions(tags.id, [{ label: 'Árbol', color: '#118866' }, { label: 'Patrimonio', color: '#9955aa' }]);
  const options = repo.column(tags.id).options;
  const rows = repo.createRows(databaseId, 6);
  repo.db.transaction(() => rows.forEach((id, i) => {
    const values: [string, string | null, any][] = [
      [title.id, ['IMG10', 'IMG2', 'IMG1', 'IMG20', 'IMG3', 'IMG4'][i], 'title'],
      [text.id, ['Árbol 100%_\\ final', 'arbol normal', 'Casa histórica', null, "O'Brien", 'a'.repeat(10001)][i], 'text'],
      [number.id, ['-2', '0', '10', null, '3', '10'][i], 'number'],
      [date.id, ['2024-02-29', '2026-11-12', '2026-11-13', null, '2026-01-01', '2026-11-30'][i], 'date'],
      [time.id, ['08:05', '12:30', '23:00', null, '00:00', '09:00'][i], 'time'],
      [check.id, ['true', 'false', 'true', null, 'false', 'true'][i], 'checkbox'],
      [tags.id, [JSON.stringify([options[0].id]), JSON.stringify([options[1].id]), JSON.stringify(options.map(o => o.id)), null, JSON.stringify([options[0].id]), null][i], 'multi_select'],
      [place.id, i === 0 ? encodeDatabaseLocation({ name: 'Córdoba', latitude: 0, longitude: 0 }) : i === 1 ? encodeDatabaseLocation({ name: 'Lugar personalizado' }) : null, 'location'],
      [person.id, i < 2 ? encodeDatabasePeople([{ id: 'person-1', label: 'Jorge', kind: 'person' }]) : i === 2 ? encodeDatabasePeople([{ id: 'person-2', label: 'Ana', kind: 'person' }]) : null, 'person'],
    ];
    for (const [columnId, value, type] of values) repo.rawCell(id, columnId, value, type);
    repo.db.prepare('UPDATE db_rows SET created_at=?,updated_at=? WHERE id=?').run(`2026-01-0${i+1}T12:00:00Z`, `2026-02-0${6-i}T12:00:00Z`, id);
    repo.indexRow(id);
  }))();
  const search = (input: Partial<SearchInput> = {}) => repo.literal({ databaseIds: [databaseId], ...input }).rows.map(r => r.id);
  const filtered = (columnId: string, op: PropertyFilter['op'], value: PropertyFilter['value']) => search({ filters: [{ columnId, op, value }] });
  return { root, repo, detail, databaseId, title, text, number, date, time, check, tags, place, person, options, rows, search, filtered, close() { repo.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
test('typed filters preserve zero, negatives, leap days, literal LIKE characters, quotes and missing data', () => {
  const f = fixture(); try {
    assert.deepEqual(f.filtered(f.number.id, 'between', ['-2','0']), f.rows.slice(0, 2));
    assert.deepEqual(f.filtered(f.number.id, 'equals', '0'), [f.rows[1]]);
    assert.deepEqual(f.filtered(f.number.id, 'empty', ''), [f.rows[3]]);
    assert.deepEqual(f.filtered(f.text.id, 'contains', '%_\\'), [f.rows[0]]);
    assert.deepEqual(f.filtered(f.text.id, 'equals', "o'brien"), [f.rows[4]]);
    assert.deepEqual(f.filtered(f.text.id, 'starts_with', 'ARBOL'), f.rows.slice(0,2));
    assert.deepEqual(f.filtered(f.text.id, 'ends_with', 'final'), [f.rows[0]]);
    assert.deepEqual(f.filtered(f.date.id, 'between', ['2026-11-12','2026-11-13']), [f.rows[1], f.rows[2]]);
    assert.deepEqual(f.filtered(f.time.id, 'between', ['00:00','08:05']), [f.rows[0], f.rows[4]]);
    assert.deepEqual(f.filtered(f.check.id, 'checked', ''), [f.rows[0], f.rows[2], f.rows[5]]);
    assert.deepEqual(f.filtered(f.check.id, 'unchecked', ''), [f.rows[1], f.rows[3], f.rows[4]]);
    assert.throws(() => f.filtered(f.number.id, 'between', ['10','-2']), /inicio/);
    assert.throws(() => f.filtered(f.number.id, 'equals', 'not a number'), /numérico/);
  } finally { f.close(); }
});
test('set membership, locations including zero coordinates and local choice catalogues keep their types', () => {
  const f = fixture(); try {
    assert.deepEqual(f.filtered(f.tags.id, 'all', f.options.map(o => o.id)), [f.rows[2]]);
    assert.deepEqual(f.filtered(f.tags.id, 'any', [f.options[0].id]), [f.rows[0], f.rows[2], f.rows[4]]);
    assert.deepEqual(f.filtered(f.tags.id, 'none', [f.options[0].id]), [f.rows[1], f.rows[3], f.rows[5]]);
    assert.deepEqual(f.filtered(f.place.id, 'has_coordinates', ''), [f.rows[0]]);
    assert.deepEqual(f.filtered(f.place.id, 'no_coordinates', ''), f.rows.slice(1));
    assert.deepEqual(f.filtered(f.place.id, 'contains', 'cordoba'), [f.rows[0]]);
    assert.deepEqual(f.filtered(f.person.id, 'any', ['person-1']), f.rows.slice(0, 2));
    const people = f.repo.propertyChoices({ columnIds: [f.person.id], query: 'jor', selected: ['person-2'] });
    assert.equal(people.choices[0].label, 'Jorge'); assert.equal(people.choices[0].count, 2); assert.equal(people.selections[0].label, 'Ana');
    const choices = f.repo.propertyChoices({ columnIds: [f.text.id], query: '%_\\' });
    assert.equal(choices.choices.length, 1); assert.ok(!f.repo.propertyChoices({ columnIds: [f.text.id] }).choices.some(c => c.value.length > 10000));
    const many = Array.from({ length: 1000 }, (_, i) => 'missing-' + i).concat(f.options[0].id);
    assert.deepEqual(f.filtered(f.tags.id, 'any', many), [f.rows[0], f.rows[2], f.rows[4]]);
  } finally { f.close(); }
});
test('nested groups, pending/disabled rules and deterministic multi-property sorts work before pagination', () => {
  const f = fixture(); try {
    const result = f.search({ filters: [{ columnId: f.number.id, op:'gte', value:'0' }], filterGroups:[{ id:'g', logic:'or', filters:[{ columnId: f.title.id, op:'equals', value:'IMG2' }, { columnId: f.number.id, op:'equals', value:'10' }] }] });
    assert.deepEqual(result, [f.rows[1], f.rows[2], f.rows[5]]);
    assert.deepEqual(f.search({ filters:[{ columnId:f.text.id, op:'contains', value:'' },{ columnId:f.number.id, op:'gte', value:'999', disabled:true }] }), f.rows);
    assert.deepEqual(f.search({ sorts:[{ columnId:'$title', direction:'asc' }] }), [f.rows[2], f.rows[1], f.rows[4], f.rows[5], f.rows[0], f.rows[3]]);
    assert.deepEqual(f.search({ sorts:[{ columnId:f.number.id, direction:'desc' },{ columnId:'$title', direction:'desc' }] }), [f.rows[5], f.rows[2], f.rows[4], f.rows[1], f.rows[0], f.rows[3]]);
    assert.deepEqual(f.search({ sorts:[{ columnId:'$created', direction:'desc' }] }), [...f.rows].reverse());
    assert.deepEqual(f.search({ sorts:[{ columnId:'$modified', direction:'desc' }] }), f.rows);
    assert.deepEqual(f.search({ sorts:[{ columnId:f.number.id, direction:'asc' }], offset:2, limit:2 }), [f.rows[4], f.rows[2]]);
  } finally { f.close(); }
});
test('saved criteria prune deleted references and calendar presets handle leap days and Monday weeks', () => {
  const criteria = restoreViewCriteria(JSON.stringify({ logic:'or', filters:[{ columnId:'gone', op:'equals', value:'a' }], groups:[{ id:'group', logic:'and', filters:[{ columnId:'kept', op:'contains', value:'x' }] }], sorts:[{ columnId:'$created',direction:'desc' },{ columnId:'gone',direction:'asc' }] }));
  const pruned = pruneViewCriteria(criteria, new Set(['kept']));
  assert.equal(pruned.filters.length,0); assert.equal(pruned.groups[0].filters.length,1); assert.equal(pruned.sorts.length,1);
  assert.equal(restoreViewCriteria('{broken').filters.length,0);
  assert.deepEqual(relativeDateRange('today', new Date(2024,1,29,12)), ['2024-02-29','2024-02-29']);
  assert.deepEqual(relativeDateRange('last_month', new Date(2024,2,10,12)), ['2024-02-01','2024-02-29']);
  assert.deepEqual(relativeDateRange('this_week', new Date(2026,10,15,12)), ['2026-11-09','2026-11-15']);
  assert.deepEqual(relativeDateRange('last_7', new Date(2026,0,3,12)), ['2025-12-28','2026-01-03']);
});
