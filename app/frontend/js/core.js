/* Site-builder renderer: page -> sections -> widgets. */

window.MIPCore = (() => {
  const PAGES = {};

  // Persistent UI state shared across page renders within the session.
  const ctx = {
    current: null,          // { itemKey, itemName }
    filter: {},             // applied on reload (markets filter)
    markets: {              // markets table state (filters + sort), preserved on back nav
      q: "",
      category: "",
      source: "",
      minPrice: "",
      maxPrice: "",
      sortKey: null,        // column key to sort by
      sortDir: null,        // "asc" | "desc" | null
    },
    fromMarkets: false,     // true when we navigated from Markets -> details
    fetchJSON,
    openItem,
    goBackToMarkets,
  };

  const widgetControllers = [];

  // Normalize a markets filter object into the mipt format used by ctx.markets.
  function normalizeMarkets(filter) {
    const f = filter || {};
    return {
      q: f.q != null ? String(f.q) : "",
      category: f.category != null ? String(f.category) : "",
      source: f.source != null ? String(f.source) : "",
      minPrice: f.minPrice != null ? String(f.minPrice) : "",
      maxPrice: f.maxPrice != null ? String(f.maxPrice) : "",
    };
  }

  // Config uses kebab-case widget names (source-status, search-item, ...);
  // the registry keys are camelCase (sourceStatus, searchItem, ...).
  function resolveWidget(type) {
    if (!type) return null;
    const direct = window.MIPWidgets[type];
    if (direct) return direct;
    const camel = String(type).replace(/-([a-z])/g, (m, ch) => ch.toUpperCase());
    return window.MIPWidgets[camel] || null;
  }

  // Currency pair is always 1 USD -> base currency (rate = unit value of USD
  // in the base currency). Show pair, rate and whether it is live/cached.
  function makeFxText(fx) {
    if (fx == null || !Number.isFinite(fx.rate)) return "FX недоступен";
    const base = fx.base || "RUB";
    const status = fx.cached ? "cache" : fx.source === "live" ? "live" : fx.source === "fallback" ? "fallback" : fx.source || "?";
    return `1 USD = ${fx.rate.toFixed(2)} ${base} (${status})`;
  }

  async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 120)}`);
    }
    return res.json();
  }

  function openItem(itemKey, itemName, fromMarkets) {
    ctx.current = { itemKey, itemName };
    if (fromMarkets) ctx.fromMarkets = true;
    location.hash = "#/history?item=" + encodeURIComponent(itemKey);
    document.dispatchEvent(new CustomEvent("mip:item", { detail: ctx.current }));
  }

  // Return to the Markets page, keeping the previous filter/sort state.
  function goBackToMarkets() {
    ctx.fromMarkets = false;
    location.hash = "#/markets";
  }

  function renderNav(pageNames) {
    const nav = document.getElementById("nav");
    nav.innerHTML = "";
    for (const name of pageNames) {
      const a = document.createElement("a");
      a.href = "#/" + name;
      a.dataset.page = name;
      a.innerHTML = window.MIPFormatters.escapeHtml(PAGES[name] && PAGES[name].title ? PAGES[name].title : name);
      nav.appendChild(a);
    }
  }

  function renderPage(page, opts = {}) {
    const target = document.getElementById("page");
    const F = window.MIPFormatters;
    widgetControllers.length = 0;

    if (page.error) {
      target.innerHTML = `<div class="error-banner">${F.escapeHtml(page.error)}</div>`;
      return;
    }

    let html = `<div class="page-head"><h1>${F.escapeHtml(page.title || "")}</h1><p>${F.escapeHtml(page.description || "")}</p></div>`;

    for (const section of page.sections || []) {
      const cols = section.columns ? ` cols-${section.columns}` : "";
      html += `<div class="section"><h2 class="section__title">${F.escapeHtml(section.title || "")}</h2><div class="section__grid${cols}" data-section="${F.escapeHtml((section.title || "s")).replace(/\s+/g, "-")}"></div></div>`;
    }
    target.innerHTML = html;

    const sectionsEls = target.querySelectorAll(".section__grid");
    let si = 0;
    for (const section of page.sections || []) {
      const grid = sectionsEls[si];
      si += 1;
      for (const widgetCfg of section.widgets || []) {
        const box = document.createElement("div");
        box.className = "widget";
        box.dataset.widget = widgetCfg.type || "unknown";
        const widgetCfgSafe = { ...widgetCfg };
        const title = F.escapeHtml(widgetCfg.title || widgetCfg.type || "");
        box.innerHTML = `<div class="widget__title"><span>${title}</span></div>`;
        const body = document.createElement("div");
        box.appendChild(body);
        grid.appendChild(box);

        const renderer = resolveWidget(widgetCfg.type);
        if (!renderer) {
          body.innerHTML = `<div class="empty">Неизвестный виджет: ${F.escapeHtml(widgetCfg.type)}</div>`;
          continue;
        }
        try {
          const controller = renderer(body, widgetCfgSafe, ctx);
          widgetControllers.push(controller);
        } catch (e) {
          body.innerHTML = `<div class="empty">Ошибка виджета: ${F.escapeHtml(e.message)}</div>`;
        }
      }
    }
  }

  async function boot() {
    const F = window.MIPFormatters;
    try {
      const all = await fetchJSON("/api/pages");
      Object.assign(PAGES, all.definitions || {});
      const refreshNav = () => renderNav(all.pages || []);
      refreshNav();
      window.MIPRefreshNav = refreshNav;

      const statusEl = document.getElementById("topbar-status");
      const footerEl = document.getElementById("footer-run");
      async function refreshStatus() {
        try {
          const stats = await fetchJSON("/api/stats");
          const fx = stats.fx || {};
          const fxText = makeFxText(fx);
          statusEl.textContent = stats.lastRun ? `обновлено: ${F.date(stats.lastRun)}` : "данных нет";
          if (footerEl) footerEl.textContent = fxText;
        } catch { /* ignore */ }
      }
      setInterval(refreshStatus, 30000);
      refreshStatus().then();

      window.addEventListener("hashchange", route);
      route();
      document.addEventListener("mip:filter", (e) => {
        const detail = e.detail || {};
        // Save both the legacy filter (used by the markets table query) and
        // the richer markets state (search query, category, source, prices).
        ctx.filter = {};
        for (const k of Object.keys(detail)) {
          if (detail[k] !== undefined && detail[k] !== null && detail[k] !== "") ctx.filter[k] = detail[k];
        }
        // Preserve sort state separately — filters must not clear sorting.
        if (detail.sortKey !== undefined) ctx.markets.sortKey = detail.sortKey;
        if (detail.sortDir !== undefined) ctx.markets.sortDir = detail.sortDir;
        // Do NOT re-render the whole page: that would steal focus and destroy
        // the input mid-typing. Instead update tables in place.
        ctx.markets = { ...ctx.markets, ...normalizeMarkets(detail) };
        document.dispatchEvent(new CustomEvent("mip:table-refresh", { detail: ctx.filter }));
      });
    } catch (e) {
      document.getElementById("page").innerHTML = `<div class="error-banner">Не удалось загрузить конфигурацию страниц: ${F.escapeHtml(e.message)}</div>`;
    }
  }

  function route() {
    const hash = location.hash || "#/dashboard";
    const m = hash.match(/^#\/([a-zA-Z0-9_-]+)(?:\?(.*))?$/);
    const pageName = m ? m[1] : "dashboard";
    const query = new URLSearchParams(m && m[2] ? m[2] : "");

    const item = query.get("item");
    if (item) {
      ctx.current = { itemKey: item, itemName: item };
    }

    // Reset fromMarkets flag when leaving the history/details page.
    if (pageName !== "history") ctx.fromMarkets = false;

    const nav = document.getElementById("nav");
    if (nav) {
      nav.querySelectorAll("a").forEach((a) => a.classList.toggle("active", a.dataset.page === pageName));
    }

    const definition = PAGES[pageName];
    if (!definition) {
      renderPage({ error: "Страница не найдена: " + pageName });
      return;
    }
    renderPage(definition);
  }

  return { boot, route, ctx, fetchJSON, openItem, goBackToMarkets };
})();