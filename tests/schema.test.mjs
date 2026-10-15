import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

const sources = await Promise.all(['warnings', 'rcd', 'schema', 'share', 'app'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));
const readSchema = async (version) => JSON.parse(await readFile(
   new URL(`../schemas/groepenkaart-v${version}.schema.json`, import.meta.url), 'utf8'));
const publishedSchema = await readSchema(5);
const publishedV4Schema = await readSchema(4);
const publishedV3Schema = await readSchema(3);
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
// Same cards without warnings, for tests that count module rows.
const noWarnings = { ...legacy, warnings: [] };
// The shape published as schema version 2, before phase support.
const v2 = {
   schemaVersion: 2,
   warnings: legacy.warnings,
   rcboEnabled: false,
   rcbos: [],
   boxes: legacy.boxes.map((box) => ({ ...box, groups: box.groups.map((g) => ({ ...g, rcboId: null })) }))
};
// The shape published as schema version 3, before the QR code option.
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
const v4 = { ...v3, schemaVersion: 4, qrEnabled: false };
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
   schemaVersion: 4,
   warnings: [],
   qrEnabled: false,
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

function expectedV5(data) {
   const modules = [];
   const boxes = data.boxes.map((box, boxIndex) => {
      const id = `legacy-box-${boxIndex + 1}`;
      const moduleIds = box.groups.map((group, moduleIndex) => {
         const moduleId = `legacy-module-${boxIndex + 1}-${moduleIndex + 1}`;
         modules.push({
            id: moduleId, boxId: id, type: 'MCB', number: group.number, description: group.description,
            characteristic: '', phases: group.phases || [], protectedByModuleId: group.rcdId || null,
            ...(group.items ? { items: group.items } : {})
         });
         return moduleId;
      });
      return { id, number: box.number, name: box.name, moduleIds, supply: null };
   });
   const labels = { pv: 'PV-installatie (zonnepanelen)', ev: 'EV-lader', battery: 'Thuisbatterij (EOS)' };
   for (const code of ['pv', 'ev', 'battery']) {
      if (!boxes.length || !(data.warnings || []).includes(code)) continue;
      modules.push({
         id: `legacy-warning-${code}`, boxId: boxes[0].id, type: 'MCB', number: '', description: labels[code],
         characteristic: '', phases: [], protectedByModuleId: null, warning: code
      });
      boxes[0].moduleIds.push(`legacy-warning-${code}`);
   }
   (data.rcds || []).forEach((rcd) => modules.push({
      id: rcd.id, boxId: null, type: rcd.amountOfPoles === 4 ? 'RCD-4P' : 'RCD-2P',
      number: rcd.number, name: rcd.name, color: rcd.color, description: '', characteristic: '',
      phases: rcd.phases, protectedByModuleId: null
   }));
   return {
      schemaVersion: 5, qrEnabled: data.qrEnabled,
      rcdEnabled: data.rcdEnabled, phaseEnabled: data.phaseEnabled, modules, boxes
   };
}

function editorState(data) {
   const modules = new Map(data.modules.map((module) => [module.id, module]));
   const protective = data.modules.filter((module) => ['RCD-2P', 'RCD-4P', 'RCBO-2P', 'RCBO-4P'].includes(module.type));
   return {
      schemaVersion: 5,
      qrEnabled: data.qrEnabled,
      rcdEnabled: data.rcdEnabled,
      phaseEnabled: data.phaseEnabled,
      rcds: protective.map((module) => ({
         id: module.id, number: module.number, name: module.name || '', color: module.color,
         amountOfPoles: module.type.endsWith('4P') ? 4 : 2, phases: module.phases
      })),
      boxes: data.boxes.map((box) => ({
         number: box.number,
         name: box.name,
         groups: box.moduleIds.map((id) => {
            const module = modules.get(id);
            return {
               number: module.number,
               description: module.description,
               rcdId: module.protectedByModuleId,
               phases: module.phases,
               ...(module.items ? { items: module.items } : {})
            };
         })
      }))
   };
}

function appState(app) {
   return editorState(JSON.parse(app.storage()));
}

function semanticV5(data) {
   const moduleIndex = new Map(data.modules.map((module, index) => [module.id, index]));
   const boxIndex = new Map(data.boxes.map((box, index) => [box.id, index]));
   return {
      ...data,
      modules: data.modules.map((module) => ({
         ...module,
         id: moduleIndex.get(module.id),
         boxId: module.boxId === null ? null : boxIndex.get(module.boxId),
         protectedByModuleId: module.protectedByModuleId === null ? null : moduleIndex.get(module.protectedByModuleId)
      })),
      boxes: data.boxes.map((box) => ({
         ...box,
         id: boxIndex.get(box.id),
         moduleIds: box.moduleIds.map((id) => moduleIndex.get(id)),
         supply: box.supply && box.supply.type === 'subdistribution' && box.supply.sourceModuleId
            ? { ...box.supply, sourceModuleId: moduleIndex.get(box.supply.sourceModuleId) }
            : box.supply
      }))
   };
}

function setupSchema() {
   const window = {};
   const context = vm.createContext({ window });
   sources.slice(0, 3).forEach((source) => vm.runInContext(source, context));
   return { schema: window.GroepenkaartSchema, moduleTypes: window.GroepenkaartSchema.moduleTypes, context };
}

test('module type catalog preserves the declared slugs, widths, phases and conditions', () => {
   const { moduleTypes } = setupSchema();
   assert.deepEqual(Array.from(moduleTypes.definitions, (type) => type.slug), [
      'MCB', 'MCB-2P', 'MCB-3P', 'RCD-2P', 'RCD-4P', 'MAINS-2P', 'MAINS-4P',
      'RCBO-2P', 'RCBO-4P', 'DIN-OUTLET', 'Bell-TRANSFORMER', 'KWH-2P', 'KWH-4P', 'SPD'
   ]);
   assert.deepEqual(Array.from(moduleTypes.definitions, (type) => [type.slug, type.phases, type.width]), [
      ['MCB', 1, 1], ['MCB-2P', 3, 4], ['MCB-3P', 2, 2], ['RCD-2P', null, 2],
      ['RCD-4P', null, 4], ['MAINS-2P', 1, 2], ['MAINS-4P', 3, 4], ['RCBO-2P', 2, 1],
      ['RCBO-4P', 3, 4], ['DIN-OUTLET', 1, 3], ['Bell-TRANSFORMER', 1, 2],
      ['KWH-2P', 1, 1], ['KWH-4P', 3, 4], ['SPD', 1, 1]
   ]);
   assert.equal(moduleTypes.available('MCB-2P', false), false);
   assert.equal(moduleTypes.available('MCB-2P', true), true);
   assert.equal(moduleTypes.available('MAINS-2P', false), true);
   assert.equal(moduleTypes.available('MAINS-2P', true), false);
   assert.equal(moduleTypes.available('unknown', true), false);
   assert.equal(moduleTypes.allPhases('MCB-2P'), true);
   assert.equal(moduleTypes.allPhases('RCD-4P'), true);
   assert.equal(moduleTypes.allPhases('MCB'), false);
   assert.equal(moduleTypes.allPhases('MCB-3P'), false);
   assert.deepEqual(Array.from(moduleTypes.get('MCB').warnings), ['ev', 'pv', 'battery']);
});

test('v4 migration creates stable typed modules and preserves RCD references', () => {
   const { schema } = setupSchema();
   const migrated = schema.normalize(withRcds);
   assert.equal(migrated.schemaVersion, 5);
   assert.deepEqual(Array.from(migrated.boxes, (box) => box.moduleIds), [
      ['legacy-module-1-1', 'legacy-module-1-2'],
      ['legacy-module-2-1', 'legacy-module-2-2']
   ]);
   assert.deepEqual(Array.from(migrated.modules, (module) => [module.id, module.type, module.boxId, module.protectedByModuleId]), [
      ['legacy-module-1-1', 'MCB', migrated.boxes[0].id, 'r1'],
      ['legacy-module-1-2', 'MCB', migrated.boxes[0].id, null],
      ['legacy-module-2-1', 'MCB', migrated.boxes[1].id, 'r1'],
      ['legacy-module-2-2', 'MCB', migrated.boxes[1].id, 'r2'],
      ['r1', 'RCD-2P', null, null],
      ['r2', 'RCD-2P', null, null]
   ]);
   assert.equal(migrated.modules[4].color, '#e53935');
   assert.deepEqual(plain(schema.normalize(migrated)), plain(migrated));
   assert.deepEqual(
      Array.from(schema.normalize(withRcds).modules, (module) => module.id),
      Array.from(migrated.modules, (module) => module.id)
   );
});

test('c2 compact links round-trip modules, protection references and supply fields', () => {
   const { schema, context } = setupSchema();
   context.window.fflate = require('fflate');
   vm.runInContext(sources[3], context);
   const share = context.window.GroepenkaartShare;
   const data = schema.normalize(withRcds);
   data.modules[4].sensitivity = 30;
   data.modules[4].rcdType = 'A';
   data.modules[4].ratedCurrent = 40;
   data.modules[0].warning = 'ev';
   data.boxes[0].supply = {
      type: 'mains', connectionRating: 'Anders', customConnectionRating: '3x45A', supplier: 'Stedin',
      mainSwitchCurrent: 40, mainSwitchPoles: 4
   };
   data.boxes[1].supply = {
      type: 'subdistribution', sourceModuleId: 'legacy-module-1-1', preFuse: 'C32', cableCores: 5,
      cableCrossSection: 6, mainSwitchCurrent: 40, mainSwitchPoles: 4
   };
   const link = share.url('https://example.test/app/', data);
   assert.ok(link.includes('#c2='));
   assert.throws(() => share.encode({ ...data, schemaVersion: 6 }), /schemaversie 6/);
   const decoded = schema.normalize(share.decode(link.slice(link.indexOf('#'))));
   assert.equal(decoded.modules[4].type, 'RCD-2P');
   assert.equal(decoded.modules[4].sensitivity, 30);
   assert.equal(decoded.modules[4].rcdType, 'A');
   assert.equal(decoded.modules[4].ratedCurrent, 40);
   assert.equal(decoded.modules[0].warning, 'ev');
   assert.equal(decoded.modules[0].protectedByModuleId, decoded.modules[4].id);
   assert.deepEqual(Array.from(decoded.boxes[0].moduleIds), ['m1', 'm2']);
   assert.deepEqual(plain(decoded.boxes[1].supply), {
      type: 'subdistribution', sourceModuleId: 'm1', preFuse: 'C32', cableCores: 5,
      cableCrossSection: 6, mainSwitchCurrent: 40, mainSwitchPoles: 4
   });
   assert.deepEqual(plain(decoded.boxes[0].supply), {
      type: 'mains', connectionRating: 'Anders', customConnectionRating: '3x45A', supplier: 'Stedin',
      mainSwitchCurrent: 40, mainSwitchPoles: 4
   });
});

function setupApp(stored = null, hash = '', confirmAnswer = true, fillRows = null, rcdFirst = null) {
   const { schema, context } = setupSchema();
   assert.equal(schema.schemaUrl, publishedSchema.$id);
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
   let fillRowsStorage = fillRows;
   let rcdFirstStorage = rcdFirst;
   let exported;
   let confirmation = confirmAnswer;
   const pdfCalls = [];
   const replaced = [];
   const windowListeners = {};
   const timers = [];
   const location = { href: 'https://example.test/app/?x=1' + hash, pathname: '/app/', search: '?x=1', hash };
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
         getItem(key) {
            if (key === 'groepenkaart:fill-rows') return fillRowsStorage;
            if (key === 'groepenkaart:rcd-first') return rcdFirstStorage;
            assert.equal(key, 'groepenkaart:v1');
            return storage;
         },
         setItem(key, value) {
            if (key === 'groepenkaart:fill-rows') { fillRowsStorage = value; return; }
            if (key === 'groepenkaart:rcd-first') { rcdFirstStorage = value; return; }
            assert.equal(key, 'groepenkaart:v1');
            storage = value;
         }
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
      GroepenkaartPdf: {
         today: () => '2026-10-09',
         download(...args) { pdfCalls.push(args.map((arg) => arg && arg.getModuleCount ? 'qr' : plain(arg))); return true; }
      },
      fflate: require('fflate'),
      qrcode: require('qrcode-generator'),
      btoa, atob,
      location: location,
      history: { replaceState(state, title, url) { location.hash = ''; replaced.push(url); } },
      addEventListener(event, callback) { windowListeners[event] = callback; },
      setTimeout(callback) { timers.push(callback); return timers.length; },
      clearTimeout() { timers.length = 0; }
   });
   vm.runInContext(sources[3], context);
   vm.runInContext(sources[4], context);
   const findAll = (root, predicate, found = []) => {
      if (predicate(root)) found.push(root);
      root.children.forEach((child) => findAll(child, predicate, found));
      return found;
   };
   return {
      schema, shareContext: context.window, nodes, messages, confirms, findAll, pdfCalls, replaced, location, windowListeners, timers, storage: () => storage,
      confirm(value) { confirmation = value; },
      import(data) {
         nodes.get('import-json').listeners.change({ target: { files: [JSON.stringify(data)] } });
      },
      async export() {
         nodes.get('export-json').listeners.click();
         return JSON.parse(await exported.text());
      },
      setRcdEnabled(value) {
         const checkbox = nodes.get('rcd-enabled');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      setQrEnabled(value) {
         const checkbox = nodes.get('qr-enabled');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      setRcdFirst(value) {
         const checkbox = nodes.get('rcd-first');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      setPhaseEnabled(value) {
         const checkbox = nodes.get('phase-enabled');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      addRcd() { nodes.get('add-rcd').listeners.click(); },
      selects() { return findAll(nodes.get('boxes'), (n) => n.tag === 'select' && n.attrs['aria-label'] && n.attrs['aria-label'].startsWith('Aardlekschakelaar voor module ')); },
      printCells() { return findAll(nodes.get('print-area'), (n) => n.tag === 'td' && n.className === 'rcd-cell'); },
      deleteRcd(index) {
         const item = nodes.get('rcd-list').children[index];
         findAll(item, (n) => n.attrs.title === 'Aardlekschakelaar verwijderen')[0].listeners.click();
      }
   };
}

test('unversioned files migrate through v1 and v2 to v5 without modifying the original data', () => {
   const { schema } = setupSchema();
   const original = structuredClone(legacy);
   assert.deepEqual(plain(schema.normalize(legacy)), expectedV5(v4));
   assert.deepEqual(legacy, original);
   assert.deepEqual(plain(schema.normalize({ boxes: [] })), plain(schema.empty()));
});

test('v1 files migrate to v5 with RCDs and phases disabled and no protection links', () => {
   const { schema } = setupSchema();
   const original = structuredClone(v1);
   assert.deepEqual(plain(schema.normalize(v1)), expectedV5(v4));
   assert.deepEqual(v1, original);
});

test('v2 files migrate to v5 with default phase settings and keep all existing data', () => {
   const { schema } = setupSchema();
   for (const [source, expected] of [[v2, v4], [withRcdsV2, withRcds]]) {
      const original = structuredClone(source);
      assert.deepEqual(plain(schema.normalize(source)), expectedV5(expected));
      assert.deepEqual(source, original);
   }
   const withItems = structuredClone(withRcdsV2);
   withItems.warnings = ['pv'];
   withItems.boxes[0].groups[0].items = ['Vaatwasser'];
   const migrated = plain(schema.normalize(withItems));
   assert.deepEqual(plain(migrated.modules.filter((module) => module.warning).map((module) => [module.id, module.warning, module.boxId])),
      [['legacy-warning-pv', 'pv', migrated.boxes[0].id]]);
   assert.deepEqual(migrated.modules[0].items, ['Vaatwasser']);
   assert.deepEqual(migrated.modules.filter((module) => module.type.startsWith('RCD')).map((module) => module.id), ['r1', 'r2']);
   assert.deepEqual(migrated.modules.filter((module) => module.type === 'MCB' && !module.warning).map((module) => module.protectedByModuleId), ['r1', null, 'r1', 'r2']);
});

test('v2 to v3 renames the RCBO fields to RCD fields', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcdsV2);
   data.boxes[0].groups[0].items = ['Vaatwasser', 'Oven'];
   const original = structuredClone(data);
   const migrated = plain(schema.normalize(data));
   assert.deepEqual(data, original);
   assert.equal(migrated.schemaVersion, 5);
   assert.equal(migrated.rcdEnabled, true);
   assert.deepEqual(migrated.modules.filter((module) => module.type.startsWith('RCD')).map((rcd) => [rcd.id, rcd.number, rcd.name, rcd.color]), [
      ['r1', 'A1', 'Keuken', '#e53935'], ['r2', '', '', '#fdd835']
   ]);
   assert.deepEqual(migrated.modules.filter((module) => module.type === 'MCB').map((module) => module.protectedByModuleId), ['r1', null, 'r1', 'r2']);
   assert.deepEqual(migrated.modules[0].items, ['Vaatwasser', 'Oven']);
   for (const key of ['rcboEnabled', 'rcbos']) assert.ok(!(key in migrated), `${key} is removed`);
   assert.ok(migrated.modules.every((module) => !('rcboId' in module)));
   assert.ok(!/rcbo/i.test(JSON.stringify(migrated)), 'no RCBO names remain anywhere in the output');
   assert.deepEqual(plain(schema.normalize(migrated)), migrated, 'migrating the result again is a no-op');

   const disabled = structuredClone(v2);
   assert.equal(disabled.rcboEnabled, false);
   assert.deepEqual(disabled.rcbos, []);
   const disabledOriginal = structuredClone(disabled);
   const result = plain(schema.normalize(disabled));
   assert.deepEqual(disabled, disabledOriginal);
   assert.equal(result.rcdEnabled, false);
   assert.equal(result.modules.filter((module) => module.type.startsWith('RCD') || module.type.startsWith('RCBO')).length, 0);
   assert.ok(!/rcbo/i.test(JSON.stringify(result)));
});

test('v2 files with invalid RCBO fields are still rejected after the rename', () => {
   const { schema } = setupSchema();
   const variant = (change) => { const data = structuredClone(withRcdsV2); change(data); return data; };
   for (const [data, message] of [
      [variant((d) => { delete d.rcboEnabled; }), /rcdEnabled/],
      [variant((d) => { d.rcboEnabled = 'true'; }), /rcdEnabled/],
      [variant((d) => { d.rcbos = null; }), /rcds/],
      [variant((d) => { delete d.boxes[0].groups[0].rcboId; }), /protectedByModuleId/],
      [variant((d) => { d.boxes[0].groups[0].rcboId = 1; }), /protectedByModuleId/],
      [variant((d) => { d.boxes[0].groups[0].rcboId = 'missing'; }), /verwijst niet naar een RCD/],
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
   assert.equal(migrated.schemaVersion, 5);
   assert.equal(migrated.phaseEnabled, true);
   assert.deepEqual(migrated.modules.filter((module) => module.type.startsWith('RCD')).map((rcd) => [rcd.type, rcd.phases]), [['RCD-2P', ['L2']], ['RCD-4P', ['L1', 'L2', 'L3']]]);
   assert.deepEqual(migrated.modules.filter((module) => module.type === 'MCB').map((module) => module.phases), [[], [], [], ['L1', 'L3']]);
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
   assert.deepEqual(migrated.modules.filter((module) => module.type === 'MCB').map((g) => g.description),
      ['Keuken – Wandcontactdozen', 'Keuken', 'Wandcontactdozen', '', 'Verlichting', 'Hal', 'Garage – Lichten']);
   assert.ok(migrated.modules.filter((module) => module.type === 'MCB').every((g) => !('name' in g)));
   assert.deepEqual(migrated.modules.filter((module) => module.type === 'MCB')[6].items, ['Lamp']);
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
   assert.deepEqual(plain(data.modules.filter((module) => module.type === 'MCB').map((g) => g.description)), ['Keuken – 7', 'Hal']);
   assert.deepEqual(plain(schema.normalize({
      schemaVersion: 1, warnings: [], boxes: [
         { number: '1', name: '', groups: [{ number: '1', name: 'Garage', description: 'Lichten' }] }
      ]
   })).modules[0].description, 'Garage – Lichten');
});

test('v3 groups have no name: a leftover name is ignored and the description is required', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcds);
   data.boxes[0].groups[0].name = 'Oud';
   const normalized = plain(schema.normalize(data));
   assert.deepEqual(normalized, expectedV5(withRcds));
   assert.ok(!('name' in normalized.modules[0]));
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
   assert.deepEqual(plain(data), expectedV5({
      schemaVersion: 4, warnings: [], qrEnabled: false, rcdEnabled: false, phaseEnabled: false, rcds: [],
      boxes: [
         { number: '2', name: '', groups: [{ number: '3', description: '', rcdId: null, phases: [] }] },
         { number: '', name: '', groups: [] }
      ]
   }));
});

test('v3 round-trip keeps all data, RCD IDs, and strips UI-only IDs', () => {
   const { schema } = setupSchema();
   const data = structuredClone(withRcds);
   data.boxes[0].id = 'box-id';
   data.boxes[0].groups[0].id = 'group-id';
   data.rcds[0].color = '#E53935';
   const normalized = plain(schema.normalize(data));
   assert.deepEqual(normalized, expectedV5(withRcds));
   assert.deepEqual(plain(schema.normalize(normalized)), normalized);
   assert.deepEqual(plain(schema.empty()), { schemaVersion: 5, qrEnabled: false, rcdEnabled: false, phaseEnabled: false, modules: [], boxes: [] });
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
   assert.throws(() => schema.normalize(old), /rcds/);
});

test('v3 requires phaseEnabled to be a boolean and preserves explicit booleans', () => {
   const { schema } = setupSchema();
   for (const phaseEnabled of [false, true]) {
      const expected = expectedV5({ ...withRcds, phaseEnabled });
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
   assert.throws(() => schema.normalize({ schemaVersion: 6 }), /nieuwere schemaversie/);
   assert.throws(() => schema.normalize({ schemaVersion: Number.MAX_SAFE_INTEGER }), /nieuwere schemaversie/);
});

test('v5 validates module types, protection references, box order and phase cardinality', () => {
   const { schema } = setupSchema();
   const data = schema.normalize(withRcds);
   const variant = (change) => { const copy = structuredClone(data); change(copy); return copy; };
   assert.deepEqual(plain(schema.normalize(data)), plain(data));
   for (const [invalid, message] of [
      [variant((d) => { d.modules[0].type = 'unknown'; }), /onbekend moduletype/],
      [variant((d) => { d.modules[0].protectedByModuleId = 'missing'; }), /verwijst niet naar een RCD/],
      [variant((d) => { d.modules[0].protectedByModuleId = d.modules[0].id; }), /niet naar zichzelf/],
      [variant((d) => { d.modules[4].phases = ['L1', 'L2']; }), /2-polige/],
      [variant((d) => { d.modules[4].type = 'RCD-4P'; d.modules[4].phases = ['L1', 'L2']; }), /4-polige/],
      [variant((d) => { d.modules[4].phases = ['L1', 'L1']; }), /unieke fasen/],
      [variant((d) => { d.boxes[0].moduleIds[0] = d.boxes[1].moduleIds[0]; }), /hoort niet bij deze kast/],
      [variant((d) => { d.boxes[0].moduleIds.push(d.boxes[0].moduleIds[0]); }), /dubbele moduleverwijzing/],
      [variant((d) => { d.modules[0].boxId = 'missing'; }), /onbekende kast/],
      [variant((d) => { d.modules[0].sensitivity = 20; }), /sensitivity/],
      [variant((d) => { d.modules[0].rcdType = 'C'; }), /aardlektype/],
      [variant((d) => { d.boxes[0].supply = { type: 'subdistribution', sourceModuleId: 'missing' }; }), /onbekende module/]
   ]) assert.throws(() => schema.normalize(invalid), message);

   const cyclic = variant((d) => {
      const sourceOne = d.modules.find((module) => module.boxId === d.boxes[0].id);
      const sourceTwo = d.modules.find((module) => module.boxId === d.boxes[1].id);
      d.boxes[0].supply = { type: 'subdistribution', sourceModuleId: sourceTwo.id };
      d.boxes[1].supply = { type: 'subdistribution', sourceModuleId: sourceOne.id };
   });
   assert.throws(() => schema.normalize(cyclic), /kringverwijzing/);
   assert.throws(() => schema.normalize(variant((d) => { d.rcdEnabled = false; })), /beveiligingsmodules bestaan/);
});

test('optional group items preserve arrays across schema versions without changing the version', () => {
   const { schema } = setupSchema();
   for (const source of [legacy, v1, v2, v3, v4, withRcdsV2, withRcds]) {
      const data = structuredClone(source);
      data.boxes[0].groups[0].items = ['Vaatwasser', 'Stopcontacten'];
      data.boxes[0].groups[1].items = [];
      const original = structuredClone(data);
      const normalized = plain(schema.normalize(data));
      assert.equal(normalized.schemaVersion, 5);
      assert.deepEqual(normalized.modules[0].items, ['Vaatwasser', 'Stopcontacten']);
      assert.deepEqual(normalized.modules[1].items, []);
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

test('v5 validates module IDs, colors and required protective fields', () => {
   const { schema } = setupSchema();
   const canonical = schema.normalize(withRcds);
   const variant = (change) => { const data = structuredClone(canonical); change(data); return data; };
   for (const data of [
      variant((d) => { delete d.rcdEnabled; }),
      variant((d) => { delete d.phaseEnabled; }),
      variant((d) => { d.rcdEnabled = 'true'; }),
      variant((d) => { d.modules = null; }),
      variant((d) => { d.rcdEnabled = false; }),
      variant((d) => { d.modules[4].color = 'red'; }),
      variant((d) => { d.modules[4].color = '#fff'; }),
      variant((d) => { d.modules[0].id = ''; }),
      variant((d) => { d.modules[1].id = d.modules[0].id; }),
      variant((d) => { d.modules[4].name = null; }),
      variant((d) => { d.modules[4] = null; }),
      variant((d) => { d.modules[0].protectedByModuleId = 'missing'; }),
      variant((d) => { d.modules[0].protectedByModuleId = 1; }),
      variant((d) => { delete d.modules[0].protectedByModuleId; })
   ]) {
      assert.throws(() => schema.normalize(data), /Ongeldig/);
   }
   assert.throws(() => schema.normalize(variant((d) => { delete d.rcdEnabled; })), /rcdEnabled/);
   assert.throws(() => schema.normalize(variant((d) => { d.rcdEnabled = 'true'; })), /"rcdEnabled" moet waar of onwaar zijn/);
   assert.throws(() => schema.normalize(variant((d) => { d.modules = null; })), /"modules" moet een lijst zijn/);
   assert.throws(() => schema.normalize(variant((d) => { d.modules[0].protectedByModuleId = 1; })),
      /"protectedByModuleId" moet tekst of null zijn/);
   assert.throws(() => schema.normalize(variant((d) => { d.modules[0].protectedByModuleId = 'missing'; })),
      /verwijst niet naar een RCD/);
});

test('published schemas match the current version, required fields, and warning codes', () => {
   const { schema, context } = setupSchema();
   assert.equal(publishedSchema.properties.schemaVersion.const, schema.currentVersion);
   assert.deepEqual(publishedSchema.required, Object.keys(plain(schema.empty())));
   assert.deepEqual(publishedSchema.$defs.module.properties.warning.enum, ['pv', 'ev', 'battery']);
   assert.ok(!('warnings' in publishedSchema.properties));
   assert.deepEqual(publishedV2Schema.properties.warnings.items.enum,
      Array.from(context.window.GroepenkaartWarnings.codes));
   assert.deepEqual(publishedV1Schema.properties.warnings.items.enum,
      Array.from(context.window.GroepenkaartWarnings.codes));
   assert.equal(publishedSchema.properties.rcdEnabled.type, 'boolean');
   assert.equal(publishedSchema.properties.phaseEnabled.type, 'boolean');
   assert.ok(publishedSchema.required.includes('phaseEnabled'));
   assert.deepEqual(publishedSchema.required, ['schemaVersion', 'qrEnabled', 'rcdEnabled', 'phaseEnabled', 'modules', 'boxes']);
   assert.equal(publishedSchema.properties.qrEnabled.type, 'boolean');
   assert.deepEqual(publishedSchema.$defs.phases.items.enum, ['L1', 'L2', 'L3']);
   assert.equal(publishedSchema.$defs.phases.uniqueItems, true);
   assert.equal(publishedSchema.$defs.phases.maxItems, 3);
   assert.ok(publishedSchema.$defs.module.required.includes('id'));
   assert.ok(publishedSchema.$defs.module.required.includes('boxId'));
   assert.ok(publishedSchema.$defs.module.required.includes('type'));
   assert.ok(publishedSchema.$defs.module.required.includes('protectedByModuleId'));
   assert.deepEqual(publishedSchema.$defs.module.properties.protectedByModuleId.type, ['string', 'null']);
   assert.deepEqual(publishedSchema.$defs.module.properties.sensitivity.enum, [10, 30, 100, 300]);
   assert.deepEqual(publishedSchema.$defs.module.properties.rcdType.enum, ['AC', 'A', 'F', 'B', 'B+']);
   assert.deepEqual(publishedSchema.$defs.box.properties.supply.oneOf.map((schema) => schema.type || schema.$ref),
      ['null', '#/$defs/mainsSupply', '#/$defs/subdistributionSupply']);
   assert.equal(publishedSchema.$defs.box.properties.moduleIds.uniqueItems, true);
   const strings = { box: ['id', 'number', 'name'], module: ['id', 'number', 'description', 'characteristic'] };
   for (const [name, fields] of Object.entries(strings)) {
      const definition = publishedSchema.$defs[name];
      assert.ok(fields.every((field) => definition.required.includes(field)));
      for (const field of fields) assert.equal(definition.properties[field].type, 'string');
   }
   assert.ok(publishedSchema.$defs.module.properties.type.enum.includes('MCB'));
   assert.equal(publishedSchema.$defs.module.properties.items.type, 'array');
   assert.equal(publishedSchema.$defs.module.properties.items.items.type, 'string');
   assert.ok(!publishedSchema.$defs.module.required.includes('items'));
   assert.equal(publishedSchema.title, 'JSON schema for groepenkaart v5');
   assert.equal(publishedV4Schema.properties.schemaVersion.const, 4);
   assert.equal(publishedV4Schema.title, 'JSON schema for groepenkaart v4');
   assert.equal(publishedV1Schema.properties.schemaVersion.const, 1);
   assert.equal(publishedV1Schema.$id, schema.schemaUrl.replace('-v5.', '-v1.'));
});

test('the published v2 schema stays unchanged and does not describe phase fields', () => {
   const { schema } = setupSchema();
   assert.equal(publishedV2Schema.$id, schema.schemaUrl.replace('-v5.', '-v2.'));
   assert.equal(publishedV2Schema.title, 'JSON schema for groepenkaart v2');
   assert.equal(publishedV2Schema.properties.schemaVersion.const, 2);
   assert.deepEqual(publishedV2Schema.required, ['schemaVersion', 'warnings', 'rcboEnabled', 'rcbos', 'boxes']);
   assert.ok(!('phaseEnabled' in publishedV2Schema.properties));
   assert.ok(!('phases' in publishedV2Schema.$defs));
   assert.deepEqual(Object.keys(publishedV2Schema.$defs.rcbo.properties), ['id', 'number', 'name', 'color']);
   assert.deepEqual(Object.keys(publishedV2Schema.$defs.group.properties), ['number', 'name', 'description', 'items', 'rcboId']);
   assert.ok(publishedV2Schema.$defs.group.required.includes('name'));
});

test('the published v3 schema stays unchanged and does not describe the QR code option', () => {
   const { schema } = setupSchema();
   assert.equal(publishedV3Schema.$id, schema.schemaUrl.replace('-v5.', '-v3.'));
   assert.equal(publishedV3Schema.properties.schemaVersion.const, 3);
   assert.deepEqual(publishedV3Schema.required, ['schemaVersion', 'warnings', 'rcdEnabled', 'phaseEnabled', 'rcds', 'boxes']);
   assert.ok(!('qrEnabled' in publishedV3Schema.properties));
});

test('browser storage migrates on load and exports the same portable versioned data', async () => {
   const app = setupApp(JSON.stringify(legacy));
   assert.deepEqual(JSON.parse(app.storage()), expectedV5(v4));
   assert.deepEqual(await app.export(), { $schema: app.schema.schemaUrl, ...expectedV5(v4) });
   assert.equal(app.nodes.get('boxes').children.length, 2);
   assert.equal(app.nodes.get('rcd-panel').hidden, true);
   assert.equal(app.selects().length, 0);
   assert.deepEqual(app.messages, []);
});

test('imports migrate legacy files and rejected imports leave current data untouched', async () => {
   const app = setupApp();
   app.import(legacy);
   const stored = app.storage();
   app.import({ schemaVersion: 6, boxes: [] });
   assert.equal(app.storage(), stored);
   assert.deepEqual(await app.export(), { $schema: app.schema.schemaUrl, ...expectedV5(v4) });
   assert.match(app.messages[0], /Importeren mislukt.*nieuwere schemaversie/);
   app.import({ ...structuredClone(withRcds), rcds: [] });
   assert.equal(app.storage(), stored);
   assert.match(app.messages[1], /Importeren mislukt.*verwijst niet naar een RCD/);
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
   assert.deepEqual(JSON.parse(imported.storage()), expectedV5(withRcds));
   assert.deepEqual(await imported.export(), exported);
   assert.deepEqual(await setupApp().export(), { $schema: publishedSchema.$id, ...plain(setupApp().schema.empty()) });
});

test('phase toggle persists, reloads, round-trips and leaves group data unchanged', async () => {
   const app = setupApp(JSON.stringify(withRcdsV2));
   assert.deepEqual(JSON.parse(app.storage()), expectedV5(withRcds));
   assert.equal(app.nodes.get('phase-enabled').checked, false);
   assert.equal(JSON.parse(app.storage()).phaseEnabled, false);
   assert.equal(app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-phases').length, 0);
   app.setPhaseEnabled(true);
   const expected = expectedV5({ ...withRcds, phaseEnabled: true });
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
   assert.deepEqual(JSON.parse(imported.storage()), expectedV5(withRcds));
   imported.import({ ...exported, phaseEnabled: 'true' });
   assert.deepEqual(JSON.parse(imported.storage()), expectedV5(withRcds));
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
      ['Module', 'Omschrijving', 'Aardlekschakelaar']);
   const row = () => app.findAll(boxes(), (n) => n.tag === 'tr' && n.children[0].className === 'group-number')[0];
   assert.deepEqual(row().children.map((cell) => cell.className),
      ['group-number', 'group-description', 'group-rcd', 'group-actions']);
   const description = app.findAll(row().children[1], (n) => n.attrs['aria-label'] === 'Omschrijving')[0];
   assert.equal(description.value, 'Keuken');
   assert.equal(app.findAll(row().children[1], (n) => n.tag === 'textarea').length, 1);
   description.value = 'Keuken en bijkeuken';
   description.listeners.input();
   const stored = appState(app);
   assert.equal(stored.boxes[0].groups[0].description, 'Keuken en bijkeuken');
   assert.ok(stored.boxes.every((box) => box.groups.every((group) => !('name' in group))));
   const firstPage = app.findAll(app.nodes.get('print-area'), (n) => n.tag === 'article')[0];
   assert.deepEqual(app.findAll(firstPage, (n) => n.tag === 'th').map((n) => n.textContent), ['Module', 'Omschrijving']);
   const printRow = app.findAll(firstPage, (n) => n.tag === 'tr' && n.children[0].tag === 'td')[0];
   assert.equal(printRow.children.length, 2);
   assert.equal(printRow.children[1].children[0].textContent, 'Keuken en bijkeuken');
   app.nodes.get('add-box').listeners.click();
   const added = appState(app).boxes.at(-1).groups[0];
   assert.deepEqual(Object.keys(added).sort(), ['description', 'number', 'phases', 'rcdId']);
   app.findAll(boxes(), (n) => n.className === 'btn btn-primary btn-add-group')[0].listeners.click();
   assert.deepEqual(Object.keys(appState(app).boxes[0].groups.at(-1)).sort(), ['description', 'number', 'phases', 'rcdId']);

   app.setPhaseEnabled(true);
   assert.deepEqual(row().children.map((cell) => cell.className),
      ['group-number', 'group-description', 'group-items', 'group-rcd', 'group-phases', 'group-actions']);
   assert.equal(app.findAll(row().children[1], (n) => n.tag === 'textarea').length, 0);
   assert.equal(app.findAll(row().children[2], (n) => n.tag === 'textarea').length, 1);
   assert.equal(app.findAll(row().children[1], (n) => n.attrs['aria-label'] === 'Omschrijving')[0].value, 'Keuken en bijkeuken');
   app.setPhaseEnabled(false);
   assert.equal(row().children.length, 4);
});

test('module type controls derive width, preserve characteristics and create protective modules', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   const typeControls = () => app.findAll(app.nodes.get('boxes'), (node) => node.className === 'module-type-select');
   assert.equal(typeControls().length, 2);
   assert.ok(!typeControls()[0].children.some((option) => option.value === 'MCB-2P'));
   app.setPhaseEnabled(true);
   let select = typeControls()[0];
   assert.ok(select.children.some((option) => option.value === 'MCB-2P'));
   select.value = 'MCB-2P';
   select.listeners.change();
   let module = JSON.parse(app.storage()).modules[0];
   assert.equal(module.type, 'MCB-2P');
   assert.ok(!('width' in module));
   assert.equal(app.shareContext.GroepenkaartSchema.moduleTypes.get(module.type).width, 4);

   const characteristic = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Kenmerk voor module 1')[0];
   characteristic.value = 'C32';
   characteristic.listeners.input();
   let persisted = JSON.parse(app.storage()).modules[0];
   assert.equal(persisted.characteristic, 'C32');
   const protectionType = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Aardlektype voor module 1')[0];
   protectionType.value = 'A';
   protectionType.listeners.change();
   const ratedCurrent = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Nominale stroom module 1')[0];
   ratedCurrent.value = '16';
   ratedCurrent.listeners.input();
   persisted = JSON.parse(app.storage()).modules[0];
   assert.equal(persisted.rcdType, 'A');
   assert.equal(persisted.ratedCurrent, 16);

   select = typeControls()[0];
   select.value = 'RCBO-2P';
   select.listeners.change();
   module = JSON.parse(app.storage()).modules[0];
   assert.equal(module.type, 'RCBO-2P');
   assert.equal(module.id, 'legacy-module-1-1');
   assert.equal(module.color, '#9e9e9e');
   assert.equal(JSON.parse(app.storage()).rcdEnabled, true);
   const stableIds = JSON.parse(app.storage()).modules.map((entry) => entry.id);
   assert.deepEqual(JSON.parse(setupApp(app.storage()).storage()).modules.map((entry) => entry.id), stableIds);
   assert.equal(app.printCells().length, 1);
   assert.match(app.printCells()[0].attrs.style, /background-color: #9e9e9e/);
   assert.ok(app.findAll(app.nodes.get('print-area'), (node) => node.className === 'print-rcd-key').length);
});

test('a module warning must be one its type may flag', () => {
   const { schema } = setupSchema();
   const data = plain(schema.normalize(noWarnings));
   const variant = (change) => { const copy = structuredClone(data); change(copy); return copy; };
   assert.equal(schema.normalize(variant((d) => { d.modules[0].warning = 'pv'; })).modules[0].warning, 'pv');
   for (const warning of ['heat-pump', 'unknown', 1]) {
      assert.throws(() => schema.normalize(variant((d) => { d.modules[0].warning = warning; })), /waarschuwing/);
   }
   assert.throws(() => schema.normalize(variant((d) => { d.modules[0].type = 'SPD'; d.modules[0].warning = 'pv'; })),
      /ondersteunt de waarschuwing/);
});

test('the installation warning is chosen per module and drives the warning cards', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   const boxes = () => app.nodes.get('boxes');
   const byLabel = (label) => app.findAll(boxes(), (n) => n.attrs['aria-label'] === label)[0];
   const cards = () => app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-warning');
   assert.deepEqual(Array.from(byLabel('Bijzondere installatie voor module 1').children, (option) => option.value),
      ['', 'pv', 'ev', 'battery']);
   assert.equal(cards().length, 0);

   byLabel('Bijzondere installatie voor module 1').value = 'battery';
   byLabel('Bijzondere installatie voor module 1').listeners.change();
   byLabel('Bijzondere installatie voor module 2').value = 'pv';
   byLabel('Bijzondere installatie voor module 2').listeners.change();
   assert.deepEqual(JSON.parse(app.storage()).modules.map((module) => module.warning), ['battery', 'pv']);
   assert.deepEqual(cards().map((card) => card.children[0].attrs.src), ['images/pv.svg', 'images/eos.svg']);
   app.nodes.get('download-pdf').listeners.click();
   assert.deepEqual(app.pdfCalls[0][2], ['pv', 'battery']);

   byLabel('Moduletype voor module 1').value = 'SPD';
   byLabel('Moduletype voor module 1').listeners.change();
   assert.ok(!('warning' in JSON.parse(app.storage()).modules[0]));
   assert.equal(byLabel('Bijzondere installatie voor module 1'), undefined);
   assert.deepEqual(cards().map((card) => card.children[0].attrs.src), ['images/pv.svg']);
});

test('choosing a module type clears one-phase selections and locks three-phase modules', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   app.setPhaseEnabled(true);
   const boxes = () => app.nodes.get('boxes');
   const type = () => app.findAll(boxes(), (n) => n.attrs['aria-label'] === 'Moduletype voor module 1')[0];
   const phaseInputs = () => app.findAll(app.findAll(boxes(), (n) => n.className === 'group-phases')[0], (n) => n.tag === 'input');
   const stored = () => JSON.parse(app.storage()).modules[0].phases;

   phaseInputs()[1].checked = true;
   phaseInputs()[1].listeners.change();
   assert.deepEqual(stored(), ['L2']);

   type().value = 'MCB-2P';
   type().listeners.change();
   assert.deepEqual(stored(), ['L1', 'L2', 'L3']);
   assert.ok(phaseInputs().every((input) => input.checked && input.disabled));

   type().value = 'KWH-2P';
   type().listeners.change();
   assert.deepEqual(stored(), []);
   assert.ok(phaseInputs().every((input) => !input.checked && !input.disabled));

   phaseInputs()[0].checked = true;
   phaseInputs()[0].listeners.change();
   type().value = 'SPD';
   type().listeners.change();
   assert.deepEqual(stored(), [], 'switching between one-phase types starts empty again');
});

test('sub-distribution supply references stable modules and renders inverse feed details', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   const supplyType = (number) => app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Soort voeding kast ' + number)[0];
   supplyType('1').value = 'mains';
   supplyType('1').listeners.change();
   const rating = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Aansluitwaarde')[0];
   rating.value = 'Anders';
   rating.listeners.change();
   const customRating = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Andere aansluitwaarde')[0];
   customRating.value = '3x45A';
   customRating.listeners.input();
   const supplier = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Netbeheerder')[0];
   supplier.value = 'Stedin';
   supplier.listeners.input();
   assert.deepEqual(JSON.parse(app.storage()).boxes[0].supply, {
      type: 'mains', connectionRating: 'Anders', customConnectionRating: '3x45A', supplier: 'Stedin'
   });

   supplyType('2').value = 'subdistribution';
   supplyType('2').listeners.change();
   const source = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Voeding vanuit module kast 2')[0];
   assert.ok(source.children.some((option) => option.value === 'legacy-module-1-1'));
   source.value = 'legacy-module-1-1';
   source.listeners.change();
   for (const [label, value] of [['Voorbeveiliging', 'C32'], ['Aantal aders', '5'], ['Kabeldoorsnede (mm²)', '6']]) {
      const field = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === label)[0];
      field.value = value;
      field.listeners.input();
   }
   const currents = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Nominale stroom hoofdschakelaar');
   currents[1].value = '40';
   currents[1].listeners.input();
   const poles = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Polen hoofdschakelaar')[1];
   poles.value = '4';
   poles.listeners.change();
   const stored = JSON.parse(app.storage());
   assert.deepEqual(stored.boxes[1].supply, {
      type: 'subdistribution', sourceModuleId: 'legacy-module-1-1', preFuse: 'C32',
      cableCores: 5, cableCrossSection: 6, mainSwitchCurrent: 40, mainSwitchPoles: 4
   });
   const print = app.nodes.get('print-area');
   const supplySummaries = app.findAll(print, (node) => node.className === 'print-supply');
   assert.ok(supplySummaries[0].textContent.includes('3x45A'));
   assert.ok(supplySummaries[1].textContent.includes('5x 6 mm²'));
   assert.ok(app.findAll(print, (node) => node.className === 'print-module-feed')[0].textContent.includes('Kast 2'));
   const remove = app.findAll(app.nodes.get('boxes'), (node) => node.attrs['aria-label'] === 'Module verwijderen')[0];
   remove.listeners.click();
   assert.equal(JSON.parse(app.storage()).boxes[1].supply.sourceModuleId, null);
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
   assert.deepEqual(appState(app).boxes[0].groups[1].phases, ['L1', 'L3']);
   const poles = rcdControl('Aantal polen aardlekschakelaar A1');
   choose(poles, '4');
   assert.equal(rcdControl('Aantal polen aardlekschakelaar A1'), poles, 'pole selection keeps focus');
   assert.equal(rcdControl('Fase aardlekschakelaar A1'), undefined);
   assert.deepEqual(appState(app).rcds[0].phases, ['L1', 'L2', 'L3']);
   assert.deepEqual(printPhases(), ['Niet gekozen', 'L1, L3', 'Niet gekozen', 'Niet gekozen']);
   assert.equal(app.findAll(phaseCells()[0], (n) => n.tag === 'input').length, 3);
   const multi = app.findAll(phaseCells()[0], (n) => n.tag === 'input');
   multi.forEach((input) => { input.checked = true; input.listeners.change(); });
   assert.equal(printPhases()[0], 'L1, L2, L3');
   choose(poles, '2');
   assert.deepEqual(appState(app).rcds[0].phases, []);
   assert.equal(printPhases()[0], 'Niet gekozen');
   choose(rcdControl('Fase aardlekschakelaar A1'), 'L3');
   assert.deepEqual(printPhases(), ['L3', 'L3', 'L3', 'Niet gekozen']);
   const saved = appState(app);
   const exported = await app.export();
   const reloaded = setupApp(app.storage());
   assert.deepEqual(await reloaded.export(), exported);
   const imported = setupApp();
   imported.import(exported);
   assert.deepEqual(appState(imported), saved);
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][4], true);
   app.setPhaseEnabled(false);
   assert.equal(phaseCells().length, 0);
   assert.deepEqual(printPhases(), []);
   assert.equal(printBorders().length, 0);
   assert.deepEqual(appState(app), { ...saved, phaseEnabled: false });
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][4], false);
   app.setPhaseEnabled(true);
   app.deleteRcd(0);
   assert.deepEqual(printPhases(), ['L1, L2, L3', 'L1, L3', 'Niet gekozen', 'Niet gekozen']);
   assert.equal(app.findAll(phaseCells()[0], (n) => n.tag === 'input').length, 3);
   const beforeInvalid = app.storage();
   const invalid = structuredClone(withRcds);
   invalid.rcds[0].amountOfPoles = 3;
   app.import(invalid);
   assert.equal(app.storage(), beforeInvalid);
   assert.match(app.messages[0], /Importeren mislukt.*amountOfPoles/);
});

test('RCDs can be added and linked to groups in any box, and linked groups are colored in print', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   app.setRcdEnabled(true);
   assert.equal(app.nodes.get('rcd-panel').hidden, false);
   app.addRcd();
   app.addRcd();
   app.addRcd();
   app.addRcd();
   const state = appState(app);
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
   const linked = appState(app);
   assert.deepEqual(linked.boxes[0].groups.map((g) => g.rcdId), [null, state.rcds[1].id]);
   const cells = app.printCells();
   assert.equal(cells.length, 1);
   assert.equal(cells[0].textContent, 'A2 · 2');
   assert.match(cells[0].attrs.style, /background-color: #009fe3; color: #000000/);
   const key = app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-rcd-key');
   assert.equal(key.length, 1);
});

test('RCD technical attributes persist and appear in the print legend only when set', () => {
   const app = setupApp(JSON.stringify(withRcds));
   const controls = app.findAll(app.nodes.get('rcd-list'), (node) => node.className === 'rcd-technical-controls')[0];
   const [sensitivity, type, current] = controls.children;
   sensitivity.value = '30';
   sensitivity.listeners.change();
   type.value = 'A';
   type.listeners.change();
   current.value = '40';
   current.listeners.input();
   const stored = JSON.parse(app.storage());
   const rcd = stored.modules.find((module) => module.id === 'r1');
   assert.equal(rcd.sensitivity, 30);
   assert.equal(rcd.rcdType, 'A');
   assert.equal(rcd.ratedCurrent, 40);
   const legend = app.findAll(app.nodes.get('print-area'), (node) => node.className === 'print-rcd-key')[0];
   assert.ok(legend.children.some((item) => item.children.some((child) =>
      typeof child.textContent === 'string' && child.textContent.includes('30 mA - type A - 40 A'))));
   const untouched = stored.modules.find((module) => module.id === 'r2');
   assert.ok(!('sensitivity' in untouched));
   assert.ok(!('rcdType' in untouched));
   assert.ok(!('ratedCurrent' in untouched));
});

test('the group column puts the RCD first by default and remembers the previous order option', () => {
   const app = setupApp(JSON.stringify(withRcds));
   assert.equal(app.nodes.get('rcd-first').checked, true);
   assert.equal(app.printCells()[0].textContent, 'A1 · 1');
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][6], true);

   app.setRcdFirst(false);
   assert.equal(app.printCells()[0].textContent, '1 · A1');
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][6], false);
   assert.equal(app.storage().includes('rcd-first'), false);

   const reloaded = setupApp(app.storage(), '', true, null, 'false');
   assert.equal(reloaded.nodes.get('rcd-first').checked, false);
   assert.equal(reloaded.printCells()[0].textContent, '1 · A1');
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
   const stored = appState(app);
   assert.deepEqual(stored.boxes[0].groups[0].items, ['Vaatwasser', 'Stopcontacten', '<lamp>']);
   assert.equal(stored.schemaVersion, 5);
   const exported = await app.export();
   assert.deepEqual(editorState(exported).boxes[0].groups[0].items, stored.boxes[0].groups[0].items);
   const lists = app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-group-items');
   assert.equal(lists.length, 1);
   assert.deepEqual(lists[0].children.map((n) => [n.tag, n.textContent]),
      [['li', 'Vaatwasser'], ['li', 'Stopcontacten'], ['li', '<lamp>']]);
   const restored = setupApp(app.storage());
   assert.equal(restored.findAll(restored.nodes.get('boxes'), (n) => n.tag === 'textarea')[0].value,
      'Vaatwasser\nStopcontacten\n<lamp>');
   restored.import(exported);
   assert.deepEqual(appState(restored).boxes[0].groups[0].items, stored.boxes[0].groups[0].items);
   input.value = ' \n\n ';
   input.listeners.input();
   assert.deepEqual(appState(app).boxes[0].groups[0].items, []);
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
   assert.deepEqual(appState(app), editorState(expectedV5(withRcds)));
   assert.match(app.confirms.at(-1), /A1 – Keuken.*2 gekoppelde modules worden ontkoppeld/);
   app.confirm(true);
   app.deleteRcd(0);
   const state = appState(app);
   assert.deepEqual(state.rcds.map((r) => r.id), ['r2']);
   assert.deepEqual(state.boxes.flatMap((b) => b.groups.map((g) => g.rcdId)), [null, null, null, 'r2']);
});

test('disabling RCDs clears all RCDs and links only after confirmation', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.confirm(false);
   app.setRcdEnabled(false);
   assert.equal(app.nodes.get('rcd-enabled').checked, true);
   assert.deepEqual(appState(app), editorState(expectedV5(withRcds)));
   app.confirm(true);
   app.setRcdEnabled(false);
   const state = appState(app);
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
   for (const stored of [JSON.stringify({ schemaVersion: 5, boxes: [] }), '{broken']) {
      const app = setupApp(stored);
      assert.equal(app.storage(), stored);
      assert.equal(app.messages.length, 2);
      app.setPhaseEnabled(true);
      assert.equal(app.storage(), stored);
      app.confirm(false);
      app.import(legacy);
      assert.equal(app.storage(), stored);
      app.confirm(true);
      app.import(legacy);
      assert.deepEqual(JSON.parse(app.storage()), expectedV5(v4));
   }
});

test('clearing data writes the current schema, including after a failed load or with only RCDs enabled', () => {
   for (const stored of [JSON.stringify(legacy), JSON.stringify({ schemaVersion: 5 }), JSON.stringify(withRcds)]) {
      const app = setupApp(stored);
      app.nodes.get('clear-all').listeners.click();
      assert.deepEqual(JSON.parse(app.storage()), {
         schemaVersion: 5, qrEnabled: false, rcdEnabled: false, phaseEnabled: false, modules: [], boxes: []
      });
   }
   const app = setupApp();
   app.setRcdEnabled(true);
   app.nodes.get('clear-all').listeners.click();
   assert.equal(JSON.parse(app.storage()).rcdEnabled, false);
});

test('v3 files migrate to v5 with the QR code option off and keep all existing data', () => {
   const { schema } = setupSchema();
   const v3WithRcds = { ...structuredClone(withRcds), schemaVersion: 3 };
   delete v3WithRcds.qrEnabled;
   const original = structuredClone(v3WithRcds);
   assert.deepEqual(plain(schema.normalize(v3WithRcds)), expectedV5(withRcds));
   assert.deepEqual(v3WithRcds, original);
   assert.deepEqual(plain(schema.normalize(v3)), expectedV5(v4));
});

test('v4 requires qrEnabled to be a boolean and preserves explicit booleans', () => {
   const { schema } = setupSchema();
   for (const value of [undefined, null, 'true', 1]) {
      const data = { ...structuredClone(withRcds), qrEnabled: value };
      assert.throws(() => schema.normalize(data), /qrEnabled/);
   }
   for (const value of [true, false]) {
      assert.equal(schema.normalize({ ...structuredClone(withRcds), qrEnabled: value }).qrEnabled, value);
   }
});

test('the QR option persists, reloads, exports and is reset by clearing', async () => {
   const app = setupApp(JSON.stringify(withRcds));
   assert.equal(app.nodes.get('qr-enabled').checked, false);
   app.setQrEnabled(true);
   assert.equal(JSON.parse(app.storage()).qrEnabled, true);
   assert.equal((await app.export()).qrEnabled, true);
   const reloaded = setupApp(app.storage());
   assert.equal(reloaded.nodes.get('qr-enabled').checked, true);
   const imported = setupApp();
   imported.import(await app.export());
   assert.equal(imported.nodes.get('qr-enabled').checked, true);
   reloaded.nodes.get('clear-all').listeners.click();
   assert.equal(JSON.parse(reloaded.storage()).qrEnabled, false);
   assert.equal(reloaded.nodes.get('qr-enabled').checked, false);
});

test('the PDF only receives a QR code when the option is on, with a link that restores the data', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][5], null);
   app.setQrEnabled(true);
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][5], 'qr');
   assert.equal(app.nodes.get('qr-status').hidden, true);

   const share = app.shareContext.GroepenkaartShare;
   const link = share.url('https://example.test/app/?x=1#old', app.schema.normalize(JSON.parse(app.storage())));
   assert.match(link, /^https:\/\/example\.test\/app\/\?x=1#c2=[0-9A-Z$*+-]+$/);
   const decoded = share.decode(new URL(link).hash);
   assert.deepEqual(plain(semanticV5(app.schema.normalize(decoded))), plain(semanticV5(JSON.parse(app.storage()))));
});

test('empty rows are only added when the device preference is on, and the preference is not part of the data', () => {
   const app = setupApp(JSON.stringify(withRcds));
   const fillRows = app.nodes.get('fill-rows');
   assert.equal(fillRows.checked, false);
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][1], 0);
   fillRows.checked = true;
   fillRows.listeners.change();
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][1], 15);
   assert.ok(!('fillRows' in JSON.parse(app.storage())));

   const reloaded = setupApp(app.storage(), '', true, 'true');
   assert.equal(reloaded.nodes.get('fill-rows').checked, true);
   reloaded.nodes.get('download-pdf').listeners.click();
   assert.equal(reloaded.pdfCalls[0][1], 15);
});

test('a QR code is skipped with a visible message when the data does not fit', () => {
   const big = structuredClone(withRcds);
   let seed = 1;
   const random = () => (seed = (seed * 48271) % 2147483647).toString(36);
   big.boxes[0].groups = Array.from({ length: 400 }, (_, i) => ({
      number: String(i + 1), description: random() + random() + random(), rcdId: null, phases: []
   }));
   const app = setupApp(JSON.stringify(big));
   assert.equal(app.nodes.get('qr-status').hidden, true);
   app.setQrEnabled(true);
   assert.equal(app.nodes.get('qr-status').hidden, false);
   assert.match(app.nodes.get('qr-status').textContent, /te groot/);
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][5], null);
   app.setQrEnabled(false);
   assert.equal(app.nodes.get('qr-status').hidden, true);
});

test('opening a link replaces the data after confirmation, cleans the address and rejects bad links', () => {
   const source = setupApp(JSON.stringify(withRcds));
   const share = source.shareContext.GroepenkaartShare;
   const hash = '#c2=' + share.encode(JSON.parse(source.storage()));

   const fresh = setupApp(null, hash);
   assert.deepEqual(semanticV5(JSON.parse(fresh.storage())), semanticV5(expectedV5(withRcds)));
   assert.deepEqual(fresh.replaced, ['/app/?x=1']);
   assert.deepEqual(fresh.confirms, []);

   const existing = setupApp(JSON.stringify(v3), hash);
   assert.equal(existing.confirms.length, 1);
   assert.deepEqual(semanticV5(JSON.parse(existing.storage())), semanticV5(expectedV5(withRcds)));

   const declined = setupApp(JSON.stringify(v3), hash, false);
   assert.deepEqual(semanticV5(JSON.parse(declined.storage())), semanticV5(expectedV5(v4)));
   assert.deepEqual(declined.replaced, ['/app/?x=1']);

   const bads = ['#c1=', '#c1=abc', '#c1=!!!', '#c1=' + 'A'.repeat(20), '#c1=' + 'A'.repeat(4001), '#c1=1',
      '#c2=', '#c2=abc', '#c2=!!!', '#c2=' + 'A'.repeat(20), '#c2=' + 'A'.repeat(4001), '#c2=1', '#data=', '#data=!!!',
      '#data=' + 'A'.repeat(20)];
   for (const bad of bads) {
      const app = setupApp(JSON.stringify(v3), bad);
      assert.match(app.messages.at(-1), /Openen van de link mislukt/);
      assert.deepEqual(semanticV5(JSON.parse(app.storage())), semanticV5(expectedV5(v4)));
   }
   assert.deepEqual(setupApp(null, '#other').replaced, []);

   const open = setupApp(JSON.stringify(v3));
   open.location.hash = hash;
   open.windowListeners.hashchange();
   assert.deepEqual(semanticV5(JSON.parse(open.storage())), semanticV5(expectedV5(withRcds)));
});

test('compact links round-trip all data, with RCD ids renumbered and everything else unchanged', () => {
   const { schema } = setupSchema();
   const share = setupApp().shareContext.GroepenkaartShare;
   const data = {
      schemaVersion: 4, warnings: ['pv', 'heat-pump'], qrEnabled: true, rcdEnabled: true, phaseEnabled: true,
      rcds: [
         { id: 'f3b1c5de-0000-4000-8000-000000000001', number: 'A1', name: 'Keuken "en" bad', color: '#ed8c01', amountOfPoles: 2, phases: ['L2'] },
         { id: 'f3b1c5de-0000-4000-8000-000000000002', number: '', name: '', color: '#009fe3', amountOfPoles: 4, phases: ['L1', 'L2', 'L3'] }
      ],
      boxes: [
         {
            number: '1', name: 'Meterkast é – ü 日本', groups: [
               { number: '1', description: 'Keuken', rcdId: 'f3b1c5de-0000-4000-8000-000000000001', phases: [], items: ['Vaatwasser', 'Oven'] },
               { number: '2', description: '', rcdId: 'f3b1c5de-0000-4000-8000-000000000002', phases: ['L1', 'L3'], items: [] },
               { number: '3', description: 'Hal', rcdId: null, phases: ['L3'] }
            ]
         },
         { number: '2', name: '', groups: [] }
      ]
   };
   const original = structuredClone(data);
   const decoded = plain(schema.normalize(share.decode('#c1=' + share.encode(data))));
   assert.deepEqual(data, original);
   const renumbered = structuredClone(data);
   renumbered.rcds[0].id = 'r1';
   renumbered.rcds[1].id = 'r2';
   renumbered.boxes[0].groups[0].rcdId = 'r1';
   renumbered.boxes[0].groups[1].rcdId = 'r2';
   assert.deepEqual(decoded, expectedV5(renumbered));
   const emptyV4 = { schemaVersion: 4, warnings: [], qrEnabled: false, rcdEnabled: false, phaseEnabled: false, rcds: [], boxes: [] };
   assert.deepEqual(plain(schema.normalize(share.decode('#c1=' + share.encode(emptyV4)))), plain(schema.empty()));
   assert.equal(schema.currentVersion, 5);
});

test('compact links are much smaller than the original base64url format and the token is QR alphanumeric', () => {
   const { schema } = setupSchema();
   const share = setupApp().shareContext.GroepenkaartShare;
   const groups = Array.from({ length: 24 }, (_, i) => ({
      number: String(i + 1), description: ['Keuken', 'Woonkamer verlichting', 'Slaapkamer', 'Wasmachine en droger'][i % 4],
      rcdId: 'f3b1c5de-0000-4000-8000-00000000000' + (i % 3), phases: [], ...(i % 4 === 0 ? { items: ['Wandcontactdozen', 'Verlichting'] } : {})
   }));
   const data = schema.normalize({
      schemaVersion: 4, warnings: [], qrEnabled: false, rcdEnabled: true, phaseEnabled: false,
      rcds: [0, 1, 2].map((i) => ({ id: 'f3b1c5de-0000-4000-8000-00000000000' + i, number: 'A' + i, name: '', color: '#ed8c01', amountOfPoles: 2, phases: [] })),
      boxes: [{ number: '1', name: 'Meterkast', groups }]
   });
   const legacyToken = Buffer.from(require('fflate').deflateSync(Buffer.from(JSON.stringify(data)), { level: 9 })).toString('base64url');
   const token = share.encode(data);
   assert.match(token, /^[0-9A-Z$*+-]+$/);
   assert.ok(token.length < legacyToken.length * 0.7, `${token.length} should be well below ${legacyToken.length}`);

   const link = share.url('https://levdbas.github.io/groepenkaart-generator/', data);
   const code = share.qr(link);
   const legacyCode = (() => { const c = require('qrcode-generator')(0, 'M'); c.addData('https://levdbas.github.io/groepenkaart-generator/#data=' + legacyToken, 'Byte'); c.make(); return c; })();
   assert.ok(code.getModuleCount() < legacyCode.getModuleCount() - 20, `${code.getModuleCount()} vs ${legacyCode.getModuleCount()}`);
});

test('links in the original #data= format can still be opened, including after a schema migration', () => {
   const { schema } = setupSchema();
   const share = setupApp().shareContext.GroepenkaartShare;
   const token = Buffer.from(require('fflate').deflateSync(Buffer.from(JSON.stringify(withRcdsV2)), { level: 9 })).toString('base64url');
   assert.ok(share.isLink('#data=' + token));
   assert.deepEqual(plain(schema.normalize(share.decode('#data=' + token))), expectedV5(withRcds));
   assert.ok(!share.isLink('#other'));
   assert.ok(!share.isLink(''));
});

test('the too-large message follows typing once the typing pauses', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.setQrEnabled(true);
   const status = app.nodes.get('qr-status');
   assert.equal(status.hidden, true);
   const description = app.findAll(app.nodes.get('boxes'), (n) => n.attrs['aria-label'] === 'Omschrijving')[0];
   let seed = 7;
   description.value = Array.from({ length: 6000 }, () => (seed = (seed * 48271) % 2147483647).toString(36)[0]).join('');
   description.listeners.input();
   description.listeners.input();
   assert.equal(app.timers.length, 1, 'repeated typing keeps a single pending check');
   assert.equal(status.hidden, true);
   app.timers[0]();
   assert.equal(status.hidden, false);
   description.value = 'kort';
   description.listeners.input();
   app.timers[0]();
   assert.equal(status.hidden, true);
});
