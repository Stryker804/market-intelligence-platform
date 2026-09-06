"use strict";

const { makeSnapshot } = require("../../core/canonical");
const { convert } = require("../../core/fx");

/**
 * LIS-SKINS normalizer -> canonical snapshots.
 *
 * Semantics (from the real export, verified live 2026-09):
 *   - item identity / canonical name : `name` (Steam market hash name) — the
 *     canonical parser builds identityKey automatically.
 *   - currency                      : USD (the export is always USD).
 *   - price (listing)               : `price` — USD decimal units. This is the
 *     marketplace SELL/listing price a buyer pays. It is NOT a guaranteed exit
 *     price for the user.
 *   - available quantity            : `count` — listings aggregated under the
 *     hash name.
 *   - buyback / buy orders          : NOT provided by the public export.
 *     No fake BID snapshot is created.
 *   - timestamp                     : collection time.
 *   - fees                          : NOT exposed by the public export.
 *   - trade lock                    : NOT exposed by the public export
 *     (only the authenticated v1 API exposes `unlock_at`).
 */
function normalizeLisSkins(parsed, { fxRate, baseCurrency, timestamp }) {
  const out = [];
  for (const item of parsed) {
    if (item.priceUsd == null || item.priceUsd <= 0) continue;
    const priceRub = convert(item.priceUsd, "USD", baseCurrency, fxRate);
    if (priceRub == null || priceRub <= 0) continue;
    out.push(
      makeSnapshot({
        source: "lis-skins",
        marketHashName: item.marketHashName,
        price: priceRub,
        currency: baseCurrency,
        priceType: "SELL",
        quantity: item.count > 0 ? item.count : null,
        levels: item.count > 0 ? [{ price: priceRub, quantity: item.count }] : null,
        timestamp,
        raw: {
          priceUsd: item.priceUsd,
          unlockedPriceUsd: item.unlockedPriceUsd,
          count: item.count,
          url: item.url,
          buybackAvailable: false,
        },
      }),
    );
  }
  return out;
}

module.exports = { normalizeLisSkins };