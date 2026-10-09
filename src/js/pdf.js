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
         doc.setFontSize(6.8);
         doc.text(doc.splitTextToSize(warnings.message.toUpperCase(), width - 6), center, top + 19, {
            align: 'center', lineHeightFactor: 1.2
         });
         warnings.drawIcon(doc, warning.icon, center - 12, top + 28, 24);
      });
      return height + 5;
   }

   // Returns false when jsPDF is unavailable so the caller can fall back to printing.
   function download(boxes, minRows, warningIds) {
      if (!window.jspdf || !window.jspdf.jsPDF) return false;

      const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      if (typeof doc.autoTable !== 'function') return false;

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
         const offset = index === 0 ? drawWarnings(doc, warningIds || [], margin, 36) : 0;
         doc.setTextColor.apply(doc, BLUE);
         doc.setFontSize(13);
         doc.text(title(box), margin, 40 + offset);

         const body = box.groups.map(function (g) { return [g.number, g.name, g.description]; });
         for (let i = box.groups.length; i < minRows; i++) body.push(['', '', '']);

         doc.autoTable({
            startY: 46 + offset,
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
            }
         });
      });

      doc.save('groepenkaart.pdf');
      return true;
   }

   window.GroepenkaartPdf = { download: download, today: today };
})();
