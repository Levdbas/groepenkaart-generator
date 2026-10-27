import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const sources = await Promise.all(['warnings', 'rcd', 'schema', 'anonymize'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));

function setup() {
   const window = {};
   const context = vm.createContext({ window });
   sources.forEach((source) => vm.runInContext(source, context));
   return window.GroepenkaartAnonymize;
}

const card = () => ({
   schemaVersion: 5,
   generalInfo: 'Installateur Jan Jansen: 06-12345678',
   qrEnabled: true,
   rcdEnabled: true,
   phaseEnabled: false,
   modules: [
      { id: 'rcd', boxId: 'b1', rail: 1, slot: 1, type: 'RCD-2P', number: 'A1', name: 'Familie Jansen', color: '#e53935', description: '', characteristic: '', phases: [], protectedByModuleId: null },
      { id: 'm1', boxId: 'b1', rail: 1, slot: 3, type: 'MCB', number: '1', description: 'Slaapkamer Piet', characteristic: 'B16', phases: [], protectedByModuleId: 'rcd', items: ['Lamp 12', ''] },
      { id: 'm2', boxId: 'b2', rail: 1, slot: 1, type: 'MCB', number: '2', description: '', characteristic: 'B16', phases: [], protectedByModuleId: null }
   ],
   boxes: [
      { id: 'b1', number: '1', name: 'Meterkast Dorpsstraat 12', rails: 1, railWidth: 12, moduleIds: ['rcd', 'm1'], supply: { type: 'mains', connectionRating: 'Anders', customConnectionRating: '3x100A', supplier: 'Stedin' } },
      { id: 'b2', number: '2', name: 'Garage', rails: 1, railWidth: 12, moduleIds: ['m2'], supply: { type: 'subdistribution', sourceModuleId: 'm1', preFuse: 'gG 35A' } }
   ]
});

test('masks free text and keeps structure', () => {
   const { anonymize, mask } = setup();
   assert.equal(mask('Slaapkamer 2, Piet'), 'xxxxxxxxxx 0, xxxx');
   const { data, masked } = anonymize(card());
   const [rcd, m1, m2] = data.modules;
   assert.equal(rcd.name, 'xxxxxxx xxxxxx');
   assert.equal(m1.description, 'xxxxxxxxxx xxxx');
   assert.deepEqual(Array.from(m1.items), ['xxxx 00', '']);
   assert.equal(m2.description, '');
   assert.equal(data.generalInfo, 'xxxxxxxxxxxx xxx xxxxxx: 00-00000000');
   assert.equal(data.boxes[0].name, 'xxxxxxxxx xxxxxxxxxxx 00');
   assert.equal(data.boxes[0].supply.supplier, 'xxxxxx');
   assert.equal(data.boxes[0].supply.customConnectionRating, '0x000x');
   assert.equal(data.boxes[1].supply.preFuse, 'xx 00x');
   assert.equal(data.boxes[1].supply.sourceModuleId, 'm1');
   assert.equal(masked, 9);
   assert.equal(m1.number, '1');
   assert.equal(m1.protectedByModuleId, 'rcd');
   assert.equal(data.qrEnabled, true);
});

test('removes unknown fields and does not modify the input', () => {
   const { anonymize } = setup();
   const input = card();
   input.owner = 'Jan Jansen';
   input.modules[1].note = 'Secret';
   const before = JSON.stringify(input);
   const { data } = anonymize(input);
   assert.equal(JSON.stringify(input), before);
   assert.ok(!JSON.stringify(data).includes('Jansen'));
   assert.ok(!JSON.stringify(data).includes('Secret'));
   assert.ok(!('owner' in data));
});

test('migrates older versions and rejects invalid or newer files', () => {
   const { anonymize } = setup();
   const { data } = anonymize({
      schemaVersion: 1,
      warnings: [],
      boxes: [{ number: '1', name: 'Thuis', groups: [{ number: '1', name: 'Keuken', description: 'Oven' }] }]
   });
   assert.equal(data.schemaVersion, 6);
   assert.equal(data.boxes[0].name, 'xxxxx');
   assert.equal(data.modules[0].description, 'xxxxxx – xxxx');
   assert.throws(() => anonymize({ schemaVersion: 7 }), /nieuwere schemaversie/);
   assert.throws(() => anonymize([]), /verwacht een object/);
});
