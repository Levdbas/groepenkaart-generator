import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sources = await Promise.all(['warnings', 'rcd', 'schema', 'app'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));
const readSchema = async (version) => JSON.parse(await readFile(
   new URL(`../schemas/groepenkaart-v${version}.schema.json`, import.meta.url), 'utf8'));
const publishedSchema = await readSchema(3);
const publishedV2Schema = await readSchema(2);
const publishedV1Schema = await readSchema(1);
const plain = (value) => JSON.parse(JSON.stringify(value));
const legacy = {
   warnings: ['pv', 'ev', 'battery', 'heat-pump'],
   boxes: [
      {
         number: '1', name: '', groups: [
            { number: '1', name: '', description: '' },
            { number: '2', name: '', description: '' }
         ]
      },
      { number: '2', name: '', groups: [] }
   ]
};
const v1 = { schemaVersion: 1, ...legacy };
// The shape published as schema version 2, before phase support.
const v2 = {
   schemaVersion: 2,
   warnings: legacy.warnings,
   rcboEnabled: false,
   rcbos: [],
   boxes: legacy.boxes.map((box) => ({ ...box, groups: box.groups.map((g) => ({ ...g, rcboId: null })) }))
};
const v3 = {
   schemaVersion: 3,
   warnings: legacy.warnings,
   rcdEnabled: false,
   phaseEnabled: false,
   rcds: [],
   boxes: legacy.boxes.map((box) => ({
      ...box, groups: box.groups.map((g) => ({ number: g.number, description: g.description, rcdId: null, phases: [] }))
   }))
};
const withRcdsV2 = {
   schemaVersion: 2,
   warnings: [],
   rcboEnabled: true,
   rcbos: [
      { id: 'r1', number: 'A1', name: 'Keuken', color: '#e53935' },
      { id: 'r2', number: '', name: '', color: '#fdd835' }
   ],
   boxes: [
      {
         number: '1', name: 'Meterkast', groups: [
            { number: '1', name: 'Keuken', description: '', rcboId: 'r1' },
            { number: '2', name: 'Hal', description: 'Verlichting', rcboId: null }
         ]
      },
      {
         number: '2', name: 'Garage', groups: [
            { number: '1', name: 'Werkbank', description: '', rcboId: 'r1' },
            { number: '2', name: '', description: 'Tuin', rcboId: 'r2' }
         ]
      }
   ]
};
// Group names are merged into the description when migrating from v2.
const withRcds = {
   schemaVersion: 3,
   warnings: [],
   rcdEnabled: true,
   phaseEnabled: false,
   rcds: [
      { id: 'r1', number: 'A1', name: 'Keuken', color: '#e53935', amountOfPoles: 2, phases: [] },
      { id: 'r2', number: '', name: '', color: '#fdd835', amountOfPoles: 2, phases: [] }
   ],
   boxes: [
      {
         number: '1', name: 'Meterkast', groups: [
            { number: '1', description: 'Keuken', rcdId: 'r1', phases: [] },
            { number: '2', description: 'Hal – Verlichting', rcdId: null, phases: [] }
         ]
      },
      {
         number: '2', name: 'Garage', groups: [
            { number: '1', description: 'Werkbank', rcdId: 'r1', phases: [] },
            { number: '2', description: 'Tuin', rcdId: 'r2', phases: [] }
         ]
      }
   ]
};

function setupSchema() {
   const window = {};
   const context = vm.createContext({ window });
   sources.slice(0, 3).forEach((source) => vm.runInContext(source, context));
   return { schema: window.GroepenkaartSchema, context };
}

function setupApp(stored = null) {
   const { schema, context } = setupSchema();
   assert.equal(schema.schemaUrl,
      'https://raw.githubusercontent.com/Levdbas/groepenkaart-generator/main/schemas/groepenkaart-v3.schema.json');
   assert.equal(publishedSchema.$id, schema.schemaUrl);
   assert.equal(publishedSchema.properties.$schema.type, 'string');
   assert.equal(publishedSchema.properties.$schema.format, 'uri');
   function node(tag) {
      return {
         tag, attrs: {}, children: [], listeners: {}, checked: false, value: '',
         setAttribute(key, value) {
            this.attrs[key] = value;
            if (key === 'value') this.value = String(value);
         },
         addEventListener(event, callback) { this.listeners[event] = callback; },
         appendChild(child) { this.children.push(child); },
         replaceChildren(...children) { this.children = children; },
         querySelectorAll() { return []; },
         click() { }, remove() { }
      };
   }
   const nodes = new Map();
   const messages = [];
   const confirms = [];
   let storage = stored;
   let exported;
   let confirmation = true;
   const pdfCalls = [];
   const document = {
      body: node('body'),
      createElement: node,
      createElementNS: (ns, tag) => node(tag),
      getElementById(id) {
         if (!nodes.has(id)) nodes.set(id, node());
         return nodes.get(id);
      }
   };
   Object.assign(context, {
      document, Blob,
      localStorage: {
         getItem(key) { assert.equal(key, 'groepenkaart:v1'); return storage; },
         setItem(key, value) { assert.equal(key, 'groepenkaart:v1'); storage = value; }
      },
      console: { warn(...args) { messages.push(args); } },
      alert(message) { messages.push(message); },
      confirm(message) { confirms.push(message); return confirmation; },
      URL: {
         createObjectURL(blob) { exported = blob; return 'blob:test'; },
         revokeObjectURL() { }
      },
      FileReader: class {
         readAsText(file) { this.result = file; this.onload(); }
      }
   });
   Object.assign(context.window, {
      GroepenkaartPdf: { today: () => '2026-10-09', download(...args) { pdfCalls.push(plain(args)); return true; } },
      addEventListener() { }
   });
   vm.runInContext(sources[3], context);
   const findAll = (root, predicate, found = []) => {
      if (predicate(root)) found.push(root);
      root.children.forEach((child) => findAll(child, predicate, found));
      return found;
   };
   return {
      schema, nodes, messages, confirms, findAll, pdfCalls, storage: () => storage,
      confirm(value) { confirmation = value; },
      import(data) {
         nodes.get('import-json').listeners.change({ target: { files: [JSON.stringify(data)] } });
      },
      async export() {
         nodes.get('export-json').listeners.click();
         return JSON.parse(await exported.text());
      },
      selectWarning() {
         const checkbox = nodes.get('installation-options').children[0].children[0];
         checkbox.checked = true;
         checkbox.listeners.change();
      },
      setRcdEnabled(value) {
         const checkbox = nodes.get('rcd-enabled');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      setPhaseEnabled(value) {
         const checkbox = nodes.get('phase-enabled');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      addRcd() { nodes.get('add-rcd').listeners.click(); },
      selects() { return findAll(nodes.get('boxes'), (n) => n.tag === 'select'); },
      printCells() { return findAll(nodes.get('print-area'), (n) => n.tag === 'td' && n.className === 'rcd-cell'); },
      deleteRcd(index) {
         const item = nodes.get('rcd-list').children[index];
         findAll(item, (n) => n.attrs.title === 'Aardlekschakelaar verwijderen')[0].listeners.click();
      }
   };
}

test('unversioned files migrate through v1 and v2 to v3 without modifying the original data', () => {
   const { schema } = setupSchema();
   const original = structuredClone(legacy);
   assert.deepEqual(plain(schema.normalize(legacy)), v3);
   assert.deepEqual(legacy, original);
   assert.deepEqual(plain(schema.normalize({ boxes: [] })), plain(schema.empty()));
});

test('v1 files migrate to v3 with RCDs and phases disabled and no group links', () => {
   const { schema } = setupSchema();
   const original = structuredClone(v1);
   assert.deepEqual(plain(schema.normalize(v1)), v3);
   assert.deepEqual(v1, original);
});

test('v2 files migrate to v3 with default phase settings and keep all existing data', () => {
   const { schema } = setupSchema();
   for (const [source, expected] of [[v2, v3], [withRcdsV2, withRcds]]) {
      const original = structuredClone(source);
      assert.deepEqual(plain(schema.normalize(source)), expected);
      assert.deepEqual(source, original);
   }
   const withItems = structuredClone(withRcdsV2);
   withItems.warnings = ['pv'];
   withItems.boxes[0].groups[0].items = ['Vaatwasser'];
   const migrated = plain(schema.normalize(withItems));
   assert.deepEqual(migrated.warnings, ['pv']);
   assert.deepEqual(migrated.boxes[0].groups[0].items, ['Vaatwasser']);
   assert.deepEqual(migrated.rcds.map((rcd) => rcd.id), ['r1', 'r2']);
   assert.deepEqual(migrated.boxes.flatMap((box) => box.groups.map((group) => group.rcdId)), ['r1', null, 'r1', 'r2']);
});

test('v2 to v3 renames the RCBO fields to RCD fields', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcdsV2);
   data.boxes[0].groups[0].items = ['Vaatwasser', 'Oven'];
   const original = structuredClone(data);
   const migrated = plain(schema.normalize(data));
   assert.deepEqual(data, original);
   assert.equal(migrated.schemaVersion, 3);
   assert.equal(migrated.rcdEnabled, true);
   assert.deepEqual(migrated.rcds.map((rcd) => [rcd.id, rcd.number, rcd.name, rcd.color]), [
      ['r1', 'A1', 'Keuken', '#e53935'], ['r2', '', '', '#fdd835']
   ]);
   assert.deepEqual(migrated.boxes.flatMap((box) => box.groups.map((group) => group.rcdId)), ['r1', null, 'r1', 'r2']);
   assert.deepEqual(migrated.boxes[0].groups[0].items, ['Vaatwasser', 'Oven']);
   for (const key of ['rcboEnabled', 'rcbos']) assert.ok(!(key in migrated), `${key} is removed`);
   assert.ok(migrated.boxes.every((box) => box.groups.every((group) => !('rcboId' in group))));
   assert.ok(!/rcbo/i.test(JSON.stringify(migrated)), 'no RCBO names remain anywhere in the output');
   assert.deepEqual(plain(schema.normalize(migrated)), migrated, 'migrating the result again is a no-op');

   const disabled = structuredClone(v2);
   assert.equal(disabled.rcboEnabled, false);
   assert.deepEqual(disabled.rcbos, []);
   const disabledOriginal = structuredClone(disabled);
   const result = plain(schema.normalize(disabled));
   assert.deepEqual(disabled, disabledOriginal);
   assert.equal(result.rcdEnabled, false);
   assert.deepEqual(result.rcds, []);
   assert.ok(!/rcbo/i.test(JSON.stringify(result)));
});

test('v2 files with invalid RCBO fields are still rejected after the rename', () => {
   const { schema } = setupSchema();
   const variant = (change) => { const data = structuredClone(withRcdsV2); change(data); return data; };
   for (const [data, message] of [
      [variant((d) => { delete d.rcboEnabled; }), /rcdEnabled/],
      [variant((d) => { d.rcboEnabled = 'true'; }), /rcdEnabled/],
      [variant((d) => { d.rcbos = null; }), /rcds/],
      [variant((d) => { delete d.boxes[0].groups[0].rcboId; }), /rcdId/],
      [variant((d) => { d.boxes[0].groups[0].rcboId = 1; }), /rcdId/],
      [variant((d) => { d.boxes[0].groups[0].rcboId = 'missing'; }), /onbekende aardlekschakelaar/],
      [variant((d) => { d.rcboEnabled = false; }), /Ongeldig/]
   ]) {
      assert.throws(() => schema.normalize(data), message);
   }
});

test('v2 files that already contain phase fields keep them and get missing ones derived', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcdsV2);
   data.phaseEnabled = true;
   data.rcbos[0].phases = ['L2'];
   data.rcbos[1].amountOfPoles = 4;
   data.boxes[1].groups[1].phases = ['L3', 'L1'];
   const original = structuredClone(data);
   const migrated = plain(schema.normalize(data));
   assert.deepEqual(data, original);
   assert.equal(migrated.schemaVersion, 3);
   assert.equal(migrated.phaseEnabled, true);
   assert.deepEqual(migrated.rcds.map((rcd) => [rcd.amountOfPoles, rcd.phases]), [[2, ['L2']], [4, ['L1', 'L2', 'L3']]]);
   assert.deepEqual(migrated.boxes.flatMap((box) => box.groups.map((group) => group.phases)), [[], [], [], ['L1', 'L3']]);
   assert.deepEqual(plain(schema.normalize(migrated)), migrated);
   const invalid = structuredClone(data);
   invalid.phaseEnabled = 'true';
   assert.throws(() => schema.normalize(invalid), /phaseEnabled/);
   invalid.phaseEnabled = true;
   invalid.rcbos[0].amountOfPoles = 3;
   assert.throws(() => schema.normalize(invalid), /amountOfPoles/);
});

test('v2 to v3 merges each group name into its description and removes the name field', () => {
   const { schema } = setupSchema();
   const group = (name, description, extra = {}) => ({ number: '1', name, description, rcboId: null, ...extra });
   const data = {
      schemaVersion: 2, warnings: [], rcboEnabled: false, rcbos: [],
      boxes: [{
         number: '1', name: 'Kast', groups: [
            group('Keuken', 'Wandcontactdozen'),
            group('Keuken', ''),
            group('', 'Wandcontactdozen'),
            group('', ''),
            group('  ', 'Verlichting'),
            group(' Hal ', '  '),
            group('Garage', 'Lichten', { items: ['Lamp'] })
         ]
      }]
   };
   const original = structuredClone(data);
   const migrated = plain(schema.normalize(data));
   assert.deepEqual(data, original);
   assert.deepEqual(migrated.boxes[0].groups.map((g) => g.description),
      ['Keuken – Wandcontactdozen', 'Keuken', 'Wandcontactdozen', '', 'Verlichting', 'Hal', 'Garage – Lichten']);
   assert.ok(migrated.boxes[0].groups.every((g) => !('name' in g)));
   assert.deepEqual(migrated.boxes[0].groups[6].items, ['Lamp']);
   assert.equal(migrated.boxes[0].name, 'Kast', 'box names are not affected');
   assert.deepEqual(plain(schema.normalize(migrated)), migrated, 'migrating again does not repeat the prefix');
   for (const change of [(g) => { delete g.name; }, (g) => { g.name = null; }, (g) => { g.name = 5; }]) {
      const invalid = structuredClone(data);
      change(invalid.boxes[0].groups[0]);
      assert.throws(() => schema.normalize(invalid), /tekstvelden.*name/);
   }
   const invalid = structuredClone(data);
   invalid.boxes[0].groups[0].description = null;
   assert.throws(() => schema.normalize(invalid), /tekstvelden.*description/);
});

test('v1 and legacy files merge group names into descriptions through the whole migration chain', () => {
   const { schema } = setupSchema();
   const data = schema.normalize({
      schemaVersion: 0,
      boxes: [{ number: 1, groups: [{ number: 2, name: 'Keuken', description: 7 }, { name: 'Hal' }] }]
   });
   assert.deepEqual(data.boxes[0].groups.map((g) => g.description), ['Keuken – 7', 'Hal']);
   assert.deepEqual(plain(schema.normalize({ schemaVersion: 1, warnings: [], boxes: [
      { number: '1', name: '', groups: [{ number: '1', name: 'Garage', description: 'Lichten' }] }
   ] })).boxes[0].groups[0].description, 'Garage – Lichten');
});

test('v3 groups have no name: a leftover name is ignored and the description is required', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcds);
   data.boxes[0].groups[0].name = 'Oud';
   const normalized = plain(schema.normalize(data));
   assert.deepEqual(normalized, withRcds);
   assert.ok(!('name' in normalized.boxes[0].groups[0]));
   delete data.boxes[0].groups[0].description;
   assert.throws(() => schema.normalize(data), /tekstvelden.*description/);
   data.boxes[0].groups[0].description = 3;
   assert.throws(() => schema.normalize(data), /tekstvelden.*description/);
});

test('legacy migration preserves numeric fields, missing fields, and old browser IDs', () => {
   const { schema } = setupSchema();
   const data = schema.normalize({
      schemaVersion: 0,
      boxes: [{ id: 'old', number: 2, groups: [{ id: 'old-group', number: 3 }] }, {}]
   });
   assert.deepEqual(plain(data), {
      schemaVersion: 3, warnings: [], rcdEnabled: false, phaseEnabled: false, rcds: [],
      boxes: [
         { number: '2', name: '', groups: [{ number: '3', description: '', rcdId: null, phases: [] }] },
         { number: '', name: '', groups: [] }
      ]
   });
});

test('v3 round-trip keeps all data, RCD IDs, and strips UI-only IDs', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcds);
   data.boxes[0].id = 'box-id';
   data.boxes[0].groups[0].id = 'group-id';
   data.rcds[0].color = '#E53935';
   const normalized = plain(schema.normalize(data));
   assert.deepEqual(normalized, withRcds);
   assert.deepEqual(plain(schema.normalize(normalized)), normalized);
   assert.deepEqual(plain(schema.empty()), { schemaVersion: 3, warnings: [], rcdEnabled: false, phaseEnabled: false, rcds: [], boxes: [] });
});

test('v3 files that still use the old RCBO field names are rejected', () => {
   const { schema } = setupSchema();
   const old = structuredClone(withRcds);
   old.rcboEnabled = old.rcdEnabled;
   old.rcbos = old.rcds;
   delete old.rcdEnabled;
   delete old.rcds;
   old.boxes.forEach((box) => box.groups.forEach((group) => {
      group.rcboId = group.rcdId;
      delete group.rcdId;
   }));
   assert.throws(() => schema.normalize(old), /rcdEnabled/);
});

test('v3 requires phaseEnabled to be a boolean and preserves explicit booleans', () => {
   const { schema } = setupSchema();
   for (const phaseEnabled of [false, true]) {
      const expected = { ...withRcds, phaseEnabled };
      assert.deepEqual(plain(schema.normalize(expected)), expected);
   }
   const missing = structuredClone(withRcds);
   delete missing.phaseEnabled;
   for (const phaseEnabled of [undefined, null, 'true', 0, 1, [], {}]) {
      const data = { ...missing };
      if (phaseEnabled !== undefined) data.phaseEnabled = phaseEnabled;
      assert.throws(() => schema.normalize(data), /phaseEnabled/);
   }
});

test('invalid and newer versions are rejected before interpreting their contents', () => {
   const { schema } = setupSchema();
   for (const version of [null, '1', true, -1, 1.5, {}, []]) {
      assert.throws(() => schema.normalize({ schemaVersion: version, boxes: [] }), /schemaVersion/);
   }
   assert.throws(() => schema.normalize({ schemaVersion: 4 }), /nieuwere schemaversie/);
   assert.throws(() => schema.normalize({ schemaVersion: Number.MAX_SAFE_INTEGER }), /nieuwere schemaversie/);
});

test('v3 requires pole counts and phases and validates unique phase codes and RCD cardinality', () => {
   const { schema, context } = setupSchema();
   const data = structuredClone(withRcds);
   data.phaseEnabled = true;
   data.rcds[0].phases = ['L2'];
   data.rcds[1].amountOfPoles = 4;
   data.rcds[1].phases = ['L3', 'L1', 'L2'];
   data.boxes[1].groups[1].phases = ['L3', 'L1'];
   const original = structuredClone(data);
   const normalized = plain(schema.normalize(data));
   assert.deepEqual(data, original);
   assert.deepEqual(normalized.rcds[1].phases, ['L1', 'L2', 'L3']);
   assert.deepEqual(normalized.boxes[1].groups[1].phases, ['L1', 'L3']);
   assert.deepEqual(plain(schema.normalize(normalized)), normalized);
   const helpers = context.window.GroepenkaartRcd;
   assert.deepEqual(plain(helpers.groupPhases(normalized.boxes[0].groups[0], normalized.rcds[0])), ['L2']);
   assert.deepEqual(plain(helpers.groupPhases(normalized.boxes[1].groups[1], normalized.rcds[1])), ['L1', 'L3']);
   const variant = (change) => { const copy = structuredClone(data); change(copy); return copy; };
   for (const [invalid, message] of [
      [variant((d) => { delete d.rcds[0].amountOfPoles; }), /amountOfPoles/],
      [variant((d) => { delete d.rcds[0].phases; }), /phases/],
      [variant((d) => { delete d.boxes[0].groups[0].phases; }), /phases/],
      ...[null, 0, 1, 3, '2', 2.5, true].map((amountOfPoles) =>
         [variant((d) => { d.rcds[0].amountOfPoles = amountOfPoles; }), /amountOfPoles/]),
      ...[null, 'L1', {}, ['L4'], ['L1', 'L1'], [1]].flatMap((phases) => [
         [variant((d) => { d.rcds[0].phases = phases; }), /phases/],
         [variant((d) => { d.boxes[0].groups[0].phases = phases; }), /phases/]
      ]),
      [variant((d) => { d.rcds[0].phases = ['L1', 'L2']; }), /2-polige/],
      [variant((d) => { d.rcds[1].phases = []; }), /4-polige/],
      [variant((d) => { d.rcds[1].phases = ['L1', 'L2']; }), /4-polige/]
   ]) {
      assert.throws(() => schema.normalize(invalid), message);
   }
});

test('optional group items preserve arrays across schema versions without changing the version', () => {
   const { schema } = setupSchema();
   for (const source of [legacy, v1, v2, v3, withRcdsV2, withRcds]) {
      const data = structuredClone(source);
      data.boxes[0].groups[0].items = ['Vaatwasser', 'Stopcontacten'];
      data.boxes[0].groups[1].items = [];
      const original = structuredClone(data);
      const normalized = plain(schema.normalize(data));
      assert.equal(normalized.schemaVersion, 3);
      assert.deepEqual(normalized.boxes[0].groups[0].items, ['Vaatwasser', 'Stopcontacten']);
      assert.deepEqual(normalized.boxes[0].groups[1].items, []);
      assert.deepEqual(plain(schema.normalize(normalized)), normalized);
      assert.deepEqual(data, original);
   }
});

test('invalid group items are rejected without replacing browser data', () => {
   const { schema } = setupSchema();
   const app = setupApp(JSON.stringify(withRcds));
   const stored = app.storage();
   for (const items of [null, 'Vaatwasser', {}, [1], ['Vaatwasser', false], [null], [[]]]) {
      const data = structuredClone(withRcds);
      data.boxes[0].groups[0].items = items;
      assert.throws(() => schema.normalize(data), /items.*lijst met tekst/);
      app.import(data);
      assert.equal(app.storage(), stored);
      assert.match(app.messages.at(-1), /Importeren mislukt.*items/);
   }
});

test('v1 input is still validated for required arrays, objects, strings, and warning codes', () => {
   const { schema } = setupSchema();
   for (const data of [
      null, [], {}, { boxes: [null] }, { boxes: [{ groups: [null] }] },
      { schemaVersion: 1, boxes: [] },
      { schemaVersion: 1, warnings: [], boxes: {} },
      { schemaVersion: 1, warnings: ['unknown'], boxes: [] },
      { schemaVersion: 1, warnings: [], boxes: [null] },
      { schemaVersion: 1, warnings: [], boxes: [{ number: 1, name: '', groups: [] }] },
      { schemaVersion: 1, warnings: [], boxes: [{ number: '1', name: '', groups: null }] },
      { schemaVersion: 1, warnings: [], boxes: [{ number: '1', name: '', groups: [null] }] },
      {
         schemaVersion: 1, warnings: [], boxes: [{
            number: '1', name: '', groups: [
               { number: '1', name: '', description: null }
            ]
         }]
      }
   ]) {
      assert.throws(() => schema.normalize(data), /Ongeldig/);
   }
});

test('v3 validates RCD settings, colors, unique IDs, and group references', () => {
   const { schema } = setupSchema();
   const variant = (change) => { const data = structuredClone(withRcds); change(data); return data; };
   for (const data of [
      variant((d) => { delete d.rcdEnabled; }),
      variant((d) => { delete d.phaseEnabled; }),
      variant((d) => { d.rcdEnabled = 'true'; }),
      variant((d) => { d.rcds = null; }),
      variant((d) => { d.rcdEnabled = false; }),
      variant((d) => { d.rcds[0].color = 'red'; }),
      variant((d) => { d.rcds[0].color = '#fff'; }),
      variant((d) => { d.rcds[0].id = ''; }),
      variant((d) => { d.rcds[1].id = 'r1'; }),
      variant((d) => { d.rcds[0].name = null; }),
      variant((d) => { d.rcds[0] = null; }),
      variant((d) => { d.boxes[0].groups[0].rcdId = 'missing'; }),
      variant((d) => { d.boxes[0].groups[0].rcdId = 1; }),
      variant((d) => { delete d.boxes[0].groups[1].rcdId; })
   ]) {
      assert.throws(() => schema.normalize(data), /Ongeldig/);
   }
   assert.throws(() => schema.normalize(variant((d) => { delete d.rcdEnabled; })), /rcdEnabled/);
   assert.throws(() => schema.normalize(variant((d) => { d.rcdEnabled = 'true'; })), /"rcdEnabled" moet waar of onwaar zijn/);
   assert.throws(() => schema.normalize(variant((d) => { d.rcds = null; })), /"rcds" moet een lijst zijn/);
   assert.throws(() => schema.normalize(variant((d) => { d.boxes[0].groups[0].rcdId = 1; })),
      /"rcdId" van een groep moet tekst of null zijn/);
   assert.throws(() => schema.normalize(variant((d) => { d.boxes[0].groups[0].rcdId = 'missing'; })),
      /onbekende aardlekschakelaar/);
});

test('published schemas match the current version, required fields, and warning codes', () => {
   const { schema, context } = setupSchema();
   assert.equal(publishedSchema.properties.schemaVersion.const, schema.currentVersion);
   assert.deepEqual(publishedSchema.required, Object.keys(plain(schema.empty())));
   assert.deepEqual(publishedSchema.properties.warnings.items.enum,
      Array.from(context.window.GroepenkaartWarnings.codes));
   assert.deepEqual(publishedV2Schema.properties.warnings.items.enum,
      Array.from(context.window.GroepenkaartWarnings.codes));
   assert.deepEqual(publishedV1Schema.properties.warnings.items.enum,
      Array.from(context.window.GroepenkaartWarnings.codes));
   assert.ok(publishedSchema.properties.warnings.items.enum.includes('ev'));
   assert.equal(publishedSchema.properties.rcdEnabled.type, 'boolean');
   assert.equal(publishedSchema.properties.phaseEnabled.type, 'boolean');
   assert.ok(publishedSchema.required.includes('phaseEnabled'));
   assert.deepEqual(publishedSchema.required, ['schemaVersion', 'warnings', 'rcdEnabled', 'phaseEnabled', 'rcds', 'boxes']);
   assert.deepEqual(publishedSchema.$defs.phases.items.enum, ['L1', 'L2', 'L3']);
   assert.equal(publishedSchema.$defs.phases.uniqueItems, true);
   assert.equal(publishedSchema.$defs.phases.maxItems, 3);
   assert.deepEqual(publishedSchema.$defs.rcd.properties.amountOfPoles.enum, [2, 4]);
   assert.ok(publishedSchema.$defs.rcd.required.includes('amountOfPoles'));
   assert.ok(publishedSchema.$defs.rcd.required.includes('phases'));
   assert.ok(publishedSchema.$defs.group.required.includes('phases'));
   assert.equal(publishedSchema.$defs.rcd.then.properties.phases.minItems, 3);
   assert.equal(publishedSchema.$defs.rcd.else.properties.phases.maxItems, 1);
   const strings = { box: ['number', 'name'], group: ['number', 'description'], rcd: ['id', 'number', 'name', 'color'] };
   for (const [name, fields] of Object.entries(strings)) {
      const definition = publishedSchema.$defs[name];
      assert.deepEqual(definition.required, Object.keys(definition.properties).filter((field) => field !== 'items'));
      for (const field of fields) assert.equal(definition.properties[field].type, 'string');
   }
   assert.deepEqual(Object.keys(publishedSchema.$defs.group.properties), ['number', 'description', 'items', 'rcdId', 'phases']);
   assert.ok(!publishedSchema.$defs.group.required.includes('name'));
   assert.deepEqual(publishedSchema.$defs.group.properties.rcdId.type, ['string', 'null']);
   assert.equal(publishedSchema.$defs.group.properties.items.type, 'array');
   assert.equal(publishedSchema.$defs.group.properties.items.items.type, 'string');
   assert.ok(!publishedSchema.$defs.group.required.includes('items'));
   assert.equal(publishedSchema.title, 'JSON schema for groepenkaart v3');
   assert.equal(publishedV1Schema.properties.schemaVersion.const, 1);
   assert.equal(publishedV1Schema.$id, schema.schemaUrl.replace('-v3.', '-v1.'));
});

test('the published v2 schema stays unchanged and does not describe phase fields', () => {
   const { schema } = setupSchema();
   assert.equal(publishedV2Schema.$id, schema.schemaUrl.replace('-v3.', '-v2.'));
   assert.equal(publishedV2Schema.title, 'JSON schema for groepenkaart v2');
   assert.equal(publishedV2Schema.properties.schemaVersion.const, 2);
   assert.deepEqual(publishedV2Schema.required, ['schemaVersion', 'warnings', 'rcboEnabled', 'rcbos', 'boxes']);
   assert.ok(!('phaseEnabled' in publishedV2Schema.properties));
   assert.ok(!('phases' in publishedV2Schema.$defs));
   assert.deepEqual(Object.keys(publishedV2Schema.$defs.rcbo.properties), ['id', 'number', 'name', 'color']);
   assert.deepEqual(Object.keys(publishedV2Schema.$defs.group.properties), ['number', 'name', 'description', 'items', 'rcboId']);
   assert.ok(publishedV2Schema.$defs.group.required.includes('name'));
});

test('browser storage migrates on load and exports the same portable versioned data', async () => {
   const app = setupApp(JSON.stringify(legacy));
   assert.deepEqual(JSON.parse(app.storage()), v3);
   assert.deepEqual(await app.export(), { $schema: app.schema.schemaUrl, ...v3 });
   assert.equal(app.nodes.get('installation-options').children.length, 3);
   app.selectWarning();
   assert.deepEqual(JSON.parse(app.storage()).warnings, legacy.warnings);
   assert.equal(app.nodes.get('boxes').children.length, 2);
   assert.equal(app.nodes.get('rcd-panel').hidden, true);
   assert.equal(app.selects().length, 0);
   assert.deepEqual(app.messages, []);
});

test('imports migrate legacy files and rejected imports leave current data untouched', async () => {
   const app = setupApp();
   app.import(legacy);
   const stored = app.storage();
   app.import({ schemaVersion: 4, boxes: [] });
   assert.equal(app.storage(), stored);
   assert.deepEqual(await app.export(), { $schema: app.schema.schemaUrl, ...v3 });
   assert.match(app.messages[0], /Importeren mislukt.*nieuwere schemaversie/);
   app.import({ ...structuredClone(withRcds), rcds: [] });
   assert.equal(app.storage(), stored);
   assert.match(app.messages[1], /Importeren mislukt.*onbekende aardlekschakelaar/);
   app.confirm(false);
   app.import({ boxes: [] });
   assert.equal(app.storage(), stored);
});

test('exported files include the raw schema URL and can be imported again without storing metadata', async () => {
   const app = setupApp(JSON.stringify(withRcds));
   const exported = await app.export();
   assert.equal(exported.$schema, publishedSchema.$id);
   const imported = setupApp();
   imported.import(exported);
   assert.deepEqual(JSON.parse(imported.storage()), withRcds);
   assert.deepEqual(await imported.export(), exported);
   assert.deepEqual(await setupApp().export(), {
      $schema: publishedSchema.$id, schemaVersion: 3, warnings: [], rcdEnabled: false, phaseEnabled: false, rcds: [], boxes: []
   });
});

test('phase toggle persists, reloads, round-trips and leaves group data unchanged', async () => {
   const app = setupApp(JSON.stringify(withRcdsV2));
   assert.deepEqual(JSON.parse(app.storage()), withRcds);
   assert.equal(app.nodes.get('phase-enabled').checked, false);
   assert.equal(JSON.parse(app.storage()).phaseEnabled, false);
   assert.equal(app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-phases').length, 0);
   app.setPhaseEnabled(true);
   const expected = { ...withRcds, phaseEnabled: true };
   assert.deepEqual(JSON.parse(app.storage()), expected);
   assert.equal(app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-phases').length, 4);
   const reloaded = setupApp(app.storage());
   assert.equal(reloaded.nodes.get('phase-enabled').checked, true);
   const exported = await app.export();
   assert.deepEqual(exported, { $schema: publishedSchema.$id, ...expected });
   const imported = setupApp();
   imported.import(exported);
   assert.equal(imported.nodes.get('phase-enabled').checked, true);
   assert.deepEqual(JSON.parse(imported.storage()), expected);
   imported.setPhaseEnabled(false);
   assert.deepEqual(JSON.parse(imported.storage()), withRcds);
   imported.import({ ...exported, phaseEnabled: 'true' });
   assert.deepEqual(JSON.parse(imported.storage()), withRcds);
   assert.match(imported.messages[0], /Importeren mislukt.*phaseEnabled/);
});

test('phase-only settings prompt before replacement and clear-all resets the toggle', () => {
   const app = setupApp();
   app.setPhaseEnabled(true);
   const stored = app.storage();
   app.confirm(false);
   app.import(v2);
   assert.equal(app.confirms.length, 1);
   assert.equal(app.storage(), stored);
   app.nodes.get('clear-all').listeners.click();
   assert.equal(app.storage(), stored);
   assert.equal(app.nodes.get('phase-enabled').checked, true);
   app.confirm(true);
   app.nodes.get('clear-all').listeners.click();
   assert.deepEqual(JSON.parse(app.storage()), plain(app.schema.empty()));
   assert.equal(app.nodes.get('phase-enabled').checked, false);
   app.import({ ...v2, phaseEnabled: true });
   assert.equal(app.nodes.get('phase-enabled').checked, true);
   app.import(v2);
   assert.equal(app.nodes.get('phase-enabled').checked, false);
});

test('phase options precede RCD options and expanded group layout follows feature toggles', async () => {
   const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
   assert.ok(html.indexOf('id="phase-enabled"') < html.indexOf('id="rcd-enabled"'));
   const app = setupApp(JSON.stringify(withRcds));
   const table = () => app.findAll(app.nodes.get('boxes'), (n) => n.tag === 'table')[0];
   assert.equal(table().className, 'groups-table has-rcds');
   app.setPhaseEnabled(true);
   assert.equal(table().className, 'groups-table has-phases has-rcds');
   const description = app.findAll(table(), (n) => n.className === 'group-description')[0];
   assert.equal(description.attrs['data-label'], 'Omschrijving');
   app.setRcdEnabled(false);
   assert.equal(table().className, 'groups-table has-phases');
   assert.equal(app.findAll(table(), (n) => n.className === 'group-rcd').length, 0);
   app.setPhaseEnabled(false);
   assert.equal(table().className, 'groups-table');
});

test('groups have no name field: the description takes its place in the editor, PDF data and print output', () => {
   const app = setupApp(JSON.stringify(withRcds));
   const boxes = () => app.nodes.get('boxes');
   const labels = () => app.findAll(boxes(), (n) => n.attrs['aria-label'] !== undefined).map((n) => n.attrs['aria-label']);
   assert.ok(!labels().includes('Groepnaam'));
   assert.equal(labels().filter((label) => label === 'Omschrijving').length, 4);
   assert.deepEqual(app.findAll(boxes(), (n) => n.tag === 'th').slice(0, 3).map((n) => n.textContent),
      ['Groep', 'Omschrijving', 'Aardlekschakelaar']);
   const row = () => app.findAll(boxes(), (n) => n.tag === 'tr' && n.children[0].className === 'group-number')[0];
   assert.deepEqual(row().children.map((cell) => cell.className),
      ['group-number', 'group-description', 'group-rcd', 'group-actions']);
   const description = app.findAll(row().children[1], (n) => n.attrs['aria-label'] === 'Omschrijving')[0];
   assert.equal(description.value, 'Keuken');
   assert.equal(app.findAll(row().children[1], (n) => n.tag === 'textarea').length, 1);
   description.value = 'Keuken en bijkeuken';
   description.listeners.input();
   const stored = JSON.parse(app.storage());
   assert.equal(stored.boxes[0].groups[0].description, 'Keuken en bijkeuken');
   assert.ok(stored.boxes.every((box) => box.groups.every((group) => !('name' in group))));
   const firstPage = app.findAll(app.nodes.get('print-area'), (n) => n.tag === 'article')[0];
   assert.deepEqual(app.findAll(firstPage, (n) => n.tag === 'th').map((n) => n.textContent), ['Groep', 'Omschrijving']);
   const printRow = app.findAll(firstPage, (n) => n.tag === 'tr' && n.children[0].tag === 'td')[0];
   assert.equal(printRow.children.length, 2);
   assert.equal(printRow.children[1].children[0].textContent, 'Keuken en bijkeuken');
   app.nodes.get('add-box').listeners.click();
   const added = JSON.parse(app.storage()).boxes.at(-1).groups[0];
   assert.deepEqual(Object.keys(added).sort(), ['description', 'number', 'phases', 'rcdId']);
   app.findAll(boxes(), (n) => n.className === 'btn btn-primary btn-add-group')[0].listeners.click();
   assert.deepEqual(Object.keys(JSON.parse(app.storage()).boxes[0].groups.at(-1)).sort(), ['description', 'number', 'phases', 'rcdId']);

   app.setPhaseEnabled(true);
   assert.deepEqual(row().children.map((cell) => cell.className),
      ['group-number', 'group-description', 'group-items', 'group-rcd', 'group-phases', 'group-actions']);
   assert.equal(app.findAll(row().children[1], (n) => n.tag === 'textarea').length, 0);
   assert.equal(app.findAll(row().children[2], (n) => n.tag === 'textarea').length, 1);
   assert.equal(app.findAll(row().children[1], (n) => n.attrs['aria-label'] === 'Omschrijving')[0].value, 'Keuken en bijkeuken');
   app.setPhaseEnabled(false);
   assert.equal(row().children.length, 4);
});

test('phase editing applies inheritance immediately across boxes and preserves independent group selections', async () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.setPhaseEnabled(true);
   const rcdControl = (label) => app.findAll(app.nodes.get('rcd-list'), (n) => n.attrs['aria-label'] === label)[0];
   const phaseCells = () => app.findAll(app.nodes.get('boxes'), (n) => n.className === 'group-phases');
   const printPhases = () => app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-phases')
      .map((cell) => cell.textContent);
   const printBorders = () => app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-phase-border');
   const choose = (select, value) => { select.value = value; select.listeners.change(); };
   assert.deepEqual(printPhases(), Array(4).fill('Niet gekozen'));
   assert.equal(printBorders().length, 0);
   assert.equal(app.findAll(phaseCells()[0], (n) => n.tag === 'input').length, 0);
   choose(rcdControl('Fase aardlekschakelaar A1'), 'L2');
   assert.deepEqual(printPhases(), ['L2', 'Niet gekozen', 'L2', 'Niet gekozen']);
   assert.deepEqual(printBorders().map((border) => border.children.map((segment) => segment.attrs.style)),
      [['background-color: #000000'], ['background-color: #000000']]);
   const independent = app.findAll(phaseCells()[1], (n) => n.tag === 'input');
   for (const input of [independent[0], independent[2]]) {
      input.checked = true;
      input.listeners.change();
   }
   assert.deepEqual(printPhases(), ['L2', 'L1, L3', 'L2', 'Niet gekozen']);
   assert.deepEqual(printBorders()[1].children.map((segment) => segment.attrs.style),
      ['background-color: #8B4513', 'background-color: #808080']);
   const link = app.selects()[1];
   choose(link, 'r1');
   assert.equal(app.selects()[1], link, 'link selection keeps its DOM node and focus');
   assert.deepEqual(printPhases(), ['L2', 'L2', 'L2', 'Niet gekozen']);
   assert.equal(app.findAll(phaseCells()[1], (n) => n.tag === 'input').length, 0);
   assert.deepEqual(JSON.parse(app.storage()).boxes[0].groups[1].phases, ['L1', 'L3']);
   const poles = rcdControl('Aantal polen aardlekschakelaar A1');
   choose(poles, '4');
   assert.equal(rcdControl('Aantal polen aardlekschakelaar A1'), poles, 'pole selection keeps focus');
   assert.equal(rcdControl('Fase aardlekschakelaar A1'), undefined);
   assert.deepEqual(JSON.parse(app.storage()).rcds[0].phases, ['L1', 'L2', 'L3']);
   assert.deepEqual(printPhases(), ['Niet gekozen', 'L1, L3', 'Niet gekozen', 'Niet gekozen']);
   assert.equal(app.findAll(phaseCells()[0], (n) => n.tag === 'input').length, 3);
   const multi = app.findAll(phaseCells()[0], (n) => n.tag === 'input');
   multi.forEach((input) => { input.checked = true; input.listeners.change(); });
   assert.equal(printPhases()[0], 'L1, L2, L3');
   choose(poles, '2');
   assert.deepEqual(JSON.parse(app.storage()).rcds[0].phases, []);
   assert.equal(printPhases()[0], 'Niet gekozen');
   choose(rcdControl('Fase aardlekschakelaar A1'), 'L3');
   assert.deepEqual(printPhases(), ['L3', 'L3', 'L3', 'Niet gekozen']);
   const saved = JSON.parse(app.storage());
   const exported = await app.export();
   const reloaded = setupApp(app.storage());
   assert.deepEqual(await reloaded.export(), exported);
   const imported = setupApp();
   imported.import(exported);
   assert.deepEqual(JSON.parse(imported.storage()), saved);
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][4], true);
   app.setPhaseEnabled(false);
   assert.equal(phaseCells().length, 0);
   assert.deepEqual(printPhases(), []);
   assert.equal(printBorders().length, 0);
   assert.deepEqual(JSON.parse(app.storage()), { ...saved, phaseEnabled: false });
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][4], false);
   app.setPhaseEnabled(true);
   app.deleteRcd(0);
   assert.deepEqual(printPhases(), ['L1, L2, L3', 'L1, L3', 'Niet gekozen', 'Niet gekozen']);
   assert.equal(app.findAll(phaseCells()[0], (n) => n.tag === 'input').length, 3);
   const beforeInvalid = app.storage();
   const invalid = structuredClone(saved);
   invalid.rcds[0].amountOfPoles = 3;
   app.import(invalid);
   assert.equal(app.storage(), beforeInvalid);
   assert.match(app.messages[0], /Importeren mislukt.*amountOfPoles/);
});

test('RCDs can be added and linked to groups in any box, and linked groups are colored in print', () => {
   const app = setupApp(JSON.stringify(legacy));
   app.setRcdEnabled(true);
   assert.equal(app.nodes.get('rcd-panel').hidden, false);
   app.addRcd();
   app.addRcd();
   app.addRcd();
   app.addRcd();
   const state = JSON.parse(app.storage());
   assert.equal(state.rcdEnabled, true);
   assert.ok(state.rcds.every((rcd) => rcd.amountOfPoles === 2 && rcd.phases.length === 0));
   assert.deepEqual(state.rcds.map((r) => [r.number, r.color]), [
      ['A1', '#ed8c01'], ['A2', '#009fe3'], ['A3', '#95be1a'], ['A4', '#9e9e9e']
   ]);
   assert.notEqual(state.rcds[0].id, state.rcds[1].id);

   const selects = app.selects();
   assert.equal(selects.length, 2);
   assert.equal(selects[0].children.length, 5);
   selects[1].value = state.rcds[1].id;
   selects[1].listeners.change();
   const linked = JSON.parse(app.storage());
   assert.deepEqual(linked.boxes[0].groups.map((g) => g.rcdId), [null, state.rcds[1].id]);
   const cells = app.printCells();
   assert.equal(cells.length, 1);
   assert.equal(cells[0].textContent, '2 · A2');
   assert.match(cells[0].attrs.style, /background-color: #009fe3; color: #000000/);
   const key = app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-rcd-key');
   assert.equal(key.length, 1);
});

test('unused RCDs appear below warnings in the browser print output', () => {
   const data = structuredClone(withRcds);
   data.rcds.push({ id: 'r3', number: 'A3', name: 'Reserve', color: '#95be1a', amountOfPoles: 2, phases: [] });
   const app = setupApp(JSON.stringify(data));
   const section = app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-unused-rcds');
   assert.equal(section.length, 1);
   assert.equal(section[0].children[0].textContent, 'Aardlekschakelaars niet in gebruik');
   assert.deepEqual(section[0].children[1].children.map((item) => item.children[1].textContent), ['A3 – Reserve']);
});

test('RCD text color picks the higher-contrast option', () => {
   const { context } = setupSchema();
   const rcd = context.window.GroepenkaartRcd;
   assert.equal(rcd.textColor('#003f7d'), '#ffffff');
   assert.equal(rcd.textColor('#6d4c41'), '#ffffff');
   assert.equal(rcd.textColor('#fdd835'), '#000000');
   assert.equal(rcd.textColor('#1e88e5'), '#000000');
   for (const color of ['#ed8c01', '#009fe3', '#95be1a', '#9e9e9e']) assert.equal(rcd.textColor(color), '#000000');
});

test('textarea lines are saved as arrays and printed as bullets without re-rendering the input', async () => {
   const app = setupApp(JSON.stringify(withRcds));
   const input = app.findAll(app.nodes.get('boxes'), (n) => n.tag === 'textarea')[0];
   assert.equal(input.value, '');
   input.value = ' Vaatwasser \r\n\nStopcontacten\n <lamp> \n';
   input.listeners.input();
   assert.equal(app.findAll(app.nodes.get('boxes'), (n) => n.tag === 'textarea')[0], input);
   const stored = JSON.parse(app.storage());
   assert.deepEqual(stored.boxes[0].groups[0].items, ['Vaatwasser', 'Stopcontacten', '<lamp>']);
   assert.equal(stored.schemaVersion, 3);
   const exported = await app.export();
   assert.deepEqual(exported.boxes[0].groups[0].items, stored.boxes[0].groups[0].items);
   const lists = app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-group-items');
   assert.equal(lists.length, 1);
   assert.deepEqual(lists[0].children.map((n) => [n.tag, n.textContent]),
      [['li', 'Vaatwasser'], ['li', 'Stopcontacten'], ['li', '<lamp>']]);
   const restored = setupApp(app.storage());
   assert.equal(restored.findAll(restored.nodes.get('boxes'), (n) => n.tag === 'textarea')[0].value,
      'Vaatwasser\nStopcontacten\n<lamp>');
   restored.import(exported);
   assert.deepEqual(JSON.parse(restored.storage()).boxes[0].groups[0].items, stored.boxes[0].groups[0].items);
   input.value = ' \n\n ';
   input.listeners.input();
   assert.deepEqual(JSON.parse(app.storage()).boxes[0].groups[0].items, []);
   assert.equal(app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-group-items').length, 0);
});

test('default RCD colors follow the code, with gray for other codes', () => {
   const { context } = setupSchema();
   const rcd = context.window.GroepenkaartRcd;
   assert.equal(rcd.defaultColor('A1'), '#ed8c01');
   assert.equal(rcd.defaultColor(' a2 '), '#009fe3');
   assert.equal(rcd.defaultColor('A3'), '#95be1a');
   assert.equal(rcd.defaultColor('A4'), '#9e9e9e');
   assert.equal(rcd.defaultColor('B1'), '#9e9e9e');
});

test('deleting an RCD asks for confirmation and unlinks its groups in all boxes', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.confirm(false);
   app.deleteRcd(0);
   assert.deepEqual(JSON.parse(app.storage()), withRcds);
   assert.match(app.confirms.at(-1), /A1 – Keuken.*2 gekoppelde groepen worden ontkoppeld/);
   app.confirm(true);
   app.deleteRcd(0);
   const state = JSON.parse(app.storage());
   assert.deepEqual(state.rcds.map((r) => r.id), ['r2']);
   assert.deepEqual(state.boxes.flatMap((b) => b.groups.map((g) => g.rcdId)), [null, null, null, 'r2']);
});

test('disabling RCDs clears all RCDs and links only after confirmation', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.confirm(false);
   app.setRcdEnabled(false);
   assert.equal(app.nodes.get('rcd-enabled').checked, true);
   assert.deepEqual(JSON.parse(app.storage()), withRcds);
   app.confirm(true);
   app.setRcdEnabled(false);
   const state = JSON.parse(app.storage());
   assert.equal(state.rcdEnabled, false);
   assert.deepEqual(state.rcds, []);
   assert.ok(state.boxes.every((b) => b.groups.every((g) => g.rcdId === null)));
   assert.equal(app.selects().length, 0);
   assert.equal(app.printCells().length, 0);

   const empty = setupApp(JSON.stringify(legacy));
   empty.setRcdEnabled(true);
   const count = empty.confirms.length;
   empty.setRcdEnabled(false);
   assert.equal(empty.confirms.length, count, 'no confirmation needed without RCDs');
   assert.equal(JSON.parse(empty.storage()).rcdEnabled, false);
});

test('failed storage loads cannot be overwritten by edits or cancelled imports', () => {
   for (const stored of [JSON.stringify({ schemaVersion: 4, boxes: [] }), '{broken']) {
      const app = setupApp(stored);
      assert.equal(app.storage(), stored);
      assert.equal(app.messages.length, 2);
      app.selectWarning();
      assert.equal(app.storage(), stored);
      app.confirm(false);
      app.import(legacy);
      assert.equal(app.storage(), stored);
      app.confirm(true);
      app.import(legacy);
      assert.deepEqual(JSON.parse(app.storage()), v3);
   }
});

test('clearing data writes the current schema, including after a failed load or with only RCDs enabled', () => {
   for (const stored of [JSON.stringify(legacy), JSON.stringify({ schemaVersion: 4 }), JSON.stringify(withRcds)]) {
      const app = setupApp(stored);
      app.nodes.get('clear-all').listeners.click();
      assert.deepEqual(JSON.parse(app.storage()), {
         schemaVersion: 3, warnings: [], rcdEnabled: false, phaseEnabled: false, rcds: [], boxes: []
      });
   }
   const app = setupApp();
   app.setRcdEnabled(true);
   app.nodes.get('clear-all').listeners.click();
   assert.equal(JSON.parse(app.storage()).rcdEnabled, false);
});
