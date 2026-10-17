(function () {
   'use strict';

   // Pure layout helpers for a box of DIN rails. A box is {rails, railWidth}; items are {id, rail, slot, width} with
   // 1-based rail and start slot. Nothing here mutates its input.

   function covers(item, rail, slot) {
      return item.rail === rail && slot >= item.slot && slot < item.slot + item.width;
   }

   function itemAt(items, rail, slot, ignoreId) {
      return items.find(function (item) { return item.id !== ignoreId && covers(item, rail, slot); }) || null;
   }

   /** Whether a module of the given width fits at rail/slot, inside the box and on free slots. */
   function fits(box, items, rail, slot, width, ignoreId) {
      if (rail < 1 || rail > box.rails || slot < 1 || slot + width - 1 > box.railWidth) return false;
      for (let s = slot; s < slot + width; s++) {
         if (itemAt(items, rail, s, ignoreId)) return false;
      }
      return true;
   }

   /** The number of consecutive free slots starting at rail/slot (0 when that slot is taken). */
   function freeRun(box, items, rail, slot, ignoreId) {
      let run = 0;
      while (slot + run <= box.railWidth && !itemAt(items, rail, slot + run, ignoreId)) run++;
      return run;
   }

   function withPositions(items, changes) {
      return items.map(function (item) {
         return changes[item.id] ? Object.assign({}, item, changes[item.id]) : item;
      });
   }

   function valid(box, items) {
      return items.every(function (item) { return fits(box, items, item.rail, item.slot, item.width, item.id); });
   }

   /**
    * Moves an item one step in reading order (direction -1 = left, 1 = right). It steps into a free slot or swaps with
    * the neighbouring item. At the end of a rail it wraps to the start of the next rail (and from the start back to the
    * end of the previous rail). Returns {id: {rail, slot}} for the items that change, or null when it cannot move.
    */
   function move(box, items, id, direction) {
      const item = items.find(function (candidate) { return candidate.id === id; });
      if (!item) return null;
      const changes = {};
      if (direction > 0) {
         const next = item.slot + item.width;
         if (next <= box.railWidth) {
            const neighbour = itemAt(items, item.rail, next, item.id);
            if (!neighbour) changes[item.id] = { rail: item.rail, slot: item.slot + 1 };
            else {
               changes[neighbour.id] = { rail: item.rail, slot: item.slot };
               changes[item.id] = { rail: item.rail, slot: item.slot + neighbour.width };
            }
         } else {
            if (item.rail >= box.rails) return null;
            changes[item.id] = { rail: item.rail + 1, slot: 1 };
            const neighbour = itemAt(items, item.rail + 1, 1, item.id);
            if (neighbour && !fits(box, items, item.rail + 1, 1, item.width, item.id)) {
               changes[neighbour.id] = { rail: item.rail, slot: box.railWidth - neighbour.width + 1 };
            }
         }
      } else {
         const previous = item.slot - 1;
         if (previous >= 1) {
            const neighbour = itemAt(items, item.rail, previous, item.id);
            if (!neighbour) changes[item.id] = { rail: item.rail, slot: item.slot - 1 };
            else {
               changes[item.id] = { rail: item.rail, slot: neighbour.slot };
               changes[neighbour.id] = { rail: item.rail, slot: neighbour.slot + item.width };
            }
         } else {
            if (item.rail <= 1) return null;
            changes[item.id] = { rail: item.rail - 1, slot: box.railWidth - item.width + 1 };
            const neighbour = itemAt(items, item.rail - 1, box.railWidth, item.id);
            if (neighbour && !fits(box, items, item.rail - 1, box.railWidth - item.width + 1, item.width, item.id)) {
               changes[neighbour.id] = { rail: item.rail, slot: 1 };
            }
         }
      }
      return valid(box, withPositions(items, changes)) ? changes : null;
   }

   /** Items that would no longer fit if the box got the given size. */
   function outside(items, rails, railWidth) {
      return items.filter(function (item) { return item.rail > rails || item.slot + item.width - 1 > railWidth; });
   }

   function sortByPosition(items) {
      return items.slice().sort(function (a, b) { return a.rail - b.rail || a.slot - b.slot; });
   }

   /** One entry per module and per free slot in reading order: the item id, or null for a free slot. */
   function rows(box, items) {
      const result = [];
      for (let rail = 1; rail <= box.rails; rail++) {
         let slot = 1;
         while (slot <= box.railWidth) {
            const item = itemAt(items, rail, slot);
            result.push(item ? item.id : null);
            slot = item ? item.slot + item.width : slot + 1;
         }
      }
      return result;
   }

   window.GroepenkaartLayout = {
      itemAt: itemAt, fits: fits, freeRun: freeRun, move: move, outside: outside, sortByPosition: sortByPosition, rows: rows
   };
})();
