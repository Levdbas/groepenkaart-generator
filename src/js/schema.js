(function () {
   'use strict';

   /**
    * @typedef {'pv' | 'ev' | 'battery' | 'heat-pump'} WarningCode
    * @typedef {'L1' | 'L2' | 'L3'} PhaseCode
    * @typedef {{id: string, number: string, name: string, color: string, amountOfPoles: 2 | 4, phases: PhaseCode[]}} RcdData
    * @typedef {{number: string, description: string, rcdId: string | null, phases: PhaseCode[], items?: string[]}} GroupData
    * @typedef {{number: string, name: string, groups: GroupData[]}} BoxData
    * @typedef {{schemaVersion: 4, warnings: WarningCode[], qrEnabled: boolean, rcdEnabled: boolean, phaseEnabled: boolean, rcds: RcdData[], boxes: BoxData[]}} CardData
    */

   const currentVersion = 4;
   const schemaUrl = 'https://raw.githubusercontent.com/Levdbas/groepenkaart-generator/main/schemas/groepenkaart-v' + currentVersion + '.schema.json';
   const warnings = window.GroepenkaartWarnings;
   const rcdHelpers = window.GroepenkaartRcd;

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
                        description: legacyString(group.description),
                        ...normalizeItems(group)
                     };
                  })
               };
            })
         };
      },
      // Adds RCBO support using the version 2 field names (version 3 renames them to RCD): disabled, no RCBOs and
      // no group links. Shape errors are reported by the final validation.
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
      },
      // Adds phase support, renames RCBO to RCD (rcboEnabled -> rcdEnabled, rcbos -> rcds, rcboId -> rcdId) and merges
      // each group's name into its description. Fields already present (from earlier phase-aware v2 files) are kept,
      // missing ones get their defaults, and a missing 4-pole phase list is derived. Other shape errors are reported
      // by the final validation.
      2: function (data) {
         if (!Array.isArray(data.boxes)) throw new Error('Ongeldig bestand: "boxes" ontbreekt.');
         const has = function (value, key) { return Object.prototype.hasOwnProperty.call(value, key); };
         const migrated = Object.assign({}, data, {
            schemaVersion: 3,
            phaseEnabled: has(data, 'phaseEnabled') ? data.phaseEnabled : false,
            rcdEnabled: data.rcboEnabled,
            rcds: Array.isArray(data.rcbos) ? data.rcbos.map(function (rcd) {
               if (!isObject(rcd)) return rcd;
               const amountOfPoles = has(rcd, 'amountOfPoles') ? rcd.amountOfPoles : 2;
               return Object.assign({}, rcd, {
                  amountOfPoles: amountOfPoles,
                  phases: has(rcd, 'phases') ? rcd.phases : (amountOfPoles === 4 ? rcdHelpers.phaseCodes.slice() : [])
               });
            }) : data.rcbos,
            boxes: data.boxes.map(function (box) {
               if (!isObject(box) || !Array.isArray(box.groups)) return box;
               return Object.assign({}, box, {
                  groups: box.groups.map(function (group) {
                     if (!isObject(group)) return group;
                     if (typeof group.name !== 'string') {
                        throw new Error('Ongeldig bestand: een groep moet tekstvelden bevatten: number, name, description.');
                     }
                     const migratedGroup = Object.assign({}, group, {
                        description: typeof group.description === 'string'
                           ? mergeGroupName(group.name, group.description) : group.description,
                        rcdId: group.rcboId
                     });
                     delete migratedGroup.name;
                     delete migratedGroup.rcboId;
                     if (!has(migratedGroup, 'phases')) migratedGroup.phases = [];
                     return migratedGroup;
                  })
               });
            })
         });
         delete migrated.rcboEnabled;
         delete migrated.rcbos;
         return migrated;
      },
      // Adds the optional QR code on the last PDF page: disabled by default.
      3: function (data) {
         return Object.assign({}, data, { schemaVersion: 4, qrEnabled: false });
      }
   };

   // Prefixes the description with the former group name, so no text is lost when the name field is dropped.
   function mergeGroupName(name, description) {
      const prefix = name.trim();
      if (!prefix) return description;
      return description.trim() ? prefix + ' – ' + description : prefix;
   }

   function requireStrings(value, fields, label) {
      if (!isObject(value) || fields.some(function (field) { return typeof value[field] !== 'string'; })) {
         throw new Error('Ongeldig bestand: ' + label + ' moet tekstvelden bevatten: ' + fields.join(', ') + '.');
      }
   }

   function normalizeItems(group) {
      if (!Object.prototype.hasOwnProperty.call(group, 'items')) return {};
      if (!Array.isArray(group.items) || group.items.some(function (item) { return typeof item !== 'string'; })) {
         throw new Error('Ongeldig bestand: "items" van een groep moet een lijst met tekst zijn.');
      }
      return { items: group.items.slice() };
   }

   /** @returns {CardData} */
   function empty() {
      return { schemaVersion: currentVersion, warnings: [], qrEnabled: false, rcdEnabled: false, phaseEnabled: false, rcds: [], boxes: [] };
   }

   function normalizePhases(value) {
      if (!Array.isArray(value.phases) ||
         value.phases.some(function (phase) { return !rcdHelpers.phaseCodes.includes(phase); }) ||
         new Set(value.phases).size !== value.phases.length) {
         throw new Error('Ongeldig bestand: "phases" moet een lijst met unieke fasen L1, L2 of L3 zijn.');
      }
      return rcdHelpers.phaseCodes.filter(function (phase) { return value.phases.includes(phase); });
   }

   function normalizeRcds(data) {
      if (typeof data.rcdEnabled !== 'boolean') throw new Error('Ongeldig bestand: "rcdEnabled" moet waar of onwaar zijn.');
      if (!Array.isArray(data.rcds)) throw new Error('Ongeldig bestand: "rcds" moet een lijst zijn.');
      if (!data.rcdEnabled && data.rcds.length) {
         throw new Error('Ongeldig bestand: Aardlekschakelaars zijn uitgeschakeld maar "rcds" is niet leeg.');
      }
      const ids = {};
      return data.rcds.map(function (rcd) {
         requireStrings(rcd, ['id', 'number', 'name', 'color'], 'een aardlekschakelaar');
         if (!rcd.id) throw new Error('Ongeldig bestand: een aardlekschakelaar heeft een lege "id".');
         if (ids[rcd.id]) throw new Error('Ongeldig bestand: dubbele aardlekschakelaar-id "' + rcd.id + '".');
         if (!rcdHelpers.isColor(rcd.color)) {
            throw new Error('Ongeldig bestand: kleur van aardlekschakelaar moet een hexkleur zijn, zoals #ed8c01.');
         }
         const amountOfPoles = rcd.amountOfPoles;
         if (amountOfPoles !== 2 && amountOfPoles !== 4) {
            throw new Error('Ongeldig bestand: "amountOfPoles" van een aardlekschakelaar moet 2 of 4 zijn.');
         }
         const phases = normalizePhases(rcd);
         if (amountOfPoles === 2 && phases.length > 1) {
            throw new Error('Ongeldig bestand: een 2-polige aardlekschakelaar kan maar één fase hebben.');
         }
         if (amountOfPoles === 4 && phases.length !== 3) {
            throw new Error('Ongeldig bestand: een 4-polige aardlekschakelaar heeft alle drie de fasen.');
         }
         ids[rcd.id] = true;
         return { id: rcd.id, number: rcd.number, name: rcd.name, color: rcd.color.toLowerCase(), amountOfPoles: amountOfPoles, phases: phases };
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
      if (typeof data.phaseEnabled !== 'boolean') throw new Error('Ongeldig bestand: "phaseEnabled" moet waar of onwaar zijn.');
      if (typeof data.qrEnabled !== 'boolean') throw new Error('Ongeldig bestand: "qrEnabled" moet waar of onwaar zijn.');
      const rcds = normalizeRcds(data);
      const rcdIds = rcds.map(function (rcd) { return rcd.id; });
      return {
         schemaVersion: currentVersion,
         warnings: warnings.normalize(data.warnings),
         qrEnabled: data.qrEnabled,
         rcdEnabled: data.rcdEnabled,
         phaseEnabled: data.phaseEnabled,
         rcds: rcds,
         boxes: data.boxes.map(function (box) {
            requireStrings(box, ['number', 'name'], 'een kast');
            if (!Array.isArray(box.groups)) throw new Error('Ongeldig bestand: "groups" moet een lijst zijn.');
            return {
               number: box.number,
               name: box.name,
               groups: box.groups.map(function (group) {
                  requireStrings(group, ['number', 'description'], 'een groep');
                  if (group.rcdId !== null && typeof group.rcdId !== 'string') {
                     throw new Error('Ongeldig bestand: "rcdId" van een groep moet tekst of null zijn.');
                  }
                  if (group.rcdId !== null && rcdIds.indexOf(group.rcdId) === -1) {
                     throw new Error('Ongeldig bestand: groep ' + JSON.stringify(group.number) +
                        ' verwijst naar een onbekende aardlekschakelaar (' + JSON.stringify(group.rcdId) + ').');
                  }
                  return {
                     number: group.number, description: group.description, rcdId: group.rcdId,
                     phases: normalizePhases(group),
                     ...normalizeItems(group)
                  };
               })
            };
         })
      };
   }

   window.GroepenkaartSchema = { currentVersion: currentVersion, schemaUrl: schemaUrl, empty: empty, normalize: normalize };
})();
