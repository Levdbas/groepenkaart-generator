(function () {
   'use strict';

   const BLUE = [0, 63, 125];
   const MARGIN_X = 15;
   const MARGIN_Y = 10;
   const CELL_PADDING = 2;
   const GROUP_WIDTH = 22;
   const PHASE_WIDTH = 30;
   const DESCRIPTION_SIZE = 9;
   const ITEM_SIZE = 9;
   const ITEM_INDENT = 2.5;
   const LINE_FACTOR = 1.2;

   function today() {
      const d = new Date();
      const pad = function (n) { return String(n).padStart(2, '0'); };
      return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
   }

   function title(box) {
      return ['Kast', box.number, box.name ? '- ' + box.name : ''].filter(Boolean).join(' ');
   }

   // Draws one compact, rectangular card per selected warning and returns the vertical space they take.
   function drawWarnings(doc, ids, margin, top, images) {
      const warnings = window.GroepenkaartWarnings;
      const selected = warnings.selected(ids);
      if (!selected.length) return 0;

      const gap = 3;
      const width = (doc.internal.pageSize.getWidth() - margin * 2 - gap * 2) / 3;
      const height = 24;
      selected.forEach(function (warning, index) {
         const x = margin + index * (width + gap);
         doc.setDrawColor(180, 35, 24);
         doc.setLineWidth(0.8);
         doc.roundedRect(x, top, width, height, 2, 2);
         const image = images && images[index];
         const naturalWidth = image && (image.naturalWidth || image.width);
         const naturalHeight = image && (image.naturalHeight || image.height);
         if (naturalWidth && naturalHeight) {
            const maxWidth = 18;
            const maxHeight = 18;
            const ratio = naturalWidth / naturalHeight;
            const imageWidth = Math.min(maxWidth, maxHeight * ratio);
            const imageHeight = imageWidth / ratio;
            doc.addImage(image, 'PNG', x + (width - imageWidth) / 2, top + (height - imageHeight) / 2, imageWidth, imageHeight);
         }
      });
      return height + 4;
   }

   function drawUnusedRcds(doc, entries, margin, top, phaseEnabled) {
      if (!entries.length) return 0;
      const rcd = window.GroepenkaartRcd;
      const right = doc.internal.pageSize.getWidth() - margin;
      const swatch = 4;
      const lineHeight = 4.5;
      const textWidth = right - margin - swatch - 3;
      let y = top + 10;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text('Aardlekschakelaars niet in gebruik', margin, top + 3.2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      entries.forEach(function (entry) {
         const lines = doc.splitTextToSize(rcd.keyText(entry, phaseEnabled), textWidth);
         doc.setFillColor.apply(doc, rcd.rgb(entry.rcd.color));
         doc.rect(margin, y - 3.5, swatch, swatch, 'FD');
         doc.text(lines, margin + swatch + 3, y);
         y += Math.max(lines.length * lineHeight, lineHeight) + 1;
      });
      return y - top;
   }

   // Draws a wrapping key of the RCDs used on this page and returns the height it takes.
   function drawRcdKey(doc, entries, margin, top, phaseEnabled) {
      if (!entries.length) return 0;
      const rcd = window.GroepenkaartRcd;
      const right = doc.internal.pageSize.getWidth() - margin;
      const lineHeight = 6;
      const swatch = 4;
      let x = margin;
      let y = top;
      let rowHeight = lineHeight;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('Aardlekschakelaars:', x, y + 3.2);
      x += doc.getTextWidth('Aardlekschakelaars:') + 3;
      doc.setFont('helvetica', 'normal');
      doc.setDrawColor(30, 30, 30);
      doc.setLineWidth(0.2);
      entries.forEach(function (entry) {
         const text = rcd.keyText(entry, phaseEnabled);
         const lines = doc.splitTextToSize(text, right - margin - swatch - 1.5);
         const width = swatch + 1.5 + Math.max.apply(null, lines.map(function (line) { return doc.getTextWidth(line); }));
         if (x > margin && x + width > right) {
            x = margin;
            y += rowHeight;
            rowHeight = lineHeight;
         }
         doc.setFillColor.apply(doc, rcd.rgb(entry.rcd.color));
         doc.rect(x, y, swatch, swatch, 'FD');
         doc.text(lines, x + swatch + 1.5, y + 3.2);
         rowHeight = Math.max(rowHeight, lines.length * lineHeight);
         x += width + 5;
      });
      return y - top + rowHeight + 1;
   }

   // Draws the QR code with a caption below the last table, on a new page when it does not fit.
   function drawQr(doc, qr, margin) {
      const size = 55;
      const gap = 8;
      const pageHeight = doc.internal.pageSize.getHeight();
      let top = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 40) + gap;
      if (top + size > pageHeight - MARGIN_Y) {
         doc.addPage();
         top = MARGIN_Y;
      }

      const count = qr.getModuleCount();
      const cell = size / count;
      doc.setFillColor(0, 0, 0);
      for (let row = 0; row < count; row++) {
         for (let col = 0; col < count; col++) {
            if (!qr.isDark(row, col)) continue;
            // Merge horizontal runs of dark modules into one rectangle.
            let end = col;
            while (end + 1 < count && qr.isDark(row, end + 1)) end++;
            doc.rect(margin + col * cell, top + row * cell, (end - col + 1) * cell, cell, 'F');
            col = end;
         }
      }

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(91, 101, 115);
      doc.text(doc.splitTextToSize('Scan deze QR-code om deze groepenkaart met alle gegevens te openen en aan te passen in de Groepenkaart generator.', 90),
         margin + size + 8, top + 8);
   }

   // Lays out a group's bold description and small bullet list for a cell of the given inner width. The height
   // includes the cell padding; the table row is made exactly this tall so the text can be drawn inside it.
   function layoutGroup(doc, group, innerWidth) {
      const scale = doc.internal.scaleFactor;
      const descriptionStep = DESCRIPTION_SIZE * LINE_FACTOR / scale;
      const itemStep = ITEM_SIZE * LINE_FACTOR / scale;
      const hasDescription = !!group.description;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(DESCRIPTION_SIZE);
      const description = hasDescription ? doc.splitTextToSize(group.description, innerWidth) : [];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ITEM_SIZE);
      const items = (group.items || []).map(function (item) {
         return doc.splitTextToSize(item, innerWidth - ITEM_INDENT);
      });
      const itemLines = items.reduce(function (sum, lines) { return sum + lines.length; }, 0);
      const itemsGap = description.length && itemLines ? 0.8 : 0;
      const textHeight = description.length * descriptionStep + itemsGap + itemLines * itemStep;
      return {
         description: description, items: items, descriptionStep: descriptionStep, itemStep: itemStep,
         itemsGap: itemsGap, textHeight: textHeight, height: textHeight + CELL_PADDING * 2
      };
   }

   function drawGroup(doc, layout, cell) {
      const x = cell.x + CELL_PADDING;
      let y = cell.y + (cell.height - layout.textHeight) / 2;
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(DESCRIPTION_SIZE);
      layout.description.forEach(function (line) {
         doc.text(line, x, y, { baseline: 'top' });
         y += layout.descriptionStep;
      });
      y += layout.itemsGap;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ITEM_SIZE);
      layout.items.forEach(function (lines) {
         doc.text('\u2022', x, y, { baseline: 'top' });
         lines.forEach(function (line) {
            doc.text(line, x + ITEM_INDENT, y, { baseline: 'top' });
            y += layout.itemStep;
         });
      });
   }

   // Returns false when jsPDF is unavailable so the caller can fall back to printing. A qr (from qrcode-generator)
   // is drawn on the last page.
   function download(boxes, minRows, warningIds, rcds, phaseEnabled, qr, rcdFirst, warningImages) {
      if (!window.jspdf || !window.jspdf.jsPDF) return false;

      const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      if (typeof doc.autoTable !== 'function') return false;

      const rcd = window.GroepenkaartRcd;
      const lookup = rcd.index(rcds);
      const allGroups = boxes.flatMap(function (box) { return box.groups; });
      const unusedRcds = rcd.unused(rcds, allGroups);
      const margin = MARGIN_X;
      const pageWidth = doc.internal.pageSize.getWidth();
      const maxRowHeight = doc.internal.pageSize.getHeight() - MARGIN_Y * 2 - 12;
      const date = 'Afgedrukt op ' + today();

      boxes.forEach(function (box, index) {
         if (index > 0) doc.addPage();

         doc.setTextColor.apply(doc, BLUE);
         doc.setFont('helvetica', 'normal');
         doc.setFontSize(13);
         doc.text('Groepenindeling', margin, 15);
         doc.setFont('helvetica', 'normal');
         doc.setFontSize(8);
         doc.setTextColor(91, 101, 115);
         doc.text(date, pageWidth - margin, 15, { align: 'right' });
         let offset = index === 0 ? drawWarnings(doc, warningIds || [], margin, 19, warningImages) : 0;
         if (index === 0) offset += drawUnusedRcds(doc, unusedRcds, margin, 19 + offset, phaseEnabled);
         doc.setTextColor.apply(doc, BLUE);
         doc.setFontSize(11);
         doc.text(title(box), margin, 24 + offset);
         const keyHeight = drawRcdKey(doc, rcd.used(rcds, box.groups), margin, 27 + offset, phaseEnabled);

         const entries = box.groups.map(function (g) { return lookup[g.rcdId]; });
         const descriptionWidth = pageWidth - margin * 2 - GROUP_WIDTH - (phaseEnabled ? PHASE_WIDTH : 0);
         // Groups are drawn by hand (bold description, small bullets) unless one is taller than a page: that one
         // stays plain text so the table can still split it and no text is lost.
         const layouts = box.groups.map(function (g) {
            const layout = layoutGroup(doc, g, descriptionWidth - CELL_PADDING * 2);
            return layout.height <= maxRowHeight ? layout : null;
         });
         const body = box.groups.map(function (g, i) {
            const description = layouts[i]
               ? { content: '', styles: { minCellHeight: Math.max(10, layouts[i].height) } }
               : [g.description].filter(Boolean).concat((g.items || []).map(function (item) {
                  return '\u2022 ' + item;
               })).join('\n');
            const row = [rcd.cellText(g.number, entries[i], rcdFirst), description];
            if (phaseEnabled) row.push(rcd.phaseText(rcd.groupPhases(g, entries[i] && entries[i].rcd)));
            return row;
         });
         for (let i = box.groups.length; i < minRows; i++) body.push(phaseEnabled ? ['', '', ''] : ['', '']);

         doc.autoTable({
            startY: 30 + offset + keyHeight,
            margin: { top: MARGIN_Y, bottom: MARGIN_Y, left: margin, right: margin },
            rowPageBreak: 'avoid',
            head: [phaseEnabled ? ['Groep', 'Omschrijving', 'Fasen'] : ['Groep', 'Omschrijving']],
            body: body,
            theme: 'grid',
            styles: {
               font: 'helvetica',
               fontSize: 10,
               textColor: [30, 30, 30],
               lineColor: BLUE,
               lineWidth: 0.3,
               minCellHeight: 6,
               valign: 'middle',
               cellPadding: 1
            },
            headStyles: {
               fillColor: BLUE,
               cellPadding: 0.2,
               textColor: [255, 255, 255],
               fontStyle: 'bold',
               fontSize: 6,
               minCellHeight: 4,
               halign: 'center'
            },
            columnStyles: {
               0: { cellWidth: GROUP_WIDTH, halign: 'center' },
               1: { cellWidth: descriptionWidth },
               ...(phaseEnabled ? { 2: { cellWidth: PHASE_WIDTH, cellPadding: { top: 2, right: 2, bottom: 3, left: 2 } } } : {})
            },
            didParseCell: function (data) {
               const entry = data.section === 'body' && data.column.index === 0 && entries[data.row.index];
               if (!entry) return;
               data.cell.styles.fillColor = rcd.rgb(entry.rcd.color);
               data.cell.styles.textColor = rcd.rgb(rcd.textColor(entry.rcd.color));
               data.cell.styles.fontStyle = 'bold';
            },
            didDrawCell: function (data) {
               if (data.section === 'body' && data.column.index === 1 && layouts[data.row.index]) {
                  drawGroup(doc, layouts[data.row.index], data.cell);
               }
               if (!phaseEnabled || data.section !== 'body' || data.column.index !== 2) return;
               // Use the raw cell value so split rows on overflow pages retain their phase border.
               const phases = rcd.phaseCodes.filter(function (phase) {
                  return typeof data.cell.raw === 'string' && data.cell.raw.split(', ').includes(phase);
               });
               if (!phases.length) return;
               const inset = 2;
               const width = (data.cell.width - inset * 2) / phases.length;
               const y = data.cell.y + data.cell.height - 1.5;
               doc.saveGraphicsState();
               doc.setLineWidth(1);
               phases.forEach(function (phase, index) {
                  // String channels avoid jsPDF rounding these exact colors to two decimal places.
                  doc.setDrawColor.apply(doc, rcd.rgb(rcd.phaseColors[phase]).map(function (channel) {
                     return String(channel / 255);
                  }));
                  const x = data.cell.x + inset + index * width;
                  doc.line(x, y, x + width, y);
               });
               doc.restoreGraphicsState();
            }
         });
      });

      if (qr) drawQr(doc, qr, margin);
      doc.save('groepenkaart.pdf');
      return true;
   }

   window.GroepenkaartPdf = { download: download, today: today };
})();
