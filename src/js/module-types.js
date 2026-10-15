(function () {
   'use strict';

   const definitions = [
      { slug: 'MCB', label: 'Installatieautomaat', description: 'Circuit breaker', phases: 1, width: 1, warnings: ['ev', 'pv', 'battery'] },
      { slug: 'MCB-2P', label: 'Krachtgroep', description: '3-phase power circuit', phases: 3, width: 4, phaseMode: 'three', warnings: ['ev', 'pv', 'battery'] },
      { slug: 'MCB-3P', label: 'Fornuisgroep', description: 'Range circuit', phases: 2, width: 2 },
      { slug: 'RCD-2P', label: 'Aardlekschakelaar 2P', description: 'Residual Current Device', phases: null, width: 2 },
      { slug: 'RCD-4P', label: 'Aardlekschakelaar 4P', description: 'Residual Current Device', phases: null, width: 4, phaseMode: 'three' },
      { slug: 'MAINS-2P', label: 'Hoofdschakelaar 2P', description: 'Switch-disconnector or main isolator', phases: 1, width: 2, phaseMode: 'single' },
      { slug: 'MAINS-4P', label: 'Hoofdschakelaar 4P', description: 'Switch-disconnector or main isolator', phases: 3, width: 4, phaseMode: 'three' },
      { slug: 'RCBO-2P', label: 'Aardlekautomaat 2P', description: 'RCBO (MCB + RCD in one)', phases: 2, width: 1 },
      { slug: 'RCBO-4P', label: 'Aardlekautomaat 4P', description: 'RCBO (MCB + RCD in one)', phases: 3, width: 4, phaseMode: 'three' },
      { slug: 'DIN-OUTLET', label: 'Dinrail stopcontact', description: '', phases: 1, width: 3 },
      { slug: 'Bell-TRANSFORMER', label: 'Beltrafo', description: 'Doorbell transformer', phases: 1, width: 2 },
      { slug: 'KWH-2P', label: 'KWh meter 2P', description: 'Write kWh with a lowercase k', phases: 1, width: 1 },
      { slug: 'KWH-4P', label: 'KWh meter 4P', description: 'Write kWh with a lowercase k', phases: 3, width: 4 },
      { slug: 'SPD', label: 'Overspanningsbeveiliging', description: '', phases: 1, width: 1 }
   ];
   const bySlug = Object.fromEntries(definitions.map(function (definition) { return [definition.slug, definition]; }));

   function get(slug) {
      return bySlug[slug] || null;
   }

   function available(slug, phaseEnabled) {
      const definition = get(slug);
      if (!definition) return false;
      if (definition.phaseMode === 'three') return phaseEnabled === true;
      if (definition.phaseMode === 'single') return phaseEnabled !== true;
      return true;
   }

   window.GroepenkaartModuleTypes = { definitions: definitions, get: get, available: available };
})();