(function () {
   'use strict';

   const BLUE = [0, 63, 125];

   function today() {
      const d = new Date();
      const pad = function (n) { return String(n).padStart(2, '0'); };
      return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
   }

   function title(box) {
      return ['Kast', box.number, box.name ? '- ' + box.name : ''].filter(Boolean).join(' ');
   }

   function drawWarnings(doc, ids, margin, top) {
      const warnings = window.GroepenkaartWarnings;
      const selected = warnings.selected(ids);
      if (!selected.length) return 0;

      const width = 42;
      const height = 42;
      const gap = 4;
      selected.forEach(function (warning, index) {
         const x = margin + index * (width + gap);
         const center = x + width / 2;
         doc.setDrawColor(180, 35, 24);
         doc.setLineWidth(1.2);
         doc.roundedRect(x, top, width, height, 3, 3);
         doc.setTextColor(0, 0, 0);
         doc.setFont('helvetica', 'bold');
         doc.setFontSize(8);
         doc.text('LET OP!', center, top + 5, { align: 'center' });
         doc.setFontSize(7.4);
         doc.text(warning.heading[0], center, top + 10, { align: 'center' });
         doc.text(warning.heading[1], center, top + 14, { align: 'center' });
         doc.setFont('helvetica', 'normal');
         const message = warning.message || warnings.message;
         doc.setFontSize(warning.message ? 5.8 : 6.8);
         doc.text(doc.splitTextToSize(message.toUpperCase(), width - 6), center, top + 19, {
            align: 'center', lineHeightFactor: 1.2
         });
         warnings.drawIcon(doc, warning.icon, center - 12, top + 28, 24);
      });
      return height + 5;
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

   // Returns false when jsPDF is unavailable so the caller can fall back to printing.
   function download(boxes, minRows, warningIds, rcds, phaseEnabled) {
      if (!window.jspdf || !window.jspdf.jsPDF) return false;

      const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      if (typeof doc.autoTable !== 'function') return false;

      const rcd = window.GroepenkaartRcd;
      const lookup = rcd.index(rcds);
      const allGroups = boxes.flatMap(function (box) { return box.groups; });
      const unusedRcds = rcd.unused(rcds, allGroups);
      const margin = 15;
      const date = 'Afgedrukt op ' + today();

      boxes.forEach(function (box, index) {
         if (index > 0) doc.addPage();

         doc.setTextColor.apply(doc, BLUE);
         doc.setFont('helvetica', 'normal');
         doc.setFontSize(24);
         doc.text('Groepenindeling', margin, 25);
         doc.setFont('helvetica', 'normal');
         doc.setFontSize(10);
         doc.setTextColor(91, 101, 115);
         doc.text(date, margin, 31);
         let offset = index === 0 ? drawWarnings(doc, warningIds || [], margin, 36) : 0;
         if (index === 0) offset += drawUnusedRcds(doc, unusedRcds, margin, 36 + offset, phaseEnabled);
         doc.setTextColor.apply(doc, BLUE);
         doc.setFontSize(13);
         doc.text(title(box), margin, 40 + offset);
         const keyHeight = drawRcdKey(doc, rcd.used(rcds, box.groups), margin, 43 + offset, phaseEnabled);

         const entries = box.groups.map(function (g) { return lookup[g.rcdId]; });
         const body = box.groups.map(function (g, i) {
            const description = [g.description].filter(Boolean).concat((g.items || []).map(function (item) {
               return '• ' + item;
            })).join('\n');
            const row = [rcd.cellText(g.number, entries[i]), description];
            if (phaseEnabled) row.push(rcd.phaseText(rcd.groupPhases(g, entries[i] && entries[i].rcd)));
            return row;
         });
         for (let i = box.groups.length; i < minRows; i++) body.push(phaseEnabled ? ['', '', ''] : ['', '']);

         doc.autoTable({
            startY: 46 + offset + keyHeight,
            margin: { left: margin, right: margin },
            head: [phaseEnabled ? ['Groep', 'Omschrijving', 'Fasen'] : ['Groep', 'Omschrijving']],
            body: body,
            theme: 'grid',
            styles: {
               font: 'helvetica',
               fontSize: 10,
               textColor: [30, 30, 30],
               lineColor: BLUE,
               lineWidth: 0.3,
               minCellHeight: 10,
               valign: 'middle',
               cellPadding: 2
            },
            headStyles: {
               fillColor: BLUE,
               textColor: [255, 255, 255],
               fontStyle: 'bold',
               fontSize: 11,
               halign: 'center'
            },
            columnStyles: {
               0: { cellWidth: 22, halign: 'center' },
               ...(phaseEnabled ? { 2: { cellWidth: 30, cellPadding: { top: 2, right: 2, bottom: 3, left: 2 } } } : {})
            },
            didParseCell: function (data) {
               const entry = data.section === 'body' && data.column.index === 0 && entries[data.row.index];
               if (!entry) return;
               data.cell.styles.fillColor = rcd.rgb(entry.rcd.color);
               data.cell.styles.textColor = rcd.rgb(rcd.textColor(entry.rcd.color));
               data.cell.styles.fontStyle = 'bold';
            },
            didDrawCell: function (data) {
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

      doc.save('groepenkaart.pdf');
      return true;
   }

   window.GroepenkaartPdf = { download: download, today: today };
})();
