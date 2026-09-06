"use strict";

/**
 * API handler for the Universal Data module.
 *
 * This is an isolated consumer-facing data module and stays independent of
 * the market pipeline. State lives in memory for the lifetime of the
 * server process (a working copy over the user's uploaded data). Original
 * user files are never modified.
 */

const { Dataset, importCsv, EXPORT_FILENAME } = require("../universal-data");

function createUdataHandler(udata) {
  // udata: { dataset: Dataset|null, upload({text,name}), transform, reset,
  //         toCsv, snapshot } — see server wiring.

  return {
    /** Report whether a dataset is loaded. */
    status() {
      const d = udata.dataset;
      if (!d) {
        return { loaded: false, message: "нет загруженного датасета" };
      }
      const summary = d.summary();
      return {
        loaded: true,
        name: d.name || null,
        summary,
        transformCount: udata.history.length,
        historyTypes: udata.history.map((h) => h.type),
      };
    },

    /** Basic inspection (types, missing, duplicates, preview). */
    inspect(opts) {
      requireDataset(udata);
      return udata.dataset.inspect({ preview: opts.preview || 8 });
    },

    /** Detail analysis report. */
    analyze() {
      requireDataset(udata);
      return udata.dataset.analyze();
    },

    /** Apply a transform to the working copy. */
    transform(body) {
      requireDataset(udata);
      const result = udata.dataset.applyTransform(body);
      udata.history.push({ type: Array.isArray(body) ? "batch" : (body && body.type) || "batch", at: new Date().toISOString() });
      return result;
    },

    /** Reset the working copy to the original uploaded data. */
    reset() {
      udata.reset();
      return { ok: true, message: "датасет возвращён к исходному состоянию" };
    },

    /** Export the current (working) dataset as CSV for download. */
    export() {
      requireDataset(udata);
      const csv = udata.dataset.toCsv();
      return { csv, filename: EXPORT_FILENAME };
    },
  };
}

function requireDataset(udata) {
  if (!udata.dataset) {
    throw new Error("датасет не загружен");
  }
}

module.exports = { createUdataHandler };
