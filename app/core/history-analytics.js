"use strict";

/**
 * History analytics over the canonical history layer.
 *
 * Algorithms ported from the legacy LOOTFARM-PLATFORM (analytics/history.js
 * and analytics/trends.js) and adapted to app history records:
 *
 *   { t: <ISO>, item: <name>, sources: { lootfarm: { priceRub }, steam: { sellRub, buyRub } } }
 *
 * Universal layer: no source-specific knowledge here — callers pass a series
 * of { price, timestamp } snapshots (or a path into the app history record).
 */

const FLAT_THRESHOLD_PERCENT = 0.1;
const ACCELERATION_THRESHOLD_PERCENT = 0.01;

function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getTimestamp(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidates = [snapshot.timestamp, snapshot.time, snapshot.createdAt, snapshot.date];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      return value < 100000000000 ? value * 1000 : value;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function getPrice(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const candidates = [snapshot.price, snapshot.currentPrice, snapshot.value];
  for (const value of candidates) {
    const n = safeNumber(value);
    if (n !== null && n > 0) return n;
  }
  return null;
}

function calculatePriceChange(previousPrice, currentPrice) {
  const previous = safeNumber(previousPrice);
  const current = safeNumber(currentPrice);
  if (previous === null || previous <= 0) {
    return { available: false, reason: "INVALID_PREVIOUS_PRICE" };
  }
  if (current === null || current <= 0) {
    return { available: false, reason: "INVALID_CURRENT_PRICE" };
  }
  const change = current - previous;
  return {
    available: true,
    previousPrice: previous,
    currentPrice: current,
    change,
    changePercent: (change / previous) * 100,
  };
}

function calculatePriceVelocity(previousPrice, currentPrice, elapsedMinutes) {
  const changeResult = calculatePriceChange(previousPrice, currentPrice);
  if (!changeResult.available) {
    return { available: false, reason: changeResult.reason };
  }
  const minutes = safeNumber(elapsedMinutes);
  if (minutes === null || minutes <= 0) {
    return { available: false, reason: "INVALID_ELAPSED_TIME" };
  }
  return {
    available: true,
    previousPrice: changeResult.previousPrice,
    currentPrice: changeResult.currentPrice,
    change: changeResult.change,
    changePercent: changeResult.changePercent,
    elapsedMinutes: minutes,
    velocity: changeResult.change / minutes,
    velocityPercent: changeResult.changePercent / minutes,
  };
}

function analyzeHistory(previous, current) {
  if (!previous || typeof previous !== "object") {
    return { available: false, reason: "NO_PREVIOUS_SNAPSHOT" };
  }
  if (!current || typeof current !== "object") {
    return { available: false, reason: "NO_CURRENT_SNAPSHOT" };
  }
  const previousPrice = safeNumber(previous.price);
  const currentPrice = safeNumber(current.price);
  const previousTimestamp = getTimestamp(previous);
  const currentTimestamp = getTimestamp(current);
  if (previousTimestamp === null || currentTimestamp === null) {
    return { available: false, reason: "INVALID_TIMESTAMP" };
  }
  if (currentTimestamp <= previousTimestamp) {
    return { available: false, reason: "INVALID_TIMESTAMP_ORDER" };
  }
  const elapsedMilliseconds = currentTimestamp - previousTimestamp;
  const elapsedMinutes = elapsedMilliseconds / 1000 / 60;
  const changeResult = calculatePriceChange(previousPrice, currentPrice);
  if (!changeResult.available) return changeResult;
  const velocityResult = calculatePriceVelocity(previousPrice, currentPrice, elapsedMinutes);
  if (!velocityResult.available) {
    return { available: false, reason: velocityResult.reason };
  }
  return {
    available: true,
    previousPrice: changeResult.previousPrice,
    currentPrice: changeResult.currentPrice,
    change: changeResult.change,
    changePercent: changeResult.changePercent,
    previousTimestamp,
    currentTimestamp,
    elapsedMilliseconds,
    elapsedMinutes,
    velocity: velocityResult.velocity,
    velocityPercent: velocityResult.velocityPercent,
  };
}

function determineDirection(changePercent) {
  const change = safeNumber(changePercent);
  if (change === null) return "UNKNOWN";
  if (change > FLAT_THRESHOLD_PERCENT) return "RISING";
  if (change < -FLAT_THRESHOLD_PERCENT) return "FALLING";
  return "FLAT";
}

function determineTrendStrength(changePercent) {
  const change = safeNumber(changePercent);
  if (change === null) return 0;
  const strength = Math.abs(change) * 10;
  return Math.max(0, Math.min(100, strength));
}

function analyzeTrend(previousSnapshot, currentSnapshot) {
  const previousPrice = getPrice(previousSnapshot);
  const currentPrice = getPrice(currentSnapshot);
  if (previousPrice === null || currentPrice === null) {
    return { available: false, reason: "INVALID_PRICE" };
  }
  const previousTimestamp = getTimestamp(previousSnapshot);
  const currentTimestamp = getTimestamp(currentSnapshot);
  if (previousTimestamp === null || currentTimestamp === null) {
    return { available: false, reason: "INVALID_TIMESTAMP" };
  }
  if (currentTimestamp <= previousTimestamp) {
    return { available: false, reason: "INVALID_TIMESTAMP_ORDER" };
  }
  const changeData = calculatePriceChange(previousPrice, currentPrice);
  if (!changeData.available) return changeData;
  const velocityData = calculateVelocity(
    previousPrice,
    currentPrice,
    previousTimestamp,
    currentTimestamp,
  );
  if (!velocityData.available) return velocityData;
  return {
    available: true,
    previousPrice,
    currentPrice,
    change: changeData.change,
    changePercent: changeData.changePercent,
    elapsedMinutes: velocityData.elapsedMinutes,
    velocity: velocityData.velocity,
    velocityPercent: velocityData.velocityPercent,
    direction: determineDirection(changeData.changePercent),
    strength: determineTrendStrength(changeData.changePercent),
  };
}

function calculateVelocity(
  previousPrice,
  currentPrice,
  previousTimestamp,
  currentTimestamp,
) {
  const changeData = calculatePriceChange(previousPrice, currentPrice);
  if (!changeData.available) {
    return { available: false, reason: changeData.reason };
  }
  const previousTime = getTimestamp({ timestamp: previousTimestamp });
  const currentTime = getTimestamp({ timestamp: currentTimestamp });
  if (previousTime === null || currentTime === null) {
    return { available: false, reason: "INVALID_TIMESTAMP" };
  }
  const elapsedMs = currentTime - previousTime;
  if (elapsedMs <= 0) {
    return { available: false, reason: "INVALID_TIMESTAMP_ORDER" };
  }
  const elapsedMinutes = elapsedMs / 60000;
  if (elapsedMinutes <= 0) {
    return { available: false, reason: "INVALID_ELAPSED_TIME" };
  }
  return {
    available: true,
    elapsedMinutes,
    velocity: changeData.change / elapsedMinutes,
    velocityPercent: changeData.changePercent / elapsedMinutes,
  };
}

function analyzeTrendSeries(history) {
  if (!Array.isArray(history)) {
    return { available: false, reason: "INVALID_HISTORY" };
  }
  if (history.length < 2) {
    return { available: false, reason: "INSUFFICIENT_HISTORY" };
  }
  const movements = [];
  for (let i = 1; i < history.length; i += 1) {
    const result = analyzeTrend(history[i - 1], history[i]);
    if (result.available) movements.push(result);
  }
  if (movements.length === 0) {
    return { available: false, reason: "NO_VALID_MOVEMENTS" };
  }
  const latest = movements[movements.length - 1];
  let acceleration = null;
  let accelerationPercent = null;
  let accelerationState = "UNKNOWN";
  if (movements.length >= 2) {
    const previous = movements[movements.length - 2];
    acceleration = safeNumber(previous.velocity) !== null ? latest.velocity - previous.velocity : null;
    if (acceleration !== null) {
      accelerationPercent = latest.velocityPercent - previous.velocityPercent;
      if (accelerationPercent > ACCELERATION_THRESHOLD_PERCENT) {
        accelerationState = "ACCELERATING";
      } else if (accelerationPercent < -ACCELERATION_THRESHOLD_PERCENT) {
        accelerationState = "DECELERATING";
      } else {
        accelerationState = "STABLE";
      }
    }
  }
  return {
    available: true,
    movements,
    count: movements.length,
    latest,
    direction: latest.direction,
    strength: latest.strength,
    change: latest.change,
    changePercent: latest.changePercent,
    velocity: latest.velocity,
    velocityPercent: latest.velocityPercent,
    acceleration,
    accelerationPercent,
    accelerationState,
  };
}

/**
 * Summarize a price series across the whole history for one source path
 * (e.g. "sources.lootfarm.priceRub"). Returns analyzeTrendSeries compatible
 * result plus the overall change first->last and point/window counts.
 */
function analyzeItemHistory(entries, path) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { available: false, reason: "EMPTY_HISTORY" };
  }
  const series = [];
  for (const entry of entries) {
    if (!entry || entry.t === undefined || entry.t === null) continue;
    const ts = getTimestamp({ timestamp: entry.t });
    if (ts === null) continue;
    const n = safeNumber(dig(entry, path));
    if (n !== null && n > 0) series.push({ price: n, timestamp: ts });
  }
  if (series.length === 0) {
    return { available: false, reason: "NO_VALID_POINTS" };
  }
  series.sort((a, b) => a.timestamp - b.timestamp);
  const trend = analyzeTrendSeries(series);
  const overall = analyzeHistory(series[0], series[series.length - 1]);
  const result = {
    available: trend.available,
    reason: trend.reason,
    points: series.length,
    firstTimestamp: series[0].timestamp,
    lastTimestamp: series[series.length - 1].timestamp,
    firstPrice: series[0].price,
    lastPrice: series[series.length - 1].price,
  };
  if (trend.available) {
    result.direction = trend.direction;
    result.strength = trend.strength;
    result.change = trend.change;
    result.changePercent = trend.changePercent;
    result.velocity = trend.velocity;
    result.velocityPercent = trend.velocityPercent;
    result.accelerationState = trend.accelerationState;
    result.acceleration = trend.acceleration;
  }
  if (overall.available) {
    result.overallChange = overall.change;
    result.overallChangePercent = overall.changePercent;
    result.elapsedMinutes = overall.elapsedMinutes;
  }
  return result;
}

function dig(obj, path) {
  if (obj == null) return undefined;
  return String(path).split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
}

module.exports = {
  analyzeHistory,
  analyzeTrend,
  analyzeTrendSeries,
  analyzeItemHistory,
  calculatePriceChange,
  calculatePriceVelocity,
};