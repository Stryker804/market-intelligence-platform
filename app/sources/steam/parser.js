"use strict";

const { prCurrencyToCode } = require("../../core/canonical");

/**
 * Steam parser — raw orderbook response -> parsed orderbook record.
 * Validated against the schema used in ZOD sources/steam/schema.js and
 * against live responses. Prices are /100 (minor units).
 */
function decodeCompactLevels(rawLevels) {
  if (!Array.isArray(rawLevels) || rawLevels.length % 2 !== 0) return [];
  const out = [];
  for (let i = 0; i < rawLevels.length; i += 2) {
    const price = rawLevels[i] / 100;
    const quantity = rawLevels[i + 1];
    if (Number.isFinite(price) && price > 0 && Number.isFinite(quantity) && quantity > 0) {
      out.push({ price, quantity });
    }
  }
  return out;
}

function parseSteamOrderbook(raw, marketHashName) {
  const payload = raw && raw.data && raw.data.data;
  if (!payload || payload.success === false) {
    return { ok: false, reason: "UNSUCCESSFUL", marketHashName };
  }
  if (typeof payload.amtMaxBuyOrder !== "number") {
    return { ok: false, reason: "INVALID_PAYLOAD", marketHashName };
  }
  const currency = prCurrencyToCode(payload.eCurrency) || "USD";
  return {
    ok: true,
    marketHashName,
    currency,
    buyPrice: payload.amtMaxBuyOrder / 100,
    sellPrice:
      payload.amtMinSellOrder == null ? null : payload.amtMinSellOrder / 100,
    buyOrders: payload.cBuyOrders,
    sellOrders: payload.cSellOrders,
    buyLevels: decodeCompactLevels(payload.rgCompactBuyOrders),
    sellLevels: decodeCompactLevels(payload.rgCompactSellOrders),
  };
}

/**
 * Convert a saved research-enriched orderbook record (steam_orders.jsonl shape,
 * prices already decoded to RUB) into a parsed orderbook record.
 */
function parseResearchRecord(rec) {
  return {
    ok: true,
    marketHashName: rec.name,
    currency: "RUB",
    buyPrice: rec.highestBuy,
    sellPrice: rec.lowestSell,
    buyOrders: rec.buyOrders,
    sellOrders: rec.sellOrders,
    buyLevels: (rec.buyLevels || []).map((l) => ({ price: l.price, quantity: l.quantity })),
    sellLevels: (rec.sellLevels || []).map((l) => ({ price: l.price, quantity: l.quantity })),
  };
}

module.exports = { parseSteamOrderbook, parseResearchRecord, decodeCompactLevels };