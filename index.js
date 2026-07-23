"use strict";

// ---------------------------------------------------------------
// BACKEND URL
// Apne deployed Render backend ka URL yahan paste karein.
// URL ke last mein slash "/" nahi hona chahiye.
//
// Example:
// const BACKEND_URL = "https://mcx-live-backend.onrender.com";
// ---------------------------------------------------------------

const BACKEND_URL = "https://maketb.onrender.com";

// ---------------------------------------------------------------
// DOM ELEMENTS
// ---------------------------------------------------------------

const symbolHeading = document.getElementById("symbolHeading");
const tokenSubheading = document.getElementById("tokenSubheading");

const ltpElement = document.getElementById("ltp");
const openPriceElement = document.getElementById("openPrice");
const highPriceElement = document.getElementById("highPrice");
const lowPriceElement = document.getElementById("lowPrice");
const lastTickTimeElement = document.getElementById("lastTickTime");

const connectionStatusElement =
  document.getElementById("connectionStatus");

const statusTextElement = document.getElementById("statusText");
const tickTableBody = document.getElementById("tickTableBody");
const chartContainer = document.getElementById("chart");
const timeframeSelect = document.getElementById("timeframeSelect");

// ---------------------------------------------------------------
// SOCKET.IO CONNECTION
// ---------------------------------------------------------------

const socket = io(BACKEND_URL, {
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
});

// ---------------------------------------------------------------
// FETCH SYMBOL AND TOKEN FROM BACKEND
// ---------------------------------------------------------------

async function loadBackendConfig() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/config`);

    if (!response.ok) {
      throw new Error(`Config request failed: ${response.status}`);
    }

    const config = await response.json();

    // symbolHeading.textContent = config.symbol || "Unknown Symbol";

    // tokenSubheading.textContent =
    //   `MCX live market data | Token: ${config.token || "--"}`;
    currentSymbol = config.symbol || null ;
    currentToken = String(config.token || "");

    symbolHeading.textContent = currentSymbol || "Unknown Symbol";

    tokenSubheading.textContent =
      `MCX live market data | Token: ${currentToken || "--"}`;
  } catch (error) {
    symbolHeading.textContent = "Config unavailable";

    tokenSubheading.textContent =
      "Backend configuration could not be loaded";

    console.error("Failed to fetch /api/config:", error);
  }
}

loadBackendConfig();




// ---------------------------------------------------------------
// CHART INITIALIZATION
// ---------------------------------------------------------------

const chart = LightweightCharts.createChart(chartContainer, {
  width: chartContainer.clientWidth,
  height: getChartHeight(),

  layout: {
    background: {
      type: "solid",
      color: "#111827",
    },
    textColor: "#cbd5e1",
  },

  grid: {
    vertLines: {
      color: "#1e293b",
    },
    horzLines: {
      color: "#1e293b",
    },
  },

  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal,
  },

  rightPriceScale: {
    borderColor: "#334155",
  },

  timeScale: {
    borderColor: "#334155",
    timeVisible: true,
    secondsVisible: false,
  },
});

// Lightweight Charts version 5 syntax
const candleSeries = chart.addSeries(
  LightweightCharts.CandlestickSeries,
  {
    upColor: "#22c55e",
    downColor: "#ef4444",
    borderVisible: false,
    wickUpColor: "#22c55e",
    wickDownColor: "#ef4444",

    priceFormat: {
      type: "price",
      precision: 2,
      minMove: 0.01,
    },
  },
);

// ---------------------------------------------------------------
// TIMEFRAME CONFIGURATION
// ---------------------------------------------------------------

const TIMEFRAME_SECONDS = {
  "15s": 15,
  "30s": 30,
  "45s": 45,

  "1m": 60,
  "2m": 120,
  "3m": 180,
  "4m": 240,
  "5m": 300,
  "10m": 600,
  "15m": 900,
  "30m": 1800,
  "75m": 4500,
  "125m": 7500,

  "1h": 3600,
  "2h": 7200,
  "3h": 10800,
  "4h": 14400,

  "1d": 86400,
  "1w": 604800,
};

let currentTimeframe = timeframeSelect.value;

let currentSymbol = null;
let currentToken = null;

const tickHistory = [];

let currentCandle = null;
let previousLtp = null;
let receivedTicks = 0;

// ---------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------

function getChartHeight() {
  if (window.innerWidth <= 600) {
    return 420;
  }

  if (window.innerWidth <= 1000) {
    return 500;
  }

  return 600;
}

function getBucketTimestamp(timestamp, timeframe) {
  const numericTimestamp = Number(timestamp);

  if (!Number.isFinite(numericTimestamp)) {
    return null;
  }

  if (timeframe === "1mo") {
    const date = new Date(numericTimestamp * 1000);

    date.setDate(1);
    date.setHours(0, 0, 0, 0);

    return Math.floor(date.getTime() / 1000);
  }

  const intervalSeconds = TIMEFRAME_SECONDS[timeframe] || 60;

  return (
    Math.floor(numericTimestamp / intervalSeconds) *
    intervalSeconds
  );
}

function formatPrice(price) {
  const numericPrice = Number(price);

  if (!Number.isFinite(numericPrice)) {
    return "--";
  }

  return numericPrice.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function escapeHtml(value) {
  return String(value ?? "--")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateConnectionStatus(status, message) {
  connectionStatusElement.className = `status ${status}`;
  statusTextElement.textContent = message;
}

function updateLtpColor(currentPrice) {
  ltpElement.classList.remove(
    "price-up",
    "price-down",
    "price-neutral",
  );

  if (previousLtp === null) {
    ltpElement.classList.add("price-neutral");
  } else if (currentPrice > previousLtp) {
    ltpElement.classList.add("price-up");
  } else if (currentPrice < previousLtp) {
    ltpElement.classList.add("price-down");
  } else {
    ltpElement.classList.add("price-neutral");
  }

  previousLtp = currentPrice;
}

function updateCurrentCandleCards() {
  if (!currentCandle) {
    openPriceElement.textContent = "--";
    highPriceElement.textContent = "--";
    lowPriceElement.textContent = "--";

    return;
  }

  openPriceElement.textContent = formatPrice(currentCandle.open);
  highPriceElement.textContent = formatPrice(currentCandle.high);
  lowPriceElement.textContent = formatPrice(currentCandle.low);
}

async function loadStoredCandles() {
  if (!currentSymbol || !currentToken) {
    console.warn("Symbol or token missing");
    return;
  }

  try {
    const params = new URLSearchParams({
      symbol: currentSymbol,
      token: currentToken,
      interval: currentTimeframe,
      limit: "1000",
    });

    const url = `${BACKEND_URL}/api/candles?${params.toString()}`;

    console.log("Fetching stored candles:", url);

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(
        `Candles request failed: ${response.status}`,
      );
    }

    const result = await response.json();

    console.log("Stored candles response:", result);

    const storedCandles = Array.isArray(result.data)
      ? result.data
      : [];

    const chartCandles = storedCandles
      .map((candle) => {
        const rawTime =
          candle.time ??
          candle.timestamp ??
          candle.datetime;

        let time;

        if (typeof rawTime === "number") {
          time =
            rawTime > 9999999999
              ? Math.floor(rawTime / 1000)
              : rawTime;
        } else {
          time = Math.floor(
            new Date(rawTime).getTime() / 1000,
          );
        }

        return {
          time,
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
        };
      })
      .filter(
        (candle) =>
          Number.isFinite(candle.time) &&
          Number.isFinite(candle.open) &&
          Number.isFinite(candle.high) &&
          Number.isFinite(candle.low) &&
          Number.isFinite(candle.close),
      )
      .sort((a, b) => a.time - b.time);

    candleSeries.setData(chartCandles);

    currentCandle =
      chartCandles.length > 0
        ? chartCandles[chartCandles.length - 1]
        : null;

    updateCurrentCandleCards();

    console.log(
      "Stored candles loaded:",
      chartCandles.length,
    );

    if (chartCandles.length > 0) {
      chart.timeScale().fitContent();
    }
  } catch (error) {
    console.error(
      "Failed to load stored candles:",
      error,
    );
  }
}

// ---------------------------------------------------------------
// CANDLE FUNCTIONS
// ---------------------------------------------------------------

function updateCandle(tick) {
  const price = Number(tick.ltp);
  const timestamp = Number(tick.timestamp);

  if (!Number.isFinite(price) || !Number.isFinite(timestamp)) {
    console.warn("Invalid tick received:", tick);
    return;
  }

  const bucketTimestamp = getBucketTimestamp(
    timestamp,
    currentTimeframe,
  );

  if (bucketTimestamp === null) {
    return;
  }

  if (
    currentCandle === null ||
    currentCandle.time !== bucketTimestamp
  ) {
    currentCandle = {
      time: bucketTimestamp,
      open: price,
      high: price,
      low: price,
      close: price,
    };
  } else {
    currentCandle.high = Math.max(currentCandle.high, price);
    currentCandle.low = Math.min(currentCandle.low, price);
    currentCandle.close = price;
  }

  candleSeries.update(currentCandle);

  updateCurrentCandleCards();
}

function rebuildCandlesFromHistory() {
  const candleMap = new Map();

  for (const tick of tickHistory) {
    const timestamp = Number(tick.timestamp);
    const price = Number(tick.ltp);

    if (!Number.isFinite(timestamp) || !Number.isFinite(price)) {
      continue;
    }

    const bucketTimestamp = getBucketTimestamp(
      timestamp,
      currentTimeframe,
    );

    if (bucketTimestamp === null) {
      continue;
    }

    if (!candleMap.has(bucketTimestamp)) {
      candleMap.set(bucketTimestamp, {
        time: bucketTimestamp,
        open: price,
        high: price,
        low: price,
        close: price,
      });

      continue;
    }

    const candle = candleMap.get(bucketTimestamp);

    candle.high = Math.max(candle.high, price);
    candle.low = Math.min(candle.low, price);
    candle.close = price;
  }

  const candles = Array.from(candleMap.values()).sort(
    (firstCandle, secondCandle) =>
      firstCandle.time - secondCandle.time,
  );

  candleSeries.setData(candles);

  currentCandle =
    candles.length > 0 ? candles[candles.length - 1] : null;

  updateCurrentCandleCards();

  if (candles.length > 0) {
    chart.timeScale().fitContent();
  }
}

// ---------------------------------------------------------------
// TICK TABLE
// ---------------------------------------------------------------

function addTickToTable(tick) {
  const emptyRow = document.getElementById("emptyTickRow");

  if (emptyRow) {
    emptyRow.remove();
  }

  const row = document.createElement("tr");

  row.innerHTML = `
    <td>${escapeHtml(tick.dateTime)}</td>
    <td>${escapeHtml(tick.symbol)}</td>
    <td>${escapeHtml(tick.token)}</td>
    <td>${formatPrice(tick.ltp)}</td>
    <td>${escapeHtml(tick.rawLtp)}</td>
  `;

  tickTableBody.prepend(row);

  while (tickTableBody.children.length > 50) {
    tickTableBody.removeChild(
      tickTableBody.lastElementChild,
    );
  }
}

// ---------------------------------------------------------------
// TIMEFRAME CHANGE
// ---------------------------------------------------------------

// timeframeSelect.addEventListener("change", () => {
//   currentTimeframe = timeframeSelect.value;

//   rebuildCandlesFromHistory();
// });

timeframeSelect.addEventListener(
  "change",
  async () => {
    currentTimeframe = timeframeSelect.value;

    currentCandle = null;

    candleSeries.setData([]);

    await loadStoredCandles();
  },
);

// ---------------------------------------------------------------
// SOCKET EVENTS
// ---------------------------------------------------------------

// socket.on("connect", () => {
//   updateConnectionStatus(
//     "connected",
//     "Browser connected",
//   );
// });

socket.on("connect", async () => {
  updateConnectionStatus(
    "connected",
    "Browser connected",
  );

  await loadStoredCandles();
});

socket.on("connection_status", (data) => {
  const status = data?.status || "connected";
  const message = data?.message || "Connected";

  updateConnectionStatus(status, message);
});

socket.on("live_tick", (tick) => {
  const currentPrice = Number(tick.ltp);
  const timestamp = Number(tick.timestamp);

  if (
    !Number.isFinite(currentPrice) ||
    !Number.isFinite(timestamp)
  ) {
    console.warn("Invalid live tick:", tick);
    return;
  }

  receivedTicks += 1;

  tickHistory.push(tick);

  updateLtpColor(currentPrice);

  ltpElement.textContent = `₹${formatPrice(currentPrice)}`;

  lastTickTimeElement.textContent =
    tick.dateTime || "--";

  updateCandle(tick);
  addTickToTable(tick);

  if (receivedTicks === 1) {
    chart.timeScale().fitContent();
  } else {
    chart.timeScale().scrollToRealTime();
  }
});

socket.on("disconnect", (reason) => {
  updateConnectionStatus(
    "disconnected",
    "Browser disconnected",
  );

  console.warn("Socket disconnected:", reason);
});

socket.on("connect_error", (error) => {
  updateConnectionStatus(
    "error",
    "Connection error — check BACKEND_URL",
  );

  console.error("Socket connection error:", error);
});

// ---------------------------------------------------------------
// RESPONSIVE CHART
// ---------------------------------------------------------------

window.addEventListener("resize", () => {
  chart.applyOptions({
    width: chartContainer.clientWidth,
    height: getChartHeight(),
  });
});