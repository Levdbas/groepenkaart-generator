import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sources = await Promise.all(['warnings', 'rcbo', 'schema', 'app'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));
const readSchema = async (version) => JSON.parse(await readFile(
   new URL(`../schemas/groepenkaart-v${version}.schema.json`, import.meta.url), 'utf8'));
const publishedSchema = await readSchema(2);
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
const v2 = {
   schemaVersion: 2,
   warnings: legacy.warnings,
   rcboEnabled: false,
   rcbos: [],
   boxes: legacy.boxes.map((box) => ({ ...box, groups: box.groups.map((g) => ({ ...g, rcboId: null })) }))
};
const withRcbos = {
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
            { number: '2', name: 'Hal', description: '', rcboId: null }
         ]
      },
      {
         number: '2', name: 'Garage', groups: [
            { number: '1', name: 'Werkbank', description: '', rcboId: 'r1' },
            { number: '2', name: 'Tuin', description: '', rcboId: 'r2' }
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
      'https://raw.githubusercontent.com/Levdbas/groepenkaart-generator/main/schemas/groepenkaart-v2.schema.json');
   assert.equal(publishedSchema.$id, schema.schemaUrl);
   assert.equal(publishedSchema.properties.$schema.type, 'string');
   assert.equal(publishedSchema.properties.$schema.format, 'uri');
   function node(tag) {
      return {
         tag, attrs: {}, children: [], listeners: {}, checked: false, value: '',
         setAttribute(key, value) { this.attrs[key] = value; },
         addEventListener(event, callback) { this.listeners[event] = callback; },
         appendChild(child) { this.children.push(child); },
         replaceChildren(...children) { this.children = children; },
         click() { }, remove() { }
      };
   }
   const nodes = new Map();
   const messages = [];
   const confirms = [];
   let storage = stored;
   let exported;
   let confirmation = true;
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
      GroepenkaartPdf: { today: () => '2026-10-09' },
      addEventListener() { }
   });
   vm.runInContext(sources[3], context);
   const findAll = (root, predicate, found = []) => {
      if (predicate(root)) found.push(root);
      root.children.forEach((child) => findAll(child, predicate, found));
      return found;
   };
   return {
      schema, nodes, messages, confirms, findAll, storage: () => storage,
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
      setRcboEnabled(value) {
         const checkbox = nodes.get('rcbo-enabled');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      addRcbo() { nodes.get('add-rcbo').listeners.click(); },
      selects() { return findAll(nodes.get('boxes'), (n) => n.tag === 'select'); },
      printCells() { return findAll(nodes.get('print-area'), (n) => n.tag === 'td' && n.className === 'rcbo-cell'); },
      deleteRcbo(index) {
         const item = nodes.get('rcbo-list').children[index];
         findAll(item, (n) => n.attrs.title === 'Aardlekschakelaar verwijderen')[0].listeners.click();
      }
   };
}

test('unversioned files migrate through v1 to v2 without modifying the original data', () => {
   const { schema } = setupSchema();
   const original = structuredClone(legacy);
   assert.deepEqual(plain(schema.normalize(legacy)), v2);
   assert.deepEqual(legacy, original);
   assert.deepEqual(plain(schema.normalize({ boxes: [] })), plain(schema.empty()));
});

test('v1 files migrate to v2 with RCBOs disabled and no group links', () => {
   const { schema } = setupSchema();
   const original = structuredClone(v1);
   assert.deepEqual(plain(schema.normalize(v1)), v2);
   assert.deepEqual(v1, original);
});

test('legacy migration preserves numeric fields, missing fields, and old browser IDs', () => {
   const { schema } = setupSchema();
   const data = schema.normalize({
      schemaVersion: 0,
      boxes: [{ id: 'old', number: 2, groups: [{ id: 'old-group', number: 3 }] }, {}]
   });
   assert.deepEqual(plain(data), {
      schemaVersion: 2, warnings: [], rcboEnabled: false, rcbos: [],
      boxes: [
         { number: '2', name: '', groups: [{ number: '3', name: '', description: '', rcboId: null }] },
         { number: '', name: '', groups: [] }
      ]
   });
});

test('v2 round-trip keeps all data, RCBO IDs, and strips UI-only IDs', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcbos);
   data.boxes[0].id = 'box-id';
   data.boxes[0].groups[0].id = 'group-id';
   data.rcbos[0].color = '#E53935';
   const normalized = plain(schema.normalize(data));
   assert.deepEqual(normalized, withRcbos);
   assert.deepEqual(plain(schema.normalize(normalized)), normalized);
   assert.deepEqual(plain(schema.empty()), { schemaVersion: 2, warnings: [], rcboEnabled: false, rcbos: [], boxes: [] });
});

test('invalid and newer versions are rejected before interpreting their contents', () => {
   const { schema } = setupSchema();
   for (const version of [null, '1', true, -1, 1.5, {}, []]) {
      assert.throws(() => schema.normalize({ schemaVersion: version, boxes: [] }), /schemaVersion/);
   }
   assert.throws(() => schema.normalize({ schemaVersion: 3 }), /nieuwere schemaversie/);
   assert.throws(() => schema.normalize({ schemaVersion: Number.MAX_SAFE_INTEGER }), /nieuwere schemaversie/);
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

test('v2 validates RCBO settings, colors, unique IDs, and group references', () => {
   const { schema } = setupSchema();
   const variant = (change) => { const data = structuredClone(withRcbos); change(data); return data; };
   for (const data of [
      variant((d) => { delete d.rcboEnabled; }),
      variant((d) => { d.rcboEnabled = 'true'; }),
      variant((d) => { d.rcbos = null; }),
      variant((d) => { d.rcboEnabled = false; }),
      variant((d) => { d.rcbos[0].color = 'red'; }),
      variant((d) => { d.rcbos[0].color = '#fff'; }),
      variant((d) => { d.rcbos[0].id = ''; }),
      variant((d) => { d.rcbos[1].id = 'r1'; }),
      variant((d) => { d.rcbos[0].name = null; }),
      variant((d) => { d.rcbos[0] = null; }),
      variant((d) => { d.boxes[0].groups[0].rcboId = 'missing'; }),
      variant((d) => { d.boxes[0].groups[0].rcboId = 1; }),
      variant((d) => { delete d.boxes[0].groups[1].rcboId; })
   ]) {
      assert.throws(() => schema.normalize(data), /Ongeldig/);
   }
});

test('published schemas match the current version, required fields, and warning codes', () => {
   const { schema, context } = setupSchema();
   assert.equal(publishedSchema.properties.schemaVersion.const, schema.currentVersion);
   assert.deepEqual(publishedSchema.required, Object.keys(plain(schema.empty())));
   assert.deepEqual(publishedSchema.properties.warnings.items.enum,
      Array.from(context.window.GroepenkaartWarnings.definitions, (warning) => warning.id));
   assert.equal(publishedSchema.properties.rcboEnabled.type, 'boolean');
   const strings = { box: ['number', 'name'], group: ['number', 'name', 'description'], rcbo: ['id', 'number', 'name', 'color'] };
   for (const [name, fields] of Object.entries(strings)) {
      const definition = publishedSchema.$defs[name];
      assert.deepEqual(definition.required, Object.keys(definition.properties));
      for (const field of fields) assert.equal(definition.properties[field].type, 'string');
   }
   assert.deepEqual(publishedSchema.$defs.group.properties.rcboId.type, ['string', 'null']);
   assert.equal(publishedV1Schema.properties.schemaVersion.const, 1);
   assert.equal(publishedV1Schema.$id, schema.schemaUrl.replace('-v2.', '-v1.'));
});

test('browser storage migrates on load and exports the same portable versioned data', async () => {
   const app = setupApp(JSON.stringify(legacy));
   assert.deepEqual(JSON.parse(app.storage()), v2);
   assert.deepEqual(await app.export(), { $schema: app.schema.schemaUrl, ...v2 });
   assert.equal(app.nodes.get('boxes').children.length, 2);
   assert.equal(app.nodes.get('rcbo-panel').hidden, true);
   assert.equal(app.selects().length, 0);
   assert.deepEqual(app.messages, []);
});

test('imports migrate legacy files and rejected imports leave current data untouched', async () => {
   const app = setupApp();
   app.import(legacy);
   const stored = app.storage();
   app.import({ schemaVersion: 3, boxes: [] });
   assert.equal(app.storage(), stored);
   assert.deepEqual(await app.export(), { $schema: app.schema.schemaUrl, ...v2 });
   assert.match(app.messages[0], /Importeren mislukt.*nieuwere schemaversie/);
   app.import({ ...structuredClone(withRcbos), rcbos: [] });
   assert.equal(app.storage(), stored);
   assert.match(app.messages[1], /Importeren mislukt.*onbekende aardlekschakelaar/);
   app.confirm(false);
   app.import({ boxes: [] });
   assert.equal(app.storage(), stored);
});

test('exported files include the raw schema URL and can be imported again without storing metadata', async () => {
   const app = setupApp(JSON.stringify(withRcbos));
   const exported = await app.export();
   assert.equal(exported.$schema, publishedSchema.$id);
   const imported = setupApp();
   imported.import(exported);
   assert.deepEqual(JSON.parse(imported.storage()), withRcbos);
   assert.deepEqual(await imported.export(), exported);
   assert.deepEqual(await setupApp().export(), {
      $schema: publishedSchema.$id, schemaVersion: 2, warnings: [], rcboEnabled: false, rcbos: [], boxes: []
   });
});

test('RCBOs can be added and linked to groups in any box, and linked groups are colored in print', () => {
   const app = setupApp(JSON.stringify(legacy));
   app.setRcboEnabled(true);
   assert.equal(app.nodes.get('rcbo-panel').hidden, false);
   app.addRcbo();
   app.addRcbo();
   app.addRcbo();
   app.addRcbo();
   const state = JSON.parse(app.storage());
   assert.equal(state.rcboEnabled, true);
   assert.deepEqual(state.rcbos.map((r) => [r.number, r.color]), [
      ['A1', '#ed8c01'], ['A2', '#009fe3'], ['A3', '#95be1a'], ['A4', '#9e9e9e']
   ]);
   assert.notEqual(state.rcbos[0].id, state.rcbos[1].id);

   const selects = app.selects();
   assert.equal(selects.length, 2);
   assert.equal(selects[0].children.length, 5);
   selects[1].value = state.rcbos[1].id;
   selects[1].listeners.change();
   const linked = JSON.parse(app.storage());
   assert.deepEqual(linked.boxes[0].groups.map((g) => g.rcboId), [null, state.rcbos[1].id]);
   const cells = app.printCells();
   assert.equal(cells.length, 1);
   assert.equal(cells[0].textContent, '2 · A2');
   assert.match(cells[0].attrs.style, /background-color: #009fe3; color: #000000/);
   const key = app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-rcbo-key');
   assert.equal(key.length, 1);
});

test('RCBO text color picks the higher-contrast option', () => {
   const { context } = setupSchema();
   const rcbo = context.window.GroepenkaartRcbo;
   assert.equal(rcbo.textColor('#003f7d'), '#ffffff');
   assert.equal(rcbo.textColor('#6d4c41'), '#ffffff');
   assert.equal(rcbo.textColor('#fdd835'), '#000000');
   assert.equal(rcbo.textColor('#1e88e5'), '#000000');
   for (const color of ['#ed8c01', '#009fe3', '#95be1a', '#9e9e9e']) assert.equal(rcbo.textColor(color), '#000000');
});

test('default RCBO colors follow the code, with gray for other codes', () => {
   const { context } = setupSchema();
   const rcbo = context.window.GroepenkaartRcbo;
   assert.equal(rcbo.defaultColor('A1'), '#ed8c01');
   assert.equal(rcbo.defaultColor(' a2 '), '#009fe3');
   assert.equal(rcbo.defaultColor('A3'), '#95be1a');
   assert.equal(rcbo.defaultColor('A4'), '#9e9e9e');
   assert.equal(rcbo.defaultColor('B1'), '#9e9e9e');
});

test('deleting an RCBO asks for confirmation and unlinks its groups in all boxes', () => {
   const app = setupApp(JSON.stringify(withRcbos));
   app.confirm(false);
   app.deleteRcbo(0);
   assert.deepEqual(JSON.parse(app.storage()), withRcbos);
   assert.match(app.confirms.at(-1), /A1 – Keuken.*2 gekoppelde groepen worden ontkoppeld/);
   app.confirm(true);
   app.deleteRcbo(0);
   const state = JSON.parse(app.storage());
   assert.deepEqual(state.rcbos.map((r) => r.id), ['r2']);
   assert.deepEqual(state.boxes.flatMap((b) => b.groups.map((g) => g.rcboId)), [null, null, null, 'r2']);
});

test('disabling RCBOs clears all RCBOs and links only after confirmation', () => {
   const app = setupApp(JSON.stringify(withRcbos));
   app.confirm(false);
   app.setRcboEnabled(false);
   assert.equal(app.nodes.get('rcbo-enabled').checked, true);
   assert.deepEqual(JSON.parse(app.storage()), withRcbos);
   app.confirm(true);
   app.setRcboEnabled(false);
   const state = JSON.parse(app.storage());
   assert.equal(state.rcboEnabled, false);
   assert.deepEqual(state.rcbos, []);
   assert.ok(state.boxes.every((b) => b.groups.every((g) => g.rcboId === null)));
   assert.equal(app.selects().length, 0);
   assert.equal(app.printCells().length, 0);

   const empty = setupApp(JSON.stringify(legacy));
   empty.setRcboEnabled(true);
   const count = empty.confirms.length;
   empty.setRcboEnabled(false);
   assert.equal(empty.confirms.length, count, 'no confirmation needed without RCBOs');
   assert.equal(JSON.parse(empty.storage()).rcboEnabled, false);
});

test('failed storage loads cannot be overwritten by edits or cancelled imports', () => {
   for (const stored of [JSON.stringify({ schemaVersion: 3, boxes: [] }), '{broken']) {
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
      assert.deepEqual(JSON.parse(app.storage()), v2);
   }
});

test('clearing data writes the current schema, including after a failed load or with only RCBOs enabled', () => {
   for (const stored of [JSON.stringify(legacy), JSON.stringify({ schemaVersion: 3 }), JSON.stringify(withRcbos)]) {
      const app = setupApp(stored);
      app.nodes.get('clear-all').listeners.click();
      assert.deepEqual(JSON.parse(app.storage()), {
         schemaVersion: 2, warnings: [], rcboEnabled: false, rcbos: [], boxes: []
      });
   }
   const app = setupApp();
   app.setRcboEnabled(true);
   app.nodes.get('clear-all').listeners.click();
   assert.equal(JSON.parse(app.storage()).rcboEnabled, false);
});
