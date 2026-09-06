"use strict";

/**
 * LIS-SKINS adapter entry point (standard adapter contract).
 *
 *   collect(config, fx, timestamp, opts) -> { ok, parsedCount, normalized, collectedAt, note }
 *
 * LIS-SKINS is a catalog source: the public bulk export returns the whole CS2
 * item universe. No `opts.candidates` needed.
 *
 * opts:
 *   - forceFixture (bool): if true, always read the saved fixture.
 */

const { parseLisSkins } = require("./parser");
const { normalizeLisSkins } = require("./normalizer");
const lisSkinsFetch = require("./fetch");
const path = require("node:path");
const fs = require("node:fs");

const FIXTURE = path.join(__dirname, "..", "..", "data", "fixtures", "lis-skins-latest.json");

async function collect(config, fx, timestamp, { forceFixture = false } = {}) {
  const c = config.sources["lis-skins"];
  if (!c) return { ok: false, reason: "NOT_CONFIGURED", parsed: [], normalized: [], collectedAt: timestamp, note: {} };
  const note = {};
  let raw;
  try {
    if (forceFixture) throw new Error("offline mode: fixture");
    raw = await lisSkinsFetch.fetchRawCatalog({ url: c.url, timeoutMs: c.timeoutMs, retries: c.retries });
    note.source = "live";
  } catch (error) {
    note.error = error.message;
    if (c.preferFixtureIfUnavailable) {
      try {
        raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
        note.source = "fixture";
        note.fixture = true;
      } catch (e2) {
        return { ok: false, reason: note.error, parsed: [], normalized: [] };
      }
    } else {
      return { ok: false, reason: note.error, parsed: [], normalized: [] };
    }
  }
  const parsed = parseLisSkins(raw);
  const normalized = normalizeLisSkins(parsed, {
    fxRate: fx.rate,
    baseCurrency: config.currency.base,
    timestamp,
  });
  return { ok: true, parsedCount: parsed.length, normalized, collectedAt: timestamp, note };
}

module.exports = { collect };