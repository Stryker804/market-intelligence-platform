"use strict";

const { makeSnapshot } = require("../../core/canonical");
const { convert } = require("../../core/fx");

/**
 * LootFarm normalizer -> canonical snapshots.
 * LootFarm fullprice is a BUY catalog: `price` is USD cents the buyer pays,
 * `have` is current stock, `max` is bot capacity.
 */
function normalizeLootFarm(parsed, { fxRate, baseCurrency, timestamp }) {
  const out = [];
  for (const item of parsed) {
    if (item.priceCents == null || item.priceCents <= 0) continue;
    const priceRub = convert(item.priceCents / 100, "USD", baseCurrency, fxRate);
    if (priceRub == null || priceRub <= 0) continue;
    out.push(
      makeSnapshot({
        source: "lootfarm",
        marketHashName: item.marketHashName,
        price: priceRub,
        currency: baseCurrency,
        priceType: "BUY",
        quantity: item.have,
        levels:
          item.have > 0 ? [{ price: priceRub, quantity: item.have }] : null,
        timestamp,
        raw: {
          priceCents: item.priceCents,
          have: item.have,
          max: item.max,
          rate: item.rate,
          tr: item.tr,
          res: item.res,
        },
      }),
    );
  }
  return out;
}

module.exports = { normalizeLootFarm };