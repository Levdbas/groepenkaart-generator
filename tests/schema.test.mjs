import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sources = await Promise.all(['warnings', 'schema', 'app'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));
const publishedSchema = JSON.parse(await readFile(
   new URL('../public/schemas/groepenkaart-v1.schema.json', import.meta.url), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));
const legacy = {
   warnings: ['pv', 'ev', 'battery', 'heat-pump'],
   boxes: [
      { number: '1', name: '', groups: [
         { number: '1', name: '', description: '' },
         { number: '2', name: '', description: '' }
      ] },
      { number: '2', name: '', groups: [] }
   ]
};

function setupSchema() {
   const window = {};
   const context = vm.createContext({ window });
   sources.slice(0, 2).forEach((source) => vm.runInContext(source, context));
   return { schema: window.GroepenkaartSchema, context };
}

function setupApp(stored = null) {
   const { schema, context } = setupSchema();
   function node() {
      return {
         children: [], listeners: {}, checked: false,
         setAttribute() {},
         addEventListener(event, callback) { this.listeners[event] = callback; },
         appendChild(child) { this.children.push(child); },
         replaceChildren(...children) { this.children = children; },
         click() {}, remove() {}
      };
   }
   const nodes = new Map();
   const messages = [];
   let storage = stored;
   let exported;
   let confirmation = true;
   const document = {
      body: node(),
      createElement: node,
      createElementNS: node,
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
      confirm() { return confirmation; },
      URL: {
         createObjectURL(blob) { exported = blob; return 'blob:test'; },
         revokeObjectURL() {}
      },
      FileReader: class {
         readAsText(file) { this.result = file; this.onload(); }
      }
   });
   Object.assign(context.window, {
      GroepenkaartPdf: { today: () => '2026-10-09' },
      addEventListener() {}
   });
   vm.runInContext(sources[2], context);
   return {
      schema, nodes, messages, storage: () => storage,
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
      }
   };
}

test('unversioned files migrate to v1 without modifying the original data', () => {
   const { schema } = setupSchema();
   const original = structuredClone(legacy);
   assert.deepEqual(plain(schema.normalize(legacy)), { schemaVersion: 1, ...legacy });
   assert.deepEqual(legacy, original);
   assert.deepEqual(plain(schema.normalize({ boxes: [] })), plain(schema.empty()));
});

test('legacy migration preserves numeric fields, missing fields, and old browser IDs', () => {
   const { schema } = setupSchema();
   const data = schema.normalize({
      schemaVersion: 0,
      boxes: [{ id: 'old', number: 2, groups: [{ id: 'old-group', number: 3 }] }, {}]
   });
   assert.deepEqual(plain(data), {
      schemaVersion: 1, warnings: [],
      boxes: [
         { number: '2', name: '', groups: [{ number: '3', name: '', description: '' }] },
         { number: '', name: '', groups: [] }
      ]
   });
});

test('v1 round-trip keeps all data and strips UI-only IDs', () => {
   const { schema } = setupSchema();
   const data = { schemaVersion: 1, ...structuredClone(legacy) };
   data.boxes[0].id = 'box-id';
   data.boxes[0].groups[0].id = 'group-id';
   const normalized = plain(schema.normalize(data));
   assert.deepEqual(normalized, { schemaVersion: 1, ...legacy });
   assert.deepEqual(plain(schema.normalize(normalized)), normalized);
   assert.deepEqual(plain(schema.empty()), { schemaVersion: 1, warnings: [], boxes: [] });
});

test('invalid and newer versions are rejected before interpreting their contents', () => {
   const { schema } = setupSchema();
   for (const version of [null, '1', true, -1, 1.5, {}, []]) {
      assert.throws(() => schema.normalize({ schemaVersion: version, boxes: [] }), /schemaVersion/);
   }
   assert.throws(() => schema.normalize({ schemaVersion: 2 }), /nieuwere schemaversie/);
   assert.throws(() => schema.normalize({ schemaVersion: Number.MAX_SAFE_INTEGER }), /nieuwere schemaversie/);
});

test('v1 validates required arrays, objects, strings, and warning codes', () => {
   const { schema } = setupSchema();
   for (const data of [
      null, [], {}, { boxes: [null] }, { boxes: [{ groups: [null] }] },
      { schemaVersion: 1, boxes: [] },
      { schemaVersion: 1, warnings: [], boxes: {} },
      { schemaVersion: 1, warnings: ['unknown'], boxes: [] },
      { schemaVersion: 1, warnings: [], boxes: [{ number: 1, name: '', groups: [] }] },
      { schemaVersion: 1, warnings: [], boxes: [{ number: '1', name: '', groups: null }] },
      { schemaVersion: 1, warnings: [], boxes: [{ number: '1', name: '', groups: [
         { number: '1', name: '', description: null }
      ] }] }
   ]) {
      assert.throws(() => schema.normalize(data), /Ongeldig/);
   }
});

test('published schema matches the current version, required fields, and warning codes', () => {
   const { schema, context } = setupSchema();
   assert.equal(publishedSchema.properties.schemaVersion.const, schema.currentVersion);
   assert.deepEqual(publishedSchema.required, Object.keys(plain(schema.empty())));
   assert.deepEqual(publishedSchema.properties.warnings.items.enum,
      Array.from(context.window.GroepenkaartWarnings.definitions, (warning) => warning.id));
   for (const name of ['box', 'group']) {
      const definition = publishedSchema.$defs[name];
      assert.deepEqual(definition.required, Object.keys(definition.properties));
      for (const field of ['number', 'name', ...(name === 'group' ? ['description'] : [])]) {
         assert.equal(definition.properties[field].type, 'string');
      }
   }
});

test('browser storage migrates on load and exports the same portable versioned data', async () => {
   const app = setupApp(JSON.stringify(legacy));
   const expected = { schemaVersion: 1, ...legacy };
   assert.deepEqual(JSON.parse(app.storage()), expected);
   assert.deepEqual(await app.export(), expected);
   assert.equal(app.nodes.get('boxes').children.length, 2);
   assert.deepEqual(app.messages, []);
});

test('imports migrate legacy files and rejected imports leave current data untouched', async () => {
   const app = setupApp();
   app.import(legacy);
   const stored = app.storage();
   app.import({ schemaVersion: 2, boxes: [] });
   assert.equal(app.storage(), stored);
   assert.deepEqual(await app.export(), { schemaVersion: 1, ...legacy });
   assert.match(app.messages[0], /Importeren mislukt.*nieuwere schemaversie/);
   app.confirm(false);
   app.import({ boxes: [] });
   assert.equal(app.storage(), stored);
});

test('failed storage loads cannot be overwritten by edits or cancelled imports', () => {
   for (const stored of [JSON.stringify({ schemaVersion: 2, boxes: [] }), '{broken']) {
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
      assert.deepEqual(JSON.parse(app.storage()), { schemaVersion: 1, ...legacy });
   }
});

test('clearing data writes the current schema, including after a failed load', () => {
   for (const stored of [JSON.stringify(legacy), JSON.stringify({ schemaVersion: 2 })]) {
      const app = setupApp(stored);
      app.nodes.get('clear-all').listeners.click();
      assert.deepEqual(JSON.parse(app.storage()), { schemaVersion: 1, warnings: [], boxes: [] });
   }
});
