(function () {
   'use strict';

   const message = 'Gevaarlijke DC-spanning op de bekabeling mogelijk!';
   // Icons use a 64 x 32 coordinate system shared by SVG and PDF drawing.
   const definitions = [
      {
         id: 'pv',
         label: 'PV-installatie (zonnepanelen)',
         heading: ['PV-INSTALLATIE', 'AANWEZIG'],
         icon: [
            ['rect', 4, 12, 38, 16],
            ['line', 4, 20, 42, 20],
            ['line', 16, 12, 16, 28],
            ['line', 29, 12, 29, 28],
            ['line', 23, 28, 23, 31],
            ['circle', 51, 9, 4],
            ['line', 51, 1, 51, 3],
            ['line', 51, 15, 51, 17],
            ['line', 43, 9, 45, 9],
            ['line', 57, 9, 60, 9],
            ['line', 45, 3, 47, 5],
            ['line', 55, 13, 57, 15],
            ['line', 45, 15, 47, 13],
            ['line', 55, 5, 57, 3]
         ]
      },
      {
         id: 'ev',
         label: 'EV-lader',
         heading: ['EV-LADER', 'AANWEZIG'],
         icon: [
            ['rect', 3, 17, 39, 10],
            ['line', 10, 17, 15, 8],
            ['line', 15, 8, 30, 8],
            ['line', 30, 8, 36, 17],
            ['line', 23, 8, 23, 17],
            ['circle', 12, 27, 4],
            ['circle', 34, 27, 4],
            ['rect', 48, 3, 12, 23],
            ['line', 48, 26, 60, 26],
            ['line', 48, 16, 44, 16],
            ['line', 44, 16, 44, 22],
            ['line', 55, 7, 52, 13],
            ['line', 52, 13, 57, 13],
            ['line', 57, 13, 54, 19]
         ]
      },
      {
         id: 'battery',
         label: 'Thuisbatterij',
         heading: ['THUISBATTERIJ', 'AANWEZIG'],
         icon: [
            ['rect', 9, 5, 43, 24],
            ['rect', 52, 12, 5, 10],
            ['line', 34, 8, 25, 18],
            ['line', 25, 18, 36, 18],
            ['line', 36, 18, 27, 27],
            ['line', 14, 12, 20, 12],
            ['line', 17, 9, 17, 15]
         ]
      },
      {
         id: 'heat-pump',
         label: 'Airco/Warmtepomp',
         heading: ['AIRCO / WARMTEPOMP', 'AANWEZIG'],
         icon: [
            ['rect', 8, 3, 48, 25],
            ['circle', 25, 15, 9],
            ['circle', 25, 15, 2],
            ['line', 25, 13, 29, 8],
            ['line', 27, 15, 32, 19],
            ['line', 25, 17, 21, 22],
            ['line', 23, 15, 18, 11],
            ['line', 40, 9, 50, 9],
            ['line', 40, 15, 50, 15],
            ['line', 40, 21, 50, 21],
            ['line', 15, 28, 15, 31],
            ['line', 49, 28, 49, 31]
         ]
      }
   ];

   function normalize(value) {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.some(function (id) {
         return !definitions.some(function (warning) { return warning.id === id; });
      })) {
         throw new Error('Ongeldig bestand: "warnings" moet een lijst met bekende installatiecodes zijn.');
      }
      return definitions.filter(function (warning) { return value.includes(warning.id); })
         .map(function (warning) { return warning.id; });
   }

   function selected(ids) {
      return definitions.filter(function (warning) { return ids.includes(warning.id); });
   }

   function svg(icon) {
      const ns = 'http://www.w3.org/2000/svg';
      const root = document.createElementNS(ns, 'svg');
      const attrs = { viewBox: '0 0 64 32', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
      Object.keys(attrs).forEach(function (key) { root.setAttribute(key, attrs[key]); });
      icon.forEach(function (shape) {
         const node = document.createElementNS(ns, shape[0]);
         const keys = { rect: ['x', 'y', 'width', 'height'], line: ['x1', 'y1', 'x2', 'y2'], circle: ['cx', 'cy', 'r'] }[shape[0]];
         keys.forEach(function (key, index) { node.setAttribute(key, shape[index + 1]); });
         root.appendChild(node);
      });
      return root;
   }

   function drawIcon(doc, icon, x, y, width) {
      const scale = width / 64;
      doc.setDrawColor(0, 0, 0);
      doc.setLineWidth(2 * scale);
      icon.forEach(function (shape) {
         if (shape[0] === 'rect') {
            doc.rect(x + shape[1] * scale, y + shape[2] * scale, shape[3] * scale, shape[4] * scale);
         } else if (shape[0] === 'circle') {
            doc.circle(x + shape[1] * scale, y + shape[2] * scale, shape[3] * scale);
         } else {
            doc.line(x + shape[1] * scale, y + shape[2] * scale, x + shape[3] * scale, y + shape[4] * scale);
         }
      });
   }

   window.GroepenkaartWarnings = { definitions: definitions, message: message, normalize: normalize, selected: selected, svg: svg, drawIcon: drawIcon };
})();
