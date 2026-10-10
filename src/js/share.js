(function () {
   'use strict';

   const PREFIX = '#data=';
   // Largest binary payload of a version 40 QR code at error correction level L.
   const MAX_QR_BYTES = 2953;
   // A QR code cannot hold more than this, so a longer link is not one of ours. This also bounds inflation.
   const MAX_TOKEN_LENGTH = 10000;
   const fflate = window.fflate;

   function toBase64Url(bytes) {
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) {
         binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      }
      return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
   }

   function fromBase64Url(token) {
      const binary = window.atob(token.replace(/-/g, '+').replace(/_/g, '/'));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return bytes;
   }

   /** Compresses card data into a URL-safe token. The metadata field $schema is left out to save space. */
   function encode(data) {
      const rest = Object.assign({}, data);
      delete rest.$schema;
      return toBase64Url(fflate.deflateSync(fflate.strToU8(JSON.stringify(rest)), { level: 9 }));
   }

   /** Returns the parsed (not yet validated) card data from a token. */
   function decode(token) {
      try {
         if (!token || token.length > MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error();
         return JSON.parse(fflate.strFromU8(fflate.inflateSync(fromBase64Url(token))));
      } catch (e) {
         throw new Error('de link bevat geen geldige groepenkaart.');
      }
   }

   /** The link that reopens the card in the app at the given page address. */
   function url(base, data) {
      return base.split('#')[0] + PREFIX + encode(data);
   }

   /** The token in a location hash, or null when the hash does not carry card data. */
   function tokenFromHash(hash) {
      return typeof hash === 'string' && hash.indexOf(PREFIX) === 0 ? hash.slice(PREFIX.length) : null;
   }

   function fits(link) {
      return link.length <= MAX_QR_BYTES;
   }

   /** A QR code for the link, preferring more error correction. Returns null when the link is too long. */
   function qr(link) {
      if (!fits(link)) return null;
      for (const level of ['M', 'L']) {
         try {
            const code = window.qrcode(0, level);
            code.addData(link, 'Byte');
            code.make();
            return code;
         } catch (e) {
            // Too much data for this level: try the next one.
         }
      }
      return null;
   }

   window.GroepenkaartShare = { encode: encode, decode: decode, url: url, tokenFromHash: tokenFromHash, fits: fits, qr: qr };
})();
