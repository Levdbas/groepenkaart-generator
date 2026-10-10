(function () {
   'use strict';

   const STORAGE_KEY = 'groepenkaart:v1';
   const MIN_ROWS = 15;
   const warnings = window.GroepenkaartWarnings;
   const schema = window.GroepenkaartSchema;
   const rcboHelpers = window.GroepenkaartRcbo;

   let storageWritable = true;
   let loadedFromStorage = false;
   let state = load();

   const boxesEl = document.getElementById('boxes');
   const emptyEl = document.getElementById('empty-state');
   const printEl = document.getElementById('print-area');
   const rcboEnabledEl = document.getElementById('rcbo-enabled');
   const phaseEnabledEl = document.getElementById('phase-enabled');
   const rcboPanelEl = document.getElementById('rcbo-panel');
   const rcboListEl = document.getElementById('rcbo-list');
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
      return schema.empty();
   }

   function save() {
      if (!storageWritable) return;
      try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(schema.normalize(state)));
      } catch (e) {
         console.warn('Opslaan mislukt', e);
      }
   }

   function normalize(data) {
      const normalized = schema.normalize(data);
      return {
         schemaVersion: normalized.schemaVersion,
         warnings: normalized.warnings,
         rcboEnabled: normalized.rcboEnabled,
         phaseEnabled: normalized.phaseEnabled,
         rcbos: normalized.rcbos.map(function (rcbo) {
            return { ...rcbo, phases: rcbo.phases.slice() };
         }),
         boxes: normalized.boxes.map(function (box) {
            return {
               id: uid(),
               number: box.number,
               name: box.name,
               groups: box.groups.map(function (g) {
                  return {
                     id: uid(),
                     number: g.number,
                     description: g.description,
                     rcboId: g.rcboId,
                     phases: g.phases.slice(),
                     ...(g.items ? { items: g.items.slice() } : {})
                  };
               })
            };
         })
      };
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
         'aria-label': 'Aansluitingen voor groep ' + group.number
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

   function rcboOptionText(rcbo, index) {
      return rcbo.name.trim() ? rcboHelpers.label(rcbo, index) + ' – ' + rcbo.name.trim() : rcboHelpers.label(rcbo, index);
   }

   function swatchStyle(color) {
      return color ? 'background-color: ' + color : '';
   }

   function rcboSelect(group, onChange) {
      const linked = state.rcbos.find(function (r) { return r.id === group.rcboId; });
      const swatch = el('span', { className: 'rcbo-swatch' + (linked ? '' : ' is-empty'), style: swatchStyle(linked && linked.color), 'aria-hidden': 'true' });
      const select = el('select', { 'aria-label': 'Aardlekschakelaar voor groep ' + group.number }, [
         el('option', { value: '', text: 'Geen koppeling' })
      ].concat(state.rcbos.map(function (rcbo, i) {
         return el('option', { value: rcbo.id, text: rcboOptionText(rcbo, i) });
      })));
      select.value = group.rcboId || '';
      // Updates in place instead of re-rendering, so keyboard focus stays on the select.
      select.addEventListener('change', function () {
         group.rcboId = select.value || null;
         const rcbo = state.rcbos.find(function (r) { return r.id === group.rcboId; });
         swatch.className = 'rcbo-swatch' + (rcbo ? '' : ' is-empty');
         swatch.setAttribute('style', swatchStyle(rcbo && rcbo.color));
         onChange();
         save();
         renderPrint();
      });
      return el('div', { className: 'rcbo-select' }, [swatch, select]);
   }

   function groupPhaseInput(group) {
      const rcbo = state.rcbos.find(function (r) { return r.id === group.rcboId; });
      if (rcbo && rcbo.amountOfPoles === 2) {
         return el('div', { className: 'phase-inherited', text: rcboHelpers.phaseText(rcboHelpers.groupPhases(group, rcbo)) + ' (via aardlekschakelaar)' });
      }
      const status = el('span', { className: 'phase-status', text: rcboHelpers.phaseText(group.phases) });
      return el('fieldset', { className: 'phase-choices' }, [
         el('legend', { text: 'Fasen voor groep ' + group.number }),
         ...rcboHelpers.phaseCodes.map(function (phase) {
            const checkbox = el('input', { type: 'checkbox', value: phase });
            checkbox.checked = group.phases.includes(phase);
            checkbox.addEventListener('change', function () {
               group.phases = rcboHelpers.phaseCodes.filter(function (code) {
                  return code === phase ? checkbox.checked : group.phases.includes(code);
               });
               status.textContent = rcboHelpers.phaseText(group.phases);
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
      const description = input(group.description, 'Omschrijving', 'Omschrijving', function (v) { group.description = v; });
      const items = groupItemsInput(group);
      // With phases the connections get their own row; otherwise they stay stacked under the description.
      const descriptionCells = state.phaseEnabled ? [
         el('td', { className: 'group-description', 'data-label': 'Omschrijving' }, [description]),
         el('td', { className: 'group-items' }, [items])
      ] : [el('td', { className: 'group-description', 'data-label': 'Omschrijving' }, [description, items])];
      return el('tr', null, [
         el('td', { className: 'group-number', 'data-label': 'Groep' }, [input(group.number, 'Nr', 'Groepnummer', function (v) { group.number = v; }, 'input-number')]),
         ...descriptionCells,
         state.rcboEnabled ? el('td', { className: 'group-rcbo', 'data-label': 'Aardlekschakelaar' }, [rcboSelect(group, refreshPhase)]) : null,
         phaseCell,
         el('td', { className: 'group-actions' }, [
            el('div', { className: 'row-actions' }, [
               iconButton('↑', 'Groep omhoog', function () { move(box.groups, index, -1); update(); }),
               iconButton('↓', 'Groep omlaag', function () { move(box.groups, index, 1); update(); }),
               iconButton('✕', 'Groep verwijderen', function () { box.groups.splice(index, 1); update(); }, 'btn-danger')
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
                  if (confirm('Kast "' + (box.name || box.number) + '" verwijderen?')) {
                     state.boxes.splice(index, 1);
                     update();
                  }
               }, 'btn-danger')
            ])
         ]),
         el('table', { className: 'groups-table' + (state.phaseEnabled ? ' has-phases' : '') + (state.rcboEnabled ? ' has-rcbos' : '') }, [
            el('thead', null, [el('tr', null, [
               el('th', { className: 'col-number', text: 'Groep' }),
               el('th', { text: 'Omschrijving' }),
               state.rcboEnabled ? el('th', { className: 'col-rcbo', text: 'Aardlekschakelaar' }) : null,
               state.phaseEnabled ? el('th', { className: 'col-phases', text: 'Fasen' }) : null,
               el('th', { className: 'col-actions' })
            ])]),
            el('tbody', null, rows)
         ]),
         el('button', {
            type: 'button',
            className: 'btn btn-primary btn-add-group',
            text: '+ Groep toevoegen',
            onclick: function () {
               box.groups.push({ id: uid(), number: nextNumber(box.groups), description: '', rcboId: null, phases: [] });
               update();
               const inputs = boxesEl.querySelectorAll('[data-id="' + box.id + '"] tbody tr:last-child input');
               if (inputs[1]) inputs[1].focus();
            }
         })
      ]);
   }

   function linkedGroupCount(rcbo) {
      return state.boxes.reduce(function (total, box) {
         return total + box.groups.filter(function (g) { return g.rcboId === rcbo.id; }).length;
      }, 0);
   }

   // RCBO edits re-render the boxes (option labels and swatches) but not the RCBO list, so focus is kept.
   function rcboChanged() {
      save();
      renderBoxes();
      renderPrint();
   }

   function rcboPhaseInput(rcbo) {
      if (rcbo.amountOfPoles === 4) {
         return el('div', { className: 'field' }, [
            el('span', { text: 'Fasen' }),
            el('span', { className: 'phase-inherited', text: 'L1, L2, L3 (4-polig)' })
         ]);
      }
      const select = el('select', { 'aria-label': 'Fase aardlekschakelaar ' + rcbo.number }, [
         el('option', { value: '', text: 'Kies een fase' }),
         ...rcboHelpers.phaseCodes.map(function (phase) { return el('option', { value: phase, text: phase }); })
      ]);
      select.value = rcbo.phases[0] || '';
      select.addEventListener('change', function () {
         rcbo.phases = select.value ? [select.value] : [];
         rcboChanged();
      });
      return el('label', { className: 'field' }, [el('span', { text: 'Fase' }), select]);
   }

   function rcboPhaseControls(rcbo) {
      const phases = el('div', { className: 'rcbo-phase-selection' }, [rcboPhaseInput(rcbo)]);
      const poles = el('select', { 'aria-label': 'Aantal polen aardlekschakelaar ' + rcbo.number }, [
         el('option', { value: '2', text: '2-polig' }),
         el('option', { value: '4', text: '4-polig' })
      ]);
      poles.value = String(rcbo.amountOfPoles);
      poles.addEventListener('change', function () {
         rcbo.amountOfPoles = Number(poles.value);
         rcbo.phases = rcbo.amountOfPoles === 4 ? rcboHelpers.phaseCodes.slice() : [];
         phases.replaceChildren(rcboPhaseInput(rcbo));
         rcboChanged();
      });
      return el('div', { className: 'rcbo-phase-controls' }, [
         el('label', { className: 'field' }, [el('span', { text: 'Aantal polen' }), poles]), phases
      ]);
   }

   function renderRcbo(rcbo, index) {
      const color = el('input', { type: 'color', className: 'rcbo-color', 'aria-label': 'Kleur aardlekschakelaar ' + rcboHelpers.label(rcbo, index), title: 'Kleur kiezen' });
      color.value = rcbo.color;
      color.addEventListener('input', function () {
         if (!rcboHelpers.isColor(color.value)) return;
         rcbo.color = color.value.toLowerCase();
         rcboChanged();
      });
      return el('li', { className: 'rcbo-item', 'data-id': rcbo.id }, [
         color,
         rcboInput(rcbo.number, 'Bijv. A1', 'Code aardlekschakelaar', function (v) { rcbo.number = v; }, 'input-number'),
         rcboInput(rcbo.name, 'Omschrijving, bijv. Keuken en badkamer', 'Naam aardlekschakelaar', function (v) { rcbo.name = v; }),
         el('div', { className: 'row-actions' }, [
            iconButton('↑', 'Aardlekschakelaar omhoog', function () { move(state.rcbos, index, -1); update(); }),
            iconButton('↓', 'Aardlekschakelaar omlaag', function () { move(state.rcbos, index, 1); update(); }),
            iconButton('✕', 'Aardlekschakelaar verwijderen', function () {
               const linked = linkedGroupCount(rcbo);
               const message = 'Aardlekschakelaar "' + rcboOptionText(rcbo, index) + '" verwijderen?' +
                  (linked ? ' ' + linked + (linked === 1 ? ' gekoppelde groep wordt' : ' gekoppelde groepen worden') + ' ontkoppeld.' : '');
               if (!confirm(message)) return;
               state.boxes.forEach(function (box) {
                  box.groups.forEach(function (g) { if (g.rcboId === rcbo.id) g.rcboId = null; });
               });
               state.rcbos.splice(index, 1);
               update();
            }, 'btn-danger')
         ]),
         state.phaseEnabled ? rcboPhaseControls(rcbo) : null
      ]);
   }

   function rcboInput(value, placeholder, label, onInput, className) {
      const node = el('input', { type: 'text', placeholder: placeholder, 'aria-label': label, className: className || '' });
      node.value = value;
      node.addEventListener('input', function () {
         onInput(node.value);
         rcboChanged();
      });
      return node;
   }

   function renderRcbos() {
      rcboEnabledEl.checked = state.rcboEnabled;
      rcboPanelEl.hidden = !state.rcboEnabled;
      rcboListEl.replaceChildren.apply(rcboListEl, state.rcbos.map(renderRcbo));
   }

   function boxTitle(box) {
      return ['Kast', box.number, box.name ? '- ' + box.name : ''].filter(Boolean).join(' ');
   }

   function renderPrint() {
      const date = 'Afgedrukt op ' + window.GroepenkaartPdf.today();
      printEl.replaceChildren.apply(printEl, state.boxes.map(function (box, index) {
         const lookup = rcboHelpers.index(state.rcbos);
         const rows = box.groups.map(function (g) {
            const entry = lookup[g.rcboId];
            const phases = rcboHelpers.groupPhases(g, entry && entry.rcbo);
            return el('tr', null, [
               el('td', entry ? {
                  className: 'rcbo-cell',
                  style: 'background-color: ' + entry.rcbo.color + '; color: ' + rcboHelpers.textColor(entry.rcbo.color),
                  text: rcboHelpers.cellText(g.number, entry)
               } : { text: g.number }),
               el('td', null, [
                  g.description ? el('div', { text: g.description }) : null,
                  g.items && g.items.length ? el('ul', { className: 'print-group-items' },
                     g.items.map(function (item) { return el('li', { text: item }); })) : null
               ]),
               state.phaseEnabled ? el('td', { className: 'print-phases', text: rcboHelpers.phaseText(phases) }, [
                  phases.length ? el('span', { className: 'print-phase-border', 'aria-hidden': 'true' },
                     phases.map(function (phase) {
                        return el('span', { style: 'background-color: ' + rcboHelpers.phaseColors[phase] });
                     })) : null
               ]) : null
            ]);
         });
         for (let i = box.groups.length; i < MIN_ROWS; i++) {
            rows.push(el('tr', null, [el('td'), el('td'), state.phaseEnabled ? el('td') : null]));
         }
         return el('article', { className: 'print-page' }, [
            el('h1', { text: 'Groepenindeling' }),
            el('p', { className: 'print-date', text: date }),
            index === 0 ? renderWarnings() : null,
            index === 0 ? renderUnusedRcbos() : null,
            el('h2', { text: boxTitle(box) }),
            renderRcboKey(box),
            el('table', null, [
               el('thead', null, [el('tr', null, [
                  el('th', { className: 'col-number', text: 'Groep' }),
                  el('th', { text: 'Omschrijving' }),
                  state.phaseEnabled ? el('th', { className: 'col-phases', text: 'Fasen' }) : null
               ])]),
               el('tbody', null, rows)
            ])
         ]);
      }));
   }

   function renderRcboKey(box) {
      const used = rcboHelpers.used(state.rcbos, box.groups);
      if (!used.length) return null;
      return el('ul', { className: 'print-rcbo-key', 'aria-label': 'Aardlekschakelaars' }, [
         el('li', { className: 'print-rcbo-key-title', text: 'Aardlekschakelaars:' })
      ].concat(used.map(function (entry) {
         return el('li', null, [
            el('span', { className: 'print-rcbo-swatch', style: 'background-color: ' + entry.rcbo.color }),
            el('span', { text: rcboHelpers.keyText(entry, state.phaseEnabled) })
         ]);
      })));
   }

   function renderWarnings() {
      const selected = warnings.selected(state.warnings);
      if (!selected.length) return null;
      return el('div', { className: 'print-warnings' }, selected.map(function (warning) {
         return el('div', { className: 'print-warning' }, [
            el('strong', { text: 'LET OP!' }),
            el('strong', { text: warning.heading[0] }),
            el('strong', { text: warning.heading[1] }),
            el('p', { text: warning.message || warnings.message }),
            warnings.svg(warning.icon)
         ]);
      }));
   }

   function renderUnusedRcbos() {
      const groups = state.boxes.flatMap(function (box) { return box.groups; });
      const unused = rcboHelpers.unused(state.rcbos, groups);
      if (!unused.length) return null;
      return el('section', { className: 'print-unused-rcbos' }, [
         el('h3', { text: 'Aardlekschakelaars niet in gebruik' }),
         el('ul', null, unused.map(function (entry) {
            return el('li', null, [
               el('span', { className: 'print-rcbo-swatch', style: 'background-color: ' + entry.rcbo.color }),
               el('span', { text: rcboHelpers.keyText(entry, state.phaseEnabled) })
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
      renderRcbos();
      renderBoxes();
      emptyEl.hidden = state.boxes.length > 0;
      renderPrint();
   }

   function hasData() {
      return !storageWritable || state.boxes.length || state.warnings.length || state.rcboEnabled || state.phaseEnabled;
   }

   function exportJson() {
      const data = { $schema: schema.schemaUrl, ...schema.normalize(state) };
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
         groups: [{ id: uid(), number: '1', description: '', rcboId: null, phases: [] }]
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
      if (!window.GroepenkaartPdf || !window.GroepenkaartPdf.download(state.boxes, MIN_ROWS, state.warnings, state.rcbos, state.phaseEnabled)) {
         window.print();
      }
   });

   document.getElementById('print').addEventListener('click', function () {
      window.print();
   });

   // Keeps the printed date current if the page stays open across days.
   window.addEventListener('beforeprint', renderPrint);

   document.getElementById('export-json').addEventListener('click', exportJson);

   document.getElementById('import-json').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (file) importJson(file);
      e.target.value = '';
   });

   phaseEnabledEl.addEventListener('change', function () {
      state.phaseEnabled = phaseEnabledEl.checked;
      update();
   });

   rcboEnabledEl.addEventListener('change', function () {
      if (rcboEnabledEl.checked) {
         state.rcboEnabled = true;
         update();
         return;
      }
      if (state.rcbos.length && !confirm('Alle Aardlekschakelaars en de koppelingen van groepen worden gewist. Doorgaan?')) {
         rcboEnabledEl.checked = true;
         return;
      }
      state.rcboEnabled = false;
      state.rcbos = [];
      state.boxes.forEach(function (box) {
         box.groups.forEach(function (g) { g.rcboId = null; });
      });
      update();
   });

   document.getElementById('add-rcbo').addEventListener('click', function () {
      const number = rcboHelpers.nextNumber(state.rcbos);
      const rcbo = { id: uid(), number: number, name: '', color: rcboHelpers.defaultColor(number), amountOfPoles: 2, phases: [] };
      state.rcbos.push(rcbo);
      update();
      const last = rcboListEl.lastElementChild;
      if (last) last.querySelectorAll('input[type="text"]')[1].focus();
   });

   document.getElementById('clear-all').addEventListener('click', function () {
      if (hasData() && confirm('Weet je zeker dat je alle kasten, groepen, Aardlekschakelaars, installatiewaarschuwingen en fase-instellingen wilt wissen?')) {
         state = schema.empty();
         storageWritable = true;
         update();
      }
   });

   render();
   if (loadedFromStorage) save();
})();
