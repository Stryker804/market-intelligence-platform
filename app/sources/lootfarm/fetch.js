"use strict";

/**
 * LootFarm connector — LIVE source adapter.
 * External contract lives here only.
 */

async function fetchRawCatalog({ url, timeoutMs = 20000, retries = 2, backoffMs = 1500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`lootfarm HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("lootfarm: expected array");
      return data;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("lootfarm: fetch failed");
}

async function fetchBotsInventory({ url, timeoutMs = 30000 } = {}) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`lootfarm bots HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    return { error: error.message, ok: false };
  }
}

module.exports = { fetchRawCatalog, fetchBotsInventory };