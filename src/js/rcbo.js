(function () {
   'use strict';

   const defaultColors = { A1: '#ed8c01', A2: '#009fe3', A3: '#95be1a' };
   const fallbackColor = '#9e9e9e';
   const colorPattern = /^#[0-9a-f]{6}$/i;

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

   function label(rcbo, index) {
      return rcbo.number.trim() || 'A' + (index + 1);
   }

   function nextNumber(rcbos) {
      const nums = rcbos.map(function (r) { const m = /^A(\d+)$/i.exec(r.number.trim()); return m ? parseInt(m[1], 10) : 0; });
      return 'A' + (Math.max.apply(null, [rcbos.length].concat(nums)) + 1);
   }

   function defaultColor(number) {
      return defaultColors[number.trim().toUpperCase()] || fallbackColor;
   }

   // Returns a lookup of RCBO id to {rcbo, label} for rendering.
   function index(rcbos) {
      const map = {};
      (rcbos || []).forEach(function (rcbo, i) { map[rcbo.id] = { rcbo: rcbo, label: label(rcbo, i) }; });
      return map;
   }

   // RCBOs linked to at least one of the groups, in RCBO list order, for the per-page key.
   function used(rcbos, groups) {
      return (rcbos || []).map(function (rcbo, i) { return { rcbo: rcbo, label: label(rcbo, i) }; })
         .filter(function (entry) { return groups.some(function (g) { return g.rcboId === entry.rcbo.id; }); });
   }

   function cellText(groupNumber, entry) {
      return entry ? [groupNumber, entry.label].filter(Boolean).join(' · ') : groupNumber;
   }

   function keyText(entry) {
      return entry.rcbo.name.trim() ? entry.label + ' – ' + entry.rcbo.name.trim() : entry.label;
   }

   window.GroepenkaartRcbo = {
      defaultColors: defaultColors, fallbackColor: fallbackColor, isColor: isColor, rgb: rgb, textColor: textColor, label: label,
      nextNumber: nextNumber, defaultColor: defaultColor, index: index, used: used, cellText: cellText, keyText: keyText
   };
})();
