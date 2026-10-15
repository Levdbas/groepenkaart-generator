(function () {
   'use strict';

   const codes = ['pv', 'ev', 'battery', 'heat-pump'];
   const definitions = [
      {
         id: 'pv',
         label: 'PV-installatie (zonnepanelen)',
         image: 'images/pv.svg'
      },
      {
         id: 'ev',
         label: 'EV-lader',
         image: 'images/ev.svg'
      },
      {
         id: 'battery',
         label: 'Thuisbatterij (EOS)',
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

   window.GroepenkaartWarnings = { codes: codes, definitions: definitions, normalize: normalize, selected: selected };
})();
