// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: code;
//@ts-check
/* global Alert, Color, FileManager, Font, ListWidget, Request, Script, args, config */

/**
 * TAO Radar Preset Portfolio Widget
 *
 * Displays per-address balances for a preset:
 * - Address (short)
 * - Total balance (TAO)
 * - 24hr change (TAO) = current - 24hr ago (can be negative)
 *
 * Works with TAO Radar loader (main.js).
 *
 * @author Gelloiss <gelloiss@gmail.com>
 */

/**
 * No single required widget parameter; use payload.params.
 */
const widgetParameter = "";
const supportedFamilies = ["small", "medium", "large"];

const ALLOWED_WIDGET_FAMILIES = ["small", "medium", "large"];

/** When `runsInWidget === true`, reject unsupported or missing `widgetFamily` before `createWidget`. */
function validateHostWidgetFamily(widgetFamilyRaw) {
  const norm = String(widgetFamilyRaw ?? "")
    .trim()
    .toLowerCase();
  if (!norm || ALLOWED_WIDGET_FAMILIES.indexOf(norm) === -1) {
    return "Missing or invalid widgetFamily from Scriptable. Expected: small, medium, or large.";
  }
  if (supportedFamilies.indexOf(norm) === -1) {
    return `This widget does not support "${norm}". Supported: ${supportedFamilies.join(", ")}.`;
  }
  return null;
}

// ============================
// API
// ============================
const TAO_STATS_ACCOUNT_URL = "https://api.taostats.io/api/account/latest/v1";
const TAO_PRICE_URL = "https://api.binance.com/api/v3/ticker/price?symbol=TAOUSDT";
const BALANCE_CACHE_FILE = "portfolio-balance-cache.json";
const CACHE_FRESH_MS = 5 * 60 * 1000; // 5 minute cache
const STALE_CACHE_MARKER = "⏱";

// IMPORTANT: header must stay EXACTLY as provided (not from variables)
const TAO_STATS_HEADERS = {
  Authorization: "tao-50da5cad-e47e-483f-9599-5b5ede062579:43b67b81",
  accept: "application/json",
};

// ============================
// UI ENV
// ============================
const ENV = {
  colors: {
    bg: new Color("#0E0E0E"),
    err: new Color("#ad4904"),
    gold: new Color("#FDE047"),
    white: Color.white(),
    cyan_green: new Color("#00c2a6"),
    gray: Color.gray(),
  },
  spacing: 4,
  part_spacing: 7,
  refreshInterval: 300000,
  spacingValues: {
    bottomPanel: 2,
    priceToSync: 5,
  },
  fonts: {
    errorTitle: 20,
    columnHeader: 13,
    value: 12,
    price: 11,
    priceLarge: 14,
    sync: 11,
    default: 12,
  },
  decimals: {
    price: 2,
  },
};

const RAO = 1e-9;
const VALID_CURRENCIES = ["TAO", "USD"];

// ============================
// Main widget function (CONTRACT)
// ============================

/**
 * Create the widget
 *
 * CONTRACT:
 * @param {Record<string, unknown>} input
 * @returns {Promise<ListWidget>}
 */
async function createWidget({
  params = {},
  debug: _debug = false,
  widgetFamily = "large",
  apiProvider,
  loaderVersion,
  ...rest
} = {}) {
  const normalizedParams = coercePlainParams(params);
  const { addresses, currencies } = resolvePortfolioLauncherArgs(normalizedParams, rest);

  if (addresses.length === 0) {
    return createErrorWidget(
      `Missing addresses.\n` +
        `Set "addresses" in payload.params or at the payload JSON root (array or comma/newline string).`
    );
  }

  try {
    let taoToUsd = null;
    try {
      taoToUsd = await fetchTaoUsdPrice();
    } catch (priceErr) {
      if (currencies.includes("USD")) {
        return createErrorWidget(
          `Error:\n${priceErr && priceErr.message ? priceErr.message : String(priceErr)}`
        );
      }
    }
    const rows = await fetchAllAccounts(addresses, taoToUsd);

    const widget = createPortfolioWidget(rows, widgetFamily, currencies, taoToUsd);
    widget.refreshAfterDate = new Date(Date.now() + ENV.refreshInterval);
    return widget;
  } catch (e) {
    return createErrorWidget(`Error:\n${e && e.message ? e.message : String(e)}`);
  }
}

/**
 * Standalone + launcher-friendly trigger.
 */
async function launch(params = {}) {
  const globalConfig = globalThis.config;
  const runtimeConfig =
    params.config && typeof params.config === "object"
      ? params.config
      : typeof globalConfig !== "undefined" && globalConfig
        ? globalConfig
        : {};

  let normalizedParams = { ...initialParamsFromLaunchRoot(params) };
  if (!runtimeConfig.runsInWidget) {
    const userInput = await promptForStandaloneInput({
      defaultAddresses:
        normalizedParams.addresses !== undefined ? String(normalizedParams.addresses) : "",
      defaultCurrencies:
        normalizedParams.currencies !== undefined ? String(normalizedParams.currencies) : "TAO",
    });
    if (!userInput) {
      return null;
    }
    normalizedParams.addresses = userInput.addresses;
    normalizedParams.currencies = userInput.currencies;
  }

  if (runtimeConfig.runsInWidget === true) {
    const familyErr = validateHostWidgetFamily(runtimeConfig.widgetFamily);
    if (familyErr) {
      const w = createErrorWidget(`Unsupported widget size\n${familyErr}`);
      Script.setWidget(w);
      Script.complete();
      return w;
    }
  }

  const widget = await createWidget({
    debug: !!params.debug,
    apiProvider: typeof params.apiProvider === "string" ? params.apiProvider : "TaoStats",
    loaderVersion: typeof params.loaderVersion === "string" ? params.loaderVersion : "",
    params: normalizedParams,
    ...normalizedParams,
    ...runtimeConfig,
  });

  if (runtimeConfig.runsInWidget) {
    Script.setWidget(widget);
  } else if ((runtimeConfig.widgetFamily || "large") === "small") {
    await widget.presentSmall();
  } else {
    await widget.presentLarge();
  }
  Script.complete();
  return widget;
}

async function promptForStandaloneInput({
  defaultAddresses = "",
  defaultCurrencies = "TAO",
} = {}) {
  const alert = new Alert();
  alert.title = "Portfolio Widget Input";
  alert.message =
    "Direct run mode: provide addresses and currencies.\nCurrencies: TAO, USD.";
  alert.addTextField("addresses (required)", String(defaultAddresses || ""));
  alert.addTextField("currencies (comma-separated)", String(defaultCurrencies || "TAO"));
  alert.addAction("Run");
  alert.addCancelAction("Cancel");
  const selected = await alert.presentAlert();
  if (selected === -1) {
    return null;
  }

  const addressesRaw = alert.textFieldValue(0).trim();
  const currenciesRaw = alert.textFieldValue(1).trim();
  const addresses = normalizeAddresses(addressesRaw);
  const currencies = normalizeCurrencies(
    currenciesRaw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
  );
  if (addresses.length === 0) {
    throw new Error('"addresses" is required for this widget.');
  }
  return { addresses, currencies };
}

// ============================
// Fetching
// ============================

async function fetchAccount(address) {
  const url =
    `${TAO_STATS_ACCOUNT_URL}` +
    `?address=${encodeURIComponent(address)}` +
    `&network=Finney&page=1&limit=50`;

  const req = new Request(url);
  req.method = "GET";
  req.headers = TAO_STATS_HEADERS;

  const data = await req.load();
  const status = req.response ? req.response.statusCode : 0;

  if (status !== 200) throw new Error(`taostats request failed (status: ${status})`);

  const json = JSON.parse(data.toRawString());
  if (!json || !Array.isArray(json.data)) throw new Error("Invalid taostats response (missing data).");
  return json.data[0] || null;
}

async function fetchTaoUsdPrice() {
  const req = new Request(TAO_PRICE_URL);
  req.method = "GET";
  const json = await req.loadJSON();
  const price = toNumber(json && json.price);
  if (!Number.isFinite(price)) {
    throw new Error("Failed to fetch TAO/USD price.");
  }
  return price;
}

async function fetchAllAccounts(addresses, taoToUsd) {
  const cachedBalancesByAddress = readCachedBalancesByAddress();
  const fetchOrder = buildAddressFetchOrder(addresses, cachedBalancesByAddress);
  const rowsByAddress = {};

  for (let i = 0; i < fetchOrder.length; i++) {
    const addr = fetchOrder[i];
    const cached = cachedBalancesByAddress[addr];
    const cachedAtMs = parseCachedAtMs(cached);
    if (Number.isFinite(cachedAtMs) && Date.now() - cachedAtMs < CACHE_FRESH_MS) {
      const rowFromFreshCache = buildRowFromCached(addr, cached, taoToUsd);
      if (rowFromFreshCache) {
        rowsByAddress[addr] = rowFromFreshCache;
        continue;
      }
    }
    try {
      const account = await fetchAccount(addr);
      if (!account) {
        rowsByAddress[addr] = {
          address: addr,
          totalBalance: null,
          change24h: null,
          totalBalanceUsd: null,
          change24hUsd: null,
          error: "No data for address",
        };
        continue;
      }

      const balanceTotal = toNumber(account.balance_total);
      const balanceTotal24 = toNumber(account.balance_total_24hr_ago);

      if (!Number.isFinite(balanceTotal) || !Number.isFinite(balanceTotal24)) {
        rowsByAddress[addr] = {
          address: addr,
          totalBalance: null,
          change24h: null,
          totalBalanceUsd: null,
          change24hUsd: null,
          error: "Invalid balance values",
        };
        continue;
      }

      const totalBalance = ceil2AwayFromZero(balanceTotal * RAO);
      const change24h = ceil2AwayFromZero((balanceTotal - balanceTotal24) * RAO);
      const totalBalanceUsd =
        Number.isFinite(taoToUsd) ? ceil2AwayFromZero(totalBalance * taoToUsd) : null;
      const change24hUsd =
        Number.isFinite(taoToUsd) ? ceil2AwayFromZero(change24h * taoToUsd) : null;

      rowsByAddress[addr] = { address: addr, totalBalance, change24h, totalBalanceUsd, change24hUsd };
      cachedBalancesByAddress[addr] = {
        totalBalance,
        change24h,
        cachedAt: new Date().toISOString(),
      };
    } catch (e) {
      const rowFromCachedFallback = buildRowFromCached(addr, cached, taoToUsd);
      if (rowFromCachedFallback) {
        rowsByAddress[addr] = { ...rowFromCachedFallback, isStaleCachedFallback: true };
        continue;
      }
      rowsByAddress[addr] = {
        address: addr,
        totalBalance: null,
        change24h: null,
        totalBalanceUsd: null,
        change24hUsd: null,
        error: e && e.message ? e.message : String(e),
      };
    }
  }

  writeCachedBalancesByAddress(cachedBalancesByAddress);
  return addresses.map((addr) => {
    if (rowsByAddress[addr]) return rowsByAddress[addr];
    return {
      address: addr,
      totalBalance: null,
      change24h: null,
      totalBalanceUsd: null,
      change24hUsd: null,
      error: "Unknown fetch result",
    };
  });
}

// ============================
// Rendering
// ============================

function createPortfolioWidget(rows, widgetFamily, currencies, taoToUsd) {
  const widget = new ListWidget();
  widget.backgroundColor = ENV.colors.bg;

  const frame = widget.addStack();
  frame.layoutVertically();
  frame.spacing = ENV.part_spacing;

  if (widgetFamily === "small") {
    drawSmall(frame, rows, currencies, taoToUsd);
  } else {
    drawTable(frame, rows, currencies);
    const bottomPanel = frame.addStack();
    bottomPanel.layoutVertically();
    bottomPanel.addSpacer(ENV.spacingValues.bottomPanel);
    drawTaoPriceRow(bottomPanel, taoToUsd, widgetFamily);
    bottomPanel.addSpacer(ENV.spacingValues.priceToSync);
    drawTimeUpdated(bottomPanel);
  }

  return widget;
}

function drawTable(frame, rows, currencies) {
  const table = frame.addStack();
  table.layoutHorizontally();
  table.centerAlignContent();

  const createColumn = (title, color) => {
    const stack = table.addStack();
    stack.layoutVertically();
    stack.spacing = ENV.spacing;
    addText(stack, title, ENV.fonts.columnHeader, color, true);
    return stack;
  };

  const colAddr = createColumn("Address", ENV.colors.white);
  table.addSpacer();
  const colTotal = createColumn("Balance", ENV.colors.white);
  table.addSpacer();
  const colDaily = createColumn("24hr Change", ENV.colors.white);

  rows.forEach((r) => {
    if (!r.error) {
      addText(
        colAddr,
        r.isStaleCachedFallback ? `${shortAddress(r.address)} ${STALE_CACHE_MARKER}` : shortAddress(r.address),
        ENV.fonts.value,
        ENV.colors.gray,
        true
      );
      addText(colTotal, formatValueByCurrencies(r, "total", currencies), ENV.fonts.value, ENV.colors.white, true);
      addText(
        colDaily,
        formatValueByCurrencies(r, "daily", currencies),
        ENV.fonts.value,
        dailyChangeColor(r, currencies),
        true
      );
    } else {
      addText(colAddr, `${shortAddress(r.address)} ⚠️`, ENV.fonts.value, ENV.colors.err, true);
      addText(colTotal, "-", ENV.fonts.value, ENV.colors.err, true);
      addText(colDaily, "-", ENV.fonts.value, ENV.colors.err, true);
    }
  });

  if (rows.length > 1) {
    const totals = calculatePortfolioTotals(rows);
    addText(colAddr, "∑ Total", ENV.fonts.value, ENV.colors.white, true);
    addText(colTotal, formatValueByCurrencies(totals, "total", currencies), ENV.fonts.value, ENV.colors.white, true);
    addText(
      colDaily,
      formatValueByCurrencies(totals, "daily", currencies),
      ENV.fonts.value,
      dailyChangeColor(totals, currencies),
      true
    );
  }
}

function drawSmall(frame, rows, currencies, taoToUsd) {
  const header = frame.addStack();
  header.layoutHorizontally();
  addText(header, "Address", ENV.fonts.columnHeader, ENV.colors.gray, true);
  header.addSpacer();
  addText(header, "Balance", ENV.fonts.columnHeader, ENV.colors.white, true);
  header.addSpacer();
  addText(header, "24hr Change", ENV.fonts.columnHeader, ENV.colors.gray, true);

  frame.addSpacer(6);

  rows.slice(0, 3).forEach((r) => {
    const row = frame.addStack();
    row.layoutHorizontally();

    const addrText = r.isStaleCachedFallback
      ? `${shortAddress(r.address)} ${STALE_CACHE_MARKER}`
      : shortAddress(r.address);
    addText(row, addrText, ENV.fonts.value, r.error ? ENV.colors.err : ENV.colors.gray, true);
    row.addSpacer();
    addText(
      row,
      r.error ? "-" : formatValueByCurrencies(r, "total", currencies),
      ENV.fonts.value,
      r.error ? ENV.colors.err : ENV.colors.white,
      true
    );
    row.addSpacer();
    addText(
      row,
      r.error ? "-" : formatValueByCurrencies(r, "daily", currencies),
      ENV.fonts.value,
      r.error ? ENV.colors.err : dailyChangeColor(r, currencies),
      true
    );
  });

  if (rows.length > 1) {
    frame.addSpacer(6);
    const totals = calculatePortfolioTotals(rows);
    const sumRow = frame.addStack();
    sumRow.layoutHorizontally();
    addText(sumRow, "∑ Total", ENV.fonts.value, ENV.colors.gray, true);
    sumRow.addSpacer();
    addText(
      sumRow,
      formatValueByCurrencies(totals, "total", currencies),
      ENV.fonts.value,
      ENV.colors.white,
      true
    );
    sumRow.addSpacer();
    addText(
      sumRow,
      formatValueByCurrencies(totals, "daily", currencies),
      ENV.fonts.value,
      dailyChangeColor(totals, currencies),
      true
    );
  }

  frame.addSpacer(6);
  drawTaoPriceRow(frame, taoToUsd, "small");
  frame.addSpacer(ENV.spacingValues.priceToSync);
  drawTimeUpdated(frame);
}

/**
 * Price strip: `TAO / USDT` + gap + `$…` + gap + empty column, wrapped so outer flex spacers
 * center the whole strip (TAO–USD price is not pinned to the trailing edge).
 */
function drawTaoPriceRow(frame, taoToUsd, widgetFamily) {
  const rowStack = frame.addStack();
  rowStack.layoutHorizontally();
  rowStack.centerAlignContent();
  const isLarge = widgetFamily !== "small";
  const fontSize = isLarge ? ENV.fonts.priceLarge : ENV.fonts.price;
  const decimals = ENV.decimals.price;
  const gap = ENV.spacing * 2;

  rowStack.addSpacer();

  const inner = rowStack.addStack();
  inner.layoutHorizontally();
  inner.centerAlignContent();

  const colPair = inner.addStack();
  colPair.layoutHorizontally();
  colPair.centerAlignContent();
  addText(colPair, "TAO", fontSize, ENV.colors.white, true);
  addText(colPair, " / ", fontSize, ENV.colors.gray, true);
  addText(colPair, "USDT", fontSize, ENV.colors.gray, true);

  inner.addSpacer(gap);

  const priceText =
    Number.isFinite(taoToUsd) && taoToUsd != null
      ? `$${parseFloat(String(taoToUsd)).toFixed(decimals)}`
      : "$--";
  addText(inner, priceText, fontSize, ENV.colors.white, true);

  inner.addSpacer(gap);

  const colEnd = inner.addStack();
  colEnd.layoutVertically();

  rowStack.addSpacer();
}

function createErrorWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = ENV.colors.bg;

  const stack = widget.addStack();
  stack.layoutVertically();
  stack.centerAlignContent();

  addText(stack, "⚠️ Error", ENV.fonts.errorTitle, ENV.colors.err, true, 1);
  stack.addSpacer(10);

  String(message)
    .split("\n")
    .forEach((line) => addText(stack, line || " ", ENV.fonts.default, ENV.colors.gray, false, 12));

  return widget;
}

function drawTimeUpdated(stack) {
  const timeStack = stack.addStack();
  timeStack.addSpacer();
  addText(timeStack, "Sync: ", ENV.fonts.sync, ENV.colors.gray);

  const date = timeStack.addDate(new Date());
  date.textColor = ENV.colors.gray;
  date.font = Font.systemFont(ENV.fonts.sync);
  date.applyTimeStyle();

  timeStack.addSpacer();
}

/** @param {number} [lineLimit] Max lines for this text (default 1). */
function addText(frame, text, size, color, isSemibold = false, lineLimit = 1) {
  const t = frame.addText(String(text));
  t.font = isSemibold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = lineLimit;
}

// ============================
// Helpers
// ============================

function shortAddress(addr) {
  const s = String(addr || "");
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}...${s.slice(-6)}`;
}

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * "Round up" to 2 decimals away from zero.
 * -  1.231 ->  1.24
 * - -1.231 -> -1.24
 */
function ceil2AwayFromZero(x) {
  if (!Number.isFinite(x)) return NaN;
  const sign = x < 0 ? -1 : 1;
  return sign * (Math.ceil(Math.abs(x) * 100) / 100);
}

function format2(n) {
  if (!Number.isFinite(n)) return "-";
  return n.toFixed(2);
}

/**
 * @param {boolean} magnitudeOnly — for 24hr change: absolute value only; direction is shown via text color.
 */
function formatCurrencyValue(value, currency, magnitudeOnly = false) {
  if (!Number.isFinite(value)) return "-";
  const num = magnitudeOnly ? format2(Math.abs(value)) : format2(value);
  if (currency === "USD") {
    return `$${num}`;
  }
  return `τ${num}`;
}

function formatValueByCurrencies(row, type, currencies) {
  const parts = [];
  const isDaily = type === "daily";
  for (const currency of currencies) {
    if (currency === "TAO") {
      parts.push(
        formatCurrencyValue(
          isDaily ? row.change24h : row.totalBalance,
          "TAO",
          isDaily
        )
      );
    } else if (currency === "USD") {
      parts.push(
        formatCurrencyValue(
          isDaily ? row.change24hUsd : row.totalBalanceUsd,
          "USD",
          isDaily
        )
      );
    }
  }
  return parts.length > 0 ? parts.join(" | ") : "-";
}

/** PnL used for color: first finite change in `currencies` order. */
function pnlPrimaryChange(row, currencies) {
  if (row && row.error) return NaN;
  for (const c of currencies) {
    if (c === "TAO" && Number.isFinite(row.change24h)) return row.change24h;
    if (c === "USD" && Number.isFinite(row.change24hUsd)) return row.change24hUsd;
  }
  if (Number.isFinite(row.change24h)) return row.change24h;
  if (Number.isFinite(row.change24hUsd)) return row.change24hUsd;
  return NaN;
}

/** Cyan when primary PnL is positive; error red otherwise (including zero, negative, or missing). */
function dailyChangeColor(row, currencies) {
  if (row && row.error) return ENV.colors.err;
  const v = pnlPrimaryChange(row, currencies);
  if (!Number.isFinite(v)) return ENV.colors.err;
  return v > 0 ? ENV.colors.cyan_green : ENV.colors.err;
}

/** Sums balances across non-error rows (all configured addresses). */
function calculatePortfolioTotals(rows) {
  let totalBalance = 0;
  let change24h = 0;
  let totalBalanceUsd = 0;
  let change24hUsd = 0;
  let anyTaoBalance = false;
  let anyTaoDaily = false;
  let anyUsdBalance = false;
  let anyUsdDaily = false;

  for (const r of rows) {
    if (r.error) continue;
    if (Number.isFinite(r.totalBalance)) {
      totalBalance += r.totalBalance;
      anyTaoBalance = true;
    }
    if (Number.isFinite(r.change24h)) {
      change24h += r.change24h;
      anyTaoDaily = true;
    }
    if (Number.isFinite(r.totalBalanceUsd)) {
      totalBalanceUsd += r.totalBalanceUsd;
      anyUsdBalance = true;
    }
    if (Number.isFinite(r.change24hUsd)) {
      change24hUsd += r.change24hUsd;
      anyUsdDaily = true;
    }
  }

  return {
    totalBalance: anyTaoBalance ? totalBalance : NaN,
    change24h: anyTaoDaily ? change24h : NaN,
    totalBalanceUsd: anyUsdBalance ? totalBalanceUsd : NaN,
    change24hUsd: anyUsdDaily ? change24hUsd : NaN,
  };
}

function coercePlainParams(value) {
  if (value == null) {
    return {};
  }
  if (typeof value === "string") {
    const t = value.trim();
    if (!t) {
      return {};
    }
    try {
      const p = JSON.parse(t);
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return /** @type {Record<string, unknown>} */ (p);
      }
    } catch (_) {}
    return {};
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }
  return {};
}

const LAUNCH_ROOT_META = new Set([
  "widgetParameter",
  "fileURLs",
  "queryParameters",
  "when",
  "params",
]);

/** When portfolio.js is the Script entry (not the loader), merge `config.params`, `args`, and `params.params`. */
function initialParamsFromLaunchRoot(root) {
  const r = root && typeof root === "object" ? root : {};
  const fromParams = coercePlainParams(r.params);
  const args =
    r.args && typeof r.args === "object" && !Array.isArray(r.args) ? r.args : {};
  const fromArgsParams = coercePlainParams(args.params);
  const fromArgsRoot = /** @type {Record<string, unknown>} */ ({});
  for (const k of Object.keys(args)) {
    if (LAUNCH_ROOT_META.has(k)) continue;
    fromArgsRoot[k] = args[k];
  }
  const cfg =
    r.config && typeof r.config === "object" && !Array.isArray(r.config) ? r.config : {};
  const fromConfigParams = coercePlainParams(cfg.params);
  return { ...fromConfigParams, ...fromArgsParams, ...fromArgsRoot, ...fromParams };
}

/**
 * Launcher may pass payload fields in `params`, flattened on `rest`, or only under `rest.params`
 * (Scriptable config). Prefer the first source that yields real addresses / currencies.
 */
function resolvePortfolioLauncherArgs(normalizedParams, rest) {
  const nested = coercePlainParams(rest.params);

  let addresses = [];
  for (const candidate of [normalizedParams.addresses, rest.addresses, nested.addresses]) {
    const next = normalizeAddresses(candidate);
    if (next.length > 0) {
      addresses = next;
      break;
    }
  }

  let currencies = null;
  for (const candidate of [normalizedParams.currencies, rest.currencies, nested.currencies]) {
    if (candidate === undefined) continue;
    if (Array.isArray(candidate) && candidate.length === 0) continue;
    if (typeof candidate === "string" && !String(candidate).trim()) continue;
    currencies = normalizeCurrencies(candidate);
    break;
  }
  if (!currencies) {
    currencies = normalizeCurrencies(undefined);
  }

  return { addresses, currencies };
}

function normalizeAddresses(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
      )
    );
  }
  if (typeof value === "string") {
    return Array.from(
      new Set(
        value
          .split(/[\n,]/)
          .map((entry) => entry.trim())
          .filter(Boolean)
      )
    );
  }
  return [];
}

function normalizeCurrencies(value) {
  const source = Array.isArray(value) ? value : ["TAO"];
  const filtered = source
    .map((entry) => String(entry || "").trim().toUpperCase())
    .filter((entry) => VALID_CURRENCIES.includes(entry));
  const orderedUnique = [];
  for (const currency of filtered) {
    if (!orderedUnique.includes(currency)) {
      orderedUnique.push(currency);
    }
  }
  return orderedUnique.length > 0 ? orderedUnique : ["TAO"];
}

function portfolioCacheFilePath() {
  try {
    // @ts-ignore Scriptable global
    const fm = FileManager.local();
    const runtimeModule = typeof module !== "undefined" ? /** @type {any} */ (module) : null;
    if (runtimeModule && typeof runtimeModule.filename === "string") {
      const scriptPath = runtimeModule.filename;
      const scriptDir = scriptPath.replace(fm.fileName(scriptPath, true), "");
      if (scriptDir) {
        return fm.joinPath(scriptDir, BALANCE_CACHE_FILE);
      }
    }
    // Fallback for runtimes where module.filename is unavailable.
    return fm.joinPath(fm.documentsDirectory(), BALANCE_CACHE_FILE);
  } catch (_) {
    return null;
  }
}

function readCachedBalancesByAddress() {
  const path = portfolioCacheFilePath();
  if (!path) return {};
  try {
    // @ts-ignore Scriptable global
    const fm = FileManager.local();
    if (!fm.fileExists(path)) return {};
    const raw = fm.readString(path);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed;
  } catch (_) {
    return {};
  }
}

function writeCachedBalancesByAddress(cacheObj) {
  const path = portfolioCacheFilePath();
  if (!path) return;
  try {
    // @ts-ignore Scriptable global
    const fm = FileManager.local();
    fm.writeString(path, JSON.stringify(cacheObj));
  } catch (_) {
    // ignore cache write failures
  }
}

function buildAddressFetchOrder(addresses, cachedBalancesByAddress) {
  const ranked = addresses.map((address, index) => {
    const cached = cachedBalancesByAddress[address];
    if (!cached || typeof cached !== "object") {
      return { address, index, priority: 0, cachedAtMs: Number.POSITIVE_INFINITY };
    }
    const cachedAtMs = Date.parse(String(cached.cachedAt || ""));
    return {
      address,
      index,
      priority: 1,
      cachedAtMs: Number.isFinite(cachedAtMs) ? cachedAtMs : Number.NEGATIVE_INFINITY,
    };
  });

  ranked.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.cachedAtMs !== b.cachedAtMs) return a.cachedAtMs - b.cachedAtMs;
    return a.index - b.index;
  });

  return ranked.map((entry) => entry.address);
}

function parseCachedAtMs(cached) {
  if (!cached || typeof cached !== "object") return NaN;
  const cachedAtMs = Date.parse(String(cached.cachedAt || ""));
  return Number.isFinite(cachedAtMs) ? cachedAtMs : NaN;
}

function buildRowFromCached(address, cached, taoToUsd) {
  if (!cached || !Number.isFinite(cached.totalBalance) || !Number.isFinite(cached.change24h)) {
    return null;
  }
  const totalBalanceUsd =
    Number.isFinite(taoToUsd) ? ceil2AwayFromZero(cached.totalBalance * taoToUsd) : null;
  const change24hUsd =
    Number.isFinite(taoToUsd) ? ceil2AwayFromZero(cached.change24h * taoToUsd) : null;
  return {
    address,
    totalBalance: cached.totalBalance,
    change24h: cached.change24h,
    totalBalanceUsd,
    change24hUsd,
  };
}

// ============================
// Required exports (loader compatible)
// ============================

module.exports = {
  widgetParameter,
  supportedFamilies,
  launch,
  createWidget,
};

// Dev-only standalone entrypoint for Scriptable.
if (typeof Script !== "undefined") {
  ;(async () => {
    try {
      const globalConfig = globalThis.config;
      const globalArgs = globalThis.args;
      await launch({
        config: typeof globalConfig !== "undefined" ? globalConfig : {},
        args: typeof globalArgs !== "undefined" ? globalArgs : {},
        debug: false,
      });
    } catch (error) {
      const errorWidget = createErrorWidget(`Error: ${error?.message || String(error)}`);
      Script.setWidget(errorWidget);
      await errorWidget.presentSmall();
      Script.complete();
    }
  })();
}