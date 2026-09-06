"use strict";

/**
 * Column type detection for the Universal Data module.
 *
 * Types are inferred from the actual cell values in a column, not from the
 * column name. A column is reported as the most specific type that
 * consistently describes its non-empty values.
 *
 * Types: "string" | "number" | "boolean" | "date" | "empty"
 */

const EMPTY_COLON = "empty";
const STRING_COLON = "string";
const NUMBER_COLON = "number";
const BOOLEAN_COLON = "boolean";
const DATE_COLON = "date";

function isEmptyValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}

// ISO date and common date-like formats (YYYY-MM-DD, DD.MM.YYYY, dates with
// time). Conservative so plain numbers/strings are not misclassified.
const DATE_LIKE = /^(?:(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?|(\d{2})[./-](\d{2})[./-](\d{4}))$/;

function looksLikeDateOrTime(value) {
  return DATE_LIKE.test(value.trim());
}

/**
 * Classify a single raw cell. Returns one of the type constants.
 */
function cellType(value) {
  if (isEmptyValue(value)) return null; // not a signal

  const raw = String(value).trim();
  if (raw.toLowerCase() === "true" || raw.toLowerCase() === "false") return BOOLEAN_COLON;

  const num = Number(raw);
  if (raw !== "" && Number.isFinite(num) && /^-?\d+(\.\d+)?$/.test(raw)) return NUMBER_COLON;

  if (looksLikeDateOrTime(raw)) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return DATE_COLON;
  }

  return STRING_COLON;
}

const TYPE_ORDER = {
  [NUMBER_COLON]: 1,
  [BOOLEAN_COLON]: 2,
  [DATE_COLON]: 3,
  [STRING_COLON]: 4,
};

/**
 * Infer the type of a whole column from its non-empty values.
 * Prefers a single consistent type; otherwise reports "string".
 */
function inferColumnType(values) {
  const seen = new Set();
  let none = true;
  for (const v of values) {
    const t = cellType(v);
    if (t === null) continue;
    none = false;
    seen.add(t);
  }
  if (none) return EMPTY_COLON;
  if (seen.size === 1) return seen.values().next().value;
  return STRING_COLON;
}

/**
 * Suggest a typed, parsed value for a cell under the column's resolution
 * type. Used by analysis and export so numbers stay numbers, dates become
 * Sortable/ISO objects, etc. Falls back to the raw string.
 */
function coerceCell(value, columnType) {
  if (isEmptyValue(value)) return null;
  const raw = String(value);
  switch (columnType) {
    case NUMBER_COLON: {
      const n = Number(raw);
      return Number.isFinite(n) ? n : raw;
    }
    case BOOLEAN_COLON: {
      const lower = raw.toLowerCase();
      if (lower === "true") return true;
      if (lower === "false") return false;
      return raw;
    }
    case DATE_COLON: {
      const t = Date.parse(raw);
      if (Number.isFinite(t)) return new Date(t);
      return raw;
    }
    default:
      return raw;
  }
}

/**
 * Classify every column in a table and return a map
 * { columnName: { type, missing, nonEmpty } }.
 */
function inspectColumns({ columns, rows }) {
  const result = {};
  for (const col of columns) {
    const values = rows.map((r) => r[col]);
    const type = inferColumnType(values);
    let missing = 0;
    for (const v of values) if (isEmptyValue(v)) missing += 1;
    result[col] = {
      type,
      missing,
      nonEmpty: rows.length - missing,
    };
  }
  return result;
}

module.exports = {
  EMPTY_COLON,
  STRING_COLON,
  NUMBER_COLON,
  BOOLEAN_COLON,
  DATE_COLON,
  isEmptyValue,
  cellType,
  inferColumnType,
  coerceCell,
  inspectColumns,
};
