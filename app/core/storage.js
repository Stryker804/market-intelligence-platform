"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * JSON/JSONL file storage layer.
 *
 * Layout:
 *   data/state/items.json             current normalized state (keyed list)
 *   data/state/meta.json              last collection metadata per source
 *   data/opportunities/latest.json    latest opportunity list
 *   data/opportunities/history.jsonl  append-only opportunities
 *   data/history/<identityKey>.jsonl  append-only per-item price history
 *   data/raw/<source>-<timestamp>.json raw snapshots
 */

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), "utf8");
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function appendJsonLine(filePath, record) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf8");
}

function readJsonLines(filePath, limit = 100000) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const out = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        continue;
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.stateFile = path.join(dataDir, "state", "items.json");
    this.metaFile = path.join(dataDir, "state", "meta.json");
    this.oppFile = path.join(dataDir, "opportunities", "latest.json");
    this.oppHistoryFile = path.join(dataDir, "opportunities", "history.jsonl");
    this.historyDir = path.join(dataDir, "history");
    this.rawDir = path.join(dataDir, "raw");
    ensureDir(path.dirname(this.stateFile));
    ensureDir(this.historyDir);
    ensureDir(this.rawDir);
  }

  loadItems() {
    return readJson(this.stateFile, {});
  }

  saveItems(items) {
    writeJsonAtomic(this.stateFile, items);
  }

  loadMeta() {
    return readJson(this.metaFile, {});
  }

  saveMeta(meta) {
    writeJsonAtomic(this.metaFile, meta);
  }

  saveRawSnapshot(source, records) {
    const file = path.join(
      this.rawDir,
      `${source}-${Date.now()}.json`,
    );
    writeJsonAtomic(file, { source, collectedAt: new Date().toISOString(), records });
    return file;
  }

  saveOpportunities(list, { summary } = {}) {
    writeJsonAtomic(this.oppFile, {
      generatedAt: new Date().toISOString(),
      summary,
      opportunities: list,
    });
    for (const opp of list.slice(0, 500)) {
      appendJsonLine(this.oppHistoryFile, opp);
    }
  }

  loadOpportunities() {
    return readJson(this.oppFile, {
      generatedAt: null,
      opportunities: [],
    });
  }

  historyFileOf(identityKey) {
    const safe = String(identityKey).replace(/[^a-zA-Z0-9_\-.]/g, "_").slice(0, 180);
    return path.join(this.historyDir, `${safe}.jsonl`);
  }

  appendHistory(identityKey, record) {
    appendJsonLine(this.historyFileOf(identityKey), record);
  }

  readHistory(identityKey, limit = 2000) {
    return readJsonLines(this.historyFileOf(identityKey), limit);
  }
}

module.exports = { Store, writeJsonAtomic, readJson, appendJsonLine, readJsonLines };