(function () {
   'use strict';

   const STORAGE_KEY = 'groepenkaart:v1';
   const MIN_ROWS = 15;

   let state = load();

   const boxesEl = document.getElementById('boxes');
   const emptyEl = document.getElementById('empty-state');
   const printEl = document.getElementById('print-area');

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
            return normalize(JSON.parse(raw));
         }
      } catch (e) {
         console.warn('Opgeslagen gegevens konden niet worden geladen', e);
      }
      return { boxes: [] };
   }

   function save() {
      try {
         localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
         console.warn('Opslaan mislukt', e);
      }
   }

   function str(value) {
      if (typeof value === 'string') return value;
      if (typeof value === 'number' && isFinite(value)) return String(value);
      return '';
   }

   // Throws on invalid input so imports can report a clear error.
   function normalize(data) {
      if (!data || typeof data !== 'object' || !Array.isArray(data.boxes)) {
         throw new Error('Ongeldig bestand: "boxes" ontbreekt.');
      }
      return {
         boxes: data.boxes.map(function (box) {
            if (!box || typeof box !== 'object') throw new Error('Ongeldige kast in bestand.');
            const groups = Array.isArray(box.groups) ? box.groups : [];
            return {
               id: uid(),
               number: str(box.number),
               name: str(box.name),
               groups: groups.map(function (g) {
                  if (!g || typeof g !== 'object') throw new Error('Ongeldige groep in bestand.');
                  return {
                     id: uid(),
                     number: str(g.number),
                     name: str(g.name),
                     description: str(g.description)
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

   function renderGroupRow(box, group, index) {
      return el('tr', null, [
         el('td', null, [input(group.number, 'Nr', 'Groepnummer', function (v) { group.number = v; }, 'input-number')]),
         el('td', null, [input(group.name, 'Naam', 'Groepnaam', function (v) { group.name = v; })]),
         el('td', null, [input(group.description, 'Omschrijving', 'Omschrijving', function (v) { group.description = v; })]),
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
         el('table', { className: 'groups-table' }, [
            el('thead', null, [el('tr', null, [
               el('th', { className: 'col-number', text: 'Groep' }),
               el('th', { className: 'col-name', text: 'Naam' }),
               el('th', { text: 'Omschrijving' }),
               el('th', { className: 'col-actions' })
            ])]),
            el('tbody', null, rows)
         ]),
         el('button', {
            type: 'button',
            className: 'btn btn-primary btn-add-group',
            text: '+ Groep toevoegen',
            onclick: function () {
               box.groups.push({ id: uid(), number: nextNumber(box.groups), name: '', description: '' });
               update();
               const inputs = boxesEl.querySelectorAll('[data-id="' + box.id + '"] tbody tr:last-child input');
               if (inputs[1]) inputs[1].focus();
            }
         })
      ]);
   }

   function boxTitle(box) {
      return ['Kast', box.number, box.name ? '- ' + box.name : ''].filter(Boolean).join(' ');
   }

   function renderPrint() {
      const date = 'Afgedrukt op ' + window.GroepenkaartPdf.today();
      printEl.replaceChildren.apply(printEl, state.boxes.map(function (box) {
         const rows = box.groups.map(function (g) {
            return el('tr', null, [
               el('td', { text: g.number }),
               el('td', { text: g.name }),
               el('td', { text: g.description })
            ]);
         });
         for (let i = box.groups.length; i < MIN_ROWS; i++) {
            rows.push(el('tr', null, [el('td'), el('td'), el('td')]));
         }
         return el('article', { className: 'print-page' }, [
            el('h1', { text: 'Groepenindeling' }),
            el('p', { className: 'print-date', text: date }),
            el('h2', { text: boxTitle(box) }),
            el('table', null, [
               el('thead', null, [el('tr', null, [
                  el('th', { className: 'col-number', text: 'Groep' }),
                  el('th', { className: 'col-name', text: 'Naam' }),
                  el('th', { text: 'Omschrijving' })
               ])]),
               el('tbody', null, rows)
            ])
         ]);
      }));
   }

   function render() {
      boxesEl.replaceChildren.apply(boxesEl, state.boxes.map(renderBox));
      emptyEl.hidden = state.boxes.length > 0;
      renderPrint();
   }

   function exportJson() {
      const data = {
         boxes: state.boxes.map(function (b) {
            return {
               number: b.number,
               name: b.name,
               groups: b.groups.map(function (g) {
                  return { number: g.number, name: g.name, description: g.description };
               })
            };
         })
      };
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
            if (state.boxes.length && !confirm('Huidige gegevens vervangen door het geïmporteerde bestand?')) return;
            state = data;
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
         groups: [{ id: uid(), number: '1', name: '', description: '' }]
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
      if (!window.GroepenkaartPdf || !window.GroepenkaartPdf.download(state.boxes, MIN_ROWS)) {
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

   document.getElementById('clear-all').addEventListener('click', function () {
      if (state.boxes.length && confirm('Weet je zeker dat je alle kasten en groepen wilt wissen?')) {
         state = { boxes: [] };
         update();
      }
   });

   render();
})();
