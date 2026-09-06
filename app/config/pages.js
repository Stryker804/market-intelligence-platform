"use strict";

/**
 * PAGE CONFIGURATION — the site-builder.
 *
 * Pages are described here declaratively: page -> sections -> widgets.
 * Changing the dashboard layout / texts / widget order requires editing only
 * this file — no core changes.
 *
 * Widget types (frontend/js/widgets.js):
 *   kpi           small stat card
 *   table         data table with columns
 *   chart         line chart (history)
 *   source-status source availability table
 *   filter        client-side filter inputs (markets table)
 *   search-item   item search box (sets current item context)
 *   item-detail   detail table of the selected item
*   history-stats price dynamics summary (trend) of the selected item
 *   opportunities-thresholds informational panel
 *
 * Universal Data ("udata") is rendered by a dedicated self-contained widget;
 * it is an isolated consumer-facing data module and does not touch the
 * market pipeline.
 */

const PAGES = {
  dashboard: {
    title: "Dashboard",
    description: "Обзор рынка и возможностей",
    icon: "📊",
    sections: [
      {
        title: "Обзор",
        columns: 3,
        widgets: [
          { type: "kpi", title: "Предметов", source: "/api/stats", valueKey: "items", settings: { suffix: "" } },
          { type: "kpi", title: "С ценами Steam", source: "/api/stats", valueKey: "withSteam", settings: { suffix: "" } },
          { type: "kpi", title: "Возможностей", source: "/api/stats", valueKey: "opportunities", settings: { suffix: "" } },
        ],
      },
      {
        title: "Статус источников",
        columns: 1,
        widgets: [{ type: "source-status", title: "Sources" }],
      },
      {
        title: "Топ возможностей",
        columns: 1,
        widgets: [
          {
            type: "table",
            title: "LootFarm → Steam",
            source: "/api/arbitrage",
            params: { limit: 10 },
            columns: [
              { key: "itemName", label: "Предмет", width: "auto" },
              { key: "entryPriceRub", label: "Покупка, ₽", format: "currency" },
              { key: "sellerReceivesRub", label: "На руки, ₽", format: "currency" },
              { key: "roi", label: "ROI %", format: "percent2" },
              { key: "netProfit", label: "Прибыль, ₽", format: "currency" },
              { key: "score", label: "Скор", format: "int" },
            ],
          },
        ],
      },
    ],
  },

  markets: {
    title: "Рынки",
    description: "Сравнение цен предметов между источниками",
    icon: "📈",
    sections: [
      {
        title: "Фильтры",
        columns: 1,
        widgets: [{ type: "filter", title: "Фильтр" }],
      },
      {
        title: "Сводная таблица",
        columns: 1,
        widgets: [
          {
            type: "table",
            title: "Предметы (LootFarm + Steam)",
            source: "/api/markets",
            params: { limit: 5000 },
            rowLink: "identityKey",
            columns: [
              { key: "itemName", label: "Предмет", width: "auto" },
              { key: "exterior", label: "Экстерьер", sortable: false },
              { key: "category", label: "Категория", sortable: false },
              { key: "lootfarmBuy", label: "LootFarm ₽", format: "currency" },
              { key: "steamSell", label: "Steam SELL ₽", format: "currency" },
              { key: "steamBuy", label: "Steam BID ₽", format: "currency" },
              { key: "marketSpreadExitPct", label: "Спред vs BID, %", format: "percent2" },
              { key: "marketVsSellPct", label: "Спред vs SELL, %", format: "percent2" },
            ],
          },
        ],
      },
    ],
  },

  arbitrage: {
    title: "Арбитраж",
    description: "Возможности: покупка на площадке → продажа в Steam",
    icon: "💰",
    sections: [
      {
        title: "Параметры стратегии",
        columns: 1,
        widgets: [{ type: "thresholds", title: "Пороговые условия" }],
      },
      {
        title: "Возможности",
        columns: 1,
        widgets: [
          {
            type: "table",
            title: "LootFarm → Steam (с учётом комиссий Steam)",
            source: "/api/arbitrage",
            params: { limit: 200 },
            columns: [
              { key: "itemName", label: "Предмет", width: "auto" },
              { key: "entryPriceRub", label: "Покупка ₽", format: "currency" },
              { key: "sellerReceivesRub", label: "Получено ₽", format: "currency" },
              { key: "roi", label: "ROI %", format: "percent2" },
              { key: "netProfit", label: "Прибыль ₽", format: "currency" },
              { key: "liquidity.money", label: "Ликв., ₽", format: "currency" },
              { key: "score", label: "Скор", format: "int" },
            ],
          },
        ],
      },
    ],
  },

  history: {
    title: "История",
    description: "История цен предмета по источникам",
    icon: "🕓",
    sections: [
      {
        title: "Выбор предмета",
        columns: 1,
        widgets: [{ type: "search-item", title: "Поиск предмета" }],
      },
      {
        title: "Детали",
        columns: 1,
        widgets: [{ type: "item-detail", title: "Текущие цены" }],
      },
      {
        title: "Тренд",
        columns: 1,
        widgets: [{ type: "history-stats", title: "Динамика цены" }],
      },
      {
        title: "График",
        columns: 1,
        widgets: [
          {
            type: "chart",
            title: "История цен",
            source: "/api/items/",
            settings: { series: ["sources.lootfarm.priceRub", "sources.steam.sellRub", "sources.steam.buyRub"] },
          },
        ],
      },
    ],
  },

  sources: {
    title: "Источники",
    description: "Состояние источников данных",
    icon: "🛰",
    sections: [
      {
        title: "Статус",
        columns: 1,
        widgets: [{ type: "source-status", title: "Источники", detailed: true }],
      },
      {
        title: "О контрактах",
        columns: 1,
        widgets: [
          {
            type: "panel",
            title: "Защита от изменения API",
            html: "<p>Каждый источник изолирован в <code>sources/&lt;name&gt;/</code> (fetch → parser → normalizer). Внутренняя каноническая модель <code>ItemMarketSnapshot</code> стабильна: изменение внешнего API требует правки только адаптера источника.</p><p>Steam prices: minor units / 100, региональная валюта определяется по <code>eCurrency</code>. LootFarm: USD-центы каталога fullprice.json. RustSkins: GraphQL (steamItemMarketSummary) — в данной среде заблокирован Cloudflare, статус SOURCE_UNAVAILABLE.</p>",
            collapsible: true,
          },
        ],
      },
    ],
  },

  config: {
    title: "Конфигурация",
    description: "Текущие настройки системы",
    icon: "⚙️",
    sections: [
      {
        title: "Параметры",
        columns: 1,
        widgets: [
          {
            type: "config-json",
            title: "Конфигурация",
            source: "/api/config",
          },
        ],
      },
    ],
  },

  udata: {
    title: "Данные",
    description: "Загрузка, анализ и преобразование собственных таблиц (CSV)",
    icon: "📋",
    sections: [
      {
        title: "Работа с таблицей",
        columns: 1,
        widgets: [{ type: "udata", title: "Universal Data" }],
      },
    ],
  },
};

module.exports = { PAGES };