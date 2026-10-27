(function () {
   'use strict';

   // Letters become "x" and digits "0"; spaces and punctuation stay, so text length and wrapping (and thus the layout) survive.
   function mask(text) {
      return text.replace(/\p{L}/gu, 'x').replace(/\p{N}/gu, '0');
   }

   /**
    * Validates and migrates a card like an import does, then masks every free-text field that can identify a person
    * or place. Fields outside the schema are dropped by the validation. Returns the anonymized card and the number of
    * masked values.
    */
   function anonymize(input) {
      const data = window.GroepenkaartSchema.normalize(input);
      let masked = 0;
      function scrub(text) {
         if (!text) return text;
         masked += 1;
         return mask(text);
      }
      data.generalInfo = scrub(data.generalInfo);
      data.boxes.forEach(function (box) {
         box.name = scrub(box.name);
         const supply = box.supply;
         if (!supply) return;
         ['supplier', 'customConnectionRating', 'preFuse'].forEach(function (field) {
            if (supply[field] !== undefined) supply[field] = scrub(supply[field]);
         });
      });
      data.modules.forEach(function (module) {
         module.description = scrub(module.description);
         if (module.name !== undefined) module.name = scrub(module.name);
         if (module.items !== undefined) module.items = module.items.map(scrub);
      });
      return { data: data, masked: masked };
   }

   window.GroepenkaartAnonymize = { anonymize: anonymize, mask: mask };
})();
