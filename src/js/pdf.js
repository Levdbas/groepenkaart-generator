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

   // Returns false when jsPDF is unavailable so the caller can fall back to printing.
   function download(boxes, minRows) {
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
         doc.setFontSize(10);
         doc.setTextColor(91, 101, 115);
         doc.text(date, margin, 31);
         doc.setTextColor.apply(doc, BLUE);
         doc.setFontSize(13);
         doc.text(title(box), margin, 40);

         const body = box.groups.map(function (g) { return [g.number, g.name, g.description]; });
         for (let i = box.groups.length; i < minRows; i++) body.push(['', '', '']);

         doc.autoTable({
            startY: 46,
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
