"use strict";

/**
 * Basic statistical analysis for the Universal Data module.
 *
 * This is descriptive statistics only — it presents computed values and
 * never issues buy/sell/trading recommendations (see AGENTS.md / TЗ).
 *
 *   numeric  : count, sum, min, max, average, median, outliers
 *   category : unique count, most frequent, top values
 *   date     : min, max, range (days)
 */

const {
  inspectColumns,
  NUMBER_COLON,
  BOOLEAN_COLON,
  DATE_COLON,
  STRING_COLON,
  coerceCell,
  isEmptyValue,
} = require("./types");

function median(sortedNumbers) {
  if (sortedNumbers.length === 0) return null;
  const mid = Math.floor(sortedNumbers.length / 2);
  if (sortedNumbers.length % 2 === 1) return sortedNumbers[mid];
  return (sortedNumbers[mid - 1] + sortedNumbers[mid]) / 2;
}

/**
 * Detect obvious numeric outliers using the IQR rule (Q1 - 1.5*IQR ..+
 * Q3 + 1.5*IQR). Returns the list of values outside the fences.
 */
function detectOutliers(numbers) {
  if (numbers.length < 4) return [];
  const sorted = numbers.slice().sort((a, b) => a - b);
  const q1 = sorted[Math.floor((sorted.length - 1) / 4)];
  const q3 = sorted[Math.ceil((3 * (sorted.length - 1)) / 4)];
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return numbers.filter((n) => n < lo || n > hi);
}

function analyzeNumeric(values) {
  const nums = values
    .map((v) => coerceCell(v, NUMBER_COLON))
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) {
    return {
      type: "number",
      count: 0,
      sum: null,
      min: null,
      max: null,
      average: null,
      median: null,
      outlierCount: 0,
    };
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  const sorted = nums.slice().sort((a, b) => a - b);
  const outliers = detectOutliers(nums);
  return {
    type: "number",
    count: nums.length,
    sum,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    average: sum / nums.length,
    median: median(sorted),
    outlierCount: outliers.length,
    outliers: outliers.slice(0, 50),
  };
}

function analyzeCategory(values) {
  const nonEmpty = values
    .map((v) => (isEmptyValue(v) ? null : String(v).trim()))
    .filter((v) => v !== null);
  const freq = new Map();
  for (const v of nonEmpty) freq.set(v, (freq.get(v) || 0) + 1);
  const entries = [...freq.entries()];
  entries.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  return {
    type: "string",
    count: nonEmpty.length,
    uniqueCount: entries.length,
    top: entries.slice(0, 10).map(([value, count]) => ({ value, count })),
  };
}

function analyzeBoolean(values) {
  let trueCount = 0;
  let falseCount = 0;
  for (const v of values) {
    if (isEmptyValue(v)) continue;
    const lower = String(v).toLowerCase();
    if (lower === "true") trueCount += 1;
    else if (lower === "false") falseCount += 1;
  }
  return {
    type: "boolean",
    count: trueCount + falseCount,
    trueCount,
    falseCount,
  };
}

function analyzeDate(values) {
  const dates = values
    .map((v) => coerceCell(v, DATE_COLON))
    .filter((v) => v instanceof Date && !Number.isNaN(v.getTime()))
    .sort((a, b) => a - b);
  if (dates.length === 0) {
    return { type: "date", count: 0, min: null, max: null, rangeDays: null };
  }
  const min = dates[0];
  const max = dates[dates.length - 1];
  const rangeDays = Math.round((max - min) / 86400000);
  return {
    type: "date",
    count: dates.length,
    min: min.toISOString(),
    max: max.toISOString(),
    rangeDays,
  };
}

/**
 * Compute the full analysis report for a table. Returns an object keyed by
 * column name with the appropriate statistic block per detected type, plus
 * aggregate dataset-level findings (missing, duplicates, numeric outlier
 * count).
 */
function analyzeTable(table) {
  const { columns, rows } = table;
  const columnInfo = inspectColumns({ columns, rows });

  const columnsStats = {};
  for (const col of columns) {
    const { type } = columnInfo[col];
    const values = rows.map((r) => r[col]);
    let stats;
    switch (type) {
      case NUMBER_COLON:
        stats = analyzeNumeric(values);
        break;
      case BOOLEAN_COLON:
        stats = analyzeBoolean(values);
        break;
      case DATE_COLON:
        stats = analyzeDate(values);
        break;
      case STRING_COLON:
        stats = analyzeCategory(values);
        break;
      default:
        stats = { type, count: 0 };
    }
    stats.missing = columnInfo[col].missing;
    columnsStats[col] = stats;
  }

  let totalOutliers = 0;
  for (const col of columns) {
    if (columnsStats[col].type === "number") {
      totalOutliers += columnsStats[col].outlierCount ?? 0;
    }
  }

  const { duplicateCount } = require("./inspect").findDuplicateRows(table);
  const { emptyRowCount } = require("./inspect").findEmptyRows(table);
  let missingValueCount = 0;
  for (const col of columns) missingValueCount += columnInfo[col].missing;

  return {
    columns: columnsStats,
    dataset: {
      rowCount: rows.length,
      columnCount: columns.length,
      missingValueCount,
      duplicateCount,
      totalOutlierCount: totalOutliers,
      emptyRowCount,
    },
  };
}

module.exports = {
  median,
  detectOutliers,
  analyzeNumeric,
  analyzeCategory,
  analyzeBoolean,
  analyzeDate,
  analyzeTable,
};
