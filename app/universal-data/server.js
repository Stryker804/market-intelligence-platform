"use strict";

/**
 * Universal Data — server-side controller.
 *
 * Holds the user's working dataset in memory for the lifetime of the server
 * process. Original uploaded data is never written back to disk; the module
 * only ever works on an in-memory copy. No user data is sent anywhere.
 */

const { Dataset, importCsv } = require("./index");

function createUdataController() {
  const state = {
    dataset: null,
    history: [],
  };

  return {
    get dataset() {
      return state.dataset;
    },

    get history() {
      return state.history;
    },

    upload({ text, name }) {
      const table = importCsv(text);
      state.dataset = new Dataset(table);
      state.dataset.name = name || null;
      state.history = [];
      return {
        ok: true,
        summary: state.dataset.summary(),
      };
    },

    reset() {
      if (!state.dataset) return { ok: false, message: "датасет не загружен" };
      state.dataset.reset();
      state.history = [];
      return { ok: true, message: "датасет возвращён к исходному состоянию" };
    },
  };
}

module.exports = { createUdataController };