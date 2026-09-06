"use strict";

/**
 * DMarket adapter entry point (standard adapter contract).
 *
 *   collect(config, fx, timestamp, opts) -> { ok, parsedCount, normalized, collectedAt, note }
 *
 * DMarket is a catalog source (anonymous bulk prices, CS2 = gameId `a8db`).
 * Limitation of the anonymous route: returns only a leading slice of the
 * catalog and no stock — see parser/normalizer docs.
 *
 * opts:
 *   - forceFixture (bool): if true, always read the saved fixture.
 */

const { parseDMarket } = require("./parser");
const { normalizeDMarket } = require("./normalizer");
const dmarketFetch = require("./fetch");
const path = require("node:path");
const fs = require("node:fs");

const FIXTURE = path.join(__dirname, "..", "..", "data", "fixtures", "dmarket-latest.json");

async function collect(config, fx, timestamp, { forceFixture = false } = {}) {
  const c = config.sources.dmarket;
  if (!c) return { ok: false, reason: "NOT_CONFIGURED", parsed: [], normalized: [], collectedAt: timestamp, note: {} };
  const note = {};
  let raw;
  try {
    if (forceFixture) throw new Error("offline mode: fixture");
    raw = await dmarketFetch.fetchRawPrices({
      url: c.url,
      gameId: c.gameId,
      limit: c.limit,
      timeoutMs: c.timeoutMs,
      retries: c.retries,
    });
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
  const parsed = parseDMarket(raw);
  const normalized = normalizeDMarket(parsed, {
    fxRate: fx.rate,
    baseCurrency: config.currency.base,
    timestamp,
  });
  return { ok: true, parsedCount: parsed.length, normalized, collectedAt: timestamp, note };
}

module.exports = { collect };