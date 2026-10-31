import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { jsPDF } from 'jspdf';
import { applyPlugin } from 'jspdf-autotable';

applyPlugin(jsPDF);
const sources = await Promise.all(['warnings', 'rcd', 'schema', 'pdf'].map((name) =>
   readFile(new URL(`../src/js/${name}.js`, import.meta.url), 'utf8')));

function setup() {
   let document;
   const lines = [];
   const warningCards = [];
   const warningImages = [];
   const window = {
      jspdf: {
         jsPDF: function (options) {
            document = new jsPDF(options);
            const line = document.line;
            const roundedRect = document.roundedRect;
            document.line = function (x1, y1, x2, y2) {
               lines.push({ x1, y1, x2, y2, color: document.getDrawColor(), width: document.getLineWidth() });
               return line.call(document, x1, y1, x2, y2);
            };
            document.roundedRect = function () {
               warningCards.push(Array.from(arguments));
               return roundedRect.apply(document, arguments);
            };
            document.addImage = function () {
               warningImages.push(Array.from(arguments));
               return document;
            };
            document.save = (filename) => { document.savedFilename = filename; };
            return document;
         }
      }
   };
   const context = vm.createContext({ window });
   sources.forEach((source) => vm.runInContext(source, context));
   return { window, warnings: window.GroepenkaartWarnings, pdf: window.GroepenkaartPdf, lines, warningCards, warningImages, document: () => document };
}

const ids = ['pv', 'ev', 'battery', 'heat-pump'];
const displayedIds = ['pv', 'ev', 'battery'];
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

// Rows as the app supplies them when free slots are shown: the groups followed by empty rows.
function padded(data, total = 15) {
   return { ...data, rows: data.groups.concat(Array(Math.max(0, total - data.groups.length)).fill(null)) };
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
   assert.deepEqual(Array.from(warnings.selected(['ev']), (warning) => warning.id), ['ev']);
   assert.deepEqual(Array.from(warnings.selected(['heat-pump'])), []);
   assert.deepEqual(Array.from(warnings.definitions, (warning) => warning.id), displayedIds);
   for (const value of [null, true, 'pv', {}, ['unknown'], ['pv', 1], [null]]) {
      assert.throws(() => warnings.normalize(value), /warnings/);
   }
});

test('special installations normalize independently and expose RM and AL labels', () => {
   const { warnings } = setup();
   assert.deepEqual(Array.from(warnings.normalizeSpecialInstallations(['burglar-alarm', 'smoke-alarm', 'burglar-alarm'])),
      ['smoke-alarm', 'burglar-alarm']);
   assert.deepEqual(Array.from(warnings.selectedSpecialInstallations(['burglar-alarm', 'smoke-alarm']), (item) => item.badge), ['RM', 'AL']);
   assert.deepEqual(Array.from(warnings.specialInstallationDefinitions, (item) => item.label), ['Rookmelders', 'Alarminstallatie']);
   for (const value of [null, true, 'smoke-alarm', {}, ['unknown'], ['smoke-alarm', 1]]) {
      assert.throws(() => warnings.normalizeSpecialInstallations(value), /specialInstallations/);
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

test('warnings use the supplied icon assets without warning copy', () => {
   const { warnings } = setup();
   assert.deepEqual(Array.from(warnings.definitions, (warning) => warning.image), [
      'images/pv.svg', 'images/ev.svg', 'images/eos.svg'
   ]);
   assert.ok(warnings.definitions.every((warning) => !('heading' in warning) && !('message' in warning) && !('icon' in warning)));
});

test('PDF streams are compressed so rasterized warning icons stay small', () => {
   const harness = setup();
   const create = harness.window.jspdf.jsPDF;
   let options;
   harness.window.jspdf.jsPDF = function (value) {
      options = value;
      return create(value);
   };
   assert.equal(harness.pdf.download([box()]), true);
   assert.equal(options.compress, true);
});

test('PDF only draws empty rows for the free slots the app supplies', () => {
   const harness = setup();
   assert.equal(harness.pdf.download([box('1', 3)]), true);
   assert.equal(harness.document().lastAutoTable.body.length, 3);
   assert.equal(harness.pdf.download([padded(box('1', 3), 5)]), true);
   const body = harness.document().lastAutoTable.body;
   assert.equal(body.length, 5);
   assert.deepEqual(body[4].cells[1].text, ['']);
   assert.equal(harness.pdf.download([padded(box('1', 20), 15)]), true);
   assert.equal(harness.document().lastAutoTable.body.length, 20);
});

test('a MAINS module prints its poles and current without duplicating legacy supply fields', () => {
   const harness = setup();
   const data = box();
   data.supply = { type: 'mains', mainSwitchCurrent: 40, mainSwitchPoles: 4 };
   data.groups[0] = {
      id: 'main-switch', type: 'MAINS-4P', number: '0', description: '',
      ratedCurrent: 40
   };
   harness.pdf.download([data]);
   const text = pageText(harness.document(), 1);
   assert.ok(text.includes('Hoofdschakelaar 4P'));
   assert.ok(text.includes('40 A'));
   assert.equal((text.toLowerCase().match(/hoofdschakelaar/g) || []).length, 1);

   const legacyHarness = setup();
   const legacy = box();
   legacy.supply = { type: 'mains', mainSwitchCurrent: 40, mainSwitchPoles: 4 };
   legacyHarness.pdf.download([legacy]);
   const legacyText = pageText(legacyHarness.document(), 1).toLowerCase();
   assert.ok(legacyText.includes('hoofdschakelaar 4p'));
   assert.ok(legacyText.includes('40 a'), 'older cards without a MAINS module keep showing their saved values');
});

test('PDF without warnings starts the table high on the page and fits 15 rows', () => {
   const harness = setup();
   assert.equal(harness.pdf.download([padded(box())]), true);
   const document = harness.document();
   assert.equal(document.getNumberOfPages(), 1);
   assert.equal(document.lastAutoTable.settings.startY, 26.5);
   assert.equal(document.lastAutoTable.settings.margin.top, 10);
   assert.equal(document.lastAutoTable.settings.margin.bottom, 10);
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
   assert.equal(harness.pdf.download([padded(data)], [], rcds, true), true);
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
   harness.pdf.download([data], [], rcds, false);
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
   harness.pdf.download([data], [], [], true);
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
   harness.pdf.download([data, box('2')], ['pv'], rcds, true);
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

test('PDF group descriptions are bold and items are small bullets that wrap within the cell', () => {
   const harness = setup();
   const data = box();
   data.groups[0].items = ['Vaatwasser', 'Stopcontacten', 'Lange aansluiting '.repeat(20)];
   const drawn = [];
   const create = harness.window.jspdf.jsPDF;
   harness.window.jspdf.jsPDF = function (options) {
      const document = create(options);
      const text = document.text;
      document.text = function (value, ...rest) {
         drawn.push({ value, font: document.getFont().fontName + '-' + document.getFont().fontStyle, size: document.getFontSize() });
         return text.call(document, value, ...rest);
      };
      return document;
   };
   harness.pdf.download([padded(data)]);
   const document = harness.document();
   const description = drawn.find((entry) => entry.value === data.groups[0].description);
   assert.equal(description.font, 'helvetica-bold');
   assert.equal(description.size, 9);
   const items = drawn.filter((entry) => entry.size === 9 && entry.font === 'helvetica-normal');
   assert.ok(items.some((entry) => entry.value === 'Vaatwasser'));
   assert.ok(items.some((entry) => entry.value === 'Stopcontacten'));
   assert.equal(items.filter((entry) => entry.value === '\u2022').length, 3);
   const cell = document.lastAutoTable.body[0].cells[1];
   document.setFont('helvetica', 'normal');
   document.setFontSize(9);
   const wrapped = items.filter((entry) => entry.value.startsWith('Lange'));
   assert.ok(wrapped.length > 1, 'long items wrap');
   for (const entry of wrapped) assert.ok(document.getTextWidth(entry.value) <= cell.width - 4 - 2.5 + 0.1);
   assert.equal(document.lastAutoTable.body.length, 15);
   assert.ok(document.output().startsWith('%PDF-'));
});

test('a group is never split over two pages', () => {
   const harness = setup();
   const data = box('1', 40);
   data.groups.forEach((group, index) => { group.items = index % 2 ? ['A', 'B', 'C'] : ['A']; });
   harness.pdf.download([data]);
   const document = harness.document();
   assert.ok(document.getNumberOfPages() > 1);
   const table = document.lastAutoTable;
   assert.equal(table.settings.rowPageBreak, 'avoid');
   const output = Array.from({ length: document.getNumberOfPages() }, (_, i) => pageText(document, i + 1));
   for (let group = 1; group <= 40; group++) {
      const pages = output.filter((text) => text.includes(`(Group-1-${group})`));
      assert.equal(pages.length, 1, `Group ${group} appears on exactly one page`);
   }
   for (const row of table.body) {
      assert.ok(row.cells[1].y + row.height <= 297 - 10 + 0.01, 'rows stay above the bottom margin');
   }
});

test('long group item lists preserve all items across PDF overflow pages', () => {
   const harness = setup();
   const data = box();
   data.groups[0].description = '';
   data.groups[0].items = Array.from({ length: 100 }, (_, i) => `Connection-${i + 1}`);
   harness.pdf.download([data]);
   const document = harness.document();
   assert.ok(document.getNumberOfPages() > 1);
   const text = document.internal.pages.slice(1).map((page) => page.join('\n')).join('\n');
   for (const item of data.groups[0].items) assert.ok(text.includes(item), `${item} is preserved`);
});

test('warning cards retain red-bordered boxes without warning copy', () => {
   for (const selected of [['pv'], ids]) {
      const harness = setup();
      const images = Array.from({ length: 3 }, () => ({ naturalWidth: 100, naturalHeight: 100 }));
      harness.pdf.download([padded(box())], selected, [], false, null, true, images);
      const document = harness.document();
      const text = pageText(document, 1);
      assert.equal(document.getNumberOfPages(), 1);
      const displayedCount = selected.filter((id) => displayedIds.includes(id)).length;
      assert.equal(harness.warningCards.length, displayedCount);
      assert.equal(harness.warningImages.length, displayedCount);
      assert.ok(!text.includes('LET OP!'));
      assert.equal(document.lastAutoTable.settings.startY, 51.5);
      assert.ok(document.lastAutoTable.finalY < 287, '15 rows must fit within the bottom margin');
      assert.ok(text.includes('Group-1-1'));
      assert.ok(document.output().startsWith('%PDF-'));
   }
});

test('warnings appear only on the first page with multiple kasten', () => {
   const harness = setup();
   harness.pdf.download([box('1'), box('2')], ids);
   const document = harness.document();
   assert.equal(document.getNumberOfPages(), 2);
   assert.equal(harness.warningCards.length, 3);
   assert.ok(!pageText(document, 2).includes('LET OP!'));
   assert.ok(pageText(document, 2).includes('Group-2-1'));
   assert.equal(document.lastAutoTable.settings.startY, 26.5);
});

test('a sub-distribution page shows its own warnings, a linked page none, and the first page all of them', () => {
   const flagged = (number, warnings) => {
      const data = box(number);
      data.groups[0].warnings = warnings;
      return data;
   };
   const harness = setup();
   const first = { ...flagged('1', ['pv']), supply: { type: 'mains' } };
   const sub = { ...flagged('2', ['ev', 'battery']), supply: { type: 'subdistribution' } };
   const linked = { ...flagged('3', ['pv']), supply: { type: 'linked', sourceBoxId: 'x' } };
   harness.pdf.download([first, sub, linked], ['pv', 'ev', 'battery']);
   assert.equal(harness.document().getNumberOfPages(), 3);
   // Three cards on the first page, two on the sub-distribution page, none on the linked page.
   assert.equal(harness.warningCards.filter((card) => card[2] === 21).length, 5);
   assert.deepEqual(Array.from(harness.warnings.forPage(sub, 1, ['pv', 'ev', 'battery'])), ['ev', 'battery']);
   assert.deepEqual(Array.from(harness.warnings.forPage(linked, 2, ['pv'])), []);
});

test('a sub-distribution page also shows the warnings of boxes it feeds', () => {
   const harness = setup();
   const make = (number, id, supply, warnings) => ({
      number, name: '', supply, groups: [{ id, number: '1', description: 'G', ...(warnings ? { warnings } : {}) }]
   });
   const boxes = [
      make('1', 'a', { type: 'mains' }),
      make('2', 'b', { type: 'subdistribution', sourceModuleId: 'a' }, ['ev']),
      make('3', 'c', { type: 'subdistribution', sourceModuleId: 'b' }, ['pv']),
      make('4', 'd', { type: 'subdistribution', sourceModuleId: 'a' })
   ];
   const forPage = (index) => Array.from(harness.warnings.forPage(boxes[index], index, ['pv', 'ev'], boxes));
   assert.deepEqual(forPage(1), ['pv', 'ev']);
   assert.deepEqual(forPage(2), ['pv']);
   assert.deepEqual(forPage(3), [], 'a sibling box does not inherit warnings');
});

test('flagged modules get a small red badge text in their row', () => {
   const harness = setup();
   const data = box('1', 2);
   data.groups[0].warnings = ['pv', 'battery'];
   harness.pdf.download([data], ['pv', 'battery']);
   const text = pageText(harness.document(), 1);
   assert.equal((text.match(/\(EOS\) Tj/g) || []).length, 1);
   assert.equal((text.match(/\(PV\) Tj/g) || []).length, 1);
});

test('special installations produce only RM and AL group labels, not warning cards', () => {
   const harness = setup();
   const data = box();
   data.groups[0].specialInstallations = ['smoke-alarm', 'burglar-alarm'];
   harness.pdf.download([padded(data)]);
   const text = pageText(harness.document(), 1);
   assert.ok(text.includes('(RM) Tj'));
   assert.ok(text.includes('(AL) Tj'));
   assert.equal(harness.warningCards.filter((card) => card[2] === 21).length, 0);
   assert.equal(harness.warningImages.length, 0);
});

test('overflow pages preserve all groups without repeating warning cards', () => {
   const harness = setup();
   harness.pdf.download([box('1', 65), box('2')], ids);
   const document = harness.document();
   assert.ok(document.getNumberOfPages() > 2);
   let allText = '';
   for (let page = 1; page <= document.getNumberOfPages(); page++) {
      const text = pageText(document, page);
      allText += text;
      if (page > 1) assert.ok(!text.includes('LET OP!'));
   }
   assert.equal(harness.warningCards.length, 3);
   for (let group = 1; group <= 65; group++) {
      assert.ok(allText.includes(`(Group-1-${group})`), `Group ${group} should be preserved`);
   }
   assert.ok(allText.includes('Group-2-1'));
});

test('missing PDF dependencies still trigger the existing print fallback', () => {
   const harness = setup();
   delete harness.window.jspdf;
   assert.equal(harness.pdf.download([box()], ids), false);
   harness.window.jspdf = { jsPDF: function () { return {}; } };
   assert.equal(harness.pdf.download([box()], ids), false);
   assert.equal(harness.pdf.preview([box()], ids), null);
});

test('PDF preview returns the PDF as a blob without saving it', () => {
   const harness = setup();
   const blob = harness.pdf.preview([box('1', 3)]);
   assert.equal(blob.type, 'application/pdf');
   assert.ok(blob.size > 0);
   assert.equal(harness.document().savedFilename, undefined);
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
   assert.equal(harness.pdf.download([padded(linkedBox())], [], rcds), true);
   const document = harness.document();
   const cells = document.lastAutoTable.body.map((row) => row.cells[0]);
   assert.equal(cells[0].text.join(' '), 'A1 · 1');
   assert.deepEqual(Array.from(cells[0].styles.fillColor), [0, 63, 125]);
   assert.deepEqual(Array.from(cells[0].styles.textColor), [255, 255, 255]);
   assert.equal(cells[1].text.join(' '), '2');
   assert.ok(!Array.isArray(cells[1].styles.fillColor), 'unlinked groups keep the default fill');
   assert.equal(cells[2].text.join(' '), 'A2 · 3', 'empty RCD codes fall back to their position');
   assert.deepEqual(Array.from(cells[2].styles.textColor), [0, 0, 0]);
   assert.ok(!Array.isArray(cells[3].styles.fillColor), 'padding rows stay unmarked');
   const text = pageText(document, 1);
   assert.ok(text.includes('Aardlekschakelaars:'));
   assert.ok(text.includes('(A1 \x96 Keuken en badkamer)'), 'en dash uses WinAnsi encoding');
   assert.ok(text.includes('Aardlekschakelaars niet in gebruik'));
   assert.ok(text.includes('(A3 \x96 Ongebruikt)'), 'unused RCDs are listed separately from the key');
   assert.ok(document.lastAutoTable.settings.startY > 30);
});

test('unused RCDs are listed below warnings once across all boxes', () => {
   const harness = setup();
   const boxes = [
      linkedBox('1', ['r1']),
      linkedBox('2', ['r2'])
   ];
   assert.equal(harness.pdf.download(boxes, ['pv'], rcds), true);
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
   harness.pdf.download([linkedBox('1', many.map((r) => r.id).concat(Array(7).fill(null)))], ids, many);
   assert.equal(harness.document().getNumberOfPages(), 1);
   assert.ok(harness.document().lastAutoTable.finalY < 287, '15 rows must fit with warnings and a wrapped key');
   assert.ok(pageText(harness.document(), 1).includes('lange naam 8'));

   harness.pdf.download([linkedBox('1', many.map((r) => r.id)), box('2')], ids, many);
   const document = harness.document();
   assert.equal(document.getNumberOfPages(), 2);
   assert.ok(!pageText(document, 2).includes('Aardlekschakelaars:'));
   assert.equal(document.lastAutoTable.settings.startY, 26.5);
});

test('without RCDs the PDF output is unchanged', () => {
   const harness = setup();
   harness.pdf.download([box()], [], []);
   const document = harness.document();
   assert.equal(document.lastAutoTable.settings.startY, 26.5);
   assert.ok(!pageText(document, 1).includes('Aardlekschakelaars'));
});

test('general information is printed above the first box and leaves room before the table', () => {
   const harness = setup();
   harness.pdf.download([box()], [], [], false, null, true, [], 'Installateur: Test - storingen: 06-12345678');
   const document = harness.document();
   assert.ok(pageText(document, 1).includes('Algemene informatie'));
   assert.ok(pageText(document, 1).includes('Installateur: Test - storingen: 06-12345678'));
   assert.ok(document.lastAutoTable.settings.startY > 30);
});

test('PDF shows module metadata, supply details and derived feed references', () => {
   const harness = setup();
   const source = box('1');
   source.groups[0] = { ...source.groups[0], id: 'source', type: 'MCB', characteristic: 'C16', rcdId: 'r1' };
   const branch = box('2');
   branch.supply = {
      type: 'subdistribution', sourceModuleId: 'source', preFuse: 'C32', cableCores: 5,
      cableCrossSection: 6, mainSwitchCurrent: 40, mainSwitchPoles: 4
   };
   const rcds = [{
      id: 'r1', number: 'A1', name: 'Keuken', color: '#ed8c01', amountOfPoles: 2,
      phases: [], sensitivity: 30, rcdType: 'A', ratedCurrent: 40
   }];
   harness.pdf.download([source, branch], [], rcds, false);
   const document = harness.document();
   const firstPage = pageText(document, 1);
   const secondPage = pageText(document, 2);
   for (const value of ['MCB', '1 DIN-module', 'C16', 'voedt kast 2', '30 mA - type A - 40 A']) {
      assert.ok(firstPage.includes(value), `${value} appears on the source module page`);
   }
   for (const value of ['Voeding: vanuit kast 1, module 1', 'C32', '5x 6 mm2']) {
      assert.ok(secondPage.includes(value), `${value} appears on the sub-distribution page`);
   }
   assert.deepEqual(document.lastAutoTable.head[0].cells[0].text, ['Module']);
});
