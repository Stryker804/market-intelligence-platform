"use strict";

/**
 * Universal Data — isolated consumer-facing data module.
 *
 * Pipeline: IMPORT -> INSPECT -> ANALYZE -> TRANSFORM -> EXPORT CSV.
 *
 * The primary input in this MVP is CSV; the module keeps an original table
 * plus a working (current) table so the user can always return to the
 * original state. Analysis is descriptive statistics only — no market or
 * trading recommendations.
 *
 * This module intentionally has no dependency on the market pipeline:
 * it does not read core/, sources/, pipeline/, or the canonical contract.
 */

const fs = require("node:fs");

const { parseTableCsv, serializeTableCsv, parseCsv, serializeCsv } = require("./csv");
const { inspectTable, datasetSummary } = require("./inspect");
const { analyzeTable } = require("./analysis");
const {
  removeDuplicates,
  removeEmptyRows,
  removeEmptyColumns,
  selectColumns,
  removeColumns,
  renameColumns,
  sortRows,
  filterRows,
} = require("./transform");

const EXPORT_FILENAME = "analysis-result.csv";

/**
 * Parse a CSV string (typed) into an internal dataset.
 */
function importCsv(text) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new Error("CSV: empty input");
  }
  return parseTableCsv(text);
}

/**
 * Read and parse a CSV file from disk.
 */
function importCsvFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  return importCsv(text);
}

/**
 * Dataset state holder. Keeps original + current table and supports the
 * full import -> inspect -> analyze -> transform -> export flow.
 */
class Dataset {
  constructor(table) {
    this.original = cloneTable(table);
    this.current = cloneTable(table);
    this.name = null;
  }

  getOriginal() {
    return cloneTable(this.original);
  }

  get() {
    return cloneTable(this.current);
  }

  getColumns() {
    return this.current.columns.slice();
  }

  getRowCount() {
    return this.current.rows.length;
  }

  reset() {
    this.current = cloneTable(this.original);
  }

  inspect(opts) {
    return inspectTable(this.current, opts);
  }

  summary() {
    return datasetSummary(this.inspect());
  }

  analyze() {
    return analyzeTable(this.current);
  }

  /**
   * Apply a named transform (or array of transforms) to the working table.
   * Each transform is applied sequentially to the current dataset.
   * Returns a summary object describing what changed.
   */
  applyTransform(transform) {
    if (Array.isArray(transform)) {
      let applied = [];
      for (const t of transform) {
        applied = applied.concat(this.applyOne(t).log || [t.type]);
      }
      const before = this.current.rows.length;
      const after = this.current.rows.length;
      return {
        applied,
        rowCountBefore: before,
        rowCountAfter: after,
      };
    }
    return this.applyOne(transform);
  }

  applyOne(t) {
    const { type } = t;
    let result;
    switch (type) {
      case "removeDuplicates":
        result = removeDuplicates(this.current);
        break;
      case "removeEmptyRows":
        result = removeEmptyRows(this.current);
        break;
      case "removeEmptyColumns":
        result = removeEmptyColumns(this.current);
        break;
      case "selectColumns":
        result = selectColumns(this.current, t.columns);
        break;
      case "removeColumns":
        result = removeColumns(this.current, t.columns);
        break;
      case "renameColumns":
        result = renameColumns(this.current, t.mapping);
        break;
      case "sort":
        result = sortRows(this.current, t.keys);
        break;
      case "filter":
        result = filterRows(this.current, t.conditions);
        break;
      default:
        throw new Error(`Unknown transform: ${type}`);
    }
    const beforeRows = this.current.rows.length;
    const beforeCols = this.current.columns.length;
    this.current = result;
    return {
      type,
      rowCountBefore: beforeRows,
      rowCountAfter: result.rows.length,
      columnCountBefore: beforeCols,
      columnCountAfter: result.columns.length,
    };
  }

  toCsv() {
    return serializeTableCsv(this.current);
  }
}

function cloneTable(table) {
  return {
    columns: (table.columns || []).slice(),
    rows: (table.rows || []).map((row) => ({ ...row })),
  };
}

const TRANSFORM_TYPES = [
  "removeDuplicates",
  "removeEmptyRows",
  "removeEmptyColumns",
  "selectColumns",
  "removeColumns",
  "renameColumns",
  "sort",
  "filter",
];

module.exports = {
  Dataset,
  importCsv,
  importCsvFile,
  parseCsv,
  parseTableCsv,
  serializeCsv,
  serializeTableCsv,
  inspectTable,
  analyzeTable,
  EXPORT_FILENAME,
  TRANSFORM_TYPES,
};
