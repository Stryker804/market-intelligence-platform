"use strict";

/**
 * CSV parse / serialize for the Universal Data module.
 *
 * Kept dependency-free (RFC-4180-style): a minimal parser that handles
 * quoted values, commas/newlines/quotes inside quotes, empty fields and
 * UTF-8 text, plus a serializer that re-escapes fields when needed.
 */

const DELIMITER = ",";
const QUOTE = '"';

/**
 * Tokenize CSV text into an array of rows, where each row is an array of
 * raw string cells. A trailing newline on the last row is tolerated.
 *
 * Malformed input (an unterminated quote) is reported explicitly rather
 * than silently truncated.
 */
function parseCsv(text) {
  if (typeof text !== "string") {
    throw new TypeError("parseCsv expects a string");
  }

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  let sawAnyChar = false;

  function endField() {
    row.push(field);
    field = "";
  }

  while (i < n) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === QUOTE) {
        if (text[i + 1] === QUOTE) {
          field += QUOTE; // escaped quote ("")
          i += 2;
          continue;
        }
        inQuotes = false; // close quote
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === QUOTE && field === "") {
      inQuotes = true;
      sawAnyChar = true;
      i += 1;
      continue;
    }

    if (ch === QUOTE) {
      // A quote mid-field is technically malformed; keep it literally but
      // do not treat as a quote delimiter.
      field += ch;
      sawAnyChar = true;
      i += 1;
      continue;
    }

    if (ch === DELIMITER) {
      endField();
      sawAnyChar = true;
      i += 1;
      continue;
    }

    if (ch === "\r") {
      // Handle CRLF and bare CR line endings.
      endField();
      rows.push(row);
      row = [];
      if (text[i + 1] === "\n") i += 2;
      else i += 1;
      sawAnyChar = true;
      continue;
    }

    if (ch === "\n") {
      endField();
      rows.push(row);
      row = [];
      i += 1;
      sawAnyChar = true;
      continue;
    }

    field += ch;
    sawAnyChar = true;
    i += 1;
  }

  if (inQuotes) {
    throw new Error("CSV: unterminated quoted value");
  }

  // Flush the last field/row if any content remains (including a final
  // delimiter producing a trailing empty field).
  const hasPending = field !== "" || row.length > 0 || (sawAnyChar && rows.length === 0);
  if (hasPending) {
    endField();
    rows.push(row);
  }

  return rows;
}

/**
 * Parse CSV text into { columns, rows }.
 *
 *   columns : string[]            header names (first row)
 *   rows    : Array<Record<string,string>>  data rows keyed by column name
 *
 * Column names are de-duplicated by suffixing a counter so that every
 * column is addressable (a CSV may legally repeat header names).
 */
function parseTableCsv(text) {
  const table = parseCsv(text);
  if (table.length === 0) return { columns: [], rows: [] };

  const header = table[0];
  const seen = new Map();
  const columns = header.map((name) => {
    const key = String(name == null ? "" : name).trim();
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
    return count === 0 ? key : `${key}__${count}`;
  });

  const rows = [];
  for (let r = 1; r < table.length; r += 1) {
    const rawRow = table[r];
    // Skip completely empty trailing rows.
    if (rawRow.length === 1 && rawRow[0].trim() === "") continue;
    const obj = {};
    for (let c = 0; c < columns.length; c += 1) {
      obj[columns[c]] = c < rawRow.length ? rawRow[c] : "";
    }
    rows.push(obj);
  }

  return { columns, rows };
}

/**
 * Escape a single cell value for output. Returns the value unchanged when
 * it needs no quoting; otherwise wraps in quotes and doubles inner quotes.
 */
function escapeField(value) {
  if (value === null || value === undefined) return "";
  const s = String(value);
  const needsQuote =
    s.includes(DELIMITER) ||
    s.includes(QUOTE) ||
    s.includes("\n") ||
    s.includes("\r");
  if (!needsQuote) return s;
  return QUOTE + s.replace(/"/g, '""') + QUOTE;
}

/**
 * Serialize rows (array-of-arrays) back to CSV text.
 */
function serializeCsv(rows) {
  return rows.map((row) => row.map(escapeField).join(DELIMITER)).join("\r\n") + "\r\n";
}

/**
 * Serialize a table { columns, rows } back to CSV text with a header row.
 */
function serializeTableCsv({ columns, rows }) {
  const header = columns.slice();
  const body = rows.map((row) => header.map((col) => (row == null ? null : row[col])));
  return serializeCsv([header, ...body]);
}

/**
 * Round-trip helper: parse text then re-serialize. Used by tests to verify
 * escaping correctness against arbitrary values.
 */
function roundTrip(text) {
  const { columns, rows } = parseTableCsv(text);
  return serializeTableCsv({ columns, rows });
}

module.exports = {
  parseCsv,
  parseTableCsv,
  serializeCsv,
  serializeTableCsv,
  escapeField,
  roundTrip,
};
