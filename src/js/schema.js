(function () {
   'use strict';

   /**
    * @typedef {'pv' | 'ev' | 'battery' | 'heat-pump'} WarningCode
    * @typedef {{id: string, number: string, name: string, color: string}} RcboData
    * @typedef {{number: string, name: string, description: string, rcboId: string | null}} GroupData
    * @typedef {{number: string, name: string, groups: GroupData[]}} BoxData
    * @typedef {{schemaVersion: 2, warnings: WarningCode[], rcboEnabled: boolean, rcbos: RcboData[], boxes: BoxData[]}} CardData
    */

   const currentVersion = 2;
   const schemaUrl = 'https://raw.githubusercontent.com/Levdbas/groepenkaart-generator/main/schemas/groepenkaart-v' + currentVersion + '.schema.json';
   const warnings = window.GroepenkaartWarnings;
   const rcboHelpers = window.GroepenkaartRcbo;

   function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value);
   }

   function legacyString(value) {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' && isFinite(value)) return String(value);
      return '';
   }

   // Each migration converts version N to N + 1 without modifying the input.
   const migrations = {
      0: function (data) {
         if (!Array.isArray(data.boxes)) {
            throw new Error('Ongeldig bestand: "boxes" ontbreekt.');
         }
         return {
            schemaVersion: 1,
            warnings: warnings.normalize(data.warnings),
            boxes: data.boxes.map(function (box) {
               if (!isObject(box)) throw new Error('Ongeldige kast in bestand.');
               return {
                  number: legacyString(box.number),
                  name: legacyString(box.name),
                  groups: (Array.isArray(box.groups) ? box.groups : []).map(function (group) {
                     if (!isObject(group)) throw new Error('Ongeldige groep in bestand.');
                     return {
                        number: legacyString(group.number),
                        name: legacyString(group.name),
                        description: legacyString(group.description)
                     };
                  })
               };
            })
         };
      },
      // Adds RCBO support: disabled, no RCBOs and no group links. Shape errors are reported by the final validation.
      1: function (data) {
         if (!Array.isArray(data.boxes)) throw new Error('Ongeldig bestand: "boxes" ontbreekt.');
         return Object.assign({}, data, {
            schemaVersion: 2,
            rcboEnabled: false,
            rcbos: [],
            boxes: data.boxes.map(function (box) {
               if (!isObject(box) || !Array.isArray(box.groups)) return box;
               return Object.assign({}, box, {
                  groups: box.groups.map(function (group) {
                     return isObject(group) ? Object.assign({}, group, { rcboId: null }) : group;
                  })
               });
            })
         });
      }
   };

   function requireStrings(value, fields, label) {
      if (!isObject(value) || fields.some(function (field) { return typeof value[field] !== 'string'; })) {
         throw new Error('Ongeldig bestand: ' + label + ' moet tekstvelden bevatten: ' + fields.join(', ') + '.');
      }
   }

   /** @returns {CardData} */
   function empty() {
      return { schemaVersion: currentVersion, warnings: [], rcboEnabled: false, rcbos: [], boxes: [] };
   }

   function normalizeRcbos(data) {
      if (typeof data.rcboEnabled !== 'boolean') throw new Error('Ongeldig bestand: "rcboEnabled" moet waar of onwaar zijn.');
      if (!Array.isArray(data.rcbos)) throw new Error('Ongeldig bestand: "rcbos" moet een lijst zijn.');
      if (!data.rcboEnabled && data.rcbos.length) {
         throw new Error('Ongeldig bestand: Aardlekschakelaars zijn uitgeschakeld maar "rcbos" is niet leeg.');
      }
      const ids = {};
      return data.rcbos.map(function (rcbo) {
         requireStrings(rcbo, ['id', 'number', 'name', 'color'], 'een aardlekschakelaar');
         if (!rcbo.id) throw new Error('Ongeldig bestand: een aardlekschakelaar heeft een lege "id".');
         if (ids[rcbo.id]) throw new Error('Ongeldig bestand: dubbele aardlekschakelaar-id "' + rcbo.id + '".');
         if (!rcboHelpers.isColor(rcbo.color)) {
            throw new Error('Ongeldig bestand: kleur van aardlekschakelaar moet een hexkleur zijn, zoals #ed8c01.');
         }
         ids[rcbo.id] = true;
         return { id: rcbo.id, number: rcbo.number, name: rcbo.name, color: rcbo.color.toLowerCase() };
      });
   }

   /** @param {unknown} input @returns {CardData} */
   function normalize(input) {
      if (!isObject(input)) throw new Error('Ongeldig bestand: verwacht een object.');
      let data = input;
      let version = Object.prototype.hasOwnProperty.call(data, 'schemaVersion') ? data.schemaVersion : 0;
      if (!Number.isInteger(version) || version < 0) {
         throw new Error('Ongeldig bestand: "schemaVersion" moet een niet-negatief geheel getal zijn.');
      }
      if (version > currentVersion) {
         throw new Error('Dit bestand gebruikt een nieuwere schemaversie (' + version + '). Werk de app bij om het te openen.');
      }
      while (version < currentVersion) {
         const migrate = migrations[version];
         if (!migrate) throw new Error('Geen migratie beschikbaar voor schemaversie ' + version + '.');
         data = migrate(data);
         version += 1;
         if (data.schemaVersion !== version) throw new Error('Migratie naar schemaversie ' + version + ' mislukt.');
      }
      if (!Array.isArray(data.boxes)) throw new Error('Ongeldig bestand: "boxes" ontbreekt.');
      if (!Array.isArray(data.warnings)) throw new Error('Ongeldig bestand: "warnings" moet een lijst zijn.');
      const rcbos = normalizeRcbos(data);
      const rcboIds = rcbos.map(function (rcbo) { return rcbo.id; });
      return {
         schemaVersion: currentVersion,
         warnings: warnings.normalize(data.warnings),
         rcboEnabled: data.rcboEnabled,
         rcbos: rcbos,
         boxes: data.boxes.map(function (box) {
            requireStrings(box, ['number', 'name'], 'een kast');
            if (!Array.isArray(box.groups)) throw new Error('Ongeldig bestand: "groups" moet een lijst zijn.');
            return {
               number: box.number,
               name: box.name,
               groups: box.groups.map(function (group) {
                  requireStrings(group, ['number', 'name', 'description'], 'een groep');
                  if (group.rcboId !== null && typeof group.rcboId !== 'string') {
                     throw new Error('Ongeldig bestand: "rcboId" van een groep moet tekst of null zijn.');
                  }
                  if (group.rcboId !== null && rcboIds.indexOf(group.rcboId) === -1) {
                     throw new Error('Ongeldig bestand: groep ' + JSON.stringify(group.number) +
                        ' verwijst naar een onbekende aardlekschakelaar (' + JSON.stringify(group.rcboId) + ').');
                  }
                  return { number: group.number, name: group.name, description: group.description, rcboId: group.rcboId };
               })
            };
         })
      };
   }

   window.GroepenkaartSchema = { currentVersion: currentVersion, schemaUrl: schemaUrl, empty: empty, normalize: normalize };
})();
