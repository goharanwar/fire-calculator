/* Sanity tests for the financial engines. Run: `node test.js` (or `npm test`). */
var engine = require("./app.js");
var computeGrowth = engine.computeGrowth;
var computeWithdrawal = engine.computeWithdrawal;

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

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
