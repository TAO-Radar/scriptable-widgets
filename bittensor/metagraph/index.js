// ============================
// Configuration
// ============================

const version = '0.1.9';
const widgetParameter = '';
const supportedFamilies = ['small', 'medium', 'large'];
const DEFAULT_API_CONFIG = {
  taoStatsBaseUrl: 'https://notaostats.taoradar.space/api',
  getTaoPriceUrl: 'https://api.binance.com/api/v3/ticker/price?symbol=TAOUSDT',
};

const RAO = 10 ** -9;

const ENV = {
  colors: {
    bg: new Color('#0E0E0E'),
    err: new Color('#ad4904'),
    gold: new Color('#FDE047'),
    white: Color.white(),
    cyan_green: new Color('#00c2a6'),
    cyan_green_sim: new Color('#00c2b6'),
    orange_pearl: new Color('#e88148'),
    gray: Color.gray(),
    forEvenRow: new Color('#74b9ff'),
    forNotEvenRow: new Color('#a29bfe'),
  },
  spacing: 4,
  part_spacing: 7,
  refreshInterval: 300000,
  fonts: {
    errorTitle: 20,
    totalLabel: 18,
    totalValue: 14,
    columnHeader: 13,
    neuronValue: 12,
    price: 11,
    priceLarge: 14,
    footer: 11,
    sync: 11,
    default: 12,
  },
  spacingValues: {
    errorSpacer: 10,
    bottomPanel: 2,
    uidStack: 3,
    priceToSync: 5,
    smallPricesSpacer: 7,
  },
  decimals: {
    default: 2,
    stake: {
      ALPHA: 1,
      TAO: 2,
      USD: 0,
    },
    daily: {
      ALPHA: 2,
      TAO: 2,
      USD: 2,
    },
    totalsCompact: {
      ALPHA: 0,
      TAO: 2,
      USD: 2,
    },
    totalsNormal: {
      ALPHA: 2,
      TAO: 2,
      USD: 2,
    },
  },
  separator: ' | ',
};

// Module-level API config.
let API_CONFIG = { ...DEFAULT_API_CONFIG };

/**
 * Create the metagraph widget
 * Supports template contract:
 * - params.netuid (required)
 * - params.search (required)
 * - params.currencies (optional)
 */
async function createWidget({
  params = {},
  debug = false,
  widgetFamily = 'large',
  apiProvider,
  loaderVersion,
  ...rest
} = {}) {
  const log = debug ? console.log.bind(console) : function () {};
  const normalizedParams =
    params && typeof params === 'object' && !Array.isArray(params) ? params : {};
  const runtimeInput = { ...rest, params: normalizedParams };
  log(JSON.stringify({ widgetFamily, apiProvider, loaderVersion, ...runtimeInput }, null, 2));

  // Use static defaults only.
  API_CONFIG = { ...DEFAULT_API_CONFIG };

  const netuidRaw =
    normalizedParams.netuid !== undefined ? normalizedParams.netuid : rest.netuid;
  const netuid = Number(netuidRaw);
  if (!Number.isFinite(netuid)) {
    return createErrorWidget('Missing required parameter: netuid');
  }
  const searchValue =
    typeof normalizedParams.search === 'string'
      ? normalizedParams.search
      : typeof rest.search === 'string'
        ? rest.search
        : '';
  const search = searchValue.trim();
  if (!search) {
    return createErrorWidget('Missing required parameter: search');
  }

  const settings = {
    netuid,
    search,
    currencies:
      Array.isArray(normalizedParams.currencies) && normalizedParams.currencies.length > 0
        ? normalizedParams.currencies
        : ['TAO'],
  };

  try {
    const prices = await fetchPrices(settings);
    const neurons = await fetchNeurons(settings, prices);
    neurons.sort((a, b) => parseInt(a.uid) - parseInt(b.uid));
    const totals = calculateTotals(neurons);
    const currencies = settings.currencies || ['TAO'];
    return createMetagraphWidget(neurons, prices, totals, currencies, widgetFamily, settings.netuid);
  } catch (error) {
    log('Error creating widget:', error);
    return createErrorWidget(`Error: ${error.message || 'Failed to load widget data'}`);
  }
}

async function launch(params = {}) {
  const runtimeConfig =
    params.config && typeof params.config === 'object'
      ? params.config
      : typeof config !== 'undefined' && config
        ? config
        : {};
  const initialParams =
    params.params && typeof params.params === 'object' && !Array.isArray(params.params)
      ? params.params
      : {};

  let normalizedParams = { ...initialParams };

  if (!runtimeConfig.runsInWidget) {
    const userInput = await promptForStandaloneInput({
      defaultNetuid:
        normalizedParams.netuid !== undefined ? String(normalizedParams.netuid) : '',
      defaultSearch:
        typeof normalizedParams.search === 'string' ? normalizedParams.search : '',
    });

    if (!userInput) {
      return null;
    }

    normalizedParams.netuid = userInput.netuid;
    normalizedParams.search = userInput.search;
  }

  const widget = await createWidget({
    debug: !!params.debug,
    apiProvider: typeof params.apiProvider === 'string' ? params.apiProvider : 'TaoStats',
    loaderVersion: typeof params.loaderVersion === 'string' ? params.loaderVersion : '',
    params: normalizedParams,
    ...normalizedParams,
    ...runtimeConfig,
  });

  if (runtimeConfig.runsInWidget) {
    Script.setWidget(widget);
  } else if ((runtimeConfig.widgetFamily || 'large') === 'small') {
    await widget.presentSmall();
  } else {
    await widget.presentLarge();
  }
  Script.complete();
  return widget;
}

async function promptForStandaloneInput({
  defaultNetuid = '',
  defaultSearch = '',
} = {}) {
  const alert = new Alert();
  alert.title = 'Metagraph Widget Input';
  alert.message = 'Direct run mode: provide netuid and search.';
  alert.addTextField('netuid (required)', String(defaultNetuid || ''));
  alert.addTextField('search (required)', String(defaultSearch || ''));
  alert.addAction('Run');
  alert.addCancelAction('Cancel');
  const selected = await alert.presentAlert();
  if (selected === -1) {
    return null;
  }

  const netuidRaw = alert.textFieldValue(0).trim();
  const search = alert.textFieldValue(1).trim();
  const netuid = Number(netuidRaw);
  if (!Number.isFinite(netuid)) {
    throw new Error('"netuid" must be a number.');
  }
  if (!search) {
    throw new Error('"search" is required for this widget.');
  }
  return { netuid, search };
}

// ============================
// Data Fetching
// ============================

async function fetchNeurons(settings, prices) {
  try {
    const allNeurons = await fetchMetagraphNeurons(settings);

    if (allNeurons.length === 0) {
      return [{ uid: 0, error: 'No neurons found for the provided search.' }];
    }

    return allNeurons.map((neuron) => mapBaseNeuron(neuron, prices));
  } catch (error) {
    console.error('Failed to fetch neurons:', error);
    return [{ uid: 0, error: 'Failed to process neuron data.' }];
  }
}

function mapBaseNeuron(neuron, prices) {
  const { alphaToTao, taoToUsdt } = prices;

  const dailyAlphaToken = parseFloat(neuron.daily_reward) * RAO;
  const stakeAlphaToken = parseFloat(neuron.alpha_stake) * RAO;
  const dailyTao = dailyAlphaToken * alphaToTao;
  const stakeTao = stakeAlphaToken * alphaToTao;
  const dailyUSD = dailyTao * taoToUsdt;
  const stakeUSD = stakeTao * taoToUsdt;

  return {
    uid: neuron.uid,
    dailyAlphaToken,
    stakeAlphaToken,
    dailyTao,
    stakeTao,
    dailyUSD,
    stakeUSD,
    _raw: neuron,
  };
}

function calculateTotals(neurons) {
  const initialTotals = {
    dailyTotalAlphaToken: 0,
    stakeTotalAlphaToken: 0,
    dailyTotalTao: 0,
    stakeTotalTao: 0,
    dailyTotalUSD: 0,
    stakeTotalUSD: 0
  };

  return neurons.reduce((acc, neuron) => {
    if (!neuron.error) {
      acc.dailyTotalAlphaToken += neuron.dailyAlphaToken;
      acc.stakeTotalAlphaToken += neuron.stakeAlphaToken;
      acc.dailyTotalTao += neuron.dailyTao;
      acc.stakeTotalTao += neuron.stakeTao;
      acc.dailyTotalUSD += neuron.dailyUSD;
      acc.stakeTotalUSD += neuron.stakeUSD;
    }
    return acc;
  }, initialTotals);
}

async function fetchMetagraphNeurons(settings) {
  try {
    const url = `${API_CONFIG.taoStatsBaseUrl}/metagraph/latest/v1?netuid=${settings.netuid}&search=${encodeURIComponent(settings.search)}&page=1`;
    const response = await new Request(url).loadJSON();
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  } catch (error) {
    console.error('Error fetching neuron data:', error);
    return [];
  }
}

async function fetchPrice(url) {
  try {
    const response = await new Request(url).loadJSON();
    return response;
  } catch (error) {
    console.error(`Error fetching price from ${url}:`, error);
    return null;
  }
}

async function fetchPrices(settings) {
  const prices = { 
    alphaToTao: -1, 
    taoToUsdt: -1,
    alphaSymbol: 'α', // Default fallback
    taoSymbol: 'τ'
  };

  const alphaResp = await fetchPrice(`${API_CONFIG.taoStatsBaseUrl}/dtao/pool/latest/v1?netuid=${settings.netuid}`);
  if (alphaResp && Array.isArray(alphaResp.data) && alphaResp.data.length > 0) {
    prices.alphaToTao = alphaResp.data[0].price;
    if (alphaResp.data[0].symbol) {
      prices.alphaSymbol = alphaResp.data[0].symbol;
    }
  }

  const taoResp = await fetchPrice(API_CONFIG.getTaoPriceUrl);
  if (taoResp && taoResp.price) {
    prices.taoToUsdt = taoResp.price;
  }

  return prices;
}

// ============================
// Widget Creation
// ============================

function getCurrencyConfig() {
  return {
    ALPHA: { symbol: (prices) => prices.alphaSymbol, color: ENV.colors.cyan_green_sim },
    TAO: { symbol: (prices) => prices.taoSymbol, color: ENV.colors.orange_pearl },
    USD: { symbol: () => '$', color: ENV.colors.gold }
  };
}

function formatValue(value, symbol, decimals = ENV.decimals.default) {
  return `${symbol}${value.toFixed(decimals)}`;
}

function formatValues(values, prices, currencies, config) {
  const parts = [];
  
  currencies.forEach(currency => {
    if (values[currency] !== undefined) {
      const cfg = getCurrencyConfig()[currency];
      const symbol = cfg.symbol(prices);
      const decimals = config.decimals[currency] || ENV.decimals.default;
      parts.push(formatValue(values[currency], symbol, decimals));
    }
  });
  return parts.join(config.separator || ENV.separator);
}

function formatTotals(type, totals, prices, currencies, compact = false) {
  const config = {
    decimals: compact ? ENV.decimals.totalsCompact : ENV.decimals.totalsNormal,
    separator: ENV.separator
  };

  const values = {
    ALPHA: type === 'stake' ? totals.stakeTotalAlphaToken : totals.dailyTotalAlphaToken,
    TAO: type === 'stake' ? totals.stakeTotalTao : totals.dailyTotalTao,
    USD: type === 'stake' ? totals.stakeTotalUSD : totals.dailyTotalUSD
  };

  return formatValues(values, prices, currencies, config);
}

function formatNeuronValues(type, neuron, prices, currencies) {
  const decimals = {
    stake: ENV.decimals.stake,
    daily: ENV.decimals.daily
  };

  const values = {
    stake: {
      ALPHA: neuron.stakeAlphaToken,
      TAO: neuron.stakeTao,
      USD: neuron.stakeUSD
    },
    daily: {
      ALPHA: neuron.dailyAlphaToken,
      TAO: neuron.dailyTao,
      USD: neuron.dailyUSD
    }
  };

  const valueConfig = values[type];
  const parts = [];
  
  currencies.forEach(currency => {
    if (valueConfig[currency] !== undefined) {
      const cfg = getCurrencyConfig()[currency];
      const symbol = cfg.symbol(prices);
      const decimal = decimals[type][currency] || ENV.decimals.default;
      parts.push(formatValue(valueConfig[currency], symbol, decimal));
    }
  });

  return parts.join(ENV.separator);
}

function createErrorWidget(message) {
  const widget = new ListWidget();
  widget.backgroundColor = ENV.colors.bg;

  const stack = widget.addStack();
  stack.layoutVertically();
  stack.centerAlignContent();

  addText(stack, '⚠️ Error', ENV.fonts.errorTitle, ENV.colors.err, true);
  stack.addSpacer(ENV.spacingValues.errorSpacer);
  
  const lines = message.split('\n');
  lines.forEach(line => {
    addText(stack, line, ENV.fonts.default, ENV.colors.gray);
  });

  return widget;
}

function createMetagraphWidget(neurons, prices, totals, currencies, widgetFamily = 'large', netuid) {
  const widget = new ListWidget();
  widget.backgroundColor = ENV.colors.bg;

  const frame = widget.addStack();
  frame.spacing = ENV.part_spacing;
  frame.layoutVertically();

  if (widgetFamily === 'small') {
    drawTotalStack(frame, totals, prices, currencies);
    drawPrices(frame, prices, false);
    drawFooterForSmall(frame, neurons);
  } else {
    const neuronsPanel = frame.addStack();
    const tableStacks = drawTableForLarge(neuronsPanel, netuid);
    drawNeuronsStatForLarge(neurons, tableStacks, prices, currencies);
    drawTotalStackToTable(tableStacks, totals, prices, currencies);

    const bottomPanel = frame.addStack();
    bottomPanel.layoutVertically();
    bottomPanel.addSpacer(ENV.spacingValues.bottomPanel);
    drawPrices(bottomPanel, prices, true);
    bottomPanel.addSpacer(ENV.spacingValues.priceToSync);
    drawTimeUpdated(bottomPanel);
  }

  widget.refreshAfterDate = new Date(Date.now() + ENV.refreshInterval);
  return widget;
}

function drawTotalStack(frame, totals, prices, currencies) {
  const rowStack = frame.addStack();
  rowStack.layoutHorizontally();

  const drawColumn = (title, type, size, titleSize) => {
    const col = rowStack.addStack();
    col.layoutVertically();
    addText(col, title, titleSize, ENV.colors.gray, true);
    
    // Use same colors as large widget: gold for stake, white for daily
    const valueColor = type === 'stake' ? ENV.colors.gold : ENV.colors.white;
    
    currencies.forEach(currency => {
      const cfg = getCurrencyConfig()[currency];
      const values = {
        stake: { ALPHA: totals.stakeTotalAlphaToken, TAO: totals.stakeTotalTao, USD: totals.stakeTotalUSD },
        daily: { ALPHA: totals.dailyTotalAlphaToken, TAO: totals.dailyTotalTao, USD: totals.dailyTotalUSD }
      };
      const value = values[type][currency];
      const symbol = cfg.symbol(prices);
      addText(col, formatValue(value, symbol), size, valueColor);
    });

    return col;
  };

  drawColumn('∑ Stake', 'stake', ENV.fonts.totalValue, ENV.fonts.totalLabel);
  rowStack.addSpacer();
  drawColumn('∑ Daily', 'daily', ENV.fonts.price, ENV.fonts.columnHeader);
}

function drawTotalStackToTable(stacks, totals, prices, currencies) {
  const [col0, col1, col2] = stacks;
  addText(col0, '∑ Total', ENV.fonts.neuronValue, ENV.colors.cyan_green_sim, true);
  addText(col1, formatTotals('stake', totals, prices, currencies, true), ENV.fonts.neuronValue, ENV.colors.gold, true);
  addText(col2, formatTotals('daily', totals, prices, currencies, true), ENV.fonts.neuronValue, ENV.colors.white, true);
}

function drawFooterForSmall(frame, neurons) {
  const bottomStack = frame.addStack();
  bottomStack.layoutVertically();

  const uidStack = bottomStack.addStack();
  uidStack.spacing = ENV.spacingValues.uidStack;
  uidStack.addSpacer();
  addText(uidStack, 'UIDs: ', ENV.fonts.footer, ENV.colors.gray, true);

  neurons.forEach(neuron => {
    const color = neuron.error ? ENV.colors.err : ENV.colors.cyan_green;
    addText(uidStack, `${neuron.uid}`, ENV.fonts.footer, color, true);
  });

  uidStack.addSpacer();
  drawTimeUpdated(bottomStack);
}

function drawTimeUpdated(stack) {
  const timeStack = stack.addStack();
  timeStack.addSpacer();
  
  addText(timeStack, 'Sync: ', ENV.fonts.sync, ENV.colors.gray);

  const date = timeStack.addDate(new Date());
  date.textColor = ENV.colors.gray;
  date.font = Font.systemFont(ENV.fonts.sync);
  date.applyTimeStyle();
  timeStack.addSpacer();
}

function drawPrices(frame, prices, isLarge = false) {
  const rowStack = frame.addStack();
  rowStack.layoutHorizontally();
  const spacer = isLarge ? null : ENV.spacingValues.smallPricesSpacer;
  const fontSize = isLarge ? ENV.fonts.priceLarge : ENV.fonts.price;

  const col1 = rowStack.addStack();
  col1.layoutVertically();
  addText(col1, `1${prices.taoSymbol} = `, fontSize, ENV.colors.cyan_green, true);
  rowStack.addSpacer(spacer);

  const col2 = rowStack.addStack();
  col2.layoutVertically();
  addText(col2, `${prices.alphaSymbol}${(1 / prices.alphaToTao).toFixed(ENV.decimals.default)}`, fontSize, ENV.colors.gold, true);
  rowStack.addSpacer(spacer);

  const col3 = rowStack.addStack();
  col3.layoutVertically();
  addText(col3, `$${parseFloat(prices.taoToUsdt).toFixed(ENV.decimals.default)}`, fontSize, ENV.colors.white, true);
}

function drawTableForLarge(frame, netuid) {
  const createColumn = (title, color) => {
    const stack = frame.addStack();
    stack.spacing = ENV.spacing;
    stack.layoutVertically();
    addText(stack, title, ENV.fonts.columnHeader, color, true);
    return stack;
  };

  const snTitle = netuid !== undefined ? `SN ${netuid}` : 'UIDs';
  const uidStack = createColumn(snTitle, ENV.colors.cyan_green);
  frame.addSpacer();
  const stakeStack = createColumn('Stake', ENV.colors.gold);
  frame.addSpacer();
  const dailyStack = createColumn('Daily', ENV.colors.white);

  return [uidStack, stakeStack, dailyStack];
}

function drawNeuronsStatForLarge(neurons, stacks, prices, currencies) {
  const [uidStack, stakeStack, dailyStack] = stacks;

  neurons.forEach((neuron, i) => {
    if (!neuron.error) {
      addText(uidStack, `UID ${neuron.uid}`, ENV.fonts.neuronValue, ENV.colors.cyan_green, true);
      addText(stakeStack, formatNeuronValues('stake', neuron, prices, currencies), ENV.fonts.neuronValue, ENV.colors.gold, true);
      addText(dailyStack, formatNeuronValues('daily', neuron, prices, currencies), ENV.fonts.neuronValue, ENV.colors.white, true);
    } else {
      addText(uidStack, `UID ${neuron.uid}: ${neuron.error}`, ENV.fonts.neuronValue, ENV.colors.err, true);
      addText(stakeStack, '-', ENV.fonts.neuronValue, ENV.colors.err, true);
      addText(dailyStack, '-', ENV.fonts.neuronValue, ENV.colors.err, true);
    }
  });
}

function addText(frame, text, size, color, isSemibold = false) {
  const textElement = frame.addText(text);
  textElement.font = isSemibold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  textElement.textColor = color;
}

module.exports = {
  version,
  widgetParameter,
  supportedFamilies,
  launch,
  createWidget
}

// Dev-only standalone entrypoint for Scriptable.
if (typeof Script !== 'undefined') {
  ;(async () => {
    try {
      await launch({
        config: typeof config !== 'undefined' ? config : {},
        args: typeof args !== 'undefined' ? args : {},
        debug: true,
      });
    } catch (error) {
      const errorWidget = createErrorWidget(`Error: ${error?.message || String(error)}`);
      Script.setWidget(errorWidget);
      await errorWidget.presentSmall();
      Script.complete();
    }
  })();
}