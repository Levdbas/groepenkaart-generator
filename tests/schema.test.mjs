import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);

const sources = await Promise.all(['warnings', 'rcd', 'schema', 'layout', 'share', 'app'].map((name) =>
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
   // Migrated modules are all one module wide and fill rails of 12 in order.
   for (const box of boxes) {
      box.moduleIds.forEach((id, index) => {
         Object.assign(modules.find((module) => module.id === id), { rail: Math.floor(index / 12) + 1, slot: index % 12 + 1 });
      });
      box.rails = Math.max(1, Math.ceil(box.moduleIds.length / 12));
      box.railWidth = 12;
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
   sources.slice(0, 4).forEach((source) => vm.runInContext(source, context));
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

test('v5 box layout is validated, kept in physical order and laid out for draft data without it', () => {
   const { schema } = setupSchema();
   const data = plain(schema.normalize(withRcds));
   assert.deepEqual(data.boxes.map((box) => [box.rails, box.railWidth]), [[1, 12], [1, 12]]);
   assert.deepEqual(data.modules.map((module) => [module.rail, module.slot]),
      [[1, 1], [1, 2], [1, 1], [1, 2], [undefined, undefined], [undefined, undefined]]);
   const variant = (change) => { const copy = structuredClone(data); change(copy); return copy; };
   for (const [change, message] of [
      [(d) => { d.boxes[0].rails = 0; }, /"rails".*1 tot 99/],
      [(d) => { d.boxes[0].rails = 100; }, /"rails"/],
      [(d) => { d.boxes[0].rails = '2'; }, /"rails"/],
      [(d) => { d.boxes[0].railWidth = 3; }, /"railWidth".*4 tot 48/],
      [(d) => { d.boxes[0].railWidth = 49; }, /"railWidth"/],
      [(d) => { delete d.boxes[0].railWidth; }, /"railWidth"/],
      [(d) => { d.modules[0].slot = 13; }, /valt buiten de rails/],
      [(d) => { d.modules[0].rail = 2; }, /valt buiten de rails/],
      [(d) => { d.modules[1].type = 'MCB-2P'; d.modules[1].slot = 10; }, /valt buiten de rails/],
      [(d) => { d.modules[1].slot = 1; }, /overlappen/],
      [(d) => { d.modules[0].type = 'RCD-2P'; d.modules[0].color = '#ff0000'; }, /overlappen/],
      [(d) => { delete d.modules[0].rail; }, /geen rail en plek/],
      [(d) => { d.modules[0].slot = 0; }, /"slot".*positief geheel getal/],
      [(d) => { d.modules[0].rail = 1.5; }, /"rail".*positief geheel getal/],
      [(d) => { d.modules[4].rail = 1; d.modules[4].slot = 5; }, /niet-geplaatste module/]
   ]) {
      assert.throws(() => schema.normalize(variant(change)), message);
   }
   const wide = schema.normalize(variant((d) => { d.modules[1].type = 'MCB-3P'; d.modules[1].slot = 11; }));
   assert.equal(wide.modules[1].slot, 11);

   const reordered = schema.normalize(variant((d) => {
      d.boxes[0].rails = 2;
      d.modules[0].rail = 2;
      d.modules[0].slot = 3;
   }));
   assert.deepEqual(Array.from(reordered.boxes[0].moduleIds), ['legacy-module-1-2', 'legacy-module-1-1'],
      'module references follow the physical order');

   const draft = variant((d) => {
      d.boxes.forEach((box) => { delete box.rails; delete box.railWidth; });
      d.modules.forEach((module) => { delete module.rail; delete module.slot; });
      d.modules[1].type = 'MCB-2P';
   });
   const laidOut = plain(schema.normalize(draft));
   assert.deepEqual(laidOut.boxes.map((box) => [box.rails, box.railWidth]), [[1, 12], [1, 12]]);
   assert.deepEqual(laidOut.modules.slice(0, 2).map((module) => [module.rail, module.slot]), [[1, 1], [1, 2]]);
   const full = structuredClone(withRcds);
   full.boxes[0].groups = Array.from({ length: 13 }, (_, i) => ({ number: String(i + 1), description: '', rcdId: null, phases: [] }));
   const migrated = schema.normalize(full);
   assert.equal(migrated.boxes[0].rails, 2, 'a 13th module starts a second rail');
   assert.deepEqual([migrated.modules[12].rail, migrated.modules[12].slot], [2, 1]);
   assert.equal(schema.autoLayout(['MCB', 'MCB-2P', 'MCB-2P', 'MCB-2P'], 12).rails, 2,
      'a module that does not fit on the rest of a rail moves to the next one');
   assert.deepEqual(plain(schema.autoLayout([], 12)), { rails: 1, positions: [] });
});

test('c2 compact links round-trip modules, protection references and supply fields', () => {
   const { schema, context } = setupSchema();
   context.window.fflate = require('fflate');
   vm.runInContext(sources[4], context);
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
   data.boxes[0].rails = 3;
   data.boxes[0].railWidth = 18;
   data.modules[1].rail = 3;
   data.modules[1].slot = 7;
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
   assert.deepEqual([decoded.boxes[0].rails, decoded.boxes[0].railWidth, decoded.boxes[1].rails, decoded.boxes[1].railWidth], [3, 18, 1, 12]);
   assert.deepEqual(Array.from(decoded.modules, (module) => [module.rail, module.slot]),
      [[1, 1], [3, 7], [1, 1], [1, 2], [undefined, undefined], [undefined, undefined]]);
   assert.deepEqual(plain(decoded.boxes[1].supply), {
      type: 'subdistribution', sourceModuleId: 'm1', preFuse: 'C32', cableCores: 5,
      cableCrossSection: 6, mainSwitchCurrent: 40, mainSwitchPoles: 4
   });
   assert.deepEqual(plain(decoded.boxes[0].supply), {
      type: 'mains', connectionRating: 'Anders', customConnectionRating: '3x45A', supplier: 'Stedin',
      mainSwitchCurrent: 40, mainSwitchPoles: 4
   });
});

function setupApp(stored = null, hash = '', confirmAnswer = true, fillRows = null, rcdFirst = null, expertMode = null) {
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
   let rcdFirstStorage = rcdFirst;
   let expertModeStorage = expertMode;
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
            if (key === 'groepenkaart:rcd-first') return rcdFirstStorage;
            if (key === 'groepenkaart:expert-mode') return expertModeStorage;
            assert.equal(key, 'groepenkaart:v1');
            return storage;
         },
         setItem(key, value) {
            if (key === 'groepenkaart:rcd-first') { rcdFirstStorage = value; return; }
            if (key === 'groepenkaart:expert-mode') { expertModeStorage = value; return; }
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
   vm.runInContext(sources[4], context);
   vm.runInContext(sources[5], context);
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
      setExpertMode(value) {
         const checkbox = nodes.get('expert-mode');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      expertModeStorage: () => expertModeStorage,
      setPhaseEnabled(value) {
         const checkbox = nodes.get('phase-enabled');
         checkbox.checked = value;
         checkbox.listeners.change();
      },
      byLabel(label, root = nodes.get('boxes')) { return findAll(root, (n) => n.attrs['aria-label'] === label)[0]; },
      addBox(rails = 2, railWidth = 12) {
         nodes.get('add-box').listeners.click();
         const dialog = nodes.get('box-dialog');
         findAll(dialog, (n) => n.attrs['data-field'] === 'rails')[0].value = String(rails);
         findAll(dialog, (n) => n.attrs['data-field'] === 'railWidth')[0].value = String(railWidth);
         findAll(dialog, (n) => n.tag === 'form')[0].listeners.submit({ preventDefault() { } });
      },
      slot(rail, slot, boxIndex = 0) {
         return findAll(nodes.get('boxes').children[boxIndex], (n) => n.attrs['aria-label'] === `Module toevoegen op rail ${rail}, plek ${slot}`)[0];
      },
      openSlot(rail, slot, boxIndex = 0) { this.slot(rail, slot, boxIndex).listeners.click(); },
      moduleButton(id) { return findAll(nodes.get('boxes'), (n) => n.tag === 'button' && n.attrs['data-module-id'] === id)[0]; },
      selectModule(id) {
         if (this.moduleButton(id).attrs['aria-pressed'] !== 'true') this.moduleButton(id).listeners.click();
      },
      editModule(id) {
         const unplaced = findAll(nodes.get('unplaced-list'), (n) => n.attrs['data-module-id'] === id)[0];
         if (unplaced) {
            findAll(unplaced, (n) => n.attrs['aria-label'] === 'Module bewerken')[0].listeners.click();
            return;
         }
         this.selectModule(id);
         this.moduleButton(id).listeners.click();
      },
      removeUnplaced(id) {
         const item = findAll(nodes.get('unplaced-list'), (n) => n.attrs['data-module-id'] === id)[0];
         findAll(item, (n) => n.attrs['aria-label'] === 'Module verwijderen')[0].listeners.click();
      },
      dialog() { return nodes.get('module-dialog'); },
      field(name) { return findAll(nodes.get('module-dialog'), (n) => n.attrs['data-field'] === name)[0]; },
      set(name, value) {
         const field = this.field(name);
         if (field.attrs.type === 'checkbox') {
            field.checked = value;
            field.listeners.change();
            return;
         }
         field.value = value;
         (field.listeners.change || field.listeners.input)();
      },
      save() { findAll(nodes.get('module-dialog'), (n) => n.tag === 'form')[0].listeners.submit({ preventDefault() { } }); },
      cancel() { findAll(nodes.get('module-dialog'), (n) => n.tag === 'button' && n.textContent === 'Annuleren')[0].listeners.click(); },
      action(label) { return findAll(nodes.get('boxes'), (n) => n.tag === 'button' && n.attrs['aria-label'] === label)[0]; },
      moduleIds(boxIndex = 0) { return JSON.parse(storage).boxes[boxIndex].moduleIds; },
      position(id) {
         const module = JSON.parse(storage).modules.find((candidate) => candidate.id === id);
         return [module.rail, module.slot];
      },
      printCells() { return findAll(nodes.get('print-area'), (n) => n.tag === 'td' && n.className === 'rcd-cell'); }
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
      [variant((d) => { d.modules[0].type = 'MAINS-2P'; d.modules[0].protectedByModuleId = d.modules[4].id; }), /staat voor de aardlekschakelaar/],
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
   const { boxLimits } = schema;
   assert.ok(['rails', 'railWidth'].every((field) => publishedSchema.$defs.box.required.includes(field)));
   assert.deepEqual(['rails', 'railWidth'].map((field) => {
      const property = publishedSchema.$defs.box.properties[field];
      return [property.type, property.minimum, property.maximum];
   }), [['integer', boxLimits.minRails, boxLimits.maxRails], ['integer', boxLimits.minRailWidth, boxLimits.maxRailWidth]]);
   for (const field of ['rail', 'slot']) {
      assert.deepEqual(publishedSchema.$defs.module.properties[field], { ...publishedSchema.$defs.module.properties[field], type: 'integer', minimum: 1 });
      assert.ok(!publishedSchema.$defs.module.required.includes(field), 'only placed modules have a position');
   }
   assert.deepEqual(publishedSchema.$defs.module.allOf[0].then.required, ['rail', 'slot']);
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
   assert.equal(app.findAll(app.nodes.get('boxes'), (n) => n.tag === 'button' && n.attrs['data-module-id']).length, 5);
   assert.equal(app.nodes.get('unplaced').hidden, true);
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

test('phase options precede RCD options and the module dialog follows the feature toggles', async () => {
   const html = await readFile(new URL('../src/index.html', import.meta.url), 'utf8');
   assert.ok(html.indexOf('id="phase-enabled"') < html.indexOf('id="rcd-enabled"'));
   const app = setupApp(JSON.stringify(withRcds));
   app.editModule('legacy-module-1-2');
   assert.ok(app.field('protection'));
   assert.equal(app.field('phase-L1'), undefined);
   app.cancel();
   app.setPhaseEnabled(true);
   app.editModule('legacy-module-1-2');
   assert.ok(app.field('protection'));
   assert.ok(app.field('phase-L1'));
   app.cancel();
   app.setRcdEnabled(false);
   app.editModule('legacy-module-1-2');
   assert.equal(app.field('protection'), undefined);
   assert.ok(app.field('phase-L1'));
   app.cancel();
   app.setPhaseEnabled(false);
   app.editModule('legacy-module-1-2');
   assert.equal(app.field('phase-L1'), undefined);
});

test('modules have no name field: the dialog edits the description, which reaches the PDF data and print output', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.editModule('legacy-module-1-1');
   assert.equal(app.dialog().open, true);
   const labels = app.findAll(app.dialog(), (n) => n.attrs['aria-label'] !== undefined).map((n) => n.attrs['aria-label']);
   assert.ok(!labels.includes('Groepnaam'));
   assert.equal(app.field('description').value, 'Keuken');
   app.set('description', 'Keuken en bijkeuken');
   assert.equal(appState(app).boxes[0].groups[0].description, 'Keuken', 'the dialog edits a draft until it is saved');
   app.save();
   assert.equal(app.dialog().open, false);
   const stored = appState(app);
   assert.equal(stored.boxes[0].groups[0].description, 'Keuken en bijkeuken');
   assert.ok(JSON.parse(app.storage()).modules.filter((module) => module.type === 'MCB').every((module) => !('name' in module)));
   assert.equal(app.findAll(app.nodes.get('boxes'), (n) => n.className === 'din-label')[0].textContent, 'Keuken en bijkeuken');
   const firstPage = app.findAll(app.nodes.get('print-area'), (n) => n.tag === 'article')[0];
   assert.deepEqual(app.findAll(firstPage, (n) => n.tag === 'th').map((n) => n.textContent), ['Module', 'Omschrijving']);
   const printRow = app.findAll(firstPage, (n) => n.tag === 'tr' && n.children[0].tag === 'td')[0];
   assert.equal(printRow.children.length, 2);
   assert.equal(printRow.children[1].children[0].textContent, 'Keuken en bijkeuken');

   app.addBox(1, 12);
   assert.deepEqual(JSON.parse(app.storage()).boxes.at(-1), {
      id: JSON.parse(app.storage()).boxes.at(-1).id, number: '3', name: '', rails: 1, railWidth: 12, moduleIds: [], supply: null
   });
   app.openSlot(1, 1, 2);
   app.save();
   const added = JSON.parse(app.storage()).modules.at(-1);
   assert.deepEqual(Object.keys(added).sort(),
      ['boxId', 'characteristic', 'description', 'id', 'number', 'phases', 'protectedByModuleId', 'rail', 'slot', 'type']);
   assert.deepEqual([added.type, added.number, added.rail, added.slot], ['MCB', '1', 1, 1]);
});

test('module type controls derive width, only offer types that fit, keep characteristics and create protective modules', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   const option = (slug) => app.field('type').children.find((item) => item.value === slug);
   app.editModule('legacy-module-1-1');
   assert.equal(option('MCB-2P'), undefined);
   app.cancel();
   app.setPhaseEnabled(true);
   app.editModule('legacy-module-1-1');
   assert.equal(option('MCB-2P').attrs.disabled, 'disabled', 'a 4-wide type does not fit before module 2');
   assert.match(option('MCB-2P').textContent, /past hier niet/);
   assert.equal(option('MCB').attrs.disabled, undefined);
   app.set('type', 'MCB-2P');
   app.save();
   assert.match(app.messages.at(-1), /Module niet opgeslagen.*overlappen/);
   assert.equal(JSON.parse(app.storage()).modules[0].type, 'MCB', 'a rejected save leaves the data untouched');
   app.cancel();

   app.setExpertMode(true);
   app.editModule('legacy-module-1-2');
   assert.equal(option('MCB-2P').attrs.disabled, undefined);
   app.set('type', 'MCB-2P');
   app.set('characteristic', 'C32');
   app.set('rcdType', 'A');
   app.set('ratedCurrent', '16');
   app.save();
   let module = JSON.parse(app.storage()).modules[1];
   assert.equal(module.type, 'MCB-2P');
   assert.ok(!('width' in module));
   assert.equal(app.shareContext.GroepenkaartSchema.moduleTypes.get(module.type).width, 4);
   assert.equal(app.moduleButton('legacy-module-1-2').attrs.style, 'grid-column: 2 / span 4');
   assert.equal(module.characteristic, 'C32');
   assert.equal(module.rcdType, 'A');
   assert.equal(module.ratedCurrent, 16);

   app.editModule('legacy-module-1-2');
   app.set('type', 'RCBO-2P');
   app.save();
   module = JSON.parse(app.storage()).modules[1];
   assert.equal(module.type, 'RCBO-2P');
   assert.equal(module.id, 'legacy-module-1-2');
   assert.equal(module.color, '#9e9e9e');
   assert.equal(module.characteristic, 'C32');
   assert.equal(JSON.parse(app.storage()).rcdEnabled, true);
   const stableIds = JSON.parse(app.storage()).modules.map((entry) => entry.id);
   assert.deepEqual(JSON.parse(setupApp(app.storage()).storage()).modules.map((entry) => entry.id), stableIds);
   assert.equal(app.printCells().length, 1);
   assert.equal(app.printCells()[0].textContent, '2', 'a placed RCBO shows its own code once');
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
   const cards = () => app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-warning');
   app.editModule('legacy-module-1-1');
   assert.deepEqual(Array.from(app.field('warning').children, (option) => option.value), ['', 'pv', 'ev', 'battery']);
   assert.equal(cards().length, 0);
   app.set('warning', 'battery');
   app.save();
   app.editModule('legacy-module-1-2');
   app.set('warning', 'pv');
   app.save();
   assert.deepEqual(JSON.parse(app.storage()).modules.map((module) => module.warning), ['battery', 'pv']);
   assert.deepEqual(cards().map((card) => card.children[0].attrs.src), ['images/pv.svg', 'images/eos.svg']);
   assert.equal(app.findAll(app.moduleButton('legacy-module-1-1'), (n) => n.className === 'din-module-badge')[0].textContent, 'EOS');
   app.nodes.get('download-pdf').listeners.click();
   assert.deepEqual(app.pdfCalls[0][2], ['pv', 'battery']);

   app.editModule('legacy-module-1-1');
   app.set('type', 'SPD');
   assert.equal(app.field('warning'), undefined);
   app.save();
   assert.ok(!('warning' in JSON.parse(app.storage()).modules[0]));
   assert.deepEqual(cards().map((card) => card.children[0].attrs.src), ['images/pv.svg']);
});

test('choosing a module type clears one-phase selections and locks three-phase modules', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   app.setPhaseEnabled(true);
   const stored = () => JSON.parse(app.storage()).modules[1].phases;
   app.editModule('legacy-module-1-2');
   app.set('phase-L2', true);
   app.save();
   assert.deepEqual(stored(), ['L2']);

   app.editModule('legacy-module-1-2');
   app.set('type', 'MCB-2P');
   assert.equal(app.field('phase-L1'), undefined, 'three-phase modules have no phase choice');
   assert.ok(app.findAll(app.dialog(), (n) => n.className === 'phase-inherited' && n.textContent === 'L1, L2, L3').length);
   app.save();
   assert.deepEqual(stored(), ['L1', 'L2', 'L3']);

   app.editModule('legacy-module-1-2');
   app.set('type', 'KWH-2P');
   assert.ok(['L1', 'L2', 'L3'].every((phase) => app.field('phase-' + phase).checked === false));
   app.save();
   assert.deepEqual(stored(), []);

   app.editModule('legacy-module-1-2');
   app.set('phase-L1', true);
   app.set('type', 'SPD');
   app.save();
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
   app.selectModule('legacy-module-1-1');
   app.action('Module verwijderen').listeners.click();
   assert.equal(JSON.parse(app.storage()).boxes[1].supply.sourceModuleId, null);
});

test('phase editing applies inheritance immediately across boxes and preserves independent group selections', async () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.setPhaseEnabled(true);
   const printPhases = () => app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-phases')
      .map((cell) => cell.textContent);
   const printBorders = () => app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-phase-border');
   const inherited = () => app.findAll(app.dialog(), (n) => n.className === 'phase-inherited')[0];
   const module = (id) => JSON.parse(app.storage()).modules.find((entry) => entry.id === id);
   assert.deepEqual(printPhases(), Array(4).fill('Niet gekozen'));
   assert.equal(printBorders().length, 0);
   app.editModule('legacy-module-1-1');
   assert.equal(app.field('phase-L1'), undefined, 'a module on a 2-pole RCD inherits its phase');
   assert.equal(inherited().textContent, 'Niet gekozen (via aardlekschakelaar)');
   app.cancel();

   app.editModule('r1');
   app.set('phase', 'L2');
   app.save();
   assert.deepEqual(printPhases(), ['L2', 'Niet gekozen', 'L2', 'Niet gekozen']);
   assert.deepEqual(printBorders().map((border) => border.children.map((segment) => segment.attrs.style)),
      [['background-color: #000000'], ['background-color: #000000']]);
   app.editModule('legacy-module-1-2');
   app.set('phase-L1', true);
   app.set('phase-L3', true);
   app.save();
   assert.deepEqual(printPhases(), ['L2', 'L1, L3', 'L2', 'Niet gekozen']);
   assert.deepEqual(printBorders()[1].children.map((segment) => segment.attrs.style),
      ['background-color: #8B4513', 'background-color: #808080']);

   app.editModule('legacy-module-1-2');
   app.set('protection', 'r1');
   assert.equal(app.field('phase-L1'), undefined, 'linking switches the dialog to the inherited phase at once');
   assert.equal(inherited().textContent, 'L2 (via aardlekschakelaar)');
   app.save();
   assert.deepEqual(printPhases(), ['L2', 'L2', 'L2', 'Niet gekozen']);
   assert.deepEqual(module('legacy-module-1-2').phases, ['L1', 'L3']);

   app.editModule('r1');
   app.set('type', 'RCD-4P');
   assert.equal(app.field('phase'), undefined);
   app.save();
   assert.deepEqual([module('r1').type, module('r1').phases], ['RCD-4P', ['L1', 'L2', 'L3']]);
   assert.deepEqual(printPhases(), ['Niet gekozen', 'L1, L3', 'Niet gekozen', 'Niet gekozen']);
   app.editModule('legacy-module-1-1');
   for (const phase of ['L1', 'L2', 'L3']) app.set('phase-' + phase, true);
   app.save();
   assert.equal(printPhases()[0], 'L1, L2, L3');
   app.editModule('r1');
   app.set('type', 'RCD-2P');
   assert.equal(app.field('phase').value, '', 'a 2-pole RCD does not pick one of the former three phases');
   app.save();
   assert.deepEqual(module('r1').phases, []);
   assert.equal(printPhases()[0], 'Niet gekozen');
   app.editModule('r1');
   app.set('phase', 'L3');
   app.save();
   assert.deepEqual(printPhases(), ['L3', 'L3', 'L3', 'Niet gekozen']);

   const saved = appState(app);
   const exported = await app.export();
   const reloaded = setupApp(app.storage());
   assert.deepEqual(await reloaded.export(), exported);
   const imported = setupApp();
   imported.import(exported);
   assert.deepEqual(appState(imported), saved);
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][3], true);
   app.setPhaseEnabled(false);
   assert.deepEqual(printPhases(), []);
   assert.equal(printBorders().length, 0);
   assert.deepEqual(appState(app), { ...saved, phaseEnabled: false });
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][3], false);
   app.setPhaseEnabled(true);
   app.removeUnplaced('r1');
   assert.deepEqual(printPhases(), ['L1, L2, L3', 'L1, L3', 'Niet gekozen', 'Niet gekozen']);
   const beforeInvalid = app.storage();
   const invalid = structuredClone(withRcds);
   invalid.rcds[0].amountOfPoles = 3;
   app.import(invalid);
   assert.equal(app.storage(), beforeInvalid);
   assert.match(app.messages[0], /Importeren mislukt.*amountOfPoles/);
});

test('RCDs are placed in a box like any module and linked groups in any box are colored in print', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   assert.equal(JSON.parse(app.storage()).rcdEnabled, false);
   for (const slot of [3, 5, 7, 9]) {
      app.openSlot(1, slot);
      app.set('type', 'RCD-2P');
      app.save();
   }
   const stored = JSON.parse(app.storage());
   const rcds = stored.modules.filter((module) => module.type === 'RCD-2P');
   assert.equal(stored.rcdEnabled, true, 'placing an RCD switches linking on');
   assert.equal(app.nodes.get('rcd-enabled').checked, true);
   assert.deepEqual(rcds.map((r) => [r.number, r.color, r.rail, r.slot]), [
      ['A1', '#ed8c01', 1, 3], ['A2', '#009fe3', 1, 5], ['A3', '#95be1a', 1, 7], ['A4', '#9e9e9e', 1, 9]
   ]);
   assert.ok(rcds.every((rcd) => rcd.phases.length === 0 && rcd.boxId === stored.boxes[0].id));

   app.editModule('legacy-module-1-2');
   assert.equal(app.field('protection').children.length, 5);
   app.set('protection', rcds[1].id);
   assert.equal(app.findAll(app.dialog(), (n) => n.className === 'rcd-swatch')[0].attrs.style, 'background-color: #009fe3');
   app.save();
   app.openSlot(1, 1, 1);
   app.set('protection', rcds[0].id);
   app.save();
   const linked = appState(app);
   assert.deepEqual(linked.boxes[0].groups.map((g) => g.rcdId), [null, rcds[1].id, null, null, null, null]);
   assert.deepEqual(linked.boxes[1].groups.map((g) => g.rcdId), [rcds[0].id]);
   assert.equal(app.findAll(app.moduleButton('legacy-module-1-2'), (n) => n.className === 'din-module-stripe')[0].attrs.style,
      'background-color: #009fe3');
   const cells = app.printCells();
   assert.deepEqual(cells.map((cell) => cell.textContent), ['A2 · 2', 'A1', 'A2', 'A3', 'A4', 'A1 · 1']);
   assert.match(cells[0].attrs.style, /background-color: #009fe3; color: #000000/);
   assert.equal(app.findAll(app.nodes.get('print-area'), (n) => n.className === 'print-rcd-key').length, 2);
});

test('RCD technical attributes persist and appear in the print legend only when set', () => {
   const app = setupApp(JSON.stringify(withRcds), '', true, null, null, 'true');
   assert.equal(app.nodes.get('unplaced').hidden, false);
   app.editModule('r1');
   assert.equal(app.field('description').value, 'Keuken', 'a migrated RCD name is edited as its description');
   assert.equal(app.field('protection'), undefined, 'an RCD is not linked to another RCD');
   app.set('sensitivity', '30');
   app.set('rcdType', 'A');
   app.set('ratedCurrent', '40');
   app.save();
   const stored = JSON.parse(app.storage());
   const rcd = stored.modules.find((module) => module.id === 'r1');
   assert.equal(rcd.sensitivity, 30);
   assert.equal(rcd.rcdType, 'A');
   assert.equal(rcd.ratedCurrent, 40);
   assert.equal(rcd.name, 'Keuken');
   assert.equal(rcd.boxId, null);
   const legend = app.findAll(app.nodes.get('print-area'), (node) => node.className === 'print-rcd-key')[0];
   assert.ok(legend.children.some((item) => item.children.some((child) =>
      typeof child.textContent === 'string' && child.textContent.includes('A1 – Keuken - 30 mA - type A - 40 A'))));
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
   assert.equal(app.pdfCalls[0][5], true);

   app.setRcdFirst(false);
   assert.equal(app.printCells()[0].textContent, '1 · A1');
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][5], false);
   assert.equal(app.storage().includes('rcd-first'), false);

   const reloaded = setupApp(app.storage(), '', true, 'false');
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

test('connection lines are saved as arrays and printed as bullets', async () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.editModule('legacy-module-1-1');
   assert.equal(app.field('items').value, '');
   app.set('items', ' Vaatwasser \r\n\nStopcontacten\n <lamp> \n');
   app.save();
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
   restored.editModule('legacy-module-1-1');
   assert.equal(restored.field('items').value, 'Vaatwasser\nStopcontacten\n<lamp>');
   restored.cancel();
   restored.import(exported);
   assert.deepEqual(appState(restored).boxes[0].groups[0].items, stored.boxes[0].groups[0].items);
   app.editModule('legacy-module-1-1');
   app.set('items', ' \n\n ');
   app.save();
   assert.ok(!('items' in appState(app).boxes[0].groups[0]));
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
   app.removeUnplaced('r1');
   assert.deepEqual(appState(app), editorState(expectedV5(withRcds)));
   assert.match(app.confirms.at(-1), /Module A1 verwijderen\? 2 modules worden ontkoppeld/);
   app.confirm(true);
   app.removeUnplaced('r1');
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
   assert.equal(app.nodes.get('unplaced').hidden, true, 'RCDs without a place are removed');
   assert.equal(app.printCells().length, 0);

   const empty = setupApp(JSON.stringify(legacy));
   empty.setRcdEnabled(true);
   const count = empty.confirms.length;
   empty.setRcdEnabled(false);
   assert.equal(empty.confirms.length, count, 'no confirmation needed without RCDs');
   assert.equal(JSON.parse(empty.storage()).rcdEnabled, false);
});

test('a dinrail outlet connects to a circuit breaker only, follows the RCD of its MCB and keeps the link without RCDs', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.editModule('legacy-module-1-2');
   assert.equal(app.field('protection').attrs['aria-label'], 'Aardlekschakelaar');
   app.set('type', 'DIN-OUTLET');
   assert.equal(app.field('protection').attrs['aria-label'], 'Aangesloten op');
   assert.deepEqual(app.field('protection').children.map((child) => child.attrs.value),
      ['', 'legacy-module-1-1', 'legacy-module-2-1', 'legacy-module-2-2'], 'only circuit breakers are offered, no RCD');
   app.set('protection', 'legacy-module-1-1');
   app.save();
   const stored = JSON.parse(app.storage());
   assert.equal(stored.modules[1].protectedByModuleId, 'legacy-module-1-1');
   assert.equal(app.printCells()[1].textContent, 'A1 · 2', 'the outlet takes the RCD color of the MCB it hangs on');
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[0][0][0].groups[1].connectedTo, '1');
   assert.equal(app.pdfCalls[0][0][0].groups[1].connectedRcd, 'A1');

   app.editModule('legacy-module-1-2');
   app.set('type', 'MCB');
   assert.equal(app.field('protection').attrs['aria-label'], 'Aardlekschakelaar');
   assert.equal(app.field('protection').value, '', 'a type without MCB links drops the MCB link');
   app.cancel();

   app.editModule('legacy-module-1-1');
   app.set('type', 'DIN-OUTLET');
   assert.equal(app.field('protection').value, '', 'a link to an RCD is dropped when the type becomes an outlet');
   app.cancel();

   app.setRcdEnabled(false);
   const kept = JSON.parse(app.storage());
   assert.equal(kept.modules[1].protectedByModuleId, 'legacy-module-1-1');
   assert.equal(kept.modules[0].protectedByModuleId, null);
   app.editModule('legacy-module-1-2');
   assert.equal(app.field('protection').children.length, 4);
});

test('a dinrail outlet inherits phases and rated current from the circuit breaker it hangs on', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   app.setPhaseEnabled(true);
   app.setExpertMode(true);
   const inherited = () => app.findAll(app.dialog(), (node) => node.className === 'phase-inherited').map((node) => node.textContent);
   const printed = () => { app.nodes.get('download-pdf').listeners.click(); return app.pdfCalls.at(-1)[0][0].groups[1]; };

   app.editModule('legacy-module-1-1');
   app.set('phase-L2', true);
   app.set('ratedCurrent', '16');
   app.save();

   app.editModule('legacy-module-1-2');
   app.set('type', 'DIN-OUTLET');
   app.set('phase-L3', true);
   app.set('ratedCurrent', '25');
   app.set('protection', 'legacy-module-1-1');
   assert.equal(app.field('phase-L1'), undefined, 'the phases come from the circuit breaker');
   assert.equal(app.field('ratedCurrent'), undefined, 'the rated current comes from the circuit breaker');
   assert.deepEqual(inherited(), ['L2 (via installatieautomaat)', '16 A (via installatieautomaat)']);
   app.save();
   assert.deepEqual([printed().phases, printed().ratedCurrent], [['L2'], 16]);
   assert.equal(JSON.parse(app.storage()).modules[1].ratedCurrent, 25, 'own values are kept for when the link is removed');

   app.editModule('legacy-module-1-1');
   app.set('ratedCurrent', '');
   app.save();
   assert.equal(printed().ratedCurrent, undefined);
   app.editModule('legacy-module-1-2');
   assert.deepEqual(inherited(), ['L2 (via installatieautomaat)', 'Niet ingesteld (via installatieautomaat)']);
   app.set('protection', '');
   assert.equal(app.field('phase-L3').checked, true, 'without a link the own phases are back');
   assert.equal(app.field('ratedCurrent').value, '25');
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
   assert.equal(app.pdfCalls[0][4], null);
   app.setQrEnabled(true);
   app.nodes.get('download-pdf').listeners.click();
   assert.equal(app.pdfCalls[1][4], 'qr');
   assert.equal(app.nodes.get('qr-status').hidden, true);

   const share = app.shareContext.GroepenkaartShare;
   const link = share.url('https://example.test/app/?x=1#old', app.schema.normalize(JSON.parse(app.storage())));
   assert.match(link, /^https:\/\/example\.test\/app\/\?x=1#c2=[0-9A-Z$*+-]+$/);
   const decoded = share.decode(new URL(link).hash);
   assert.deepEqual(plain(semanticV5(app.schema.normalize(decoded))), plain(semanticV5(JSON.parse(app.storage()))));
});

test('free slots become empty rows in the PDF data without being stored', () => {
   const app = setupApp(JSON.stringify(withRcds));
   app.nodes.get('download-pdf').listeners.click();
   const box = app.pdfCalls[0][0][0];
   assert.ok(box.rows.length > box.groups.length);
   assert.deepEqual(box.rows.filter(Boolean), box.groups, 'modules keep their order');
   assert.ok(!('rows' in JSON.parse(app.storage()).boxes[0]));
});

test('expert mode is off by default, shows the technical fields per device and keeps their values when hidden', () => {
   const app = setupApp(JSON.stringify(withRcds));
   const technical = () => app.findAll(app.dialog(), (node) => node.className === 'module-technical-controls');
   assert.equal(app.nodes.get('expert-mode').checked, false);
   app.editModule('r1');
   assert.equal(technical().length, 0);
   app.cancel();

   app.setExpertMode(true);
   assert.equal(app.expertModeStorage(), 'true');
   app.editModule('r1');
   assert.equal(technical().length, 1);
   app.set('sensitivity', '30');
   app.save();
   app.editModule('legacy-module-1-1');
   assert.equal(app.field('sensitivity'), undefined, 'only RCDs have a sensitivity');
   assert.equal(app.field('rcdType'), undefined, 'only RCDs have an RCD type');
   app.set('ratedCurrent', '16');
   app.save();

   app.setExpertMode(false);
   app.editModule('r1');
   assert.equal(technical().length, 0);
   app.save();
   const stored = JSON.parse(app.storage());
   assert.ok(!('expertMode' in stored));
   assert.equal(stored.modules.find((module) => module.id === 'r1').sensitivity, 30);
   assert.ok(stored.modules.some((module) => module.ratedCurrent === 16));

   const reloaded = setupApp(app.storage(), '', true, null, 'true');
   assert.equal(reloaded.nodes.get('expert-mode').checked, true);
   reloaded.editModule('legacy-module-1-1');
   assert.equal(reloaded.findAll(reloaded.dialog(), (node) => node.className === 'module-technical-controls').length, 1);
});

test('expert mode is off by default, shows the technical fields per device and keeps their values when hidden', () => {
   const app = setupApp(JSON.stringify(withRcds));
   const technical = () => app.findAll(app.dialog(), (node) => node.className === 'module-technical-controls');
   assert.equal(app.nodes.get('expert-mode').checked, false);
   app.editModule('r1');
   assert.equal(technical().length, 0);
   app.cancel();

   app.setExpertMode(true);
   assert.equal(app.expertModeStorage(), 'true');
   app.editModule('r1');
   assert.equal(technical().length, 1);
   app.set('sensitivity', '30');
   app.save();
   app.editModule('legacy-module-1-1');
   assert.equal(app.field('sensitivity'), undefined, 'only RCDs have a sensitivity');
   app.set('rcdType', 'A');
   app.set('ratedCurrent', '16');
   app.save();

   app.setExpertMode(false);
   app.editModule('r1');
   assert.equal(technical().length, 0);
   app.save();
   const stored = JSON.parse(app.storage());
   assert.ok(!('expertMode' in stored));
   assert.equal(stored.modules.find((module) => module.id === 'r1').sensitivity, 30);
   assert.ok(stored.modules.some((module) => module.rcdType === 'A' && module.ratedCurrent === 16));

   const reloaded = setupApp(app.storage(), '', true, null, null, 'true');
   assert.equal(reloaded.nodes.get('expert-mode').checked, true);
   reloaded.editModule('legacy-module-1-1');
   assert.equal(reloaded.findAll(reloaded.dialog(), (node) => node.className === 'module-technical-controls').length, 1);
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
   assert.equal(app.pdfCalls[0][4], null);
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
   const name = app.byLabel('Naam kast');
   let seed = 7;
   name.value = Array.from({ length: 6000 }, () => (seed = (seed * 48271) % 2147483647).toString(36)[0]).join('');
   name.listeners.input();
   name.listeners.input();
   assert.equal(app.timers.length, 1, 'repeated typing keeps a single pending check');
   assert.equal(status.hidden, true);
   app.timers[0]();
   assert.equal(status.hidden, false);
   name.value = 'kort';
   name.listeners.input();
   app.timers[0]();
   assert.equal(status.hidden, true);
});


test('adding a box asks for its size and draws a + for every empty slot', () => {
   const app = setupApp();
   const dialog = app.nodes.get('box-dialog');
   const field = (name) => app.findAll(dialog, (n) => n.attrs['data-field'] === name)[0];
   const submit = () => app.findAll(dialog, (n) => n.tag === 'form')[0].listeners.submit({ preventDefault() { } });
   app.nodes.get('add-box').listeners.click();
   assert.equal(dialog.open, true);
   app.findAll(dialog, (n) => n.textContent === 'Annuleren')[0].listeners.click();
   assert.equal(dialog.open, false);
   assert.equal(app.nodes.get('boxes').children.length, 0);

   app.nodes.get('add-box').listeners.click();
   assert.deepEqual([field('rails').value, field('railWidth').value], ['2', '12']);
   const presets = app.findAll(dialog, (n) => typeof n.className === 'string' && n.className.startsWith('btn box-preset'));
   assert.deepEqual(presets.map((preset) => preset.textContent), ['1 × 12', '2 × 12', '3 × 12', '4 × 12']);
   field('rails').value = '0';
   submit();
   assert.match(app.messages.at(-1), /aantal rails.*1 tot 99/);
   assert.equal(dialog.open, true);
   field('railWidth').value = '60';
   presets[2].listeners.click();
   assert.deepEqual([field('rails').value, field('railWidth').value], ['3', '12']);
   submit();
   assert.equal(dialog.open, false);
   const box = JSON.parse(app.storage()).boxes[0];
   assert.deepEqual([box.number, box.rails, box.railWidth, box.moduleIds], ['1', 3, 12, []]);
   const slots = app.findAll(app.nodes.get('boxes'), (n) => n.className === 'din-slot');
   assert.equal(slots.length, 36);
   assert.deepEqual([slots[0].textContent, slots[0].attrs.style], ['+', 'grid-column: 1 / span 1']);
   assert.ok(app.slot(3, 12));
   assert.equal(app.nodes.get('empty-state').hidden, true);

   app.addBox(1, 18);
   assert.deepEqual(JSON.parse(app.storage()).boxes.map((entry) => [entry.number, entry.rails, entry.railWidth]), [['1', 3, 12], ['2', 1, 18]]);
});

test('the box size can grow, but shrinking is refused while modules would fall outside', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   const resize = (label, value) => { const input = app.byLabel(label); input.value = value; input.listeners.change(); return input; };
   resize('Rails kast 1', '2');
   app.openSlot(2, 6);
   app.save();
   assert.deepEqual(JSON.parse(app.storage()).boxes[0].moduleIds.at(-1), JSON.parse(app.storage()).modules.at(-1).id);
   let input = resize('Rails kast 1', '1');
   assert.match(app.messages.at(-1), /kan niet zo klein worden: module 3 past dan niet meer/);
   assert.equal(input.value, '2', 'the field shows the kept size again');
   input = resize('Modules per rail kast 1', '5');
   assert.match(app.messages.at(-1), /module 3 past/);
   input = resize('Modules per rail kast 1', '3');
   assert.match(app.messages.at(-1), /modules per rail.*4 tot 48/);
   assert.equal(input.value, '12');
   resize('Modules per rail kast 1', '6');
   resize('Rails kast 1', '4');
   assert.deepEqual(JSON.parse(app.storage()).boxes[0].rails, 4);
   assert.equal(JSON.parse(app.storage()).boxes[0].railWidth, 6);
   assert.equal(app.findAll(app.nodes.get('boxes').children[0], (n) => n.className === 'din-slot').length, 4 * 6 - 3);
});

test('a selected module moves left and right, swaps with neighbours and wraps between rails', () => {
   const app = setupApp(JSON.stringify(noWarnings));
   const resize = (label, value) => { const input = app.byLabel(label); input.value = value; input.listeners.change(); };
   resize('Modules per rail kast 1', '4');
   resize('Rails kast 1', '2');
   const id = 'legacy-module-1-1';
   assert.ok(app.findAll(app.nodes.get('boxes'), (n) => n.className === 'panel-hint').length);
   app.selectModule(id);
   assert.equal(app.moduleButton(id).attrs['aria-pressed'], 'true');
   assert.match(app.moduleButton(id).className, /is-selected/);
   assert.equal(app.action('Naar links').attrs.disabled, 'disabled');
   app.action('Naar rechts').listeners.click();
   assert.deepEqual([app.position(id), app.position('legacy-module-1-2')], [[1, 2], [1, 1]], 'swaps with the neighbour');
   assert.deepEqual(app.moduleIds(), ['legacy-module-1-2', id]);
   assert.equal(app.moduleButton(id).attrs['aria-pressed'], 'true', 'the module stays selected');
   app.action('Naar rechts').listeners.click();
   app.action('Naar rechts').listeners.click();
   assert.deepEqual(app.position(id), [1, 4]);
   app.action('Naar rechts').listeners.click();
   assert.deepEqual(app.position(id), [2, 1], 'wraps to the start of the next rail');
   const printed = () => app.findAll(app.nodes.get('print-area'), (n) => n.tag === 'tbody')[0].children.map((row) => row.children[0].textContent);
   assert.deepEqual(printed(), ['2', '1'], 'print follows the physical order');
   app.moduleButton(id).listeners.keydown({ key: 'ArrowLeft', preventDefault() { } });
   assert.deepEqual(app.position(id), [1, 4], 'arrow keys move the module too');
   app.moduleButton(id).listeners.keydown({ key: 'Escape', preventDefault() { } });
   assert.equal(app.moduleButton(id).attrs['aria-pressed'], 'false');
   app.selectModule(id);
   app.action('Selectie opheffen').listeners.click();
   assert.equal(app.action('Naar rechts'), undefined);
   app.moduleButton(id).listeners.click();
   app.moduleButton(id).listeners.click();
   assert.equal(app.dialog().open, true, 'clicking a selected module opens the dialog');
   assert.match(app.findAll(app.dialog(), (n) => n.className === 'dialog-subtitle')[0].textContent, /Kast 1 · rail 1 · plek 4/);
   app.cancel();
   app.confirm(false);
   app.moduleButton(id).listeners.keydown({ key: 'Delete', preventDefault() { } });
   assert.match(app.confirms.at(-1), /Module 1 verwijderen\?/);
   assert.equal(JSON.parse(app.storage()).modules.length, 2);
   app.confirm(true);
   app.action('Module verwijderen').listeners.click();
   assert.deepEqual(app.moduleIds(), ['legacy-module-1-2']);
   assert.equal(app.slot(1, 4).textContent, '+');
});

test('modules without a place are listed and can be placed on an empty slot where they fit', () => {
   const app = setupApp(JSON.stringify(withRcds));
   const listed = () => app.nodes.get('unplaced-list').children.map((item) => item.attrs['data-module-id']);
   const choices = () => app.findAll(app.dialog(), (n) => n.className === 'btn unplaced-choice');
   assert.equal(app.nodes.get('unplaced').hidden, false);
   assert.deepEqual(listed(), ['r1', 'r2']);
   app.openSlot(1, 12);
   assert.equal(choices().length, 0, 'a 2-wide RCD does not fit on the last slot');
   app.cancel();
   app.openSlot(1, 3);
   assert.equal(choices().length, 2);
   choices()[0].listeners.click();
   assert.equal(app.dialog().open, false);
   const r1 = JSON.parse(app.storage()).modules.find((module) => module.id === 'r1');
   assert.deepEqual([r1.boxId, r1.rail, r1.slot], [JSON.parse(app.storage()).boxes[0].id, 1, 3]);
   assert.deepEqual(listed(), ['r2']);
   assert.equal(app.moduleButton('r1').attrs.style, 'grid-column: 3 / span 2');
   assert.deepEqual(app.printCells().map((cell) => cell.textContent), ['A1 · 1', 'A1', 'A1 · 1', 'A2 · 2']);

   app.setRcdEnabled(false);
   const stored = JSON.parse(app.storage());
   assert.deepEqual(stored.modules.filter((module) => module.id.startsWith('r')).map((module) => [module.id, module.type, module.rail, module.slot]),
      [['r1', 'MCB', 1, 3]], 'a placed RCD keeps its place as a circuit breaker; one without a place is removed');
   assert.ok(!('color' in stored.modules.find((module) => module.id === 'r1')));
   assert.equal(app.nodes.get('unplaced').hidden, true);
});

test('removing a box removes its modules, unlinks modules elsewhere and clears supplies fed from it', () => {
   const { schema } = setupSchema();
   const data = plain(schema.normalize(withRcds));
   Object.assign(data.modules.find((module) => module.id === 'r1'), { boxId: data.boxes[0].id, rail: 1, slot: 3 });
   data.boxes[0].moduleIds.push('r1');
   data.boxes[1].supply = { type: 'subdistribution', sourceModuleId: 'legacy-module-1-1' };
   const app = setupApp(JSON.stringify(data));
   app.confirm(false);
   app.byLabel('Kast verwijderen').listeners.click();
   assert.match(app.confirms.at(-1),
      /Kast "Meterkast" verwijderen\? 3 modules worden verwijderd; 1 module in een andere kast wordt ontkoppeld; 1 voeding\(en\) verliezen de bronmodule\./);
   assert.equal(JSON.parse(app.storage()).boxes.length, 2);
   app.confirm(true);
   app.byLabel('Kast verwijderen').listeners.click();
   const stored = JSON.parse(app.storage());
   assert.deepEqual(stored.boxes.map((box) => box.name), ['Garage']);
   assert.deepEqual(stored.modules.map((module) => [module.id, module.protectedByModuleId]),
      [['legacy-module-2-1', null], ['legacy-module-2-2', 'r2'], ['r2', null]]);
   assert.equal(stored.boxes[0].supply.sourceModuleId, null);
});
