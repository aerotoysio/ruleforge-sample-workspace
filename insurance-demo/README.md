# SkyShield Insurance — RuleForge web demo

A small, self-contained showcase: an insurance company front-end (travel + ski
quotes) where **every premium is priced by the [RuleForge](https://github.com/aerotoysio/ruleforge)
engine** at request time. Built to be run with the engine in debug mode from
Visual Studio so you can set breakpoints and watch a real request walk the DAG.

```
insurance-demo/
├── engine-fixtures/                 # what the engine serves (flat engine layout)
│   ├── rules/
│   │   ├── insurance-quote.v1.json  # input → shell → set/lookup → calc → output
│   │   └── _endpoint-bindings.json  # POST /v1/insurance/quote → insurance-quote@1
│   └── refs/
│       ├── ref-insurance-rates.json # daily rate × productType × region × level
│       ├── ref-cover-options.json   # medical cover + excess × level
│       └── ref-currency-rates.json  # currency + FX rate (from GBP) × country
├── web/                             # the static front-end
│   ├── index.html                   # landing page
│   ├── travel.html                  # travel quote form
│   ├── ski.html                     # ski quote form
│   ├── app.js                       # form → engine → render (+ offline fallback)
│   └── styles.css
├── serve.js                         # zero-dependency static server for web/
└── README.md
```

> **Note on layout.** These rules are in the engine's **flat** fixture shape
> (`<id>.v<n>.json` + `_endpoint-bindings.json`) so the engine can serve them
> directly with no build/compile step. That's different from the editor's
> folder-per-rule layout used by the rules in `../rules/`. See the repo root
> README for the distinction.

## Run it

### 1. Start the engine (Visual Studio — debug)

Open `ruleforge/RuleForge.slnx`, set **RuleForge.Api** as the startup project,
pick the **`RuleForge.Api (insurance demo)`** launch profile, and press **F5**.

That profile (in `ruleforge/src/RuleForge.Api/Properties/launchSettings.json`)
sets the engine to read this folder's fixtures and listen on
`http://localhost:5050`:

| Variable | Value |
|---|---|
| `ASPNETCORE_ENVIRONMENT` | `Development` (enables CORS for the browser) |
| `RULEFORGE_RULE_SOURCE` | `local` |
| `RULEFORGE_FIXTURES_DIR` | `…/ruleforge-sample-workspace/insurance-demo/engine-fixtures/rules` |
| `RULEFORGE_REFS_DIR` | `…/ruleforge-sample-workspace/insurance-demo/engine-fixtures/refs` |

Set a breakpoint in `src/RuleForge.Core/Evaluators/CalcEvaluator.cs` (or anywhere
in the runner) and submit a quote — you'll catch the request mid-evaluation.

> The absolute paths in the launch profile assume the two repos are cloned
> side by side under the same parent folder. Adjust if yours differ.

**Prefer the CLI?** From the `ruleforge` repo:

```bash
dotnet run --project src/RuleForge.Cli -- serve \
  --fixtures "../ruleforge-sample-workspace/insurance-demo/engine-fixtures/rules" \
  --refs     "../ruleforge-sample-workspace/insurance-demo/engine-fixtures/refs" \
  --port 5050
```

### 2. Serve the web pages

```bash
node serve.js            # → http://localhost:8080   (zero dependencies)
# or:  npx serve web      # or VS Code "Live Server", etc.
```

### 3. Open it

Visit **http://localhost:8080**. The header shows a live **Engine connected /
offline** pill (click it to change the engine URL). Pick Travel or Ski, fill in
the form, and **Get my quote** — you'll see the premium, a breakdown, and the
live per-node RuleForge trace.

If the engine isn't running, the page still returns an **indicative estimate**
computed in the browser (clearly labelled), so the UI is always demoable.

## The endpoint contract

`POST /v1/insurance/quote`

```jsonc
// request
{
  "productType": "travel",        // travel | ski
  "destinationRegion": "europe",  // domestic | europe | worldwide | usa-canada
  "coverageLevel": "standard",    // basic | standard | premium
  "tripDurationDays": 8,
  "travelerCount": 2,
  "maxTravelerAge": 34,
  "countryIso": "FR"             // ISO-3166 alpha-2 → billing currency
}
```

```jsonc
// response envelope (result shown; add ?debug=1 for the per-node trace)
{
  "ruleId": "insurance-quote", "ruleVersion": 1, "decision": "apply",
  "result": {
    "type": "INSURANCE", "productType": "travel", "region": "europe",
    "coverageLevel": "standard", "currency": "GBP", "travellers": 2,
    "durationDays": 8, "ageBand": "26-49", "baseDailyRate": 3.00,
    "medicalCoverGbp": 5000000, "excessGbp": 100, "ageLoadingPct": 0, "premium": 48.00,
    "localCurrency": "EUR", "fxRate": 1.17, "premiumLocal": 56.16
  }
}
```

**Pricing:** `premium = baseDailyRate × days × travellers × (1 + ageLoadingPct/100)`

The rule chains lookups and conditionals:

1. **`baseDailyRate`** — looked up from `ref-insurance-rates` by *(productType × region × level)*.
2. **Cover options** — `medicalCoverGbp` + `excessGbp` looked up from `ref-cover-options` by *level*.
3. **`ageBand`** — a calc with nested `if/then/else` turning `maxTravelerAge` into a band:
   `0-17 · 18-25 · 26-49 · 50-65 · 66-79 · 80+`.
4. **`ageLoadingPct`** — a calc with nested `if/then/else` over **band × coverage level**:

   | band   | basic | standard | premium |
   |--------|------:|---------:|--------:|
   | 0-17   |   0%  |    0%    |   5%    |
   | 18-25  |   5%  |   10%    |  15%    |
   | 26-49  |   0%  |    0%    |   0%    |
   | 50-65  |  15%  |   25%    |  35%    |
   | 66-79  |  40%  |   55%    |  75%    |
   | 80+    |  80%  |  100%    | 130%    |

5. **Local currency** — `localCurrency` + `fxRate` looked up from `ref-currency-rates` by `countryIso`, then `premiumLocal = Round(premium × fxRate, 2)`. The premium is computed in GBP and converted for the buyer's currency.

Edit the rule (or the tables) in the editor, **Test** to re-stage, `POST /admin/refresh`, and quotes change — no redeploy.

> **Why bands are a calc, not a lookup.** The engine's reference lookups are
> *exact-match* and their `matchOn` resolves against the **request** or `$ctx`
> only — not the working record. A calc, by contrast, writes onto the record and
> reads request + record + context. So *ranges* (age → band) and any value
> *derived mid-graph* belong in a calc; *exact-key tables* (rate by region/level,
> cover by level) belong in lookups. This rule shows both.

## Editing the rule in the editor (live-edit loop)

The same rule also lives as an **editor rule** at
`ruleforge-sample-workspace/rules/insurance-quote.json`. Open RuleForge Editor
(`npm run dev` in `ruleforge-editor`, workspace = this repo) and you'll see
**Insurance quote — travel + ski** on the canvas: input → quote shell →
set/lookup → calc → output. Press **Test** in the editor to run it on a sample
payload right there.

To make the editor rule *drive the web demo* — edit a rule, watch the quote change:

1. In the editor, open the rule and press **Test** once. This compiles every
   rule to engine shape under `<workspace>/.engine-staging/`.
2. Run the engine with the **`RuleForge.Api (editor staging)`** launch profile
   (it reads `.engine-staging` + `<workspace>/refs`).
3. Edit the rule → **Test** again (re-stages) → `POST /admin/refresh` (or just
   restart) → the SkyShield pages show the new pricing.

> `.engine-staging/` is regenerated on every Test and is gitignored, so it only
> exists after you've run a Test at least once. The **`insurance demo`** profile
> (committed `engine-fixtures/`) needs no editor and always works — use that if
> you just want the demo running standalone.

## Engine change this demo relies on

`RuleForge.Api` gained a **Development-only CORS policy** so a browser on another
origin/port can call the engine. It's a no-op in Production. See the `AddCors` /
`UseCors("demo")` lines in `ruleforge/src/RuleForge.Api/Program.cs`.
