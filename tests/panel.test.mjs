import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { jsPDF } from 'jspdf';

const sources = await Promise.all(['rcd', 'panel'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));
const window = {};
const context = vm.createContext({ window });
sources.forEach((source) => vm.runInContext(source, context));
const panel = window.GroepenkaartPanel;
const plain = (value) => JSON.parse(JSON.stringify(value));

const item = (id, rail, slot, width, extra = {}) => ({
   id, rail, slot, width, number: id.toUpperCase(), type: width > 1 ? 'MCB-2P' : 'MCB', description: `Groep ${id}`,
   color: null, protective: false, badges: [], ...extra
});

function node(tag) {
   return {
      tag, attrs: {}, children: [], className: '', textContent: '',
      setAttribute(key, value) { this.attrs[key] = value; },
      addEventListener() { },
      appendChild(child) { this.children.push(child); }
   };
}

function el(tag, attrs, children) {
   const created = node(tag);
   Object.entries(attrs || {}).forEach(([key, value]) => {
      if (key === 'text') created.textContent = value;
      else if (key === 'className') created.className = value;
      else created.attrs[key] = value;
   });
   (children || []).forEach((child) => { if (child) created.appendChild(child); });
   return created;
}

const findAll = (root, predicate, found = []) => {
   if (predicate(root)) found.push(root);
   root.children.forEach((child) => findAll(child, predicate, found));
   return found;
};

test('the model lists the modules and free slots of every rail in order', () => {
   const result = panel.model({ rails: 2, railWidth: 4 }, [item('a', 1, 1, 2), item('b', 2, 4, 1)]);
   assert.equal(result.railWidth, 4);
   assert.deepEqual(plain(result.rails.map((rail) => rail.cells.map((cell) => [cell.slot, cell.width, cell.item && cell.item.id]))), [
      [[1, 2, 'a'], [3, 1, null], [4, 1, null]],
      [[1, 1, null], [2, 1, null], [3, 1, null], [4, 1, 'b']]
   ]);
});

test('the static panel renders modules without controls or plusses, the interactive one with them', () => {
   const result = panel.model({ rails: 1, railWidth: 3 }, [item('a', 1, 1, 2, { color: '#ff0000', badges: [{ text: 'PV' }, { text: 'RM', special: true }] })]);
   const staticPanel = panel.render(el, result);
   assert.equal(findAll(staticPanel, (n) => n.tag === 'button').length, 0);
   assert.deepEqual(findAll(staticPanel, (n) => n.className === 'din-slot').map((n) => [n.tag, n.textContent]), [['div', '']]);
   const [module] = findAll(staticPanel, (n) => n.attrs['data-module-id'] === 'a');
   assert.equal(module.className, 'din-module is-wide');
   assert.equal(module.attrs.style, 'grid-column: 1 / span 2');
   assert.deepEqual(findAll(module, (n) => n.className.startsWith('din-module-badge')).map((n) => [n.className, n.textContent]),
      [['din-module-badge', 'PV'], ['din-module-badge special-installation-badge', 'RM']]);
   assert.equal(findAll(module, (n) => n.className === 'din-module-type')[0].textContent, 'MCB-2P');

   const clicks = [];
   const interactive = panel.render(el, result, {
      selectedId: 'a',
      moduleAttrs: (moduleItem, selected) => ({ 'aria-pressed': String(selected), title: moduleItem.id }),
      slotAttrs: (rail, slot) => ({ title: `${rail}-${slot}` })
   });
   const [button] = findAll(interactive, (n) => n.attrs['data-module-id'] === 'a');
   assert.deepEqual([button.tag, button.attrs.type, button.attrs['aria-pressed'], button.className], ['button', 'button', 'true', 'din-module is-selected is-wide']);
   const [slot] = findAll(interactive, (n) => n.className === 'din-slot');
   assert.deepEqual([slot.tag, slot.textContent, slot.attrs.title], ['button', '+', '1-3']);
   assert.deepEqual(clicks, []);
});

test('fit scales a panel to the available space and never above the maximum scale', () => {
   const wide = panel.model({ rails: 1, railWidth: 12 }, []);
   const natural = panel.size(wide);
   assert.ok(natural.width > 700 && natural.width < 800);
   assert.equal(panel.fit(wide, 1000, 1000).scale, 0.25);
   const narrow = panel.fit(wide, 100, 1000);
   assert.ok(Math.abs(narrow.width - 100) < 1e-9);
   assert.ok(panel.fit(wide, 1000, 20).height <= 20 + 1e-9);
   const tall = panel.model({ rails: 4, railWidth: 12 }, []);
   assert.ok(panel.size(tall).height > panel.size(wide).height * 3);
});

test('draw writes the numbers, types and labels of the modules but no plusses', () => {
   const doc = new jsPDF({ unit: 'mm', format: 'a4' });
   const texts = [];
   const text = doc.text;
   doc.text = function (value) { texts.push(Array.isArray(value) ? value.join(' ') : String(value)); return text.apply(doc, arguments); };
   const items = [
      item('a', 1, 1, 2, { color: '#ff0000', protective: true, badges: [{ text: 'PV' }, { text: 'RM', special: true }] }),
      item('b', 1, 3, 1, { description: 'x'.repeat(200) })
   ];
   const result = panel.model({ rails: 1, railWidth: 4 }, items);
   const fit = panel.fit(result, 180, 200);
   panel.draw(doc, result, 15, 20, fit.scale);
   assert.ok(['A', 'MCB-2P', 'Groep a', 'PV', 'RM', 'B'].every((value) => texts.includes(value)), texts.join('|'));
   assert.ok(!texts.includes('+'));
   const label = texts.find((value) => value.startsWith('xx'));
   assert.ok(label.endsWith('...') && label.length < 200, 'a long label is shortened');
});
