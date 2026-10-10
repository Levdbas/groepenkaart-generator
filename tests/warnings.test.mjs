import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';

applyPlugin(jsPDF);
const sources = await Promise.all(['warnings', 'rcd', 'pdf'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));

function setup() {
   let document;
   const lines = [];
   const window = {
      jspdf: {
         jsPDF: function (options) {
            document = new jsPDF(options);
            const line = document.line;
            document.line = function (x1, y1, x2, y2) {
               lines.push({ x1, y1, x2, y2, color: document.getDrawColor(), width: document.getLineWidth() });
               return line.call(document, x1, y1, x2, y2);
            };
            document.save = (filename) => { document.savedFilename = filename; };
            return document;
         }
      }
   };
   const context = vm.createContext({ window });
   sources.forEach((source) => vm.runInContext(source, context));
   return { window, warnings: window.GroepenkaartWarnings, pdf: window.GroepenkaartPdf, lines, document: () => document };
}

const ids = ['pv', 'ev', 'battery', 'heat-pump'];
const displayedIds = ['pv', 'battery', 'heat-pump'];
function box(number = '1', count = 1) {
   return {
      number, name: `Meterkast ${number}`,
      groups: Array.from({ length: count }, (_, index) => ({
         number: String(index + 1), description: `Group-${number}-${index + 1}`
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

test('PDF shows effective phases, pole counts and unassigned selections only when enabled', () => {
   const harness = setup();
   const rcds = [
      { id: 'two', number: 'A1', name: 'Keuken', color: '#ed8c01', amountOfPoles: 2, phases: ['L2'] },
      { id: 'four', number: 'A2', name: 'Garage', color: '#009fe3', amountOfPoles: 4, phases: ['L1', 'L2', 'L3'] },
      { id: 'unused', number: 'A3', name: 'Reserve', color: '#95be1a', amountOfPoles: 2, phases: [] }
   ];
   const data = box('1', 5);
   data.groups[0] = { ...data.groups[0], rcdId: 'two', phases: ['L3'] };
   data.groups[1] = { ...data.groups[1], rcdId: 'four', phases: ['L1', 'L3'] };
   data.groups[2] = { ...data.groups[2], rcdId: null, phases: ['L1', 'L2', 'L3'] };
   data.groups[3] = { ...data.groups[3], rcdId: 'four', phases: [] };
   data.groups[4] = { ...data.groups[4], rcdId: null, phases: ['L2'] };
   assert.equal(harness.pdf.download([data], 15, [], rcds, true), true);
   const document = harness.document();
   const table = document.lastAutoTable;
   assert.equal(table.columns.length, 3);
   assert.deepEqual(table.head[0].cells[2].text, ['Fasen']);
   assert.deepEqual(table.head[0].cells[1].text, ['Omschrijving']);
   assert.deepEqual(table.body.slice(0, 5).map((row) => row.cells[2].text.join(' ')),
      ['L2', 'L1, L3', 'L1, L2, L3', 'Niet gekozen', 'L2']);
   assert.equal(table.body.length, 15);
   assert.deepEqual(table.body[5].cells[2].text, ['']);
   assert.deepEqual(Array.from(table.body[0].cells[0].styles.fillColor), [237, 140, 1]);
   assert.ok(pageText(document, 1).includes('2P; L2'));
   assert.ok(pageText(document, 1).includes('4P; L1, L2, L3'));
   assert.ok(pageText(document, 1).includes('2P; Niet gekozen'));
   assert.ok(document.output().startsWith('%PDF-'));
   const borders = harness.lines.filter((line) => line.width === 1);
   const expected = [['#000000'], ['#8b4513', '#808080'], ['#8b4513', '#000000', '#808080'], [], ['#000000']];
   assert.equal(borders.length, 7, 'only assigned group phases have colored borders');
   let offset = 0;
   expected.forEach((colors, index) => {
      const cell = table.body[index].cells[2];
      colors.forEach((color, segment) => {
         const border = borders[offset++];
         const width = (cell.width - 4) / colors.length;
         assert.equal(border.color, color);
         assert.ok(Math.abs(border.x1 - (cell.x + 2 + segment * width)) < 0.001);
         assert.ok(Math.abs(border.x2 - border.x1 - width) < 0.001);
         assert.equal(border.y1, border.y2);
         assert.ok(Math.abs(border.y1 - (cell.y + cell.height - 1.5)) < 0.001);
      });
   });
   harness.lines.length = 0;
   harness.pdf.download([data], 15, [], rcds, false);
   assert.equal(harness.document().lastAutoTable.columns.length, 2);
   assert.ok(!pageText(harness.document(), 1).includes('Fasen'));
   assert.ok(!pageText(harness.document(), 1).includes('2P;'));
   assert.equal(harness.lines.filter((line) => line.width === 1).length, 0);
});

test('phase borders are drawn on every fragment of a group split across PDF pages', () => {
   const harness = setup();
   const data = box();
   data.groups[0].phases = ['L1', 'L3'];
   data.groups[0].items = Array.from({ length: 90 }, (_, i) => `Connection ${i}`);
   harness.pdf.download([data], 15, [], [], true);
   assert.ok(harness.document().getNumberOfPages() > 1);
   const borders = harness.lines.filter((line) => line.width === 1);
   assert.ok(borders.length >= 4);
   for (let i = 0; i < borders.length; i += 2) {
      assert.equal(borders[i].color, '#8b4513');
      assert.equal(borders[i + 1].color, '#808080');
      assert.equal(borders[i].y1, borders[i + 1].y1);
   }
});

test('phase PDF columns and long RCD labels fit inside the page and survive overflow', () => {
   const harness = setup();
   const rcds = [{ id: 'r1', number: 'A1', name: 'Lange omschrijving '.repeat(9), color: '#ed8c01', amountOfPoles: 4 }];
   const data = box('1', 65);
   data.groups.forEach((group) => { group.rcdId = 'r1'; group.phases = ['L1', 'L2', 'L3']; });
   harness.pdf.download([data, box('2')], 15, ['pv'], rcds, true);
   const document = harness.document();
   assert.ok(document.getNumberOfPages() > 2);
   const output = Array.from({ length: document.getNumberOfPages() }, (_, i) => pageText(document, i + 1)).join('\n');
   assert.ok(output.includes('Group-1-65'));
   assert.ok(output.includes('Group-2-1'));
   assert.ok(output.includes('L1, L2, L3'));
   const table = document.lastAutoTable;
   assert.equal(table.columns.length, 3);
   assert.ok(table.columns.reduce((sum, column) => sum + column.width, 0) <= 180.01);
});

test('PDF group items render as bullets under the description and wrap within the cell', () => {
   const harness = setup();
   const data = box();
   data.groups[0].items = ['Vaatwasser', 'Stopcontacten', 'Lange aansluiting '.repeat(20)];
   harness.pdf.download([data], 15);
   const document = harness.document();
   const cell = document.lastAutoTable.body[0].cells[1];
   assert.equal(cell.text[0], data.groups[0].description);
   assert.equal(cell.text[1], '• Vaatwasser');
   assert.equal(cell.text[2], '• Stopcontacten');
   assert.ok(cell.text.length > 4, 'long items wrap');
   document.setFont('helvetica', 'normal');
   document.setFontSize(10);
   for (const line of cell.text) {
      assert.ok(document.getTextWidth(line) <= cell.width - 4 + 0.1, 'item lines stay within cell padding');
   }
   assert.equal(document.lastAutoTable.body.length, 15);
   assert.ok(document.output().startsWith('%PDF-'));
});

test('long group item lists preserve all items across PDF overflow pages', () => {
   const harness = setup();
   const data = box();
   data.groups[0].description = '';
   data.groups[0].items = Array.from({ length: 100 }, (_, i) => `Connection-${i + 1}`);
   harness.pdf.download([data], 15);
   const document = harness.document();
   assert.ok(document.getNumberOfPages() > 1);
   const text = document.internal.pages.slice(1).map((page) => page.join('\n')).join('\n');
   for (const item of data.groups[0].items) assert.ok(text.includes(item), `${item} is preserved`);
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

const rcds = [
   { id: 'r1', number: 'A1', name: 'Keuken en badkamer', color: '#003f7d' },
   { id: 'r2', number: '', name: '', color: '#fdd835' },
   { id: 'r3', number: 'A3', name: 'Ongebruikt', color: '#43a047' }
];
function linkedBox(number = '1', links = ['r1', null, 'r2']) {
   const result = box(number, links.length);
   result.groups.forEach((group, index) => { group.rcdId = links[index]; });
   return result;
}

test('linked groups get a colored group-number cell with the RCD code and readable text', () => {
   const harness = setup();
   assert.equal(harness.pdf.download([linkedBox()], 15, [], rcds), true);
   const document = harness.document();
   const cells = document.lastAutoTable.body.map((row) => row.cells[0]);
   assert.equal(cells[0].text.join(' '), '1 · A1');
   assert.deepEqual(Array.from(cells[0].styles.fillColor), [0, 63, 125]);
   assert.deepEqual(Array.from(cells[0].styles.textColor), [255, 255, 255]);
   assert.equal(cells[1].text.join(' '), '2');
   assert.ok(!Array.isArray(cells[1].styles.fillColor), 'unlinked groups keep the default fill');
   assert.equal(cells[2].text.join(' '), '3 · A2', 'empty RCD codes fall back to their position');
   assert.deepEqual(Array.from(cells[2].styles.textColor), [0, 0, 0]);
   assert.ok(!Array.isArray(cells[3].styles.fillColor), 'padding rows stay unmarked');
   const text = pageText(document, 1);
   assert.ok(text.includes('Aardlekschakelaars:'));
   assert.ok(text.includes('(A1 \x96 Keuken en badkamer)'), 'en dash uses WinAnsi encoding');
   assert.ok(text.includes('Aardlekschakelaars niet in gebruik'));
   assert.ok(text.includes('(A3 \x96 Ongebruikt)'), 'unused RCDs are listed separately from the key');
   assert.ok(document.lastAutoTable.settings.startY > 46);
});

test('unused RCDs are listed below warnings once across all boxes', () => {
   const harness = setup();
   const boxes = [
      linkedBox('1', ['r1']),
      linkedBox('2', ['r2'])
   ];
   assert.equal(harness.pdf.download(boxes, 15, ['pv'], rcds), true);
   const firstPage = pageText(harness.document(), 1);
   const unusedHeading = 'Aardlekschakelaars niet in gebruik';
   const unusedStart = firstPage.indexOf(unusedHeading);
   const unusedLabel = firstPage.indexOf('(A3 \x96 Ongebruikt)');
   const usedLabel = firstPage.indexOf('(A1 \x96 Keuken en badkamer)');
   assert.notEqual(unusedStart, -1);
   assert.notEqual(unusedLabel, -1);
   assert.ok(unusedLabel < usedLabel, 'unused RCDs appear before the used RCD key');
   assert.ok(unusedStart > firstPage.indexOf('LET OP!'));
   assert.ok(!pageText(harness.document(), 2).includes('Aardlekschakelaars niet in gebruik'));
});

test('the RCD key is per page and the table still fits with warnings and a wrapped key', () => {
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

test('without RCDs the PDF output is unchanged', () => {
   const harness = setup();
   harness.pdf.download([box()], 15, [], []);
   const document = harness.document();
   assert.equal(document.lastAutoTable.settings.startY, 46);
   assert.ok(!pageText(document, 1).includes('Aardlekschakelaars'));
});
