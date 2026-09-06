"use strict";

const { makeSnapshot } = require("../../core/canonical");
const { convert } = require("../../core/fx");

/**
 * Steam normalizer -> canonical snapshots.
 * Produces a SELL snapshot (lowest ask = what the buyer pays) and a BID
 * snapshot (highest bid = what an instant seller receives).
 */
function normalizeSteam(parsed, { baseCurrency, fxRate, fx = fxRate, timestamp }) {
  if (!parsed || parsed.ok !== true) return [];
  const out = [];
  const ts = timestamp || new Date().toISOString();

  const toBase = (price) =>
    convert(price, parsed.currency, baseCurrency, fx);

  if (parsed.sellPrice != null && parsed.sellPrice > 0) {
    const price = toBase(parsed.sellPrice);
    if (price != null && price > 0) {
      out.push(
        makeSnapshot({
          source: "steam",
          marketHashName: parsed.marketHashName,
          price,
          currency: baseCurrency,
          priceType: "SELL",
          quantity: parsed.sellOrders,
          levels: parsed.sellLevels,
          orderCount: parsed.sellOrders,
          timestamp: ts,
        }),
      );
    }
  }

  if (parsed.buyPrice != null && parsed.buyPrice > 0) {
    const price = toBase(parsed.buyPrice);
    if (price != null && price > 0) {
      out.push(
        makeSnapshot({
          source: "steam",
          marketHashName: parsed.marketHashName,
          price,
          currency: baseCurrency,
          priceType: "BID",
          quantity: parsed.buyOrders,
          levels: parsed.buyLevels,
          orderCount: parsed.buyOrders,
          timestamp: ts,
        }),
      );
    }
  }

  return out;
}

module.exports = { normalizeSteam };