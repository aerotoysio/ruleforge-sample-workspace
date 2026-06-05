/* SkyShield Insurance — RuleForge demo front-end
 *
 * Collects a quote request from the form, POSTs it to the RuleForge engine
 * (POST /v1/insurance/quote?debug=1) and renders the returned envelope. If the
 * engine can't be reached it falls back to an indicative client-side estimate
 * that mirrors the engine's rule, so the page is always demoable.
 *
 * The engine is authored in: ../engine-fixtures/rules/insurance-quote.v1.json
 * Rates table mirrors:        ../engine-fixtures/refs/ref-insurance-rates.json
 */
(() => {
  "use strict";

  const DEFAULT_ENGINE = "http://localhost:5050";
  const LS_KEY = "skyshield.engineBase";

  const engineBase = () => (localStorage.getItem(LS_KEY) || DEFAULT_ENGINE).replace(/\/+$/, "");

  // ── Rate table — must match ref-insurance-rates.json ──────────────────────
  const RATES = {
    travel: {
      domestic:    { basic: 1.20, standard: 1.80, premium: 2.60 },
      europe:      { basic: 2.00, standard: 3.00, premium: 4.50 },
      worldwide:   { basic: 3.50, standard: 5.00, premium: 7.50 },
      "usa-canada":{ basic: 4.50, standard: 6.50, premium: 9.50 },
    },
    ski: {
      domestic:    { basic: 2.20, standard: 3.20, premium: 4.50 },
      europe:      { basic: 3.40, standard: 4.90, premium: 7.20 },
      worldwide:   { basic: 5.80, standard: 8.20, premium: 12.00 },
      "usa-canada":{ basic: 7.20, standard: 10.20, premium: 14.50 },
    },
  };

  const REGION_LABEL = {
    domestic: "Domestic (UK)",
    europe: "Europe",
    worldwide: "Worldwide",
    "usa-canada": "USA & Canada",
  };

  const NODE_LABELS = {
    n1: "Input", n2: "Quote shell", n3: "Set product type", n4: "Set region",
    n5: "Set coverage level", n6: "Set travellers", n7: "Set duration",
    n8: "Lookup base daily rate", n9: "Lookup medical cover", n10: "Lookup excess",
    n11: "Age band", n12: "Age × level loading %", n13: "Premium (GBP)",
    n14: "Lookup local currency", n15: "Lookup FX rate", n16: "Premium (local)", n17: "Output",
  };

  const CUR_SYMBOL = { GBP: "£", USD: "$", EUR: "€", AED: "د.إ", AUD: "A$", CAD: "C$", NZD: "NZ$", CHF: "CHF ", SGD: "S$", JPY: "¥", ZAR: "R", INR: "₹" };

  // Age banding — mirrors the engine's "Age band" calc (if/then/else).
  const ageBandOf = (age) =>
    age < 18 ? "0-17" : age <= 25 ? "18-25" : age <= 49 ? "26-49" : age <= 65 ? "50-65" : age <= 79 ? "66-79" : "80+";

  // Age-band × cover-level loading % — mirrors the engine's "Age x level loading" calc.
  const LOADINGS = {
    "0-17":  { basic: 0,  standard: 0,   premium: 5 },
    "18-25": { basic: 5,  standard: 10,  premium: 15 },
    "26-49": { basic: 0,  standard: 0,   premium: 0 },
    "50-65": { basic: 15, standard: 25,  premium: 35 },
    "66-79": { basic: 40, standard: 55,  premium: 75 },
    "80+":   { basic: 80, standard: 100, premium: 130 },
  };
  const loadingFor = (band, level) => (LOADINGS[band]?.[level]) ?? 0;

  // Per-level cover options — mirrors ref-cover-options.json.
  const COVER = {
    basic:    { medicalCoverGbp: 2000000,  excessGbp: 150 },
    standard: { medicalCoverGbp: 5000000,  excessGbp: 100 },
    premium:  { medicalCoverGbp: 10000000, excessGbp: 50 },
  };

  // Country → currency + FX rate (from GBP) — mirrors ref-currency-rates.json.
  const CURRENCY = {
    GB: { currency: "GBP", rateFromGbp: 1.0 },  IE: { currency: "EUR", rateFromGbp: 1.17 },
    FR: { currency: "EUR", rateFromGbp: 1.17 }, DE: { currency: "EUR", rateFromGbp: 1.17 },
    ES: { currency: "EUR", rateFromGbp: 1.17 }, IT: { currency: "EUR", rateFromGbp: 1.17 },
    US: { currency: "USD", rateFromGbp: 1.27 }, CA: { currency: "CAD", rateFromGbp: 1.73 },
    AU: { currency: "AUD", rateFromGbp: 1.92 }, NZ: { currency: "NZD", rateFromGbp: 2.08 },
    CH: { currency: "CHF", rateFromGbp: 1.13 }, AE: { currency: "AED", rateFromGbp: 4.66 },
    SG: { currency: "SGD", rateFromGbp: 1.71 }, JP: { currency: "JPY", rateFromGbp: 196.0 },
    ZA: { currency: "ZAR", rateFromGbp: 23.5 }, IN: { currency: "INR", rateFromGbp: 106.0 },
  };

  // ── DOM helpers ───────────────────────────────────────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);
  const money = (n, cur) => `${CUR_SYMBOL[cur] || (cur ? cur + " " : "")}${Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const coverFmt = (n) => "£" + (n >= 1e6 ? `${n / 1e6}m` : Number(n).toLocaleString("en-GB"));

  // ── Engine status pill ──────────────────────────────────────────────────────
  async function pingEngine() {
    const pill = $("#engineStatus");
    if (!pill) return;
    pill.className = "engine-status";
    pill.querySelector(".label").textContent = "Checking engine…";
    try {
      const res = await fetch(`${engineBase()}/health`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error("bad status");
      pill.classList.add("online");
      pill.querySelector(".label").textContent = "Engine connected";
    } catch {
      pill.classList.add("offline");
      pill.querySelector(".label").textContent = "Engine offline — estimates only";
    }
  }

  // ── Call the engine ─────────────────────────────────────────────────────────
  async function requestEngineQuote(input) {
    const res = await fetch(`${engineBase()}/v1/insurance/quote?debug=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try { const j = await res.json(); detail = j.detail || j.error || detail; } catch {}
      throw new Error(detail);
    }
    return res.json();
  }

  // ── Client-side fallback (mirrors the rule) ──────────────────────────────────
  function fallbackQuote(input) {
    const rate = (RATES[input.productType]?.[input.destinationRegion]?.[input.coverageLevel]) ?? 0;
    const band = ageBandOf(input.maxTravelerAge);
    const loading = loadingFor(band, input.coverageLevel);
    const cover = COVER[input.coverageLevel] ?? { medicalCoverGbp: 0, excessGbp: 0 };
    const premium = Math.round(rate * input.tripDurationDays * input.travelerCount * (1 + loading / 100) * 100) / 100;
    const fx = CURRENCY[input.countryIso] ?? { currency: "GBP", rateFromGbp: 1 };
    const premiumLocal = Math.round(premium * fx.rateFromGbp * 100) / 100;
    return {
      ruleId: "insurance-quote (local fallback)", ruleVersion: 1, decision: rate ? "apply" : "skip",
      result: {
        type: "INSURANCE", productType: input.productType, region: input.destinationRegion,
        coverageLevel: input.coverageLevel, currency: "GBP", travellers: input.travelerCount,
        durationDays: input.tripDurationDays, ageBand: band, baseDailyRate: rate,
        medicalCoverGbp: cover.medicalCoverGbp, excessGbp: cover.excessGbp, ageLoadingPct: loading, premium,
        localCurrency: fx.currency, fxRate: fx.rateFromGbp, premiumLocal,
      },
    };
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function renderQuote(envelope, mode) {
    const r = envelope.result || {};
    const out = $("#quoteOut");
    const cur = r.currency || "GBP";
    const localCur = r.localCurrency || cur;
    const localAmt = r.premiumLocal != null ? r.premiumLocal : r.premium;

    const traceHtml = Array.isArray(envelope.trace) && envelope.trace.length
      ? `<div class="trace"><h4>RuleForge evaluation trace</h4><ol>${envelope.trace.map((t) => {
          const oc = (t.outcome || "pass").toLowerCase();
          return `<li class="${oc}"><span class="pip"></span><span class="nm">${NODE_LABELS[t.nodeId] || t.nodeId}</span>` +
                 `<span class="ms">${t.durationMs ?? 0} ms</span></li>`;
        }).join("")}</ol></div>`
      : "";

    out.innerHTML = `
      <span class="mode-badge ${mode}">
        <span class="dot"></span>
        ${mode === "engine" ? "Live quote · RuleForge engine" : "Indicative estimate · engine offline"}
      </span>
      <div class="premium">
        <div class="amount"><span class="cur">${CUR_SYMBOL[localCur] || (localCur + " ")}</span>${Number(localAmt).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div class="cap">total premium for ${r.travellers} traveller${r.travellers === 1 ? "" : "s"} · ${r.durationDays} day${r.durationDays === 1 ? "" : "s"} of cover</div>
      </div>
      <table class="breakdown">
        <tr><th>Product</th><td>${r.productType === "ski" ? "Ski / winter sports" : "Travel"}</td></tr>
        <tr><th>Destination</th><td>${REGION_LABEL[r.region] || r.region}</td></tr>
        <tr><th>Cover level</th><td style="text-transform:capitalize">${r.coverageLevel}</td></tr>
        <tr><th>Travellers</th><td>${r.travellers}</td></tr>
        <tr><th>Days of cover</th><td>${r.durationDays}</td></tr>
        <tr><th>Age band</th><td>${r.ageBand || "—"}</td></tr>
        <tr><th>Base rate (per traveller / day)</th><td>${money(r.baseDailyRate, "GBP")}</td></tr>
        <tr><th>Age-band loading</th><td>${r.ageLoadingPct}%</td></tr>
        ${r.medicalCoverGbp ? `<tr><th>Emergency medical cover</th><td>${coverFmt(r.medicalCoverGbp)}</td></tr>` : ""}
        ${r.excessGbp != null ? `<tr><th>Policy excess</th><td>${money(r.excessGbp, "GBP")}</td></tr>` : ""}
        <tr><th>Base premium (GBP)</th><td>${money(r.premium, "GBP")}</td></tr>
        ${localCur !== "GBP" ? `<tr><th>Currency (FX from GBP)</th><td>${localCur} @ ${r.fxRate}</td></tr>` : ""}
        <tr><th>Total premium</th><td>${money(localAmt, localCur)}</td></tr>
      </table>
      ${traceHtml}
      <details class="raw">
        <summary>View raw engine response</summary>
        <pre>${JSON.stringify(envelope, null, 2)}</pre>
      </details>
    `;
  }

  // ── Form wiring ─────────────────────────────────────────────────────────────
  function diffDays(startStr, endStr) {
    const s = new Date(startStr), e = new Date(endStr);
    if (isNaN(s) || isNaN(e)) return null;
    const days = Math.round((e - s) / 86400000) + 1; // inclusive
    return days;
  }

  function collectInput(form) {
    const productType = form.dataset.product; // "travel" | "ski"
    const start = $("#startDate", form).value;
    const end = $("#endDate", form).value;
    const days = diffDays(start, end);
    return {
      input: {
        productType,
        destinationRegion: $("#region", form).value,
        coverageLevel: form.querySelector('input[name="level"]:checked')?.value,
        tripDurationDays: days,
        travelerCount: Number($("#travellers", form).value),
        maxTravelerAge: Number($("#maxAge", form).value),
        countryIso: ($("#country", form) || {}).value || "GB",
      },
      days,
    };
  }

  function validate(input, days) {
    if (days === null) return "Please choose valid start and end dates.";
    if (days < 1) return "The end date must be on or after the start date.";
    if (days > 365) return "Cover is available for up to 365 days.";
    if (!input.coverageLevel) return "Please choose a cover level.";
    if (!input.travelerCount || input.travelerCount < 1 || input.travelerCount > 12) return "Travellers must be between 1 and 12.";
    if (input.maxTravelerAge === 0 && $("#maxAge")?.value === "") return "Please enter the age of the oldest traveller.";
    if (input.maxTravelerAge < 0 || input.maxTravelerAge > 99) return "Age must be between 0 and 99.";
    return null;
  }

  async function onSubmit(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const errEl = $("#formError", form);
    const btn = $("button[type=submit]", form);
    errEl.textContent = "";

    const { input, days } = collectInput(form);
    const problem = validate(input, days);
    if (problem) { errEl.textContent = problem; return; }

    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Calculating…";
    try {
      let envelope, mode;
      try {
        envelope = await requestEngineQuote(input);
        mode = "engine";
      } catch (err) {
        console.warn("Engine call failed, using fallback estimate:", err.message);
        envelope = fallbackQuote(input);
        mode = "fallback";
      }
      renderQuote(envelope, mode);
      pingEngine(); // refresh the pill based on what just happened
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ── Engine config (editable base URL) ────────────────────────────────────────
  function wireEngineConfig() {
    const pill = $("#engineStatus");
    const cfg = $("#engineConfig");
    if (!pill || !cfg) return;
    const inp = $("input", cfg);
    inp.value = engineBase();
    pill.addEventListener("click", () => cfg.classList.toggle("show"));
    $("button", cfg).addEventListener("click", () => {
      const v = inp.value.trim();
      if (v) localStorage.setItem(LS_KEY, v); else localStorage.removeItem(LS_KEY);
      cfg.classList.remove("show");
      pingEngine();
    });
  }

  // ── Defaults: sensible trip dates ────────────────────────────────────────────
  function seedDates(form) {
    const s = $("#startDate", form), e = $("#endDate", form);
    if (!s || !e) return;
    const today = new Date();
    const start = new Date(today.getTime() + 14 * 86400000);
    const end = new Date(start.getTime() + 7 * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    s.value = iso(start);
    e.value = iso(end);
    s.min = iso(today);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#year") && ($("#year").textContent = new Date().getFullYear());
    wireEngineConfig();
    pingEngine();
    const form = $("#quoteForm");
    if (form) {
      seedDates(form);
      form.addEventListener("submit", onSubmit);
    }
  });
})();
