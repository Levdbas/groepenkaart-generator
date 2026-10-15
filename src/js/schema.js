(function () {
   'use strict';

   /**
    * @typedef {'pv' | 'ev' | 'battery' | 'heat-pump'} WarningCode
    * @typedef {'L1' | 'L2' | 'L3'} PhaseCode
   * @typedef {{id: string, boxId: string | null, type: string, number: string, description: string, name?: string, color?: string, characteristic: string, phases: PhaseCode[], protectedByModuleId: string | null, items?: string[], sensitivity?: 10 | 30 | 100 | 300, rcdType?: 'AC' | 'A' | 'F' | 'B' | 'B+', ratedCurrent?: number}} ModuleData
   * @typedef {{id: string, number: string, name: string, moduleIds: string[], supply: object | null}} BoxData
   * @typedef {{schemaVersion: 5, warnings: WarningCode[], qrEnabled: boolean, rcdEnabled: boolean, phaseEnabled: boolean, modules: ModuleData[], boxes: BoxData[]}} CardData
    */

   const currentVersion = 5;
   const schemaUrl = 'https://raw.githubusercontent.com/Levdbas/groepenkaart-generator/main/schemas/groepenkaart-v' + currentVersion + '.schema.json';
   const warnings = window.GroepenkaartWarnings;
   const rcdHelpers = window.GroepenkaartRcd;
   const moduleTypes = window.GroepenkaartModuleTypes;
   const protectiveTypes = ['RCD-2P', 'RCD-4P', 'RCBO-2P', 'RCBO-4P'];
   const connectionRatings = ['1x25A', '1x35A', '1x40A', '3x25A', '3x35A', '3x40A', '3x50A', '3x63A', '3x80A', 'Anders'];

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
      },
      4: function (data) {
         if (!Array.isArray(data.rcds)) throw new Error('Ongeldig bestand: "rcds" moet een lijst zijn.');
         data.rcds.forEach(function (rcd) {
            requireStrings(rcd, ['id', 'number', 'name', 'color'], 'een aardlekschakelaar');
            if (rcd.amountOfPoles !== 2 && rcd.amountOfPoles !== 4) {
               throw new Error('Ongeldig bestand: "amountOfPoles" van een aardlekschakelaar moet 2 of 4 zijn.');
            }
            const phases = normalizePhases(rcd);
            if (rcd.amountOfPoles === 2 && phases.length > 1) throw new Error('Ongeldig bestand: een 2-polige aardlekschakelaar kan maar één fase hebben.');
            if (rcd.amountOfPoles === 4 && phases.length !== 3) throw new Error('Ongeldig bestand: een 4-polige aardlekschakelaar heeft alle drie de fasen.');
         });
         const usedIds = new Set((data.rcds || []).map(function (rcd) { return rcd && rcd.id; }).filter(Boolean));
         function moduleId(boxIndex, moduleIndex) {
            const base = 'legacy-module-' + (boxIndex + 1) + '-' + (moduleIndex + 1);
            let id = base;
            let suffix = 1;
            while (usedIds.has(id)) id = base + '-' + suffix++;
            usedIds.add(id);
            return id;
         }
         const modules = [];
         const boxes = data.boxes.map(function (box, boxIndex) {
            if (!isObject(box) || !Array.isArray(box.groups)) throw new Error('Ongeldig bestand: "groups" moet een lijst zijn.');
            const id = 'legacy-box-' + (boxIndex + 1);
            const moduleIds = box.groups.map(function (group, moduleIndex) {
               if (!isObject(group)) throw new Error('Ongeldige module in bestand.');
               const moduleIdValue = moduleId(boxIndex, moduleIndex);
               modules.push({
                  id: moduleIdValue,
                  boxId: id,
                  type: 'MCB',
                  number: group.number,
                  description: group.description,
                  characteristic: '',
                  phases: Array.isArray(group.phases) ? group.phases.slice() : [],
                  protectedByModuleId: group.rcdId,
                  ...(Object.prototype.hasOwnProperty.call(group, 'items') ? { items: group.items } : {})
               });
               return moduleIdValue;
            });
            return { id: id, number: box.number, name: box.name, moduleIds: moduleIds, supply: null };
         });
         (data.rcds || []).forEach(function (rcd) {
            modules.push({
               id: rcd.id,
               boxId: null,
               type: rcd.amountOfPoles === 4 ? 'RCD-4P' : 'RCD-2P',
               number: rcd.number,
               name: rcd.name,
               color: rcd.color,
               description: '',
               characteristic: '',
               phases: rcd.phases.slice(),
               protectedByModuleId: null
            });
         });
         return {
            schemaVersion: 5,
            warnings: data.warnings,
            qrEnabled: data.qrEnabled,
            rcdEnabled: data.rcdEnabled,
            phaseEnabled: data.phaseEnabled,
            modules: modules,
            boxes: boxes
         };
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
      return { schemaVersion: currentVersion, warnings: [], qrEnabled: false, rcdEnabled: false, phaseEnabled: false, modules: [], boxes: [] };
   }

   function normalizePhases(value) {
      if (!Array.isArray(value.phases) ||
         value.phases.some(function (phase) { return !rcdHelpers.phaseCodes.includes(phase); }) ||
         new Set(value.phases).size !== value.phases.length) {
         throw new Error('Ongeldig bestand: "phases" moet een lijst met unieke fasen L1, L2 of L3 zijn.');
      }
      return rcdHelpers.phaseCodes.filter(function (phase) { return value.phases.includes(phase); });
   }

   function normalizeModules(data, boxIds) {
      if (typeof data.rcdEnabled !== 'boolean') throw new Error('Ongeldig bestand: "rcdEnabled" moet waar of onwaar zijn.');
      if (!Array.isArray(data.modules)) throw new Error('Ongeldig bestand: "modules" moet een lijst zijn.');
      const ids = new Set();
      return data.modules.map(function (module) {
         requireStrings(module, ['id', 'type', 'number', 'description', 'characteristic'], 'een module');
         if (!module.id) throw new Error('Ongeldig bestand: een module heeft een lege "id".');
         if (ids.has(module.id)) throw new Error('Ongeldig bestand: dubbele module-id "' + module.id + '".');
         if (!moduleTypes.get(module.type)) throw new Error('Ongeldig bestand: onbekend moduletype "' + module.type + '".');
         if (module.boxId !== null && (typeof module.boxId !== 'string' || !boxIds.includes(module.boxId))) {
            throw new Error('Ongeldig bestand: "boxId" van module ' + JSON.stringify(module.id) + ' verwijst naar een onbekende kast.');
         }
         const phases = normalizePhases(module);
         const protectedByModuleId = module.protectedByModuleId;
         if (protectedByModuleId !== null && typeof protectedByModuleId !== 'string') {
            throw new Error('Ongeldig bestand: "protectedByModuleId" moet tekst of null zijn.');
         }
         if (module.name !== undefined && typeof module.name !== 'string') throw new Error('Ongeldig bestand: "name" van een module moet tekst zijn.');
         if (module.color !== undefined && (!protectiveTypes.includes(module.type) || !rcdHelpers.isColor(module.color))) {
            throw new Error('Ongeldig bestand: de kleur van een beveiligingsmodule moet een hexkleur zijn.');
         }
         if (module.sensitivity !== undefined && ![10, 30, 100, 300].includes(module.sensitivity)) {
            throw new Error('Ongeldig bestand: "sensitivity" moet 10, 30, 100 of 300 mA zijn.');
         }
         if (module.rcdType !== undefined && !['AC', 'A', 'F', 'B', 'B+'].includes(module.rcdType)) {
            throw new Error('Ongeldig bestand: onbekend aardlektype.');
         }
         if (module.ratedCurrent !== undefined && (!Number.isFinite(module.ratedCurrent) || module.ratedCurrent <= 0)) {
            throw new Error('Ongeldig bestand: "ratedCurrent" moet een positief getal zijn.');
         }
         if (['RCD-2P', 'RCBO-2P'].includes(module.type) && phases.length > 1) {
            throw new Error('Ongeldig bestand: een 2-polige beveiligingsmodule kan maar één fase hebben.');
         }
         if (['RCD-4P', 'RCBO-4P'].includes(module.type) && phases.length !== 3) {
            throw new Error('Ongeldig bestand: een 4-polige beveiligingsmodule heeft alle drie de fasen.');
         }
         ids.add(module.id);
         return {
            id: module.id,
            boxId: module.boxId,
            type: module.type,
            number: module.number,
            description: module.description,
            characteristic: module.characteristic,
            phases: phases,
            protectedByModuleId: protectedByModuleId,
            ...(module.name !== undefined ? { name: module.name } : {}),
            ...(module.color !== undefined ? { color: module.color.toLowerCase() } : {}),
            ...(module.sensitivity !== undefined ? { sensitivity: module.sensitivity } : {}),
            ...(module.rcdType !== undefined ? { rcdType: module.rcdType } : {}),
            ...(module.ratedCurrent !== undefined ? { ratedCurrent: module.ratedCurrent } : {}),
            ...normalizeItems(module)
         };
      });
   }

   function normalizeSupply(supply, modules) {
      if (supply === null) return null;
      if (!isObject(supply) || !['mains', 'subdistribution'].includes(supply.type)) {
         throw new Error('Ongeldig bestand: "supply" moet mains, subdistribution of null zijn.');
      }
      const result = { type: supply.type };
      if (supply.type === 'mains') {
         if (supply.connectionRating !== undefined) {
            if (!connectionRatings.includes(supply.connectionRating)) throw new Error('Ongeldig bestand: onbekende "connectionRating".');
            result.connectionRating = supply.connectionRating;
         }
         if (supply.customConnectionRating !== undefined) {
            if (typeof supply.customConnectionRating !== 'string' || supply.connectionRating !== 'Anders') {
               throw new Error('Ongeldig bestand: "customConnectionRating" is alleen geldig bij een andere aansluitwaarde.');
            }
            result.customConnectionRating = supply.customConnectionRating;
         }
         if (supply.supplier !== undefined) {
            if (typeof supply.supplier !== 'string') throw new Error('Ongeldig bestand: "supplier" moet tekst zijn.');
            result.supplier = supply.supplier;
         }
      } else {
         if (supply.sourceModuleId !== undefined && supply.sourceModuleId !== null && typeof supply.sourceModuleId !== 'string') {
            throw new Error('Ongeldig bestand: "sourceModuleId" moet tekst of null zijn.');
         }
         const source = supply.sourceModuleId && modules.find(function (module) { return module.id === supply.sourceModuleId; });
         if (supply.sourceModuleId && !source) {
            throw new Error('Ongeldig bestand: "sourceModuleId" verwijst naar een onbekende module.');
         }
         if (source && (!source.boxId || !['MCB', 'MCB-2P', 'MCB-3P', 'RCBO-2P', 'RCBO-4P'].includes(source.type))) {
            throw new Error('Ongeldig bestand: een voeding moet verwijzen naar een geplaatste circuitmodule.');
         }
         if (supply.sourceModuleId !== undefined) result.sourceModuleId = supply.sourceModuleId;
         if (supply.preFuse !== undefined) {
            if (typeof supply.preFuse !== 'string') throw new Error('Ongeldig bestand: "preFuse" moet tekst zijn.');
            result.preFuse = supply.preFuse;
         }
         if (supply.cableCores !== undefined) {
            if (!Number.isInteger(supply.cableCores) || supply.cableCores < 1) throw new Error('Ongeldig bestand: "cableCores" moet een positief geheel getal zijn.');
            result.cableCores = supply.cableCores;
         }
         if (supply.cableCrossSection !== undefined) {
            if (!Number.isFinite(supply.cableCrossSection) || supply.cableCrossSection <= 0) throw new Error('Ongeldig bestand: "cableCrossSection" moet een positief getal zijn.');
            result.cableCrossSection = supply.cableCrossSection;
         }
      }
      ['mainSwitchCurrent'].forEach(function (field) {
         if (supply[field] !== undefined) {
            if (!Number.isFinite(supply[field]) || supply[field] <= 0) throw new Error('Ongeldig bestand: "' + field + '" moet een positief getal zijn.');
            result[field] = supply[field];
         }
      });
      if (supply.mainSwitchPoles !== undefined) {
         if (![2, 4].includes(supply.mainSwitchPoles)) throw new Error('Ongeldig bestand: "mainSwitchPoles" moet 2 of 4 zijn.');
         result.mainSwitchPoles = supply.mainSwitchPoles;
      }
      return result;
   }

   function validateFeedGraph(boxes, modules) {
      const moduleById = Object.fromEntries(modules.map(function (module) { return [module.id, module]; }));
      const boxById = Object.fromEntries(boxes.map(function (box) { return [box.id, box]; }));
      const visiting = new Set();
      const visited = new Set();
      function visit(boxId) {
         if (visiting.has(boxId)) throw new Error('Ongeldig bestand: de voeding bevat een kringverwijzing tussen kasten.');
         if (visited.has(boxId)) return;
         visiting.add(boxId);
         const box = boxById[boxId];
         const sourceId = box.supply && box.supply.type === 'subdistribution' && box.supply.sourceModuleId;
         const source = sourceId && moduleById[sourceId];
         if (source && source.boxId) visit(source.boxId);
         visiting.delete(boxId);
         visited.add(boxId);
      }
      boxes.forEach(function (box) { visit(box.id); });
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
      if (typeof data.rcdEnabled !== 'boolean') throw new Error('Ongeldig bestand: "rcdEnabled" moet waar of onwaar zijn.');
      const boxIds = data.boxes.map(function (box) {
         requireStrings(box, ['id', 'number', 'name'], 'een kast');
         return box.id;
      });
      if (new Set(boxIds).size !== boxIds.length) throw new Error('Ongeldig bestand: dubbele kast-id.');
      const modules = normalizeModules(data, boxIds);
      const moduleIds = modules.map(function (module) { return module.id; });
      const moduleById = Object.fromEntries(modules.map(function (module) { return [module.id, module]; }));
      if (!data.rcdEnabled && modules.some(function (module) { return protectiveTypes.includes(module.type); })) {
         throw new Error('Ongeldig bestand: beveiligingsmodules bestaan terwijl aardlekschakelaars zijn uitgeschakeld.');
      }
      modules.forEach(function (module) {
         if (module.protectedByModuleId !== null) {
            const protection = moduleById[module.protectedByModuleId];
            if (module.id === module.protectedByModuleId) throw new Error('Ongeldig bestand: een module kan niet naar zichzelf verwijzen als beveiliging.');
            if (!protection || !protectiveTypes.includes(protection.type)) {
               throw new Error('Ongeldig bestand: "protectedByModuleId" verwijst niet naar een RCD- of RCBO-module.');
            }
         }
      });
      if (modules.some(function (module) { return protectiveTypes.includes(module.type) && module.color === undefined; })) {
         throw new Error('Ongeldig bestand: een beveiligingsmodule moet een kleur hebben.');
      }
      const boxes = data.boxes.map(function (box) {
         if (!Array.isArray(box.moduleIds)) throw new Error('Ongeldig bestand: "moduleIds" moet een lijst zijn.');
         if (new Set(box.moduleIds).size !== box.moduleIds.length) throw new Error('Ongeldig bestand: dubbele moduleverwijzing in een kast.');
         box.moduleIds.forEach(function (id) {
            const module = moduleById[id];
            if (!module || module.boxId !== box.id) throw new Error('Ongeldig bestand: moduleverwijzing hoort niet bij deze kast.');
         });
         return {
            id: box.id,
            number: box.number,
            name: box.name,
            moduleIds: box.moduleIds.slice(),
            supply: normalizeSupply(box.supply === undefined ? null : box.supply, modules)
         };
      });
      modules.forEach(function (module) {
         if (module.boxId && !boxes.some(function (box) { return box.id === module.boxId && box.moduleIds.includes(module.id); })) {
            throw new Error('Ongeldig bestand: module ontbreekt in de modulevolgorde van de kast.');
         }
      });
      validateFeedGraph(boxes, modules);
      if (!data.rcdEnabled && modules.some(function (module) { return module.protectedByModuleId !== null; })) {
         throw new Error('Ongeldig bestand: modulebeveiliging is uitgeschakeld maar een module heeft een beveiligingskoppeling.');
      }
      return {
         schemaVersion: currentVersion,
         warnings: warnings.normalize(data.warnings),
         qrEnabled: data.qrEnabled,
         rcdEnabled: data.rcdEnabled,
         phaseEnabled: data.phaseEnabled,
         modules: modules,
         boxes: boxes
      };
   }

   window.GroepenkaartSchema = { currentVersion: currentVersion, schemaUrl: schemaUrl, empty: empty, normalize: normalize };
})();
