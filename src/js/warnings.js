(function () {
   'use strict';

   const codes = ['pv', 'ev', 'battery', 'heat-pump'];
   const definitions = [
      {
         id: 'pv',
         label: 'PV-installatie (zonnepanelen)',
         badge: 'PV',
         image: 'images/pv.svg'
      },
      {
         id: 'ev',
         label: 'EV-lader',
         badge: 'EV',
         image: 'images/ev.svg'
      },
      {
         id: 'battery',
         label: 'Thuisbatterij (EOS)',
         badge: 'EOS',
         image: 'images/eos.svg'
      }
   ];

   function normalize(value) {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.some(function (id) {
         return !codes.includes(id);
      })) {
         throw new Error('Ongeldig bestand: "warnings" moet een lijst met bekende installatiecodes zijn.');
      }
      return codes.filter(function (id) { return value.includes(id); });
   }

   function selected(ids) {
      return definitions.filter(function (warning) { return ids.includes(warning.id); });
   }

   // The first page lists every installation; a sub-distribution page lists its own and those of the boxes it feeds,
   // directly or through other sub-distributions. Linked boxes show none.
   function forPage(box, index, allIds, boxes) {
      if (index === 0) return allIds;
      if (!box.supply || box.supply.type !== 'subdistribution') return [];
      const own = [];
      const seen = new Set();
      (function collect(current) {
         if (seen.has(current)) return;
         seen.add(current);
         current.groups.forEach(function (module) { own.push.apply(own, module.warnings || []); });
         (boxes || []).forEach(function (candidate) {
            const supply = candidate.supply;
            if (supply && supply.type === 'subdistribution' && supply.sourceModuleId &&
               current.groups.some(function (module) { return module.id === supply.sourceModuleId; })) {
               collect(candidate);
            }
         });
      })(box);
      return codes.filter(function (code) { return own.includes(code); });
   }

   window.GroepenkaartWarnings = { codes: codes, definitions: definitions, normalize: normalize, selected: selected, forPage: forPage };
})();
