"use strict";

/**
 * Canonical domain model — the internal contract of the system.
 *
 * Everything that crosses the source boundary is normalized into
 * this model. Universal modules (storage, analytics, opportunity
 * engine, API, frontend) never see raw external formats.
 */

const EXTERIOR_MAP = {
  "factory new": "FN",
  "minimal wear": "MW",
  "field-tested": "FT",
  "well-worn": "WW",
  "battle-scarred": "BS",
};

const PRICE_TYPES = new Set([
  "BUY",
  "SELL",
  "BID",
  "ASK",
  "STORE_PRICE",
  "USER_PRICE",
]);

const STEAM_CURRENCY_MAP = {
  1: "USD",
  2: "GBP",
  3: "EUR",
  4: "CHF",
  5: "RUB",
};

function parseItemAttributes(name) {
  const source = typeof name === "string" ? name : "";
  const text = source.trim();

  const stattrak = /^StatTrak[™\s]/i.test(text);
  const souvenir = /^Souvenir\s/i.test(text);
  const isStar = text.includes("★");

  let working = text
    .replace(/^StatTrak[™\s]+/i, "")
    .replace(/^Souvenir\s+/i, "")
    .replace(/★/g, "")
    .trim();

  let exterior = null;
  const exteriorMatch = working.match(
    /\(([^)]*(?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)[^)]*)\)/i,
  );
  if (exteriorMatch) {
    const label = exteriorMatch[1].trim().toLowerCase();
    for (const full of Object.keys(EXTERIOR_MAP)) {
      if (label.includes(full)) {
        exterior = EXTERIOR_MAP[full];
        break;
      }
    }
    working = working.replace(exteriorMatch[0], "").trim();
  }

  let phase = null;
  const phaseMatch = working.match(/Phase\s*([0-9]+|[IVXLC]+)/i);
  if (phaseMatch) {
    phase = phaseMatch[1].toUpperCase();
    working = working.replace(phaseMatch[0], "").trim();
  }

  const itemName = working
    .replace(/\s*\|$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const category = inferCategory(text, itemName);
  const stickers = /sticker/i.test(text);

  return {
    stattrak,
    souvenir,
    exterior,
    phase,
    itemName,
    isStar,
    category,
    stickers: Boolean(stickers),
    game: /(cs2|counter-strike|★|factory new|field-tested)/i.test(text)
      ? "CS2"
      : null,
  };
}

function inferCategory(text, itemName) {
  const t = text.toLowerCase();
  const i = itemName.toLowerCase();
  if (/sticker/.test(t)) return "sticker";
  if (/glove/.test(t)) return "gloves";
  if (/case/.test(t) && /case/.test(i)) return "case";
  if (/key/.test(t)) return "key";
  if (/(knife|★)/.test(t)) return "knife";
  if (/graffiti/.test(t)) return "graffiti";
  if (/music kit/.test(t)) return "music_kit";
  if (/agent/.test(t)) return "agent";
  if (/\|/.test(itemName)) return "weapon";
  if (/(pin|patch)/.test(t)) return "collectible";
  return "other";
}

function identityKey(attrs) {
  const a =
    attrs && typeof attrs === "object" && attrs.itemName
      ? attrs
      : parseItemAttributes(attrs && attrs.marketHashName);
  const base = (a.itemName || "").toLowerCase().replace(/\s+/g, " ").trim();
  return [
    a.stattrak ? "ST" : "NS",
    a.souvenir ? "SV" : "NV",
    a.exterior || "XX",
    a.phase || "P0",
    base,
  ].join("|");
}

/**
 * Canonical market snapshot: one priced observation of an item on one source.
 */
function makeSnapshot(fields) {
  if (!PRICE_TYPES.has(fields.priceType)) {
    throw new TypeError(`Unknown priceType: ${fields.priceType}`);
  }
  const attrs = parseItemAttributes(fields.marketHashName);
  return {
    identityKey: identityKey(attrs),
    marketHashName: fields.marketHashName,
    itemName: attrs.itemName,
    game: fields.game || attrs.game,
    category: fields.category || attrs.category,
    exterior: attrs.exterior,
    stattrak: attrs.stattrak,
    souvenir: attrs.souvenir,
    phase: attrs.phase,
    source: fields.source,
    price: Number.isFinite(fields.price) ? fields.price : null,
    currency: fields.currency,
    priceType: fields.priceType,
    quantity: Number.isFinite(fields.quantity) ? fields.quantity : null,
    levels: Array.isArray(fields.levels) ? fields.levels : null,
    orderCount: Number.isFinite(fields.orderCount) ? fields.orderCount : null,
    timestamp: fields.timestamp,
    raw: fields.raw != null ? fields.raw : null,
  };
}

const identityWithSafeName = (name) => {
  const parsed = parseItemAttributes(name);
  return {
    key: identityKey(parsed),
    parsed,
  };
};

module.exports = {
  parseItemAttributes,
  identityKey,
  makeSnapshot,
  identityWithSafeName,
  stealCurrencyCode: STEAM_CURRENCY_MAP,
  prCurrencyToCode: (code) => STEAM_CURRENCY_MAP[code] || null,
  EXTERIOR_MAP,
  PRICE_TYPES,
};