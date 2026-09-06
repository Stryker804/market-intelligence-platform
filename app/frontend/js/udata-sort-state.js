/* Multi-key sort state for the Universal Data widget — used by udata.js in
 * the browser and by unit tests in Node. Pure functions, no DOM.
 *
 * State model: an ordered array of { column, direction }, where position
 * encodes priority (index 0 = primary key, later indexes = tie-breakers).
 *
 * Contract:
 *   - sorting an already-active column replaces that key's direction
 *     (never duplicates the column);
 *   - sorting a new column appends it to the end;
 *   - removed/renamed columns are dropped/updated so sort keys always
 *     reference columns that actually exist.
 */
(function (global) {
  "use strict";

  // Returns a new sortKeys array after the user sorts `column` with the
  // newly chosen `direction`. Preserves order of all other keys.
  function toggleSort(sortKeys, column, direction) {
    const next = [];
    let found = false;
    for (const k of sortKeys || []) {
      if (k.column === column) {
        next.push({ column: k.column, direction });
        found = true;
      } else {
        next.push({ column: k.column, direction: k.direction });
      }
    }
    if (!found) next.push({ column, direction });
    return next;
  }

  // Drop any sort key whose column is being removed. `removed` is a list of
  // column names (or a single name).
  function dropColumns(sortKeys, removed) {
    const drop = Array.isArray(removed) ? new Set(removed) : new Set([removed]);
    return (sortKeys || []).filter((k) => !drop.has(k.column));
  }

  // Update sort keys after a rename. `mapping` is { oldName: newName }.
  function renameColumns(sortKeys, mapping) {
    return (sortKeys || []).map((k) =>
      mapping && mapping[k.column] != null
        ? { column: mapping[k.column], direction: k.direction }
        : { column: k.column, direction: k.direction },
    );
  }

  // Keep only keys whose column currently exists in `availableColumns`.
  function prune(sortKeys, availableColumns) {
    const avail = Array.isArray(availableColumns) ? new Set(availableColumns) : new Set();
    return (sortKeys || []).filter((k) => avail.has(k.column));
  }

  // Compact clone-safe representation for display (column + direction).
  function label(sortKeys) {
    return (sortKeys || []).map((k) => ({ column: k.column, direction: k.direction }));
  }

  const UdataSortState = { toggleSort, dropColumns, renameColumns, prune, label };

  global.MIPUdataSortState = UdataSortState;
  if (typeof module !== "undefined" && module.exports) module.exports = UdataSortState;
})(typeof window !== "undefined" ? window : globalThis);
