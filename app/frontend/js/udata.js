/* Universal Data widget — upload CSV, inspect, analyze, transform, export.
   Isolated consumer-facing module; does not touch the market pipeline. */

(function () {
  const F = window.MIPFormatters;

  const TYPES_LABEL = {
    string: "строка",
    number: "число",
    boolean: "логич.",
    date: "дата",
    empty: "пусто",
  };

  window.MIPWidgets = window.MIPWidgets || {};

  window.MIPWidgets.udata = function udataWidget(el, cfg, ctx) {
    const root = document.createElement("div");
    root.className = "udata";
    el.appendChild(root);

    let dataset = null; // summary from /api/udata
    let columns = []; // current column list (after transforms)
    let historyCount = 0;
    let originalColumns = [];
    let fileName = null;
    let sortKeys = []; // ordered [{ column, direction }]; index 0 = primary key

    const S = window.MIPUdataSortState;

    // ---------------------------------------------------------------- render
    function fmtNum(v) {
      return v == null ? "—" : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
    }

    function esc(v) {
      return F.escapeHtml(v);
    }

    function renderUpload() {
      root.innerHTML = `
        <div class="udata__upload">
          <div class="udata__drop" id="udata-drop" role="button" tabindex="0" aria-label="Загрузить CSV">
            <div class="udata__drop-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 15V5m0 0L8 9m4-4l4 4" />
                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
              </svg>
            </div>
            <div class="udata__drop-title">Перетащите CSV-файл сюда</div>
            <div class="udata__drop-sub">или</div>
            <label class="btn btn-primary" for="udata-file">Выбрать файл…</label>
            <input type="file" id="udata-file" accept=".csv,text/csv,text/plain" hidden />
          </div>
          <p class="udata__note">Поддерживаются: заголовок в первой строке, разделитель «,», кавычки, значения с запятыми/переводами строк, пустые значения, UTF-8. Файл обрабатывается в памяти и не изменяется.</p>
        </div>
      `;
      const drop = root.querySelector("#udata-drop");
      const fileInput = root.querySelector("#udata-file");
      const chooseBtn = root.querySelector("label[for='udata-file']");

      drop.addEventListener("click", () => fileInput.click());
      drop.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileInput.click();
        }
      });
      if (chooseBtn) chooseBtn.addEventListener("click", (e) => e.stopPropagation());
      fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files[0]) uploadFile(fileInput.files[0]);
      });

      ["dragover", "dragenter"].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.add("dragover");
        }),
      );
      ["dragleave", "drop"].forEach((ev) =>
        drop.addEventListener(ev, (e) => {
          e.preventDefault();
          drop.classList.remove("dragover");
        }),
      );
      drop.addEventListener("drop", (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) uploadFile(f);
      });
    }

    async function uploadFile(file) {
      root.innerHTML = '<div class="udata__status">Загрузка…</div>';
      try {
        const res = await fetch(
          "/api/udata/import?name=" + encodeURIComponent(file.name),
          { method: "POST", body: file },
        );
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error((data.error || data.message || "ошибка загрузки"));
        dataset = data.summary;
        fileName = file.name;
        historyCount = 0;
        sortKeys = [];
        await loadColumns();
        renderWorkspace();
      } catch (e) {
        root.innerHTML = '<div class="error-banner">Ошибка загрузки: ' + esc(e.message) + "</div>";
        setTimeout(() => renderUpload(), 3000);
      }
    }

    async function apiGet(path) {
      const res = await ctx.fetchJSON(path);
      if (res.error) throw new Error(res.error);
      return res;
    }

    async function loadColumns() {
      const insp = await apiGet("/api/udata/inspect?preview=0");
      columns = insp.columns || [];
      originalColumns = columns.slice();
    }

    async function postTransform(body) {
      const res = await fetch("/api/udata/transform", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "ошибка преобразования");
      historyCount += 1;
      await loadColumns();
      // Keep multi-key sort consistent with the current columns.
      // renameColumns first so the new name can survive the prune below.
      if (body.type === "renameColumns" && body.mapping) {
        sortKeys = S.renameColumns(sortKeys, body.mapping);
      }
      sortKeys = S.prune(sortKeys, columns);
      return data;
    }

    function renderWorkspace() {
      const d = dataset || {};

      // E2E contract: exactly four .udata__kpi > .kpi__value in this order:
      // rows | columns | duplicates | missing.
      const summaryHtml = `
        <div class="udata__summary">
          <div class="udata__kpi"><div class="kpi__value">${fmtNum(d.rows)}</div><div class="kpi__label">строк</div></div>
          <div class="udata__kpi"><div class="kpi__value">${fmtNum(d.columns)}</div><div class="kpi__label">колонок</div></div>
          <div class="udata__kpi"><div class="kpi__value ${d.duplicates > 0 ? "warn" : "good"}">${fmtNum(d.duplicates)}</div><div class="kpi__label">дубликатов</div></div>
          <div class="udata__kpi"><div class="kpi__value ${d.missing > 0 ? "warn" : "good"}">${fmtNum(d.missing)}</div><div class="kpi__label">пустых значений</div></div>
        </div>
      `;

      root.innerHTML = `
        <div class="udata__workspace">
          <header class="udata__head">
            <h3 class="udata__title">Датасет${fileName ? ` <span class="udata__title-file">— ${esc(fileName)}</span>` : ""}</h3>
            <div class="udata__status-line">
              <span class="udata__status-dot" aria-hidden="true"></span>
              <span>Рабочая копия готова.</span>
              <span class="udata__status-sep">·</span>
              <span>Преобразований применено: <b>${historyCount}</b></span>
              <span class="udata__status-sep">·</span>
              <span>Исходный файл не изменяется; «Сбросить изменения» вернёт исходные данные.</span>
            </div>
          </header>

          ${summaryHtml}

          <nav class="udata__tabs" role="tablist" aria-label="Разделы работы с таблицей">
            <button type="button" role="tab" class="udata__tab is-active" id="udata-preview-btn">Просмотр</button>
            <button type="button" role="tab" class="udata__tab" id="udata-analysis-btn">Анализ</button>
            <button type="button" role="tab" class="udata__tab" id="udata-transform-btn">Преобразования</button>
            <span class="udata__tabs-spacer"></span>
            <button type="button" class="btn btn-primary" id="udata-export-btn">Скачать CSV</button>
            <button type="button" class="btn btn-ghost" id="udata-reset-btn">Сбросить изменения</button>
            <button type="button" class="btn" id="udata-close-btn">Закрыть файл</button>
          </nav>

          <div class="udata__panel" id="udata-panel">
            <div class="empty">Откройте раздел: Просмотр · Анализ · Преобразования</div>
          </div>
        </div>
      `;

      root.querySelector("#udata-preview-btn").addEventListener("click", () => renderPreview());
      root.querySelector("#udata-analysis-btn").addEventListener("click", () => renderAnalysis());
      root.querySelector("#udata-transform-btn").addEventListener("click", () => renderTransform());
      root.querySelector("#udata-export-btn").addEventListener("click", exportCsv);
      root.querySelector("#udata-reset-btn").addEventListener("click", resetDataset);
      root.querySelector("#udata-close-btn").addEventListener("click", closeDataset);

      renderPreview();
    }

    function activateTab(id) {
      root.querySelectorAll(".udata__tab").forEach((t) => {
        const on = t.id === id;
        t.classList.toggle("is-active", on);
        t.setAttribute("aria-selected", String(on));
      });
    }

    // ------------------------------------------------------------- sections
    function panelEl() {
      return root.querySelector("#udata-panel");
    }

    async function renderPreview() {
      const p = panelEl();
      activateTab("udata-preview-btn");
      p.innerHTML = '<div class="empty">Загрузка…</div>';
      try {
        const insp = await apiGet("/api/udata/inspect?preview=8");
        const cols = insp.columns || [];
        // Build the current sort state index for column headers.
        const keyIndex = {};
        sortKeys.forEach((k, i) => (keyIndex[k.column] = i));
        if (insp.rowCount === 0) {
          p.innerHTML = '<div class="udata__preview"><div class="empty">В таблице нет строк после преобразований.</div></div>';
          return;
        }
        const theadCells = cols
          .map((c) => {
            const idx = keyIndex[c];
            if (idx === undefined) {
              return `<th class="sortable" data-col="${esc(c)}" title="Сортировать по колонке ${esc(c)}">${esc(c)}</th>`;
            }
            const dir = sortKeys[idx].direction;
            const arrow = dir === "desc" ? "↓" : "↑";
            return `<th class="sortable sorted" data-col="${esc(c)}" title="Сортировать по колонке ${esc(c)}"><span class="sort-key-num">${idx + 1}</span>${esc(c)}<span class="sort-arrow">${arrow}</span></th>`;
          })
          .join("");
        let html = `
          <div class="udata__preview">
            <div class="udata__preview-head">
              <span class="udata__preview-title">Предпросмотр</span>
              <span class="udata__preview-source">${fmtNum(insp.rowCount)} строк · ${fmtNum(cols.length)} колонок</span>
            </div>
            <div class="table-scroll"><table class="grid-table"><thead><tr>` +
          theadCells +
          "</tr></thead><tbody>";
        for (const row of insp.preview) {
          html += "<tr>" + cols.map((c) => `<td>${esc(row[c] == null ? "" : row[c])}</td>`).join("") + "</tr>";
        }
        html += "</tbody></table></div>";
        if (insp.rowCount > (insp.preview || []).length) {
          html += `<div class="table-note">Показаны первые ${(insp.preview || []).length} из ${fmtNum(insp.rowCount)} строк. Клик по заголовку колонки сортирует таблицу.</div>`;
        }
        html += "</div>";
        p.innerHTML = html;
        p.querySelectorAll("th.sortable").forEach((th) => {
          th.addEventListener("click", () => sortPreview(th.dataset.col));
        });
      } catch (e) {
        p.innerHTML = '<div class="empty">Ошибка: ' + esc(e.message) + "</div>";
      }
    }

    // Sort the working dataset from the Preview table header. Reuses the same
    // sortKeys logic as Transform: first click ASC, second DESC, toggling.
    // Multi-key supported (later columns become tie-breakers).
    async function sortPreview(column) {
      const cur = sortKeys.find((k) => k.column === column);
      const dir = !cur ? "asc" : cur.direction === "asc" ? "desc" : "asc";
      sortKeys = S.toggleSort(sortKeys, column, dir);
      try {
        await postTransform({ type: "sort", keys: sortKeys });
      } catch (e) {
        const p = panelEl();
        if (p) p.innerHTML = '<div class="empty">Ошибка сортировки: ' + esc(e.message) + "</div>";
        return;
      }
      renderPreview();
    }

    async function renderAnalysis() {
      const p = panelEl();
      activateTab("udata-analysis-btn");
      p.innerHTML = '<div class="empty">Загрузка…</div>';
      try {
        const report = await apiGet("/api/udata/analysis");
        const d = report.dataset || {};
        const cols = report.columns || {};
        const keys = Object.keys(cols);
        const typeCounts = { number: 0, string: 0, boolean: 0, date: 0, empty: 0 };
        for (const k of keys) {
          const t = cols[k].type;
          if (t in typeCounts) typeCounts[t]++;
        }
        const typeSummary = [
          typeCounts.number ? `Числовые ${typeCounts.number}` : "",
          typeCounts.string ? `Строковые ${typeCounts.string}` : "",
          typeCounts.boolean ? `Логические ${typeCounts.boolean}` : "",
          typeCounts.date ? `Даты ${typeCounts.date}` : "",
          typeCounts.empty ? `Пустые ${typeCounts.empty}` : "",
        ].filter(Boolean).join(" · ");

        const html = [
          '<div class="udata-an">',
          '<div class="udata-an__intro">Отчёт строится по текущему состоянию таблицы — с учётом применённых фильтров и преобразований.</div>',
          renderSummaryCard(d, cols, keys, typeSummary),
          renderDetailedAnalysis(keys, cols, d),
          "</div>",
        ].join("");
        p.innerHTML = html;
        p.__analysisReport = report;
        bindAnalysisEvents();
      } catch (e) {
        p.innerHTML = '<div class="empty">Ошибка: ' + esc(e.message) + "</div>";
      }
    }

    // ------------------------------------------------ analysis: summary card
    // Single dynamic "Summary Report Card". Looks like a polished finished
    // analytical report (hierarchy + whitespace + progressive disclosure),
    // not a debug inspector. Built only from fields that actually exist in
    // the analysis report; never invents business metrics.
    // Structure: Отчёт по данным → Ключевые показатели → Что выделяется →
    // Качество данных.
    function renderSummaryCard(d, cols, keys, typeSummary) {
      const numHigh = pickNumericHighlights(d, cols, keys);
      const strLead = leadingStringColumn(cols, keys);
      const ld = leadingDateColumn(keys, cols);
      const notAll = keys.filter((k) => cols[k].type === "number" && !isIdLike(k)).length > numHigh.length;

      const subtitle = ld
        ? `Датасет: ${fmtNum(d.rowCount)} строк · ${fmtNum(d.columnCount)} колонок · период ${fmtDate(ld.s.min)} — ${fmtDate(ld.s.max)} (${fmtNum(ld.rangeDays)} дн.).`
        : `Датасет: ${fmtNum(d.rowCount)} строк · ${fmtNum(d.columnCount)} колонок.`;

      // Ключевые показатели — headline medians as a KPI row.
      let keyInner = "";
      if (numHigh.length) {
        keyInner += `<div class="udata-summary__kpis">${numHigh
          .map(
            (c) => `
              <div class="udata-summary__kpi">
                <div class="udata-summary__kpi-num">${fmtNum(c.s.median)}</div>
                <div class="udata-summary__kpi-label">медиана ${esc(c.name)}</div>
              </div>`,
          )
          .join("")}
        </div>
        <div class="udata-summary__caption">Медианы ключевых числовых колонок${notAll ? ". Остальные числовые колонки — в «Подробном анализе»" : ""}.</div>`;
      }
      keyInner += renderStringSummary(keys, cols, strLead);
      if (!keyInner) {
        keyInner = '<div class="udata-summary__none">Показателей для отображения нет.</div>';
      }

      // Что выделяется — narrative observations.
      const obs = buildObservations(keys, cols, d, numHigh, strLead);
      const obsHtml = obs.length
        ? `<ul class="udata-summary__obs">${obs.map((o) => `<li>${o}</li>`).join("")}</ul>`
        : '<div class="udata-summary__none">Выделяющихся структурных наблюдений нет.</div>';

      // Качество данных — KPI row.
      const qualityHtml = `<div class="udata-summary__kpis">${[
        [d.missingValueCount, "пустых значений"],
        [d.duplicateCount, "дубликатов строк"],
        [d.totalOutlierCount, "выбросов (IQR)"],
      ]
        .map(
          ([n, label]) => `
            <div class="udata-summary__kpi">
              <div class="udata-summary__kpi-num">${fmtNum(n)}</div>
              <div class="udata-summary__kpi-label">${label}</div>
            </div>`,
        )
        .join("")}
      </div>
      <div class="udata-summary__caption">Детальная статистика по колонкам и выбросам — в «Подробном анализе».</div>`;

      return `
        <section class="udata-summary">
          <header class="udata-summary__header">
            <h3 class="udata-summary__kicker">ОТЧЁТ ПО ДАННЫМ</h3>
            <p class="udata-summary__subtitle">${subtitle}</p>
            ${typeSummary ? `<p class="udata-summary__types">Типы колонок: ${typeSummary}.</p>` : ""}
          </header>
          <section class="udata-summary__section">
            <h4 class="udata-summary__section-title">Ключевые показатели</h4>
            ${keyInner}
          </section>
          <section class="udata-summary__section">
            <h4 class="udata-summary__section-title">Что выделяется</h4>
            ${obsHtml}
          </section>
          <section class="udata-summary__section">
            <h4 class="udata-summary__section-title">Качество данных</h4>
            ${qualityHtml}
          </section>
        </section>`;
    }

    // Numeric columns eligible as "key": filled with real values, not
    // constant, and not a technical identifier. Falls back to identifiers
    // when no other numeric column exists so the card stays truthful.
    function pickNumericHighlights(d, cols, keys, limit) {
      const all = keys.filter((k) => cols[k].type === "number" && (cols[k].count || 0) > 0);
      const ranked = (pool) =>
        pool
          .map((k) => ({
            name: k,
            s: cols[k],
            fill: (cols[k].count || 0) / Math.max(1, d.rowCount),
            range: cols[k].max != null && cols[k].min != null ? cols[k].max - cols[k].min : 0,
          }))
          .filter((c) => c.range > 0)
          .sort((a, b) => b.fill - a.fill || b.range - a.range);
      const primary = ranked(all.filter((k) => !isIdLike(k)));
      const chosen = primary.length ? primary : ranked(all);
      return chosen.slice(0, limit || 3);
    }

    // Structural name heuristic for technical identifiers (id, key, uid,
    // uuid, code, ...). Presentation-only; keeps ids out of "key metrics".
    function isIdLike(name) {
      const n = String(name);
      if (/(^|[\s_\-])id$/i.test(n)) return true;
      if (/(^|[\s_\-])(uuid|uid|key|code|token|hash|num|no|idx)([\s_\-]|$)/i.test(n)) return true;
      if (/[a-z0-9](key|code|uid|uuid|token|hash|num|idx|no)$/i.test(n)) return true;
      return false;
    }

    function leadingStringColumn(cols, keys) {
      let best = null;
      for (const k of keys) {
        const s = cols[k];
        if (s.type !== "string" || !(s.top || []).length) continue;
        const c = s.top[0].count;
        if (!best || c > best.count) best = { name: k, s, count: c };
      }
      return best;
    }

    function leadingDateColumn(keys, cols) {
      let best = null;
      for (const k of keys) {
        const s = cols[k];
        if (s.type !== "date" || !s.min || !s.max) continue;
        const r = s.rangeDays ?? 0;
        if (!best || r > best.rangeDays) best = { name: k, s, rangeDays: r };
      }
      return best;
    }

    function renderStringSummary(keys, cols, strLead) {
      const strKeys = keys.filter((k) => cols[k].type === "string");
      if (!strKeys.length) return "";
      const uniq = strKeys
        .slice(0, 4)
        .map((k) => `${esc(k)} — ${fmtNum(cols[k].uniqueCount ?? 0)}`)
        .join(" · ");
      const extra = strKeys.length > 4 ? ` · ещё ${strKeys.length - 4} колонки` : "";
      return `<div class="udata-summary__string">Уникальных значений: ${uniq}${extra}</div>`;
    }

    // "Noticeable results" — honest structural observations, referenced to
    // the exact column names, never to invented business terms.
    function buildObservations(keys, cols, d, numHigh, strLead) {
      const obs = [];
      if (numHigh.length) {
        const top = numHigh[0];
        const pct = d.rowCount ? Math.round((top.s.count / d.rowCount) * 100) : 0;
        obs.push(
          `Основной числовой показатель — ${esc(top.name)}: медиана ${fmtNum(top.s.median)}, заполненность ${pct}%.`,
        );
      }
      if (strLead && strLead.s.top.length) {
        const cov = strLead.s.count ? Math.round((strLead.s.top[0].count / strLead.s.count) * 100) : 0;
        obs.push(
          `Самое частое значение — «${esc(truncate(strLead.s.top[0].value, 26))}» в колонке ${esc(strLead.name)}: встречается ${fmtNum(strLead.s.top[0].count)} раз (${cov}%).`,
        );
      }
      const issues = [];
      if (d.missingValueCount) issues.push(`пустых значений ${fmtNum(d.missingValueCount)}`);
      if (d.duplicateCount) issues.push(`дубликатов строк ${fmtNum(d.duplicateCount)}`);
      if (d.totalOutlierCount) issues.push(`выбросов (IQR) ${fmtNum(d.totalOutlierCount)}`);
      obs.push(issues.length ? `Требует внимания: ${issues.join(" · ")}.` : "Пропусков и дубликатов нет — данные чистые.");
      return obs.slice(0, 3);
    }

    // Secondary detailed analysis (collapsed by default; card is primary).
    function renderDetailedAnalysis(keys, cols, d) {
      const body = [
        renderKeyMetrics(keys, cols),
        renderDataQuality(keys, cols, d),
        renderColumnsOverview(keys, cols),
      ].join("");
      return `
        <section class="udata-an__block udata-an__secondary">
          <div class="udata-an__secondary-head">
            <h4 class="udata-an__title">Подробный анализ</h4>
            <button type="button" class="udata-an__sec-toggle" data-target="udata-an-sec">Показать статистику</button>
          </div>
          <div id="udata-an-sec" hidden>${body}</div>
        </section>`;
    }

    function renderKeyMetrics(keys, cols) {
      const numKeys = keys.filter((k) => cols[k].type === "number");
      return `
        <section class="udata-an__block">
          <h4 class="udata-an__title">Ключевые показатели</h4>
          ${numKeys.length
            ? `<div class="udata-an__metrics">${numKeys.map((k) => renderMetric(k, cols[k])).join("")}</div>`
            : '<div class="udata-an__none">Числовых колонок нет</div>'}
        </section>`;
    }

    function renderMetric(name, s) {
      const outlier = s.outlierCount
        ? `<span class="udata-an__warn" title="${fmtNum(s.outlierCount)} выбросов (правило IQR)">${fmtNum(s.outlierCount)} выброс.</span>`
        : "";
      return `
        <div class="udata-an__metric">
          <div class="udata-an__metric-head">
            <span class="udata-an__metric-name" title="${esc(name)}">${esc(name)}</span>
            <span class="badge number">число</span>
            ${outlier}
          </div>
          <div class="udata-an__metric-grid">
            <div class="udata-an__metric-cell"><span>Среднее</span><b>${fmtNum(s.average)}</b></div>
            <div class="udata-an__metric-cell"><span>Медиана</span><b>${fmtNum(s.median)}</b></div>
            <div class="udata-an__metric-cell"><span>Мин</span><b>${fmtNum(s.min)}</b></div>
            <div class="udata-an__metric-cell"><span>Макс</span><b>${fmtNum(s.max)}</b></div>
          </div>
          <div class="udata-an__metric-meta">${fmtNum(s.count)} значений${s.missing ? ` · пустых ${fmtNum(s.missing)}` : ""}</div>
        </div>`;
    }

    function renderDataQuality(keys, cols, d) {
      const missingList = keys
        .map((k) => ({ name: k, n: cols[k].missing || 0 }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n);
      const outlierList = keys
        .filter((k) => cols[k].type === "number" && (cols[k].outlierCount || 0) > 0)
        .map((k) => ({ name: k, n: cols[k].outlierCount }))
        .sort((a, b) => b.n - a.n);

      const missingHtml = missingList.length
        ? `<ul class="udata-an__dq-list">${missingList
            .slice(0, 6)
            .map((x) => `<li><span class="udata-an__dq-col" title="${esc(x.name)}">${esc(x.name)}</span><b>${fmtNum(x.n)}</b></li>`)
            .join("")}</ul>${missingList.length > 6 ? `<div class="udata-an__dq-more">+ ещё ${missingList.length - 6} колонок</div>` : ""}`
        : '<div class="udata-an__dq-none">нет пустых значений</div>';
      const outlierHtml = outlierList.length
        ? `<ul class="udata-an__dq-list">${outlierList
            .map((x) => `<li><span class="udata-an__dq-col" title="${esc(x.name)}">${esc(x.name)}</span><b>${fmtNum(x.n)}</b></li>`)
            .join("")}</ul>`
        : '<div class="udata-an__dq-none">нет выбросов</div>';
      const emptyRows = d.emptyRowCount
        ? `<div class="udata-an__dq-sub">полностью пустых строк: ${fmtNum(d.emptyRowCount)}</div>`
        : "";

      return `
        <section class="udata-an__block">
          <h4 class="udata-an__title">Качество данных</h4>
          <div class="udata-an__dq">
            <div class="udata-an__dq-item">
              <div class="udata-an__dq-head">Пустые значения <b>${fmtNum(d.missingValueCount)}</b></div>
              ${missingHtml}
            </div>
            <div class="udata-an__dq-item">
              <div class="udata-an__dq-head">Дубликаты <b>${fmtNum(d.duplicateCount)}</b></div>
              <div class="udata-an__dq-body">${d.duplicateCount ? "полностью совпадающие строки" : "нет дубликатов"}</div>
              ${emptyRows}
            </div>
            <div class="udata-an__dq-item">
              <div class="udata-an__dq-head">Выбросы (IQR) <b>${fmtNum(d.totalOutlierCount)}</b></div>
              ${outlierHtml}
            </div>
          </div>
        </section>`;
    }

    function renderColumnsOverview(keys, cols) {
      return `
        <section class="udata-an__block">
          <h4 class="udata-an__title">Колонки</h4>
          ${keys.length
            ? `<div class="udata-an__cols">${keys.map((k, i) => renderColumnRow(k, cols[k], i)).join("")}</div>`
            : '<div class="udata-an__none">Нет колонок</div>'}
        </section>`;
    }

    function renderColumnRow(name, s, i) {
      const label = TYPES_LABEL[s.type] || s.type;
      const id = "udata-an-col-" + i;
      return `
        <div class="udata-an__col">
          <div class="udata-an__col-head">
            <span class="udata-an__col-name" title="${esc(name)}">${esc(name)}</span>
            <span class="badge ${s.type}">${label}</span>
            <span class="udata-an__col-brief">${renderBrief(name, s)}</span>
            <button type="button" class="udata-an__col-toggle" data-target="${id}">Подробнее</button>
          </div>
          <div class="udata-an__col-detail" id="${id}" hidden>${renderDetail(name, s)}</div>
        </div>`;
    }

    function renderBrief(name, s) {
      switch (s.type) {
        case "number":
          return `среднее ${fmtNum(s.average)} · медиана ${fmtNum(s.median)} · мин ${fmtNum(s.min)} · макс ${fmtNum(s.max)}${s.outlierCount ? ` · выбросов ${fmtNum(s.outlierCount)}` : ""}`;
        case "string": {
          const top = s.top || [];
          if (!top.length) return `${fmtNum(s.uniqueCount)} уникальных · пустых ${fmtNum(s.missing)}`;
          const topHtml = top
            .slice(0, 3)
            .map((t) => `<span class="udata-an__val" title="${esc(t.value)}">${esc(truncate(t.value, 22))} ×${fmtNum(t.count)}</span>`)
            .join("");
          return `${fmtNum(s.uniqueCount)} уникальных · частые: ${topHtml}${s.missing ? ` · пустых ${fmtNum(s.missing)}` : ""}`;
        }
        case "boolean":
          return `True ${fmtNum(s.trueCount)} · False ${fmtNum(s.falseCount)}`;
        case "date": {
          const lo = fmtDate(s.min);
          const hi = fmtDate(s.max);
          return lo && hi ? `от ${lo} до ${hi} · ${fmtNum(s.rangeDays)} дн.` : "диапазон дат отсутствует";
        }
        default:
          return "колонка пуста";
      }
    }

    function renderDetail(name, s) {
      switch (s.type) {
        case "string": {
          const top = s.top || [];
          const items = top.length
            ? `<ul class="udata-an__list">${top
                .map((t) => `<li><span class="udata-an__val-full" title="${esc(t.value)}">${esc(t.value)}</span><b>${fmtNum(t.count)}</b></li>`)
                .join("")}</ul>`
            : '<div class="udata-an__dq-none">нет значений</div>';
          return `
            <div class="udata-an__detail-row"><span>Уникальных</span><b>${fmtNum(s.uniqueCount)}</b></div>
            <div class="udata-an__detail-row"><span>Пустых</span><b>${fmtNum(s.missing)}</b></div>
            <div class="udata-an__detail-title">Частые значения (топ-${top.length || 0})</div>
            ${items}`;
        }
        case "boolean":
          return `
            <div class="udata-an__detail-row"><span>True</span><b>${fmtNum(s.trueCount)}</b></div>
            <div class="udata-an__detail-row"><span>False</span><b>${fmtNum(s.falseCount)}</b></div>
            <div class="udata-an__detail-row"><span>Пустых</span><b>${fmtNum(s.missing)}</b></div>`;
        case "date":
          return `
            <div class="udata-an__detail-row"><span>От</span><b>${fmtDate(s.min) || "—"}</b></div>
            <div class="udata-an__detail-row"><span>До</span><b>${fmtDate(s.max) || "—"}</b></div>
            <div class="udata-an__detail-row"><span>Диапазон</span><b>${fmtNum(s.rangeDays)} дн.</b></div>
            <div class="udata-an__detail-row"><span>Значений</span><b>${fmtNum(s.count)}</b></div>
            <div class="udata-an__detail-row"><span>Пустых</span><b>${fmtNum(s.missing)}</b></div>`;
        case "number": {
          const out = (s.outliers || []).slice(0, 8);
          return `
            <div class="udata-an__detail-row"><span>Значений</span><b>${fmtNum(s.count)}</b></div>
            <div class="udata-an__detail-row"><span>Сумма</span><b>${fmtNum(s.sum)}</b></div>
            <div class="udata-an__detail-row"><span>Среднее</span><b>${fmtNum(s.average)}</b></div>
            <div class="udata-an__detail-row"><span>Медиана</span><b>${fmtNum(s.median)}</b></div>
            <div class="udata-an__detail-row"><span>Мин</span><b>${fmtNum(s.min)}</b></div>
            <div class="udata-an__detail-row"><span>Макс</span><b>${fmtNum(s.max)}</b></div>
            <div class="udata-an__detail-row"><span>Выбросы</span><b>${fmtNum(s.outlierCount)}</b></div>
            <div class="udata-an__detail-row"><span>Пустых</span><b>${fmtNum(s.missing)}</b></div>
            ${out.length ? `<div class="udata-an__detail-row"><span>Примеры выбросов</span><b>${out.map(fmtNum).join(" · ")}</b></div>` : ""}`;
        }
        default:
          return `<div class="udata-an__detail-row"><span>Пустых</span><b>${fmtNum(s.missing)}</b></div>`;
      }
    }

    function truncate(v, n) {
      const s = String(v);
      return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }

    function fmtDate(iso) {
      if (!iso) return null;
      const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? m[3] + "." + m[2] + "." + m[1] : String(iso).slice(0, 10);
    }

    function bindAnalysisEvents() {
      const p = panelEl();
      p.querySelectorAll(".udata-an__col-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
          const detail = p.querySelector("#" + btn.dataset.target);
          if (!detail) return;
          const willOpen = detail.hidden;
          detail.hidden = !willOpen;
          btn.textContent = willOpen ? "Свернуть" : "Подробнее";
          const col = btn.closest(".udata-an__col");
          if (col) col.classList.toggle("udata-an__col--open", willOpen);
        });
      });
      const secBtn = p.querySelector(".udata-an__sec-toggle");
      if (secBtn) {
        secBtn.addEventListener("click", () => {
          const detail = p.querySelector("#" + secBtn.dataset.target);
          if (!detail) return;
          const willOpen = detail.hidden;
          detail.hidden = !willOpen;
          secBtn.textContent = willOpen ? "Скрыть статистику" : "Показать статистику";
        });
      }
    }

    // ------------------------------------------------------------ transforms
    function sortIndicatorHtml() {
      if (!sortKeys.length) return '<div class="udata__sort-status udata__sort-status--empty">Сортировка не задана.</div>';
      const items = sortKeys
        .map((k, i) => {
          const arrow = k.direction === "desc" ? "↓" : "↑";
          return `<span class="udata__sort-chip" title="${esc(k.column)}">${i + 1}. ${esc(k.column)} ${arrow}</span>`;
        })
        .join("");
      return `<div class="udata__sort-status">Сортировка: ${items}</div>`;
    }

    function renderTransform() {
      const p = panelEl();
      activateTab("udata-transform-btn");
      const colOptions = () =>
        columns
          .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
          .join("");
      const colSelect = (id, multiple) =>
        `<select id="${id}"${multiple ? ' multiple size="6"' : ""}>${colOptions()}</select>`;

      p.innerHTML = `
        <div class="udata__section-note">Операции применяются к рабочей копии данных последовательно. Исходный файл не изменяется; «Сбросить изменения» вернёт исходный датасет.</div>

        <div class="udata__block" id="udata-t-block">
          <div class="udata__block-title">Очистка</div>
          <div class="udata__block-row">
            <button type="button" class="btn" data-t="removeDuplicates">Удалить дубликаты строк</button>
            <button type="button" class="btn" data-t="removeEmptyRows">Удалить пустые строки</button>
            <button type="button" class="btn" data-t="removeEmptyColumns">Удалить пустые колонки</button>
          </div>
        </div>

        <div class="udata__block">
          <div class="udata__block-title">Колонки</div>
          <div class="udata__block-col">
            <label class="udata__field-label" for="udata-select-col">Оставить только выбранные</label>
            <div class="udata__block-row">
              ${colSelect("udata-select-col", true)}
              <button type="button" class="btn" id="udata-do-select">Оставить выбранные</button>
            </div>
          </div>
          <div class="udata__block-col">
            <label class="udata__field-label" for="udata-remove-col">Удалить выбранные колонки</label>
            <div class="udata__block-row">
              ${colSelect("udata-remove-col", true)}
              <button type="button" class="btn" id="udata-do-remove">Удалить выбранные</button>
            </div>
          </div>
        </div>

        <div class="udata__block">
          <div class="udata__block-title">Переименовать колонку</div>
          <div class="udata__block-row">
            ${colSelect("udata-rename-col", false)}
            <input type="text" id="udata-rename-new" placeholder="новое имя" autocomplete="off" />
            <button type="button" class="btn" id="udata-do-rename">Переименовать</button>
          </div>
        </div>

        <div class="udata__block">
          <div class="udata__block-title">Сортировка</div>
          ${sortIndicatorHtml()}
          <div class="udata__block-row">
            ${colSelect("udata-sort-col", false)}
            <select id="udata-sort-dir">
              <option value="asc">по возрастанию</option>
              <option value="desc">по убыванию</option>
            </select>
            <button type="button" class="btn" id="udata-do-sort">Сортировать</button>
          </div>
        </div>

        <div class="udata__block">
          <div class="udata__block-title">Фильтр строк</div>
          <div class="udata__block-row">
            ${colSelect("udata-filter-col", false)}
            <select id="udata-filter-op">
              <option value="eq">равно</option>
              <option value="ne">не равно</option>
              <option value="gt">&gt;</option>
              <option value="gte">&gt;=</option>
              <option value="lt">&lt;</option>
              <option value="lte">&lt;=</option>
              <option value="contains">содержит</option>
              <option value="notempty">не пусто</option>
              <option value="empty">пусто</option>
            </select>
            <input type="text" id="udata-filter-value" placeholder="значение" autocomplete="off" />
            <button type="button" class="btn" id="udata-do-filter">Применить фильтр</button>
          </div>
        </div>

        <div class="udata__msg" id="udata-t-msg" aria-live="polite"></div>
      `;

      const msg = p.querySelector("#udata-t-msg");
      const run = async (fn, label) => {
        msg.textContent = label + "…";
        try {
          const r = await fn();
          msg.textContent = `${label} готово: было ${fmtNum(r.rowCountBefore)} строк, стало ${fmtNum(r.rowCountAfter)}.`;
          renderTransform(); // re-render with updated columns
        } catch (e) {
          msg.textContent = "Ошибка: " + e.message;
        }
      };

      p.querySelectorAll("[data-t]").forEach((btn) =>
        btn.addEventListener("click", () =>
          run(() => postTransform({ type: btn.dataset.t }), btn.textContent.trim()),
        ),
      );

      p.querySelector("#udata-do-select").addEventListener("click", () => {
        const vals = selectedMulti(p, "#udata-select-col");
        if (vals.length) run(() => postTransform({ type: "selectColumns", columns: vals }), "Выбор колонок");
        else msg.textContent = "Не выбрано ни одной колонки.";
      });

      p.querySelector("#udata-do-remove").addEventListener("click", () => {
        const vals = selectedMulti(p, "#udata-remove-col");
        if (vals.length) run(() => postTransform({ type: "removeColumns", columns: vals }), "Удаление колонок");
        else msg.textContent = "Не выбрано ни одной колонки.";
      });

      p.querySelector("#udata-do-rename").addEventListener("click", () => {
        const col = p.querySelector("#udata-rename-col").value;
        const name = p.querySelector("#udata-rename-new").value.trim();
        if (!col || !name) {
          msg.textContent = "Укажите колонку и новое имя.";
          return;
        }
        run(() => postTransform({ type: "renameColumns", mapping: { [col]: name } }), "Переименование");
      });

      p.querySelector("#udata-do-sort").addEventListener("click", () => {
        const col = p.querySelector("#udata-sort-col").value;
        const dir = p.querySelector("#udata-sort-dir").value;
        sortKeys = S.toggleSort(sortKeys, col, dir);
        run(() => postTransform({ type: "sort", keys: sortKeys }), "Сортировка");
      });

      p.querySelector("#udata-do-filter").addEventListener("click", () => {
        const col = p.querySelector("#udata-filter-col").value;
        const op = p.querySelector("#udata-filter-op").value;
        const value = p.querySelector("#udata-filter-value").value;
        if (!col) {
          msg.textContent = "Выберите колонку.";
          return;
        }
        const cond = { column: col, op };
        if (op !== "empty" && op !== "notempty") {
          if (value.trim() === "") {
            msg.textContent = "Укажите значение фильтра.";
            return;
          }
          cond.value = value;
        }
        run(() => postTransform({ type: "filter", conditions: [cond] }), "Фильтр");
      });
    }

    function selectedMulti(p, sel) {
      const el = p.querySelector(sel);
      return [...el.selectedOptions].map((o) => o.value);
    }

    // ------------------------------------------------------ export / reset
    async function exportCsv() {
      try {
        const res = await fetch("/api/udata/export");
        if (!res.ok) throw new Error("HTTP " + res.status);
        const blob = await res.blob();
        const disposition = res.headers.get("Content-Disposition") || "";
        const m = disposition.match(/filename="?([^";]+)"?/);
        const filename = m ? m[1] : "analysis-result.csv";
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) {
        const p = panelEl();
        if (p) p.innerHTML = '<div class="empty">Ошибка выгрузки: ' + esc(e.message) + "</div>";
      }
    }

    async function resetDataset() {
      try {
        const res = await fetch("/api/udata/reset", { method: "POST" });
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error || "ошибка сброса");
        dataset = { ...dataset, rows: (await apiGet("/api/udata")).summary.rows };
        historyCount = 0;
        sortKeys = [];
        await loadColumns();
        renderWorkspace();
      } catch (e) {
        const p = panelEl();
        if (p) p.innerHTML = '<div class="empty">Ошибка: ' + esc(e.message) + "</div>";
      }
    }

    function closeDataset() {
      dataset = null;
      columns = [];
      originalColumns = [];
      historyCount = 0;
      fileName = null;
      sortKeys = [];
      renderUpload();
    }

    renderUpload();
    return { refresh: renderUpload };
  };
})();