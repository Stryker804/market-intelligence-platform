"use strict";

const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

const DEFAULT_LOOTFARM_RATE = 118;

const config = {
  root: ROOT,
  dataDir: DATA_DIR,
  server: {
    // Local default stays 127.0.0.1:8080. In production (Timeweb App
    // Platform) the platform injects PORT and routes external 80/443 traffic
    // to it; binding 0.0.0.0 there lets the platform proxy reach the app.
    host: process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1"),
    port: process.env.PORT ? parseInt(process.env.PORT, 10) || 8080 : 8080,
    // Cross-origin allow-list for state-changing POST endpoints. Empty by
    // default: same-origin browser requests pass via the request Host header.
    allowedOrigins: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [],
  },
  sink: {
    useStdout: true,
  },
  currency: {
    base: "RUB",
    fx: {
      live: true,
      fallbackUsdRub: 86.0,
      cacheFile: path.join(DATA_DIR, "fx.json"),
    },
  },
  /**
   * SOURCES.
   *
   * A new source is added by:
   *   1. Creating app/sources/<name>/adapter.js (+ optional fetch/parser/normalizer)
   *   2. Adding a config block here under sources.<name>
   * No core/pipeline/API changes are required (see ADDING_NEW_SOURCE.md).
   *
   * Required contract (per source):
   *   adapter.js exports collect(config, fx, timestamp, opts) ->
   *     { ok, parsedCount, normalized: ItemMarketSnapshot[], collectedAt, note }
   *
   * Config keys understood by the generic pipeline:
   *   enabled            (bool)        off by default for new/untested sources
   *   role               "catalog" | "per-item"   default "catalog"
   *   preferFixtureIfUnavailable (bool) fall back to data/fixtures/<name>-latest.json
   *   url|endpoint, timeoutMs, retries, backoffMs, concurrency, requestDelayMs
   * The per-item "exit" role (like steam) is fed candidates from the reference
   * universe (a catalog source, default lootfarm) via opts.candidates.
   */
  sources: {
    lootfarm: {
      enabled: true,
      role: "catalog",
      url: "https://loot.farm/fullprice.json",
      botsUrl: "https://loot.farm/botsInventory_730.json",
      timeoutMs: 20000,
      retries: 2,
      backoffMs: 1500,
      preferFixtureIfUnavailable: true,
    },
    steam: {
      enabled: true,
      role: "per-item",
      orderbookUrl: "https://steamcommunity.com/market/orderbook",
      timeoutMs: 20000,
      retries: 2,
      backoffMs: 1500,
      concurrency: 8,
      requestDelayMs: 350,
      appId: "730",
      priceFilterSource: "lootfarm",
      priceFilterType: "BUY",
      maxItemsPerRun: 200,
      preferFixtureIfUnavailable: true,
    },
    rustskins: {
      enabled: false,
      role: "catalog",
      endpoint: "https://rustskins.com/graphql",
      timeoutMs: 20000,
      note: "Blocked by Cloudflare in this environment; requires session cookies or a trusted IP. Public market operations used: steamItemMarketSummary, groupedSteamItemSales.",
    },
    "lis-skins": {
      enabled: true,
      role: "catalog",
      url: "https://lis-skins.com/market_export_json/csgo.json",
      currency: "USD",
      timeoutMs: 30000,
      retries: 2,
      backoffMs: 3000,
      rateLimit: { requestsPerMinute: 2, note: "4.5MB bulk export; poll every 30-60s. No documented numeric limit." },
      preferFixtureIfUnavailable: true,
    },
    dmarket: {
      enabled: true,
      role: "catalog",
      url: "https://api.dmarket.com/marketplace-api/v2/prices",
      gameId: "a8db",
      limit: 20,
      timeoutMs: 20000,
      retries: 2,
      backoffMs: 1200,
      rateLimit: { requestsPerSecond: 12, maxBurst: 5, note: "Anonymous limit observed via x-ratelimit-remaining-second (~12/sec). No stock on this route." },
      preferFixtureIfUnavailable: true,
    },
    "cs-money": {
      enabled: false,
      role: "catalog",
      url: "https://cs.money/2.0/market/sell-orders",
      type: 5,
      limit: 60,
      currency: "USD",
      timeoutMs: 20000,
      retries: 1,
      backoffMs: 3000,
      rateLimit: { requestsPerMinute: 30, minIntervalMs: 1500, note: "No documented limit; pace ~1 req/1.5-3s per IP. offset cap ~5000, limit<=60." },
      preferFixtureIfUnavailable: false,
      note: "Cloudflare 403 in this environment. Currency semantics of pricing.computed MUST be live-verified before enabling. No real fixture shipped.",
    },
    skinport: {
      enabled: false,
      role: "catalog",
      url: "https://api.skinport.com/v1/items",
      appId: 730,
      currency: "RUB",
      tradable: true,
      timeoutMs: 20000,
      retries: 1,
      backoffMs: 5000,
      clientId: "",
      rateLimit: { requestsPer5Minutes: 8, serverCacheSeconds: 300, note: "Documented 8 req/5min per endpoint group; 429 carries Retry-After." },
      preferFixtureIfUnavailable: false,
      note: "Cloudflare 403 in this environment. official public API; buy (buyback) block requires a client_id. No real fixture shipped.",
    },
    csfloat: {
      enabled: false,
      role: "catalog",
      url: "https://csfloat.com/api/v1/listings",
      apiKey: "",
      limit: 50,
      sortBy: "lowest_price",
      timeoutMs: 20000,
      retries: 1,
      backoffMs: 3000,
      rateLimit: { requestsPerHour: 50000, note: "x-ratelimit-limit 50000/h observed. 429 = rate limited." },
      preferFixtureIfUnavailable: false,
      note: "Listings requires an API key and is bot-gated from this environment. reference.* are fair-value estimates, NOT buyback. No real fixture shipped.",
    },
  },
  feeModel: {
    defaultSourceFeeRate: 0.0,
    steam: {
      sellFeeRate: 0.05,
      gameFeeRate: 0.1,
      minFeeMinorUnits: 1,
    },
    lootfarm: {
      entryFeeRate: 0.0,
    },
    rustskins: {
      unknown: true,
    },
    "lis-skins": {
      unknown: true,
      note: "Sell/buy fees not exposed by the public export; not live-verified in this task.",
    },
    dmarket: {
      unknown: true,
      note: "Fee not exposed by v2/prices; not live-verified in this task.",
    },
    "cs-money": {
      unknown: true,
      note: "Fee not exposed by sell-orders; not live-verified in this task.",
    },
    skinport: {
      unknown: true,
      note: "Checkout fee only (not in /v1/items); exact rate not live-verified in this task.",
    },
    csfloat: {
      unknown: true,
      note: "Fee not exposed by listings; not live-verified in this task.",
    },
  },
  opportunities: {
    enabled: true,
    strategy: "marketplace-to-steam",
    minRoiPct: 3.0,
    minProfitRub: 50,
    minSellDepthRub: 200,
    maxExecSlippagePct: 5.0,
    staleMaxMinutes: 12 * 60,
    topN: 100,
  },
  filters: {
    minPriceRub: 30,
    maxPriceRub: 300000,
  },
  collection: {
    intervalMinutes: 15,
    runOnStart: true,
  },
  defaults: {
    lootfarmRate: DEFAULT_LOOTFARM_RATE,
    game: "cs2",
  },
};

module.exports = { config };