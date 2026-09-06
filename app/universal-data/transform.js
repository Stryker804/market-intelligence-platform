"use strict";

/**
 * Dataset transformations for the Universal Data module.
 *
 * All operations are pure: they return a new { columns, rows } and never
 * mutate the input table, so the original dataset can always be restored.
 *
 * Supported (MVP):
 *   removeDuplicates
 *   removeEmptyRows
 *   removeEmptyColumns
 *   selectColumns
 *   removeColumns
 *   renameColumns
 *   sort
 *   filter
 */

const { findDuplicateRows, findEmptyRows } = require("./inspect");
const { rowKey } = require("./inspect");
const { inspectColumns, NUMBER_COLON, DATE_COLON, BOOLEAN_COLON, isEmptyValue } = require("./types");

function ensureColumn(table, col) {
  if (!table.columns.includes(col)) {
    throw new Error(`Unknown column: ${col}`);
  }
}

function removeDuplicates(table) {
  const seen = new Set();
  const rows = [];
  for (const row of table.rows) {
    const key = rowKey(row, table.columns);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  return { columns: table.columns.slice(), rows };
}

function removeEmptyRows(table) {
  const { emptyRows } = findEmptyRows(table);
  if (emptyRows.length === 0) {
    return { columns: table.columns.slice(), rows: table.rows.slice() };
  }
  const skip = new Set(emptyRows);
  const rows = table.rows.filter((r) => !skip.has(r));
  return { columns: table.columns.slice(), rows };
}

function removeEmptyColumns(table) {
  const info = inspectColumns({ columns: table.columns, rows: table.rows });
  const keep = table.columns.filter((c) => {
    const t = info[c].type;
    // A column is "empty" when it has no real (non-empty) values at all.
    return info[c].nonEmpty > 0;
  });
  const rows = table.rows.map((row) => {
    const out = {};
    for (const c of keep) out[c] = row[c];
    return out;
  });
  return { columns: keep, rows };
}

function selectColumns(table, names) {
  const cols = names.map((c) => {
    ensureColumn(table, c);
    return c;
  });
  const rows = table.rows.map((row) => {
    const out = {};
    for (const c of cols) out[c] = row[c];
    return out;
  });
  return { columns: cols, rows };
}

function removeColumns(table, names) {
  const drop = new Set(names);
  const cols = table.columns.filter((c) => !drop.has(c));
  return selectColumns({ columns: table.columns, rows: table.rows }, cols);
}

function renameColumns(table, mapping) {
  const reverse = {};
  for (const key of Object.keys(mapping)) reverse[key] = mapping[key];
  const cols = table.columns.map((c) => (reverse[c] != null ? reverse[c] : c));
  // Ensure uniqueness after rename; append counter when a collision occurs.
  const used = new Map();
  const unique = cols.map((c) => {
    const count = used.get(c) || 0;
    used.set(c, count + 1);
    return count === 0 ? c : `${c}__${count}`;
  });
  const rows = table.rows.map((row) => {
    const out = {};
    for (let i = 0; i < table.columns.length; i += 1) {
      out[unique[i]] = row[table.columns[i]];
    }
    return out;
  });
  return { columns: unique, rows };
}

function coerceSortValue(value, type) {
  if (isEmptyValue(value)) return null;
  if (type === NUMBER_COLON) {
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  }
  if (type === DATE_COLON) {
    const t = Date.parse(String(value));
    return Number.isFinite(t) ? t : value;
  }
  if (type === BOOLEAN_COLON) {
    return String(value).toLowerCase() === "true" ? 1 : 0;
  }
  return String(value).toLowerCase();
}

/**
 * Sort rows by one or more columns. `keys` is an array of
 * { column, direction: "asc"|"desc" }. Sort is stable.
 */
function sortRows(table, keys) {
  if (!keys || keys.length === 0) return { columns: table.columns.slice(), rows: table.rows.slice() };
  const specs = keys.map((k) => {
    ensureColumn(table, k.column);
    const col = k.column;
    const dir = k.direction === "desc" ? -1 : 1;
    const { type } = inspectColumns({ columns: table.columns, rows: table.rows })[col];
    return { col, dir, type };
  });

  const rows = table.rows
    .map((row, index) => ({ row, index }))
    .slice()
    .sort((a, b) => {
      for (const s of specs) {
        const av = coerceSortValue(a.row[s.col], s.type);
        const bv = coerceSortValue(b.row[s.col], s.type);
        let cmp;
        if (av === null && bv === null) cmp = 0;
        else if (av === null) cmp = -1;
        else if (bv === null) cmp = 1;
        else if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        if (cmp !== 0) return cmp * s.dir;
      }
      return a.index - b.index; // stable
    })
    .map((x) => x.row);

  return { columns: table.columns.slice(), rows };
}

const OPERATORS = new Set(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in", "notempty", "empty"]);

function compareCell(value, type, op, operand, list) {
  if (op === "empty") return isEmptyValue(value);
  if (op === "notempty") return !isEmptyValue(value);

  if (isEmptyValue(value)) return false;

  const coerced = type === NUMBER_COLON ? Number(value) : String(value).toLowerCase();
  const opnd = type === NUMBER_COLON ? Number(operand) : String(operand == null ? "" : operand).toLowerCase();

  switch (op) {
    case "eq":
      return coerced === opnd || String(value).toLowerCase() === String(operand == null ? "" : operand).toLowerCase();
    case "ne":
      return String(value).toLowerCase() !== String(operand == null ? "" : operand).toLowerCase();
    case "gt":
      return typeof coerced === "number" && Number.isFinite(coerced) && Number.isFinite(opnd) && coerced > opnd;
    case "gte":
      return typeof coerced === "number" && Number.isFinite(coerced) && Number.isFinite(opnd) && coerced >= opnd;
    case "lt":
      return typeof coerced === "number" && Number.isFinite(coerced) && Number.isFinite(opnd) && coerced < opnd;
    case "lte":
      return typeof coerced === "number" && Number.isFinite(coerced) && Number.isFinite(opnd) && coerced <= opnd;
    case "contains":
      return String(value).toLowerCase().includes(String(operand == null ? "" : operand).toLowerCase());
    case "in":
      return (
        Array.isArray(list) &&
        list.some((item) => String(item).toLowerCase() === String(value).toLowerCase())
      );
    default:
      throw new Error(`Unknown filter operator: ${op}`);
  }
}

/**
 * Filter rows by a list of conditions. All conditions must pass (AND).
 * Each condition: { column, op, value?, list? }.
 */
function filterRows(table, conditions) {
  if (!conditions || (Array.isArray(conditions) && conditions.length === 0)) {
    return { columns: table.columns.slice(), rows: table.rows.slice() };
  }
  const info = inspectColumns({ columns: table.columns, rows: table.rows });
  const conditionsNormalized = conditions.map((c) => ({
    column: c.column,
    op: c.op || "eq",
    value: c.value,
    list: c.list,
  }));
  for (const c of conditionsNormalized) {
    ensureColumn(table, c.column);
    if (!OPERATORS.has(c.op)) throw new Error(`Unknown filter operator: ${c.op}`);
  }

  const rows = table.rows.filter((row) =>
    conditionsNormalized.every((c) => compareCell(row[c.column], info[c.column].type, c.op, c.value, c.list)),
  );
  return { columns: table.columns.slice(), rows };
}

module.exports = {
  removeDuplicates,
  removeEmptyRows,
  removeEmptyColumns,
  selectColumns,
  removeColumns,
  renameColumns,
  sortRows,
  filterRows,
  OPERATORS,
};
