/* Widget library for the site-builder. Each widget: (el, cfg, ctx) -> { refresh } */

const F = window.MIPFormatters = {
  escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  },
  getPath(obj, pathStr) {
    if (obj == null) return undefined;
    return String(pathStr).split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), obj);
  },
  money(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
  },
  currency(value) { return this.money(value); },
  percent2(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(2) + " %";
  },
  int(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return Math.round(n).toLocaleString("ru-RU");
  },
  date(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (isNaN(d.getTime())) return F.escapeHtml(String(value));
    return d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  },
  format(value, fmt) {
    if (value === null || value === undefined) return "—";
    if (!fmt) return F.escapeHtml(String(value));
    const fn = this[fmt];
    return fn ? fn.call(this, value) : F.escapeHtml(String(value));
  },
};

const Widgets = window.MIPWidgets = {
  kpi(el, cfg, ctx) {
    const box = document.createElement("div");
    box.className = "kpi";
    box.innerHTML = `<div class="kpi__value">—</div><div class="kpi__label">${F.escapeHtml(cfg.title || "")}</div>`;
    el.appendChild(box);
    const valueEl = box.querySelector(".kpi__value");
    const setClass = (v) => {
      valueEl.classList.remove("good", "warn");
      if (v > 0) valueEl.classList.add("good");
      else if (v < 0) valueEl.classList.add("warn");
    };
    async function refresh() {
      try {
        const data = await ctx.fetchJSON(cfg.source);
        const v = F.getPath(data, cfg.valueKey || "");
        if (v === undefined || v === null) { valueEl.textContent = "—"; return; }
        valueEl.textContent = F.format(v, (cfg.settings && cfg.settings.format) || "int") + (cfg.settings && cfg.settings.suffix ? cfg.settings.suffix : "");
        setClass(Number(v));
      } catch (e) {
        valueEl.textContent = "ERR";
      }
    }
    refresh().then();
    return { refresh };
  },

  /* ------------------------------------------------------------------ *
   * table — data table with optional client-side column sorting and a
   * right-click context menu on rows.
   * ------------------------------------------------------------------ */
  table(el, cfg, ctx) {
    const cols = cfg.columns || [];
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    wrap.innerHTML = '<table class="grid-table"><thead></thead><tbody></tbody></table>';
    el.appendChild(wrap);
    const thead = wrap.querySelector("thead");
    const tbody = wrap.querySelector("tbody");

    const numericFormats = ["money", "currency", "percent2", "int"];
    const sortable = cfg.sortable !== false;
    const isMarketsTable = cfg.source === "/api/markets";

    // Sort state: local per table, but persisted to ctx.markets on the
    // markets page so it survives "Back to markets" navigation.
    let sortKey = null;
    let sortDir = null; // "asc" | "desc" | null

    // If this table is the markets table, restore any preserved sort state.
    if (isMarketsTable && ctx.markets && ctx.markets.sortKey && ctx.markets.sortDir) {
      const restored = cols.find((c) => c.key === ctx.markets.sortKey);
      if (restored && restored.sortable !== false) {
        sortKey = ctx.markets.sortKey;
        sortDir = ctx.markets.sortDir;
      }
    }

    function persistSort() {
      if (isMarketsTable && ctx.markets) {
        ctx.markets.sortKey = sortKey;
        ctx.markets.sortDir = sortDir;
      }
    }

    const headRow = document.createElement("tr");
    for (const c of cols) {
      const th = document.createElement("th");
      const isNum = c.format && numericFormats.includes(c.format);
      if (isNum) th.classList.add("num");
      th.style.minWidth = c.width === "auto" ? "200px" : c.width || "90px";
      if (sortable && c.sortable !== false) {
        th.classList.add("sortable");
        th.dataset.sortKey = c.key;
        const arrow = c.key === sortKey ? (sortDir === "asc" ? "↑" : sortDir === "desc" ? "↓" : "↕") : "↕";
        th.innerHTML = `${F.escapeHtml(c.label || c.key)} <span class="sort-arrow">${arrow}</span>`;
        th.addEventListener("click", () => {
          const Sort = window.MIPSort;
          if (Sort) {
            const next = Sort.cycleSort(sortKey, sortDir, c.key);
            sortKey = next.key;
            sortDir = next.dir;
          } else {
            if (c.key === sortKey) {
              if (sortDir === "asc") sortDir = "desc";
              else if (sortDir === "desc") { sortDir = null; sortKey = null; }
              else sortDir = "asc";
            } else {
              sortKey = c.key;
              sortDir = "asc";
            }
          }
          persistSort();
          renderRows(rowsHolder);
          updateHeaderArrows();
        });
      } else {
        th.textContent = c.label || c.key;
      }
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    function updateHeaderArrows() {
      headRow.querySelectorAll("th.sortable").forEach((th) => {
        const key = th.dataset.sortKey;
        const arrow = key === sortKey ? (sortDir === "asc" ? "↑" : sortDir === "desc" ? "↓" : "↕") : "↕";
        const span = th.querySelector(".sort-arrow");
        if (span) span.textContent = arrow;
        th.classList.toggle("sorted", key === sortKey);
      });
    }

    function cell(value, c) {
      const td = document.createElement("td");
      if (c.format && numericFormats.includes(c.format)) td.classList.add("num");
      td.innerHTML = F.format(F.getPath(value, c.key), c.format);
      return td;
    }

    function applySort(rows) {
      const Sort = window.MIPSort;
      if (!Sort) return rows;
      return Sort.sortRows(rows, sortKey, sortDir, cols);
    }

    let rowsHolder = [];
    let renderToken = 0;

    function attachRow(row) {
      const tr = document.createElement("tr");
      tr.dataset.key = row[cfg.rowLink] ? String(row[cfg.rowLink]) : "";
      tr.dataset.name = row.itemName || "";
      for (const c of cols) tr.appendChild(cell(row, c));
      if (cfg.rowLink && row[cfg.rowLink]) {
        tr.style.cursor = "pointer";
        tr.addEventListener("click", () => ctx.openItem(row[cfg.rowLink], row.itemName, true));
        tr.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          openContextMenu(e, row, ctx);
        });
        tr.classList.add("clickable");
      }
      tbody.appendChild(tr);
    }

    // Render rows in small raf-driven batches so a large result set never
    // blocks the page (search input and header sorting stay interactive).
    function renderRows(rows) {
      rowsHolder = rows;
      const token = ++renderToken;
      tbody.innerHTML = "";
      if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="' + cols.length + '" class="empty">Нет данных</td></tr>';
        return;
      }
      const ordered = applySort(rows);
      const RENDER_CAP = 1500;
      const showTotal = rows.length;
      const visible = ordered.slice(0, RENDER_CAP);
      let i = 0;
      const CHUNK = 250;
      const nextChunk = () => {
        if (token !== renderToken) return; // a newer render superseded this one
        const end = Math.min(i + CHUNK, visible.length);
        for (; i < end; i += 1) attachRow(visible[i]);
        if (i < visible.length) {
          requestAnimationFrame(nextChunk);
        } else if (showTotal > RENDER_CAP) {
          const foot = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = cols.length;
          td.className = "empty table-note";
          td.textContent = `Показаны первые ${RENDER_CAP} из ${showTotal} записей. Примените поиск или фильтр, чтобы сузить список.`;
          foot.appendChild(td);
          tbody.appendChild(foot);
        }
      };
      requestAnimationFrame(nextChunk);
    }

    async function refresh() {
      try {
        // Only the markets table consumes the shared filter; other tables
        // (arbitrage, dashboard) must not be affected by markets filters.
        const base = cfg.source === "/api/markets" ? { ...(cfg.params || {}), ...(ctx.filter || {}) } : { ...(cfg.params || {}) };
        const params = base;
        const qs = new URLSearchParams();
        for (const k of Object.keys(params)) if (params[k] !== undefined && params[k] !== null && params[k] !== "") qs.set(k, String(params[k]));
        const data = await ctx.fetchJSON(cfg.source + "?" + qs.toString());
        const rows = Array.isArray(data) ? data : data.rows || data.opportunities || [];
        renderRows(rows);
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="' + cols.length + '" class="empty">Ошибка загрузки: ' + F.escapeHtml(e.message) + "</td></tr>";
      }
    }

    // Refresh in place when the shared filters change — avoids a full page
    // re-render so the search input keeps focus while typing.
    document.addEventListener("mip:table-refresh", () => refresh());

    refresh().then();
    return { refresh };
  },

  sourceStatus(el, cfg, ctx) {
    const grid = document.createElement("div");
    grid.className = "status-grid";
    el.appendChild(grid);

    function card(src) {
      const ok = src.available;
      const badgeClass = ok ? "ok" : src.status === "NO_DATA" ? "nodata" : "unav";
      const badgeText = ok ? "OK" : src.status === "NO_DATA" ? "NO DATA" : "SOURCE UNAVAILABLE";
      let noteText = "";
      if (src.error) noteText = src.error;
      else if (src.note && src.note.source === "fixture") noteText = "данные из сохранённого снапшота";
      else if (src.note && src.note.source === "live") noteText = "live-съёмка";
      return `
        <div class="status-card">
          <div class="status-card__name">${F.escapeHtml(src.name)} <span class="badge ${badgeClass}">${badgeText}</span></div>
          <div class="status-card__row">включён: ${src.enabled ? "да" : "нет"}</div>
          ${src.lastItems != null ? `<div class="status-card__row">записей: ${F.int(src.lastItems)}</div>` : ""}
          ${noteText ? `<div class="status-card__row">${F.escapeHtml(noteText)}</div>` : ""}
        </div>`;
    }

    async function refresh() {
      try {
        const data = await ctx.fetchJSON("/api/sources");
        grid.innerHTML = (data.sources || []).map(card).join("");
      } catch (e) {
        grid.innerHTML = '<div class="empty">Ошибка: ' + F.escapeHtml(e.message) + "</div>";
      }
    }
    refresh().then();
    return { refresh };
  },

  /* ------------------------------------------------------------------ *
   * filter — markets filter: search query, category, source, price range.
   * State is preserved in ctx.markets and restored on re-render. Filters
   * do not reset each other nor the sort direction.
   * ------------------------------------------------------------------ */
  filter(el, cfg, ctx) {
    const initial = ctx.markets || {};
    const bar = document.createElement("div");
    bar.className = "filter-bar";
    bar.innerHTML = `
      <input type="search" placeholder="Название предмета" data-f="q" value="${F.escapeHtml(initial.q || "")}" />
      <select data-f="category"><option value="">Любая категория</option>
        ${["weapon", "knife", "gloves", "case", "sticker", "other"]
          .map((c) => `<option value="${c}" ${initial.category === c ? "selected" : ""}>${c}</option>`).join("")}
      </select>
      <select data-f="source"><option value="">Любой источник</option><option value="steam" ${initial.source === "steam" ? "selected" : ""}>есть Steam</option><option value="lootfarm" ${initial.source === "lootfarm" ? "selected" : ""}>есть LootFarm</option></select>
      <input type="number" placeholder="Мин. цена ₽" data-f="minPrice" style="min-width:110px" value="${F.escapeHtml(initial.minPrice || "")}" />
      <input type="number" placeholder="Макс. цена ₽" data-f="maxPrice" style="min-width:110px" value="${F.escapeHtml(initial.maxPrice || "")}" />
      <button type="button" data-f="apply">Применить</button>
    `;
    el.appendChild(bar);

    const read = () => {
      const f = {};
      bar.querySelectorAll("[data-f]").forEach((node) => {
        if (node.dataset.f === "apply") return;
        const value = node.value.trim();
        if (value) f[node.dataset.f] = value;
      });
      return f;
    };

    const apply = () => document.dispatchEvent(new CustomEvent("mip:filter", { detail: read() }));

    bar.querySelector('[data-f="apply"]').addEventListener("click", apply);

    // Live search with debounce — no per-keystroke request burst.
    const qInput = bar.querySelector('[data-f="q"]');
    let timer = null;
    qInput.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(apply, 300);
    });
    // Apply immediate on Enter.
    qInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); apply(); } });
  },

  /* ------------------------------------------------------------------ *
   * searchItem — history item search. Case-insensitive partial match on
   * canonical item name. Debounced. Clickable results open the item.
   * ------------------------------------------------------------------ */
  searchItem(el, cfg, ctx) {
    const bar = document.createElement("div");
    bar.className = "filter-bar";
    bar.innerHTML = `
      <input type="search" placeholder="Введите название предмета…" id="mip-search" />
      <button type="button">Найти</button>
    `;
    el.appendChild(bar);
    const input = bar.querySelector("#mip-search");
    const list = document.createElement("div");
    list.style.marginTop = "8px";
    el.appendChild(list);

    let timer = null;

    async function search() {
      const q = input.value.trim();
      if (!q) {
        list.innerHTML = '<div class="empty search-empty">Введите название предмета.</div>';
        return;
      }
      try {
        // Search by canonical item name (partial, case-insensitive on the
        // server via marketHashName includes). No per-keystroke request —
        // the input handler is debounced.
        const data = await ctx.fetchJSON("/api/markets?q=" + encodeURIComponent(q) + "&limit=20");
        if (!data.rows || data.rows.length === 0) {
          list.innerHTML = '<div class="empty search-empty">Ничего не найдено</div>';
          return;
        }
        list.innerHTML = data.rows
          .map((r) => `<div class="grid-table link search-result" style="padding:6px 8px;border-radius:6px" data-net="${F.escapeHtml(r.identityKey)}" data-name="${F.escapeHtml(r.itemName)}">${F.escapeHtml(r.itemName)} — ${F.money(r.lootfarmBuy || r.steamSell)}</div>`)
          .join("");
        list.querySelectorAll("[data-net]").forEach((node) =>
          node.addEventListener("click", () => ctx.openItem(node.dataset.net, node.dataset.name || input.value)),
        );
      } catch (e) {
        list.innerHTML = '<div class="empty search-empty">Ошибка: ' + F.escapeHtml(e.message) + "</div>";
      }
    }

    bar.querySelector("button").addEventListener("click", () => { clearTimeout(timer); search(); });
    input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(search, 300);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { clearTimeout(timer); search(); }
    });
    // Initial neutral state.
    list.innerHTML = '<div class="empty search-empty">Введите название предмета.</div>';
  },

  itemDetail(el, cfg, ctx) {
    const box = document.createElement("div");
    box.className = "detail-grid";
    box.innerHTML = '<div class="empty" style="grid-column:1/-1">Не выбран предмет. Выберите из списка возможностей или через поиск.</div>';
    el.appendChild(box);

    function renderHeader(item) {
      const name = (item && item.itemName) || (ctx.current && ctx.current.itemName) || "";
      const backBtn = ctx.fromMarkets
        ? `<button type="button" class="back-btn" id="mip-back-markets">← Вернуться к рынкам</button>`
        : "<span></span>";
      return `<div class="detail-header">${backBtn}<h3 class="detail-title">${F.escapeHtml(name)}</h3></div>`;
    }

    function renderItem(item, header) {
      const s = (item && item.sources) || {};
      const lf = s.lootfarm || {};
      const st = s.steam || {};
      const lfPrice = lf.priceRub != null ? F.money(lf.priceRub) : '<span class="muted">нет</span>';
      const stSell = st.sellRub != null ? F.money(st.sellRub) : '<span class="muted">нет</span>';
      const stBuy = st.buyRub != null ? F.money(st.buyRub) : '<span class="muted">нет</span>';
      const rows = [
        ["LootFarm покупка", lfPrice],
        ["LootFarm сток", lf.quantity != null ? F.int(lf.quantity) : '<span class="muted">нет</span>'],
        ["Steam SELL (покупатель платит)", stSell],
        ["Steam BID (мгн. продажа)", stBuy],
        ["Заявок SELL", st.sellQuantity != null ? F.int(st.sellQuantity) : '<span class="muted">нет</span>'],
        ["Заявок BUY", st.buyQuantity != null ? F.int(st.buyQuantity) : '<span class="muted">нет</span>'],
      ];
      box.innerHTML = header
        + rows
          .map(([k, v]) => `<div class="cell"><div class="k">${F.escapeHtml(k)}</div><div class="v">${v}</div></div>`)
          .join("");
      const back = box.querySelector("#mip-back-markets");
      if (back) back.addEventListener("click", () => ctx.goBackToMarkets());
    }

    async function refresh() {
      if (!ctx.current || !ctx.current.itemKey) {
        box.innerHTML = '<div class="empty" style="grid-column:1/-1">Не выбран предмет.</div>';
        return;
      }
      try {
        const data = await ctx.fetchJSON("/api/items/" + encodeURIComponent(ctx.current.itemKey));
        if (data.error) {
          box.innerHTML = '<div class="empty" style="grid-column:1/-1">' + F.escapeHtml(data.error) + "</div>";
          return;
        }
        renderItem(data.item, renderHeader(data.item));
      } catch (e) {
        box.innerHTML = '<div class="empty" style="grid-column:1/-1">Ошибка: ' + F.escapeHtml(e.message) + "</div>";
      }
    }
    refresh().then();
    return { refresh };
  },

  historyStats(el, cfg, ctx) {
    const box = document.createElement("div");
    box.className = "detail-grid";
    box.innerHTML = '<div class="empty" style="grid-column:1/-1">Не выбран предмет.</div>';
    el.appendChild(box);

    const DIR = { RISING: "вверх", FALLING: "вниз", FLAT: "боковик", UNKNOWN: "—" };
    const ACC = {
      ACCELERATING: "ускорение",
      DECELERATING: "замедление",
      STABLE: "стабильно",
      UNKNOWN: "—",
    };

    function trendRows(name, t) {
      if (!t || !t.available) return [];
      const needHistory = t.count != null ? ` (${t.count} движений)` : "";
      const changeAbs = t.changePercent != null ? `${t.changePercent >= 0 ? "+" : ""}${t.changePercent.toFixed(2)}%` : "—";
      return [
        [`${name} направление`, DIR[t.direction] || t.direction || "—" + needHistory],
        [`${name} изменение (посл.)`, changeAbs],
        [`${name} сила`, t.strength != null ? t.strength.toFixed(0) + "/100" : "—"],
        [`${name} скорость`, t.velocity != null ? t.velocity.toFixed(2) + " ₽/мин" : "—"],
        [`${name} ускорение`, ACC[t.accelerationState] || t.accelerationState || "—"],
      ];
    }

    function render(data) {
      const trend = (data && data.trend) || {};
      const rows = [
        ...trendRows("LF", trend.lootfarm),
        ...trendRows("Steam BID", trend.steamBuy),
      ];
      if (rows.length === 0) {
        rows.push(["Данных", "недостаточно"],
          ["Анализ требует", "минимум 2 точки истории одного масштаба"],
          ["Подсказка", "история построена заново с исправленной конвертацией LootFarm (USD-центы → ₽)"]);
      }
      box.innerHTML = rows
        .map(([k, v]) => `<div class="cell"><div class="k">${F.escapeHtml(k)}</div><div class="v">${F.escapeHtml(String(v))}</div></div>`)
        .join("");
    }

    async function refresh() {
      if (!ctx.current || !ctx.current.itemKey) {
        box.innerHTML = '<div class="empty" style="grid-column:1/-1">Не выбран предмет.</div>';
        return;
      }
      try {
        const data = await ctx.fetchJSON("/api/items/" + encodeURIComponent(ctx.current.itemKey));
        if (data.error) {
          box.innerHTML = '<div class="empty" style="grid-column:1/-1">' + F.escapeHtml(data.error) + "</div>";
          return;
        }
        render(data);
      } catch (e) {
        box.innerHTML = '<div class="empty" style="grid-column:1/-1">Ошибка: ' + F.escapeHtml(e.message) + "</div>";
      }
    }
    refresh().then();
    return { refresh };
  },

  chart(el, cfg, ctx) {
    const wrap = document.createElement("div");
    wrap.className = "chart-wrap";
    const legend = document.createElement("div");
    legend.className = "chart-legend";
    el.appendChild(legend);
    el.appendChild(wrap);

    const SERIES_COLORS = ["#58a6ff", "#3fb950", "#d29922", "#bc8cff", "#f85149"];

    function draw(entries, paths) {
      wrap.innerHTML = "";
      if (!entries || entries.length === 0) {
        wrap.innerHTML = '<div class="empty">Нет истории цен для этого предмета.</div>';
        legend.innerHTML = "";
        return;
      }
      const series = paths.map((p, i) => {
        const pts = entries
          .map((e, idx) => ({ t: Date.parse(e.t), v: F.getPath(e, p) }))
          .filter((x) => Number.isFinite(x.t) && Number.isFinite(x.v) && x.v > 0);
        return { name: p, color: SERIES_COLORS[i % SERIES_COLORS.length], pts };
      }).filter((s) => s.pts.length > 0);

      legend.innerHTML = series
        .map((s) => `<span><span class="dot" style="background:${s.color}"></span>${F.escapeHtml(s.name)}</span>`)
        .join("");

      if (series.length === 0) {
        wrap.innerHTML = '<div class="empty">Нет данных.</div>';
        return;
      }
      const W = Math.max(640, wrap.clientWidth || 640);
      const H = 260;
      const pad = { l: 48, r: 12, t: 12, b: 28 };
      const allPts = series.flatMap((s) => s.pts);
      let minT = Infinity, maxT = -Infinity, minV = Infinity, maxV = -Infinity;
      for (const p of allPts) {
        if (p.t < minT) minT = p.t;
        if (p.t > maxT) maxT = p.t;
        if (p.v < minV) minV = p.v;
        if (p.v > maxV) maxV = p.v;
      }
      if (minT === maxT) maxT = minT + 1;
      if (minV === maxV) maxV = minV + 1;
      const padV = (maxV - minV) * 0.08;
      minV -= padV; maxV += padV;

      const x = (t) => pad.l + ((t - minT) / (maxT - minT)) * (W - pad.l - pad.r);
      const y = (v) => pad.t + ((maxV - v) / (maxV - minV)) * (H - pad.t - pad.b);

      let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
      for (let i = 0; i <= 4; i += 1) {
        const gy = pad.t + (i / 4) * (H - pad.t - pad.b);
        const val = maxV - (i / 4) * (maxV - minV);
        svg += `<line x1="${pad.l}" y1="${gy}" x2="${W - pad.r}" y2="${gy}" stroke="#2a3441" stroke-width="1"/>`;
        svg += `<text x="${pad.l - 6}" y="${gy + 4}" fill="#8b98a9" font-size="10" text-anchor="end">${val.toFixed(0)}</text>`;
      }
      for (const s of series) {
        const pathStr = s.pts.map((p, i) => (i === 0 ? `M ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}` : ` L ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)).join("");
        svg += `<path d="${pathStr}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      const t0 = new Date(minT);
      const t1 = new Date(maxT);
      svg += `<text x="${pad.l}" y="${H - 8}" fill="#8b98a9" font-size="10">${t0.toLocaleDateString("ru-RU")}</text>`;
      svg += `<text x="${W - pad.r}" y="${H - 8}" fill="#8b98a9" font-size="10" text-anchor="end">${t1.toLocaleDateString("ru-RU")}</text>`;
      svg += "</svg>";
      wrap.innerHTML = svg;
    }

    async function refresh() {
      if (!ctx.current || !ctx.current.itemKey) {
        wrap.innerHTML = '<div class="empty">Выберите предмет.</div>';
        legend.innerHTML = "";
        return;
      }
      try {
        const data = await ctx.fetchJSON(cfg.source + encodeURIComponent(ctx.current.itemKey));
        draw(data.history || [], (cfg.settings && cfg.settings.series) || []);
      } catch (e) {
        wrap.innerHTML = '<div class="empty">Ошибка: ' + F.escapeHtml(e.message) + "</div>";
      }
    }
    refresh().then();
    return { refresh };
  },

  thresholds(el, cfg, ctx) {
    const box = document.createElement("div");
    box.className = "panel-body";
    el.appendChild(box);
    async function refresh() {
      try {
        const cfgData = await ctx.fetchJSON("/api/config");
        const o = cfgData.opportunities || {};
        const fee = cfgData.feeModel || {};
        box.innerHTML = `
          Мин. ROI: <b>${F.escapeHtml(String(o.minRoiPct))}%</b> ·
          Мин. прибыль: <b>${F.money(o.minProfitRub)}</b> ·
          Мин. ликвидность выхода: <b>${F.money(o.minSellDepthRub)}</b> ·
          Протухание данных: <b>${F.escapeHtml(String(o.staleMaxMinutes))} мин</b><br/>
          Комиссии Steam: <b>${fee.steam ? fee.steam.sellFeeRate * 100 + "% + " + fee.steam.gameFeeRate * 100 + "%" : "—"}</b> · LootFarm entry: <b>0%</b> · RustSkins: <b>unknown</b>
        `;
      } catch (e) {
        box.innerHTML = "Ошибка: " + F.escapeHtml(e.message);
      }
    }
    refresh().then();
    return { refresh };
  },

  panel(el, cfg) {
    const box = document.createElement("div");
    box.className = "panel-body";
    box.innerHTML = cfg.html || "";
    el.appendChild(box);
    return { refresh() {} };
  },

  configJson(el, cfg, ctx) {
    const pre = document.createElement("pre");
    pre.className = "json-view";
    el.appendChild(pre);
    async function refresh() {
      try {
        const data = await ctx.fetchJSON(cfg.source || "/api/config");
        pre.textContent = JSON.stringify(data, null, 2);
      } catch (e) {
        pre.textContent = "Ошибка: " + e.message;
      }
    }
    refresh().then();
    return { refresh };
  },
};

F.liveCounter = (v) => {
  if (v === null || v === undefined) return "—";
  return F.money(v);
};

/* ------------------------------------------------------------------ *
 * Context menu (shared singleton) for right-click on table rows.
 * Appears near the cursor, clamped to the viewport, closes on outside
 * click / Escape / selection, and never shows the browser menu for rows.
 * ------------------------------------------------------------------ */
let contextMenuEl = null;
let contextMenuCleanup = null;

function ensureContextMenu() {
  if (contextMenuEl && document.body.contains(contextMenuEl)) return contextMenuEl;
  contextMenuEl = document.createElement("div");
  contextMenuEl.className = "ctx-menu";
  contextMenuEl.setAttribute("role", "menu");
  document.body.appendChild(contextMenuEl);
  return contextMenuEl;
}

function closeContextMenu() {
  if (contextMenuEl) {
    contextMenuEl.classList.remove("open");
    contextMenuEl.innerHTML = "";
  }
  if (contextMenuCleanup) { contextMenuCleanup(); contextMenuCleanup = null; }
}

function openContextMenu(e, row, ctx) {
  const menu = ensureContextMenu();
  closeContextMenu();
  const key = row[ctx.keyField] || row.identityKey;
  const title = row.itemName || row.identityKey || "";
  const items = [];
  if (key) {
    items.push({ label: "Открыть детали", action: () => ctx.openItem(key, title, true) });
    items.push({ label: "Открыть историю", action: () => ctx.openItem(key, title, true) });
  }
  items.push({
    label: "Копировать название",
    action: () => { navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(title).catch(() => {}) : fallbackCopy(title); },
  });

  menu.innerHTML = items
    .map((it, i) => `<div class="ctx-menu__item" role="menuitem" data-i="${i}">${F.escapeHtml(it.label)}</div>`)
    .join("");

  menu.querySelectorAll(".ctx-menu__item").forEach((node) => {
    node.addEventListener("click", () => {
      const it = items[Number(node.dataset.i)];
      if (it) it.action();
      closeContextMenu();
    });
  });

  // Position clamped inside the viewport.
  const mw = 220, mh = items.length * 34 + 12;
  const vw = window.innerWidth, vh = window.innerHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > vw - 8) x = vw - mw - 8;
  if (y + mh > vh - 8) y = vh - mh - 8;
  if (x < 8) x = 8;
  if (y < 8) y = 8;
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  menu.classList.add("open");
  requestAnimationFrame(() => menu.focus());

  const onDocDown = (ev) => {
    if (!menu.contains(ev.target)) closeContextMenu();
  };
  const onKey = (ev) => {
    if (ev.key === "Escape") closeContextMenu();
  };
  document.addEventListener("mousedown", onDocDown);
  document.addEventListener("keydown", onKey);
  contextMenuCleanup = () => {
    document.removeEventListener("mousedown", onDocDown);
    document.removeEventListener("keydown", onKey);
  };
  menu.tabIndex = -1;
}

function fallbackCopy(text) {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch { /* ignore */ }
}

window.MIPWidgets = Widgets;
window.MIPContextMenu = { open: openContextMenu, close: closeContextMenu };
