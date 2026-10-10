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

   function drawUnusedRcbos(doc, entries, margin, top) {
      if (!entries.length) return 0;
      const rcbo = window.GroepenkaartRcbo;
      const right = doc.internal.pageSize.getWidth() - margin;
      const swatch = 4;
      const lineHeight = 4.5;
      const textWidth = right - margin - swatch - 3;
      let y = top + 8;

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(30, 30, 30);
      doc.text('Aardlekschakelaars niet in gebruik', margin, top + 3.2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      entries.forEach(function (entry) {
         const lines = doc.splitTextToSize(rcbo.keyText(entry), textWidth);
         doc.setFillColor.apply(doc, rcbo.rgb(entry.rcbo.color));
         doc.rect(margin, y - 3.5, swatch, swatch, 'FD');
         doc.text(lines, margin + swatch + 3, y);
         y += Math.max(lines.length * lineHeight, lineHeight) + 1;
      });
      return y - top;
   }

   // Draws a wrapping key of the RCBOs used on this page and returns the height it takes.
   function drawRcboKey(doc, entries, margin, top) {
      if (!entries.length) return 0;
      const rcbo = window.GroepenkaartRcbo;
      const right = doc.internal.pageSize.getWidth() - margin;
      const lineHeight = 6;
      const swatch = 4;
      let x = margin;
      let y = top;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(30, 30, 30);
      doc.text('Aardlekschakelaars:', x, y + 3.2);
      x += doc.getTextWidth('Aardlekschakelaars:') + 3;
      doc.setFont('helvetica', 'normal');
      doc.setDrawColor(30, 30, 30);
      doc.setLineWidth(0.2);
      entries.forEach(function (entry) {
         const text = rcbo.keyText(entry);
         const width = swatch + 1.5 + doc.getTextWidth(text);
         if (x > margin && x + width > right) {
            x = margin;
            y += lineHeight;
         }
         doc.setFillColor.apply(doc, rcbo.rgb(entry.rcbo.color));
         doc.rect(x, y, swatch, swatch, 'FD');
         doc.text(text, x + swatch + 1.5, y + 3.2);
         x += width + 5;
      });
      return y - top + lineHeight + 1;
   }

   // Returns false when jsPDF is unavailable so the caller can fall back to printing.
   function download(boxes, minRows, warningIds, rcbos) {
      if (!window.jspdf || !window.jspdf.jsPDF) return false;

      const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      if (typeof doc.autoTable !== 'function') return false;

      const rcbo = window.GroepenkaartRcbo;
      const lookup = rcbo.index(rcbos);
      const allGroups = boxes.flatMap(function (box) { return box.groups; });
      const unusedRcbos = rcbo.unused(rcbos, allGroups);
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
         if (index === 0) offset += drawUnusedRcbos(doc, unusedRcbos, margin, 36 + offset);
         doc.setTextColor.apply(doc, BLUE);
         doc.setFontSize(13);
         doc.text(title(box), margin, 40 + offset);
         const keyHeight = drawRcboKey(doc, rcbo.used(rcbos, box.groups), margin, 43 + offset);

         const entries = box.groups.map(function (g) { return lookup[g.rcboId]; });
         const body = box.groups.map(function (g, i) { return [rcbo.cellText(g.number, entries[i]), g.name, g.description]; });
         for (let i = box.groups.length; i < minRows; i++) body.push(['', '', '']);

         doc.autoTable({
            startY: 46 + offset + keyHeight,
            margin: { left: margin, right: margin },
            head: [['Groep', 'Naam', 'Omschrijving']],
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
               1: { cellWidth: 55 }
            },
            didParseCell: function (data) {
               const entry = data.section === 'body' && data.column.index === 0 && entries[data.row.index];
               if (!entry) return;
               data.cell.styles.fillColor = rcbo.rgb(entry.rcbo.color);
               data.cell.styles.textColor = rcbo.rgb(rcbo.textColor(entry.rcbo.color));
               data.cell.styles.fontStyle = 'bold';
            }
         });
      });

      doc.save('groepenkaart.pdf');
      return true;
   }

   window.GroepenkaartPdf = { download: download, today: today };
})();
