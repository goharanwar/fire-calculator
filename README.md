# 📈 FIRE Calculator — Compound Growth & Withdrawal

A custom, self-contained financial calculator that shows **accumulation (growth)**
and **decumulation (withdrawal)** *at the same time* — so you can answer the two
questions that actually matter together:

> *"If I invest like this for N years… how big does it get?"*
> *"…and once I start withdrawing, how long will it last?"*

The withdrawal phase's starting corpus is **automatically fed from the growth
result** (toggleable), which is the whole point of this tool.

No frameworks, no build step, no servers, no tracking. One HTML file + one CSS
file + one JS file. Everything runs in your browser and saves to local storage.

---

## Features

- **🔗 Combined view** — growth on the left, withdrawal on the right, the growth
  final value flowing straight into the withdrawal corpus. A single chart shows
  the full journey: the accumulation curve in teal, the drawdown curve in red,
  meeting at the moment you stop investing and start withdrawing.
- **🌱 Growth tab** — starting amount, monthly contribution, **annual step-up %**
  (your contribution grows each year), expected annual return, number of years,
  and contribution timing (start/end of month). Shows final value, total
  invested, total profit, a chart, and a year-by-year table.
- **💸 Withdrawal tab** — starting corpus (linked or manual), monthly withdrawal,
  **annual withdrawal step-up %** (inflation), expected return. Tells you exactly
  **how long the money lasts** (or that it never depletes), total withdrawn, and
  a year-by-year drawdown table.
- **🕘 History** — save any scenario with a label; it's stored in local storage.
  Click to reload it, delete individual entries, or **export / import** the whole
  history as JSON to move it between devices.
- **Quality-of-life** — light/dark theme, switchable currency symbol
  (Rs / ₹ / $ / £ / € / none), Indian-style short forms (K / L / Cr), inputs
  remembered between visits, fully responsive for phone & desktop.

> Estimates only — not financial advice. Markets don't grow at a fixed rate.

---

## The math (so you can trust the numbers)

Everything is simulated **month by month** rather than with a single closed-form
formula, so step-ups and timing behave correctly.

**Growth**, each month `i = annualRate / 12`:
- *End of month:* `balance = balance × (1 + i) + contribution`
- *Start of month:* `balance = (balance + contribution) × (1 + i)`
- The contribution increases by the step-up % at the start of each new year.

**Withdrawal**, each month, until the balance hits zero (capped at 100 years):
- *End of month:* `balance = balance × (1 + i) − withdrawal`
- *Start of month:* `balance = (balance − withdrawal) × (1 + i)`
- The withdrawal increases by the step-up % each year. If returns out-pace
  withdrawals forever, it reports **"Never depletes."**

These engines are unit-tested against the standard compound-interest and
ordinary/annuity-due future-value formulas — see `test.js`.

```bash
npm test        # runs the engine sanity tests under Node
```

---

## Run it locally

It's just static files. Any of these work:

```bash
# Option A — open directly
open index.html            # (double-clicking the file works too)

# Option B — tiny built-in server (no dependencies)
node serve.js              # → http://localhost:8080

# Option C — any static server
python3 -m http.server 8080
```

---

## Deploy it for free

### GitHub Pages (automated)
A workflow at `.github/workflows/deploy.yml` publishes the repo on every push to
`main`. **One-time setup:** go to **Settings → Pages → Source → "GitHub Actions"**.
After the next push it'll be live at `https://goharanwar.github.io/fire-calculator/`.

### Netlify (drag-and-drop, ~30 seconds)
1. Go to <https://app.netlify.com/drop>
2. Drag this folder onto the page. Done. (Or connect the repo — no build command,
   publish directory `.` — see `netlify.toml`.)

### Cloudflare Pages / Vercel / anything
Point it at the repo with **no build command** and an output directory of `.`.

---

## Files

| File           | Purpose                                             |
| -------------- | --------------------------------------------------- |
| `index.html`   | Markup and layout for all four tabs                 |
| `styles.css`   | Theme, layout, light/dark variables                 |
| `app.js`       | Financial engines, canvas charts, state, history    |
| `test.js`      | Node unit tests for the financial engines           |
| `serve.js`     | Dependency-free local static server                 |
| `netlify.toml` | Netlify deploy config                               |
