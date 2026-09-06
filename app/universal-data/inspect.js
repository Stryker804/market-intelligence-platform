"use strict";

/**
 * Dataset inspection for the Universal Data module.
 *
 * Given a parsed table { columns, rows }, produce a summary that describes
 * the shape and quality of the data: row/column counts, per-column types,
 * missing-value counts, duplicate rows, and a preview of the first rows.
 */

const { inspectColumns, EMPTY_COLON } = require("./types");

function rowKey(row, columns) {
  return columns.map((c) => `${c}\u0000${String(row[c] == null ? "" : row[c])}`).join("\u0001");
}

/**
 * Count duplicate rows. Rows are considered equal when every column value
 * matches. Returns { duplicateCount, duplicateRows } where duplicateCount is
 * the number of rows that are a repeat of an earlier identical row.
 */
function findDuplicateRows({ columns, rows }) {
  const seen = new Set();
  let duplicateCount = 0;
  const duplicateRows = [];
  for (const row of rows) {
    const key = rowKey(row, columns);
    if (seen.has(key)) {
      duplicateCount += 1;
      duplicateRows.push(row);
    } else {
      seen.add(key);
    }
  }
  return { duplicateCount, duplicateRows };
}

/**
 * Count empty rows: rows where every column is empty/blank.
 */
function findEmptyRows({ columns, rows }) {
  const emptyRows = [];
  for (const row of rows) {
    let allEmpty = true;
    for (const c of columns) {
      const v = row[c];
      if (v !== null && v !== undefined && String(v).trim() !== "") {
        allEmpty = false;
        break;
      }
    }
    if (allEmpty) emptyRows.push(row);
  }
  return { emptyRowCount: emptyRows.length, emptyRows };
}

/**
 * Inspect a parsed table. Returns:
 *   rowCount, columnCount, columns (names), columnInfo (per-column type +
 *   missing), missingValueCount, duplicateCount, preview (first N rows).
 */
function inspectTable(table, { preview = 8 } = {}) {
  const { columns, rows } = table;
  const columnInfo = inspectColumns({ columns, rows });

  let missingValueCount = 0;
  for (const col of columns) {
    missingValueCount += columnInfo[col].missing;
  }

  const { duplicateCount } = findDuplicateRows({ columns, rows });

  const previewRows = rows.slice(0, preview).map((row) => {
    const out = {};
    for (const c of columns) out[c] = row[c];
    return out;
  });

  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columns,
    columnInfo,
    missingValueCount,
    duplicateCount,
    preview: previewRows,
  };
}

/**
 * Human-readable one-line dataset summary used in reports/UI.
 */
function datasetSummary(inspection) {
  return {
    rows: inspection.rowCount,
    columns: inspection.columnCount,
    duplicates: inspection.duplicateCount,
    missing: inspection.missingValueCount,
    emptyColumns: inspection.columns.filter((c) => inspection.columnInfo[c].type === EMPTY_COLON),
  };
}

module.exports = {
  inspectTable,
  findDuplicateRows,
  findEmptyRows,
  rowKey,
  datasetSummary,
};
