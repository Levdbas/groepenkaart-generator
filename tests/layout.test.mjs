import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/js/layout.js', import.meta.url), 'utf8');
const window = {};
vm.runInContext(source, vm.createContext({ window }));
const layout = window.GroepenkaartLayout;
const plain = (value) => JSON.parse(JSON.stringify(value));
const box = { rails: 2, railWidth: 6 };
const item = (id, rail, slot, width = 1) => ({ id, rail, slot, width });

test('fits and freeRun respect the rail bounds and other modules', () => {
   const items = [item('a', 1, 1), item('b', 1, 4, 2)];
   assert.equal(layout.fits(box, items, 1, 2, 2), true);
   assert.equal(layout.fits(box, items, 1, 2, 3), false, 'overlaps b');
   assert.equal(layout.fits(box, items, 1, 6, 1), true);
   assert.equal(layout.fits(box, items, 1, 6, 2), false, 'past the end of the rail');
   assert.equal(layout.fits(box, items, 3, 1, 1), false, 'no third rail');
   assert.equal(layout.fits(box, items, 1, 1, 1, 'a'), true, 'a module does not block itself');
   assert.equal(layout.freeRun(box, items, 1, 2), 2);
   assert.equal(layout.freeRun(box, items, 1, 4), 0);
   assert.equal(layout.freeRun(box, items, 1, 1, 'a'), 3);
   assert.equal(layout.freeRun(box, items, 2, 1), 6);
   assert.equal(layout.itemAt(items, 1, 5).id, 'b');
});

test('moving steps into a free slot or swaps with the neighbour on the same rail', () => {
   const items = [item('a', 1, 1), item('b', 1, 2, 2), item('c', 1, 5)];
   assert.deepEqual(plain(layout.move(box, items, 'a', 1)), { b: { rail: 1, slot: 1 }, a: { rail: 1, slot: 3 } });
   assert.deepEqual(plain(layout.move(box, items, 'b', 1)), { b: { rail: 1, slot: 3 } });
   assert.deepEqual(plain(layout.move(box, items, 'b', -1)), { b: { rail: 1, slot: 1 }, a: { rail: 1, slot: 3 } });
   assert.deepEqual(plain(layout.move(box, items, 'c', -1)), { c: { rail: 1, slot: 4 } });
   assert.equal(layout.move(box, items, 'a', -1), null, 'the first slot of the first rail cannot move left');
   assert.equal(layout.move(box, items, 'missing', 1), null);
});

test('moving past the end of a rail wraps to the next rail and back', () => {
   const items = [item('a', 1, 6), item('b', 2, 1, 2)];
   assert.deepEqual(plain(layout.move(box, items, 'a', 1)), { a: { rail: 2, slot: 1 }, b: { rail: 1, slot: 5 } },
      'swaps with the first module of the next rail');
   const free = [item('a', 1, 5, 2)];
   assert.deepEqual(plain(layout.move(box, free, 'a', 1)), { a: { rail: 2, slot: 1 } });
   assert.deepEqual(plain(layout.move(box, [item('a', 2, 1, 2)], 'a', -1)), { a: { rail: 1, slot: 5 } });
   assert.deepEqual(plain(layout.move(box, [item('a', 2, 1), item('b', 1, 5, 2)], 'a', -1)),
      { a: { rail: 1, slot: 6 }, b: { rail: 2, slot: 1 } }, 'swaps with the last module of the previous rail');
   assert.equal(layout.move(box, [item('a', 2, 6)], 'a', 1), null, 'the end of the last rail cannot move right');
});

test('moves that would make modules overlap are refused', () => {
   // b is wider than the room a leaves at the end of rail 1.
   assert.equal(layout.move(box, [item('x', 1, 1, 4), item('a', 1, 6), item('b', 2, 1, 3)], 'a', 1), null);
   // a fits at the start of rail 2 only if b moves, but b does not fit at the end of rail 1.
   assert.equal(layout.move(box, [item('x', 1, 1, 4), item('a', 1, 5, 2), item('b', 2, 1, 3)], 'a', 1), null);
});

test('outside lists the modules that no longer fit a smaller box, and sortByPosition orders rail by rail', () => {
   const items = [item('a', 2, 1), item('b', 1, 5, 2), item('c', 1, 1)];
   assert.deepEqual(layout.outside(items, 2, 6), []);
   assert.deepEqual(layout.outside(items, 1, 6).map((entry) => entry.id), ['a']);
   assert.deepEqual(layout.outside(items, 2, 5).map((entry) => entry.id), ['b']);
   assert.deepEqual(layout.sortByPosition(items).map((entry) => entry.id), ['c', 'b', 'a']);
   assert.deepEqual(items.map((entry) => entry.id), ['a', 'b', 'c'], 'the input is not changed');
});
