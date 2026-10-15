(function () {
   'use strict';

   const STORAGE_KEY = 'groepenkaart:v1';
   const FILL_ROWS_KEY = 'groepenkaart:fill-rows';
   const RCD_FIRST_KEY = 'groepenkaart:rcd-first';
   const MIN_ROWS = 15;
   const warnings = window.GroepenkaartWarnings;
   const schema = window.GroepenkaartSchema;
   const moduleTypes = window.GroepenkaartModuleTypes;
   const rcdHelpers = window.GroepenkaartRcd;
   const share = window.GroepenkaartShare;
   const protectiveTypes = ['RCD-2P', 'RCD-4P', 'RCBO-2P', 'RCBO-4P'];

   let storageWritable = true;
   let loadedFromStorage = false;
   let qrStatusTimer;
   let state = load();
   let fillRows = loadFillRows();
   let rcdFirst = loadRcdFirst();

   const boxesEl = document.getElementById('boxes');
   const emptyEl = document.getElementById('empty-state');
   const printEl = document.getElementById('print-area');
   const qrEnabledEl = document.getElementById('qr-enabled');
   const fillRowsEl = document.getElementById('fill-rows');
   const rcdFirstEl = document.getElementById('rcd-first');
   rcdFirstEl.checked = rcdFirst;
   const qrStatusEl = document.getElementById('qr-status');
   const rcdEnabledEl = document.getElementById('rcd-enabled');
   const phaseEnabledEl = document.getElementById('phase-enabled');
   const rcdPanelEl = document.getElementById('rcd-panel');
   const rcdListEl = document.getElementById('rcd-list');
   const warningInputs = warnings.definitions.map(function (warning) {
      const checkbox = el('input', { type: 'checkbox', value: warning.id });
      checkbox.addEventListener('change', function () {
         const selectable = warnings.definitions.map(function (definition) { return definition.id; });
         state.warnings = state.warnings.filter(function (id) { return !selectable.includes(id); })
            .concat(warningInputs.filter(function (node) { return node.checked; })
               .map(function (node) { return node.value; }));
         state.warnings = warnings.normalize(state.warnings);
         save();
         renderPrint();
      });
      document.getElementById('installation-options').appendChild(el('label', null, [
         checkbox, el('span', { text: warning.label })
      ]));
      return checkbox;
   });

   function uid() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
         return window.crypto.randomUUID();
      }
      return Date.now().toString(36) + Math.random().toString(36).slice(2);
   }

   function load() {
      try {
         const raw = localStorage.getItem(STORAGE_KEY);
         if (raw) {
            const data = normalize(JSON.parse(raw));
            loadedFromStorage = true;
            return data;
         }
      } catch (e) {
         storageWritable = false;
         console.warn('Opgeslagen gegevens konden niet worden geladen', e);
         alert('Opgeslagen gegevens konden niet worden geladen: ' + e.message +
            ' De opgeslagen gegevens blijven bewaard. Importeer een geldig bestand of kies Alles wissen om ze te vervangen.');
      }
      return normalize(schema.empty());
   }

   // Padding with empty rows is a print preference of this device, not part of the card data.
   function loadFillRows() {
      try {
         return localStorage.getItem(FILL_ROWS_KEY) === 'true';
      } catch (e) {
         return false;
      }
   }

   function saveFillRows() {
      try {
         localStorage.setItem(FILL_ROWS_KEY, String(fillRows));
      } catch (e) {
         console.warn('Opslaan mislukt', e);
      }
   }

   function loadRcdFirst() {
      try {
         return localStorage.getItem(RCD_FIRST_KEY) !== 'false';
      } catch (e) {
         return true;
      }
   }

   function saveRcdFirst() {
      try {
         localStorage.setItem(RCD_FIRST_KEY, String(rcdFirst));
      } catch (e) {
         console.warn('Opslaan mislukt', e);
      }
   }

   function minRows() {
      return fillRows ? MIN_ROWS : 0;
   }

   // Building the QR code takes a moment, so after typing it only runs once the typing pauses.
   function scheduleQrStatus() {
      window.clearTimeout(qrStatusTimer);
      qrStatusTimer = window.setTimeout(renderQrStatus, 400);
   }

   function save() {
      scheduleQrStatus();
      if (!storageWritable) return;
      try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
      } catch (e) {
         console.warn('Opslaan mislukt', e);
      }
   }

   function normalize(data) {
      const normalized = schema.normalize(data);
      const modulesById = Object.fromEntries(normalized.modules.map(function (module) { return [module.id, module]; }));
      return {
         schemaVersion: normalized.schemaVersion,
         warnings: normalized.warnings,
         qrEnabled: normalized.qrEnabled,
         rcdEnabled: normalized.rcdEnabled,
         phaseEnabled: normalized.phaseEnabled,
         rcds: normalized.modules.filter(function (module) { return protectiveTypes.includes(module.type); }).map(function (module) {
            return {
               ...module,
               name: module.name || '',
               amountOfPoles: module.type.endsWith('4P') ? 4 : 2,
               phases: module.phases.slice()
            };
         }),
         boxes: normalized.boxes.map(function (box) {
            return {
               id: box.id,
               number: box.number,
               name: box.name,
               supply: box.supply,
               groups: box.moduleIds.map(function (id) {
                  const module = modulesById[id];
                  return {
                     ...module,
                     rcdId: module.protectedByModuleId,
                     phases: module.phases.slice(),
                     ...(module.items ? { items: module.items.slice() } : {})
                  };
               })
            };
         })
      };
   }

   function serializeState(data) {
      const modulesById = new Map();
      const boxes = data.boxes.map(function (box) {
         const moduleIds = box.groups.map(function (group) {
            modulesById.set(group.id, {
               id: group.id,
               boxId: box.id,
               type: group.type || 'MCB',
               number: group.number,
               description: group.description,
               characteristic: group.characteristic || '',
               phases: group.phases.slice(),
               protectedByModuleId: group.rcdId || null,
               ...(group.items ? { items: group.items.slice() } : {}),
               ...(group.sensitivity !== undefined ? { sensitivity: group.sensitivity } : {}),
               ...(group.rcdType !== undefined ? { rcdType: group.rcdType } : {}),
               ...(group.ratedCurrent !== undefined ? { ratedCurrent: group.ratedCurrent } : {}),
               ...(group.color !== undefined ? { color: group.color } : {})
            });
            return group.id;
         });
         return { id: box.id, number: box.number, name: box.name, moduleIds: moduleIds, supply: box.supply || null };
      });
      data.rcds.forEach(function (rcd) {
         const type = rcd.type && rcd.type.startsWith('RCBO')
            ? rcd.type : (rcd.amountOfPoles === 4 ? 'RCD-4P' : 'RCD-2P');
         const existing = modulesById.get(rcd.id);
         const module = {
            id: rcd.id,
            boxId: existing ? existing.boxId : null,
            type: type,
            number: rcd.number,
            name: rcd.name,
            color: rcd.color,
            description: existing ? existing.description : '',
            characteristic: rcd.characteristic || (existing && existing.characteristic) || '',
            phases: rcd.phases.slice(),
            protectedByModuleId: null,
            ...(rcd.sensitivity !== undefined ? { sensitivity: rcd.sensitivity } : {}),
            ...(rcd.rcdType !== undefined ? { rcdType: rcd.rcdType } : {}),
            ...(rcd.ratedCurrent !== undefined ? { ratedCurrent: rcd.ratedCurrent } : {})
         };
         modulesById.set(rcd.id, Object.assign({}, existing || {}, module));
      });
      return schema.normalize({
         schemaVersion: 5,
         warnings: data.warnings,
         qrEnabled: data.qrEnabled,
         rcdEnabled: data.rcdEnabled,
         phaseEnabled: data.phaseEnabled,
         modules: Array.from(modulesById.values()),
         boxes: boxes
      });
   }

   function nextNumber(items) {
      const nums = items.map(function (i) { return parseInt(i.number, 10); }).filter(function (n) { return !isNaN(n); });
      return String(nums.length ? Math.max.apply(null, nums) + 1 : items.length + 1);
   }

   function findBox(id) {
      return state.boxes.find(function (b) { return b.id === id; });
   }

   function move(list, index, delta) {
      const target = index + delta;
      if (target < 0 || target >= list.length) return;
      const item = list.splice(index, 1)[0];
      list.splice(target, 0, item);
   }

   function update() {
      save();
      render();
   }

   function el(tag, attrs, children) {
      const node = document.createElement(tag);
      if (attrs) {
         Object.keys(attrs).forEach(function (key) {
            if (key === 'text') node.textContent = attrs[key];
            else if (key === 'className') node.className = attrs[key];
            else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), attrs[key]);
            else node.setAttribute(key, attrs[key]);
         });
      }
      (children || []).forEach(function (child) { if (child) node.appendChild(child); });
      return node;
   }

   // Inputs only save (no re-render) so focus and caret position are kept while typing.
   function input(value, placeholder, label, onInput, className) {
      const node = el('input', { type: 'text', placeholder: placeholder, 'aria-label': label, className: className || '' });
      node.value = value;
      node.addEventListener('input', function () {
         onInput(node.value);
         save();
         renderPrint();
      });
      return node;
   }

   function iconButton(text, title, onClick, className) {
      return el('button', { type: 'button', className: 'btn btn-icon ' + (className || ''), title: title, 'aria-label': title, text: text, onclick: onClick });
   }

   function groupItemsInput(group) {
      const node = el('textarea', {
         rows: '3', placeholder: 'Eén aansluiting per regel',
         'aria-label': 'Aansluitingen voor module ' + group.number
      });
      node.value = (group.items || []).join('\n');
      node.addEventListener('input', function () {
         group.items = node.value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
         save();
         renderPrint();
      });
      return el('label', { className: 'field group-items-field' }, [
         el('span', { text: 'Aansluitingen (één per regel)' }), node
      ]);
   }

   function moduleTypeControl(module) {
      const current = moduleTypes.get(module.type) || moduleTypes.get('MCB');
      const select = el('select', { className: 'module-type-select', 'aria-label': 'Moduletype voor module ' + module.number },
         moduleTypes.definitions.filter(function (type) {
            return moduleTypes.available(type.slug, state.phaseEnabled) || type.slug === module.type;
         }).map(function (type) {
            return el('option', { value: type.slug, text: type.label + ' · ' + type.slug });
         }));
      select.value = current.slug;
      select.addEventListener('change', function () {
         changeModuleType(module, select.value);
      });
      return el('div', { className: 'module-type-control' }, [
         select,
         el('span', { className: 'module-width', text: current.width + (current.width === 1 ? ' DIN-module' : ' DIN-modules') })
      ]);
   }

   function moduleTechnicalControls(module) {
      const rcdType = el('select', { 'aria-label': 'Aardlektype voor module ' + module.number }, [
         el('option', { value: '', text: 'Aardlektype' }),
         ...['AC', 'A', 'F', 'B', 'B+'].map(function (value) { return el('option', { value: value, text: 'Type ' + value }); })
      ]);
      rcdType.value = module.rcdType || '';
      rcdType.addEventListener('change', function () {
         if (rcdType.value) module.rcdType = rcdType.value;
         else delete module.rcdType;
         save();
         renderPrint();
      });
      const ratedCurrent = el('input', {
         type: 'number', min: '1', step: '1', placeholder: 'A',
         'aria-label': 'Nominale stroom module ' + module.number
      });
      ratedCurrent.value = module.ratedCurrent === undefined ? '' : String(module.ratedCurrent);
      ratedCurrent.addEventListener('input', function () {
         const value = Number(ratedCurrent.value);
         if (ratedCurrent.value && Number.isFinite(value) && value > 0) module.ratedCurrent = value;
         else delete module.ratedCurrent;
         save();
         renderPrint();
      });
      return el('div', { className: 'module-technical-controls' }, [rcdType, ratedCurrent]);
   }

   function changeModuleType(module, type) {
      const previous = module.type;
      if (previous === type) return;
      const existing = state.rcds.find(function (rcd) { return rcd.id === module.id; });
      const isProtective = protectiveTypes.includes(type);
      if (isProtective) {
         const amountOfPoles = type.endsWith('4P') ? 4 : 2;
         const phases = amountOfPoles === 4 ? rcdHelpers.phaseCodes.slice() : module.phases.slice(0, 1);
         const rcd = existing || {
            id: module.id, number: module.number, name: module.name || '',
            color: module.color || rcdHelpers.defaultColor(module.number), phases: phases
         };
         rcd.type = type;
         rcd.amountOfPoles = amountOfPoles;
         rcd.number = module.number;
         rcd.name = module.name || rcd.name || '';
         rcd.color = rcd.color || rcdHelpers.defaultColor(module.number);
         rcd.phases = phases;
         if (!existing) state.rcds.push(rcd);
         module.color = rcd.color;
         module.phases = phases.slice();
         state.rcdEnabled = true;
         rcdEnabledEl.checked = true;
      } else if (existing) {
         const dependents = state.boxes.reduce(function (total, box) {
            return total + box.groups.filter(function (item) { return item.rcdId === module.id; }).length;
         }, 0);
         if (dependents && !confirm('Dit moduletype levert geen aardlekbeveiliging meer. ' + dependents +
            (dependents === 1 ? ' gekoppelde module wordt ontkoppeld. Doorgaan?' : ' gekoppelde modules worden ontkoppeld. Doorgaan?'))) {
            module.type = previous;
            return;
         }
         state.rcds = state.rcds.filter(function (rcd) { return rcd.id !== module.id; });
         state.boxes.forEach(function (box) {
            box.groups.forEach(function (item) { if (item.rcdId === module.id) item.rcdId = null; });
         });
         ['color', 'name', 'sensitivity', 'rcdType', 'ratedCurrent'].forEach(function (key) { delete module[key]; });
      }
      module.type = type;
      update();
   }

   function rcdOptionText(rcd, index) {
      return rcd.name.trim() ? rcdHelpers.label(rcd, index) + ' – ' + rcd.name.trim() : rcdHelpers.label(rcd, index);
   }

   function swatchStyle(color) {
      return color ? 'background-color: ' + color : '';
   }

   function rcdSelect(group, onChange) {
      const linked = state.rcds.find(function (r) { return r.id === group.rcdId; });
      const swatch = el('span', { className: 'rcd-swatch' + (linked ? '' : ' is-empty'), style: swatchStyle(linked && linked.color), 'aria-hidden': 'true' });
      const select = el('select', { 'aria-label': 'Aardlekschakelaar voor module ' + group.number }, [
         el('option', { value: '', text: 'Geen koppeling' })
      ].concat(state.rcds.filter(function (rcd) { return rcd.id !== group.id; }).map(function (rcd) {
         const i = state.rcds.indexOf(rcd);
         return el('option', { value: rcd.id, text: rcdOptionText(rcd, i) });
      })));
      select.value = group.rcdId || '';
      // Updates in place instead of re-rendering, so keyboard focus stays on the select.
      select.addEventListener('change', function () {
         group.rcdId = select.value || null;
         const rcd = state.rcds.find(function (r) { return r.id === group.rcdId; });
         swatch.className = 'rcd-swatch' + (rcd ? '' : ' is-empty');
         swatch.setAttribute('style', swatchStyle(rcd && rcd.color));
         onChange();
         save();
         renderPrint();
      });
      return el('div', { className: 'rcd-select' }, [swatch, select]);
   }

   function groupPhaseInput(group) {
      const rcd = state.rcds.find(function (r) { return r.id === group.rcdId; }) ||
         (protectiveTypes.includes(group.type) ? state.rcds.find(function (r) { return r.id === group.id; }) : null);
      if (rcd && rcd.amountOfPoles === 2) {
         return el('div', { className: 'phase-inherited', text: rcdHelpers.phaseText(rcdHelpers.groupPhases(group, rcd)) + ' (via aardlekschakelaar)' });
      }
      const status = el('span', { className: 'phase-status', text: rcdHelpers.phaseText(group.phases) });
      return el('fieldset', { className: 'phase-choices' }, [
         el('legend', { text: 'Fasen voor module ' + group.number }),
         ...rcdHelpers.phaseCodes.map(function (phase) {
            const checkbox = el('input', { type: 'checkbox', value: phase });
            checkbox.checked = group.phases.includes(phase);
            checkbox.addEventListener('change', function () {
               group.phases = rcdHelpers.phaseCodes.filter(function (code) {
                  return code === phase ? checkbox.checked : group.phases.includes(code);
               });
               status.textContent = rcdHelpers.phaseText(group.phases);
               save();
               renderPrint();
            });
            return el('label', null, [checkbox, el('span', { text: phase })]);
         }),
         status
      ]);
   }

   function renderGroupRow(box, group, index) {
      const phaseCell = state.phaseEnabled ? el('td', { className: 'group-phases', 'data-label': 'Fasen' }, [groupPhaseInput(group)]) : null;
      const refreshPhase = function () {
         if (phaseCell) phaseCell.replaceChildren(groupPhaseInput(group));
      };
      const description = input(group.description, 'Omschrijving', 'Omschrijving', function (v) {
         group.description = v;
         const rcd = state.rcds.find(function (item) { return item.id === group.id; });
         if (rcd && protectiveTypes.includes(group.type)) rcd.name = v;
      });
      const characteristic = input(group.characteristic || '', 'Vrij kenmerk', 'Kenmerk voor module ' + group.number, function (v) {
         group.characteristic = v;
      });
      const items = groupItemsInput(group);
      // With phases the connections get their own row; otherwise they stay stacked under the description.
      const descriptionCells = state.phaseEnabled ? [
         el('td', { className: 'group-description', 'data-label': 'Omschrijving' }, [moduleTypeControl(group), description, characteristic, moduleTechnicalControls(group)]),
         el('td', { className: 'group-items' }, [items])
      ] : [el('td', { className: 'group-description', 'data-label': 'Omschrijving' }, [moduleTypeControl(group), description, characteristic, moduleTechnicalControls(group), items])];
      return el('tr', null, [
         el('td', { className: 'group-number', 'data-label': 'Module' }, [input(group.number, 'Nr', 'Modulenummer', function (v) {
            group.number = v;
            const rcd = state.rcds.find(function (item) { return item.id === group.id; });
            if (rcd && protectiveTypes.includes(group.type)) rcd.number = v;
         }, 'input-number')]),
         ...descriptionCells,
         state.rcdEnabled ? el('td', { className: 'group-rcd', 'data-label': 'Aardlekschakelaar' }, [rcdSelect(group, refreshPhase)]) : null,
         phaseCell,
         el('td', { className: 'group-actions' }, [
            el('div', { className: 'row-actions' }, [
               iconButton('↑', 'Module omhoog', function () { move(box.groups, index, -1); update(); }),
               iconButton('↓', 'Module omlaag', function () { move(box.groups, index, 1); update(); }),
               iconButton('✕', 'Module verwijderen', function () { removeModule(box, group, index); }, 'btn-danger')
            ])
         ])
      ]);
   }

   function renderBox(box, index) {
      const rows = box.groups.map(function (g, i) { return renderGroupRow(box, g, i); });

      return el('section', { className: 'box', 'data-id': box.id }, [
         el('div', { className: 'box-header' }, [
            el('label', { className: 'field' }, [
               el('span', { text: 'Kastnummer' }),
               input(box.number, 'Nr', 'Kastnummer', function (v) { box.number = v; }, 'input-number')
            ]),
            el('label', { className: 'field field-grow' }, [
               el('span', { text: 'Naam kast' }),
               input(box.name, 'Bijv. Meterkast begane grond', 'Naam kast', function (v) { box.name = v; })
            ]),
            el('div', { className: 'box-actions' }, [
               iconButton('↑', 'Kast omhoog', function () { move(state.boxes, index, -1); update(); }),
               iconButton('↓', 'Kast omlaag', function () { move(state.boxes, index, 1); update(); }),
               iconButton('✕', 'Kast verwijderen', function () {
                  removeBox(box, index);
               }, 'btn-danger')
            ])
         ]),
         renderSupplyEditor(box),
         el('table', { className: 'groups-table' + (state.phaseEnabled ? ' has-phases' : '') + (state.rcdEnabled ? ' has-rcds' : '') }, [
            el('thead', null, [el('tr', null, [
               el('th', { className: 'col-number', text: 'Module' }),
               el('th', { text: 'Omschrijving' }),
               state.rcdEnabled ? el('th', { className: 'col-rcd', text: 'Aardlekschakelaar' }) : null,
               state.phaseEnabled ? el('th', { className: 'col-phases', text: 'Fasen' }) : null,
               el('th', { className: 'col-actions' })
            ])]),
            el('tbody', null, rows)
         ]),
         el('button', {
            type: 'button',
            className: 'btn btn-primary btn-add-group',
            text: '+ Module toevoegen',
            onclick: function () {
               box.groups.push({ id: uid(), type: 'MCB', number: nextNumber(box.groups), description: '', characteristic: '', rcdId: null, phases: [] });
               update();
               const inputs = boxesEl.querySelectorAll('[data-id="' + box.id + '"] tbody tr:last-child input');
               if (inputs[1]) inputs[1].focus();
            }
         })
      ]);
   }

   function removeBox(box, index) {
      const moduleIds = new Set(box.groups.map(function (module) { return module.id; }));
      const dependents = state.boxes.filter(function (candidate) {
         return candidate !== box && candidate.supply && moduleIds.has(candidate.supply.sourceModuleId);
      });
      const message = 'Kast "' + (box.name || box.number) + '" verwijderen?' +
         (dependents.length ? ' ' + dependents.length + ' voeding(en) verliezen de bronmodule.' : '');
      if (!confirm(message)) return;
      dependents.forEach(function (candidate) { candidate.supply.sourceModuleId = null; });
      state.boxes.splice(index, 1);
      update();
   }

   function removeModule(box, module, index) {
      const rcd = state.rcds.find(function (item) { return item.id === module.id; });
      const linked = rcd ? linkedGroupCount(rcd) : 0;
      const feedBoxes = state.boxes.filter(function (candidate) {
         return candidate.supply && candidate.supply.sourceModuleId === module.id;
      });
      const consequences = [];
      if (linked) consequences.push(linked + (linked === 1 ? ' module wordt ontkoppeld' : ' modules worden ontkoppeld'));
      if (feedBoxes.length) consequences.push(feedBoxes.length + ' voeding(en) verliezen de bronmodule');
      if (!confirm('Module ' + module.number + ' verwijderen?' + (consequences.length ? ' ' + consequences.join('; ') + '.' : ''))) return;
      feedBoxes.forEach(function (candidate) { candidate.supply.sourceModuleId = null; });
      state.boxes.forEach(function (candidate) {
         candidate.groups.forEach(function (item) { if (item.rcdId === module.id) item.rcdId = null; });
      });
      state.rcds = state.rcds.filter(function (item) { return item.id !== module.id; });
      box.groups.splice(index, 1);
      update();
   }
   function supplySourceModules(box) {
      return state.boxes.filter(function (candidate) { return candidate !== box; }).flatMap(function (candidate) {
         return candidate.groups.filter(function (module) {
            return ['MCB', 'MCB-2P', 'MCB-3P', 'RCBO-2P', 'RCBO-4P'].includes(module.type);
         }).map(function (module) { return { box: candidate, module: module }; });
      });
   }

   function sourceModuleLabel(entry) {
      return 'Kast ' + entry.box.number + ' · module ' + entry.module.number +
         (entry.module.description ? ' · ' + entry.module.description : '');
   }

   function supplyTextField(supply, key, label, placeholder) {
      return el('label', { className: 'field' }, [
         el('span', { text: label }),
         input(supply[key] || '', placeholder || '', label, function (value) {
            if (value) supply[key] = value;
            else delete supply[key];
         })
      ]);
   }

   function supplyRatingField(supply) {
      const options = ['1x25A', '1x35A', '1x40A', '3x25A', '3x35A', '3x40A', '3x50A', '3x63A', '3x80A', 'Anders'];
      const select = el('select', { 'aria-label': 'Aansluitwaarde' }, [
         el('option', { value: '', text: 'Aansluitwaarde' }),
         ...options.map(function (value) { return el('option', { value: value, text: value }); })
      ]);
      select.value = supply.connectionRating || '';
      select.addEventListener('change', function () {
         if (select.value) supply.connectionRating = select.value;
         else delete supply.connectionRating;
         if (select.value !== 'Anders') delete supply.customConnectionRating;
         update();
      });
      return el('div', { className: 'field' }, [
         el('span', { text: 'Aansluitwaarde' }), select,
         supply.connectionRating === 'Anders'
            ? supplyTextField(supply, 'customConnectionRating', 'Andere aansluitwaarde', 'Bijv. 3x45A') : null
      ]);
   }

   function supplyNumberField(supply, key, label, step) {
      const node = el('input', {
         type: 'number', min: '0', step: step || '1', 'aria-label': label
      });
      node.value = supply[key] === undefined ? '' : String(supply[key]);
      node.addEventListener('input', function () {
         const value = Number(node.value);
         if (node.value && Number.isFinite(value) && value > 0) supply[key] = value;
         else delete supply[key];
         save();
         renderPrint();
      });
      return el('label', { className: 'field' }, [el('span', { text: label }), node]);
   }

   function supplyPolesField(supply) {
      const select = el('select', { 'aria-label': 'Polen hoofdschakelaar' }, [
         el('option', { value: '', text: 'Polen' }),
         el('option', { value: '2', text: '2P' }),
         el('option', { value: '4', text: '4P' })
      ]);
      select.value = supply.mainSwitchPoles ? String(supply.mainSwitchPoles) : '';
      select.addEventListener('change', function () {
         if (select.value) supply.mainSwitchPoles = Number(select.value);
         else delete supply.mainSwitchPoles;
         save();
         renderPrint();
      });
      return el('label', { className: 'field' }, [el('span', { text: 'Polen hoofdschakelaar' }), select]);
   }

   function renderSupplyEditor(box) {
      const supply = box.supply;
      const type = el('select', { 'aria-label': 'Soort voeding kast ' + box.number }, [
         el('option', { value: '', text: 'Niet ingesteld' }),
         el('option', { value: 'mains', text: 'Hoofdaansluiting' }),
         el('option', { value: 'subdistribution', text: 'Onderverdeler' })
      ]);
      type.value = supply ? supply.type : '';
      type.addEventListener('change', function () {
         box.supply = type.value ? { type: type.value } : null;
         update();
      });
      const fields = [];
      if (supply && supply.type === 'mains') {
         fields.push(supplyRatingField(supply));
         fields.push(supplyTextField(supply, 'supplier', 'Netbeheerder', 'Bijv. Stedin'));
         fields.push(supplyNumberField(supply, 'mainSwitchCurrent', 'Nominale stroom hoofdschakelaar'));
         fields.push(supplyPolesField(supply));
      } else if (supply && supply.type === 'subdistribution') {
         const source = el('select', { 'aria-label': 'Voeding vanuit module kast ' + box.number }, [
            el('option', { value: '', text: 'Kies bronmodule' })
         ].concat(supplySourceModules(box).map(function (entry) {
            return el('option', { value: entry.module.id, text: sourceModuleLabel(entry) });
         })));
         source.value = supply.sourceModuleId || '';
         source.addEventListener('change', function () {
            const previous = supply.sourceModuleId;
            if (source.value) supply.sourceModuleId = source.value;
            else delete supply.sourceModuleId;
            try {
               serializeState(state);
            } catch (error) {
               if (previous === undefined) delete supply.sourceModuleId;
               else supply.sourceModuleId = previous;
               source.value = previous || '';
               alert('Voedingsbron niet opgeslagen: ' + error.message);
               return;
            }
            save();
            renderPrint();
         });
         fields.push(el('label', { className: 'field' }, [el('span', { text: 'Gevoed vanuit' }), source]));
         fields.push(supplyTextField(supply, 'preFuse', 'Voorbeveiliging', 'Bijv. C32'));
         fields.push(supplyNumberField(supply, 'cableCores', 'Aantal aders'));
         fields.push(supplyNumberField(supply, 'cableCrossSection', 'Kabeldoorsnede (mm²)', 'any'));
         fields.push(supplyNumberField(supply, 'mainSwitchCurrent', 'Nominale stroom hoofdschakelaar'));
         fields.push(supplyPolesField(supply));
      }
      return el('section', { className: 'box-supply-editor' }, [
         el('label', { className: 'field' }, [el('span', { text: 'Voeding' }), type]),
         fields.length ? el('div', { className: 'box-supply-fields' }, fields) : null
      ]);
   }

   function linkedGroupCount(rcd) {
      return state.boxes.reduce(function (total, box) {
         return total + box.groups.filter(function (g) { return g.rcdId === rcd.id; }).length;
      }, 0);
   }

   // RCD edits re-render the boxes (option labels and swatches) but not the RCD list, so focus is kept.
   function rcdChanged() {
      save();
      renderBoxes();
      renderPrint();
   }

   function rcdPhaseInput(rcd) {
      if (rcd.amountOfPoles === 4) {
         return el('div', { className: 'field' }, [
            el('span', { text: 'Fasen' }),
            el('span', { className: 'phase-inherited', text: 'L1, L2, L3 (4-polig)' })
         ]);
      }
      const select = el('select', { 'aria-label': 'Fase aardlekschakelaar ' + rcd.number }, [
         el('option', { value: '', text: 'Kies een fase' }),
         ...rcdHelpers.phaseCodes.map(function (phase) { return el('option', { value: phase, text: phase }); })
      ]);
      select.value = rcd.phases[0] || '';
      select.addEventListener('change', function () {
         rcd.phases = select.value ? [select.value] : [];
         rcdChanged();
      });
      return el('label', { className: 'field' }, [el('span', { text: 'Fase' }), select]);
   }

   function rcdPhaseControls(rcd) {
      const phases = el('div', { className: 'rcd-phase-selection' }, [rcdPhaseInput(rcd)]);
      const poles = el('select', { 'aria-label': 'Aantal polen aardlekschakelaar ' + rcd.number }, [
         el('option', { value: '2', text: '2-polig' }),
         el('option', { value: '4', text: '4-polig' })
      ]);
      poles.value = String(rcd.amountOfPoles);
      poles.addEventListener('change', function () {
         rcd.amountOfPoles = Number(poles.value);
         rcd.phases = rcd.amountOfPoles === 4 ? rcdHelpers.phaseCodes.slice() : [];
         state.boxes.forEach(function (box) {
            box.groups.forEach(function (module) {
               if (module.id === rcd.id && module.type && (module.type.startsWith('RCD') || module.type.startsWith('RCBO'))) {
                  module.type = module.type.slice(0, -2) + (rcd.amountOfPoles === 4 ? '4P' : '2P');
                  module.phases = rcd.phases.slice();
               }
            });
         });
         phases.replaceChildren(rcdPhaseInput(rcd));
         rcdChanged();
      });
      return el('div', { className: 'rcd-phase-controls' }, [
         el('label', { className: 'field' }, [el('span', { text: 'Aantal polen' }), poles]), phases
      ]);
   }

   function rcdTechnicalControls(rcd) {
      const sensitivity = el('select', { 'aria-label': 'Gevoeligheid aardlekschakelaar ' + rcd.number }, [
         el('option', { value: '', text: 'Gevoeligheid' }),
         ...[10, 30, 100, 300].map(function (value) { return el('option', { value: String(value), text: value + ' mA' }); })
      ]);
      sensitivity.value = rcd.sensitivity === undefined ? '' : String(rcd.sensitivity);
      sensitivity.addEventListener('change', function () {
         if (sensitivity.value) rcd.sensitivity = Number(sensitivity.value);
         else delete rcd.sensitivity;
         rcdChanged();
      });
      const type = el('select', { 'aria-label': 'Aardlektype aardlekschakelaar ' + rcd.number }, [
         el('option', { value: '', text: 'Aardlektype' }),
         ...['AC', 'A', 'F', 'B', 'B+'].map(function (value) { return el('option', { value: value, text: 'Type ' + value }); })
      ]);
      type.value = rcd.rcdType || '';
      type.addEventListener('change', function () {
         if (type.value) rcd.rcdType = type.value;
         else delete rcd.rcdType;
         rcdChanged();
      });
      const current = el('input', {
         type: 'number', min: '1', step: '1', placeholder: 'A',
         'aria-label': 'Nominale stroom aardlekschakelaar ' + rcd.number
      });
      current.value = rcd.ratedCurrent === undefined ? '' : String(rcd.ratedCurrent);
      current.addEventListener('input', function () {
         const value = Number(current.value);
         if (current.value && Number.isFinite(value) && value > 0) rcd.ratedCurrent = value;
         else delete rcd.ratedCurrent;
         rcdChanged();
      });
      return el('div', { className: 'rcd-technical-controls' }, [sensitivity, type, current]);
   }

   function renderRcd(rcd, index) {
      const color = el('input', { type: 'color', className: 'rcd-color', 'aria-label': 'Kleur aardlekschakelaar ' + rcdHelpers.label(rcd, index), title: 'Kleur kiezen' });
      color.value = rcd.color;
      color.addEventListener('input', function () {
         if (!rcdHelpers.isColor(color.value)) return;
         rcd.color = color.value.toLowerCase();
         rcdChanged();
      });
      return el('li', { className: 'rcd-item', 'data-id': rcd.id }, [
         color,
         rcdInput(rcd.number, 'Bijv. A1', 'Code aardlekschakelaar', function (v) { rcd.number = v; }, 'input-number'),
         rcdInput(rcd.name, 'Omschrijving, bijv. Keuken en badkamer', 'Naam aardlekschakelaar', function (v) { rcd.name = v; }),
         el('div', { className: 'row-actions' }, [
            iconButton('↑', 'Aardlekschakelaar omhoog', function () { move(state.rcds, index, -1); update(); }),
            iconButton('↓', 'Aardlekschakelaar omlaag', function () { move(state.rcds, index, 1); update(); }),
            iconButton('✕', 'Aardlekschakelaar verwijderen', function () {
               const linked = linkedGroupCount(rcd);
               const message = 'Aardlekschakelaar "' + rcdOptionText(rcd, index) + '" verwijderen?' +
                  (linked ? ' ' + linked + (linked === 1 ? ' gekoppelde module wordt' : ' gekoppelde modules worden') + ' ontkoppeld.' : '');
               if (!confirm(message)) return;
               state.boxes.forEach(function (box) {
                  box.groups.forEach(function (g) {
                     if (g.id === rcd.id) {
                        g.type = 'MCB';
                        ['color', 'name', 'sensitivity', 'rcdType', 'ratedCurrent'].forEach(function (key) { delete g[key]; });
                     }
                     if (g.rcdId === rcd.id) g.rcdId = null;
                  });
               });
               state.rcds.splice(index, 1);
               update();
            }, 'btn-danger')
         ]),
         rcdTechnicalControls(rcd),
         state.phaseEnabled ? rcdPhaseControls(rcd) : null
      ]);
   }

   function rcdInput(value, placeholder, label, onInput, className) {
      const node = el('input', { type: 'text', placeholder: placeholder, 'aria-label': label, className: className || '' });
      node.value = value;
      node.addEventListener('input', function () {
         onInput(node.value);
         rcdChanged();
      });
      return node;
   }

   function renderRcds() {
      rcdEnabledEl.checked = state.rcdEnabled;
      rcdPanelEl.hidden = !state.rcdEnabled;
      rcdListEl.replaceChildren.apply(rcdListEl, state.rcds.map(renderRcd));
   }

   function boxTitle(box) {
      return ['Kast', box.number, box.name ? '- ' + box.name : ''].filter(Boolean).join(' ');
   }

   function moduleMeta(module) {
      const type = moduleTypes.get(module.type);
      return [module.type, type ? type.width + (type.width === 1 ? ' DIN-module' : ' DIN-modules') : '',
      module.characteristic, module.rcdType ? 'type ' + module.rcdType : '', module.ratedCurrent ? module.ratedCurrent + ' A' : '']
         .filter(Boolean).join(' · ');
   }

   function supplySummary(box) {
      const supply = box.supply;
      if (!supply) return null;
      const details = [];
      if (supply.type === 'mains') {
         details.push('hoofdaansluiting');
         if (supply.connectionRating === 'Anders') details.push(supply.customConnectionRating || 'Anders');
         else if (supply.connectionRating) details.push(supply.connectionRating);
         if (supply.mainSwitchPoles || supply.mainSwitchCurrent) {
            details.push('hoofdschakelaar ' + (supply.mainSwitchPoles ? supply.mainSwitchPoles + 'P' : '') +
               (supply.mainSwitchCurrent ? ' ' + supply.mainSwitchCurrent + ' A' : ''));
         }
         if (supply.supplier) details.push(supply.supplier);
      } else {
         const sourceBox = state.boxes.find(function (candidate) {
            return candidate.groups.some(function (module) { return module.id === supply.sourceModuleId; });
         });
         const source = sourceBox && sourceBox.groups.find(function (module) { return module.id === supply.sourceModuleId; });
         if (sourceBox && source) details.push('vanuit kast ' + sourceBox.number + ', module ' + source.number);
         if (supply.preFuse) details.push(supply.preFuse);
         if (supply.cableCores && supply.cableCrossSection) details.push(supply.cableCores + 'x ' + supply.cableCrossSection + ' mm²');
         if (supply.mainSwitchPoles || supply.mainSwitchCurrent) {
            details.push('hoofdschakelaar ' + (supply.mainSwitchPoles ? supply.mainSwitchPoles + 'P' : '') +
               (supply.mainSwitchCurrent ? ' ' + supply.mainSwitchCurrent + ' A' : ''));
         }
      }
      return details.length ? el('p', { className: 'print-supply', text: 'Voeding: ' + details.join(' · ') }) : null;
   }

   function feedReferences(module) {
      return state.boxes.filter(function (box) {
         return box.supply && box.supply.type === 'subdistribution' && box.supply.sourceModuleId === module.id;
      }).map(function (box) {
         return el('div', { className: 'print-module-feed', text: '→ Kast ' + box.number + (box.name ? ' (' + box.name + ')' : '') });
      });
   }

   function renderPrint() {
      const date = 'Afgedrukt op ' + window.GroepenkaartPdf.today();
      printEl.replaceChildren.apply(printEl, state.boxes.map(function (box, index) {
         const lookup = rcdHelpers.index(state.rcds);
         const rows = box.groups.map(function (g) {
            const entry = lookup[g.rcdId];
            const protection = entry || (protectiveTypes.includes(g.type) ? lookup[g.id] : null);
            const phases = rcdHelpers.groupPhases(g, protection && protection.rcd);
            return el('tr', null, [
               el('td', protection ? {
                  className: 'rcd-cell',
                  style: 'background-color: ' + protection.rcd.color + '; color: ' + rcdHelpers.textColor(protection.rcd.color),
                  text: rcdHelpers.cellText(g.number, protection, rcdFirst)
               } : { text: g.number }),
               el('td', null, [
                  g.description ? el('div', { text: g.description }) : null,
                  el('div', { className: 'print-module-meta', text: moduleMeta(g) }),
                  ...feedReferences(g),
                  g.items && g.items.length ? el('ul', { className: 'print-group-items' },
                     g.items.map(function (item) { return el('li', { text: item }); })) : null
               ]),
               state.phaseEnabled ? el('td', { className: 'print-phases', text: rcdHelpers.phaseText(phases) }, [
                  phases.length ? el('span', { className: 'print-phase-border', 'aria-hidden': 'true' },
                     phases.map(function (phase) {
                        return el('span', { style: 'background-color: ' + rcdHelpers.phaseColors[phase] });
                     })) : null
               ]) : null
            ]);
         });
         for (let i = box.groups.length; i < minRows(); i++) {
            rows.push(el('tr', null, [el('td'), el('td'), state.phaseEnabled ? el('td') : null]));
         }
         return el('article', { className: 'print-page' }, [
            el('h1', { text: 'Module-indeling' }),
            el('p', { className: 'print-date', text: date }),
            index === 0 ? renderWarnings() : null,
            index === 0 ? renderUnusedRcds() : null,
            el('h2', { text: boxTitle(box) }),
            supplySummary(box),
            renderRcdKey(box),
            el('table', null, [
               el('thead', null, [el('tr', null, [
                  el('th', { className: 'col-number', text: 'Module' }),
                  el('th', { text: 'Omschrijving' }),
                  state.phaseEnabled ? el('th', { className: 'col-phases', text: 'Fasen' }) : null
               ])]),
               el('tbody', null, rows)
            ])
         ]);
      }));
   }

   function renderRcdKey(box) {
      const used = rcdHelpers.used(state.rcds, box.groups);
      if (!used.length) return null;
      return el('ul', { className: 'print-rcd-key', 'aria-label': 'Aardlekschakelaars' }, [
         el('li', { className: 'print-rcd-key-title', text: 'Aardlekschakelaars:' })
      ].concat(used.map(function (entry) {
         return el('li', null, [
            el('span', { className: 'print-rcd-swatch', style: 'background-color: ' + entry.rcd.color }),
            el('span', { text: rcdHelpers.keyText(entry, state.phaseEnabled) })
         ]);
      })));
   }

   function renderWarnings() {
      const selected = warnings.selected(state.warnings);
      if (!selected.length) return null;
      return el('div', { className: 'print-warnings' }, selected.map(function (warning) {
         return el('div', { className: 'print-warning' }, [
            el('img', { src: warning.image, alt: warning.label })
         ]);
      }));
   }

   function renderUnusedRcds() {
      const groups = state.boxes.flatMap(function (box) { return box.groups; });
      const unused = rcdHelpers.unused(state.rcds, groups);
      if (!unused.length) return null;
      return el('section', { className: 'print-unused-rcds' }, [
         el('h3', { text: 'Aardlekschakelaars niet in gebruik' }),
         el('ul', null, unused.map(function (entry) {
            return el('li', null, [
               el('span', { className: 'print-rcd-swatch', style: 'background-color: ' + entry.rcd.color }),
               el('span', { text: rcdHelpers.keyText(entry, state.phaseEnabled) })
            ]);
         }))
      ]);
   }

   function renderBoxes() {
      boxesEl.replaceChildren.apply(boxesEl, state.boxes.map(renderBox));
   }

   function render() {
      warningInputs.forEach(function (node) { node.checked = state.warnings.includes(node.value); });
      phaseEnabledEl.checked = state.phaseEnabled;
      qrEnabledEl.checked = state.qrEnabled;
      fillRowsEl.checked = fillRows;
      renderQrStatus();
      renderRcds();
      renderBoxes();
      emptyEl.hidden = state.boxes.length > 0;
      renderPrint();
   }

   function hasData() {
      return !storageWritable || state.boxes.length || state.warnings.length || state.qrEnabled || state.rcdEnabled || state.phaseEnabled;
   }

   function shareUrl() {
      return share.url(window.location.href, serializeState(state));
   }

   function renderQrStatus() {
      const tooLarge = state.qrEnabled && share.qr(shareUrl()) === null;
      qrStatusEl.hidden = !tooLarge;
      qrStatusEl.textContent = tooLarge
         ? 'De gegevens zijn te groot voor een QR-code. De PDF wordt zonder QR-code gemaakt; gebruik Exporteren om alles te bewaren.'
         : '';
   }

   // Replaces the data with the card in the page address (the link in a QR code). Returns whether it did.
   function importFromLink() {
      const hash = window.location.hash;
      if (!share.isLink(hash)) return false;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      try {
         const data = normalize(share.decode(hash));
         if (hasData() && !confirm('Huidige gegevens vervangen door de groepenkaart uit de link?')) return false;
         state = data;
         storageWritable = true;
         return true;
      } catch (e) {
         alert('Openen van de link mislukt: ' + e.message);
         return false;
      }
   }

   function exportJson() {
      const data = { $schema: schema.schemaUrl, ...serializeState(state) };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'groepenkaart.json' });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
   }

   function importJson(file) {
      const reader = new FileReader();
      reader.onload = function () {
         try {
            const data = normalize(JSON.parse(reader.result));
            if (hasData() && !confirm('Huidige gegevens vervangen door het geïmporteerde bestand?')) return;
            state = data;
            storageWritable = true;
            update();
         } catch (e) {
            alert('Importeren mislukt: ' + (e instanceof SyntaxError ? 'geen geldig JSON-bestand.' : e.message));
         }
      };
      reader.readAsText(file);
   }

   document.getElementById('add-box').addEventListener('click', function () {
      state.boxes.push({
         id: uid(),
         number: nextNumber(state.boxes),
         name: '',
         supply: null,
         groups: [{ id: uid(), type: 'MCB', number: '1', description: '', characteristic: '', rcdId: null, phases: [] }]
      });
      update();
      const last = boxesEl.lastElementChild;
      if (last) {
         last.scrollIntoView({ behavior: 'smooth', block: 'start' });
         last.querySelectorAll('input')[1].focus({ preventScroll: true });
      }
   });

   document.getElementById('download-pdf').addEventListener('click', function () {
      if (!state.boxes.length) {
         alert('Voeg eerst een kast toe.');
         return;
      }
      const qr = state.qrEnabled ? share.qr(shareUrl()) : null;
      const imageElements = typeof document.querySelectorAll === 'function'
         ? Array.from(document.querySelectorAll('.print-warning img'))
         : [];
      const warningImages = imageElements.map(function (image) {
         if (!image.complete || !image.naturalWidth) return null;
         const canvas = document.createElement('canvas');
         canvas.width = image.naturalWidth;
         canvas.height = image.naturalHeight;
         canvas.getContext('2d').drawImage(image, 0, 0);
         return canvas;
      });
      if (warningImages.some(function (image) { return !image; })) {
         window.print();
         return;
      }
      if (!window.GroepenkaartPdf || !window.GroepenkaartPdf.download(state.boxes, minRows(), state.warnings, state.rcds, state.phaseEnabled, qr, rcdFirst, warningImages)) {
         window.print();
      }
   });

   // Keeps the printed date current if the page stays open across days.
   window.addEventListener('beforeprint', renderPrint);

   document.getElementById('export-json').addEventListener('click', exportJson);

   document.getElementById('import-json').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) importJson(file);
      e.target.value = '';
   });

   qrEnabledEl.addEventListener('change', function () {
      state.qrEnabled = qrEnabledEl.checked;
      update();
   });

   fillRowsEl.addEventListener('change', function () {
      fillRows = fillRowsEl.checked;
      saveFillRows();
      renderPrint();
   });

   rcdFirstEl.addEventListener('change', function () {
      rcdFirst = rcdFirstEl.checked;
      saveRcdFirst();
      renderPrint();
   });

   phaseEnabledEl.addEventListener('change', function () {
      state.phaseEnabled = phaseEnabledEl.checked;
      update();
   });

   rcdEnabledEl.addEventListener('change', function () {
      if (rcdEnabledEl.checked) {
         state.rcdEnabled = true;
         update();
         return;
      }
      if (state.rcds.length && !confirm('Alle Aardlekschakelaars en de koppelingen van modules worden gewist. Doorgaan?')) {
         rcdEnabledEl.checked = true;
         return;
      }
      state.rcdEnabled = false;
      state.rcds = [];
      state.boxes.forEach(function (box) {
         box.groups.forEach(function (module) {
            module.rcdId = null;
            if (protectiveTypes.includes(module.type)) {
               module.type = 'MCB';
               ['color', 'name', 'sensitivity', 'rcdType', 'ratedCurrent'].forEach(function (key) { delete module[key]; });
            }
         });
      });
      update();
   });

   document.getElementById('add-rcd').addEventListener('click', function () {
      const number = rcdHelpers.nextNumber(state.rcds);
      const rcd = { id: uid(), number: number, name: '', color: rcdHelpers.defaultColor(number), amountOfPoles: 2, phases: [] };
      state.rcds.push(rcd);
      update();
      const last = rcdListEl.lastElementChild;
      if (last) last.querySelectorAll('input[type="text"]')[1].focus();
   });

   document.getElementById('clear-all').addEventListener('click', function () {
      if (hasData() && confirm('Weet je zeker dat je alle kasten, modules, Aardlekschakelaars, installatiewaarschuwingen en fase- en QR-instellingen wilt wissen?')) {
         state = normalize(schema.empty());
         storageWritable = true;
         update();
      }
   });

   window.addEventListener('hashchange', function () {
      if (importFromLink()) update();
   });

   const importedFromLink = importFromLink();
   render();
   if (loadedFromStorage || importedFromLink) save();
})();
