"use strict";

const { makeSnapshot } = require("../../core/canonical");
const { convert } = require("../../core/fx");

/**
 * DMarket normalizer -> canonical snapshots.
 *
 * Semantics (from the real v2/prices response, verified live 2026-09):
 *   - item identity / canonical name : `Title` — Steam market hash name.
 *   - currency                      : USD (the anonymous endpoint always returns
 *     USD; the `currency` param is ignored).
 *   - price (listing)               : `Price.Amount` — USD decimal units. This
 *     is the marketplace SELL/listing price a buyer pays. It is NOT a
 *     guaranteed exit price for the user.
 *   - available quantity            : NOT provided (no stock field on v2/prices).
 *   - buyback / buy orders          : NOT provided publicly. DMarket exposes no
 *     separate buy-order book in the anonymous API. No fake BID snapshot.
 *   - timestamp                     : collection time.
 *   - fees                          : NOT exposed in the response.
 *   - trade lock                    : NOT exposed in the response.
 */
function normalizeDMarket(parsed, { fxRate, baseCurrency, timestamp }) {
  const out = [];
  for (const item of parsed) {
    if (item.priceUsd == null || item.priceUsd <= 0) continue;
    const priceRub = convert(item.priceUsd, item.priceCurrency || "USD", baseCurrency, fxRate);
    if (priceRub == null || priceRub <= 0) continue;
    out.push(
      makeSnapshot({
        source: "dmarket",
        marketHashName: item.marketHashName,
        price: priceRub,
        currency: baseCurrency,
        priceType: "SELL",
        quantity: null,
        timestamp,
        raw: {
          priceUsd: item.priceUsd,
          priceCurrency: item.priceCurrency,
          buybackAvailable: false,
        },
      }),
    );
  }
  return out;
}

module.exports = { normalizeDMarket };