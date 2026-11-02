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
   const specialInstallationCodes = ['smoke-alarm', 'burglar-alarm'];
   const specialInstallationDefinitions = [
      { id: 'smoke-alarm', label: 'Rookmelders', badge: 'RM' },
      { id: 'burglar-alarm', label: 'Alarminstallatie', badge: 'AL' }
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

   function normalizeSpecialInstallations(value) {
      if (value === undefined) return [];
      if (!Array.isArray(value) || value.some(function (id) {
         return !specialInstallationCodes.includes(id);
      })) {
         throw new Error('Ongeldig bestand: "specialInstallations" moet een lijst met bekende bijzondere installaties zijn.');
      }
      return specialInstallationCodes.filter(function (id) { return value.includes(id); });
   }

   function selectedSpecialInstallations(ids) {
      return specialInstallationDefinitions.filter(function (installation) { return ids.includes(installation.id); });
   }

   // The warnings of a box's modules plus those of the boxes it feeds, directly or through other sub-distributions.
   function collectWarnings(box, boxes) {
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

   // The first page lists every installation; a sub-distribution page lists its own and those of the boxes it feeds,
   // directly or through other sub-distributions. Linked boxes show none.
   function forPage(box, index, allIds, boxes) {
      if (index === 0) return allIds;
      if (!box.supply || box.supply.type !== 'subdistribution') return [];
      return collectWarnings(box, boxes);
   }

   // The legend entries of a box: installations flagged on its modules, including those inherited from boxes it feeds.
   function legendFor(box, boxes) {
      const flagged = collectWarnings(box, boxes);
      const special = box.groups.flatMap(function (module) { return module.specialInstallations || []; });
      return {
         warnings: definitions.filter(function (warning) { return flagged.includes(warning.id); }),
         specialInstallations: specialInstallationDefinitions.filter(function (installation) { return special.includes(installation.id); })
      };
   }

   window.GroepenkaartWarnings = {
      codes: codes, definitions: definitions, normalize: normalize, selected: selected, forPage: forPage, legendFor: legendFor,
      specialInstallationCodes: specialInstallationCodes, specialInstallationDefinitions: specialInstallationDefinitions,
      normalizeSpecialInstallations: normalizeSpecialInstallations, selectedSpecialInstallations: selectedSpecialInstallations
   };
})();
