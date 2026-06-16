/* =========================================================================
   Compound Growth & Withdrawal Calculator
   Pure client-side. No frameworks, no network. State persists to localStorage.
   ========================================================================= */
(function () {
  "use strict";

  var LS_STATE = "cc_state_v1";
  var LS_HISTORY = "cc_history_v1";
  var MONTHS_CAP = 100 * 12; // withdrawal simulation safety cap (100 years)

  /* ----------------------------- State ---------------------------------- */
  var state = {
    growth: { start: 100000, monthly: 10000, stepup: 10, rate: 15, years: 20, timing: "end" },
    withdrawal: { start: 0, monthly: 50000, stepup: 7, rate: 10, timing: "end" },
    link: true,         // withdrawal corpus follows growth result
    currency: "Rs",
    theme: "light",
    tab: "combined",
  };

  // map: stateKey -> [element ids that mirror it]
  var GROWTH_MAP = [
    ["start", ["g_start", "cg_start"]],
    ["monthly", ["g_monthly", "cg_monthly"]],
    ["stepup", ["g_stepup", "cg_stepup"]],
    ["rate", ["g_rate", "cg_rate"]],
    ["years", ["g_years", "cg_years"]],
    ["timing", ["g_timing"]],
  ];
  var WITHDRAWAL_MAP = [
    ["start", ["w_start", "cw_start"]],
    ["monthly", ["w_monthly", "cw_monthly"]],
    ["stepup", ["w_stepup", "cw_stepup"]],
    ["rate", ["w_rate", "cw_rate"]],
    ["timing", ["w_timing"]],
  ];
  var LINK_IDS = ["w_link", "cw_link"];

  /* --------------------------- Utilities -------------------------------- */
  function $(id) { return document.getElementById(id); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function fmtCurrency(n) {
    if (!isFinite(n)) n = 0;
    var sym = state.currency ? state.currency + " " : "";
    var sign = n < 0 ? "-" : "";
    var abs = Math.abs(Math.round(n));
    return sign + sym + abs.toLocaleString("en-IN");
  }

  // Indian-style short form: K / L (lakh) / Cr (crore)
  function abbrev(n) {
    if (!isFinite(n)) return "0";
    var sign = n < 0 ? "-" : "";
    var a = Math.abs(n);
    var out;
    if (a >= 1e7) out = trim(a / 1e7) + " Cr";
    else if (a >= 1e5) out = trim(a / 1e5) + " L";
    else if (a >= 1e3) out = trim(a / 1e3) + " K";
    else out = trim(a);
    return sign + out;
  }
  function trim(x) {
    var s = x.toFixed(2);
    return s.replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }
  function wordsHint(n) {
    if (!n) return "";
    return "≈ " + (state.currency ? state.currency + " " : "") + abbrev(n);
  }
  function monthsToText(m) {
    var y = Math.floor(m / 12), mo = m % 12;
    var parts = [];
    if (y) parts.push(y + (y === 1 ? " year" : " years"));
    if (mo) parts.push(mo + (mo === 1 ? " month" : " months"));
    if (!parts.length) return "0 months";
    return parts.join(" ");
  }

  /* ------------------------ Financial engines --------------------------- */
  // Growth / accumulation, simulated month-by-month with annual step-up.
  function computeGrowth(g) {
    var i = g.rate / 100 / 12;
    var totalMonths = Math.max(0, Math.round(g.years * 12));
    var bal = num(g.start);
    var invested = num(g.start);
    var series = [bal];
    var yearly = [];
    for (var m = 1; m <= totalMonths; m++) {
      var yearIdx = Math.floor((m - 1) / 12);
      var contrib = num(g.monthly) * Math.pow(1 + g.stepup / 100, yearIdx);
      if (g.timing === "begin") bal = (bal + contrib) * (1 + i);
      else bal = bal * (1 + i) + contrib;
      invested += contrib;
      series.push(bal);
      if (m % 12 === 0 || m === totalMonths) {
        yearly.push({ year: Math.ceil(m / 12), balance: bal, invested: invested, profit: bal - invested });
      }
    }
    return {
      finalBalance: bal,
      totalInvested: invested,
      totalProfit: bal - invested,
      months: totalMonths,
      series: series,
      yearly: yearly,
    };
  }

  // Withdrawal / decumulation. Returns how long the corpus lasts.
  function computeWithdrawal(w) {
    var i = w.rate / 100 / 12;
    var bal = num(w.start);
    var series = [bal];
    var yearly = [];
    var totalWithdrawn = 0;
    var depletedMonth = null;
    var startBal = bal;

    for (var m = 1; m <= MONTHS_CAP; m++) {
      var yearIdx = Math.floor((m - 1) / 12);
      var wd = num(w.monthly) * Math.pow(1 + w.stepup / 100, yearIdx);
      if (w.timing === "begin") {
        var avail = bal;
        var taken = Math.min(wd, Math.max(avail, 0));
        totalWithdrawn += taken;
        bal = (bal - wd) * (1 + i);
      } else {
        bal = bal * (1 + i);
        var taken2 = Math.min(wd, Math.max(bal, 0));
        totalWithdrawn += taken2;
        bal = bal - wd;
      }
      series.push(Math.max(bal, 0));
      if (m % 12 === 0) yearly.push({ year: m / 12, balance: bal });
      if (bal <= 0) { depletedMonth = m; break; }
    }
    if (depletedMonth && (depletedMonth % 12 !== 0)) {
      yearly.push({ year: depletedMonth / 12, balance: 0 });
    }

    var sustainable = depletedMonth === null;
    return {
      startBalance: startBal,
      lastsMonths: depletedMonth || MONTHS_CAP,
      depleted: depletedMonth !== null,
      sustainable: sustainable,
      endBalance: sustainable ? bal : 0,
      totalWithdrawn: totalWithdrawn,
      series: series,
      yearly: yearly,
    };
  }

  function hexA(color, a) {
    // accepts hex or rgb/var-resolved; build rgba
    var c = color.trim();
    if (c.indexOf("#") === 0) {
      var h = c.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
      return "rgba(" + r + "," + g + "," + b + "," + a + ")";
    }
    return c; // fallback
  }
  function cssVar(name) { return getComputedStyle(document.body).getPropertyValue(name).trim(); }
  function legendHTML(items) {
    return items.map(function (it) {
      return '<span class="key"><span class="dot" style="background:' + it.color + '"></span>' + it.label + "</span>";
    }).join("");
  }

  /* ---------------------------- Rendering ------------------------------- */
  function statBox(label, value, sub, cls) {
    return '<div class="stat ' + (cls || "") + '"><div class="label">' + label + "</div>" +
      '<div class="value">' + value + "</div>" +
      (sub ? '<div class="sub">' + sub + "</div>" : "") + "</div>";
  }

  function render() {
    var g = computeGrowth(state.growth);

    // link: withdrawal corpus follows growth final value
    if (state.link) state.withdrawal.start = g.finalBalance;
    var w = computeWithdrawal(state.withdrawal);

    var GC = cssVar("--growth"), WC = cssVar("--withdraw");

    /* ---- Growth panel ---- */
    $("g_stats").innerHTML =
      statBox("Final value", fmtCurrency(g.finalBalance), wordsHint(g.finalBalance), "big growth") +
      statBox("Total invested", fmtCurrency(g.totalInvested), null, "") +
      statBox("Total profit", fmtCurrency(g.totalProfit), g.totalInvested ? "+" + Math.round((g.totalProfit / g.totalInvested) * 100) + "% on capital" : "", "growth");
    drawChart($("g_chart"),
      [{ values: g.series, color: GC, fill: true }],
      { totalYears: state.growth.years });
    $("g_legend").innerHTML = legendHTML([{ color: GC, label: "Portfolio value" }]);
    renderGrowthTable(g);

    /* ---- Withdrawal panel ---- */
    var w_start_el = $("w_start"), cw_start_el = $("cw_start");
    [w_start_el, cw_start_el].forEach(function (el) { if (el) el.disabled = state.link; });

    var lastsValue = w.sustainable
      ? "Never depletes 🎉"
      : monthsToText(w.lastsMonths);
    var lastsSub = w.sustainable
      ? "Returns out-pace withdrawals at this rate"
      : "until the corpus hits zero";
    $("w_stats").innerHTML =
      statBox("Money lasts", lastsValue, lastsSub, "big " + (w.sustainable ? "ok" : "warn")) +
      statBox("Starting corpus", fmtCurrency(w.startBalance), state.link ? "linked from Growth" : "manual", "") +
      statBox("Total withdrawn", fmtCurrency(w.totalWithdrawn), null, "withdraw") +
      statBox(w.sustainable ? "Balance @ 100y" : "First-year withdrawal",
        w.sustainable ? fmtCurrency(w.endBalance) : fmtCurrency(num(state.withdrawal.monthly) * 12),
        null, "");
    drawChart($("w_chart"),
      [{ values: w.series, color: WC, fill: true }],
      { totalYears: w.series.length / 12 });
    $("w_legend").innerHTML = legendHTML([{ color: WC, label: "Remaining corpus" }]);
    renderWithdrawalTable(w);

    /* ---- Combined panel ---- */
    var cw_start_el2 = $("cw_start");
    if (cw_start_el2) cw_start_el2.disabled = state.link;

    $("cg_mini").className = "card mini-result growth";
    $("cg_mini").innerHTML =
      '<div class="mini-title">After ' + trim(state.growth.years) + ' years you have</div>' +
      '<div class="mini-main">' + fmtCurrency(g.finalBalance) + "</div>" +
      '<div class="mini-row"><span>Invested</span><b>' + fmtCurrency(g.totalInvested) + "</b></div>" +
      '<div class="mini-row"><span>Profit</span><b>' + fmtCurrency(g.totalProfit) + "</b></div>";

    $("cw_mini").className = "card mini-result withdraw";
    $("cw_mini").innerHTML =
      '<div class="mini-title">Drawing ' + fmtCurrency(num(state.withdrawal.monthly)) + "/mo, it lasts</div>" +
      '<div class="mini-main">' + lastsValue + "</div>" +
      '<div class="mini-row"><span>From corpus</span><b>' + fmtCurrency(w.startBalance) + "</b></div>" +
      '<div class="mini-row"><span>Total drawn</span><b>' + fmtCurrency(w.totalWithdrawn) + "</b></div>";

    // stitched journey chart: accumulation, then drawdown continuing from final value.
    // Two datasets share one x-axis; nulls break each line so the phases get
    // distinct colours, meeting exactly at the transition marker.
    var marker = g.series.length - 1;
    var combined = g.series.concat(w.series.slice(1)); // drop duplicate join point
    var accVals = [], decVals = [];
    for (var k = 0; k < combined.length; k++) {
      accVals.push(k <= marker ? combined[k] : null);
      decVals.push(k >= marker ? combined[k] : null);
    }
    drawChart($("c_chart"),
      [{ values: accVals, color: GC, fill: true }, { values: decVals, color: WC, fill: true }],
      { totalYears: combined.length / 12, markerIndex: marker });
    $("c_legend").innerHTML = legendHTML([
      { color: GC, label: "Accumulation" },
      { color: WC, label: "Drawdown" },
    ]);

    syncInputs();
    saveState();
  }

  /* -------------------------- Canvas charts ----------------------------- */
  // Lightweight area/line chart. datasets: [{values:[], color, fill}].
  // Null values break the line into segments (used for the two-phase chart).
  function drawChart(canvas, datasets, opts) {
    opts = opts || {};
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    var cssH = parseInt(canvas.getAttribute("height"), 10) || 240;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    var ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    var gridColor = cssVar("--border");
    var textColor = cssVar("--text-dim");
    var padL = 64, padR = 14, padT = 12, padB = 26;
    var plotW = cssW - padL - padR, plotH = cssH - padT - padB;

    var maxLen = 0, maxVal = 0, minVal = 0;
    datasets.forEach(function (d) {
      maxLen = Math.max(maxLen, d.values.length);
      d.values.forEach(function (v) { if (v == null) return; if (v > maxVal) maxVal = v; if (v < minVal) minVal = v; });
    });
    if (maxLen < 2) maxLen = 2;
    if (maxVal === 0 && minVal === 0) maxVal = 1;
    var range = maxVal - minVal || 1;
    maxVal += range * 0.06;

    function x(idx) { return padL + (idx / (maxLen - 1)) * plotW; }
    function y(val) { return padT + (1 - (val - minVal) / (maxVal - minVal)) * plotH; }

    ctx.font = "11px -apple-system, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 1;
    var ticks = 4;
    for (var t = 0; t <= ticks; t++) {
      var val = minVal + (maxVal - minVal) * (t / ticks);
      var yy = y(val);
      ctx.strokeStyle = gridColor; ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(cssW - padR, yy); ctx.stroke();
      ctx.globalAlpha = 1; ctx.fillStyle = textColor; ctx.textAlign = "right";
      ctx.fillText(abbrev(val), padL - 8, yy);
    }
    var totalYears = opts.totalYears || ((maxLen - 1) / 12);
    var xTickEvery = Math.max(1, Math.ceil(totalYears / 8));
    ctx.textAlign = "center"; ctx.fillStyle = textColor;
    for (var yr = 0; yr <= totalYears + 0.001; yr += xTickEvery) {
      var idx = Math.min(maxLen - 1, Math.round(yr * 12));
      ctx.fillText(Math.round(yr) + "y", x(idx), cssH - padB + 14);
    }
    if (opts.markerIndex != null && opts.markerIndex > 0 && opts.markerIndex < maxLen) {
      var mx = x(opts.markerIndex);
      ctx.save(); ctx.strokeStyle = textColor; ctx.globalAlpha = 0.6; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, padT + plotH); ctx.stroke(); ctx.restore();
    }

    datasets.forEach(function (d) {
      // draw as segments, breaking on null
      ctx.lineWidth = 2; ctx.strokeStyle = d.color;
      var started = false, firstIdx = null, lastIdx = null;
      ctx.beginPath();
      d.values.forEach(function (v, idx) {
        if (v == null) { return; }
        var px = x(idx), py = y(v);
        if (!started) { ctx.moveTo(px, py); started = true; firstIdx = idx; }
        else ctx.lineTo(px, py);
        lastIdx = idx;
      });
      ctx.stroke();
      if (d.fill && firstIdx != null && lastIdx != null && lastIdx > firstIdx) {
        ctx.lineTo(x(lastIdx), y(minVal));
        ctx.lineTo(x(firstIdx), y(minVal));
        ctx.closePath();
        var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
        grad.addColorStop(0, hexA(d.color, 0.28));
        grad.addColorStop(1, hexA(d.color, 0.02));
        ctx.fillStyle = grad; ctx.fill();
      }
    });
  }

  function renderGrowthTable(g) {
    var html = "<thead><tr><th>Year</th><th>Invested</th><th>Value</th><th>Profit</th></tr></thead><tbody>";
    g.yearly.forEach(function (r) {
      html += "<tr><td>" + r.year + "</td><td>" + fmtCurrency(r.invested) + "</td><td>" +
        fmtCurrency(r.balance) + '</td><td class="col-pos">' + fmtCurrency(r.profit) + "</td></tr>";
    });
    if (!g.yearly.length) html += '<tr><td colspan="4" class="empty">Set years &gt; 0 to see a breakdown.</td></tr>';
    html += "</tbody>";
    $("g_table").innerHTML = html;
  }

  function renderWithdrawalTable(w) {
    var html = "<thead><tr><th>Year</th><th>Remaining corpus</th></tr></thead><tbody>";
    var rows = w.yearly.slice(0, 60);
    rows.forEach(function (r) {
      var cls = r.balance <= 0 ? "col-neg" : "";
      html += "<tr><td>" + r.year + '</td><td class="' + cls + '">' +
        (r.balance <= 0 ? "Depleted" : fmtCurrency(r.balance)) + "</td></tr>";
    });
    if (!rows.length) html += '<tr><td colspan="2" class="empty">No drawdown yet.</td></tr>';
    html += "</tbody>";
    $("w_table").innerHTML = html;
  }

  /* --------------------------- Input sync ------------------------------- */
  function syncInputs() {
    var active = document.activeElement;
    function setVal(id, v) {
      var el = $(id);
      if (!el || el === active) return;
      el.value = v;
    }
    GROWTH_MAP.forEach(function (entry) {
      entry[1].forEach(function (id) { setVal(id, state.growth[entry[0]]); });
    });
    WITHDRAWAL_MAP.forEach(function (entry) {
      entry[1].forEach(function (id) { setVal(id, state.withdrawal[entry[0]]); });
    });
    LINK_IDS.forEach(function (id) { var el = $(id); if (el) el.checked = state.link; });

    // hint words
    setHint("g_start_words", state.growth.start);
    setHint("g_monthly_words", state.growth.monthly);
    setHint("w_start_words", state.withdrawal.start);
    setHint("w_monthly_words", state.withdrawal.monthly);
  }
  function setHint(id, v) { var el = $(id); if (el) el.textContent = wordsHint(num(v)); }

  function bindInputs() {
    GROWTH_MAP.forEach(function (entry) {
      var key = entry[0];
      entry[1].forEach(function (id) {
        var el = $(id); if (!el) return;
        el.addEventListener("input", function () {
          state.growth[key] = key === "timing" ? el.value : num(el.value);
          render();
        });
      });
    });
    WITHDRAWAL_MAP.forEach(function (entry) {
      var key = entry[0];
      entry[1].forEach(function (id) {
        var el = $(id); if (!el) return;
        el.addEventListener("input", function () {
          if ((id === "w_start" || id === "cw_start") && state.link) return;
          state.withdrawal[key] = key === "timing" ? el.value : num(el.value);
          render();
        });
      });
    });
    LINK_IDS.forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener("change", function () {
        state.link = el.checked;
        render();
      });
    });
  }

  /* ---------------------------- Persistence ----------------------------- */
  function saveState() {
    try { localStorage.setItem(LS_STATE, JSON.stringify(state)); } catch (e) {}
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(LS_STATE);
      if (!raw) return;
      var s = JSON.parse(raw);
      if (s.growth) Object.assign(state.growth, s.growth);
      if (s.withdrawal) Object.assign(state.withdrawal, s.withdrawal);
      if (typeof s.link === "boolean") state.link = s.link;
      if (s.currency != null) state.currency = s.currency;
      if (s.theme) state.theme = s.theme;
      if (s.tab) state.tab = s.tab;
    } catch (e) {}
  }

  function getHistory() {
    try { return JSON.parse(localStorage.getItem(LS_HISTORY) || "[]"); } catch (e) { return []; }
  }
  function setHistory(arr) {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(arr)); } catch (e) {}
  }

  /* ----------------------------- History UI ----------------------------- */
  function saveScenario() {
    var label = ($("saveLabel").value || "").trim() || "Scenario " + (getHistory().length + 1);
    var g = computeGrowth(state.growth);
    if (state.link) state.withdrawal.start = g.finalBalance;
    var w = computeWithdrawal(state.withdrawal);
    var item = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      label: label,
      date: new Date().toISOString(),
      growth: Object.assign({}, state.growth),
      withdrawal: Object.assign({}, state.withdrawal),
      link: state.link,
      summary: {
        finalBalance: g.finalBalance,
        invested: g.totalInvested,
        lasts: w.sustainable ? "Never depletes" : monthsToText(w.lastsMonths),
      },
    };
    var h = getHistory();
    h.unshift(item);
    setHistory(h);
    $("saveLabel").value = "";
    renderHistory();
    toast("Saved “" + label + "”");
  }

  function renderHistory() {
    var h = getHistory();
    var box = $("historyList");
    if (!h.length) { box.innerHTML = '<div class="empty">No saved scenarios yet. Build one in Combined and hit “Save to history”.</div>'; return; }
    box.innerHTML = h.map(function (it) {
      var d = new Date(it.date);
      return '<div class="history-item" data-id="' + it.id + '">' +
        '<button class="hi-del" data-del="' + it.id + '" title="Delete">✕</button>' +
        '<div class="hi-label">' + escapeHtml(it.label) + "</div>" +
        '<div class="hi-date">' + d.toLocaleDateString() + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "</div>" +
        '<div class="hi-stat"><span>Final value</span><span>' + fmtCurrency(it.summary.finalBalance) + "</span></div>" +
        '<div class="hi-stat"><span>Invested</span><span>' + fmtCurrency(it.summary.invested) + "</span></div>" +
        '<div class="hi-stat"><span>Lasts</span><span>' + escapeHtml(it.summary.lasts) + "</span></div>" +
        "</div>";
    }).join("");
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function loadScenario(id) {
    var it = getHistory().filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    Object.assign(state.growth, it.growth);
    Object.assign(state.withdrawal, it.withdrawal);
    state.link = !!it.link;
    render();
    switchTab("combined");
    toast("Loaded “" + it.label + "”");
  }
  function deleteScenario(id) {
    setHistory(getHistory().filter(function (x) { return x.id !== id; }));
    renderHistory();
  }

  /* ----------------------------- Tabs / theme --------------------------- */
  function switchTab(name) {
    state.tab = name;
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-tab") === name);
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("hidden", p.getAttribute("data-panel") !== name);
    });
    if (name === "history") renderHistory();
    // charts need a (re)draw once their panel is visible
    requestAnimationFrame(render);
    saveState();
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.theme === "dark" ? "dark" : "light");
    $("themeToggle").textContent = state.theme === "dark" ? "☀️" : "🌙";
  }

  function applyCurrency() {
    $("currencySelect").value = state.currency;
    document.querySelectorAll(".curr").forEach(function (el) {
      el.textContent = state.currency || "—";
      el.style.display = state.currency ? "" : "none";
    });
  }

  var toastTimer;
  function toast(msg) {
    var el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  /* ----------------------------- Wiring --------------------------------- */
  function init() {
    loadState();
    applyTheme();
    applyCurrency();
    bindInputs();
    syncInputs();

    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { switchTab(t.getAttribute("data-tab")); });
    });

    $("themeToggle").addEventListener("click", function () {
      state.theme = state.theme === "dark" ? "light" : "dark";
      applyTheme(); render();
    });
    $("currencySelect").addEventListener("change", function () {
      state.currency = $("currencySelect").value;
      applyCurrency(); render();
    });

    $("saveBtn").addEventListener("click", saveScenario);
    $("historyList").addEventListener("click", function (e) {
      var del = e.target.getAttribute("data-del");
      if (del) { e.stopPropagation(); deleteScenario(del); return; }
      var item = e.target.closest(".history-item");
      if (item) loadScenario(item.getAttribute("data-id"));
    });
    $("clearHistoryBtn").addEventListener("click", function () {
      if (confirm("Delete ALL saved scenarios? This cannot be undone.")) { setHistory([]); renderHistory(); toast("History cleared"); }
    });
    $("exportBtn").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(getHistory(), null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "compound-calculator-history.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $("importBtn").addEventListener("click", function () { $("importFile").click(); });
    $("importFile").addEventListener("change", function (e) {
      var f = e.target.files[0]; if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error("bad");
          var merged = data.concat(getHistory());
          setHistory(merged);
          renderHistory();
          toast("Imported " + data.length + " scenario(s)");
        } catch (err) { toast("Import failed — invalid file"); }
        $("importFile").value = "";
      };
      reader.readAsText(f);
    });

    var resizeTimer;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(render, 120);
    });

    switchTab(state.tab || "combined");
    render();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  // Exposed for unit testing under Node; no effect in the browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { computeGrowth: computeGrowth, computeWithdrawal: computeWithdrawal, abbrev: abbrev };
  }
})();
