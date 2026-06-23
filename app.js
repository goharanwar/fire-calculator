/* =========================================================================
   Compound Growth & Withdrawal Calculator
   Pure client-side. No frameworks, no network. State persists to localStorage.
   ========================================================================= */
(function () {
  "use strict";

  var LS_STATE = "cc_state_v1";
  var LS_HISTORY = "cc_history_v1";
  var LS_FX = "cc_fx_v1";
  var MONTHS_CAP = 100 * 12;          // withdrawal simulation safety cap (100 years)
  var SUSTAIN_DISPLAY_YEARS = 40;     // chart horizon when the corpus never depletes
  var AUTOSAVE_MS = 15000;            // idle delay before a rolling auto-save
  var FX_TTL_MS = 12 * 3600 * 1000;   // re-fetch exchange rates after 12h
  var FX_API = "https://open.er-api.com/v6/latest/";

  // Currency symbol -> ISO code (for live conversion). "none" has no code.
  var CURRENCY_ISO = { "Rs": "PKR", "₹": "INR", "$": "USD", "£": "GBP", "€": "EUR", "": null };

  /* ----------------------------- State ---------------------------------- */
  var state = {
    growth: { start: 100000, monthly: 10000, stepup: 10, rate: 15, years: 20, timing: "end" },
    withdrawal: { start: 0, monthly: 50000, stepup: 7, rate: 10, timing: "end" },
    // Optional low-risk pot (e.g. money-market emergency fund) grown in parallel.
    emergency: { enabled: false, start: 0, monthly: 0, rate: 6 },
    link: true,                       // withdrawal corpus follows growth result
    zakat: { enabled: true, rate: 2.5 }, // annual 2.5% wealth deduction at year-end
    currency: "Rs",
    fxNote: "",                       // human-readable last conversion rate
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
  var EMERGENCY_MAP = [
    ["start", ["ef_start", "cef_start"]],
    ["monthly", ["ef_monthly", "cef_monthly"]],
    ["rate", ["ef_rate", "cef_rate"]],
  ];
  var LINK_IDS = ["w_link", "cw_link"];
  var EF_ENABLE_IDS = ["ef_enabled", "cef_enabled"];

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
  // Full amount with a Cr/L short form appended once it's large enough to help.
  function fmtAbbrev(n) {
    var full = fmtCurrency(n);
    if (Math.abs(n) >= 1e5) return full + ' <span class="dim">(' + abbrev(n) + ")</span>";
    return full;
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
  // Effective annual Zakat rate, applied to the balance at each year-end.
  function zakatRate(z) { return z && z.enabled ? (num(z.rate) / 100) : 0; }

  // Growth / accumulation, simulated month-by-month with annual step-up.
  // Optional `z` = {enabled, rate} deducts Zakat from the balance each year-end.
  function computeGrowth(g, z) {
    var i = g.rate / 100 / 12;
    var zr = zakatRate(z);
    var totalMonths = Math.max(0, Math.round(g.years * 12));
    var bal = num(g.start);
    var invested = num(g.start);
    var zakatPaid = 0;
    var series = [bal];
    var yearly = [];
    for (var m = 1; m <= totalMonths; m++) {
      var yearIdx = Math.floor((m - 1) / 12);
      var contrib = num(g.monthly) * Math.pow(1 + g.stepup / 100, yearIdx);
      if (g.timing === "begin") bal = (bal + contrib) * (1 + i);
      else bal = bal * (1 + i) + contrib;
      invested += contrib;
      var zakatThisYear = 0;
      if (zr && m % 12 === 0) { zakatThisYear = bal * zr; bal -= zakatThisYear; zakatPaid += zakatThisYear; }
      series.push(bal);
      if (m % 12 === 0 || m === totalMonths) {
        yearly.push({ year: Math.ceil(m / 12), balance: bal, invested: invested, profit: bal - invested, zakat: zakatThisYear });
      }
    }
    return {
      finalBalance: bal,
      totalInvested: invested,
      totalProfit: bal - invested,
      zakatPaid: zakatPaid,
      months: totalMonths,
      series: series,
      yearly: yearly,
    };
  }

  // Withdrawal / decumulation. Returns how long the corpus lasts.
  // Optional `z` = {enabled, rate} deducts Zakat from the balance each year-end.
  function computeWithdrawal(w, z) {
    var i = w.rate / 100 / 12;
    var zr = zakatRate(z);
    var bal = num(w.start);
    var series = [bal];
    var yearly = [];
    var totalWithdrawn = 0;
    var zakatPaid = 0;
    var depletedMonth = null;
    var startBal = bal;
    var horizonMonth = SUSTAIN_DISPLAY_YEARS * 12;
    // Cumulative totals frozen at the display horizon, so a never-depleting run
    // reports figures that match the (capped) chart rather than the 100y cap.
    var withdrawnAtHorizon = 0, zakatAtHorizon = 0, balAtHorizon = bal;

    for (var m = 1; m <= MONTHS_CAP; m++) {
      var yearIdx = Math.floor((m - 1) / 12);
      var wd = num(w.monthly) * Math.pow(1 + w.stepup / 100, yearIdx);
      if (w.timing === "begin") {
        totalWithdrawn += Math.min(wd, Math.max(bal, 0));
        bal = (bal - wd) * (1 + i);
      } else {
        bal = bal * (1 + i);
        totalWithdrawn += Math.min(wd, Math.max(bal, 0));
        bal = bal - wd;
      }
      // Zakat at year-end, on whatever corpus survives the year's withdrawals.
      if (zr && m % 12 === 0 && bal > 0) { var zk = bal * zr; bal -= zk; zakatPaid += zk; }
      series.push(Math.max(bal, 0));
      if (m % 12 === 0) yearly.push({ year: m / 12, balance: bal });
      if (m === horizonMonth) { withdrawnAtHorizon = totalWithdrawn; zakatAtHorizon = zakatPaid; balAtHorizon = bal; }
      if (bal <= 0) { depletedMonth = m; break; }
    }
    if (depletedMonth && (depletedMonth % 12 !== 0)) {
      yearly.push({ year: depletedMonth / 12, balance: 0 });
    }

    var sustainable = depletedMonth === null;
    // For charts, cap an open-ended (never-depleting) run to a readable horizon.
    var displaySeries = series;
    var displayCapped = false;
    if (sustainable && series.length > horizonMonth + 1) {
      displaySeries = series.slice(0, horizonMonth + 1);
      displayCapped = true;
    }
    return {
      startBalance: startBal,
      lastsMonths: depletedMonth || MONTHS_CAP,
      depleted: depletedMonth !== null,
      sustainable: sustainable,
      // When sustainable, report figures over the shown horizon (not the 100y cap).
      endBalance: sustainable ? balAtHorizon : 0,
      totalWithdrawn: sustainable ? withdrawnAtHorizon : totalWithdrawn,
      zakatPaid: sustainable ? zakatAtHorizon : zakatPaid,
      horizonYears: SUSTAIN_DISPLAY_YEARS,
      series: series,
      displaySeries: displaySeries,
      displayCapped: displayCapped,
      yearly: yearly,
    };
  }

  // Does `corpus` survive the full horizon (≈ perpetual) under this plan?
  // Mirrors computeWithdrawal's month order exactly so results stay consistent.
  function lastsForever(corpus, monthly, rate, stepup, zr, timing) {
    if (corpus <= 0) return monthly <= 0;
    var i = rate / 100 / 12;
    var bal = corpus;
    for (var m = 1; m <= MONTHS_CAP; m++) {
      var wd = monthly * Math.pow(1 + stepup / 100, Math.floor((m - 1) / 12));
      if (timing === "begin") bal = (bal - wd) * (1 + i);
      else bal = bal * (1 + i) - wd;
      if (zr && m % 12 === 0 && bal > 0) bal -= bal * zr;
      if (bal <= 0) return false;
    }
    return true;
  }

  // Largest INITIAL monthly withdrawal that keeps `corpus` from ever depleting
  // (the withdrawal itself still rises by `stepup` each year). Binary search.
  function safeMonthlyWithdrawal(corpus, rate, stepup, zr, timing) {
    if (!(corpus > 0)) return 0;
    if (!lastsForever(corpus, 0, rate, stepup, zr, timing)) return 0; // even 0 bleeds out
    var lo = 0, hi = Math.max(1, corpus * (rate / 100 / 12) + 1), guard = 0;
    while (lastsForever(corpus, hi, rate, stepup, zr, timing) && guard < 80) { hi *= 1.6; guard++; }
    for (var k = 0; k < 50; k++) {
      var mid = (lo + hi) / 2;
      if (lastsForever(corpus, mid, rate, stepup, zr, timing)) lo = mid; else hi = mid;
    }
    return lo;
  }

  // Emergency / low-risk fund expressed as a growth pot (no step-up by default),
  // grown for the same horizon and timing as the main growth phase.
  function emergencyAsGrowth() {
    return {
      start: state.emergency.start, monthly: state.emergency.monthly,
      stepup: 0, rate: state.emergency.rate,
      years: state.growth.years, timing: state.growth.timing,
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
    var g = computeGrowth(state.growth, state.zakat);

    // Emergency / low-risk pot grown in parallel (optional).
    var efOn = state.emergency.enabled;
    var e = efOn ? computeGrowth(emergencyAsGrowth(), state.zakat) : null;
    var totalFinal = g.finalBalance + (e ? e.finalBalance : 0);
    var totalInvested = g.totalInvested + (e ? e.totalInvested : 0);
    var totalProfit = totalFinal - totalInvested;
    var totalZakat = g.zakatPaid + (e ? e.zakatPaid : 0);
    // Accumulation series shown on charts (sum of both pots when EF is on).
    var accSeries = e ? g.series.map(function (v, idx) { return v + (e.series[idx] || 0); }) : g.series;
    var accLabel = efOn ? "Total portfolio (incl. emergency)" : "Portfolio value";

    // link: withdrawal corpus follows the TOTAL growth result (rounded for a tidy field)
    if (state.link) state.withdrawal.start = Math.round(totalFinal);
    var w = computeWithdrawal(state.withdrawal, state.zakat);

    var GC = cssVar("--growth"), WC = cssVar("--withdraw");
    var zOn = state.zakat.enabled, zr = zakatRate(state.zakat);
    var zPct = trim(num(state.zakat.rate));

    // Max sustainable monthly withdrawal for the current corpus.
    var safe = safeMonthlyWithdrawal(w.startBalance, state.withdrawal.rate, state.withdrawal.stepup, zr, state.withdrawal.timing);
    var safeSub = num(state.withdrawal.stepup) > 0 ? "rising " + trim(num(state.withdrawal.stepup)) + "%/yr, corpus never depletes" : "corpus never depletes";
    var safeImpossible = w.startBalance > 0 && safe < 1;
    if (safeImpossible) safeSub = "withdrawals rise ≥ your " + trim(num(state.withdrawal.rate)) + "% return";

    /* ---- Growth panel ---- */
    var gStats =
      statBox("Final value", fmtCurrency(totalFinal), wordsHint(totalFinal), "big growth") +
      statBox("Total invested", fmtCurrency(totalInvested), null, "") +
      statBox("Total profit", fmtCurrency(totalProfit), totalInvested ? "+" + Math.round((totalProfit / totalInvested) * 100) + "% on capital" : "", "growth");
    if (efOn) gStats += statBox("Emergency fund", fmtCurrency(e.finalBalance), "@ " + trim(num(state.emergency.rate)) + "% · part of total", "");
    if (zOn) gStats += statBox("Zakat paid (" + zPct + "%)", fmtCurrency(totalZakat), "deducted each year-end", "zakat");
    $("g_stats").innerHTML = gStats;
    drawChart($("g_chart"),
      [{ values: accSeries, color: GC, fill: true }],
      { totalYears: state.growth.years });
    $("g_legend").innerHTML = legendHTML([{ color: GC, label: accLabel }]);
    renderGrowthTable(g);

    /* ---- Withdrawal panel ---- */
    [$("w_start"), $("cw_start")].forEach(function (el) { if (el) el.disabled = state.link; });

    var lastsValue = w.sustainable ? "Never depletes 🎉" : monthsToText(w.lastsMonths);
    var lastsSub = w.sustainable ? "Returns out-pace withdrawals at this rate" : "until the corpus hits zero";
    var wStats =
      statBox("Money lasts", lastsValue, lastsSub, "big " + (w.sustainable ? "ok" : "warn")) +
      statBox("🛟 Max safe / mo", safe >= 1 ? fmtCurrency(safe) : fmtCurrency(0), safeSub, "ok") +
      statBox("Starting corpus", fmtCurrency(w.startBalance), state.link ? "linked from Growth" : "manual", "") +
      statBox("Total withdrawn", fmtCurrency(w.totalWithdrawn), null, "withdraw");
    if (zOn) wStats += statBox("Zakat paid (" + zPct + "%)", fmtCurrency(w.zakatPaid), w.sustainable ? "over " + SUSTAIN_DISPLAY_YEARS + "y shown" : "until depletion", "zakat");
    $("w_stats").innerHTML = wStats;
    drawChart($("w_chart"),
      [{ values: w.displaySeries, color: WC, fill: true }],
      { totalYears: w.displaySeries.length / 12 });
    $("w_legend").innerHTML = legendHTML([{ color: WC, label: "Remaining corpus" + (w.displayCapped ? " · first " + SUSTAIN_DISPLAY_YEARS + " yrs (never depletes)" : "") }]);
    renderWithdrawalTable(w);

    /* ---- Combined panel ---- */
    if ($("cw_start")) $("cw_start").disabled = state.link;
    syncEmergencyVisibility();

    $("cg_mini").className = "card mini-result growth";
    $("cg_mini").innerHTML =
      '<div class="mini-title">After ' + trim(state.growth.years) + " years you have</div>" +
      '<div class="mini-main">' + fmtCurrency(totalFinal) + "</div>" +
      '<div class="mini-sub">' + wordsHint(totalFinal) + "</div>" +
      '<div class="mini-row"><span>Invested</span><b>' + fmtAbbrev(totalInvested) + "</b></div>" +
      '<div class="mini-row"><span>Profit</span><b>' + fmtAbbrev(totalProfit) + "</b></div>" +
      (efOn ? '<div class="mini-row"><span>Emergency fund</span><b>' + fmtAbbrev(e.finalBalance) + "</b></div>" : "") +
      (zOn ? '<div class="mini-row"><span>Zakat paid</span><b>' + fmtAbbrev(totalZakat) + "</b></div>" : "");

    var corpusSub = w.startBalance > 0 ? "from " + abbrevCur(w.startBalance) + " corpus" : "";
    $("cw_mini").className = "card mini-result withdraw";
    $("cw_mini").innerHTML =
      '<div class="mini-title">Drawing ' + fmtCurrency(num(state.withdrawal.monthly)) + "/mo, it lasts</div>" +
      '<div class="mini-main">' + lastsValue + "</div>" +
      '<div class="mini-sub">' + corpusSub + "</div>" +
      '<div class="mini-row"><span>🛟 Max safe / mo</span><b>' + (safe >= 1 ? fmtAbbrev(safe) : fmtCurrency(0)) + "</b></div>" +
      '<div class="mini-row"><span>From corpus</span><b>' + fmtAbbrev(w.startBalance) + "</b></div>" +
      '<div class="mini-row"><span>Total drawn</span><b>' + fmtAbbrev(w.totalWithdrawn) + "</b></div>" +
      (zOn ? '<div class="mini-row"><span>Zakat paid</span><b>' + fmtAbbrev(w.zakatPaid) + "</b></div>" : "");

    // Two separate charts (accumulation + drawdown), each self-scaled, so a
    // never-depleting or very-long drawdown can't squash the growth phase.
    drawChart($("c_chart_growth"),
      [{ values: accSeries, color: GC, fill: true }],
      { totalYears: state.growth.years });
    $("cg_chart_legend").innerHTML = legendHTML([{ color: GC, label: accLabel }]);

    drawChart($("c_chart_withdraw"),
      [{ values: w.displaySeries, color: WC, fill: true }],
      { totalYears: w.displaySeries.length / 12 });
    $("cw_chart_legend").innerHTML = legendHTML([{ color: WC, label: "Remaining corpus" + (w.displayCapped ? " · first " + SUSTAIN_DISPLAY_YEARS + " yrs" : "") }]);

    renderZakatBar();
    syncInputs();
    saveState();
    scheduleAutoSave();
  }

  // "Rs 2.16 Cr" style label (no leading ≈).
  function abbrevCur(n) { return (state.currency ? state.currency + " " : "") + abbrev(n); }

  // Show/hide the emergency-fund detail fields based on the toggle.
  function syncEmergencyVisibility() {
    var on = state.emergency.enabled;
    document.querySelectorAll(".ef-fields").forEach(function (el) { el.classList.toggle("hidden", !on); });
    EF_ENABLE_IDS.forEach(function (id) { var el = $(id); if (el) el.checked = on; });
  }

  /* -------------------------- Canvas charts ----------------------------- */
  // Lightweight area/line chart. datasets: [{values:[], color, fill}].
  // Null values break the line into segments (used for the two-phase chart).
  function drawChart(canvas, datasets, opts) {
    opts = opts || {};
    var dpr = window.devicePixelRatio || 1;
    // Capture the intended CSS height ONCE — setting canvas.height reflects back to
    // the height attribute, so re-reading it would compound by dpr every render.
    if (canvas._cssH == null) canvas._cssH = parseInt(canvas.getAttribute("height"), 10) || 240;
    var cssH = canvas._cssH;
    canvas.style.width = "100%";
    canvas.style.height = cssH + "px"; // pin display height; bitmap is dpr-scaled below
    var cssW = canvas.clientWidth || canvas.parentElement.clientWidth || 600;
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
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
    // For a never-depleting run, stop the table at the shown horizon too.
    var maxRows = w.sustainable ? SUSTAIN_DISPLAY_YEARS : 60;
    var rows = w.yearly.slice(0, maxRows);
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
    EMERGENCY_MAP.forEach(function (entry) {
      entry[1].forEach(function (id) { setVal(id, state.emergency[entry[0]]); });
    });
    LINK_IDS.forEach(function (id) { var el = $(id); if (el) el.checked = state.link; });
    EF_ENABLE_IDS.forEach(function (id) { var el = $(id); if (el) el.checked = state.emergency.enabled; });

    // hint words — individual tabs and combined view
    setHint("g_start_words", state.growth.start);
    setHint("g_monthly_words", state.growth.monthly);
    setHint("w_start_words", state.withdrawal.start);
    setHint("w_monthly_words", state.withdrawal.monthly);
    setHint("cg_start_words", state.growth.start);
    setHint("cg_monthly_words", state.growth.monthly);
    setHint("cw_start_words", state.withdrawal.start);
    setHint("cw_monthly_words", state.withdrawal.monthly);
    setHint("ef_start_words", state.emergency.start);
    setHint("cef_start_words", state.emergency.start);
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
    EMERGENCY_MAP.forEach(function (entry) {
      var key = entry[0];
      entry[1].forEach(function (id) {
        var el = $(id); if (!el) return;
        el.addEventListener("input", function () {
          state.emergency[key] = num(el.value);
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
    EF_ENABLE_IDS.forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener("change", function () {
        state.emergency.enabled = el.checked;
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
      if (s.emergency) Object.assign(state.emergency, s.emergency);
      if (typeof s.link === "boolean") state.link = s.link;
      if (s.zakat) Object.assign(state.zakat, s.zakat);
      if (s.currency != null) state.currency = s.currency;
      if (s.fxNote != null) state.fxNote = s.fxNote;
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
  // Format an amount in a specific saved currency (history items keep their own).
  function fmtCur(n, sym) {
    if (!isFinite(n)) n = 0;
    var s = sym ? sym + " " : "";
    return (n < 0 ? "-" : "") + s + Math.abs(Math.round(n)).toLocaleString("en-IN");
  }
  function buildScenario(label, auto) {
    var g = computeGrowth(state.growth, state.zakat);
    var e = state.emergency.enabled ? computeGrowth(emergencyAsGrowth(), state.zakat) : null;
    var totalFinal = g.finalBalance + (e ? e.finalBalance : 0);
    if (state.link) state.withdrawal.start = Math.round(totalFinal);
    var w = computeWithdrawal(state.withdrawal, state.zakat);
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      label: label,
      auto: !!auto,
      date: new Date().toISOString(),
      currency: state.currency,
      growth: Object.assign({}, state.growth),
      withdrawal: Object.assign({}, state.withdrawal),
      emergency: Object.assign({}, state.emergency),
      zakat: Object.assign({}, state.zakat),
      link: state.link,
      summary: {
        finalBalance: totalFinal,
        invested: g.totalInvested + (e ? e.totalInvested : 0),
        zakatPaid: g.zakatPaid + (e ? e.zakatPaid : 0) + w.zakatPaid,
        lasts: w.sustainable ? "Never depletes" : monthsToText(w.lastsMonths),
      },
    };
  }
  function saveScenario() {
    var permanentCount = getHistory().filter(function (x) { return !x.auto; }).length;
    var label = ($("saveLabel").value || "").trim() || "Scenario " + (permanentCount + 1);
    var h = getHistory();
    h.unshift(buildScenario(label, false));
    setHistory(h);
    lastSavedSig = scenarioSig();
    $("saveLabel").value = "";
    renderHistory();
    setAutoStatus("Saved");
    toast("Saved “" + label + "”");
  }

  function renderHistory() {
    var h = getHistory();
    var box = $("historyList");
    if (!h.length) { box.innerHTML = '<div class="empty">No saved scenarios yet. Tap “Save” on the Combined tab — or just keep editing; it auto-saves a draft.</div>'; return; }
    box.innerHTML = h.map(function (it) {
      var d = new Date(it.date);
      var sym = it.currency != null ? it.currency : state.currency;
      var badge = it.auto ? '<span class="hi-badge">Auto</span>' : "";
      var zRow = (it.summary.zakatPaid != null && it.summary.zakatPaid > 0)
        ? '<div class="hi-stat"><span>Zakat paid</span><span>' + fmtCur(it.summary.zakatPaid, sym) + "</span></div>" : "";
      return '<div class="history-item' + (it.auto ? " is-auto" : "") + '" data-id="' + it.id + '">' +
        '<button class="hi-del" data-del="' + it.id + '" title="Delete">✕</button>' +
        '<div class="hi-label">' + escapeHtml(it.label) + badge + "</div>" +
        '<div class="hi-date">' + d.toLocaleDateString() + " · " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "</div>" +
        '<div class="hi-stat"><span>Final value</span><span>' + fmtCur(it.summary.finalBalance, sym) + "</span></div>" +
        '<div class="hi-stat"><span>Invested</span><span>' + fmtCur(it.summary.invested, sym) + "</span></div>" +
        zRow +
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
    if (it.emergency) Object.assign(state.emergency, it.emergency);
    if (it.zakat) Object.assign(state.zakat, it.zakat);
    state.link = !!it.link;
    if (it.currency != null) { state.currency = it.currency; state.fxNote = ""; } // amounts are already in saved currency
    lastSavedSig = scenarioSig();
    applyCurrency(); renderZakatBar(); render();
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
    renderFxNote();
  }

  /* ----------------------- Zakat + FX controls -------------------------- */
  function renderZakatBar() { renderZakatControls(); renderFxNote(); }
  function renderZakatControls() {
    var t = $("zakatToggle"); if (t) t.checked = state.zakat.enabled;
    var r = $("zakatRate"); if (r) { if (document.activeElement !== r) r.value = state.zakat.rate; r.disabled = !state.zakat.enabled; }
  }
  function renderFxNote() {
    var el = $("fxNote"); if (!el) return;
    el.textContent = state.fxNote || "";
    el.style.display = state.fxNote ? "" : "none";
  }

  // ---- live exchange rates (open.er-api.com, keyless, CORS-enabled) ----
  function fxCacheGet(base) {
    try {
      var all = JSON.parse(localStorage.getItem(LS_FX) || "{}");
      var e = all[base];
      if (e && (Date.now() - e.t) < FX_TTL_MS) return e;
    } catch (err) {}
    return null;
  }
  function fxCacheSet(base, rates, updated) {
    try {
      var all = JSON.parse(localStorage.getItem(LS_FX) || "{}");
      all[base] = { t: Date.now(), rates: rates, updated: updated };
      localStorage.setItem(LS_FX, JSON.stringify(all));
    } catch (err) {}
  }
  function fetchRates(base) {
    var cached = fxCacheGet(base);
    if (cached) return Promise.resolve(cached);
    return fetch(FX_API + base).then(function (r) { return r.json(); }).then(function (d) {
      if (d.result !== "success" || !d.rates) throw new Error("fx failed");
      fxCacheSet(base, d.rates, d.time_last_update_utc || "");
      return { rates: d.rates, updated: d.time_last_update_utc || "" };
    });
  }
  function fxDateLabel(utc) {
    if (!utc) return "live rate";
    var d = new Date(utc);
    return isNaN(d.getTime()) ? "live rate" : "as of " + d.toLocaleDateString();
  }
  function convertAmounts(rate) {
    function cv(v) { return Math.round(num(v) * rate * 100) / 100; }
    state.growth.start = cv(state.growth.start);
    state.growth.monthly = cv(state.growth.monthly);
    state.withdrawal.monthly = cv(state.withdrawal.monthly);
    if (!state.link) state.withdrawal.start = cv(state.withdrawal.start);
    state.emergency.start = cv(state.emergency.start);
    state.emergency.monthly = cv(state.emergency.monthly);
  }
  function changeCurrency(newSym) {
    var oldSym = state.currency;
    if (oldSym === newSym) return;
    var oldISO = CURRENCY_ISO[oldSym], newISO = CURRENCY_ISO[newSym];
    // Can only convert between two known ISO currencies; otherwise just swap the symbol.
    if (!oldISO || !newISO || oldISO === newISO) {
      state.currency = newSym;
      if (!newISO) state.fxNote = "";
      applyCurrency(); render();
      return;
    }
    toast("Fetching " + oldISO + " → " + newISO + " rate…");
    fetchRates(oldISO).then(function (res) {
      var rate = res.rates[newISO];
      if (!rate || !isFinite(rate)) throw new Error("no rate");
      convertAmounts(rate);
      state.currency = newSym;
      state.fxNote = "1 " + oldISO + " = " + (rate < 0.1 ? rate.toFixed(6) : rate.toFixed(4)) + " " + newISO + "  ·  " + fxDateLabel(res.updated);
      applyCurrency(); render();
      lastSavedSig = scenarioSig(); // converted amounts shouldn't trigger an auto-save
      toast("Converted " + oldISO + " → " + newISO);
    }).catch(function () {
      state.currency = newSym;
      state.fxNote = "⚠ Live rate unavailable — amounts kept as-is";
      applyCurrency(); render();
      toast("Couldn't fetch rate — switched symbol only");
    });
  }

  /* ----------------------------- Auto-save ------------------------------ */
  function scenarioSig() {
    return JSON.stringify({ g: state.growth, w: state.withdrawal, ef: state.emergency, link: state.link, z: state.zakat });
  }
  var lastSavedSig = null;
  var autoTimer;
  function scheduleAutoSave() { clearTimeout(autoTimer); autoTimer = setTimeout(autoSave, AUTOSAVE_MS); }
  function autoSave() {
    var sig = scenarioSig();
    if (sig === lastSavedSig) return;            // nothing meaningful changed
    var h = getHistory().filter(function (x) { return !x.auto; }); // keep ONE rolling auto slot
    h.unshift(buildScenario("Auto-saved", true));
    setHistory(h); lastSavedSig = sig; renderHistory();
    setAutoStatus("Auto-saved");
  }
  function setAutoStatus(txt) {
    var el = $("autoStatus"); if (!el) return;
    el.textContent = txt + " · " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
    renderZakatBar();
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
      changeCurrency($("currencySelect").value);
    });
    $("zakatToggle").addEventListener("change", function () {
      state.zakat.enabled = this.checked;
      renderZakatBar(); render();
    });
    $("zakatRate").addEventListener("input", function () {
      state.zakat.rate = num(this.value);
      render();
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
      a.download = "fire-calculator-history.json";
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

    setupPwa();

    switchTab(state.tab || "combined");
    render();
    lastSavedSig = scenarioSig(); // baseline: don't auto-save the just-loaded state
  }

  /* ------------------------------- PWA ---------------------------------- */
  function setupPwa() {
    // Register the service worker for offline use + installability.
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
    // Custom install button (Android/desktop). iOS uses Share → Add to Home Screen.
    var deferred = null;
    var btn = $("installBtn");
    window.addEventListener("beforeinstallprompt", function (ev) {
      ev.preventDefault();
      deferred = ev;
      if (btn) btn.hidden = false;
    });
    if (btn) btn.addEventListener("click", function () {
      if (!deferred) { toast("On iPhone: Share → Add to Home Screen"); return; }
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; btn.hidden = true; });
    });
    window.addEventListener("appinstalled", function () { if (btn) btn.hidden = true; });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }

  // Exposed for unit testing under Node; no effect in the browser.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      computeGrowth: computeGrowth, computeWithdrawal: computeWithdrawal,
      safeMonthlyWithdrawal: safeMonthlyWithdrawal, lastsForever: lastsForever, abbrev: abbrev,
    };
  }
})();
