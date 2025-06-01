// Utility: show error message in top-left
function showError(msg) {
  const box = document.getElementById("errorBox");
  document.getElementById("errorMsg").textContent = msg;
  box.style.display = "block";
  setTimeout(() => (box.style.display = "none"), 4000);
}

// Utility: show buy/sell notification in left
function showNotification(title, details, profitText = "") {
  const box = document.getElementById("notifBox");
  document.getElementById("notifTitle").textContent = title;
  document.getElementById("notifDetails").textContent = details;
  document.getElementById("notifProfit").textContent = profitText;
  box.style.display = "block";
  setTimeout(() => (box.style.display = "none"), 4000);
}

// "Report" button opens mailto with error text
document.getElementById("reportBtn").onclick = () => {
  const txt = encodeURIComponent(
    document.getElementById("errorMsg").textContent
  );
  location.href = `mailto:support@example.com?subject=Bug Report&body=${txt}`;
};

const API_KEY = "iuaYSx6MhNpQPwKZ73n31hKZodxwaTNd";

// Fetch last 30 days of historical data from Financial Modeling Prep
async function fetchFMP(sym) {
  try {
    const url = `https://financialmodelingprep.com/api/v3/historical-price-full/${encodeURIComponent(
      sym
    )}?apikey=${API_KEY}`;
    const res = await fetch(url);
    const j = await res.json();
    if (!j.historical) throw new Error("No data for " + sym);
    return j.historical
      .slice(0, 30)
      .reverse()
      .map((d) => ({
        date: d.date,
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
        volume: d.volume,
      }));
  } catch (e) {
    showError(e.message);
    throw e;
  }
}

// Compute 10-day SMA
function computeSMA(data, p = 10) {
  return data.map((d, i, a) => ({
    date: d.date,
    sma:
      i < p - 1
        ? null
        : a.slice(i - p + 1, i + 1).reduce((s, v) => s + v.close, 0) / p,
  }));
}

// Compute 14-day RSI
function computeRSI(data, p = 14) {
  let g = 0,
    l = 0;
  for (let i = 1; i <= p; i++) {
    const diff = data[i].close - data[i - 1].close;
    diff > 0 ? (g += diff) : (l -= diff);
  }
  let avgG = g / p,
    avgL = l / p;
  return data.map((d, i, a) => {
    if (i < p) return { date: d.date, rsi: null };
    const diff = d.close - a[i - 1].close;
    avgG = (avgG * (p - 1) + Math.max(diff, 0)) / p;
    avgL = (avgL * (p - 1) + Math.max(-diff, 0)) / p;
    const rs = avgG / (avgL || 1);
    return { date: d.date, rsi: 100 - 100 / (1 + rs) };
  });
}

// Compute MACD (12,26)
function computeMACD(data, f = 12, s = 26) {
  function ema(vals, n) {
    const k = 2 / (n + 1);
    let e = vals[0],
      out = [e];
    for (let i = 1; i < vals.length; i++) {
      e = vals[i] * k + e * (1 - k);
      out.push(e);
    }
    return out;
  }
  const closes = data.map((d) => d.close);
  const fast = ema(closes, f);
  const slow = ema(closes, s);
  return data.map((d, i) => ({
    date: d.date,
    macd: fast[i] - slow[i],
  }));
}

// Compute linear regression for “prediction”
function linReg(data) {
  const n = data.length;
  const x = data.map((_, i) => i);
  const y = data.map((d) => d.close);
  const sx = x.reduce((a, b) => a + b, 0);
  const sy = y.reduce((a, b) => a + b, 0);
  const sxy = x.map((v, i) => v * y[i]).reduce((a, b) => a + b, 0);
  const sxx = x.map((v) => v * v).reduce((a, b) => a + b, 0);
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const b = (sy - m * sx) / n;
  return data.map((d, i) => ({ date: d.date, pred: b + m * i }));
}

// Chart variables
let root,
  chart,
  xAxis,
  yAxis,
  lineSeries,
  candleSeries,
  volumeSeries,
  smaSeries,
  rsiSeries,
  macdSeries,
  predSeries;
let purchase = null,
  selectedData;
// Keep track of all highlighted bullet sprites
let highlightedBullets = [];

// DOM references
const actions = document.getElementById("pointActions"),
  amountInput = document.getElementById("buyAmount"),
  buyBtn = document.getElementById("buyBtn"),
  sellBtn = document.getElementById("sellBtn"),
  hlBtn = document.getElementById("highlightBtn"),
  rmBtn = document.getElementById("removeHighlightBtn");

// Main “createChart” function (called by am5.ready)
function createChart() {
  // If a previous chart exists, dispose it first
  if (root) {
    root.dispose();
  }
  root = am5.Root.new("chartdiv");

  // Choose themes
  const themes = [];
  if (isDark) {
    themes.push(am5themes_Dark.new(root));
  }
  themes.push(am5themes_Animated.new(root));
  root.setThemes(themes);

  chart = root.container.children.push(
    am5xy.XYChart.new(root, {
      panX: true,
      panY: true,
      wheelX: "panX",
      wheelY: "zoomX",
    })
  );

  // X‐axis (Category)
  xAxis = chart.xAxes.push(
    am5xy.CategoryAxis.new(root, {
      categoryField: "date",
      renderer: am5xy.AxisRendererX.new(root, { minGridDistance: 30 }),
    })
  );
  xAxis
    .get("renderer")
    .labels.template.setAll({
      rotation: -45,
      centerY: am5.p50,
      centerX: am5.p100,
      fill: isDark ? am5.color(0xeeeeee) : am5.color(0x333333),
    });
  xAxis.setAll({ startLocation: 0, endLocation: 1 });

  // Y‐axis (Value)
  yAxis = chart.yAxes.push(
    am5xy.ValueAxis.new(root, {
      renderer: am5xy.AxisRendererY.new(root, { grid: { strokeOpacity: 0.15 } }),
    })
  );
  yAxis
    .get("renderer")
    .labels.template.setAll({
      fill: isDark ? am5.color(0xeeeeee) : am5.color(0x333333),
    });

  // 1) Close‐price line series
  lineSeries = chart.series.push(
    am5xy.LineSeries.new(root, {
      name: "Close",
      xAxis: xAxis,
      yAxis: yAxis,
      categoryXField: "date",
      valueYField: "close",
      stroke: am5.color(0x28a745),
      fill: am5.color(0x28a745),
      fillOpacity: 0.2,
      tooltip: am5.Tooltip.new(root, { labelText: "{valueY}" }),
    })
  );
  lineSeries.strokes.template.setAll({ strokeWidth: 2 });
  lineSeries.setAll({ startLocation: 0, endLocation: 1 });

  // Add clickable bullets to "Close" line
  lineSeries.bullets.push((root, series, dataItem) => {
    const circle = am5.Circle.new(root, {
      radius: 4,
      fill: series.get("stroke"), // original fill color
    });
    circle.events.on("click", (ev) => {
      // Hide the “Select a point” hint on first click
      document.getElementById("selectHint").style.display = "none";

      selectedData = dataItem;
      const px = dataItem.get("valueY").toFixed(2);
      document.getElementById("pointPrice").textContent = `$${px}`;
      const rect = document
        .getElementById("chartdiv")
        .getBoundingClientRect();
      actions.style.left = ev.originalEvent.clientX - rect.left + 5 + "px";
      actions.style.top = ev.originalEvent.clientY - rect.top + 5 + "px";
      amountInput.value = "";

      // If this bullet is already in highlightedBullets array → show “Remove Highlight”
      const bulletSprite = dataItem.bullets[0].get("sprite");
      if (highlightedBullets.includes(bulletSprite)) {
        rmBtn.style.display = "inline-block";
      } else {
        rmBtn.style.display = "none";
      }

      if (!purchase) {
        buyBtn.style.display = "inline-block";
        amountInput.style.display = "inline-block";
        sellBtn.style.display = "none";
      } else {
        buyBtn.style.display = "none";
        amountInput.style.display = "none";
        sellBtn.style.display = "inline-block";
      }
      actions.style.display = "flex";
    });
    return am5.Bullet.new(root, { sprite: circle });
  });

  // 2) Candlestick series
  candleSeries = chart.series.push(
    am5xy.CandlestickSeries.new(root, {
      name: "Candlestick",
      xAxis: xAxis,
      yAxis: yAxis,
      categoryXField: "date",
      openValueYField: "open",
      highValueYField: "high",
      lowValueYField: "low",
      valueYField: "close",
      tooltip: am5.Tooltip.new(root, {
        labelText:
          "O:{openValueY}\nH:{highValueY}\nL:{lowValueY}\nC:{valueY}",
      }),
    })
  );
  candleSeries.set("hidden", true);

  // 3) Volume series (column)
  volumeSeries = chart.series.push(
    am5xy.ColumnSeries.new(root, {
      name: "Volume",
      xAxis: xAxis,
      yAxis: yAxis,
      categoryXField: "date",
      valueYField: "volume",
      clustered: false,
      tooltip: am5.Tooltip.new(root, { labelText: "{valueY}" }),
    })
  );
  volumeSeries.columns.template.setAll({ fillOpacity: 0.15 });
  volumeSeries.set("hidden", true);

  // 4) 10-day SMA
  smaSeries = chart.series.push(
    am5xy.LineSeries.new(root, {
      name: "SMA (10)",
      xAxis: xAxis,
      yAxis: yAxis,
      categoryXField: "date",
      valueYField: "sma",
      stroke: am5.color(0xffa500),
      strokeDasharray: [4, 4],
      strokeWidth: 2,
      strokeOpacity: 0.8,
    })
  );
  smaSeries.setAll({ startLocation: 0, endLocation: 1 });

  // 5) RSI(14)
  rsiSeries = chart.series.push(
    am5xy.LineSeries.new(root, {
      name: "RSI (14)",
      xAxis: xAxis,
      yAxis: yAxis,
      categoryXField: "date",
      valueYField: "rsi",
      stroke: am5.color(0x6f42c1),
      strokeDasharray: [2, 2],
      strokeWidth: 2,
      strokeOpacity: 0.8,
    })
  );
  rsiSeries.setAll({ startLocation: 0, endLocation: 1 });
  rsiSeries.set("hidden", true);

  // 6) MACD
  macdSeries = chart.series.push(
    am5xy.LineSeries.new(root, {
      name: "MACD",
      xAxis: xAxis,
      yAxis: yAxis,
      categoryXField: "date",
      valueYField: "macd",
      stroke: am5.color(0xdc3545),
      strokeWidth: 2,
      strokeOpacity: 0.8,
    })
  );
  macdSeries.setAll({ startLocation: 0, endLocation: 1 });
  macdSeries.set("hidden", true);

  // 7) Prediction (linear regression)
  predSeries = chart.series.push(
    am5xy.LineSeries.new(root, {
      name: "Prediction",
      xAxis: xAxis,
      yAxis: yAxis,
      categoryXField: "date",
      valueYField: "pred",
      stroke: am5.color(0x007bff),
      strokeDasharray: [3, 3],
      strokeWidth: 2,
      strokeOpacity: 0.8,
    })
  );
  predSeries.setAll({ startLocation: 0, endLocation: 1 });
  predSeries.set("hidden", true);

  // 8) Cursor
  chart.set("cursor", am5xy.XYCursor.new(root, { behavior: "zoomXY" }));

  // 9) Checkbox toggles
  const map = {
    Close: lineSeries,
    Candle: candleSeries,
    Volume: volumeSeries,
    SMA: smaSeries,
    RSI: rsiSeries,
    MACD: macdSeries,
    Pred: predSeries,
  };
  Object.entries(map).forEach(([key, series]) => {
    document.getElementById("chk" + key).onchange = (e) =>
      e.target.checked ? series.show() : series.hide();
  });

  // 10) Free-draw setup
  const canvas = document.getElementById("drawCanvas");
  const ctx = canvas.getContext("2d");
  const rect = document.getElementById("chartdiv").getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  let drawing = false,
    strokes = [],
    currStroke = null;

  document.getElementById("freeDrawBtn").onclick = () => {
    drawing = !drawing;
    canvas.style.display = drawing ? "block" : "none";
  };
  document.getElementById("undoBtn").onclick = () => {
    strokes.pop();
    redraw();
  };
  document.getElementById("clearDrawBtn").onclick = () => {
    strokes = [];
    redraw();
  };
  canvas.onpointerdown = (e) => {
    if (!drawing) return;
    currStroke = [{ x: e.offsetX, y: e.offsetY }];
    strokes.push(currStroke);
    canvas.setPointerCapture(e.pointerId);
  };
  canvas.onpointermove = (e) => {
    if (!drawing || !currStroke) return;
    currStroke.push({ x: e.offsetX, y: e.offsetY });
    redraw();
  };
  canvas.onpointerup = (e) => {
    currStroke = null;
    canvas.releasePointerCapture(e.pointerId);
  };
  function redraw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    strokes.forEach((s) => {
      if (s.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(s[0].x, s[0].y);
      s.slice(1).forEach((pt) => ctx.lineTo(pt.x, pt.y));
      ctx.stroke();
    });
  }

  // 11) Buy behavior
  buyBtn.onclick = () => {
    const qty = parseFloat(amountInput.value);
    if (!qty || qty <= 0) {
      showError("Enter valid quantity");
      return;
    }
    purchase = {
      date: selectedData.get("categoryX"),
      price: selectedData.get("valueY"),
      qty,
    };
    showNotification(
      "Purchased",
      `${qty} shares @ $${purchase.price.toFixed(2)} on ${purchase.date}`
    );
    actions.style.display = "none";
  };

  // 12) Sell behavior
  sellBtn.onclick = () => {
    if (!purchase) return;
    const sp = selectedData.get("valueY");
    const profit = (sp - purchase.price) * purchase.qty;
    showNotification(
      "Sold",
      `${purchase.qty} shares @ $${sp.toFixed(2)} on ${selectedData.get(
        "categoryX"
      )}`,
      `Profit: $${profit.toFixed(2)}`
    );
    purchase = null;
    actions.style.display = "none";
  };

  // 13) Highlight behavior
  hlBtn.onclick = () => {
    const bulletSprite = selectedData.bullets[0].get("sprite");
    if (!highlightedBullets.includes(bulletSprite)) {
      bulletSprite.setAll({
        stroke: am5.color(0xff0000),
        strokeWidth: 3,
        fillOpacity: 0,
      });
      highlightedBullets.push(bulletSprite);
    }
    // Show the Remove Highlight button whenever this point is already highlighted
    rmBtn.style.display = highlightedBullets.includes(bulletSprite)
      ? "inline-block"
      : "none";
    actions.style.display = "none";
  };

  // 14) Remove Highlight behavior (no greyed-out style)
  rmBtn.onclick = () => {
    const bulletSprite = selectedData.bullets[0].get("sprite");
    const idx = highlightedBullets.indexOf(bulletSprite);
    if (idx !== -1) {
      bulletSprite.setAll({
        strokeWidth: 0, // remove border
        stroke: am5.color(0x000000, 0), // fully transparent stroke
        fill: lineSeries.get("stroke"), // restore original fill color
        fillOpacity: 1,
      });
      highlightedBullets.splice(idx, 1);
    }
    // Hide the button again
    rmBtn.style.display = "none";
  };

  updateChart();
}

// Keep track of dark/light mode
let isDark = true;

function updateChart() {
  const sym =
    document.getElementById("symbolInput").value.trim() || "AAPL";
  fetchFMP(sym)
    .then((data) => {
      xAxis.data.setAll(data);
      lineSeries.data.setAll(data);
      candleSeries.data.setAll(data);
      volumeSeries.data.setAll(data);
      smaSeries.data.setAll(computeSMA(data, 10));
      rsiSeries.data.setAll(computeRSI(data, 14));
      macdSeries.data.setAll(computeMACD(data, 12, 26));
      predSeries.data.setAll(linReg(data));

      // Update metric cards
      document.getElementById("cardSMA").textContent =
        smaSeries.dataItems
          .filter((di) => di.dataContext.sma !== null)
          .pop()
          .dataContext.sma.toFixed(2);
      document.getElementById("cardRSI").textContent =
        rsiSeries.dataItems
          .filter((di) => di.dataContext.rsi !== null)
          .pop()
          .dataContext.rsi.toFixed(2);
      document.getElementById("cardMACD").textContent =
        macdSeries.dataItems.pop().dataContext.macd.toFixed(2);
      document.getElementById("cardPred").textContent =
        predSeries.dataItems.pop().dataContext.pred.toFixed(2);

      // Default visibility
      candleSeries.hide();
      volumeSeries.hide();
      smaSeries.show();
      rsiSeries.hide();
      macdSeries.hide();
      predSeries.hide();
      ["Candle", "Volume", "RSI", "MACD", "Pred"].forEach((id) =>
        document.getElementById("chk" + id).checked = false
      );
      document.getElementById("chkClose").checked = true;
      document.getElementById("chkSMA").checked = true;
      document.getElementById("drawCanvas").style.display = "none";

      chart.zoomOut();
    })
    .catch((e) => {
      console.error(e);
    });
}

// Initialize on amCharts ready
am5.ready(createChart);

// Search button
document.getElementById("searchBtn").onclick = updateChart;

// Toggle light/dark
document.getElementById("toggleTheme").onclick = () => {
  isDark = !isDark;
  document.body.classList.toggle("light-mode", !isDark);
  document.getElementById("toggleTheme").textContent = isDark
    ? "🌙"
    : "☀️";
  createChart();
};
