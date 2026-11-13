(function () {
   'use strict';

   // The visual box: DIN rails with modules and a label strip under each rail. model() turns a box and its modules into
   // a plain description that render() (interactive DOM in the app, static DOM in the print output) and draw() (jsPDF)
   // both follow, so the three views stay the same.
   //
   // A box is {rails, railWidth}. An item is {id, rail, slot, width, number, type, description, color, protective,
   // badges: [{text, special}]} with an optional label for assistive technology.

   // Sizes in CSS pixels, matching .panel in style.css (1rem = 16px). The PDF draws them scaled to millimetres.
   const SLOT = 56;
   const GAP = 2;
   const RAIL_PADDING = 4;
   const MODULE_HEIGHT = SLOT * 42 / 18;
   const PANEL_PADDING_X = 20;
   const PANEL_PADDING_Y = 24;
   const RAIL_GAP = 20;
   const LABEL_GAP = 4.8;
   const LABEL_HEIGHT = 24;
   const LABEL_PADDING_Y = 2.4;
   const BORDER = 1;
   const MODULE_PADDING_TOP = 9.6;
   const MODULE_PADDING_X = 2.4;
   const STRIPE_HEIGHT = 6.4;
   const ITEM_GAP = 4.8;
   const LINE_HEIGHT = 1.4;
   const NUMBER_SIZE = 14.4;
   const TYPE_SIZE = 11.2;
   const BADGE_SIZE = 9.6;
   const BADGE_PADDING = 3.2;
   const LABEL_SIZE = 11.2;
   const LEVER_WIDTH = 11.2;
   const LEVER_HEIGHT = 25.6;

   const MAX_SCALE = 0.25;
   const PT_PER_MM = 72 / 25.4;

   const COLORS = {
      panel: [130, 137, 147], panelBorder: [95, 102, 112], rail: [59, 64, 72], slot: [128, 131, 136],
      module: [243, 244, 246], moduleBorder: [195, 200, 207], lever: [47, 54, 64], protectiveLever: [31, 79, 138],
      text: [30, 30, 30], muted: [91, 101, 115], labels: [255, 255, 255], labelDivider: [227, 230, 234],
      badge: [180, 35, 24], specialBadge: [134, 28, 20]
   };

   function model(box, items) {
      const rails = [];
      for (let rail = 1; rail <= box.rails; rail++) {
         const cells = [];
         let slot = 1;
         while (slot <= box.railWidth) {
            const item = items.find(function (candidate) { return candidate.rail === rail && candidate.slot === slot; });
            if (item) {
               cells.push({ slot: slot, width: item.width, item: item });
               slot += item.width;
            } else {
               cells.push({ slot: slot, width: 1, item: null });
               slot += 1;
            }
         }
         rails.push({ rail: rail, cells: cells });
      }
      return { rails: rails, railWidth: box.railWidth };
   }

   function gridColumn(slot, width) {
      return 'grid-column: ' + slot + ' / span ' + width;
   }

   function renderModule(el, item, options) {
      const interactive = typeof options.moduleAttrs === 'function';
      const selected = options.selectedId === item.id;
      const attrs = {
         className: 'din-module' + (selected ? ' is-selected' : '') + (item.width > 1 ? ' is-wide' : '') + (item.protective ? ' is-protective' : ''),
         style: gridColumn(item.slot, item.width),
         'data-module-id': item.id
      };
      if (interactive) Object.assign(attrs, { type: 'button' }, options.moduleAttrs(item, selected));
      return el(interactive ? 'button' : 'div', attrs, [
         el('span', { className: 'din-module-stripe' + (item.color ? '' : ' is-empty'), style: item.color ? 'background-color: ' + item.color : '', 'aria-hidden': 'true' }),
         el('span', { className: 'din-module-number', text: item.number || '–', 'aria-hidden': 'true' }),
         el('span', { className: 'din-module-lever', 'aria-hidden': 'true' }),
         item.width > 1 ? el('span', { className: 'din-module-type', text: item.type, 'aria-hidden': 'true' }) : null,
         ...item.badges.map(function (badge) {
            return el('span', { className: 'din-module-badge' + (badge.special ? ' special-installation-badge' : ''), text: badge.text, 'aria-hidden': 'true' });
         })
      ]);
   }

   function renderRail(el, rail, options) {
      const cells = [];
      const labels = [];
      rail.cells.forEach(function (cell) {
         if (cell.item) {
            cells.push(renderModule(el, cell.item, options));
            labels.push(el('span', { className: 'din-label', style: gridColumn(cell.slot, cell.width), title: cell.item.description, text: cell.item.description }));
         } else if (typeof options.slotAttrs === 'function') {
            cells.push(el('button', Object.assign({
               type: 'button', className: 'din-slot', style: gridColumn(cell.slot, 1), text: '+'
            }, options.slotAttrs(rail.rail, cell.slot))));
         } else {
            cells.push(el('div', { className: 'din-slot', style: gridColumn(cell.slot, 1), 'aria-hidden': 'true' }));
         }
      });
      return el('div', { className: 'din-rail', role: 'group', 'aria-label': 'Rail ' + rail.rail }, [
         el('div', { className: 'din-rail-slots' }, cells),
         el('div', { className: 'din-rail-labels', 'aria-hidden': 'true' }, labels)
      ]);
   }

   // el(tag, attrs, children) creates a node. With moduleAttrs and slotAttrs in options the modules and free slots are
   // buttons carrying those attributes (e.g. click handlers); without them the panel is static.
   function render(el, panel, options) {
      return el('div', { className: 'panel-scroll' }, [
         el('div', { className: 'panel', style: '--rail-width: ' + panel.railWidth },
            panel.rails.map(function (rail) { return renderRail(el, rail, options || {}); }))
      ]);
   }

   // The natural size of a drawn panel in pixels.
   function size(panel) {
      const railHeight = MODULE_HEIGHT + RAIL_PADDING * 2 + LABEL_GAP + LABEL_HEIGHT;
      return {
         width: panel.railWidth * SLOT + (panel.railWidth - 1) * GAP + RAIL_PADDING * 2 + (PANEL_PADDING_X + BORDER) * 2,
         height: panel.rails.length * railHeight + (panel.rails.length - 1) * RAIL_GAP + (PANEL_PADDING_Y + BORDER) * 2
      };
   }

   // The scale in mm per pixel and the resulting size in mm of a panel that must fit in maxWidth by maxHeight.
   function fit(panel, maxWidth, maxHeight) {
      const natural = size(panel);
      const scale = Math.min(MAX_SCALE, maxWidth / natural.width, maxHeight / natural.height);
      return { scale: scale, width: natural.width * scale, height: natural.height * scale };
   }

   function shorten(doc, text, width) {
      if (doc.getTextWidth(text) <= width) return text;
      let end = text.length;
      while (end > 0 && doc.getTextWidth(text.slice(0, end) + '...') > width) end--;
      return end > 0 ? text.slice(0, end) + '...' : '';
   }

   function setText(doc, sizePx, scale, color, style) {
      doc.setFont('helvetica', style || 'normal');
      doc.setFontSize(sizePx * scale * PT_PER_MM);
      doc.setTextColor.apply(doc, color);
   }

   // A rounded rectangle whose border lies inside the given box, like a CSS border.
   function box(doc, x, y, width, height, radius, fill, stroke, lineWidth) {
      const inset = stroke ? lineWidth / 2 : 0;
      if (fill) doc.setFillColor.apply(doc, fill);
      if (stroke) {
         doc.setDrawColor.apply(doc, stroke);
         doc.setLineWidth(lineWidth);
      }
      doc.roundedRect(x + inset, y + inset, width - inset * 2, height - inset * 2, radius, radius, fill && stroke ? 'FD' : fill ? 'F' : 'S');
   }

   function drawModule(doc, item, x, y, scale) {
      const width = item.width * SLOT + (item.width - 1) * GAP;
      const px = function (value) { return value * scale; };
      box(doc, x, y, px(width), px(MODULE_HEIGHT), px(3), COLORS.module, null);
      if (item.color) {
         doc.setFillColor.apply(doc, window.GroepenkaartRcd.rgb(item.color));
         doc.rect(x + px(BORDER), y + px(BORDER), px(width - BORDER * 2), px(STRIPE_HEIGHT), 'F');
      }
      box(doc, x, y, px(width), px(MODULE_HEIGHT), px(3), null, COLORS.moduleBorder, px(BORDER));

      const center = x + px(width) / 2;
      const textWidth = px(width - (BORDER + MODULE_PADDING_X) * 2);
      let top = BORDER + MODULE_PADDING_TOP;
      setText(doc, NUMBER_SIZE, scale, COLORS.text, 'bold');
      doc.text(shorten(doc, item.number || '–', textWidth), center, y + px(top + NUMBER_SIZE * LINE_HEIGHT / 2), { align: 'center', baseline: 'middle' });
      top += NUMBER_SIZE * LINE_HEIGHT + ITEM_GAP;

      const leverWidth = item.width > 1 ? LEVER_WIDTH * 2 : LEVER_WIDTH;
      box(doc, center - px(leverWidth) / 2, y + px(top), px(leverWidth), px(LEVER_HEIGHT), px(2), item.protective ? COLORS.protectiveLever : COLORS.lever, null);
      top += LEVER_HEIGHT + ITEM_GAP;

      if (item.width > 1) {
         setText(doc, TYPE_SIZE, scale, COLORS.muted);
         doc.text(shorten(doc, item.type, textWidth), center, y + px(top + TYPE_SIZE * LINE_HEIGHT / 2), { align: 'center', baseline: 'middle' });
         top += TYPE_SIZE * LINE_HEIGHT + ITEM_GAP;
      }

      const badgeHeight = BADGE_SIZE * LINE_HEIGHT;
      setText(doc, BADGE_SIZE, scale, [255, 255, 255], 'bold');
      item.badges.forEach(function (badge) {
         // Like the screen, a badge that does not fit inside the module is cut off.
         if (top + badgeHeight > MODULE_HEIGHT - BORDER) return;
         const badgeWidth = doc.getTextWidth(badge.text) + px(BADGE_PADDING * 2);
         box(doc, center - badgeWidth / 2, y + px(top), badgeWidth, px(badgeHeight), px(2), badge.special ? COLORS.specialBadge : COLORS.badge, null);
         doc.text(badge.text, center, y + px(top + badgeHeight / 2), { align: 'center', baseline: 'middle' });
         top += badgeHeight + ITEM_GAP;
      });
   }

   // Draws the panel with its top-left corner at x, y (mm) at the scale returned by fit(). Free slots are drawn empty.
   function draw(doc, panel, x, y, scale) {
      const px = function (value) { return value * scale; };
      const natural = size(panel);
      doc.saveGraphicsState();
      box(doc, x, y, px(natural.width), px(natural.height), px(10), COLORS.panel, COLORS.panelBorder, px(BORDER));

      const railWidth = panel.railWidth * SLOT + (panel.railWidth - 1) * GAP + RAIL_PADDING * 2;
      const railHeight = MODULE_HEIGHT + RAIL_PADDING * 2 + LABEL_GAP + LABEL_HEIGHT;
      panel.rails.forEach(function (rail, index) {
         const railX = x + px(BORDER + PANEL_PADDING_X);
         const railY = y + px(BORDER + PANEL_PADDING_Y + index * (railHeight + RAIL_GAP));
         box(doc, railX, railY, px(railWidth), px(MODULE_HEIGHT + RAIL_PADDING * 2), px(4), COLORS.rail, null);
         const labelsY = railY + px(MODULE_HEIGHT + RAIL_PADDING * 2 + LABEL_GAP);
         box(doc, railX, labelsY, px(railWidth), px(LABEL_HEIGHT), px(2), COLORS.labels, null);

         rail.cells.forEach(function (cell) {
            const cellX = railX + px(RAIL_PADDING + (cell.slot - 1) * (SLOT + GAP));
            const cellY = railY + px(RAIL_PADDING);
            if (!cell.item) {
               doc.setLineDashPattern([px(3), px(2)], 0);
               box(doc, cellX, cellY, px(SLOT), px(MODULE_HEIGHT), px(3), null, COLORS.slot, px(BORDER));
               doc.setLineDashPattern([], 0);
               return;
            }
            drawModule(doc, cell.item, cellX, cellY, scale);

            const labelWidth = cell.width * SLOT + (cell.width - 1) * GAP;
            const dividerTop = labelsY + px(LABEL_PADDING_Y);
            doc.setDrawColor.apply(doc, COLORS.labelDivider);
            doc.setLineWidth(px(BORDER));
            doc.line(cellX + px(BORDER) / 2, dividerTop, cellX + px(BORDER) / 2, labelsY + px(LABEL_HEIGHT - LABEL_PADDING_Y));
            setText(doc, LABEL_SIZE, scale, COLORS.text);
            doc.text(shorten(doc, cell.item.description || '', px(labelWidth - 4)), cellX + px(labelWidth) / 2, labelsY + px(LABEL_HEIGHT) / 2, { align: 'center', baseline: 'middle' });
         });
      });
      doc.restoreGraphicsState();
   }

   window.GroepenkaartPanel = { model: model, render: render, size: size, fit: fit, draw: draw };
})();
