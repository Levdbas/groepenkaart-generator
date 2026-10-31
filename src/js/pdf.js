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
   const BADGE_SIZE = 6;
   const BADGE_HEIGHT = 3.4;
   const BADGE_PADDING = 1;
   const BADGE_GAP = 1;

   function today() {
      const d = new Date();
      const pad = function (n) { return String(n).padStart(2, '0'); };
      return pad(d.getDate()) + '-' + pad(d.getMonth() + 1) + '-' + d.getFullYear();
   }

   function title(box) {
      return ['Kast', box.number, box.name ? '- ' + box.name : ''].filter(Boolean).join(' ');
   }

   // Draws one square card per warning, matching the browser print, and returns the vertical space they take.
   // images are indexed like the warning definitions.
   function drawWarnings(doc, ids, margin, top, images) {
      const warnings = window.GroepenkaartWarnings;
      const selected = warnings.selected(ids);
      if (!selected.length) return 0;

      const gap = 2;
      const width = 21;
      const height = 21;
      selected.forEach(function (warning, index) {
         const x = margin + index * (width + gap);
         doc.setDrawColor(180, 35, 24);
         doc.setLineWidth(0.6);
         doc.roundedRect(x, top, width, height, 1.5, 1.5);
         const image = images && images[warnings.definitions.indexOf(warning)];
         const naturalWidth = image && (image.naturalWidth || image.width);
         const naturalHeight = image && (image.naturalHeight || image.height);
         if (naturalWidth && naturalHeight) {
            const maxWidth = 17;
            const maxHeight = 17;
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

   function moduleMetadata(module, boxes) {
      const definition = window.GroepenkaartSchema.moduleTypes.get(module.type || 'MCB');
      const width = window.GroepenkaartSchema.moduleTypes.widthOf(module);
      const label = definition ? (module.type && module.type.startsWith('MAINS-') ? definition.label : definition.slug) : '';
      const details = definition ? [label, width + (width === 1 ? ' DIN-module' : ' DIN-modules')] : [];
      if (module.characteristic) details.push(module.characteristic);
      if (module.rcdType) details.push('type ' + module.rcdType);
      if (module.ratedCurrent) details.push(module.ratedCurrent + ' A');
      if (module.connectedTo) details.push(window.GroepenkaartRcd.connectionText(module));
      boxes.forEach(function (box) {
         if (box.supply && box.supply.type === 'subdistribution' && box.supply.sourceModuleId === module.id) {
            details.push('voedt kast ' + box.number + (box.name ? ' (' + box.name + ')' : ''));
         }
      });
      return details.join(' - ');
   }

   function supplySummary(box, boxes) {
      const supply = box.supply;
      if (!supply) return '';
      const details = [];
      if (supply.type === 'linked') {
         const source = boxes.find(function (candidate) { return candidate.id === supply.sourceBoxId; });
         details.push(source ? 'gekoppeld aan de hoofdaansluiting van kast ' + source.number : 'gekoppeld aan een hoofdaansluiting');
      } else if (supply.type === 'mains') {
         details.push('hoofdaansluiting');
         if (supply.connectionRating === 'Anders') details.push(supply.customConnectionRating || 'Anders');
         else if (supply.connectionRating) details.push(supply.connectionRating);
         const hasMainsModule = box.groups.some(function (module) { return module.type && module.type.startsWith('MAINS-'); });
         if (!hasMainsModule && (supply.mainSwitchPoles || supply.mainSwitchCurrent)) {
            details.push('hoofdschakelaar ' + (supply.mainSwitchPoles ? supply.mainSwitchPoles + 'P' : '') +
               (supply.mainSwitchCurrent ? ' ' + supply.mainSwitchCurrent + ' A' : ''));
         }
         if (supply.supplier) details.push(supply.supplier);
      } else {
         const sourceBox = boxes.find(function (candidate) {
            return candidate.groups.some(function (module) { return module.id === supply.sourceModuleId; });
         });
         const source = sourceBox && sourceBox.groups.find(function (module) { return module.id === supply.sourceModuleId; });
         if (sourceBox && source) details.push('vanuit kast ' + sourceBox.number + ', module ' + source.number);
         if (supply.preFuse) details.push(supply.preFuse);
         if (supply.cableCores && supply.cableCrossSection) details.push(supply.cableCores + 'x ' + supply.cableCrossSection + ' mm2');
         const hasMainsModule = box.groups.some(function (module) { return module.type && module.type.startsWith('MAINS-'); });
         if (!hasMainsModule && (supply.mainSwitchPoles || supply.mainSwitchCurrent)) {
            details.push('hoofdschakelaar ' + (supply.mainSwitchPoles ? supply.mainSwitchPoles + 'P' : '') +
               (supply.mainSwitchCurrent ? ' ' + supply.mainSwitchCurrent + ' A' : ''));
         }
      }
      return details.length ? 'Voeding: ' + details.join(' - ') : '';
   }

   function drawGeneralInfo(doc, text, margin, top, width) {
      if (!text) return 0;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      const lines = doc.splitTextToSize(text, width);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(30, 30, 30);
      doc.text('Algemene informatie', margin, top + 3);
      doc.setFont('helvetica', 'normal');
      doc.text(lines, margin, top + 7);
      return 8 + lines.length * 4;
   }

   // Lays out a module's description, type details, and small bullet list for a cell of the given inner width. The height
   // includes the cell padding; the table row is made exactly this tall so the text can be drawn inside it.
   function layoutGroup(doc, group, innerWidth, boxes) {
      const scale = doc.internal.scaleFactor;
      const descriptionStep = DESCRIPTION_SIZE * LINE_FACTOR / scale;
      const metadataSize = 6.3;
      const metadataStep = metadataSize * LINE_FACTOR / scale;
      const itemStep = ITEM_SIZE * LINE_FACTOR / scale;
      const hasDescription = !!group.description;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(BADGE_SIZE);
      const badges = window.GroepenkaartWarnings.selected(group.warnings || []).map(function (warning) {
         return { text: warning.badge, width: doc.getTextWidth(warning.badge) + BADGE_PADDING * 2, special: false };
      }).concat(window.GroepenkaartWarnings.selectedSpecialInstallations(group.specialInstallations || []).map(function (installation) {
         return { text: installation.badge, width: doc.getTextWidth(installation.badge) + BADGE_PADDING * 2, special: true };
      }));
      // The first lines leave room for the badges at the right edge of the cell.
      const badgeWidth = badges.reduce(function (sum, badge) { return sum + badge.width + BADGE_GAP; }, 0);
      const headWidth = innerWidth - badgeWidth;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(DESCRIPTION_SIZE);
      const description = hasDescription ? doc.splitTextToSize(group.description, headWidth) : [];
      const metadataText = moduleMetadata(group, boxes);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(metadataSize);
      const metadata = metadataText ? doc.splitTextToSize(metadataText, headWidth) : [];
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(ITEM_SIZE);
      const items = (group.items || []).map(function (item) {
         return doc.splitTextToSize(item, innerWidth - ITEM_INDENT);
      });
      const itemLines = items.reduce(function (sum, lines) { return sum + lines.length; }, 0);
      const metadataGap = description.length && metadata.length ? 0.5 : 0;
      const itemsGap = description.length && itemLines ? 0.8 : 0;
      const textHeight = description.length * descriptionStep + metadataGap + metadata.length * metadataStep + itemsGap + itemLines * itemStep;
      return {
         description: description, metadata: metadata, items: items, descriptionStep: descriptionStep, badges: badges,
         metadataStep: metadataStep, metadataGap: metadataGap, itemStep: itemStep,
         itemsGap: itemsGap, textHeight: textHeight, height: textHeight + CELL_PADDING * 2
      };
   }

   function drawGroup(doc, layout, cell) {
      const x = cell.x + CELL_PADDING;
      let y = cell.y + (cell.height - layout.textHeight) / 2;
      let badgeX = cell.x + cell.width - CELL_PADDING;
      for (let i = layout.badges.length - 1; i >= 0; i--) {
         const badge = layout.badges[i];
         badgeX -= badge.width;
         if (badge.special) doc.setFillColor.apply(doc, BLUE);
         else doc.setFillColor(180, 35, 24);
         doc.roundedRect(badgeX, y, badge.width, BADGE_HEIGHT, 0.7, 0.7, 'F');
         doc.setFont('helvetica', 'bold');
         doc.setFontSize(BADGE_SIZE);
         doc.setTextColor(255, 255, 255);
         doc.text(badge.text, badgeX + BADGE_PADDING, y + BADGE_HEIGHT / 2, { baseline: 'middle' });
         badgeX -= BADGE_GAP;
      }
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(DESCRIPTION_SIZE);
      layout.description.forEach(function (line) {
         doc.text(line, x, y, { baseline: 'top' });
         y += layout.descriptionStep;
      });
      y += layout.metadataGap;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.3);
      doc.setTextColor(91, 101, 115);
      layout.metadata.forEach(function (line) {
         doc.text(line, x, y, { baseline: 'top' });
         y += layout.metadataStep;
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

   // Returns null when jsPDF is unavailable so the caller can fall back to printing. A qr (from qrcode-generator)
   // is drawn on the last page.
   function build(boxes, warningIds, rcds, phaseEnabled, qr, rcdFirst, warningImages, generalInfo) {
      if (!window.jspdf || !window.jspdf.jsPDF) return null;

      // Without compression jsPDF stores the rasterized warning icons as raw pixels, which made a 2-page PDF several MB.
      const doc = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      if (typeof doc.autoTable !== 'function') return null;

      const rcd = window.GroepenkaartRcd;
      const warningModule = window.GroepenkaartWarnings;
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
         doc.text('Groepenkaart', margin, 15); // keep this title as it is.
         doc.setFont('helvetica', 'normal');
         doc.setFontSize(8);
         doc.setTextColor(91, 101, 115);
         doc.text(date, pageWidth - margin, 15, { align: 'right' });
         let offset = drawWarnings(doc, warningModule.forPage(box, index, warningIds || [], boxes), margin, 19, warningImages);
         if (index === 0) offset += drawUnusedRcds(doc, unusedRcds, margin, 19 + offset, phaseEnabled);
         if (index === 0) offset += drawGeneralInfo(doc, generalInfo, margin, 21 + offset, pageWidth - margin * 2);
         doc.setTextColor.apply(doc, BLUE);
         doc.setFontSize(11);
         doc.text(title(box), margin, 22 + offset);
         const supply = supplySummary(box, boxes);
         let supplyHeight = 0;
         if (supply) {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(30, 30, 30);
            doc.text(doc.splitTextToSize(supply, pageWidth - margin * 2), margin, 50 + offset);
            supplyHeight = 4.5;
         }
         const keyHeight = drawRcdKey(doc, rcd.used(rcds, box.groups), margin, 21.5 + offset + supplyHeight, phaseEnabled);

         // A null row is a free slot, drawn as an empty row.
         const rows = box.rows || box.groups;
         const entries = rows.map(function (module) {
            if (!module) return undefined;
            return lookup[module.rcdId] || (module.type && /^(RCD|RCBO)-/.test(module.type) ? lookup[module.id] : undefined);
         });
         const descriptionWidth = pageWidth - margin * 2 - GROUP_WIDTH - (phaseEnabled ? PHASE_WIDTH : 0);
         // Groups are drawn by hand (bold description, small bullets) unless one is taller than a page: that one
         // stays plain text so the table can still split it and no text is lost.
         const layouts = rows.map(function (g) {
            if (!g) return null;
            const layout = layoutGroup(doc, g, descriptionWidth - CELL_PADDING * 2, boxes);
            return layout.height <= maxRowHeight ? layout : null;
         });
         const body = rows.map(function (g, i) {
            if (!g) return phaseEnabled ? ['', '', ''] : ['', ''];
            const description = layouts[i]
               ? { content: '', styles: { minCellHeight: Math.max(10, layouts[i].height) } }
               : [g.description, moduleMetadata(g, boxes)].filter(Boolean).concat((g.items || []).map(function (item) {
                  return '\u2022 ' + item;
               })).join('\n');
            const row = [rcd.cellText(g.number, entries[i], rcdFirst), description];
            const protection = window.GroepenkaartSchema.moduleTypes.allPhases(g.type) ? null : entries[i] && entries[i].rcd;
            if (phaseEnabled) row.push(rcd.phaseText(rcd.groupPhases(g, protection)));
            return row;
         });

         doc.autoTable({
            startY: 26.5 + offset + supplyHeight + keyHeight,
            margin: { top: MARGIN_Y, bottom: MARGIN_Y, left: margin, right: margin },
            rowPageBreak: 'avoid',
            head: [phaseEnabled ? ['Module', 'Omschrijving', 'Fasen'] : ['Module', 'Omschrijving']],
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
      return doc;
   }

   // Returns false when the PDF cannot be built.
   function download() {
      const doc = build.apply(null, arguments);
      if (!doc) return false;
      doc.save('groepenkaart.pdf');
      return true;
   }

   // Returns the PDF as a Blob, or null when it cannot be built.
   function preview() {
      const doc = build.apply(null, arguments);
      return doc ? doc.output('blob') : null;
   }

   window.GroepenkaartPdf = { download: download, preview: preview, today: today };
})();
