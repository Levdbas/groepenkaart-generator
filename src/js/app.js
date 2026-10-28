(function () {
   'use strict';

   const STORAGE_KEY = 'groepenkaart:v1';
   const RCD_FIRST_KEY = 'groepenkaart:rcd-first';
   const EXPERT_MODE_KEY = 'groepenkaart:expert-mode';
   const warnings = window.GroepenkaartWarnings;
   const schema = window.GroepenkaartSchema;
   const moduleTypes = schema.moduleTypes;
   const limits = schema.boxLimits;
   const layout = window.GroepenkaartLayout;
   const rcdHelpers = window.GroepenkaartRcd;
   const specialInstallationTypes = schema.specialInstallationTypes;
   const share = window.GroepenkaartShare;
   const protectiveTypes = ['RCD-2P', 'RCD-4P', 'RCBO-2P', 'RCBO-4P'];
   const circuitTypes = ['MCB', 'MCB-2P', 'MCB-3P', 'RCBO-2P', 'RCBO-4P'];
   const mcbLinkTargets = circuitTypes;
   const supplySourceTypes = circuitTypes.concat(['RCD-2P', 'RCD-4P']);
   const protectiveKeys = ['color', 'name', 'sensitivity', 'rcdType', 'ratedCurrent'];
   const boxPresets = [[1, 12], [2, 12], [3, 12], [4, 12]];
   // Regional grid operators (netbeheerders) of Netbeheer Nederland; anything else is entered via "Anders".
   const gridOperators = ['Coteq', 'Enexis', 'Liander', 'RENDO', 'Stedin', 'Westland Infra'];
   const otherOperator = 'other';
   // Boxes where "Anders" is chosen but no name is typed yet; the stored value is plain text either way.
   const customOperatorBoxes = new Set();

   let storageWritable = true;
   let loadedFromStorage = false;
   let qrStatusTimer;
   let state = load();
   let rcdFirst = loadRcdFirst();
   let expertMode = loadExpertMode();
   let selectedId = null;
   let dialogState = null;

   const boxesEl = document.getElementById('boxes');
   const emptyEl = document.getElementById('empty-state');
   const printEl = document.getElementById('print-area');
   const qrEnabledEl = document.getElementById('qr-enabled');
   const rcdFirstEl = document.getElementById('rcd-first');
   rcdFirstEl.checked = rcdFirst;
   const expertModeEl = document.getElementById('expert-mode');
   const qrStatusEl = document.getElementById('qr-status');
   const rcdEnabledEl = document.getElementById('rcd-enabled');
   const phaseEnabledEl = document.getElementById('phase-enabled');
   const generalInfoEl = document.getElementById('general-info');
   generalInfoEl.value = state.generalInfo;
   const unplacedEl = document.getElementById('unplaced');
   const unplacedListEl = document.getElementById('unplaced-list');
   const moduleDialogEl = document.getElementById('module-dialog');
   const boxDialogEl = document.getElementById('box-dialog');

   function uid() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
         return window.crypto.randomUUID();
      }
      return Date.now().toString(36) + Math.random().toString(36).slice(2);
   }

   function clone(value) {
      return JSON.parse(JSON.stringify(value));
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

   // Expert mode only shows extra editor fields; it is a preference of this device, not card data.
   function loadExpertMode() {
      try {
         return localStorage.getItem(EXPERT_MODE_KEY) === 'true';
      } catch (e) {
         return false;
      }
   }

   function saveExpertMode() {
      try {
         localStorage.setItem(EXPERT_MODE_KEY, String(expertMode));
      } catch (e) {
         console.warn('Opslaan mislukt', e);
      }
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

   // The editor works directly on the v6 data: modules plus boxes that list their placed modules.
   function normalize(data) {
      return schema.normalize(data);
   }

   function serializeState(data) {
      return schema.normalize(data);
   }

   function nextNumber(items) {
      const nums = items.map(function (i) { return parseInt(i.number, 10); }).filter(function (n) { return !isNaN(n); });
      return String(nums.length ? Math.max.apply(null, nums) + 1 : items.length + 1);
   }

   function isProtective(module) {
      return protectiveTypes.includes(module.type);
   }

   function findBox(id) {
      return state.boxes.find(function (b) { return b.id === id; }) || null;
   }

   function findModule(id) {
      return state.modules.find(function (m) { return m.id === id; }) || null;
   }

   function boxModules(box) {
      return box.moduleIds.map(findModule).filter(Boolean);
   }

   // The RCD or RCBO that protects a module, directly or through the MCB it is connected to.
   function rcdOf(module) {
      let protection = module.protectedByModuleId && findModule(module.protectedByModuleId);
      if (protection && !isProtective(protection)) {
         protection = protection.protectedByModuleId && findModule(protection.protectedByModuleId);
      }
      return protection && isProtective(protection) ? protection : null;
   }

   // Types that can connect to an MCB link to a circuit breaker only (plus an RCD for rcdLinkable types); every other type links to an RCD or RCBO.
   function canLink(type, target) {
      if (!moduleTypes.mcbLinkable(type)) return isProtective(target);
      return mcbLinkTargets.includes(target.type) || (moduleTypes.rcdLinkable(type) && isProtective(target));
   }

   // The circuit breaker a module is connected to, for types that can be linked to one.
   function mcbOf(module) {
      const target = module.protectedByModuleId && findModule(module.protectedByModuleId);
      return target && moduleTypes.mcbLinkable(module.type) && mcbLinkTargets.includes(target.type) ? target : null;
   }

   // The phases a module effectively has: those of the circuit breaker it is connected to, all three for three-phase
   // types, those of a 2-pole RCD or RCBO that protects it, or its own selection.
   function effectivePhases(module) {
      const mcb = mcbOf(module);
      if (mcb) return effectivePhases(mcb);
      if (moduleTypes.allPhases(module.type)) return rcdHelpers.phaseCodes.slice();
      const protection = rcdOf(module) || (isProtective(module) ? module : null);
      return protection && ['RCD-2P', 'RCBO-2P'].includes(protection.type) ? protection.phases.slice() : module.phases.slice();
   }

   // A module's own warnings plus those of every box it feeds, directly or through further sub-distributions.
   function effectiveWarnings(module, seen) {
      const visited = seen || new Set();
      const codes = (module.warnings || []).slice();
      state.boxes.forEach(function (box) {
         if (!box.supply || box.supply.type !== 'subdistribution' || box.supply.sourceModuleId !== module.id || visited.has(box.id)) return;
         visited.add(box.id);
         boxModules(box).forEach(function (inner) { codes.push.apply(codes, effectiveWarnings(inner, visited)); });
      });
      return warnings.codes.filter(function (code) { return codes.includes(code); });
   }

   function unplacedModules() {
      return state.modules.filter(function (module) { return module.boxId === null; });
   }

   function moduleWidth(module) {
      return moduleTypes.widthOf(module);
   }

   function widthText(width) {
      return width + (width === 1 ? ' DIN-module' : ' DIN-modules');
   }

   // The width of a type in the type list: a range when modules of the type can choose their width.
   function typeWidthText(type) {
      const range = moduleTypes.widthRange(type.slug);
      return range ? range[0] + '–' + range[1] + ' DIN-modules' : widthText(type.width);
   }

   function layoutItems(box) {
      return boxModules(box).map(function (module) {
         return { id: module.id, rail: module.rail, slot: module.slot, width: moduleWidth(module) };
      });
   }

   // Keeps the module list of a box in physical order: rail by rail, left to right.
   function sortBox(box) {
      box.moduleIds = layout.sortByPosition(layoutItems(box)).map(function (item) { return item.id; });
   }

   function nextModuleNumber(box) {
      return nextNumber(box ? boxModules(box).filter(function (module) { return !isProtective(module); }) : []);
   }

   // RCDs and RCBOs in physical order across the boxes, then the ones without a place.
   function protectiveModules() {
      return state.boxes.flatMap(boxModules).concat(unplacedModules()).filter(isProtective);
   }

   // The RCD shape used by the legend, the print output and the PDF.
   function rcdView(module) {
      return {
         ...module,
         name: module.name || module.description || '',
         amountOfPoles: module.type.endsWith('4P') ? 4 : 2,
         phases: module.phases.slice()
      };
   }

   function rcdViews() {
      return protectiveModules().map(rcdView);
   }

   function groupView(module) {
      const rcd = rcdOf(module);
      const mcb = mcbOf(module);
      const view = {
         ...module,
         // RCDs migrated from v4 only carry a name.
         description: module.description || (isProtective(module) && module.name) || '',
         rcdId: rcd ? rcd.id : null,
         ...(mcb ? { connectedTo: mcb.number || mcb.description || mcb.type } : {}),
         ...(mcb && rcd ? { connectedRcd: rcdHelpers.label(rcd, protectiveModules().indexOf(rcd)) } : {}),
         phases: mcb ? effectivePhases(mcb) : moduleTypes.allPhases(module.type) ? rcdHelpers.phaseCodes.slice() : module.phases.slice(),
         ...(module.items ? { items: module.items.slice() } : {})
      };
      const inherited = effectiveWarnings(module);
      if (inherited.length) view.warnings = inherited;
      else delete view.warnings;
      // A module connected to a circuit breaker takes over its rated current.
      if (mcb) {
         if (mcb.ratedCurrent !== undefined) view.ratedCurrent = mcb.ratedCurrent;
         else delete view.ratedCurrent;
      }
      return view;
   }

   // Boxes with their modules in physical order, as used by the print output and the PDF. rows holds the table rows:
   // the groups, with a null for every free slot.
   function printBoxes() {
      return state.boxes.map(function (box) {
         const groups = boxModules(box).map(groupView);
         const byId = {};
         groups.forEach(function (group) { byId[group.id] = group; });
         const rows = layout.rows(box, layoutItems(box)).map(function (id) { return id && byId[id]; });
         return { id: box.id, number: box.number, name: box.name, supply: box.supply, groups: groups, rows: rows };
      });
   }

   function moduleColor(module) {
      if (isProtective(module)) return module.color;
      const protection = rcdOf(module);
      return protection ? protection.color : null;
   }

   function moduleLabel(module) {
      return (module.number ? 'module ' + module.number : 'module zonder nummer') +
         (module.description ? ' (' + module.description + ')' : '');
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

   function gridColumn(slot, width) {
      return 'grid-column: ' + slot + ' / span ' + width;
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

   function labelField(text, control, className) {
      return el('label', { className: 'field' + (className ? ' ' + className : '') }, [el('span', { text: text }), control]);
   }

   function swatch(color) {
      return el('span', { className: 'rcd-swatch' + (color ? '' : ' is-empty'), style: color ? 'background-color: ' + color : '', 'aria-hidden': 'true' });
   }

   function showDialog(dialog) {
      if (typeof dialog.showModal === 'function') {
         if (!dialog.open) dialog.showModal();
      } else {
         dialog.open = true;
      }
   }

   function hideDialog(dialog) {
      if (typeof dialog.close === 'function') {
         if (dialog.open) dialog.close();
      } else {
         dialog.open = false;
      }
   }

   function focusIn(root, selector) {
      if (!root || typeof root.querySelector !== 'function') return;
      const node = root.querySelector(selector);
      if (node) node.focus();
   }

   function focusModule(id) {
      focusIn(boxesEl, '[data-module-id="' + id + '"]');
   }

   // Warning cards follow the modules that flag an installation, in the fixed card order.
   function activeWarnings() {
      const flagged = state.modules.flatMap(function (module) { return module.warnings || []; });
      return warnings.codes.filter(function (code) { return flagged.includes(code); });
   }

   function rcdOptionText(rcd, index) {
      return rcd.name.trim() ? rcdHelpers.label(rcd, index) + ' – ' + rcd.name.trim() : rcdHelpers.label(rcd, index);
   }

   /* ---------- Module dialog ---------- */

   // The widest module that fits where the draft sits, ignoring the draft itself. Unplaced modules have no limit.
   function maxWidth(draft) {
      const box = draft.boxId && findBox(draft.boxId);
      if (!box) return Infinity;
      return layout.freeRun(box, layoutItems(box), draft.rail, draft.slot, draft.id);
   }

   function openModuleDialog(module, target) {
      const draft = module ? clone(module) : {
         id: uid(), boxId: target.box.id, rail: target.rail, slot: target.slot, type: 'MCB',
         number: nextModuleNumber(target.box), description: '', characteristic: '', phases: [], protectedByModuleId: null
      };
      // RCDs migrated from v4 only have a name; the dialog edits it as the description.
      if (isProtective(draft) && !draft.description && draft.name) draft.description = draft.name;
      dialogState = { draft: draft, original: module || null, autoNumber: !module };
      renderModuleDialog();
      showDialog(moduleDialogEl);
      focusIn(moduleDialogEl, '[data-field="description"]');
   }

   function closeModuleDialog() {
      dialogState = null;
      hideDialog(moduleDialogEl);
   }

   function rerenderModuleDialog(field) {
      renderModuleDialog();
      if (field) focusIn(moduleDialogEl, '[data-field="' + field + '"]');
   }

   function applyTypeChange(draft, type) {
      const previous = draft.type;
      if (previous === type) return;
      const definition = moduleTypes.get(type);
      const box = draft.boxId && findBox(draft.boxId);
      if (protectiveTypes.includes(type)) {
         // A 2-pole device has one phase: keep a single chosen phase, but do not pick one out of a former three.
         draft.phases = type.endsWith('4P') ? rcdHelpers.phaseCodes.slice()
            : moduleTypes.allPhases(previous) ? [] : draft.phases.slice(0, 1);
         if (!protectiveTypes.includes(previous)) {
            if (dialogState.autoNumber) {
               draft.number = rcdHelpers.nextNumber(rcdViews().filter(function (rcd) { return rcd.id !== draft.id; }));
            }
            draft.color = draft.color || rcdHelpers.defaultColor(draft.number);
         }
         if (draft.protectedByModuleId === draft.id) draft.protectedByModuleId = null;
      } else {
         if (protectiveTypes.includes(previous)) {
            protectiveKeys.forEach(function (key) { delete draft[key]; });
            if (dialogState.autoNumber) draft.number = nextModuleNumber(box);
         }
         // One-phase types start without a phase; three-phase types always use all three.
         if (definition.phases === 1) draft.phases = [];
         else if (definition.phases === 2) draft.phases = draft.phases.slice(0, 2);
         else if (moduleTypes.allPhases(type)) draft.phases = rcdHelpers.phaseCodes.slice();
      }
      if (draft.warnings) {
         const kept = draft.warnings.filter(function (code) { return (definition.warnings || []).includes(code); });
         if (kept.length) draft.warnings = kept;
         else delete draft.warnings;
      }
      if (!specialInstallationTypes.includes(type)) delete draft.specialInstallations;
      if (!moduleTypes.protectable(type)) draft.protectedByModuleId = null;
      const linkedTarget = draft.protectedByModuleId && findModule(draft.protectedByModuleId);
      if (linkedTarget && !canLink(type, linkedTarget)) draft.protectedByModuleId = null;
      const range = moduleTypes.widthRange(type);
      if (range) draft.width = Math.max(range[0], Math.min(definition.width, maxWidth(draft)));
      else delete draft.width;
      draft.type = type;
   }

   function dialogText(draft, key, label, placeholder, onChange) {
      const node = el('input', { type: 'text', placeholder: placeholder || '', 'data-field': key, 'aria-label': label });
      node.value = draft[key] || '';
      node.addEventListener('input', function () {
         draft[key] = node.value;
         if (onChange) onChange(node.value);
      });
      return labelField(label, node, key === 'number' ? 'field-number' : '');
   }

   function typeField(draft) {
      const max = maxWidth(draft);
      const select = el('select', { 'data-field': 'type', 'aria-label': 'Moduletype' },
         moduleTypes.definitions.filter(function (type) {
            return moduleTypes.available(type.slug, state.phaseEnabled) || type.slug === draft.type;
         }).map(function (type) {
            const range = moduleTypes.widthRange(type.slug);
            const tooWide = (range ? range[0] : type.width) > max;
            const attrs = { value: type.slug, text: type.label + ' · ' + type.slug + ' · ' + typeWidthText(type) + (tooWide ? ' (past hier niet)' : '') };
            if (tooWide) attrs.disabled = 'disabled';
            return el('option', attrs);
         }));
      select.value = draft.type;
      select.addEventListener('change', function () {
         applyTypeChange(draft, select.value);
         rerenderModuleDialog('type');
      });
      return labelField('Moduletype', select, 'field-wide');
   }

   // Types with a variable width let the module choose it; widths that do not fit where the module sits are disabled.
   function widthField(draft) {
      const range = moduleTypes.widthRange(draft.type);
      if (!range) return null;
      const max = maxWidth(draft);
      const options = [];
      for (let width = range[0]; width <= range[1]; width++) {
         const attrs = { value: String(width), text: widthText(width) + (width > max ? ' (past hier niet)' : '') };
         if (width > max) attrs.disabled = 'disabled';
         options.push(el('option', attrs));
      }
      const select = el('select', { 'data-field': 'width', 'aria-label': 'Breedte' }, options);
      select.value = String(moduleWidth(draft));
      select.addEventListener('change', function () { draft.width = Number(select.value); });
      return labelField('Breedte', select);
   }

   function warningField(draft) {
      const allowed = (moduleTypes.get(draft.type) || {}).warnings;
      if (!allowed || !allowed.length) return null;
      return el('fieldset', { className: 'phase-choices' }, [
         el('legend', { text: 'Waarschuwingen' }),
         ...warnings.definitions.filter(function (warning) { return allowed.includes(warning.id); }).map(function (warning) {
            const checkbox = el('input', { type: 'checkbox', value: warning.id, 'data-field': 'warning-' + warning.id });
            checkbox.checked = (draft.warnings || []).includes(warning.id);
            checkbox.addEventListener('change', function () {
               const chosen = warnings.codes.filter(function (code) {
                  return code === warning.id ? checkbox.checked : (draft.warnings || []).includes(code);
               });
               if (chosen.length) draft.warnings = chosen;
               else delete draft.warnings;
            });
            return el('label', null, [checkbox, el('span', { text: warning.label })]);
         })
      ]);
   }

   function specialInstallationField(draft) {
      if (!specialInstallationTypes.includes(draft.type)) return null;
      return el('fieldset', { className: 'phase-choices' }, [
         el('legend', { text: 'Bijzondere installaties' }),
         ...warnings.specialInstallationDefinitions.map(function (installation) {
            const checkbox = el('input', { type: 'checkbox', value: installation.id, 'data-field': 'special-installation-' + installation.id });
            checkbox.checked = (draft.specialInstallations || []).includes(installation.id);
            checkbox.addEventListener('change', function () {
               const chosen = warnings.specialInstallationCodes.filter(function (code) {
                  return code === installation.id ? checkbox.checked : (draft.specialInstallations || []).includes(code);
               });
               if (chosen.length) draft.specialInstallations = chosen;
               else delete draft.specialInstallations;
            });
            return el('label', null, [checkbox, el('span', { text: installation.label })]);
         })
      ]);
   }

   function colorField(draft) {
      const color = el('input', { type: 'color', className: 'rcd-color', 'data-field': 'color', 'aria-label': 'Kleur aardlekschakelaar', title: 'Kleur kiezen' });
      color.value = draft.color;
      color.addEventListener('input', function () {
         if (rcdHelpers.isColor(color.value)) draft.color = color.value.toLowerCase();
      });
      return labelField('Kleur op de groepenkaart', color);
   }

   function protectionField(draft) {
      const mcbLinkable = moduleTypes.mcbLinkable(draft.type);
      const rcdLinkable = mcbLinkable && state.rcdEnabled && moduleTypes.rcdLinkable(draft.type);
      const options = mcbLinkable ? state.boxes.flatMap(boxModules).concat(unplacedModules()).filter(function (module) {
         return module.id !== draft.id && (mcbLinkTargets.includes(module.type) || (rcdLinkable && ['RCD-2P', 'RCD-4P'].includes(module.type)));
      }) : rcdViews().filter(function (rcd) { return rcd.id !== draft.id; });
      const select = el('select', { 'data-field': 'protection', 'aria-label': mcbLinkable ? 'Aangesloten op' : 'Aardlekschakelaar' }, [
         el('option', { value: '', text: 'Geen koppeling' })
      ].concat(options.map(function (item, index) {
         return el('option', {
            value: item.id,
            text: !mcbLinkable ? rcdOptionText(item, index)
               : ['RCD-2P', 'RCD-4P'].includes(item.type) ? rcdOptionText(rcdView(item), protectiveModules().indexOf(item))
               : [item.number, item.description].filter(Boolean).join(' – ') || item.type
         });
      })));
      select.value = draft.protectedByModuleId || '';
      select.addEventListener('change', function () {
         draft.protectedByModuleId = select.value || null;
         rerenderModuleDialog('protection');
      });
      const linked = rcdOf(draft);
      return labelField(mcbLinkable ? 'Aangesloten op' : 'Aardlekschakelaar',
         el('div', { className: 'rcd-select' }, [swatch(linked && linked.color), select]), 'field-wide');
   }

   function phaseField(draft) {
      const mcb = mcbOf(draft);
      if (mcb) {
         return labelField('Fasen', el('span', {
            className: 'phase-inherited', text: rcdHelpers.phaseText(effectivePhases(mcb)) + ' (via installatieautomaat)'
         }));
      }
      if (moduleTypes.allPhases(draft.type)) {
         return labelField('Fasen', el('span', { className: 'phase-inherited', text: rcdHelpers.phaseText(rcdHelpers.phaseCodes) }));
      }
      if (['RCD-2P', 'RCBO-2P'].includes(draft.type)) {
         const select = el('select', { 'data-field': 'phase', 'aria-label': 'Fase' }, [
            el('option', { value: '', text: 'Kies een fase' }),
            ...rcdHelpers.phaseCodes.map(function (phase) { return el('option', { value: phase, text: phase }); })
         ]);
         select.value = draft.phases[0] || '';
         select.addEventListener('change', function () {
            draft.phases = select.value ? [select.value] : [];
         });
         return labelField('Fase', select);
      }
      const protection = rcdOf(draft);
      if (protection && ['RCD-2P', 'RCBO-2P'].includes(protection.type)) {
         return labelField('Fasen', el('span', {
            className: 'phase-inherited', text: rcdHelpers.phaseText(protection.phases) + ' (via aardlekschakelaar)'
         }));
      }
      const status = el('span', { className: 'phase-status', text: rcdHelpers.phaseText(draft.phases) });
      return el('fieldset', { className: 'phase-choices' }, [
         el('legend', { text: 'Fasen' }),
         ...rcdHelpers.phaseCodes.map(function (phase) {
            const checkbox = el('input', { type: 'checkbox', value: phase, 'data-field': 'phase-' + phase });
            checkbox.checked = draft.phases.includes(phase);
            checkbox.addEventListener('change', function () {
               draft.phases = rcdHelpers.phaseCodes.filter(function (code) {
                  return code === phase ? checkbox.checked : draft.phases.includes(code);
               });
               status.textContent = rcdHelpers.phaseText(draft.phases);
            });
            return el('label', null, [checkbox, el('span', { text: phase })]);
         }),
         status
      ]);
   }

   function technicalFields(draft) {
      const fields = [];
      if (isProtective(draft)) {
         const sensitivity = el('select', { 'data-field': 'sensitivity', 'aria-label': 'Gevoeligheid' }, [
            el('option', { value: '', text: 'Niet ingesteld' }),
            ...[10, 30, 100, 300].map(function (value) { return el('option', { value: String(value), text: value + ' mA' }); })
         ]);
         sensitivity.value = draft.sensitivity === undefined ? '' : String(draft.sensitivity);
         sensitivity.addEventListener('change', function () {
            if (sensitivity.value) draft.sensitivity = Number(sensitivity.value);
            else delete draft.sensitivity;
         });
         fields.push(labelField('Gevoeligheid', sensitivity));
         const rcdType = el('select', { 'data-field': 'rcdType', 'aria-label': 'Aardlektype' }, [
            el('option', { value: '', text: 'Niet ingesteld' }),
            ...['AC', 'A', 'F', 'B', 'B+'].map(function (value) { return el('option', { value: value, text: 'Type ' + value }); })
         ]);
         rcdType.value = draft.rcdType || '';
         rcdType.addEventListener('change', function () {
            if (rcdType.value) draft.rcdType = rcdType.value;
            else delete draft.rcdType;
         });
         fields.push(labelField('Aardlektype', rcdType));
      }
      const mcb = mcbOf(draft);
      if (mcb) {
         fields.push(labelField('Nominale stroom (A)', el('span', {
            className: 'phase-inherited',
            text: (mcb.ratedCurrent === undefined ? 'Niet ingesteld' : mcb.ratedCurrent + ' A') + ' (via installatieautomaat)'
         })));
         return el('div', { className: 'module-technical-controls' }, fields);
      }
      const ratedCurrent = el('input', { type: 'number', min: '1', step: '1', placeholder: 'A', 'data-field': 'ratedCurrent', 'aria-label': 'Nominale stroom' });
      ratedCurrent.value = draft.ratedCurrent === undefined ? '' : String(draft.ratedCurrent);
      ratedCurrent.addEventListener('input', function () {
         const value = Number(ratedCurrent.value);
         if (ratedCurrent.value && Number.isFinite(value) && value > 0) draft.ratedCurrent = value;
         else delete draft.ratedCurrent;
      });
      fields.push(labelField('Nominale stroom (A)', ratedCurrent));
      return el('div', { className: 'module-technical-controls' }, fields);
   }

   function itemsField(draft) {
      const node = el('textarea', { rows: '3', placeholder: 'Eén aansluiting per regel', 'data-field': 'items', 'aria-label': 'Aansluitingen' });
      node.value = (draft.items || []).join('\n');
      node.addEventListener('input', function () {
         const items = node.value.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
         if (items.length) draft.items = items;
         else delete draft.items;
      });
      return labelField('Aansluitingen (één per regel)', node, 'field-wide');
   }

   // On an empty slot, modules without a place that fit there can be placed instead of adding a new one.
   function unplacedChoices(draft) {
      const box = findBox(draft.boxId);
      if (!box) return null;
      const max = maxWidth(draft);
      const candidates = unplacedModules().filter(function (module) { return moduleWidth(module) <= max; });
      if (!candidates.length) return null;
      return el('section', { className: 'dialog-unplaced' }, [
         el('h3', { text: 'Niet-geplaatste module hier plaatsen' }),
         el('ul', null, candidates.map(function (module) {
            return el('li', null, [
               el('button', {
                  type: 'button', className: 'btn unplaced-choice',
                  onclick: function () { placeModule(module, box, draft.rail, draft.slot); }
               }, [swatch(moduleColor(module)), el('span', { text: [module.number, module.description || module.name, module.type].filter(Boolean).join(' · ') })])
            ]);
         })),
         el('p', { className: 'dialog-divider', text: 'Of voeg hieronder een nieuwe module toe.' })
      ]);
   }

   function renderModuleDialog() {
      const draft = dialogState.draft;
      const editing = !!dialogState.original;
      const box = draft.boxId && findBox(draft.boxId);
      const fields = [
         typeField(draft),
         widthField(draft),
         dialogText(draft, 'number', isProtective(draft) ? 'Code' : 'Nummer', isProtective(draft) ? 'Bijv. A1' : 'Nr', function () {
            dialogState.autoNumber = false;
         }),
         dialogText(draft, 'description', 'Omschrijving', isProtective(draft) ? 'Bijv. Keuken en badkamer' : 'Bijv. Keuken'),
         isProtective(draft) ? colorField(draft) : null,
         warningField(draft),
         specialInstallationField(draft),
         dialogText(draft, 'characteristic', 'Vrij kenmerk', 'Bijv. B16'),
         state.rcdEnabled && moduleTypes.protectable(draft.type) && (!isProtective(draft) || draft.protectedByModuleId) ||
            moduleTypes.mcbLinkable(draft.type) ? protectionField(draft) : null,
         state.phaseEnabled ? phaseField(draft) : null,
         expertMode ? technicalFields(draft) : null,
         itemsField(draft)
      ];
      const form = el('form', {
         className: 'module-form', method: 'dialog',
         onsubmit: function (event) {
            event.preventDefault();
            saveModuleDialog();
         }
      }, [
         el('header', { className: 'dialog-header' }, [
            el('h2', { text: editing ? 'Module bewerken' : 'Module toevoegen' }),
            el('p', { className: 'dialog-subtitle', text: box ? 'Kast ' + box.number + ' · rail ' + draft.rail + ' · plek ' + draft.slot : 'Niet geplaatst' })
         ]),
         editing ? null : unplacedChoices(draft),
         el('div', { className: 'module-fields' }, fields),
         el('footer', { className: 'dialog-actions' }, [
            el('button', { type: 'button', className: 'btn', text: 'Annuleren', onclick: closeModuleDialog }),
            el('button', { type: 'submit', className: 'btn btn-primary', text: editing ? 'Opslaan' : 'Toevoegen' })
         ])
      ]);
      moduleDialogEl.replaceChildren(form);
   }

   function saveModuleDialog() {
      const draft = dialogState.draft;
      const original = dialogState.original;
      const snapshot = clone(state);
      if (isProtective(draft)) {
         draft.name = draft.description;
      } else {
         delete draft.rcdType;
      }
      if (original && original.type !== draft.type) {
         const unlinked = state.modules.filter(function (module) {
            return module.protectedByModuleId === original.id && !canLink(module.type, draft);
         });
         const dependents = unlinked.length;
         if (isProtective(original) && !isProtective(draft) && dependents && !confirm('Dit moduletype levert geen aardlekbeveiliging meer. ' + dependents +
            (dependents === 1 ? ' gekoppelde module wordt ontkoppeld. Doorgaan?' : ' gekoppelde modules worden ontkoppeld. Doorgaan?'))) {
            return;
         }
         unlinked.forEach(function (module) { module.protectedByModuleId = null; });
      }
      if (isProtective(draft)) state.rcdEnabled = true;
      if (original) {
         state.modules[state.modules.indexOf(original)] = draft;
      } else {
         state.modules.push(draft);
         findBox(draft.boxId).moduleIds.push(draft.id);
      }
      if (draft.boxId) sortBox(findBox(draft.boxId));
      try {
         serializeState(state);
      } catch (error) {
         state = snapshot;
         alert('Module niet opgeslagen: ' + error.message);
         return;
      }
      selectedId = draft.boxId ? draft.id : null;
      closeModuleDialog();
      update();
      focusModule(draft.id);
   }

   function placeModule(module, box, rail, slot) {
      module.boxId = box.id;
      module.rail = rail;
      module.slot = slot;
      box.moduleIds.push(module.id);
      sortBox(box);
      selectedId = module.id;
      closeModuleDialog();
      update();
      focusModule(module.id);
   }

   /* ---------- Box dialog ---------- */

   function boxSizeInput(key, value) {
      const min = key === 'rails' ? limits.minRails : limits.minRailWidth;
      const max = key === 'rails' ? limits.maxRails : limits.maxRailWidth;
      const node = el('input', { type: 'number', min: String(min), max: String(max), step: '1', inputmode: 'numeric', 'data-field': key, className: 'input-number' });
      node.value = String(value);
      return node;
   }

   function sizeError(rails, railWidth) {
      if (!Number.isInteger(rails) || rails < limits.minRails || rails > limits.maxRails) {
         return 'Het aantal rails moet een geheel getal van ' + limits.minRails + ' tot ' + limits.maxRails + ' zijn.';
      }
      if (!Number.isInteger(railWidth) || railWidth < limits.minRailWidth || railWidth > limits.maxRailWidth) {
         return 'Het aantal modules per rail moet een geheel getal van ' + limits.minRailWidth + ' tot ' + limits.maxRailWidth + ' zijn.';
      }
      return '';
   }

   function openBoxDialog() {
      const rails = boxSizeInput('rails', 2);
      const railWidth = boxSizeInput('railWidth', limits.defaultRailWidth);
      rails.setAttribute('aria-label', 'Aantal rails');
      railWidth.setAttribute('aria-label', 'Modules per rail');
      const summary = el('p', { className: 'dialog-subtitle', 'aria-live': 'polite' });
      const presets = boxPresets.map(function (preset) {
         return el('button', {
            type: 'button', className: 'btn box-preset', text: preset[0] + ' × ' + preset[1],
            onclick: function () {
               rails.value = String(preset[0]);
               railWidth.value = String(preset[1]);
               refresh();
            }
         });
      });
      function refresh() {
         const r = Number(rails.value);
         const w = Number(railWidth.value);
         summary.textContent = sizeError(r, w) || r + (r === 1 ? ' rail' : ' rails') + ' van ' + w + ' modules: ' + r * w + ' plekken.';
         presets.forEach(function (button, index) {
            button.className = 'btn box-preset' + (boxPresets[index][0] === r && boxPresets[index][1] === w ? ' is-active' : '');
         });
      }
      rails.addEventListener('input', refresh);
      railWidth.addEventListener('input', refresh);
      refresh();
      const form = el('form', {
         className: 'box-form', method: 'dialog',
         onsubmit: function (event) {
            event.preventDefault();
            const r = Number(rails.value);
            const w = Number(railWidth.value);
            const error = sizeError(r, w);
            if (error) {
               alert(error);
               return;
            }
            hideDialog(boxDialogEl);
            addBox(r, w);
         }
      }, [
         el('header', { className: 'dialog-header' }, [
            el('h2', { text: 'Kast toevoegen' }),
            el('p', { text: 'Kies hoeveel DIN-rails de kast heeft en hoeveel modules er op één rail passen.' })
         ]),
         el('div', { className: 'box-presets', role: 'group', 'aria-label': 'Veelgebruikte maten' }, presets),
         el('div', { className: 'box-size-fields' }, [labelField('Rails', rails), el('span', { className: 'box-size-times', text: '×' }), labelField('Modules per rail', railWidth)]),
         summary,
         el('footer', { className: 'dialog-actions' }, [
            el('button', { type: 'button', className: 'btn', text: 'Annuleren', onclick: function () { hideDialog(boxDialogEl); } }),
            el('button', { type: 'submit', className: 'btn btn-primary', text: 'Kast toevoegen' })
         ])
      ]);
      boxDialogEl.replaceChildren(form);
      showDialog(boxDialogEl);
   }

   function addBox(rails, railWidth) {
      state.boxes.push({
         id: uid(), number: nextNumber(state.boxes), name: '', rails: rails, railWidth: railWidth, moduleIds: [], supply: null
      });
      update();
      const last = boxesEl.lastElementChild;
      if (last) {
         last.scrollIntoView({ behavior: 'smooth', block: 'start' });
         focusIn(last, '[data-field="box-name"]');
      }
   }

   function boxSizeField(box, key, label) {
      const node = boxSizeInput(key, box[key]);
      node.setAttribute('aria-label', label + ' kast ' + box.number);
      // Applied on change rather than per keystroke, so typing "18" does not first try a width of 1.
      node.addEventListener('change', function () {
         const size = { rails: box.rails, railWidth: box.railWidth };
         size[key] = Number(node.value);
         const error = sizeError(size.rails, size.railWidth);
         const blocked = error ? [] : layout.outside(layoutItems(box), size.rails, size.railWidth).map(function (item) {
            return moduleLabel(findModule(item.id));
         });
         if (error || blocked.length) {
            alert(error || 'De kast kan niet zo klein worden: ' + blocked.join(', ') +
               (blocked.length === 1 ? ' past dan niet meer. Verplaats of verwijder deze module eerst.' : ' passen dan niet meer. Verplaats of verwijder deze modules eerst.'));
            node.value = String(box[key]);
            return;
         }
         box[key] = size[key];
         update();
      });
      return labelField(label, node, 'field-size');
   }

   /* ---------- Visual box ---------- */

   function select(id) {
      selectedId = id;
      renderBoxes();
      focusModule(id);
   }

   function moveModule(box, module, direction) {
      const changes = layout.move(box, layoutItems(box), module.id, direction);
      if (!changes) return;
      Object.keys(changes).forEach(function (id) { Object.assign(findModule(id), changes[id]); });
      sortBox(box);
      selectedId = module.id;
      update();
      focusModule(module.id);
   }

   // The copy keeps type, width, protection and settings, gets a new number and goes into the next free place.
   function duplicateModule(box, module) {
      const position = layout.nextFree(box, layoutItems(box), module.id, moduleWidth(module));
      if (!position) return;
      const copy = clone(module);
      copy.id = uid();
      copy.rail = position.rail;
      copy.slot = position.slot;
      if (isProtective(copy)) {
         copy.number = rcdHelpers.nextNumber(rcdViews());
         copy.color = rcdHelpers.defaultColor(copy.number);
      } else {
         copy.number = nextModuleNumber(box);
      }
      state.modules.push(copy);
      box.moduleIds.push(copy.id);
      sortBox(box);
      selectedId = copy.id;
      update();
      focusModule(copy.id);
   }

   function moduleKeydown(box, module, event) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
         event.preventDefault();
         moveModule(box, module, event.key === 'ArrowRight' ? 1 : -1);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
         event.preventDefault();
         removeModule(module);
      } else if (event.key === 'Escape' && selectedId) {
         selectedId = null;
         renderBoxes();
         focusModule(module.id);
      }
   }

   function renderModule(box, module) {
      const width = moduleWidth(module);
      const color = moduleColor(module);
      const selected = module.id === selectedId;
      const flagged = warnings.selected(effectiveWarnings(module));
      const specialInstallations = warnings.selectedSpecialInstallations(module.specialInstallations || []);
      const description = [moduleLabel(module), module.type]
         .concat(flagged.map(function (warning) { return warning.label; }))
         .concat(specialInstallations.map(function (installation) { return installation.label; })).filter(Boolean).join(', ');
      return el('button', {
         type: 'button',
         className: 'din-module' + (selected ? ' is-selected' : '') + (width > 1 ? ' is-wide' : '') + (isProtective(module) ? ' is-protective' : ''),
         style: gridColumn(module.slot, width),
         'data-module-id': module.id,
         'aria-pressed': String(selected),
         'aria-label': description.charAt(0).toUpperCase() + description.slice(1),
         title: selected ? 'Klik om te bewerken' : 'Klik om te selecteren',
         onclick: function () {
            if (selectedId === module.id) openModuleDialog(module);
            else select(module.id);
         },
         onkeydown: function (event) { moduleKeydown(box, module, event); }
      }, [
         el('span', { className: 'din-module-stripe' + (color ? '' : ' is-empty'), style: color ? 'background-color: ' + color : '', 'aria-hidden': 'true' }),
         el('span', { className: 'din-module-number', text: module.number || '–', 'aria-hidden': 'true' }),
         el('span', { className: 'din-module-lever', 'aria-hidden': 'true' }),
         width > 1 ? el('span', { className: 'din-module-type', text: module.type, 'aria-hidden': 'true' }) : null,
         ...flagged.map(function (warning) {
            return el('span', { className: 'din-module-badge', text: warning.badge, 'aria-hidden': 'true' });
         }),
         ...specialInstallations.map(function (installation) {
            return el('span', { className: 'din-module-badge special-installation-badge', text: installation.badge, 'aria-hidden': 'true' });
         })
      ]);
   }

   function renderRail(box, rail, modules) {
      const cells = [];
      const labels = [];
      let slot = 1;
      while (slot <= box.railWidth) {
         const module = modules.find(function (candidate) { return candidate.rail === rail && candidate.slot === slot; });
         if (module) {
            const width = moduleWidth(module);
            cells.push(renderModule(box, module));
            labels.push(el('span', { className: 'din-label', style: gridColumn(slot, width), title: module.description, text: module.description }));
            slot += width;
         } else {
            const target = { box: box, rail: rail, slot: slot };
            const label = 'Module toevoegen op rail ' + rail + ', plek ' + slot;
            cells.push(el('button', {
               type: 'button', className: 'din-slot', style: gridColumn(slot, 1), title: label, 'aria-label': label, text: '+',
               onclick: function () { openModuleDialog(null, target); }
            }));
            slot += 1;
         }
      }
      return el('div', { className: 'din-rail', role: 'group', 'aria-label': 'Rail ' + rail }, [
         el('div', { className: 'din-rail-slots' }, cells),
         el('div', { className: 'din-rail-labels', 'aria-hidden': 'true' }, labels)
      ]);
   }

   function renderPanel(box) {
      const modules = boxModules(box);
      const rails = [];
      for (let rail = 1; rail <= box.rails; rail++) rails.push(renderRail(box, rail, modules));
      return el('div', { className: 'panel-scroll' }, [
         el('div', { className: 'panel', style: '--rail-width: ' + box.railWidth }, rails)
      ]);
   }

   function actionButton(text, title, onClick, disabled, className) {
      const attrs = { type: 'button', className: 'btn' + (className ? ' ' + className : ''), text: text, title: title, 'aria-label': title, onclick: onClick };
      if (disabled) attrs.disabled = 'disabled';
      return el('button', attrs);
   }

   function renderActionBar(box) {
      const module = selectedId && boxModules(box).find(function (candidate) { return candidate.id === selectedId; });
      if (!module) {
         return el('p', { className: 'panel-hint', text: 'Klik op + om een module toe te voegen. Klik op een module om hem te selecteren en nog een keer om hem te bewerken.' });
      }
      const items = layoutItems(box);
      return el('div', { className: 'panel-actions', role: 'toolbar', 'aria-label': 'Acties voor ' + moduleLabel(module) }, [
         el('span', { className: 'panel-actions-label', text: moduleLabel(module).replace(/^m/, 'M') }),
         actionButton('◀', 'Naar links', function () { moveModule(box, module, -1); }, !layout.move(box, items, module.id, -1)),
         actionButton('▶', 'Naar rechts', function () { moveModule(box, module, 1); }, !layout.move(box, items, module.id, 1)),
         actionButton('Bewerken', 'Module bewerken', function () { openModuleDialog(module); }),
         actionButton('Dupliceren', 'Module dupliceren naar de volgende vrije plek', function () { duplicateModule(box, module); },
            !layout.nextFree(box, items, module.id, moduleWidth(module))),
         actionButton('Verwijderen', 'Module verwijderen', function () { removeModule(module); }, false, 'btn-danger'),
         actionButton('Klaar', 'Selectie opheffen', function () { selectedId = null; renderBoxes(); })
      ]);
   }

   function renderBox(box, index) {
      return el('section', { className: 'box', 'data-id': box.id }, [
         el('div', { className: 'box-header' }, [
            el('label', { className: 'field' }, [
               el('span', { text: 'Kastnummer' }),
               input(box.number, 'Nr', 'Kastnummer', function (v) { box.number = v; }, 'input-number')
            ]),
            el('label', { className: 'field field-grow' }, [
               el('span', { text: 'Naam kast' }),
               (function () {
                  const name = input(box.name, 'Bijv. Meterkast begane grond', 'Naam kast', function (v) { box.name = v; });
                  name.setAttribute('data-field', 'box-name');
                  return name;
               })()
            ]),
            boxSizeField(box, 'rails', 'Rails'),
            boxSizeField(box, 'railWidth', 'Modules per rail'),
            el('div', { className: 'box-actions' }, [
               iconButton('↑', 'Kast omhoog', function () { move(state.boxes, index, -1); update(); }),
               iconButton('↓', 'Kast omlaag', function () { move(state.boxes, index, 1); update(); }),
               iconButton('✕', 'Kast verwijderen', function () { removeBox(box, index); }, 'btn-danger')
            ])
         ]),
         renderSupplyEditor(box),
         renderPanel(box),
         renderActionBar(box)
      ]);
   }

   function renderUnplaced() {
      const modules = unplacedModules();
      unplacedEl.hidden = !modules.length;
      unplacedListEl.replaceChildren.apply(unplacedListEl, modules.map(function (module) {
         return el('li', { className: 'unplaced-item', 'data-module-id': module.id }, [
            swatch(moduleColor(module)),
            el('span', { className: 'unplaced-text', text: [module.number, module.description || module.name].filter(Boolean).join(' · ') || 'Zonder nummer' }),
            el('span', { className: 'module-width', text: module.type + ' · ' + widthText(moduleWidth(module)) }),
            el('div', { className: 'row-actions' }, [
               iconButton('✎', 'Module bewerken', function () { openModuleDialog(module); }),
               iconButton('✕', 'Module verwijderen', function () { removeModule(module); }, 'btn-danger')
            ])
         ]);
      }));
   }

   function removeBox(box, index) {
      const ids = new Set(box.moduleIds);
      const dependents = state.boxes.filter(function (candidate) {
         return candidate !== box && candidate.supply && ids.has(candidate.supply.sourceModuleId);
      });
      const linked = state.modules.filter(function (module) { return !ids.has(module.id) && ids.has(module.protectedByModuleId); });
      const linkedBoxes = boxesLinkedTo(box);
      const consequences = [];
      if (ids.size) consequences.push(ids.size + (ids.size === 1 ? ' module wordt verwijderd' : ' modules worden verwijderd'));
      if (linked.length) consequences.push(linked.length + (linked.length === 1 ? ' module in een andere kast wordt ontkoppeld' : ' modules in andere kasten worden ontkoppeld'));
      if (dependents.length) consequences.push(dependents.length + ' voeding(en) verliezen de bronmodule');
      if (linkedBoxes.length) consequences.push(linkedBoxes.length + ' gekoppelde kast(en) verliezen de hoofdaansluiting');
      if (!confirm('Kast "' + (box.name || box.number) + '" verwijderen?' + (consequences.length ? ' ' + consequences.join('; ') + '.' : ''))) return;
      dependents.forEach(function (candidate) { candidate.supply.sourceModuleId = null; });
      linkedBoxes.forEach(function (candidate) { delete candidate.supply.sourceBoxId; });
      linked.forEach(function (module) { module.protectedByModuleId = null; });
      state.modules = state.modules.filter(function (module) { return !ids.has(module.id); });
      if (ids.has(selectedId)) selectedId = null;
      state.boxes.splice(index, 1);
      update();
   }

   function removeModule(module) {
      const linked = state.modules.filter(function (item) { return item.protectedByModuleId === module.id; }).length;
      const feedBoxes = state.boxes.filter(function (candidate) {
         return candidate.supply && candidate.supply.sourceModuleId === module.id;
      });
      const consequences = [];
      if (linked) consequences.push(linked + (linked === 1 ? ' module wordt ontkoppeld' : ' modules worden ontkoppeld'));
      if (feedBoxes.length) consequences.push(feedBoxes.length + ' voeding(en) verliezen de bronmodule');
      if (!confirm('Module ' + module.number + ' verwijderen?' + (consequences.length ? ' ' + consequences.join('; ') + '.' : ''))) return;
      feedBoxes.forEach(function (candidate) { candidate.supply.sourceModuleId = null; });
      state.modules.forEach(function (item) { if (item.protectedByModuleId === module.id) item.protectedByModuleId = null; });
      state.modules = state.modules.filter(function (item) { return item !== module; });
      const box = module.boxId && findBox(module.boxId);
      if (box) box.moduleIds = box.moduleIds.filter(function (id) { return id !== module.id; });
      if (selectedId === module.id) selectedId = null;
      update();
   }

   /* ---------- Supply ---------- */

   function boxesLinkedTo(box) {
      return state.boxes.filter(function (candidate) {
         return candidate.supply && candidate.supply.type === 'linked' && candidate.supply.sourceBoxId === box.id;
      });
   }

   function supplySourceModules(box) {
      return state.boxes.filter(function (candidate) { return candidate !== box; }).flatMap(function (candidate) {
         return boxModules(candidate).filter(function (module) {
            return supplySourceTypes.includes(module.type);
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
      const options = ['1x10A', '1x25A', '1x35A', '1x40A', '3x25A', '3x35A', '3x40A', '3x50A', '3x63A', '3x80A', 'Anders'];
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
      return [
         labelField('Aansluitwaarde', select),
         supply.connectionRating === 'Anders'
            ? supplyTextField(supply, 'customConnectionRating', 'Andere aansluitwaarde', 'Bijv. 3x45A') : null
      ];
   }

   function supplierField(box, supply) {
      const custom = customOperatorBoxes.has(box.id) || (!!supply.supplier && !gridOperators.includes(supply.supplier));
      const select = el('select', { 'aria-label': 'Netbeheerder' }, [
         el('option', { value: '', text: '-- selecteer --' }),
         ...gridOperators.map(function (name) { return el('option', { value: name, text: name }); }),
         el('option', { value: otherOperator, text: 'Anders' })
      ]);
      select.value = custom ? otherOperator : supply.supplier || '';
      select.addEventListener('change', function () {
         if (select.value === otherOperator) {
            customOperatorBoxes.add(box.id);
            delete supply.supplier;
         } else {
            customOperatorBoxes.delete(box.id);
            if (select.value) supply.supplier = select.value;
            else delete supply.supplier;
         }
         update();
         if (select.value === otherOperator) focusIn(boxesEl, '[data-other-operator="' + box.id + '"]');
      });
      const fields = [labelField('Netbeheerder', select)];
      if (custom) {
         const name = input(supply.supplier || '', 'Naam netbeheerder', 'Andere netbeheerder', function (value) {
            if (value) supply.supplier = value;
            else delete supply.supplier;
         });
         name.setAttribute('data-other-operator', box.id);
         fields.push(labelField('Andere netbeheerder', name));
      }
      return fields;
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
         el('option', { value: '', text: '-- selecteer --' }),
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
         el('option', { value: 'subdistribution', text: 'Onderverdeler' }),
         el('option', { value: 'linked', text: 'Gekoppeld aan hoofdaansluiting' })
      ]);
      type.value = supply ? supply.type : '';
      type.addEventListener('change', function () {
         const dependents = type.value === 'mains' ? [] : boxesLinkedTo(box);
         if (dependents.length && !confirm('Kast ' + box.number + ' is niet langer een hoofdaansluiting. ' + dependents.length +
            (dependents.length === 1 ? ' gekoppelde kast verliest' : ' gekoppelde kasten verliezen') + ' de hoofdaansluiting. Doorgaan?')) {
            type.value = supply.type;
            return;
         }
         dependents.forEach(function (candidate) { delete candidate.supply.sourceBoxId; });
         box.supply = type.value ? { type: type.value } : null;
         update();
      });
      const fields = [];
      if (supply && supply.type === 'linked') {
         const source = el('select', { 'aria-label': 'Gekoppeld aan kast ' + box.number }, [
            el('option', { value: '', text: 'Kies kast met hoofdaansluiting' })
         ].concat(state.boxes.filter(function (candidate) {
            return candidate !== box && candidate.supply && candidate.supply.type === 'mains';
         }).map(function (candidate) {
            return el('option', { value: candidate.id, text: boxTitle(candidate) });
         })));
         source.value = supply.sourceBoxId || '';
         source.addEventListener('change', function () {
            if (source.value) supply.sourceBoxId = source.value;
            else delete supply.sourceBoxId;
            save();
            renderPrint();
         });
         fields.push(el('label', { className: 'field' }, [el('span', { text: 'Gekoppeld aan' }), source]));
      } else if (supply && supply.type === 'mains') {
         fields.push(...supplyRatingField(supply));
         fields.push(...supplierField(box, supply));
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
         el('label', { className: 'field' }, [el('span', { text: 'Voeding' }), type])
      ].concat(fields));
   }

   /* ---------- Print output ---------- */

   function boxTitle(box) {
      return ['Kast', box.number, box.name ? '- ' + box.name : ''].filter(Boolean).join(' ');
   }

   function moduleMeta(module) {
      const type = moduleTypes.get(module.type);
      return [module.type, type ? widthText(moduleWidth(module)) : '',
      module.characteristic, module.rcdType ? 'type ' + module.rcdType : '', module.ratedCurrent ? module.ratedCurrent + ' A' : '',
      module.connectedTo ? rcdHelpers.connectionText(module) : '']
         .filter(Boolean).join(' · ');
   }

   function supplySummary(box) {
      const supply = box.supply;
      if (!supply) return null;
      const details = [];
      if (supply.type === 'linked') {
         const source = supply.sourceBoxId && findBox(supply.sourceBoxId);
         details.push(source ? 'gekoppeld aan de hoofdaansluiting van kast ' + source.number : 'gekoppeld aan een hoofdaansluiting');
      } else if (supply.type === 'mains') {
         details.push('hoofdaansluiting');
         if (supply.connectionRating === 'Anders') details.push(supply.customConnectionRating || 'Anders');
         else if (supply.connectionRating) details.push(supply.connectionRating);
         if (supply.mainSwitchPoles || supply.mainSwitchCurrent) {
            details.push('hoofdschakelaar ' + (supply.mainSwitchPoles ? supply.mainSwitchPoles + 'P' : '') +
               (supply.mainSwitchCurrent ? ' ' + supply.mainSwitchCurrent + ' A' : ''));
         }
         if (supply.supplier) details.push(supply.supplier);
      } else {
         const source = supply.sourceModuleId && findModule(supply.sourceModuleId);
         const sourceBox = source && findBox(source.boxId);
         if (sourceBox) details.push('vanuit kast ' + sourceBox.number + ', module ' + source.number);
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
      const rcds = rcdViews();
      const lookup = rcdHelpers.index(rcds);
      const boxes = printBoxes();
      const allWarnings = activeWarnings();
      printEl.replaceChildren.apply(printEl, boxes.map(function (box, index) {
         const rows = box.rows.map(function (g) {
            if (!g) return el('tr', null, [el('td'), el('td'), state.phaseEnabled ? el('td') : null]);
            const entry = lookup[g.rcdId];
            const protection = entry || (protectiveTypes.includes(g.type) ? lookup[g.id] : null);
            const phases = rcdHelpers.groupPhases(g, moduleTypes.allPhases(g.type) ? null : protection && protection.rcd);
            return el('tr', null, [
               el('td', protection ? {
                  className: 'rcd-cell',
                  style: 'background-color: ' + protection.rcd.color + '; color: ' + rcdHelpers.textColor(protection.rcd.color),
                  text: rcdHelpers.cellText(g.number, protection, rcdFirst)
               } : { text: g.number }),
               el('td', null, [
                  g.description ? el('div', { text: g.description }) : null,
                  g.warnings && g.warnings.length ? el('div', { className: 'print-badges' },
                     warnings.selected(g.warnings).map(function (warning) {
                        return el('span', { className: 'print-badge', text: warning.badge });
                     })) : null,
                  g.specialInstallations && g.specialInstallations.length ? el('div', { className: 'print-badges' },
                     warnings.selectedSpecialInstallations(g.specialInstallations).map(function (installation) {
                        return el('span', { className: 'print-badge special-installation-badge', text: installation.badge });
                     })) : null,
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
         return el('article', { className: 'print-page' }, [
            el('h1', { text: 'Groepenkaart' }),
            el('p', { className: 'print-date', text: date }),
            index === 0 && state.generalInfo
               ? el('section', { className: 'print-general-info' }, [
                  el('h2', { text: 'Algemene informatie' }),
                  el('p', { text: state.generalInfo })
               ]) : null,
            renderWarnings(warnings.forPage(box, index, allWarnings, boxes)),
            index === 0 ? renderUnusedRcds(rcds, boxes) : null,
            el('h2', { text: boxTitle(box) }),
            supplySummary(box),
            renderRcdKey(rcds, box),
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

   function renderRcdKey(rcds, box) {
      const used = rcdHelpers.used(rcds, box.groups);
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

   function renderWarnings(ids) {
      const selected = warnings.selected(ids);
      if (!selected.length) return null;
      return el('div', { className: 'print-warnings' }, selected.map(function (warning) {
         return el('div', { className: 'print-warning' }, [
            el('img', { src: warning.image, alt: warning.label, 'data-warning': warning.id })
         ]);
      }));
   }

   function renderUnusedRcds(rcds, boxes) {
      const groups = boxes.flatMap(function (box) { return box.groups; });
      const unused = rcdHelpers.unused(rcds, groups);
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
      if (selectedId && !findModule(selectedId)) selectedId = null;
      phaseEnabledEl.checked = state.phaseEnabled;
      rcdEnabledEl.checked = state.rcdEnabled;
      qrEnabledEl.checked = state.qrEnabled;
      expertModeEl.checked = expertMode;
      if (generalInfoEl.value !== state.generalInfo) generalInfoEl.value = state.generalInfo;
      renderQrStatus();
      renderUnplaced();
      renderBoxes();
      emptyEl.hidden = state.boxes.length > 0;
      renderPrint();
   }

   function hasData() {
      return !storageWritable || state.generalInfo || state.boxes.length || state.modules.length || state.qrEnabled || state.rcdEnabled || state.phaseEnabled;
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

   function replaceState(data) {
      state = data;
      selectedId = null;
      storageWritable = true;
   }

   // Replaces the data with the card in the page address (the link in a QR code). Returns whether it did.
   function importFromLink() {
      const hash = window.location.hash;
      if (!share.isLink(hash)) return false;
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      try {
         const data = normalize(share.decode(hash));
         if (hasData() && !confirm('Huidige gegevens vervangen door de groepenkaart uit de link?')) return false;
         replaceState(data);
         return true;
      } catch (e) {
         alert('Openen van de link mislukt: ' + e.message);
         return false;
      }
   }

   function saveBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: filename });
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
   }

   function exportJson() {
      const data = { $schema: schema.schemaUrl, ...serializeState(state) };
      saveBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), 'groepenkaart.json');
   }

   function importJson(file) {
      const reader = new FileReader();
      reader.onload = function () {
         try {
            const data = normalize(JSON.parse(reader.result));
            if (hasData() && !confirm('Huidige gegevens vervangen door het geïmporteerde bestand?')) return;
            replaceState(data);
            update();
         } catch (e) {
            alert('Importeren mislukt: ' + (e instanceof SyntaxError ? 'geen geldig JSON-bestand.' : e.message));
         }
      };
      reader.readAsText(file);
   }

   document.getElementById('add-box').addEventListener('click', openBoxDialog);

   moduleDialogEl.addEventListener('close', function () { dialogState = null; });

   // Returns null without boxes; args is null when a warning image is not loaded, so only printing is possible.
   function preparePdf() {
      if (!state.boxes.length) {
         alert('Voeg eerst een kast toe.');
         return null;
      }
      const qr = state.qrEnabled ? share.qr(shareUrl()) : null;
      const active = activeWarnings();
      let missingImage = false;
      // One canvas per warning definition, so every page can draw the cards it needs.
      const warningImages = typeof document.querySelectorAll !== 'function' ? [] : warnings.definitions.map(function (definition) {
         if (!active.includes(definition.id)) return null;
         const image = document.querySelector('.print-warning img[data-warning="' + definition.id + '"]');
         if (!image || !image.complete || !image.naturalWidth) {
            missingImage = true;
            return null;
         }
         const canvas = document.createElement('canvas');
         // The SVGs are small; rasterize at about 800px so they stay sharp at 34 mm.
         const scale = Math.max(1, Math.round(800 / Math.max(image.naturalWidth, image.naturalHeight)));
         canvas.width = image.naturalWidth * scale;
         canvas.height = image.naturalHeight * scale;
         canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
         return canvas;
      });
      if (missingImage) return { args: null };
      return { args: [printBoxes(), active, rcdViews(), state.phaseEnabled, qr, rcdFirst, warningImages, state.generalInfo] };
   }

   document.getElementById('download-pdf').addEventListener('click', function () {
      const prepared = preparePdf();
      if (!prepared) return;
      if (!prepared.args || !window.GroepenkaartPdf || !window.GroepenkaartPdf.download.apply(null, prepared.args)) {
         window.print();
      }
   });

   /* ---------- PDF preview ---------- */

   const previewButtonEl = document.getElementById('preview-pdf');
   const previewDialogEl = document.getElementById('preview-dialog');
   const previewPagesEl = document.getElementById('preview-pages');
   const previewStatusEl = document.getElementById('preview-status');
   const previewZoomResetEl = document.getElementById('preview-zoom-reset');
   const previewZoomSteps = [0.5, 0.75, 1, 1.5, 2];
   // Safari refuses canvases above roughly 16.7 million pixels.
   const MAX_CANVAS_PIXELS = 16000000;
   let pdfjsPromise = null;
   let previewResizeTimer;
   // { blob, doc, zoom, renderId } while the preview is open.
   let previewState = null;

   // pdf.js is an ES module that is only fetched when the first preview opens.
   function loadPdfjs() {
      if (!pdfjsPromise) {
         const url = function (attribute) { return new URL(previewDialogEl.getAttribute(attribute), document.baseURI).href; };
         pdfjsPromise = import(url('data-pdfjs')).then(function (lib) {
            lib.GlobalWorkerOptions.workerSrc = url('data-pdfjs-worker');
            return lib;
         }).catch(function (error) {
            pdfjsPromise = null;
            throw error;
         });
      }
      return pdfjsPromise;
   }

   function setPreviewStatus(text) {
      previewStatusEl.hidden = !text;
      previewStatusEl.textContent = text;
   }

   async function renderPreview() {
      const current = previewState;
      if (!current || !current.doc) return;
      const id = ++current.renderId;
      const stale = function () { return previewState !== current || current.renderId !== id; };
      const fitWidth = Math.max(previewPagesEl.clientWidth - 24, 200);
      const canvases = [];
      try {
         for (let number = 1; number <= current.doc.numPages; number++) {
            const page = await current.doc.getPage(number);
            if (stale()) return;
            const scale = fitWidth / page.getViewport({ scale: 1 }).width * current.zoom;
            const viewport = page.getViewport({ scale: scale });
            const ratio = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width * ratio);
            canvas.height = Math.floor(viewport.height * ratio);
            canvas.style.width = Math.floor(viewport.width) + 'px';
            canvas.style.height = Math.floor(viewport.height) + 'px';
            canvas.setAttribute('role', 'img');
            canvas.setAttribute('aria-label', 'Pagina ' + number + ' van ' + current.doc.numPages);
            await page.render({
               canvasContext: canvas.getContext('2d'), viewport: viewport, transform: [ratio, 0, 0, ratio, 0, 0]
            }).promise;
            if (stale()) return;
            canvases.push(canvas);
         }
         previewPagesEl.replaceChildren.apply(previewPagesEl, canvases);
         setPreviewStatus('');
      } catch (error) {
         if (stale()) return;
         console.warn('Voorbeeld weergeven mislukt', error);
         setPreviewStatus('Het voorbeeld kon niet worden weergegeven. Gebruik PDF downloaden.');
      }
   }

   function closePreview() {
      const current = previewState;
      previewState = null;
      if (current && current.doc) current.doc.destroy();
      previewPagesEl.replaceChildren();
      setPreviewStatus('');
   }

   async function openPreview(blob) {
      closePreview();
      const current = previewState = { blob: blob, doc: null, zoom: 1, renderId: 0 };
      previewZoomResetEl.textContent = '100%';
      setPreviewStatus('Voorbeeld laden…');
      showDialog(previewDialogEl);
      try {
         const lib = await loadPdfjs();
         const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
         if (previewState !== current) {
            doc.destroy();
            return;
         }
         current.doc = doc;
         await renderPreview();
      } catch (error) {
         if (previewState !== current) return;
         console.warn('Voorbeeld laden mislukt', error);
         setPreviewStatus('Het voorbeeld kon niet worden geladen. Gebruik PDF downloaden.');
      }
   }

   function zoomPreview(step) {
      if (!previewState) return;
      const index = previewZoomSteps.indexOf(previewState.zoom) + step;
      if (index < 0 || index >= previewZoomSteps.length) return;
      previewState.zoom = previewZoomSteps[index];
      previewZoomResetEl.textContent = Math.round(previewState.zoom * 100) + '%';
      renderPreview();
   }

   previewButtonEl.addEventListener('click', function () {
      const prepared = preparePdf();
      if (!prepared) return;
      const blob = prepared.args && window.GroepenkaartPdf && window.GroepenkaartPdf.preview.apply(null, prepared.args);
      if (!blob) {
         alert('Het voorbeeld kon niet worden gemaakt. Gebruik PDF downloaden.');
         return;
      }
      openPreview(blob);
   });

   document.getElementById('preview-zoom-in').addEventListener('click', function () { zoomPreview(1); });
   document.getElementById('preview-zoom-out').addEventListener('click', function () { zoomPreview(-1); });
   previewZoomResetEl.addEventListener('click', function () {
      if (previewState && previewState.zoom !== 1) zoomPreview(previewZoomSteps.indexOf(1) - previewZoomSteps.indexOf(previewState.zoom));
   });
   document.getElementById('preview-download').addEventListener('click', function () {
      if (previewState) saveBlob(previewState.blob, 'groepenkaart.pdf');
   });
   document.getElementById('preview-close').addEventListener('click', function () { hideDialog(previewDialogEl); });
   previewDialogEl.addEventListener('close', closePreview);

   // The pages are drawn to fit the dialog width, so a rotated phone needs a redraw.
   window.addEventListener('resize', function () {
      window.clearTimeout(previewResizeTimer);
      previewResizeTimer = window.setTimeout(renderPreview, 200);
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

   generalInfoEl.addEventListener('input', function () {
      state.generalInfo = generalInfoEl.value;
      save();
      renderPrint();
   });

   rcdFirstEl.addEventListener('change', function () {
      rcdFirst = rcdFirstEl.checked;
      saveRcdFirst();
      renderPrint();
   });

   expertModeEl.addEventListener('change', function () {
      expertMode = expertModeEl.checked;
      saveExpertMode();
   });

   phaseEnabledEl.addEventListener('change', function () {
      state.phaseEnabled = phaseEnabledEl.checked;
      update();
   });

   // Switching off removes RCDs without a place; placed RCDs and RCBOs become circuit breakers so their spot is kept.
   rcdEnabledEl.addEventListener('change', function () {
      if (rcdEnabledEl.checked) {
         state.rcdEnabled = true;
         update();
         return;
      }
      const protective = state.modules.filter(isProtective);
      if (protective.length &&
         !confirm('Alle aardlekschakelaars en de koppelingen van modules worden gewist. Geplaatste aardlekschakelaars en aardlekautomaten worden installatieautomaten. Doorgaan?')) {
         rcdEnabledEl.checked = true;
         return;
      }
      state.rcdEnabled = false;
      state.modules = state.modules.filter(function (module) { return !(isProtective(module) && module.boxId === null); });
      state.modules.forEach(function (module) {
         if (isProtective(module)) {
            module.type = 'MCB';
            module.phases = [];
            protectiveKeys.forEach(function (key) { delete module[key]; });
         }
      });
      // Links that no longer fit survive only for types that connect to a circuit breaker.
      state.modules.forEach(function (module) {
         const target = module.protectedByModuleId && findModule(module.protectedByModuleId);
         if (!target || !canLink(module.type, target)) module.protectedByModuleId = null;
      });
      update();
   });

   document.getElementById('clear-all').addEventListener('click', function () {
      if (hasData() && confirm('Weet je zeker dat je alle kasten, modules, algemene informatie en instellingen wilt wissen?')) {
         replaceState(normalize(schema.empty()));
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
