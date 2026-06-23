/* Sanity tests for the financial engines. Run: `node test.js` (or `npm test`). */
var engine = require("./app.js");
var computeGrowth = engine.computeGrowth;
var computeWithdrawal = engine.computeWithdrawal;
var safeMonthlyWithdrawal = engine.safeMonthlyWithdrawal;
var lastsForever = engine.lastsForever;

function approx(a, b, tol) { return Math.abs(a - b) <= tol; }
var pass = 0, fail = 0;
function t(name, cond, extra) {
  if (cond) { pass++; console.log("✓", name); }
  else { fail++; console.log("✗", name, extra || ""); }
}

// 1) Lump sum, no contributions vs closed-form compound interest.
var g = computeGrowth({ start: 100000, monthly: 0, stepup: 0, rate: 12, years: 10, timing: "end" });
var expect = 100000 * Math.pow(1 + 0.12 / 12, 120);
t("lump-sum FV matches formula", approx(g.finalBalance, expect, 1));
t("lump-sum invested equals start", approx(g.totalInvested, 100000, 0.001));
t("lump-sum profit = FV - invested", approx(g.totalProfit, g.finalBalance - 100000, 0.01));

// 2) Pure SIP vs ordinary-annuity future value formula.
var i = 0.12 / 12, sipFV = 10000 * (Math.pow(1 + i, 120) - 1) / i;
var g2 = computeGrowth({ start: 0, monthly: 10000, stepup: 0, rate: 12, years: 10, timing: "end" });
t("SIP FV matches annuity formula", approx(g2.finalBalance, sipFV, 1));
t("SIP invested = 120 * 10000", approx(g2.totalInvested, 1200000, 0.01));

// 3) Annuity-due (start of month) earns one extra period of growth.
var gDue = computeGrowth({ start: 0, monthly: 10000, stepup: 0, rate: 12, years: 10, timing: "begin" });
t("annuity-due > ordinary", gDue.finalBalance > g2.finalBalance);
t("annuity-due / ordinary ~= (1 + i)", approx(gDue.finalBalance / g2.finalBalance, 1 + i, 0.0001));
t("10 yearly breakdown rows", g2.yearly.length === 10);

// 4) Drawdown at 0% return depletes in exactly corpus / withdrawal months.
var w = computeWithdrawal({ start: 1000000, monthly: 10000, stepup: 0, rate: 0, timing: "end" });
t("0% drawdown lasts ~100 months", w.depleted && approx(w.lastsMonths, 100, 1));
t("total withdrawn ~= 1,000,000", approx(w.totalWithdrawn, 1000000, 10000));

// 5) Small withdrawals from a large, growing corpus never deplete.
var w2 = computeWithdrawal({ start: 10000000, monthly: 1000, stepup: 0, rate: 12, timing: "end" });
t("low draw on high corpus is sustainable", w2.sustainable === true);
t("sustainable run caps display series to 40y", w2.displayCapped === true && w2.displaySeries.length === 40 * 12 + 1);
t("sustainable totals are horizon-capped (not 100y)", approx(w2.totalWithdrawn, 1000 * 12 * 40, 1));

// 6) Zakat: 2.5% of a static corpus is removed at each year-end.
var gz = computeGrowth({ start: 100000, monthly: 0, stepup: 0, rate: 0, years: 1, timing: "end" }, { enabled: true, rate: 2.5 });
t("Zakat removes 2.5% at year-end", approx(gz.finalBalance, 97500, 0.01) && approx(gz.zakatPaid, 2500, 0.01));

// 7) Zakat drags down growth vs no Zakat, and is reported.
var gNoZ = computeGrowth({ start: 100000, monthly: 10000, stepup: 0, rate: 12, years: 10, timing: "end" });
var gZ = computeGrowth({ start: 100000, monthly: 10000, stepup: 0, rate: 12, years: 10, timing: "end" }, { enabled: true, rate: 2.5 });
t("Zakat lowers final balance", gZ.finalBalance < gNoZ.finalBalance && gZ.zakatPaid > 0);

// 8) Zakat makes a borderline drawdown deplete sooner.
var wNoZ = computeWithdrawal({ start: 1000000, monthly: 6000, stepup: 0, rate: 6, timing: "end" });
var wZ = computeWithdrawal({ start: 1000000, monthly: 6000, stepup: 0, rate: 6, timing: "end" }, { enabled: true, rate: 2.5 });
t("Zakat shortens how long money lasts", wZ.lastsMonths < wNoZ.lastsMonths);

// 9) Safe withdrawal ≈ monthly interest when there's no step-up/Zakat (C × i).
var corpus = 10000000, monthlyRate = 0.10 / 12;
var safe = safeMonthlyWithdrawal(corpus, 10, 0, 0, "end");
t("safe ≈ corpus × monthly rate", approx(safe, corpus * monthlyRate, corpus * monthlyRate * 0.06), "got " + Math.round(safe));
t("withdrawing the safe amount is sustainable", lastsForever(corpus, safe, 10, 0, 0, "end") === true);
t("5% above safe depletes", lastsForever(corpus, safe * 1.05, 10, 0, 0, "end") === false);

// 10) The solver agrees with the main withdrawal engine.
var safe2 = safeMonthlyWithdrawal(corpus, 10, 5, 0, "end");
t("solver result is sustainable in computeWithdrawal",
  computeWithdrawal({ start: corpus, monthly: safe2, stepup: 5, rate: 10, timing: "end" }).sustainable === true);
t("10% above solver result is not sustainable",
  computeWithdrawal({ start: corpus, monthly: safe2 * 1.1, stepup: 5, rate: 10, timing: "end" }).sustainable === false);

// 11) Step-up and Zakat each lower the safe amount.
t("withdrawal step-up lowers safe amount", safeMonthlyWithdrawal(corpus, 10, 8, 0, "end") < safe);
t("Zakat lowers safe amount", safeMonthlyWithdrawal(corpus, 10, 0, 0.025, "end") < safe);

// 12) No corpus → no safe withdrawal.
t("zero corpus yields zero safe withdrawal", safeMonthlyWithdrawal(0, 10, 0, 0, "end") === 0);

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
