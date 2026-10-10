(function () {
   'use strict';

   // Link formats. The compact format (c1) always describes schema version 4 data in a short array form. The
   // original format (data) is the deflated v4 JSON as base64url; it is only read, no longer written.
   const COMPACT = '#c1=';
   const LEGACY = '#data=';
   const COMPACT_SCHEMA_VERSION = 4;
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
   function pack(data) {
      if (data.schemaVersion !== COMPACT_SCHEMA_VERSION) {
         throw new Error('Deellinks ondersteunen schemaversie ' + data.schemaVersion + ' niet.');
      }
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

   function unpack(packed) {
      const flags = packed[1];
      const ids = packed[2].map(function (rcd, index) { return 'r' + (index + 1); });
      return {
         schemaVersion: COMPACT_SCHEMA_VERSION,
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

   /** Compresses current (schema version 4) card data into a token of QR alphanumeric characters. */
   function encode(data) {
      return toBase40(fflate.deflateSync(fflate.strToU8(JSON.stringify(pack(data))), { level: 9 }));
   }

   /** The link that reopens the card in the app at the given page address. */
   function url(base, data) {
      return base.split('#')[0] + COMPACT + encode(data);
   }

   /** Whether a location hash carries card data, valid or not. */
   function isLink(hash) {
      return typeof hash === 'string' && (hash.indexOf(COMPACT) === 0 || hash.indexOf(LEGACY) === 0);
   }

   /** Returns the card data in a location hash, not yet validated by the schema. */
   function decode(hash) {
      try {
         const compact = hash.indexOf(COMPACT) === 0;
         const token = hash.slice((compact ? COMPACT : LEGACY).length);
         if (!token || token.length > MAX_TOKEN_LENGTH) throw new Error('Ongeldige lengte.');
         const json = JSON.parse(fflate.strFromU8(fflate.inflateSync(compact ? fromBase40(token) : fromBase64Url(token))));
         return compact ? unpack(json) : json;
      } catch (e) {
         throw new Error('de link bevat geen geldige groepenkaart.');
      }
   }

   /**
    * A QR code for the link, preferring more error correction. The token is stored in the denser alphanumeric
    * mode. Returns null when the link is too long.
    */
   function qr(link) {
      const split = link.indexOf(COMPACT);
      const head = split === -1 ? link : link.slice(0, split + COMPACT.length);
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
