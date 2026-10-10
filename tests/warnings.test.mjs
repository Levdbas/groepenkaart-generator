import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';

applyPlugin(jsPDF);
const sources = await Promise.all(['warnings', 'rcbo', 'pdf'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));

function setup() {
   let document;
   const window = {
      jspdf: {
         jsPDF: function (options) {
            document = new jsPDF(options);
            document.save = (filename) => { document.savedFilename = filename; };
            return document;
         }
      }
   };
   const context = vm.createContext({ window });
   sources.forEach((source) => vm.runInContext(source, context));
   return { window, warnings: window.GroepenkaartWarnings, pdf: window.GroepenkaartPdf, document: () => document };
}

const ids = ['pv', 'ev', 'battery', 'heat-pump'];
const displayedIds = ['pv', 'battery', 'heat-pump'];
function box(number = '1', count = 1) {
   return {
      number, name: `Meterkast ${number}`,
      groups: Array.from({ length: count }, (_, index) => ({
         number: String(index + 1), name: `Group-${number}-${index + 1}`, description: 'Lighting and sockets'
      }))
   };
}

function pageText(document, number) {
   return document.internal.pages[number].join('\n');
}

test('older files default to no warnings', () => {
   const { warnings } = setup();
   assert.deepEqual(Array.from(warnings.normalize(undefined)), []);
   assert.deepEqual(Array.from(warnings.normalize([])), []);
});

test('normalization validates codes and gives unique, stable display order', () => {
   const { warnings } = setup();
   assert.deepEqual(Array.from(warnings.normalize(['heat-pump', 'pv', 'pv'])), ['pv', 'heat-pump']);
   assert.deepEqual(Array.from(warnings.normalize(ids)), ids);
   assert.deepEqual(Array.from(warnings.selected(['ev'])), []);
   assert.deepEqual(Array.from(warnings.definitions, (warning) => warning.id), displayedIds);
   for (const value of [null, true, 'pv', {}, ['unknown'], ['pv', 1], [null]]) {
      assert.throws(() => warnings.normalize(value), /warnings/);
   }
});

test('each installation can be selected independently and deselected', () => {
   const { warnings } = setup();
   for (const id of displayedIds) {
      assert.deepEqual(Array.from(warnings.selected([id]), (warning) => warning.id), [id]);
   }
   assert.equal(warnings.selected([]).length, 0);
   assert.equal(warnings.selected(ids).length, 3);
});

test('JSON round-trip preserves selections', () => {
   const { warnings } = setup();
   const data = JSON.parse(JSON.stringify({ boxes: [box()], warnings: ids }));
   assert.deepEqual(Array.from(warnings.normalize(data.warnings)), ids);
});

test('all warning labels and text fit inside the 42 mm cards', () => {
   const { warnings } = setup();
   const document = new jsPDF({ unit: 'mm', format: 'a4' });
   document.setFont('helvetica', 'bold');
   document.setFontSize(7.4);
   for (const warning of warnings.definitions) {
      for (const line of warning.heading) {
         assert.ok(document.getTextWidth(line) <= 36, `${line} must fit within the card padding`);
      }
   }
   document.setFont('helvetica', 'normal');
   for (const warning of warnings.definitions) {
      const message = warning.message || warnings.message;
      const fontSize = warning.message ? 5.8 : 6.8;
      document.setFontSize(fontSize);
      const lines = document.splitTextToSize(message.toUpperCase(), 36);
      assert.ok(lines.length * fontSize * 1.2 / document.internal.scaleFactor < 9,
         `${warning.id} warning text must fit above the pictogram`);
      for (const line of lines) assert.ok(document.getTextWidth(line) <= 36);
   }
});

test('PDF without warnings retains the original table position and 15 rows', () => {
   const harness = setup();
   assert.equal(harness.pdf.download([box()], 15), true);
   const document = harness.document();
   assert.equal(document.getNumberOfPages(), 1);
   assert.equal(document.lastAutoTable.settings.startY, 46);
   assert.equal(document.lastAutoTable.body.length, 15);
   assert.equal(document.savedFilename, 'groepenkaart.pdf');
   assert.ok(!pageText(document, 1).includes('LET OP!'));
});

test('warning cards fit below the print date and above the standard table on A4', () => {
   for (const selected of [['pv'], ids]) {
      const harness = setup();
      harness.pdf.download([box()], 15, selected);
      const document = harness.document();
      const text = pageText(document, 1);
      assert.equal(document.getNumberOfPages(), 1);
      assert.equal((text.match(/LET OP!/g) || []).length, selected.filter((id) => id !== 'ev').length);
      assert.ok(text.indexOf('LET OP!') > text.indexOf('Groepenindeling'));
      assert.ok(text.indexOf('Afgedrukt op') < text.indexOf('LET OP!'));
      assert.equal(document.lastAutoTable.settings.startY, 93);
      assert.ok(document.lastAutoTable.finalY < 282, '15 rows must fit within the bottom margin');
      assert.ok(text.includes('GEVAARLIJKE DC-SPANNING'));
      if (selected.includes('heat-pump')) {
         assert.ok(text.includes('OMVORMER:'));
         assert.ok(text.includes('CONDENSATOREN'));
         assert.ok(text.includes('SPANNING HOUDEN.'));
      }
      assert.ok(!text.includes('EV-LADER'));
      assert.ok(text.includes('Group-1-1'));
      assert.ok(document.output().startsWith('%PDF-'));
   }
});

test('warnings appear only on the first page with multiple kasten', () => {
   const harness = setup();
   harness.pdf.download([box('1'), box('2')], 15, ids);
   const document = harness.document();
   assert.equal(document.getNumberOfPages(), 2);
   assert.equal((pageText(document, 1).match(/LET OP!/g) || []).length, 3);
   assert.ok(!pageText(document, 2).includes('LET OP!'));
   assert.ok(pageText(document, 2).includes('Group-2-1'));
   assert.equal(document.lastAutoTable.settings.startY, 46);
});

test('overflow pages preserve all groups without repeating warning cards', () => {
   const harness = setup();
   harness.pdf.download([box('1', 65), box('2')], 15, ids);
   const document = harness.document();
   assert.ok(document.getNumberOfPages() > 2);
   let allText = '';
   for (let page = 1; page <= document.getNumberOfPages(); page++) {
      const text = pageText(document, page);
      allText += text;
      if (page > 1) assert.ok(!text.includes('LET OP!'));
   }
   for (let group = 1; group <= 65; group++) {
      assert.ok(allText.includes(`(Group-1-${group})`), `Group ${group} should be preserved`);
   }
   assert.ok(allText.includes('Group-2-1'));
});

test('missing PDF dependencies still trigger the existing print fallback', () => {
   const harness = setup();
   delete harness.window.jspdf;
   assert.equal(harness.pdf.download([box()], 15, ids), false);
   harness.window.jspdf = { jsPDF: function () { return {}; } };
   assert.equal(harness.pdf.download([box()], 15, ids), false);
});

const rcbos = [
   { id: 'r1', number: 'A1', name: 'Keuken en badkamer', color: '#003f7d' },
   { id: 'r2', number: '', name: '', color: '#fdd835' },
   { id: 'r3', number: 'A3', name: 'Ongebruikt', color: '#43a047' }
];
function linkedBox(number = '1', links = ['r1', null, 'r2']) {
   const result = box(number, links.length);
   result.groups.forEach((group, index) => { group.rcboId = links[index]; });
   return result;
}

test('linked groups get a colored group-number cell with the RCBO code and readable text', () => {
   const harness = setup();
   assert.equal(harness.pdf.download([linkedBox()], 15, [], rcbos), true);
   const document = harness.document();
   const cells = document.lastAutoTable.body.map((row) => row.cells[0]);
   assert.equal(cells[0].text.join(' '), '1 · A1');
   assert.deepEqual(Array.from(cells[0].styles.fillColor), [0, 63, 125]);
   assert.deepEqual(Array.from(cells[0].styles.textColor), [255, 255, 255]);
   assert.equal(cells[1].text.join(' '), '2');
   assert.ok(!Array.isArray(cells[1].styles.fillColor), 'unlinked groups keep the default fill');
   assert.equal(cells[2].text.join(' '), '3 · A2', 'empty RCBO codes fall back to their position');
   assert.deepEqual(Array.from(cells[2].styles.textColor), [0, 0, 0]);
   assert.ok(!Array.isArray(cells[3].styles.fillColor), 'padding rows stay unmarked');
   const text = pageText(document, 1);
   assert.ok(text.includes('Aardlekschakelaars:'));
   assert.ok(text.includes('(A1 \x96 Keuken en badkamer)'), 'en dash uses WinAnsi encoding');
   assert.ok(!text.includes('Ongebruikt'), 'only RCBOs used on the page appear in the key');
   assert.ok(document.lastAutoTable.settings.startY > 46);
});

test('unused RCBOs are listed below warnings once across all boxes', () => {
   const harness = setup();
   const boxes = [
      linkedBox('1', ['r1']),
      linkedBox('2', ['r2'])
   ];
   assert.equal(harness.pdf.download(boxes, 15, ['pv'], rcbos), true);
   const firstPage = pageText(harness.document(), 1);
   assert.ok(firstPage.includes('Aardlekschakelaars niet in gebruik'));
   assert.ok(firstPage.includes('(A3 \x96 Ongebruikt)'));
   assert.ok(!firstPage.includes('(A1 \x96 Keuken en badkamer)'));
   assert.ok(!firstPage.includes('(A2)'));
   assert.ok(firstPage.indexOf('Aardlekschakelaars niet in gebruik') > firstPage.indexOf('LET OP!'));
   assert.ok(!pageText(harness.document(), 2).includes('Aardlekschakelaars niet in gebruik'));
});

test('the RCBO key is per page and the table still fits with warnings and a wrapped key', () => {
   const many = Array.from({ length: 8 }, (_, i) => ({
      id: `r${i}`, number: `A${i + 1}`, name: `Aardlekschakelaar met lange naam ${i + 1}`, color: '#e53935'
   }));
   const harness = setup();
   harness.pdf.download([linkedBox('1', many.map((r) => r.id).concat(Array(7).fill(null)))], 15, ids, many);
   assert.equal(harness.document().getNumberOfPages(), 1);
   assert.ok(harness.document().lastAutoTable.finalY < 282, '15 rows must fit with warnings and a wrapped key');
   assert.ok(pageText(harness.document(), 1).includes('lange naam 8'));

   harness.pdf.download([linkedBox('1', many.map((r) => r.id)), box('2')], 15, ids, many);
   const document = harness.document();
   assert.equal(document.getNumberOfPages(), 2);
   assert.ok(!pageText(document, 2).includes('Aardlekschakelaars:'));
   assert.equal(document.lastAutoTable.settings.startY, 46);
});

test('without RCBOs the PDF output is unchanged', () => {
   const harness = setup();
   harness.pdf.download([box()], 15, [], []);
   const document = harness.document();
   assert.equal(document.lastAutoTable.settings.startY, 46);
   assert.ok(!pageText(document, 1).includes('Aardlekschakelaars'));
});
