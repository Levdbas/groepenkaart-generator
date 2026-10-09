import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';

applyPlugin(jsPDF);
const sources = await Promise.all(['warnings', 'pdf'].map((name) =>
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
   for (const value of [null, true, 'pv', {}, ['unknown'], ['pv', 1], [null]]) {
      assert.throws(() => warnings.normalize(value), /warnings/);
   }
});

test('each installation can be selected independently and deselected', () => {
   const { warnings } = setup();
   for (const id of ids) {
      assert.deepEqual(Array.from(warnings.selected([id]), (warning) => warning.id), [id]);
   }
   assert.equal(warnings.selected([]).length, 0);
   assert.equal(warnings.selected(ids).length, 4);
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
   document.setFontSize(6.8);
   const lines = document.splitTextToSize(warnings.message.toUpperCase(), 36);
   assert.ok(lines.length * 6.8 * 1.2 / document.internal.scaleFactor < 9,
      'warning text must fit above the pictogram');
   for (const line of lines) assert.ok(document.getTextWidth(line) <= 36);
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

test('one and four warning cards fit below the print date and above the standard table on A4', () => {
   for (const selected of [['pv'], ids]) {
      const harness = setup();
      harness.pdf.download([box()], 15, selected);
      const document = harness.document();
      const text = pageText(document, 1);
      assert.equal(document.getNumberOfPages(), 1);
      assert.equal((text.match(/LET OP!/g) || []).length, selected.length);
      assert.ok(text.indexOf('LET OP!') > text.indexOf('Groepenindeling'));
      assert.ok(text.indexOf('Afgedrukt op') < text.indexOf('LET OP!'));
      assert.equal(document.lastAutoTable.settings.startY, 93);
      assert.ok(document.lastAutoTable.finalY < 282, '15 rows must fit within the bottom margin');
      assert.ok(text.includes('GEVAARLIJKE DC-SPANNING'));
      assert.ok(text.includes('Group-1-1'));
      assert.ok(document.output().startsWith('%PDF-'));
   }
});

test('warnings appear only on the first page with multiple kasten', () => {
   const harness = setup();
   harness.pdf.download([box('1'), box('2')], 15, ids);
   const document = harness.document();
   assert.equal(document.getNumberOfPages(), 2);
   assert.equal((pageText(document, 1).match(/LET OP!/g) || []).length, 4);
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
