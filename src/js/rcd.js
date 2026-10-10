(function () {
   'use strict';

   const defaultColors = { A1: '#ed8c01', A2: '#009fe3', A3: '#95be1a' };
   const fallbackColor = '#9e9e9e';
   const colorPattern = /^#[0-9a-f]{6}$/i;
   const phaseCodes = ['L1', 'L2', 'L3'];
   const phaseColors = { L1: '#8B4513', L2: '#000000', L3: '#808080' };

   function rcdPhases(rcd) {
      return rcd.amountOfPoles === 4 ? phaseCodes.slice() : (rcd.phases || []).slice();
   }

   function groupPhases(group, rcd) {
      return rcd && rcd.amountOfPoles !== 4 ? rcdPhases(rcd) : (group.phases || []).slice();
   }

   function phaseText(phases) {
      return phases.length ? phases.join(', ') : 'Niet gekozen';
   }

   function isColor(value) {
      return typeof value === 'string' && colorPattern.test(value);
   }

   function rgb(color) {
      return [1, 3, 5].map(function (start) { return parseInt(color.slice(start, start + 2), 16); });
   }

   // Picks black or white text based on the WCAG relative luminance of the fill.
   function textColor(color) {
      const channels = rgb(color).map(function (value) {
         const c = value / 255;
         return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      return luminance > 0.179 ? '#000000' : '#ffffff';
   }

   function label(rcd, index) {
      return rcd.number.trim() || 'A' + (index + 1);
   }

   function nextNumber(rcds) {
      const nums = rcds.map(function (r) { const m = /^A(\d+)$/i.exec(r.number.trim()); return m ? parseInt(m[1], 10) : 0; });
      return 'A' + (Math.max.apply(null, [rcds.length].concat(nums)) + 1);
   }

   function defaultColor(number) {
      return defaultColors[number.trim().toUpperCase()] || fallbackColor;
   }

   // Returns a lookup of RCD id to {rcd, label} for rendering.
   function index(rcds) {
      const map = {};
      (rcds || []).forEach(function (rcd, i) { map[rcd.id] = { rcd: rcd, label: label(rcd, i) }; });
      return map;
   }

   // RCDs linked to at least one of the groups, in RCD list order, for the per-page key.
   function used(rcds, groups) {
      return (rcds || []).map(function (rcd, i) { return { rcd: rcd, label: label(rcd, i) }; })
         .filter(function (entry) { return groups.some(function (g) { return g.rcdId === entry.rcd.id; }); });
   }

   function unused(rcds, groups) {
      return (rcds || []).map(function (rcd, i) { return { rcd: rcd, label: label(rcd, i) }; })
         .filter(function (entry) { return !groups.some(function (g) { return g.rcdId === entry.rcd.id; }); });
   }

   function cellText(groupNumber, entry) {
      return entry ? [groupNumber, entry.label].filter(Boolean).join(' · ') : groupNumber;
   }

   function keyText(entry, phaseEnabled) {
      const text = entry.rcd.name.trim() ? entry.label + ' – ' + entry.rcd.name.trim() : entry.label;
      return phaseEnabled ? text + ' (' + (entry.rcd.amountOfPoles || 2) + 'P; ' + phaseText(rcdPhases(entry.rcd)) + ')' : text;
   }

   window.GroepenkaartRcd = {
      defaultColors: defaultColors, fallbackColor: fallbackColor, isColor: isColor, rgb: rgb, textColor: textColor, label: label,
      nextNumber: nextNumber, defaultColor: defaultColor, index: index, used: used, unused: unused, cellText: cellText, keyText: keyText,
      phaseCodes: phaseCodes, phaseColors: phaseColors, rcdPhases: rcdPhases, groupPhases: groupPhases, phaseText: phaseText
   };
})();
