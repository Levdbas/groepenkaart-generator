(function () {
   'use strict';

   const anonymizer = window.GroepenkaartAnonymize;
   const schema = window.GroepenkaartSchema;
   const input = document.getElementById('anonymize-input');
   const status = document.getElementById('anonymize-status');
   const result = document.getElementById('anonymize-result');
   const preview = document.getElementById('anonymize-preview');
   const download = document.getElementById('anonymize-download');
   let output = '';

   function showError(message) {
      output = '';
      result.hidden = true;
      status.textContent = message;
      status.className = 'anonymize-status anonymize-error';
      status.hidden = false;
   }

   function process(text) {
      let parsed;
      try {
         parsed = JSON.parse(text);
      } catch (e) {
         showError('Dit is geen geldig JSON-bestand.');
         return;
      }
      try {
         const anonymized = anonymizer.anonymize(parsed);
         output = JSON.stringify({ $schema: schema.schemaUrl, ...anonymized.data }, null, 2);
         preview.textContent = output;
         result.hidden = false;
         status.textContent = anonymized.masked + ' tekstwaarden onherkenbaar gemaakt. Controleer het resultaat hieronder voordat je het deelt.';
         status.className = 'anonymize-status';
         status.hidden = false;
      } catch (e) {
         showError(e.message);
      }
   }

   input.addEventListener('change', function () {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () { process(String(reader.result)); };
      reader.onerror = function () { showError('Het bestand kon niet worden gelezen.'); };
      reader.readAsText(file);
   });

   download.addEventListener('click', function () {
      if (!output) return;
      const url = URL.createObjectURL(new Blob([output], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'groepenkaart-geanonimiseerd.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
   });
})();
