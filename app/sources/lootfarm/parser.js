"use strict";

/**
 * LootFarm parser — converts raw API array to a stable technical record.
 */
function parseLootFarm(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    if (!item || typeof item.name !== "string") continue;
    out.push({
      marketHashName: item.name,
      priceCents: Number.isFinite(item.price) ? item.price : null,
      have: Number.isFinite(item.have) ? item.have : 0,
      max: Number.isFinite(item.max) ? item.max : 0,
      rate: Number.isFinite(item.rate) ? item.rate : null,
      tr: item.tr,
      res: item.res,
    });
  }
  return out;
}

module.exports = { parseLootFarm };