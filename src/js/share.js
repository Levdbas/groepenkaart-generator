(function () {
   'use strict';

   // c1 describes schema v4. c2 describes schema v5 with modules and stable references packed by list position.
   // The original #data format is deflated JSON as base64url and remains read-only.
   const COMPACT_V4 = '#c1=';
   const COMPACT_V5 = '#c2=';
   const COMPACT_V6 = '#c3=';
   const LEGACY = '#data=';
   // The compact token uses only characters from the QR alphanumeric set that are safe in links, so it fits in
   // about 5.5 bits per character instead of 8.
   const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-+*$';
   const ALPHANUMERIC_TOKEN = /^[0-9A-Z$*+-]*$/;
   // A QR code cannot hold more than ~3000 characters, so a longer token is not one of ours. This also bounds inflation.
   const MAX_TOKEN_LENGTH = 4000;
   const PHASES = ['L1', 'L2', 'L3'];
   const fflate = window.fflate;

   function toBase40(bytes) {
      // A leading 1 keeps leading zero bytes from getting lost in the number conversion.
      let number = [1].concat(Array.from(bytes));
      const digits = [];
      while (number.length) {
         let remainder = 0;
         const quotient = [];
         number.forEach(function (byte) {
            const value = remainder * 256 + byte;
            const digit = Math.floor(value / ALPHABET.length);
            remainder = value % ALPHABET.length;
            if (quotient.length || digit) quotient.push(digit);
         });
         digits.push(ALPHABET[remainder]);
         number = quotient;
      }
      return digits.reverse().join('');
   }

   function fromBase40(token) {
      const bytes = []; // Little endian.
      for (let i = 0; i < token.length; i++) {
         let carry = ALPHABET.indexOf(token[i]);
         if (carry === -1) throw new Error('Ongeldig teken.');
         for (let j = 0; j < bytes.length; j++) {
            const value = bytes[j] * ALPHABET.length + carry;
            bytes[j] = value & 255;
            carry = value >> 8;
         }
         while (carry) {
            bytes.push(carry & 255);
            carry >>= 8;
         }
      }
      bytes.reverse();
      if (bytes[0] !== 1) throw new Error('Ongeldige gegevens.');
      return Uint8Array.from(bytes.slice(1));
   }

   function fromBase64Url(token) {
      if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('Ongeldig teken.');
      const binary = window.atob(token.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
   }

   function phaseMask(phases) {
      return PHASES.reduce(function (mask, phase, index) { return phases.includes(phase) ? mask | 1 << index : mask; }, 0);
   }

   function maskPhases(mask) {
      if (!Number.isInteger(mask) || mask < 0 || mask > 7) throw new Error('Ongeldige fasen.');
      return PHASES.filter(function (phase, index) { return mask & 1 << index; });
   }

   // Drops key names, UI-only data and the (long) RCD ids: groups refer to an RCD by its position in the list.
   function packV4(data) {
      const rcdIndex = {};
      data.rcds.forEach(function (rcd, index) { rcdIndex[rcd.id] = index; });
      return [
         data.warnings,
         (data.qrEnabled ? 1 : 0) | (data.rcdEnabled ? 2 : 0) | (data.phaseEnabled ? 4 : 0),
         data.rcds.map(function (rcd) {
            return [rcd.number, rcd.name, rcd.color, rcd.amountOfPoles, phaseMask(rcd.phases)];
         }),
         data.boxes.map(function (box) {
            return [box.number, box.name, box.groups.map(function (group) {
               const row = [group.number, group.description, group.rcdId === null ? -1 : rcdIndex[group.rcdId], phaseMask(group.phases)];
               if (group.items) row.push(group.items);
               return row;
            })];
         })
      ];
   }

   function unpackV4(packed) {
      const flags = packed[1];
      const ids = packed[2].map(function (rcd, index) { return 'r' + (index + 1); });
      return {
         schemaVersion: 4,
         warnings: packed[0],
         qrEnabled: !!(flags & 1),
         rcdEnabled: !!(flags & 2),
         phaseEnabled: !!(flags & 4),
         rcds: packed[2].map(function (rcd, index) {
            return { id: ids[index], number: rcd[0], name: rcd[1], color: rcd[2], amountOfPoles: rcd[3], phases: maskPhases(rcd[4]) };
         }),
         boxes: packed[3].map(function (box) {
            return {
               number: box[0],
               name: box[1],
               groups: box[2].map(function (row) {
                  const group = { number: row[0], description: row[1], rcdId: row[2] === -1 ? null : ids[row[2]], phases: maskPhases(row[3]) };
                  if (row.length > 4) group.items = row[4];
                  return group;
               })
            };
         })
      };
   }

   const MODULE_TYPES = window.GroepenkaartSchema.moduleTypes.definitions.map(function (type) { return type.slug; });

   function packV5(data) {
      const moduleIndex = {};
      const boxIndex = {};
      data.modules.forEach(function (module, index) { moduleIndex[module.id] = index; });
      data.boxes.forEach(function (box, index) { boxIndex[box.id] = index; });
      function packSupply(supply) {
         if (!supply) return null;
         if (supply.type === 'linked') return ['l', supply.sourceBoxId ? boxIndex[supply.sourceBoxId] : -1];
         if (supply.type === 'mains') {
            return ['m', supply.connectionRating === undefined ? null : supply.connectionRating,
               supply.customConnectionRating === undefined ? null : supply.customConnectionRating,
               supply.supplier === undefined ? null : supply.supplier,
               supply.mainSwitchCurrent || null, supply.mainSwitchPoles || null];
         }
         return ['s', supply.sourceModuleId ? moduleIndex[supply.sourceModuleId] : -1,
            supply.preFuse === undefined ? null : supply.preFuse,
            supply.cableCores || null, supply.cableCrossSection || null,
            supply.mainSwitchCurrent || null, supply.mainSwitchPoles || null];
      }
      return [
         (data.qrEnabled ? 1 : 0) | (data.rcdEnabled ? 2 : 0) | (data.phaseEnabled ? 4 : 0),
         data.modules.map(function (module) {
            return [
               module.boxId === null ? -1 : boxIndex[module.boxId],
               MODULE_TYPES.indexOf(module.type), module.number, module.description,
               module.characteristic, phaseMask(module.phases),
               module.protectedByModuleId === null ? -1 : moduleIndex[module.protectedByModuleId],
               module.name === undefined ? null : module.name, module.color || null, module.items || null,
               module.sensitivity || null, module.rcdType || null, module.ratedCurrent || null, module.warnings || null,
               module.rail === undefined ? null : module.rail, module.slot === undefined ? null : module.slot,
               module.width === undefined ? null : module.width
            ];
         }),
         data.boxes.map(function (box) {
            return [box.number, box.name, box.moduleIds.map(function (id) { return moduleIndex[id]; }), packSupply(box.supply),
            box.rails, box.railWidth];
         })
      ];
   }

   function unpackV5(packed) {
      const moduleIds = packed[1].map(function (_, index) { return 'm' + (index + 1); });
      const boxIds = packed[2].map(function (_, index) { return 'b' + (index + 1); });
      function unpackSupply(supply) {
         if (!supply) return null;
         if (supply[0] === 'l') return { type: 'linked', ...(supply[1] >= 0 ? { sourceBoxId: boxIds[supply[1]] } : {}) };
         if (supply[0] === 'm') {
            return {
               type: 'mains',
               ...(supply[1] !== null ? { connectionRating: supply[1] } : {}),
               ...(supply[2] !== null ? { customConnectionRating: supply[2] } : {}),
               ...(supply[3] !== null ? { supplier: supply[3] } : {}),
               ...(supply[4] !== null ? { mainSwitchCurrent: supply[4] } : {}),
               ...(supply[5] !== null ? { mainSwitchPoles: supply[5] } : {})
            };
         }
         return {
            type: 'subdistribution',
            ...(supply[1] >= 0 ? { sourceModuleId: moduleIds[supply[1]] } : {}),
            ...(supply[2] !== null ? { preFuse: supply[2] } : {}),
            ...(supply[3] !== null ? { cableCores: supply[3] } : {}),
            ...(supply[4] !== null ? { cableCrossSection: supply[4] } : {}),
            ...(supply[5] !== null ? { mainSwitchCurrent: supply[5] } : {}),
            ...(supply[6] !== null ? { mainSwitchPoles: supply[6] } : {})
         };
      }
      return {
         schemaVersion: 5,
         qrEnabled: !!(packed[0] & 1),
         rcdEnabled: !!(packed[0] & 2),
         phaseEnabled: !!(packed[0] & 4),
         modules: packed[1].map(function (row, index) {
            return {
               id: moduleIds[index],
               boxId: row[0] < 0 ? null : boxIds[row[0]],
               ...(row[14] != null ? { rail: row[14] } : {}),
               ...(row[15] != null ? { slot: row[15] } : {}),
               ...(row[16] != null ? { width: row[16] } : {}),
               type: MODULE_TYPES[row[1]],
               number: row[2],
               description: row[3],
               characteristic: row[4],
               phases: maskPhases(row[5]),
               protectedByModuleId: row[6] < 0 ? null : moduleIds[row[6]],
               ...(row[7] !== null ? { name: row[7] } : {}),
               ...(row[8] !== null ? { color: row[8] } : {}),
               ...(row[9] !== null ? { items: row[9] } : {}),
               ...(row[10] !== null ? { sensitivity: row[10] } : {}),
               ...(row[11] !== null ? { rcdType: row[11] } : {}),
               ...(row[12] !== null ? { ratedCurrent: row[12] } : {}),
               ...(row[13] !== null ? { warnings: row[13] } : {})
            };
         }),
         boxes: packed[2].map(function (row, index) {
            return {
               id: boxIds[index],
               number: row[0],
               name: row[1],
               ...(row[4] != null ? { rails: row[4] } : {}),
               ...(row[5] != null ? { railWidth: row[5] } : {}),
               moduleIds: row[2].map(function (moduleIndex) { return moduleIds[moduleIndex]; }),
               supply: unpackSupply(row[3])
            };
         })
      };
   }

   function packV6(data) {
      return [data.generalInfo].concat(packV5(data));
   }

   function unpackV6(packed) {
      const data = unpackV5(packed.slice(1));
      data.schemaVersion = 6;
      data.generalInfo = packed[0];
      return data;
   }

   /** Compresses v4, v5, or v6 card data into a token of QR alphanumeric characters. */
   function encode(data) {
      let packed;
      if (data.schemaVersion === 6) packed = packV6(data);
      else if (data.schemaVersion === 5) packed = packV5(data);
      else if (data.schemaVersion === 4) packed = packV4(data);
      else throw new Error('Deellinks ondersteunen schemaversie ' + data.schemaVersion + ' niet.');
      return toBase40(fflate.deflateSync(fflate.strToU8(JSON.stringify(packed)), { level: 9 }));
   }

   /** The link that reopens the card in the app at the given page address. */
   function url(base, data) {
      const prefix = data.schemaVersion === 6 ? COMPACT_V6 : data.schemaVersion === 5 ? COMPACT_V5 : COMPACT_V4;
      return base.split('#')[0] + prefix + encode(data);
   }

   /** Whether a location hash carries card data, valid or not. */
   function isLink(hash) {
      return typeof hash === 'string' && (hash.indexOf(COMPACT_V4) === 0 || hash.indexOf(COMPACT_V5) === 0 || hash.indexOf(COMPACT_V6) === 0 || hash.indexOf(LEGACY) === 0);
   }

   /** Returns the card data in a location hash, not yet validated by the schema. */
   function decode(hash) {
      try {
         const compactV4 = hash.indexOf(COMPACT_V4) === 0;
         const compactV5 = hash.indexOf(COMPACT_V5) === 0;
         const compactV6 = hash.indexOf(COMPACT_V6) === 0;
         const compact = compactV4 || compactV5 || compactV6;
         const prefix = compactV6 ? COMPACT_V6 : compactV5 ? COMPACT_V5 : compactV4 ? COMPACT_V4 : LEGACY;
         const token = hash.slice(prefix.length);
         if (!token || token.length > MAX_TOKEN_LENGTH) throw new Error('Ongeldige lengte.');
         const json = JSON.parse(fflate.strFromU8(fflate.inflateSync(compact ? fromBase40(token) : fromBase64Url(token))));
         return compactV6 ? unpackV6(json) : compactV5 ? unpackV5(json) : compactV4 ? unpackV4(json) : json;
      } catch (e) {
         throw new Error('de link bevat geen geldige groepenkaart.');
      }
   }

   /**
    * A QR code for the link, preferring more error correction. The token is stored in the denser alphanumeric
    * mode. Returns null when the link is too long.
    */
   function qr(link) {
      const prefixes = [COMPACT_V6, COMPACT_V5, COMPACT_V4];
      const prefix = prefixes.find(function (value) { return link.indexOf(value) !== -1; });
      const split = prefix ? link.indexOf(prefix) : -1;
      const head = split === -1 ? link : link.slice(0, split + prefix.length);
      const tail = link.slice(head.length);
      for (const level of ['M', 'L']) {
         try {
            const code = window.qrcode(0, level);
            if (tail && ALPHANUMERIC_TOKEN.test(tail)) {
               code.addData(head, 'Byte');
               code.addData(tail, 'Alphanumeric');
            } else {
               code.addData(link, 'Byte');
            }
            code.make();
            return code;
         } catch (e) {
            // Too much data for this level: try the next one.
         }
      }
      return null;
   }

   window.GroepenkaartShare = { encode: encode, decode: decode, url: url, isLink: isLink, qr: qr };
})();
