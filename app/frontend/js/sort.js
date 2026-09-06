/* Shared sort helpers — used by the table widget in the browser and by
 * unit tests in Node. Pure functions, no DOM.
 * Sorting contract:
 *   - numeric columns compare numerically (never as strings);
 *   - missing values (null / undefined / "" / NaN) always go last;
 *   - string columns compare case-insensitively;
 *   - sort cycle: first click ASC, second DESC, third resets (original order).
 */
(function (global) {
  "use strict";

  const NUMERIC_FORMATS = ["money", "currency", "percent2", "int"];

  function isMissing(v) {
    if (v === null || v === undefined || v === "") return true;
    if (typeof v === "number") return !Number.isFinite(v);
    return false;
  }

  function isNumericCol(col) {
    return Boolean(col && col.format && NUMERIC_FORMATS.includes(col.format));
  }

  // Compare two raw values for one column. Returns <0, 0 or >0 for the
  // ASC direction; caller applies direction.
  function compareValues(a, b, col) {
    const ma = isMissing(a);
    const mb = isMissing(b);
    if (ma && mb) return 0;
    if (ma) return 1; // missing always last
    if (mb) return -1;
    if (isNumericCol(col)) {
      const na = Number(a);
      const nb = Number(b);
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    }
    return String(a).localeCompare(String(b), "ru", { numeric: true, sensitivity: "base" });
  }

  // Sort a row array by (key, dir) using column metadata.
  // dir: "asc" | "desc" | null (null returns a stable copy unchanged).
  function sortRows(rows, sortKey, sortDir, columns) {
    const out = rows.slice();
    if (!sortKey || !sortDir) return out;
    const col = (columns || []).find((c) => c.key === sortKey);
    const dir = sortDir === "asc" ? 1 : -1;
    out.sort((p, q) => {
      const vp = p ? p[sortKey] : undefined;
      const vq = q ? q[sortKey] : undefined;
      const mp = isMissing(vp);
      const mq = isMissing(vq);
      // Missing values always go last, in either direction.
      if (mp && mq) return 0;
      if (mp) return 1;
      if (mq) return -1;
      const r = compareValues(vp, vq, col);
      if (r === 0) return 0;
      return r * dir;
    });
    return out;
  }

  // Next sort state given the previously active key/direction.
  // Different key always starts ASC. Same key cycles ASC -> DESC -> null.
  function cycleSort(activeKey, activeDir, newKey) {
    if (newKey !== activeKey) return { key: newKey, dir: "asc" };
    if (activeDir === "asc") return { key: newKey, dir: "desc" };
    if (activeDir === "desc") return { key: null, dir: null };
    return { key: newKey, dir: "asc" };
  }

  const Sort = { compareValues, sortRows, cycleSort, isMissing, isNumericCol, NUMERIC_FORMATS };

  global.MIPSort = Sort;
  if (typeof module !== "undefined" && module.exports) module.exports = Sort;
})(typeof window !== "undefined" ? window : globalThis);