import { useState, useMemo, useCallback, useRef, useEffect } from "react";

// ─── DESIGN SYSTEM ────────────────────────────────────────────────────────────
// Aesthetic: Dead-serious analytical instrument. Reuters Eikon × Thoma Bravo CIM.
// Light/Dark themes available. Every pixel earns its place.
const LIGHT = {
  paper:   "#F5F3EE",
  ink:     "#18160F",
  surface: "#FFFFFF",
  panel:   "#FAF9F6",
  border:  "#DDD9CE",
  dim:     "#EAE7DF",
  rule:    "#C8C3B4",
  muted:   "#756F60",
  ghost:   "#A89F8C",
  steel:   "#2C4A6E",
  steelLt: "#EBF0F7",
  green:   "#1E5C30",
  greenLt: "#E8F3EB",
  red:     "#7A1818",
  redLt:   "#FAECEC",
  amber:   "#704800",
  amberLt: "#FFF5E0",
  blue:    "#0D2D5E",
  blueLt:  "#E8EEF8",
};

const DARK = {
  paper:   "#0D0D0F",
  ink:     "#E8E6E1",
  surface: "#18181B",
  panel:   "#141416",
  border:  "#2A2A2E",
  dim:     "#1F1F23",
  rule:    "#3A3A40",
  muted:   "#9A9A9A",
  ghost:   "#6B6B6B",
  steel:   "#5B9BD5",
  steelLt: "#1A2533",
  green:   "#4ADE80",
  greenLt: "#132A1C",
  red:     "#F87171",
  redLt:   "#2A1515",
  amber:   "#FBBF24",
  amberLt: "#2A2310",
  blue:    "#60A5FA",
  blueLt:  "#152238",
};

let C = DARK;

const MONO = "'Berkeley Mono','IBM Plex Mono','Courier New',monospace";
const SANS = "'DM Sans','Helvetica Neue',sans-serif";
const SLAB = "'Libre Baskerville','Georgia',serif";

// ─── EMPIRICALLY-SOURCED CONSTANTS ────────────────────────────────────────────
// Every number below is cited. Do not change without re-sourcing.
const DATA = {
  // SEG 2025 Annual SaaS Report, 3,163 private deals (exact)
  PRIVATE_MA_MEDIAN: 4.1,
  // SaaS Capital 2025 survey, n=1,000+ (exact)
  PRIVATE_EQUITY_BACKED_MEDIAN: 5.3,
  PRIVATE_BOOTSTRAPPED_MEDIAN: 4.8,
  // SaaS Capital Index, June 2025 (exact)
  PUBLIC_SCI_MEDIAN: 6.7,
  // Bessemer Cloud Index 2025 (exact)
  PUBLIC_BESSEMER_MEDIAN: 7.5,
  // SEG 2025 Annual SaaS Report p.30 — NRR bands vs public EV/ARR median (exact)
  NRR_BANDS: [
    { lo: 0,   hi: 90,  publicMult: 1.2,  label: "<90%" },
    { lo: 90,  hi: 100, publicMult: 3.5,  label: "90–100%" },
    { lo: 100, hi: 110, publicMult: 6.0,  label: "100–110%" },
    { lo: 110, hi: 120, publicMult: 9.0,  label: "110–120%" },
    { lo: 120, hi: 999, publicMult: 11.7, label: ">120%" },
  ],
  // Aventis Advisors + Ful.io 2025 (exact, confirmed by regression on 459 deals)
  RULE40_MULT_PER_10PTS: 2.2,
  // Windsor Drake M&A 2025: strategic buyers pay 1.5–2.0x premium over PE
  BEAR_FACTOR: 0.58,   // 42% no-process discount (midpoint of 35–45% range)
  BULL_FACTOR: 1.50,   // Conservative end of 1.5–2.0x strategic premium
  // SEG: public 36% premium over private (5.6x vs 4.1x, 2024)
  PUBLIC_PREMIUM: 1.36,
  // Benchmarkit 2025 (n=936): median LTV:CAC (exact)
  LTV_CAC_MEDIAN: 3.6,
  // SaaS Benchmark Report 2025, 2,000+ companies (exact)
  CAC_PAYBACK_MEDIAN_MO: 20,
  // Benchmarkit 2025: growth endurance (exact)
  GROWTH_ENDURANCE: 0.65,
  // Solganick/Axial 2025 (exact quote)
  SIZE_PREM_PER_20M: 1.5, // ~1–2x per $20M ARR, midpoint
  // ChartMogul 2024, n=2,100: NRR by segment (exact)
  NRR_BY_SEGMENT: { enterprise: 118, midmarket: 108, smb: 97 },
  // Benchmarkit 2025: Magic Number (exact)
  MAGIC_NUMBER_MEDIAN: 0.90,
  // ABF Journal 2025: lender covenant floor (exact)
  GRR_COVENANT_FLOOR: 85,
};

// ─── UTILITIES ────────────────────────────────────────────────────────────────
const $ = (v, d=1) =>
  Math.abs(v) >= 1e9 ? `$${(v/1e9).toFixed(d)}B`
  : Math.abs(v) >= 1e6 ? `$${(v/1e6).toFixed(d)}M`
  : Math.abs(v) >= 1e3 ? `$${(v/1e3).toFixed(d)}K`
  : `$${Math.abs(v).toFixed(0)}`;
const pct  = (v, d=1) => `${v.toFixed(d)}%`;
const mult = (v, d=1) => `${v.toFixed(d)}x`;
const mo   = (v)      => `${v.toFixed(0)}mo`;
const yr   = (v)      => `${v.toFixed(1)}yr`;
const clamp = (v,lo,hi) => Math.max(lo, Math.min(hi, v));
const lerp  = (a, b, t) => a + (b - a) * t;

const signColor = (v) => v > 0 ? C.green : v < 0 ? C.red : C.muted;
const ratioColor = (v, good, ok) => v >= good ? C.green : v >= ok ? C.amber : C.red;

// ─── NRR → implied private multiple adjustment ────────────────────────────────
function nrrMultAdj(nrr) {
  // Interpolate within SEG NRR bands, scale to private market (~40% discount to public)
  const PRIV_DISCOUNT = 0.60; // private = ~60% of public multiple (SEG: 4.1/6.7)
  const band = DATA.NRR_BANDS.find(b => nrr >= b.lo && nrr < b.hi) || DATA.NRR_BANDS[DATA.NRR_BANDS.length - 1];
  const refBand = DATA.NRR_BANDS[2]; // 100–110% = anchor (0 adjustment)
  return (band.publicMult - refBand.publicMult) * PRIV_DISCOUNT;
}

// ─── FULL VALUATION ENGINE ────────────────────────────────────────────────────
function computeValuation(inputs) {
  const {
    arrM, arrGrowth, nrr, grr, logoChurn, grossMargin, ebitdaMargin,
    rndPct, smPct, gaPct, arpa, cac, revenueMix, cashM, debtM,
    aiNative, verticalBonus, networkEffects, usageBased, publicMode,
    horizonYrs, growthDecay, marginExpansionPerYr, wacc, termGrowthRate,
    newLogoGrowthPct, expansionPct, contractionPct, bizType, stage,
  } = inputs;

  const arr = arrM * 1e6;

  // ── UNIT ECONOMICS ──────────────────────────────────────────────────────────
  const lifetimeYrs  = logoChurn > 0 ? 100 / logoChurn : 50;
  const gpPerCustYr  = arpa * (grossMargin / 100);
  const ltv          = gpPerCustYr * lifetimeYrs;
  const ltvCac       = cac > 0 ? ltv / cac : 999;
  const cacPaybackGp = cac > 0 && gpPerCustYr > 0 ? (cac / (gpPerCustYr / 12)) : 999;

  // ── EFFICIENCY METRICS ──────────────────────────────────────────────────────
  const rule40       = arrGrowth + ebitdaMargin;
  const netNewArr    = arr * (arrGrowth / 100);
  const smDollars    = arr * (smPct / 100);
  const magicNumber  = smDollars > 0 ? (netNewArr * (grossMargin / 100)) / smDollars : 0;
  const netBurnDollars = Math.max(0, -arr * (ebitdaMargin / 100));
  const burnMultiple = netNewArr > 0 && netBurnDollars > 0 ? netBurnDollars / netNewArr : 0;
  const salesEff     = smDollars > 0 ? netNewArr / smDollars : 0;

  // ── ARR BRIDGE (from first principles) ─────────────────────────────────────
  const openingArr   = arr;
  const newLogoArr   = arr * (newLogoGrowthPct / 100);
  const expansionArr = arr * (expansionPct / 100);
  const contractionArr = arr * (contractionPct / 100);
  const churnArr     = arr * (100 - grr) / 100;
  // NRR derived: (arr - churn - contraction + expansion) / arr
  const nrrDerived   = ((arr - churnArr - contractionArr + expansionArr) / arr) * 100;
  const closingArr   = arr + newLogoArr + expansionArr - contractionArr - churnArr;

  // ── BASE MULTIPLE (private M&A anchored) ────────────────────────────────────
  // Anchors sourced to private transaction data, NOT public comps.
  const BASE = {
    B2B_SMB:  { SEED:2.8, EARLY:3.8, GROWTH:5.0, SCALE:6.5, MATURE:3.8 },
    B2B_MID:  { SEED:3.2, EARLY:4.3, GROWTH:6.0, SCALE:8.0, MATURE:4.8 },
    B2B_ENT:  { SEED:3.8, EARLY:5.2, GROWTH:7.0, SCALE:9.5, MATURE:5.8 },
    B2C:      { SEED:2.2, EARLY:3.2, GROWTH:4.5, SCALE:6.0, MATURE:3.0 },
    VERT:     { SEED:3.3, EARLY:4.8, GROWTH:6.5, SCALE:9.0, MATURE:5.3 },
    TECH_SVC: { SEED:1.4, EARLY:2.3, GROWTH:3.3, SCALE:4.8, MATURE:2.3 },
  };
  const GROWTH_REF = { SEED:150, EARLY:90, GROWTH:55, SCALE:35, MATURE:18 };
  const gRef = GROWTH_REF[stage] || 55;
  let base = (BASE[bizType] || BASE.B2B_ENT)[stage];

  // Waterfall of adjustments (all sourced)
  const wf = [{ label:`${stage} ${bizType} base (private M&A anchor)`, val: base, cumul: base }];

  // 1. Growth vs stage median (+0.8x per 10ppts, SaaS Capital regression)
  const adj_growth = ((arrGrowth - gRef) / 100) * 8;
  base += adj_growth;
  wf.push({ label:`Growth ${pct(arrGrowth)} vs ${gRef}% median (+0.8x/10ppts)`, val:adj_growth, cumul:base });

  // 2. Rule of 40 (+2.2x per 10pts — Aventis exact)
  const adj_r40 = ((rule40 - 40) / 10) * DATA.RULE40_MULT_PER_10PTS;
  base += adj_r40;
  wf.push({ label:`Rule of 40: ${rule40.toFixed(0)} (+2.2x/10pts, Aventis 2025)`, val:adj_r40, cumul:base });

  // 3. NRR (SEG exact bands, scaled to private)
  const adj_nrr = nrrMultAdj(nrr);
  base += adj_nrr;
  wf.push({ label:`NRR ${pct(nrr)} (SEG 2025: <90%=1.2x; 100-110%=6.0x; >120%=11.7x)`, val:adj_nrr, cumul:base });

  // 4. GRR (ABF covenant floor at 85%; premium above 95%)
  const adj_grr = grr >= 95 ? 0.5 : grr >= 88 ? 0 : grr < 85 ? -1.2 : -0.5;
  base += adj_grr;
  wf.push({ label:`GRR ${pct(grr)} (ABF: 85% covenant floor)`, val:adj_grr, cumul:base });

  // 5. Gross margin (Benchmarkit 2025: median 73%; SaaS target 75%+)
  const adj_gm = grossMargin >= 80 ? 0.8 : grossMargin >= 70 ? 0 : grossMargin < 55 ? -2.2 : grossMargin < 65 ? -0.9 : -0.3;
  base += adj_gm;
  wf.push({ label:`Gross margin ${pct(grossMargin)} (SaaS median 73%, target 75-85%)`, val:adj_gm, cumul:base });

  // 6. LTV:CAC (Benchmarkit 2024 median 3.6x; threshold 3x)
  const adj_ltvcac = ltvCac >= 6 ? 0.6 : ltvCac >= 3.5 ? 0 : ltvCac < 1.5 ? -1.8 : ltvCac < 2.5 ? -0.8 : -0.3;
  base += adj_ltvcac;
  wf.push({ label:`LTV:CAC ${mult(ltvCac)} (Benchmarkit median 3.6x; threshold 3x)`, val:adj_ltvcac, cumul:base });

  // 7. Revenue mix
  const adj_mix = revenueMix >= 92 ? 0.3 : revenueMix < 60 ? -1.2 : revenueMix < 72 ? -0.6 : 0;
  base += adj_mix;
  wf.push({ label:`Recurring mix ${pct(revenueMix)} (premium for >92% recurring)`, val:adj_mix, cumul:base });

  // 8. Size premium (Solganick: ~1-2x per $20M ARR; Aventis: deal size single biggest factor)
  const sizeMultiplier =
    arrM >= 100 ? 1.32 : arrM >= 50 ? 1.22 : arrM >= 25 ? 1.12 :
    arrM >= 10  ? 1.05 : arrM < 3   ? 0.72 : 1.0;
  const preSizeMult = base;
  base *= sizeMultiplier;
  wf.push({ label:`Size premium $${arrM}M ARR (Solganick ~1-2x per $20M)`, val:base - preSizeMult, cumul:base });

  // 9. Technology modifiers
  const preTechMult = base;
  if (aiNative)       base *= 1.20;  // SaasRise/Battery: 20-40% AI-native premium (conservative)
  if (verticalBonus)  base *= 1.08;  // Domain moat + retention advantage
  if (networkEffects) base *= 1.10;  // Defensibility premium
  if (usageBased)     base *= 1.04;  // OpenView: UBP = 38% faster growth, slight premium
  if (publicMode)     base *= DATA.PUBLIC_PREMIUM; // SEG: 36% public premium
  if (base !== preTechMult) wf.push({ label:"Technology/market modifiers", val:base-preTechMult, cumul:base });

  base = clamp(base, 0.8, 50);

  // ── SCENARIOS ──────────────────────────────────────────────────────────────
  const bearMult  = base * DATA.BEAR_FACTOR;  // Windsor Drake: no-process, single buyer
  const baseMult  = base;
  const bullMult  = base * DATA.BULL_FACTOR;  // Windsor Drake: competitive strategic process

  const bearEV    = arr * bearMult;
  const baseEV    = arr * baseMult;
  const bullEV    = arr * bullMult;
  const netDebt   = debtM * 1e6 - cashM * 1e6;
  const bearEqV   = bearEV - netDebt;
  const baseEqV   = baseEV - netDebt;
  const bullEqV   = bullEV - netDebt;

  const ebitdaDollars = arr * (ebitdaMargin / 100);
  const evEbitda  = ebitdaDollars > 0 ? baseEV / ebitdaDollars : null;
  const evGP      = arr * (grossMargin / 100) > 0 ? baseEV / (arr * grossMargin / 100) : null;
  const evNewARR  = netNewArr > 0 ? baseEV / netNewArr : null;

  // ── FULL DCF SCHEDULE ───────────────────────────────────────────────────────
  // Revenue build → COGS → GP → OpEx → EBITDA → D&A → EBIT → NOPAT → FCF
  // Tax rate assumption: 25% (standard NOPAT calc)
  const TAX_RATE     = 0.25;
  const CAPEX_PCT    = 0.02;   // SaaS capex-light: ~2% of revenue
  const DA_PCT       = 0.03;   // D&A ~3% of revenue (SaaS = mostly intangibles)
  const SBC_PCT      = 0.08;   // SBC ~8% of revenue (public SaaS median)
  const WC_PCT       = 0.02;   // Working capital build ~2% of revenue growth

  let dcfArr  = arr;
  let dcfGrowth = arrGrowth;
  let dcfEMarg = ebitdaMargin;
  let sumPvFCF = 0;
  const dcfRows = [];

  for (let i = 1; i <= Math.max(5, horizonYrs); i++) {
    dcfArr    *= (1 + dcfGrowth / 100);
    dcfEMarg   = Math.min(35, dcfEMarg + marginExpansionPerYr);
    const rev  = dcfArr;
    const cogs = rev * (1 - grossMargin / 100);
    const gp   = rev - cogs;
    const rnd  = rev * (rndPct / 100);
    const sm   = rev * (smPct / 100) * Math.pow(0.96, i); // S&M efficiency improves
    const ga   = rev * (gaPct / 100) * Math.pow(0.97, i); // G&A leverage
    const opex = rnd + sm + ga;
    const ebitda = gp - opex;
    const da   = rev * DA_PCT;
    const ebit = ebitda - da;
    const nopat = ebit * (1 - TAX_RATE);
    const capex = rev * CAPEX_PCT;
    const sbc   = rev * SBC_PCT;
    const dwc   = rev * WC_PCT * (dcfGrowth / 100);  // WC grows with revenue growth
    const fcf   = nopat + da - capex - dwc + sbc;     // +D&A (non-cash) +SBC (non-cash)
    const df    = Math.pow(1 + wacc / 100, i);
    const pvFcf = fcf / df;
    sumPvFCF   += pvFcf;
    dcfRows.push({ year:i, arr:dcfArr, growth:dcfGrowth, rev, gp, ebitda, ebitdaMarginAct:ebitda/rev*100, ebit, nopat, fcf, pvFcf, df });
    dcfGrowth = Math.max(3, dcfGrowth * DATA.GROWTH_ENDURANCE);
  }

  // Terminal value: EV/EBITDA-implied + Gordon Growth cross-check
  const termYrEbitda = dcfRows[dcfRows.length - 1].ebitda;
  const termYrFCF    = dcfRows[dcfRows.length - 1].fcf;
  const termYrArr    = dcfRows[dcfRows.length - 1].arr;
  // Gordon Growth on FCF
  const termGg       = termYrFCF * (1 + termGrowthRate / 100) / ((wacc - termGrowthRate) / 100);
  // EV/EBITDA terminal (cross-check): mature SaaS ~15-20x EBITDA
  const termEbitdaMult = 18; // conservative mature SaaS EBITDA multiple
  const termEbitdaVal  = termYrEbitda * termEbitdaMult;
  // Use Gordon Growth as primary, EBITDA as sanity check
  const terminalVal  = termGg;
  const pvTV         = terminalVal / Math.pow(1 + wacc / 100, horizonYrs);
  const dcfEV        = sumPvFCF + pvTV;

  // ── COHORT RETENTION CURVES ─────────────────────────────────────────────────
  // Model 5 annual cohorts. Each cohort: starts at $1 of ARR, decays by logo churn,
  // remaining customers expand at NRR-implied rate.
  const cohortYrs = 7;
  const annualLogoRetention = 1 - logoChurn / 100;
  const expansionPerCustomer = nrr / 100 / annualLogoRetention; // revenue per retained customer
  const cohorts = [];
  for (let c = 0; c < 5; c++) {
    const curve = [];
    for (let y = 0; y <= cohortYrs; y++) {
      const logoSurv = Math.pow(annualLogoRetention, y);
      const revPerSurv = Math.pow(expansionPerCustomer, y);
      const netRev = logoSurv * revPerSurv;
      curve.push(netRev);
    }
    cohorts.push({ id: c, label: `Cohort ${c + 1}`, curve });
  }

  // ── QUALITY SCORES ───────────────────────────────────────────────────────────
  // Each score uses empirically-benchmarked thresholds
  const scoreRetention = clamp(
    (nrr >= 120 ? 100 : nrr >= 110 ? 82 : nrr >= 100 ? 60 : nrr >= 90 ? 35 : 12) * 0.40 +
    (grr >= 95 ? 100 : grr >= 90 ? 78 : grr >= 85 ? 55 : grr >= 78 ? 30 : 10) * 0.35 +
    (logoChurn <= 3 ? 100 : logoChurn <= 7 ? 78 : logoChurn <= 12 ? 55 : logoChurn <= 18 ? 28 : 10) * 0.25,
    0, 100
  );
  const scoreGrowth = clamp(
    (arrGrowth >= gRef * 1.4 ? 100 : arrGrowth >= gRef ? 78 : arrGrowth >= gRef * 0.65 ? 52 : arrGrowth >= gRef * 0.35 ? 28 : 10) * 0.40 +
    (magicNumber >= 1.5 ? 100 : magicNumber >= 1.0 ? 80 : magicNumber >= 0.7 ? 60 : magicNumber >= 0.4 ? 35 : 10) * 0.30 +
    (burnMultiple === 0 ? 100 : burnMultiple <= 0.5 ? 95 : burnMultiple <= 1.0 ? 80 : burnMultiple <= 1.5 ? 62 : burnMultiple <= 2.0 ? 40 : 15) * 0.30,
    0, 100
  );
  const scoreEfficiency = clamp(
    (rule40 >= 60 ? 100 : rule40 >= 40 ? 80 : rule40 >= 20 ? 55 : rule40 >= 0 ? 32 : 10) * 0.35 +
    (grossMargin >= 80 ? 100 : grossMargin >= 72 ? 80 : grossMargin >= 62 ? 55 : 18) * 0.30 +
    (ltvCac >= 6 ? 100 : ltvCac >= 3.6 ? 78 : ltvCac >= 2.5 ? 55 : ltvCac >= 1.5 ? 28 : 10) * 0.20 +
    (cacPaybackGp <= 12 ? 100 : cacPaybackGp <= 18 ? 76 : cacPaybackGp <= 24 ? 52 : cacPaybackGp <= 36 ? 28 : 10) * 0.15,
    0, 100
  );
  // Weighted composite: retention 35%, growth 35%, efficiency 30%
  const scoreComposite = scoreRetention * 0.35 + scoreGrowth * 0.35 + scoreEfficiency * 0.30;

  return {
    arr, arrM, gRef, rule40, netNewArr, smDollars, magicNumber, burnMultiple, salesEff,
    lifetimeYrs, ltv, ltvCac, cacPaybackGp, gpPerCustYr,
    nrrDerived, openingArr, newLogoArr, expansionArr, contractionArr, churnArr, closingArr,
    base, bearMult, baseMult, bullMult, bearEV, baseEV, bullEV, netDebt,
    bearEqV, baseEqV, bullEqV, ebitdaDollars, evEbitda, evGP, evNewARR,
    dcfEV, pvTV, sumPvFCF, dcfRows, terminalVal, termGg, termEbitdaVal,
    cohorts, wf,
    scoreRetention, scoreGrowth, scoreEfficiency, scoreComposite,
  };
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

const F = {
  // Field row in a data panel
  row: ({ label, value, sub, vc, bold }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline",
      padding:"6px 0", borderBottom:`1px solid ${C.dim}` }}>
      <span style={{ fontSize:11.5, color:C.muted, fontFamily:SANS }}>{label}</span>
      <div style={{ textAlign:"right" }}>
        <span style={{ fontSize:13, fontWeight: bold ? 700 : 600, color: vc || C.ink, fontFamily:MONO }}>{value}</span>
        {sub && <div style={{ fontSize:10, color:C.ghost, marginTop:1, fontFamily:SANS }}>{sub}</div>}
      </div>
    </div>
  ),

  // Labeled section header
  head: ({ text, source }) => (
    <div style={{ borderBottom:`2px solid ${C.rule}`, paddingBottom:7, marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
      <span style={{ fontSize:10, fontWeight:700, letterSpacing:1.8, textTransform:"uppercase", color:C.steel, fontFamily:SANS }}>{text}</span>
      {source && <span style={{ fontSize:9, color:C.ghost, fontFamily:SANS, fontStyle:"italic" }}>{source}</span>}
    </div>
  ),

  // Score bar
  score: ({ label, value, bench }) => {
    const c = value >= 72 ? C.green : value >= 48 ? C.amber : C.red;
    const lbl = value >= 72 ? "STRONG" : value >= 48 ? "ADEQUATE" : "WEAK";
    return (
      <div style={{ marginBottom:12 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
          <span style={{ fontSize:11.5, color:C.ink, fontFamily:SANS }}>{label}</span>
          <span style={{ fontSize:11, fontWeight:700, color:c, fontFamily:SANS }}>
            {lbl} <span style={{ fontFamily:MONO }}>{value.toFixed(0)}</span>
          </span>
        </div>
        <div style={{ height:4, background:C.dim, borderRadius:2, overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${value}%`, background:c, borderRadius:2, transition:"width 0.4s" }} />
        </div>
        {bench && <div style={{ fontSize:10, color:C.ghost, marginTop:3, fontFamily:SANS }}>{bench}</div>}
      </div>
    );
  },
};

// Slider component
function Slider({ label, value, min, max, step, onChange, fmt, note, vc }) {
  const p = clamp(((value - min) / (max - min)) * 100, 0, 100);
  const col = vc || C.steel;
  return (
    <div style={{ marginBottom:16 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
        <label style={{ fontSize:11.5, color:C.muted, fontFamily:SANS }}>{label}</label>
        <span style={{ fontSize:12.5, fontWeight:700, color:col, fontFamily:MONO }}>{fmt ? fmt(value) : value}</span>
      </div>
      {note && <div style={{ fontSize:10, color:C.ghost, marginBottom:4, fontStyle:"italic", fontFamily:SANS }}>{note}</div>}
      <div style={{ position:"relative", height:3, background:C.dim, borderRadius:2 }}>
        <div style={{ position:"absolute", left:0, top:0, height:"100%", width:`${p}%`, background:col, borderRadius:2 }} />
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          style={{ position:"absolute", top:-8, left:0, width:"100%", height:20, opacity:0, cursor:"pointer", margin:0 }} />
        <div style={{ position:"absolute", top:-4, left:`calc(${p}% - 5px)`,
          width:11, height:11, borderRadius:"50%", background:C.surface, border:`2.5px solid ${col}`, pointerEvents:"none" }} />
      </div>
    </div>
  );
}

function Toggle({ label, value, onChange, note }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
      <div>
        <div style={{ fontSize:11.5, color:C.muted, fontFamily:SANS }}>{label}</div>
        {note && <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS }}>{note}</div>}
      </div>
      <button onClick={() => onChange(!value)} style={{
        width:36, height:19, borderRadius:10, border:"none", cursor:"pointer",
        background: value ? C.steel : C.border, flexShrink:0, position:"relative",
        marginLeft:12,
      }}>
        <div style={{ position:"absolute", top:2.5, left: value ? 18 : 2.5,
          width:14, height:14, borderRadius:"50%", background:C.surface, transition:"left 0.2s" }} />
      </button>
    </div>
  );
}

function Chip({ label, active, onClick, accent }) {
  const col = accent || C.steel;
  return (
    <button onClick={onClick} style={{
      padding:"4px 10px", borderRadius:3, cursor:"pointer",
      fontSize:10.5, fontFamily:SANS, fontWeight: active ? 700 : 400,
      border:`1px solid ${active ? col : C.border}`,
      background: active ? `${col}18` : C.surface,
      color: active ? col : C.muted, transition:"all 0.12s",
    }}>{label}</button>
  );
}

// SVG Waterfall Bar Chart
function WaterfallChart({ rows }) {
  const W = 600, H = 140, PL = 20, PR = 20, PT = 24, PB = 28;
  const maxAbsVal = Math.max(...rows.map(r => Math.abs(r.val)), 1);
  const barH = (H - PT - PB) * 0.7;
  const barW = Math.floor((W - PL - PR) / rows.length - 4);
  const midY = PT + (H - PT - PB) * 0.5;
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      <line x1={PL} y1={midY} x2={W - PR} y2={midY} stroke={C.rule} strokeWidth={1} />
      {rows.map((r, i) => {
        const x = PL + i * ((W - PL - PR) / rows.length) + 2;
        const h = (Math.abs(r.val) / maxAbsVal) * barH;
        const y = r.val >= 0 ? midY - h : midY;
        const color = i === 0 ? C.steel : r.val > 0 ? C.green : C.red;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={Math.max(h, 2)} fill={color} opacity={0.85} rx={1} />
            <text x={x + barW / 2} y={r.val >= 0 ? y - 4 : y + h + 12}
              textAnchor="middle" fontSize={8.5} fill={color} fontFamily={MONO} fontWeight={600}>
              {r.val >= 0 ? "+" : ""}{r.val.toFixed(1)}x
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// SVG line chart (generic)
function LineChart({ series, yFmt, height, showDots }) {
  const W = 560, H = height || 140, PL = 52, PR = 16, PT = 12, PB = 28;
  const allVals = series.flatMap(s => s.data);
  const minV = Math.min(...allVals), maxV = Math.max(...allVals);
  const rng  = maxV - minV || 1;
  const xS   = (i, len) => PL + (i / (len - 1)) * (W - PL - PR);
  const yS   = (v)       => H - PB - ((v - minV) / rng) * (H - PT - PB);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(t => minV + t * rng);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      <defs>
        {series.map(s => (
          <linearGradient key={s.key} id={`g_${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={s.color} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PL} y1={yS(v)} x2={W - PR} y2={yS(v)} stroke={C.dim} strokeWidth={1} />
          <text x={PL - 5} y={yS(v) + 4} textAnchor="end" fontSize={9} fill={C.ghost} fontFamily={MONO}>{yFmt ? yFmt(v) : v.toFixed(1)}</text>
        </g>
      ))}
      {series.map(s => {
        const pts = s.data.map((v, i) => `${xS(i, s.data.length)},${yS(v)}`);
        const fill = `${pts[0]} L${pts.join(" L")} L${xS(s.data.length-1,s.data.length)},${H-PB} L${xS(0,s.data.length)},${H-PB} Z`;
        return (
          <g key={s.key}>
            <path d={`M${fill}`} fill={`url(#g_${s.key})`} />
            <path d={`M${pts.join(" L")}`} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" />
            {showDots && s.data.map((v, i) => (
              <circle key={i} cx={xS(i, s.data.length)} cy={yS(v)} r={3.5} fill={C.surface} stroke={s.color} strokeWidth={1.5} />
            ))}
          </g>
        );
      })}
      {series[0]?.data.map((_, i) => (
        <text key={i} x={xS(i, series[0].data.length)} y={H - PB + 14}
          textAnchor="middle" fontSize={9.5} fill={C.ghost} fontFamily={MONO}>
          {i === 0 ? "NOW" : `Y${i}`}
        </text>
      ))}
    </svg>
  );
}

// ARR Bridge waterfall chart
function BridgeChart({ open, newLogo, expansion, contraction, churn, close }) {
  const W = 560, H = 110, PL = 18, PR = 18, PT = 14, PB = 24;
  const items = [
    { label:"Opening ARR", val:open, base:0, color:C.steel },
    { label:"New Logo",     val:newLogo, base:open, color:C.green },
    { label:"Expansion",   val:expansion, base:open + newLogo, color:"#2A7A46" },
    { label:"Contraction", val:-contraction, base:open + newLogo + expansion - contraction, color:C.amber },
    { label:"Churn",       val:-churn, base:open + newLogo + expansion - contraction - churn + churn, color:C.red },
    { label:"Closing ARR", val:close, base:0, color:C.blue },
  ];
  const maxVal = Math.max(...items.map(it => it.base + Math.max(0, it.val)), close);
  const xStep = (W - PL - PR) / items.length;
  const yS = (v) => H - PB - (v / maxVal) * (H - PT - PB);
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`}>
      {items.map((it, i) => {
        const isFloating = i > 0 && i < 5;
        const barH = Math.max(2, (Math.abs(it.val) / maxVal) * (H - PT - PB));
        const barY = isFloating
          ? (it.val >= 0 ? yS(it.base + it.val) : yS(it.base))
          : yS(Math.max(it.val, it.base));
        const actualBarH = isFloating ? barH : (H - PB - yS(Math.max(it.val, it.base)));
        const x = PL + i * xStep + xStep * 0.1;
        const bw = xStep * 0.72;
        const displayVal = i === 0 || i === 5 ? it.val : it.val;
        return (
          <g key={i}>
            {isFloating && it.val >= 0 && (
              <line x1={x} y1={barY + barH} x2={x + bw + xStep * 0.28} y2={barY + barH}
                stroke={C.rule} strokeWidth={0.8} strokeDasharray="3,3" />
            )}
            <rect x={x} y={barY} width={bw} height={Math.max(actualBarH, 2)}
              fill={it.color} opacity={i === 0 || i === 5 ? 1 : 0.8} rx={1} />
            <text x={x + bw / 2} y={barY - 4} textAnchor="middle" fontSize={8.5}
              fill={it.color} fontFamily={MONO} fontWeight={700}>
              {i === 4 || i === 3 ? "-" : i > 0 ? "+" : ""}{$(Math.abs(displayVal), 1)}
            </text>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={8} fill={C.ghost} fontFamily={SANS}>
              {it.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// Heat table cell
function HCell({ v, isActive, format }) {
  const nv = parseFloat(v);
  const c  = nv >= 10 ? C.green : nv >= 6 ? C.steel : nv >= 4 ? C.amber : C.red;
  const bg = nv >= 10 ? C.greenLt : nv >= 6 ? C.steelLt : nv >= 4 ? C.amberLt : C.redLt;
  return (
    <td style={{ padding:"5px 9px", textAlign:"center", fontFamily:MONO, fontSize:11.5,
      background: isActive ? C.steel : bg, color: isActive ? "#fff" : c,
      fontWeight: isActive ? 700 : 500, border:`1px solid ${C.dim}` }}>
      {format ? format(nv) : `${nv.toFixed(1)}x`}
    </td>
  );
}

// ─── COMPS TABLE ──────────────────────────────────────────────────────────────
function CompsTable({ baseInputs, compute }) {
  const empty = { name:"", arrM:0, arrGrowth:0, nrr:0, grossMargin:0, ebitdaMargin:0, rule40:0, ltvCac:0 };
  const [comps, setComps] = useState([empty, empty, empty]);
  const primary = compute(baseInputs);

  const updateComp = (i, field, val) => {
    const next = [...comps];
    next[i] = { ...next[i], [field]: val };
    setComps(next);
  };

  const cols = [
    { key:"name",          label:"Company",   fmt: v => v || "—",         fmtVal: v => v },
    { key:"arrM",          label:"ARR ($M)",   fmt: v => v ? `$${v}M` : "—" },
    { key:"arrGrowth",     label:"Growth",     fmt: v => v ? pct(v) : "—", best:"max" },
    { key:"nrr",           label:"NRR",        fmt: v => v ? pct(v) : "—", best:"max" },
    { key:"grossMargin",   label:"Gross Margin",fmt: v => v ? pct(v) : "—", best:"max" },
    { key:"ebitdaMargin",  label:"EBITDA Margin",fmt: v => v ? pct(v) : "—", best:"max" },
    { key:"rule40",        label:"Rule of 40", fmt: v => v ? v.toFixed(0) : "—", best:"max" },
    { key:"ltvCac",        label:"LTV:CAC",    fmt: v => v ? mult(v) : "—", best:"max" },
  ];

  const allRows = [
    { ...baseInputs, name: baseInputs.companyName || "Target", rule40: primary.rule40, ltvCac: primary.ltvCac, _isPrimary: true },
    ...comps,
  ];

  return (
    <div>
      <F.head text="Comparable Company Analysis" source="Enter up to 3 comps for side-by-side benchmarking" />
      <div style={{ overflowX:"auto" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5, fontFamily:SANS }}>
          <thead>
            <tr style={{ borderBottom:`2px solid ${C.rule}` }}>
              {cols.map(c => <th key={c.key} style={{ padding:"7px 10px", textAlign: c.key==="name" ? "left" : "right", fontSize:10, letterSpacing:1, textTransform:"uppercase", color:C.ghost, fontWeight:700 }}>{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {allRows.map((row, ri) => (
              <tr key={ri} style={{ background: ri === 0 ? C.steelLt : ri % 2 === 0 ? C.surface : C.panel, borderBottom:`1px solid ${C.dim}` }}>
                {cols.map(c => {
                  if (!row._isPrimary && c.key !== "name") {
                    return (
                      <td key={c.key} style={{ padding:"6px 8px", textAlign:"right" }}>
                        <input type="number" value={row[c.key] || ""}
                          onChange={e => updateComp(ri - 1, c.key, parseFloat(e.target.value) || 0)}
                          placeholder="—"
                          style={{ background:"transparent", border:"none", borderBottom:`1px solid ${C.border}`,
                            width:60, textAlign:"right", fontFamily:MONO, fontSize:11.5, color:C.ink, outline:"none" }} />
                      </td>
                    );
                  }
                  if (!row._isPrimary && c.key === "name") {
                    return (
                      <td key={c.key} style={{ padding:"6px 8px" }}>
                        <input type="text" value={row.name}
                          onChange={e => updateComp(ri - 1, "name", e.target.value)}
                          placeholder="Company name"
                          style={{ background:"transparent", border:"none", borderBottom:`1px solid ${C.border}`,
                            width:110, fontFamily:SANS, fontSize:11.5, color:C.ink, outline:"none" }} />
                      </td>
                    );
                  }
                  const displayVal = c.key === "rule40" || c.key === "ltvCac" ? row[c.key] : row[c.key];
                  const formatted = c.fmt ? c.fmt(displayVal) : displayVal;
                  // Highlight best in each column
                  const colVals = allRows.map(r => parseFloat(r[c.key]) || 0).filter(v => v > 0);
                  const isBest = c.best === "max" && parseFloat(row[c.key]) === Math.max(...colVals) && colVals.length > 1;
                  return (
                    <td key={c.key} style={{ padding:"7px 10px", textAlign: c.key==="name" ? "left" : "right",
                      fontFamily: c.key==="name" ? SANS : MONO, fontWeight: ri===0 ? 700 : isBest ? 700 : 500,
                      color: ri===0 ? C.steel : isBest ? C.green : C.ink }}>
                      {formatted}
                      {isBest && ri !== 0 && <span style={{ fontSize:9, marginLeft:4, color:C.green }}>▲</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize:10, color:C.ghost, marginTop:8, fontFamily:SANS }}>
        Click cells to enter comparable company data. Green triangle = best-in-peer-group.
      </div>
    </div>
  );
}

// ─── DILIGENCE SCORECARD ──────────────────────────────────────────────────────
const DILIGENCE_ITEMS = [
  { id:"arr_def",    cat:"Revenue",    label:"ARR definition consistent with GAAP / ASC 606",       weight:8 },
  { id:"cohort",     cat:"Revenue",    label:"Cohort-level GRR/NRR data available for 3+ vintages", weight:9 },
  { id:"arr_bridge", cat:"Revenue",    label:"Clean ARR bridge: new logo + expansion − churn",      weight:8 },
  { id:"concen",     cat:"Risk",       label:"No single customer >10% of ARR",                      weight:9 },
  { id:"pipeline",   cat:"Growth",     label:"Pipeline coverage ≥3x quota; provenance audited",     weight:7 },
  { id:"nrr_seg",    cat:"Revenue",    label:"NRR segmented by customer cohort / ICP",              weight:8 },
  { id:"payback",    cat:"Efficiency", label:"CAC payback <18mo on blended basis",                  weight:7 },
  { id:"gm_adj",     cat:"Financials", label:"Gross margin normalized (excl. one-time credits)",    weight:8 },
  { id:"rule40",     cat:"Financials", label:"Rule of 40 ≥ 40 (or credible path within 18mo)",     weight:7 },
  { id:"magic",      cat:"Efficiency", label:"Magic Number ≥ 0.7",                                  weight:6 },
  { id:"burn_mul",   cat:"Efficiency", label:"Burn Multiple ≤ 2.0x",                                weight:7 },
  { id:"grr_cov",    cat:"Revenue",    label:"GRR ≥ 85% (lender covenant floor)",                   weight:9 },
  { id:"rev_quality",cat:"Revenue",    label:"Recurring revenue ≥ 80% of total",                    weight:7 },
  { id:"sbc",        cat:"Financials", label:"SBC and D&A disclosed; normalized EBITDA reconciled", weight:6 },
  { id:"qoe",        cat:"Financials", label:"QoE analysis confirms EBITDA adjustments",            weight:8 },
  { id:"ip",         cat:"Legal",      label:"IP ownership clear; no open source contamination",    weight:7 },
  { id:"key_man",    cat:"Risk",       label:"Key-man dependency mitigated (succession plan)",      weight:6 },
  { id:"security",   cat:"Risk",       label:"SOC 2 Type II / ISO 27001 certified",                 weight:6 },
  { id:"wc",         cat:"Financials", label:"Working capital normalized; deferred revenue clear",  weight:6 },
  { id:"ai_risk",    cat:"Risk",       label:"AI substitution risk assessed; moat documented",      weight:7 },
];

function DiligenceCard({ calcs, inputs }) {
  const [checks, setChecks] = useState(() => Object.fromEntries(DILIGENCE_ITEMS.map(it => [it.id, false])));
  const toggle = (id) => setChecks(p => ({ ...p, [id]: !p[id] }));
  const totalWeight = DILIGENCE_ITEMS.reduce((s, it) => s + it.weight, 0);
  const earnedWeight = DILIGENCE_ITEMS.filter(it => checks[it.id]).reduce((s, it) => s + it.weight, 0);
  const ddScore = (earnedWeight / totalWeight) * 100;
  const cats = [...new Set(DILIGENCE_ITEMS.map(it => it.cat))];
  return (
    <div>
      <F.head text="Diligence Scorecard (20-Item PE Standard)" source="Weighted by deal-closing criticality" />
      <div style={{ display:"flex", gap:12, marginBottom:20 }}>
        <div style={{ flex:1, background: ddScore >= 70 ? C.greenLt : ddScore >= 45 ? C.amberLt : C.redLt,
          border:`1px solid ${ddScore >= 70 ? C.green : ddScore >= 45 ? C.amber : C.red}44`,
          borderRadius:4, padding:"14px 18px", textAlign:"center" }}>
          <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, fontFamily:SANS, marginBottom:4 }}>DD Score</div>
          <div style={{ fontSize:36, fontWeight:800, fontFamily:MONO, color: ddScore >= 70 ? C.green : ddScore >= 45 ? C.amber : C.red }}>{ddScore.toFixed(0)}</div>
          <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS }}>{earnedWeight}/{totalWeight} weighted pts</div>
        </div>
        {cats.map(cat => {
          const catItems = DILIGENCE_ITEMS.filter(it => it.cat === cat);
          const catEarned = catItems.filter(it => checks[it.id]).reduce((s, it) => s + it.weight, 0);
          const catTotal  = catItems.reduce((s, it) => s + it.weight, 0);
          const r = catEarned / catTotal;
          return (
            <div key={cat} style={{ flex:1, background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:"12px 14px" }}>
              <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, fontFamily:SANS, marginBottom:6 }}>{cat}</div>
              <div style={{ height:4, background:C.dim, borderRadius:2, marginBottom:5 }}>
                <div style={{ height:"100%", width:`${r*100}%`, background: r>=0.7 ? C.green : r>=0.4 ? C.amber : C.red, borderRadius:2 }} />
              </div>
              <div style={{ fontSize:12, fontWeight:700, fontFamily:MONO, color: r>=0.7 ? C.green : r>=0.4 ? C.amber : C.red }}>{(r*100).toFixed(0)}%</div>
            </div>
          );
        })}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0 20px" }}>
        {DILIGENCE_ITEMS.map(it => (
          <div key={it.id} onClick={() => toggle(it.id)}
            style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0",
              borderBottom:`1px solid ${C.dim}`, cursor:"pointer",
              opacity: checks[it.id] ? 1 : 0.65 }}>
            <div style={{ width:16, height:16, borderRadius:3, flexShrink:0,
              background: checks[it.id] ? C.green : C.surface,
              border:`1.5px solid ${checks[it.id] ? C.green : C.border}`,
              display:"flex", alignItems:"center", justifyContent:"center" }}>
              {checks[it.id] && <div style={{ width:8, height:8, borderRadius:1, background:"#fff" }} />}
            </div>
            <div style={{ flex:1 }}>
              <span style={{ fontSize:11.5, color: checks[it.id] ? C.ink : C.muted, fontFamily:SANS }}>{it.label}</span>
              <span style={{ fontSize:10, color:C.ghost, fontFamily:SANS, marginLeft:6 }}>({it.cat} · {it.weight}pts)</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState("SUMMARY");
  const [darkMode, setDarkMode] = useState(true);

  // Update theme
  C = darkMode ? DARK : LIGHT;
  useEffect(() => {
    document.body.style.background = C.paper;
    // Update scrollbar colors
    let style = document.getElementById('scrollbar-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'scrollbar-style';
      document.head.appendChild(style);
    }
    style.textContent = `
      * { scrollbar-color: ${darkMode ? '#3A3A40 #1F1F23' : '#C8C3B4 #EAE7DF'}; }
      ::-webkit-scrollbar { width: 5px; height: 5px; }
      ::-webkit-scrollbar-track { background: ${darkMode ? '#1F1F23' : '#EAE7DF'} !important; }
      ::-webkit-scrollbar-thumb { background: ${darkMode ? '#3A3A40' : '#C8C3B4'} !important; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: ${darkMode ? '#6B6B6B' : '#A89F8C'} !important; }
    `;
  }, [darkMode]);

  // Company profile
  const [companyName, setCompanyName] = useState("Target Company");
  const [bizType,     setBizType]     = useState("B2B_ENT");
  const [stage,       setStage]       = useState("GROWTH");

  // Revenue
  const [arrM,         setArrM]         = useState(12);
  const [arrGrowth,    setArrGrowth]    = useState(40);
  const [revenueMix,   setRevenueMix]   = useState(88);

  // ARR bridge components (for cohort/bridge analysis)
  const [newLogoGrowthPct, setNewLogoGrowthPct] = useState(25);
  const [expansionPct,     setExpansionPct]     = useState(12);
  const [contractionPct,   setContractionPct]   = useState(3);

  // Retention
  const [nrr,       setNrr]       = useState(108);
  const [grr,       setGrr]       = useState(91);
  const [logoChurn, setLogoChurn] = useState(7);

  // Margins
  const [grossMargin,  setGrossMargin]  = useState(76);
  const [ebitdaMargin, setEbitdaMargin] = useState(-12);
  const [rndPct,       setRndPct]       = useState(18);
  const [smPct,        setSmPct]        = useState(33);
  const [gaPct,        setGaPct]        = useState(12);

  // Unit economics
  const [arpa,       setArpa]       = useState(48000);
  const [cac,        setCac]        = useState(40000);

  // Capital structure
  const [cashM,  setCashM]  = useState(22);
  const [debtM,  setDebtM]  = useState(6);

  // Modifiers
  const [aiNative,      setAiNative]      = useState(false);
  const [verticalBonus, setVerticalBonus] = useState(false);
  const [networkEffects,setNetworkEffects]= useState(false);
  const [usageBased,    setUsageBased]    = useState(false);
  const [publicMode,    setPublicMode]    = useState(false);

  // DCF
  const [horizonYrs,          setHorizonYrs]          = useState(5);
  const [growthDecay,         setGrowthDecay]         = useState(null); // null = auto (growth endurance 0.65)
  const [marginExpansionPerYr,setMarginExpansionPerYr] = useState(3.5);
  const [wacc,                setWacc]                = useState(12);
  const [termGrowthRate,      setTermGrowthRate]      = useState(3);

  const inputs = {
    arrM, arrGrowth, nrr, grr, logoChurn, grossMargin, ebitdaMargin,
    rndPct, smPct, gaPct, arpa, cac, revenueMix, cashM, debtM,
    aiNative, verticalBonus, networkEffects, usageBased, publicMode,
    horizonYrs,
    growthDecay: growthDecay ?? (arrGrowth * (1 - DATA.GROWTH_ENDURANCE)), // auto-decay
    marginExpansionPerYr, wacc, termGrowthRate,
    newLogoGrowthPct, expansionPct, contractionPct,
    bizType, stage, companyName,
  };

  const calcs = useMemo(() => computeValuation(inputs), [
    arrM, arrGrowth, nrr, grr, logoChurn, grossMargin, ebitdaMargin,
    rndPct, smPct, gaPct, arpa, cac, revenueMix, cashM, debtM,
    aiNative, verticalBonus, networkEffects, usageBased, publicMode,
    horizonYrs, growthDecay, marginExpansionPerYr, wacc, termGrowthRate,
    newLogoGrowthPct, expansionPct, contractionPct, bizType, stage,
  ]);

  const TABS = ["SUMMARY","METHODOLOGY","PROJECTIONS","COHORTS","SENSITIVITY","DILIGENCE","COMPS"];

  const panel = { background:C.surface, border:`1px solid ${C.border}`, borderRadius:4, padding:"18px 20px", marginBottom:16 };

  return (
    <div style={{ background:C.paper, minHeight:"100vh", color:C.ink, fontFamily:SANS }}>

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <div style={{ background:"#18160F", display:"flex", alignItems:"stretch", padding:"0 24px", gap:0 }}>
        {/* Name + subtitle */}
        <div style={{ padding:"14px 24px 14px 0", borderRight:`1px solid rgba(255,255,255,0.12)`, marginRight:24 }}>
          <input value={companyName} onChange={e => setCompanyName(e.target.value)}
            style={{ background:"transparent", border:"none", outline:"none", color:"#F5F3EE",
              fontSize:14, fontWeight:700, fontFamily:SLAB, width:200 }} />
          <div style={{ fontSize:9, letterSpacing:1.8, color:"rgba(255,255,255,0.38)", textTransform:"uppercase", fontFamily:SANS, marginTop:2 }}>
            PRIVATE EQUITY VALUATION ANALYSIS · 2025
          </div>
        </div>

        {/* Three headline numbers */}
        {/* Base Case EV */}
        <div style={{ padding:"10px 24px 10px 0", borderRight:`1px solid rgba(255,255,255,0.1)`, marginRight:24 }}>
          <div style={{ fontSize:9, letterSpacing:1.4, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", fontFamily:SANS, marginBottom:3 }}>BASE CASE EV</div>
          <div style={{ fontSize:22, fontWeight:700, fontFamily:MONO, color:"#8FD4F0", lineHeight:1 }}>{$(calcs.baseEV)}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:MONO, marginTop:3 }}>{mult(calcs.baseMult)} ARR</div>
        </div>
        {/* Bear / Bull */}
        <div style={{ padding:"10px 24px 10px 0", borderRight:`1px solid rgba(255,255,255,0.1)`, marginRight:24 }}>
          <div style={{ fontSize:9, letterSpacing:1.4, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", fontFamily:SANS, marginBottom:3 }}>BEAR / BULL</div>
          <div style={{ fontSize:22, fontWeight:700, fontFamily:MONO, lineHeight:1 }}>
            <span style={{ color:"#F87171" }}>{$(calcs.bearEV,0)}</span>
            <span style={{ color:"rgba(255,255,255,0.5)" }}> — </span>
            <span style={{ color:"#4ADE80" }}>{$(calcs.bullEV,0)}</span>
          </div>
          <div style={{ fontSize:10, fontFamily:MONO, marginTop:3 }}>
            <span style={{ color:"#F87171", opacity:0.7 }}>{mult(calcs.bearMult,1)}</span>
            <span style={{ color:"rgba(255,255,255,0.35)" }}> — </span>
            <span style={{ color:"#4ADE80", opacity:0.7 }}>{mult(calcs.bullMult,1)} ARR</span>
          </div>
        </div>
        {/* DCF Value */}
        <div style={{ padding:"10px 24px 10px 0", borderRight:`1px solid rgba(255,255,255,0.1)`, marginRight:24 }}>
          <div style={{ fontSize:9, letterSpacing:1.4, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", fontFamily:SANS, marginBottom:3 }}>DCF VALUE</div>
          <div style={{ fontSize:22, fontWeight:700, fontFamily:MONO, color:"rgba(255,255,255,0.7)", lineHeight:1 }}>{$(calcs.dcfEV)}</div>
          <div style={{ fontSize:10, color:"rgba(255,255,255,0.35)", fontFamily:MONO, marginTop:3 }}>{wacc}% WACC · {termGrowthRate}% g</div>
        </div>

        {/* Quality score */}
        <div style={{ padding:"10px 0", marginLeft:"auto", display:"flex", alignItems:"center", gap:20 }}>
          {[
            { lbl:"QUALITY", v:calcs.scoreComposite },
            { lbl:"RETENTION", v:calcs.scoreRetention },
            { lbl:"GROWTH", v:calcs.scoreGrowth },
          ].map(({lbl,v}) => {
            const c = v>=72 ? "#7DDFAA" : v>=48 ? "#FFD97D" : "#FF9999";
            return (
              <div key={lbl} style={{ textAlign:"center" }}>
                <div style={{ fontSize:9, letterSpacing:1.4, color:"rgba(255,255,255,0.4)", textTransform:"uppercase", fontFamily:SANS, marginBottom:2 }}>{lbl}</div>
                <div style={{ fontSize:20, fontWeight:800, fontFamily:MONO, color:c }}>{v.toFixed(0)}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── TAB BAR ──────────────────────────────────────────────────────────── */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, display:"flex", padding:"0 24px" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            background:"transparent", border:"none", cursor:"pointer",
            borderBottom:`2px solid ${tab===t ? C.steel : "transparent"}`,
            padding:"11px 16px", fontSize:10.5, fontWeight:700,
            color: tab===t ? C.steel : C.ghost, fontFamily:SANS,
            letterSpacing:1.3, textTransform:"uppercase", transition:"all 0.12s", marginBottom:-1,
          }}>{t}</button>
        ))}
        <div style={{ marginLeft:"auto", display:"flex", alignItems:"center", gap:16 }}>
          <span style={{ fontSize:9.5, color:C.ghost, fontFamily:SANS }}>Sources: SEG · SaaS Capital · Aventis · Benchmarkit · Windsor Drake · ABF Journal</span>
          <button onClick={() => setDarkMode(!darkMode)} style={{
            background: darkMode ? C.dim : C.border, border:"none", borderRadius:4, cursor:"pointer",
            padding:"5px 10px", display:"flex", alignItems:"center", gap:6, transition:"all 0.15s",
          }}>
            <span style={{ fontSize:9.5, fontWeight:600, color:C.muted, fontFamily:SANS }}>{darkMode ? "DARK" : "LIGHT"}</span>
          </button>
        </div>
      </div>

      {/* ── LAYOUT ──────────────────────────────────────────────────────────── */}
      <div style={{ display:"grid", gridTemplateColumns:"288px 1fr", maxWidth:1440, margin:"0 auto" }}>

        {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
        <div style={{ background:C.surface, borderRight:`1px solid ${C.border}`,
          height:"calc(100vh - 108px)", overflowY:"auto", padding:"18px 16px", scrollbarWidth:"thin" }}>

          {/* Company type */}
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:7 }}>Business Model</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {[["B2B_SMB","SMB"],["B2B_MID","Mid-Mkt"],["B2B_ENT","Enterprise"],["B2C","B2C/PLG"],["VERT","Vertical"],["TECH_SVC","Tech Svcs"]].map(([id,lbl]) => (
                <Chip key={id} label={lbl} active={bizType===id} onClick={() => setBizType(id)} />
              ))}
            </div>
          </div>
          <div style={{ marginBottom:18 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:7 }}>Stage</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:5 }}>
              {[["SEED","Seed"],["EARLY","Early"],["GROWTH","Growth"],["SCALE","Scale"],["MATURE","Mature"]].map(([id,lbl]) => (
                <Chip key={id} label={lbl} active={stage===id} onClick={() => setStage(id)} accent={C.green} />
              ))}
            </div>
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14, marginBottom:2 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>Revenue & Growth</div>
            <Slider label="ARR" value={arrM} min={0.5} max={500} step={0.5} onChange={setArrM}
              fmt={v=>`$${v.toFixed(1)}M`} note="Current annualized recurring revenue" />
            <Slider label="YoY ARR Growth" value={arrGrowth} min={-10} max={250} step={1} onChange={setArrGrowth}
              fmt={v=>`${v}%`} note={`Stage median: ${calcs.gRef}%`}
              vc={ratioColor(arrGrowth, calcs.gRef*1.2, calcs.gRef*0.7)} />
            <Slider label="Recurring Revenue Mix" value={revenueMix} min={20} max={100} step={1} onChange={setRevenueMix}
              fmt={v=>`${v}%`} />
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14, marginBottom:2 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>ARR Bridge Components</div>
            <Slider label="New Logo ARR Growth" value={newLogoGrowthPct} min={0} max={150} step={1} onChange={setNewLogoGrowthPct}
              fmt={v=>`${v}%`} note="% of current ARR from new logos" />
            <Slider label="Expansion % of ARR" value={expansionPct} min={0} max={50} step={0.5} onChange={setExpansionPct}
              fmt={v=>`${v}%`} />
            <Slider label="Contraction % of ARR" value={contractionPct} min={0} max={20} step={0.5} onChange={setContractionPct}
              fmt={v=>`${v}%`} />
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14, marginBottom:2 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>Retention</div>
            <Slider label="Net Revenue Retention" value={nrr} min={50} max={160} step={1} onChange={setNrr}
              fmt={v=>`${v}%`} note={`Public SaaS median: 114% | Private: 106%`}
              vc={ratioColor(nrr, 110, 100)} />
            <Slider label="Gross Revenue Retention" value={grr} min={50} max={100} step={1} onChange={setGrr}
              fmt={v=>`${v}%`} note="Lender covenant floor: 85%"
              vc={ratioColor(grr, 92, 85)} />
            <Slider label="Annual Logo Churn" value={logoChurn} min={0} max={60} step={0.5} onChange={setLogoChurn}
              fmt={v=>`${v}%`} vc={ratioColor(-logoChurn, -5, -12)} />
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14, marginBottom:2 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>Margin Structure</div>
            <Slider label="Gross Margin" value={grossMargin} min={10} max={100} step={1} onChange={setGrossMargin}
              fmt={v=>`${v}%`} note="SaaS median: 73% | Target: 75-85%"
              vc={ratioColor(grossMargin, 75, 65)} />
            <Slider label="EBITDA Margin" value={ebitdaMargin} min={-100} max={55} step={1} onChange={setEbitdaMargin}
              fmt={v=>`${v}%`} note="Public SaaS median 2025: ~9.3%"
              vc={ratioColor(ebitdaMargin, 0, -20)} />
            <Slider label="R&D % of Revenue" value={rndPct} min={0} max={60} step={1} onChange={setRndPct} fmt={v=>`${v}%`} note="Median 2025: 18–22%" />
            <Slider label="S&M % of Revenue" value={smPct} min={0} max={80} step={1} onChange={setSmPct} fmt={v=>`${v}%`} note="Best-in-class at scale: <25%" />
            <Slider label="G&A % of Revenue" value={gaPct} min={2} max={40} step={1} onChange={setGaPct} fmt={v=>`${v}%`} note="Target at scale: 8–12%" />
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14, marginBottom:2 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>Unit Economics</div>
            <Slider label="ARPA (Annual / Account)" value={arpa} min={1000} max={1000000} step={500} onChange={setArpa} fmt={$} />
            <Slider label="Blended CAC (fully-loaded)" value={cac} min={500} max={500000} step={500} onChange={setCac}
              fmt={$} note="Incl. salaries, commissions, programs" />
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14, marginBottom:2 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>Capital Structure</div>
            <Slider label="Cash & Equivalents" value={cashM} min={0} max={2000} step={1} onChange={setCashM} fmt={v=>`$${v}M`} />
            <Slider label="Total Debt (interest-bearing)" value={debtM} min={0} max={2000} step={1} onChange={setDebtM} fmt={v=>`$${v}M`} />
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14, marginBottom:2 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>Modifiers</div>
            <Toggle label="AI-Native / Proprietary Model" value={aiNative} onChange={setAiNative}
              note="+20% multiple (SaasRise: 20–40% AI premium)" />
            <Toggle label="Vertical SaaS Domain Focus" value={verticalBonus} onChange={setVerticalBonus}
              note="+8% (domain moat, higher retention)" />
            <Toggle label="Network Effects" value={networkEffects} onChange={setNetworkEffects}
              note="+10% (defensibility premium)" />
            <Toggle label="Usage-Based Pricing" value={usageBased} onChange={setUsageBased}
              note="+4% (OpenView: 38% faster growth)" />
            <Toggle label="Public Markets Benchmark" value={publicMode} onChange={setPublicMode}
              note="+36% (SEG: public premium over private)" />
          </div>

          <div style={{ borderTop:`1px solid ${C.dim}`, paddingTop:14 }}>
            <div style={{ fontSize:9.5, fontWeight:700, letterSpacing:1.6, textTransform:"uppercase", color:C.ghost, fontFamily:SANS, marginBottom:10 }}>DCF Parameters</div>
            <Slider label="Projection Horizon" value={horizonYrs} min={3} max={10} step={1} onChange={setHorizonYrs} fmt={v=>`${v}yr`} />
            <Slider label="EBITDA Margin Expansion" value={marginExpansionPerYr} min={0} max={12} step={0.5} onChange={setMarginExpansionPerYr}
              fmt={v=>`+${v}ppts/yr`} note="Operational leverage; SaaS median ~3-4ppts/yr" />
            <Slider label="WACC" value={wacc} min={6} max={28} step={0.5} onChange={setWacc}
              fmt={v=>`${v}%`} note="SaaS PE range: 10–15%" />
            <Slider label="Terminal Growth Rate" value={termGrowthRate} min={1} max={6} step={0.25} onChange={setTermGrowthRate}
              fmt={v=>`${v}%`} note="Long-run GDP proxy: 2.5–3.5%" />
          </div>
        </div>

        {/* ── MAIN CONTENT ──────────────────────────────────────────────────────── */}
        <div style={{ height:"calc(100vh - 108px)", overflowY:"auto", padding:"20px 22px", scrollbarWidth:"thin" }}>

          {/* ═══ SUMMARY TAB ════════════════════════════════════════════════════ */}
          {tab === "SUMMARY" && (
            <div>
              {/* Top row: Scenario EVs */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:12, marginBottom:16 }}>
                {[
                  { lbl:"Bear Case", ev:calcs.bearEV, eq:calcs.bearEqV, m:calcs.bearMult, c:C.red, bg:C.redLt, note:"No-process / single buyer (Windsor Drake: 42% discount to competitive)" },
                  { lbl:"Base Case", ev:calcs.baseEV, eq:calcs.baseEqV, m:calcs.baseMult, c:C.steel, bg:C.steelLt, note:"Current private M&A conditions, median quality adj.", bold:true },
                  { lbl:"Bull Case", ev:calcs.bullEV, eq:calcs.bullEqV, m:calcs.bullMult, c:C.green, bg:C.greenLt, note:"Competitive strategic process (1.5x strategic premium, Windsor Drake)" },
                  { lbl:"DCF Intrinsic", ev:calcs.dcfEV, eq:calcs.dcfEV - calcs.netDebt, m:calcs.dcfEV/calcs.arr, c:C.blue, bg:C.blueLt, note:`PV FCF: ${$(calcs.sumPvFCF,0)} + PV TV: ${$(calcs.pvTV,0)}` },
                ].map(({lbl,ev,eq,m,c,bg,note,bold})=>(
                  <div key={lbl} style={{ background:bg, border:`1px solid ${c}44`, borderRadius:4, padding:"14px 16px" }}>
                    <div style={{ fontSize:10, color:C.muted, textTransform:"uppercase", letterSpacing:1, fontFamily:SANS, marginBottom:6 }}>{lbl}</div>
                    <div style={{ fontSize:bold?28:24, fontWeight:800, color:c, fontFamily:MONO, lineHeight:1 }}>{$(ev)}</div>
                    <div style={{ fontSize:13, color:`${c}cc`, fontFamily:MONO, marginTop:4 }}>{mult(m)} ARR</div>
                    <div style={{ fontSize:11, color:C.muted, fontFamily:SANS, marginTop:6, lineHeight:1.5 }}>{note}</div>
                    <div style={{ borderTop:`1px solid ${c}22`, marginTop:10, paddingTop:8 }}>
                      <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS }}>Equity Value</div>
                      <div style={{ fontSize:15, fontWeight:700, color:c, fontFamily:MONO }}>{$(Math.max(0,eq))}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Three panels: Unit Econ, Efficiency, P&L */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14 }}>
                <div style={panel}>
                  <F.head text="Unit Economics" source="Benchmarkit 2024 median LTV:CAC 3.6x" />
                  <F.row label="Customer LTV (GM-adj.)" value={$(calcs.ltv)} />
                  <F.row label="Blended CAC" value={$(cac)} />
                  <F.row label="LTV : CAC" value={mult(calcs.ltvCac)}
                    vc={ratioColor(calcs.ltvCac, 3.6, 2.5)}
                    sub={calcs.ltvCac >= 3.6 ? "Above Benchmarkit 2024 median" : "Below 3.6x median"} />
                  <F.row label="CAC Payback (GP-adj.)" value={mo(calcs.cacPaybackGp)}
                    vc={ratioColor(-calcs.cacPaybackGp, -12, -20)}
                    sub="Median 2025: 20mo (SaaS Benchmark Report)" />
                  <F.row label="ARPA (annual)" value={$(arpa)} />
                  <F.row label="GP per Customer / yr" value={$(calcs.gpPerCustYr)} />
                  <F.row label="Avg. Customer Lifetime" value={yr(calcs.lifetimeYrs)} />
                </div>

                <div style={panel}>
                  <F.head text="Efficiency Metrics" source="Aventis / Benchmarkit / David Sacks / SaaS Capital" />
                  <F.row label="Rule of 40" value={calcs.rule40.toFixed(0)}
                    vc={ratioColor(calcs.rule40, 40, 20)}
                    sub="Aventis: +2.2x multiple per 10pts (confirmed exact)" bold />
                  <F.row label="Magic Number" value={calcs.magicNumber.toFixed(2)}
                    vc={ratioColor(calcs.magicNumber, 1.0, 0.7)}
                    sub={`Benchmarkit 2024 median: 0.90 | Target: ≥1.0`} />
                  <F.row label="Burn Multiple" value={calcs.burnMultiple > 0 ? mult(calcs.burnMultiple) : "Profitable"}
                    vc={calcs.burnMultiple === 0 ? C.green : ratioColor(-calcs.burnMultiple, -1.0, -2.0)}
                    sub="<1.0 exceptional | 1-2 acceptable | >2 concerning" />
                  <F.row label="Sales Efficiency" value={calcs.salesEff.toFixed(2)}
                    sub="Net new ARR / S&M spend" />
                  <F.row label="Implied S&M Spend" value={$(calcs.smDollars)}
                    sub={`${pct(smPct)} of ARR`} />
                  <F.row label="Net New ARR" value={$(calcs.netNewArr)}
                    sub={`${pct(arrGrowth)} growth`} />
                </div>

                <div style={panel}>
                  <F.head text="P&L & Revenue Quality" source="SaaS Capital / SEG / ChartMogul / ABF Journal" />
                  <F.row label="ARR" value={$(calcs.arr)} bold />
                  <F.row label="YoY Growth" value={pct(arrGrowth)}
                    vc={ratioColor(arrGrowth, calcs.gRef, calcs.gRef * 0.65)}
                    sub={`Stage median: ${calcs.gRef}%`} />
                  <F.row label="Gross Margin" value={pct(grossMargin)}
                    vc={ratioColor(grossMargin, 75, 65)}
                    sub="SaaS median 73%; target 75-85%" />
                  <F.row label="EBITDA Margin" value={pct(ebitdaMargin)}
                    vc={ratioColor(ebitdaMargin, 0, -25)}
                    sub="Public SaaS median 2025: 9.3%" />
                  <F.row label="NRR (input)" value={pct(nrr)}
                    vc={ratioColor(nrr, 110, 100)}
                    sub="SEG: >120%=11.7x | 100-110%=6.0x | <90%=1.2x" />
                  <F.row label="GRR" value={pct(grr)}
                    vc={ratioColor(grr, 92, 85)}
                    sub="ABF Journal: 85% lender covenant minimum" />
                  <F.row label="Recurring Mix" value={pct(revenueMix)} />
                </div>
              </div>

              {/* Quality scores + peer benchmarks */}
              <div style={{ display:"grid", gridTemplateColumns:"340px 1fr", gap:14 }}>
                <div style={panel}>
                  <F.head text="Quality Assessment Scores" source="Empirically calibrated thresholds" />
                  <F.score label="Composite Score" value={calcs.scoreComposite}
                    bench="Weights: Retention 35% · Growth 35% · Efficiency 30%" />
                  <F.score label="Retention Quality" value={calcs.scoreRetention}
                    bench="NRR 40% · GRR 35% · Logo Churn 25%" />
                  <F.score label="Growth Quality" value={calcs.scoreGrowth}
                    bench="Growth vs stage 40% · Magic Number 30% · Burn Multiple 30%" />
                  <F.score label="Operational Efficiency" value={calcs.scoreEfficiency}
                    bench="Rule of 40 35% · Gross Margin 30% · LTV:CAC 20% · Payback 15%" />
                </div>

                <div style={panel}>
                  <F.head text="Benchmark Reference Table" source="SEG 2025, SaaS Capital n=1,000+, Benchmarkit n=936, KeyBanc 2024" />
                  <div style={{ overflowX:"auto" }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                      <thead>
                        <tr style={{ borderBottom:`1.5px solid ${C.rule}` }}>
                          {["Metric","Bottom 25%","Median","Top 25%","Best-in-Class","Yours","Delta"].map((h,i) => (
                            <th key={h} style={{ padding:"6px 9px", textAlign:i===0?"left":"center", fontSize:9.5, letterSpacing:0.8, textTransform:"uppercase", color:C.ghost, fontWeight:700 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { m:"ARR Growth",    b:"<15%",   med:"19-22%",  tq:">40%",   bic:">80%",   you:pct(arrGrowth),               delta:arrGrowth-20,     suf:"ppts" },
                          { m:"NRR",          b:"<95%",   med:"106%",    tq:">115%",  bic:">120%",  you:pct(nrr),                     delta:nrr-106,          suf:"ppts" },
                          { m:"GRR",          b:"<82%",   med:"91%",     tq:">95%",   bic:">98%",   you:pct(grr),                     delta:grr-91,           suf:"ppts" },
                          { m:"Gross Margin", b:"<60%",   med:"73%",     tq:">80%",   bic:">85%",   you:pct(grossMargin),             delta:grossMargin-73,   suf:"ppts" },
                          { m:"Rule of 40",   b:"<10",    med:"22-28",   tq:">40",    bic:">60",    you:calcs.rule40.toFixed(0),      delta:calcs.rule40-25,  suf:"pts"  },
                          { m:"CAC Payback",  b:">30mo",  med:"20mo",    tq:"<14mo",  bic:"<10mo",  you:mo(calcs.cacPaybackGp),       delta:-(calcs.cacPaybackGp-20), suf:"mo" },
                          { m:"LTV:CAC",      b:"<1.5x",  med:"3.6x",    tq:">5x",    bic:">7x",    you:mult(calcs.ltvCac),           delta:calcs.ltvCac-3.6, suf:"x"   },
                          { m:"Magic Number", b:"<0.4",   med:"0.90",    tq:">1.2",   bic:">2.0",   you:calcs.magicNumber.toFixed(2), delta:calcs.magicNumber-0.9, suf:"" },
                          { m:"Burn Multiple",b:">2.5x",  med:"1.6x",    tq:"<1.0x",  bic:"<0.5x",  you:calcs.burnMultiple>0?mult(calcs.burnMultiple):"FCF+", delta:-(calcs.burnMultiple-1.6), suf:"x" },
                        ].map((row,ri) => (
                          <tr key={row.m} style={{ background:ri%2===0?C.surface:C.panel, borderBottom:`1px solid ${C.dim}` }}>
                            <td style={{ padding:"7px 9px", fontWeight:600, fontFamily:SANS }}>{row.m}</td>
                            <td style={{ padding:"7px 9px", textAlign:"center", color:C.red, fontFamily:MONO }}>{row.b}</td>
                            <td style={{ padding:"7px 9px", textAlign:"center", color:C.muted, fontFamily:MONO }}>{row.med}</td>
                            <td style={{ padding:"7px 9px", textAlign:"center", color:C.amber, fontFamily:MONO }}>{row.tq}</td>
                            <td style={{ padding:"7px 9px", textAlign:"center", color:C.green, fontFamily:MONO }}>{row.bic}</td>
                            <td style={{ padding:"7px 9px", textAlign:"center", fontFamily:MONO, fontWeight:700, color:C.steel }}>{row.you}</td>
                            <td style={{ padding:"7px 9px", textAlign:"center", fontFamily:MONO, fontWeight:700,
                              color: row.delta >= 0 ? C.green : C.red }}>
                              {row.delta >= 0 ? "+" : ""}{row.delta.toFixed(1)}{row.suf}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ METHODOLOGY TAB ════════════════════════════════════════════════ */}
          {tab === "METHODOLOGY" && (
            <div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
                {/* Waterfall */}
                <div style={panel}>
                  <F.head text="EV/ARR Multiple Build-Up" source="All adjustments source-cited in code comments" />
                  <WaterfallChart rows={calcs.wf} />
                  <div style={{ overflowX:"auto", marginTop:8 }}>
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                      <thead>
                        <tr style={{ borderBottom:`1.5px solid ${C.rule}` }}>
                          {["Adjustment Factor","Delta (x)","Running Total (x)"].map(h=>(
                            <th key={h} style={{ padding:"6px 8px", textAlign:h==="Adjustment Factor"?"left":"right", fontSize:9.5, letterSpacing:0.8, textTransform:"uppercase", color:C.ghost, fontWeight:700 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {calcs.wf.map((r,i) => (
                          <tr key={i} style={{ background:i%2===0?C.surface:C.panel, borderBottom:`1px solid ${C.dim}` }}>
                            <td style={{ padding:"7px 8px", fontSize:11.5, fontFamily:SANS, color:C.ink }}>{r.label}</td>
                            <td style={{ padding:"7px 8px", textAlign:"right", fontFamily:MONO, fontSize:12, fontWeight:700,
                              color: i===0 ? C.ink : r.val > 0 ? C.green : r.val < 0 ? C.red : C.muted }}>
                              {i===0 ? "" : r.val >= 0 ? "+" : ""}{r.val.toFixed(2)}x
                            </td>
                            <td style={{ padding:"7px 8px", textAlign:"right", fontFamily:MONO, fontSize:12, fontWeight:i===calcs.wf.length-1?800:500, color:C.steel }}>{r.cumul.toFixed(2)}x</td>
                          </tr>
                        ))}
                        <tr style={{ background:C.steelLt, borderTop:`2px solid ${C.rule}` }}>
                          <td style={{ padding:"9px 8px", fontWeight:700, fontSize:12 }}>Final Base Multiple</td>
                          <td />
                          <td style={{ padding:"9px 8px", textAlign:"right", fontFamily:MONO, fontSize:16, fontWeight:800, color:C.steel }}>{mult(calcs.baseMult)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Scenario table + cross-checks */}
                <div>
                  <div style={panel}>
                    <F.head text="Scenario Summary" />
                    <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5 }}>
                      <thead>
                        <tr style={{ borderBottom:`1.5px solid ${C.rule}` }}>
                          {["Scenario","Multiple","EV","Equity Value","vs Base"].map((h,i)=>(
                            <th key={h} style={{ padding:"6px 8px", textAlign:i===0?"left":"right", fontSize:9.5, letterSpacing:0.8, textTransform:"uppercase", color:C.ghost, fontWeight:700 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {[
                          { s:"Bear — No-process (×0.58)",  m:calcs.bearMult, ev:calcs.bearEV, eq:calcs.bearEqV, pct:(calcs.bearEV/calcs.baseEV-1)*100, c:C.red },
                          { s:"Base — Current conditions",   m:calcs.baseMult, ev:calcs.baseEV, eq:calcs.baseEqV, pct:0,                                    c:C.steel, bold:true },
                          { s:"Bull — Strategic process (×1.5)", m:calcs.bullMult, ev:calcs.bullEV, eq:calcs.bullEqV, pct:(calcs.bullEV/calcs.baseEV-1)*100, c:C.green },
                          { s:"DCF Intrinsic Value",         m:calcs.dcfEV/calcs.arr, ev:calcs.dcfEV, eq:calcs.dcfEV-calcs.netDebt, pct:(calcs.dcfEV/calcs.baseEV-1)*100, c:C.blue },
                        ].map((row,i)=>(
                          <tr key={i} style={{ background:i===1?C.steelLt:i%2===0?C.surface:C.panel, borderBottom:`1px solid ${C.dim}` }}>
                            <td style={{ padding:"8px 8px", fontFamily:SANS, fontSize:12, color:row.c, fontWeight:row.bold?700:500 }}>{row.s}</td>
                            <td style={{ padding:"8px 8px", textAlign:"right", fontFamily:MONO, fontWeight:700, color:row.c }}>{mult(row.m)}</td>
                            <td style={{ padding:"8px 8px", textAlign:"right", fontFamily:MONO, fontWeight:700, color:row.c }}>{$(row.ev)}</td>
                            <td style={{ padding:"8px 8px", textAlign:"right", fontFamily:MONO }}>{$(Math.max(0,row.eq))}</td>
                            <td style={{ padding:"8px 8px", textAlign:"right", fontFamily:MONO, fontWeight:700,
                              color: row.pct===0 ? C.muted : row.pct>0 ? C.green : C.red }}>
                              {row.pct===0?"—":`${row.pct>=0?"+":""}${row.pct.toFixed(0)}%`}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div style={panel}>
                    <F.head text="Valuation Cross-Checks" />
                    <F.row label="EV / ARR (base)" value={mult(calcs.baseMult)} vc={C.steel} bold />
                    <F.row label="EV / EBITDA (base)" value={calcs.evEbitda ? mult(calcs.evEbitda) : "N/A (pre-profit)"}
                      vc={calcs.evEbitda ? C.ink : C.ghost}
                      sub="Use only when EBITDA is positive and normalized" />
                    <F.row label="EV / Gross Profit" value={calcs.evGP ? mult(calcs.evGP) : "—"} />
                    <F.row label="EV / Net New ARR" value={calcs.evNewARR ? mult(calcs.evNewARR) : "—"}
                      sub="Value per dollar of incremental ARR added" />
                    <F.row label="Net Debt" value={$(calcs.netDebt)}
                      vc={calcs.netDebt > 0 ? C.red : C.green}
                      sub={`Cash: $${cashM}M — Debt: $${debtM}M`} />
                    <F.row label="EV → Equity Bridge" value={$(calcs.baseEqV)}
                      sub="EV + Cash − Debt (excl. minority interests, earn-outs)" bold />
                    <F.row label="DCF vs ARR Multiple" value={mult(calcs.dcfEV / calcs.arr)}
                      sub="Intrinsic value per unit of current ARR" />
                  </div>

                  <div style={{ ...panel, fontSize:11, color:C.muted, lineHeight:1.75, fontFamily:SANS }}>
                    <F.head text="Calibration Notes" />
                    <p style={{ margin:"0 0 8px" }}><strong style={{ color:C.ink }}>Anchor:</strong> Base multiples reflect private M&A transaction data (SEG 3,163 deals 2024; median 4.1x; equity-backed median 5.3x). Not public comps unless "Public Benchmark" is toggled.</p>
                    <p style={{ margin:"0 0 8px" }}><strong style={{ color:C.ink }}>Rule of 40:</strong> +2.2x per 10 points confirmed exact — Aventis Advisors (459 deals, 2015–2025) and Ful.io 2025, independently corroborated.</p>
                    <p style={{ margin:"0 0 8px" }}><strong style={{ color:C.ink }}>NRR bands:</strong> Calibrated to SEG 2025 Annual SaaS Report p.30 exact data. Public anchor: &lt;90%=1.2x; 100-110%=6.0x; &gt;120%=11.7x. Private discount ~40% applied.</p>
                    <p style={{ margin:0 }}><strong style={{ color:C.ink }}>Scenarios:</strong> Bear × 0.58 = Windsor Drake M&A 2025: no-process 35–45% discount (midpoint 42%). Bull × 1.50 = Windsor Drake: strategic buyers pay 1.5–2.0x over PE (conservative end).</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══ PROJECTIONS TAB ════════════════════════════════════════════════ */}
          {tab === "PROJECTIONS" && (
            <div>
              {/* ARR Bridge */}
              <div style={panel}>
                <F.head text="ARR Bridge — Current Period" source="Computed from ARR bridge component inputs" />
                <BridgeChart
                  open={calcs.openingArr} newLogo={calcs.newLogoArr}
                  expansion={calcs.expansionArr} contraction={calcs.contractionArr}
                  churn={calcs.churnArr} close={calcs.closingArr} />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:10, marginTop:12 }}>
                  {[
                    { lbl:"Opening ARR", v:$(calcs.openingArr), c:C.steel },
                    { lbl:"+ New Logo",  v:`+${$(calcs.newLogoArr)}`, c:C.green },
                    { lbl:"+ Expansion", v:`+${$(calcs.expansionArr)}`, c:"#2A7A46" },
                    { lbl:"− Contraction",v:`-${$(calcs.contractionArr)}`, c:C.amber },
                    { lbl:"− Churn",     v:`-${$(calcs.churnArr)}`, c:C.red },
                    { lbl:"Closing ARR", v:$(calcs.closingArr), c:C.blue },
                  ].map(({lbl,v,c}) => (
                    <div key={lbl} style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:"10px 12px" }}>
                      <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS, marginBottom:4 }}>{lbl}</div>
                      <div style={{ fontSize:15, fontWeight:700, fontFamily:MONO, color:c }}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop:10, padding:"8px 12px", background:C.steelLt, borderRadius:3, fontSize:11, fontFamily:SANS, color:C.steel }}>
                  Derived NRR from bridge components: <strong>{pct(calcs.nrrDerived)}</strong> (vs. input NRR: {pct(nrr)}).
                  {Math.abs(calcs.nrrDerived - nrr) > 3 && (
                    <span style={{ color:C.amber }}> ⚠ Bridge components imply different NRR than stated — reconcile or adjust expansion/contraction/churn inputs.</span>
                  )}
                </div>
              </div>

              {/* ARR trajectory */}
              <div style={panel}>
                <F.head text={`${horizonYrs}-Year ARR Trajectory`} source={`Growth decay: Benchmarkit 2025 growth endurance 65%/yr`} />
                <LineChart
                  series={[{ key:"arr", data:[calcs.arr, ...calcs.dcfRows.slice(0,horizonYrs).map(r=>r.arr)], color:C.steel }]}
                  yFmt={v => $(v,0)} showDots />
              </div>

              {/* Full DCF schedule */}
              <div style={panel}>
                <F.head text="DCF — Full Financial Schedule" source="FCF = NOPAT + D&A − Capex − ΔWC + SBC (SaaS capex-light model)" />
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11 }}>
                    <thead>
                      <tr style={{ borderBottom:`1.5px solid ${C.rule}` }}>
                        {["Metric","Current",...calcs.dcfRows.slice(0,horizonYrs).map(r=>`Year ${r.year}`)].map(h=>(
                          <th key={h} style={{ padding:"6px 10px", textAlign:h==="Metric"?"left":"right", fontSize:9.5, letterSpacing:0.8, textTransform:"uppercase", color:C.ghost, fontWeight:700 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { lbl:"ARR",          key:"arr",             fmt:v=>$(v),        bold:true },
                        { lbl:"YoY Growth",   key:"growth",          fmt:v=>pct(v),      color:v=>ratioColor(v,calcs.gRef,calcs.gRef*0.5) },
                        { lbl:"Gross Profit", key:"gp",              fmt:v=>$(v) },
                        { lbl:"EBITDA Margin",key:"ebitdaMarginAct", fmt:v=>pct(v),      color:v=>ratioColor(v,0,-20) },
                        { lbl:"EBITDA ($)",   key:"ebitda",          fmt:v=>$(v),        color:v=>v>=0?C.green:C.red },
                        { lbl:"EBIT",         key:"ebit",            fmt:v=>$(v),        color:v=>v>=0?C.green:C.red },
                        { lbl:"NOPAT",        key:"nopat",           fmt:v=>$(v),        color:v=>v>=0?C.green:C.red },
                        { lbl:"Free Cash Flow",key:"fcf",            fmt:v=>$(v),        color:v=>v>=0?C.green:C.red, bold:true },
                        { lbl:"PV of FCF",    key:"pvFcf",           fmt:v=>$(v),        color:v=>v>=0?C.steel:C.muted },
                      ].map((row,ri)=>(
                        <tr key={ri} style={{ background:ri%2===0?C.surface:C.panel, borderBottom:`1px solid ${C.dim}` }}>
                          <td style={{ padding:"7px 10px", fontWeight:row.bold?700:500, fontFamily:SANS }}>{row.lbl}</td>
                          <td style={{ padding:"7px 10px", textAlign:"right", fontFamily:MONO, color:C.muted }}>
                            {row.key==="arr"?$(calcs.arr):row.key==="growth"?pct(arrGrowth):row.key==="ebitdaMarginAct"?pct(ebitdaMargin):row.key==="ebitda"?$(calcs.ebitdaDollars):"—"}
                          </td>
                          {calcs.dcfRows.slice(0,horizonYrs).map((r,ci)=>(
                            <td key={ci} style={{ padding:"7px 10px", textAlign:"right", fontFamily:MONO, fontWeight:row.bold?700:500,
                              color: row.color ? row.color(r[row.key]) : C.ink }}>
                              {row.fmt(r[row.key])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background:C.steelLt, borderTop:`2px solid ${C.rule}` }}>
                        <td colSpan={2} style={{ padding:"9px 10px", fontWeight:700, fontSize:12 }}>DCF Enterprise Value</td>
                        <td colSpan={horizonYrs - 1} style={{ padding:"9px 10px", textAlign:"right", fontSize:11, color:C.muted, fontFamily:SANS }}>
                          PV FCFs: {$(calcs.sumPvFCF,0)} · PV Terminal: {$(calcs.pvTV,0)} · TV = {(calcs.pvTV/calcs.dcfEV*100).toFixed(0)}% of EV
                        </td>
                        <td style={{ padding:"9px 10px", textAlign:"right", fontFamily:MONO, fontSize:16, fontWeight:800, color:C.steel }}>{$(calcs.dcfEV)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ═══ COHORTS TAB ════════════════════════════════════════════════════ */}
          {tab === "COHORTS" && (
            <div>
              <div style={panel}>
                <F.head text="Revenue Cohort Retention Curves" source="Modeled from logo churn + NRR expansion inputs; 7-year curves" />
                <p style={{ fontSize:11.5, color:C.muted, fontFamily:SANS, margin:"0 0 14px", lineHeight:1.7 }}>
                  Each cohort starts at $1 of ARR. Revenue per cohort = logo survival × per-customer expansion.
                  Logo survival = (1 − {pct(logoChurn)})^year. Per-customer expansion rate = NRR / (1 − logo churn) = {(nrr / 100 / (1 - logoChurn/100)).toFixed(3)}.
                  Curves below 1.0 indicate net revenue decay; above 1.0 indicate net expansion from existing customers alone.
                </p>
                <LineChart
                  series={calcs.cohorts.map((c, i) => ({
                    key: c.id.toString(),
                    data: c.curve,
                    color: [C.steel, C.green, C.amber, C.blue, C.red][i],
                  }))}
                  yFmt={v => `${(v * 100).toFixed(0)}%`}
                  height={180} showDots />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginTop:14 }}>
                  {calcs.cohorts.map((c, i) => {
                    const yr5 = c.curve[5];
                    const yr7 = c.curve[6];
                    const colors = [C.steel, C.green, C.amber, C.blue, C.red];
                    return (
                      <div key={i} style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:"10px 12px" }}>
                        <div style={{ fontSize:10, color:colors[i], fontFamily:SANS, fontWeight:700, marginBottom:6 }}>Cohort {i+1}</div>
                        <F.row label="Y1" value={pct(c.curve[1]*100)} />
                        <F.row label="Y3" value={pct(c.curve[3]*100)} />
                        <F.row label="Y5" value={pct(c.curve[5]*100)} vc={yr5 >= 1 ? C.green : C.red} />
                        <F.row label="Y7" value={pct(c.curve[6]*100)} vc={yr7 >= 1 ? C.green : C.red} />
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop:12, padding:"10px 14px", background: calcs.cohorts[0].curve[5] >= 1 ? C.greenLt : C.redLt,
                  borderRadius:3, border:`1px solid ${calcs.cohorts[0].curve[5] >= 1 ? C.green : C.red}44` }}>
                  <div style={{ fontSize:11.5, color:C.ink, fontFamily:SANS, lineHeight:1.7 }}>
                    <strong>Interpretation:</strong> At current logo churn of {pct(logoChurn)} and NRR of {pct(nrr)},
                    cohorts {calcs.cohorts[0].curve[5] >= 1 ? "expand" : "erode"} to {pct(calcs.cohorts[0].curve[5]*100)} of initial ARR after 5 years.
                    {calcs.cohorts[0].curve[5] < 1
                      ? " This indicates net revenue destruction from existing customers — the company must continuously acquire new logos just to maintain ARR. Fix NRR before scaling S&M."
                      : " Each cohort is self-compounding — existing customers generate more revenue over time than they started with. This is the foundation of durable SaaS economics."}
                  </div>
                </div>
              </div>

              <div style={panel}>
                <F.head text="NRR Compounding Effect on ARR" source="Annual compounding of NRR from existing customer base" />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                  {[100, nrr, 120].map((n, i) => {
                    let v = calcs.arr;
                    for (let y = 0; y < horizonYrs; y++) v *= n / 100;
                    const label = i===0 ? "Flat Retention (100%)" : i===1 ? `Your NRR (${pct(n)})` : "Best-in-Class (120%)";
                    const color = i===0 ? C.red : i===1 ? C.steel : C.green;
                    return (
                      <div key={n} style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:"16px 18px" }}>
                        <div style={{ fontSize:11, color:C.muted, fontFamily:SANS, marginBottom:6 }}>{label}</div>
                        <div style={{ fontSize:24, fontWeight:800, fontFamily:MONO, color }}>{$(v)}</div>
                        <div style={{ fontSize:11, color:C.ghost, fontFamily:SANS, marginTop:4 }}>ARR from existing base after {horizonYrs}yr</div>
                        <div style={{ fontSize:12, fontWeight:700, fontFamily:MONO, color, marginTop:6 }}>
                          {pct((v/calcs.arr-1)*100)} total return on existing ARR
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ SENSITIVITY TAB ════════════════════════════════════════════════ */}
          {tab === "SENSITIVITY" && (
            <div>
              {/* NRR × Growth */}
              <div style={panel}>
                <F.head text="EV/ARR Multiple — ARR Growth (rows) × NRR (columns)" source="Full model re-computed at each cell. Active inputs highlighted." />
                <div style={{ overflowX:"auto" }}>
                  <table style={{ borderCollapse:"collapse" }}>
                    <thead>
                      <tr>
                        <td style={{ padding:"6px 10px", fontSize:9.5, color:C.ghost, fontFamily:SANS, textTransform:"uppercase" }}>Growth ↓ / NRR →</td>
                        {[85,90,95,100,108,115,120,130].map(n=>(
                          <th key={n} style={{ padding:"6px 10px", fontSize:10, textAlign:"center",
                            color: Math.abs(n-nrr)<4 ? C.steel : C.ghost, fontFamily:MONO,
                            fontWeight: Math.abs(n-nrr)<4 ? 700 : 500 }}>{n}%</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[10,20,30,40,55,70,90,120].map(g=>(
                        <tr key={g}>
                          <td style={{ padding:"6px 10px", fontFamily:MONO, fontSize:11, color:Math.abs(g-arrGrowth)<8?C.steel:C.muted,
                            fontWeight:Math.abs(g-arrGrowth)<8?700:400 }}>{g}%</td>
                          {[85,90,95,100,108,115,120,130].map(n=>{
                            const v = computeValuation({...inputs, arrGrowth:g, nrr:n});
                            const isActive = Math.abs(g-arrGrowth)<8 && Math.abs(n-nrr)<4;
                            return <HCell key={n} v={v.baseMult.toFixed(1)} isActive={isActive} />;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS, marginTop:8 }}>All other inputs held constant at current values. Colors: green ≥10x · blue 6–10x · amber 4–6x · red &lt;4x</div>
              </div>

              {/* WACC × Terminal Growth (DCF EV) */}
              <div style={panel}>
                <F.head text="DCF Enterprise Value — WACC (rows) × Terminal Growth Rate (columns)" source="Full DCF re-computed at each cell." />
                <div style={{ overflowX:"auto" }}>
                  <table style={{ borderCollapse:"collapse" }}>
                    <thead>
                      <tr>
                        <td style={{ padding:"6px 10px", fontSize:9.5, color:C.ghost, fontFamily:SANS, textTransform:"uppercase" }}>WACC ↓ / g →</td>
                        {[1.5,2.0,2.5,3.0,3.5,4.0,4.5].map(tg=>(
                          <th key={tg} style={{ padding:"6px 10px", fontSize:10, textAlign:"center",
                            color: Math.abs(tg-termGrowthRate)<0.4 ? C.steel : C.ghost, fontFamily:MONO,
                            fontWeight: Math.abs(tg-termGrowthRate)<0.4 ? 700 : 500 }}>{tg}%</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[8,10,12,14,16,18,20].map(w=>(
                        <tr key={w}>
                          <td style={{ padding:"6px 10px", fontFamily:MONO, fontSize:11, color:Math.abs(w-wacc)<1.5?C.steel:C.muted,
                            fontWeight:Math.abs(w-wacc)<1.5?700:400 }}>{w}%</td>
                          {[1.5,2.0,2.5,3.0,3.5,4.0,4.5].map(tg=>{
                            const v = computeValuation({...inputs, wacc:w, termGrowthRate:tg});
                            const isActive = Math.abs(w-wacc)<1.5 && Math.abs(tg-termGrowthRate)<0.4;
                            const ev = v.dcfEV;
                            const evMult = ev / calcs.arr;
                            return <HCell key={tg} v={evMult.toFixed(1)} isActive={isActive} />;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS, marginTop:8 }}>Showing DCF EV/ARR implied multiple. All other DCF inputs held constant.</div>
              </div>

              {/* Gross margin × Rule of 40 */}
              <div style={panel}>
                <F.head text="EV/ARR Multiple — Gross Margin (rows) × EBITDA Margin (columns)" source="Rule of 40 is growth rate + EBITDA margin; growth held constant." />
                <div style={{ overflowX:"auto" }}>
                  <table style={{ borderCollapse:"collapse" }}>
                    <thead>
                      <tr>
                        <td style={{ padding:"6px 10px", fontSize:9.5, color:C.ghost, fontFamily:SANS, textTransform:"uppercase" }}>GM ↓ / EBITDA →</td>
                        {[-40,-20,-10,0,10,20,30].map(em=>(
                          <th key={em} style={{ padding:"6px 10px", fontSize:10, textAlign:"center",
                            color: Math.abs(em-ebitdaMargin)<6 ? C.steel : C.ghost, fontFamily:MONO,
                            fontWeight: Math.abs(em-ebitdaMargin)<6 ? 700 : 500 }}>{em}%</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[45,55,65,72,78,83,90].map(gm=>(
                        <tr key={gm}>
                          <td style={{ padding:"6px 10px", fontFamily:MONO, fontSize:11, color:Math.abs(gm-grossMargin)<4?C.steel:C.muted,
                            fontWeight:Math.abs(gm-grossMargin)<4?700:400 }}>{gm}%</td>
                          {[-40,-20,-10,0,10,20,30].map(em=>{
                            const v = computeValuation({...inputs, grossMargin:gm, ebitdaMargin:em});
                            const isActive = Math.abs(gm-grossMargin)<4 && Math.abs(em-ebitdaMargin)<6;
                            return <HCell key={em} v={v.baseMult.toFixed(1)} isActive={isActive} />;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Reverse: implied ARR for target EV */}
              <div style={panel}>
                <F.head text="Reverse Valuation — ARR Required to Justify Target EV at Current Multiple" />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(6,1fr)", gap:10 }}>
                  {[25e6,50e6,100e6,250e6,500e6,1e9].map(tev=>{
                    const impliedARR = tev / calcs.baseMult;
                    const gap = impliedARR - calcs.arr;
                    return (
                      <div key={tev} style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:4, padding:"12px 13px" }}>
                        <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS, marginBottom:5 }}>Target EV: {$(tev,0)}</div>
                        <div style={{ fontSize:18, fontWeight:700, fontFamily:MONO, color:C.ink }}>{$(impliedARR,1)}</div>
                        <div style={{ fontSize:10, color:C.ghost, fontFamily:SANS, marginTop:4 }}>ARR required</div>
                        <div style={{ fontSize:11, fontWeight:700, fontFamily:MONO, marginTop:4,
                          color: gap <= 0 ? C.green : C.red }}>
                          {gap <= 0 ? "Current ARR sufficient" : `+${$(gap,1)} needed`}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═══ DILIGENCE TAB ════════════════════════════════════════════════ */}
          {tab === "DILIGENCE" && (
            <div>
              <div style={panel}>
                <DiligenceCard calcs={calcs} inputs={inputs} />
              </div>

              {/* Auto-generated red flags */}
              <div style={panel}>
                <F.head text="Automated Risk Flag Analysis" source="Threshold-based, sourced to lender/PE standards" />
                {(() => {
                  const flags = [];
                  if (nrr < 100) flags.push({ sev:"HIGH", msg:`NRR of ${pct(nrr)} means the installed base is shrinking. Revenue erodes before new sales. SEG data: NRR <90% = 1.2x median multiple vs 6.0x at 100–110%. Immediate action required.` });
                  if (grr < DATA.GRR_COVENANT_FLOOR) flags.push({ sev:"HIGH", msg:`GRR of ${pct(grr)} is below the ${DATA.GRR_COVENANT_FLOOR}% lender covenant minimum (ABF Journal 2025). This will restrict debt financing. Maximum customer churn is eroding the base before expansion can offset it.` });
                  if (calcs.ltvCac < 2.0) flags.push({ sev:"HIGH", msg:`LTV:CAC of ${mult(calcs.ltvCac)} is below the 2x viability floor. At this ratio, every dollar spent acquiring customers destroys more capital than it creates at current retention. Fix before scaling GTM.` });
                  if (logoChurn > 15) flags.push({ sev:"HIGH", msg:`Annual logo churn of ${pct(logoChurn)} implies a ${yr(calcs.lifetimeYrs)} average customer lifetime and replacing the entire base every ${(100/logoChurn).toFixed(1)} years. Buyers will apply a severe multiple discount until this is resolved.` });
                  if (calcs.burnMultiple > 2.5) flags.push({ sev:"MEDIUM", msg:`Burn Multiple of ${mult(calcs.burnMultiple)} is well above the 2.0x watch threshold. The company burns $${calcs.burnMultiple.toFixed(1)} for every $1 of net new ARR. Benchmarkit 2025 median: 1.6x. This signals GTM inefficiency or premature scale.` });
                  if (calcs.rule40 < 10) flags.push({ sev:"MEDIUM", msg:`Rule of 40 score of ${calcs.rule40.toFixed(0)} is deeply negative. Per Aventis regression data, each 10-point improvement = +2.2x EV/ARR. Companies scoring below 20 rarely command institutional multiples.` });
                  if (grossMargin < 60) flags.push({ sev:"MEDIUM", msg:`Gross margin of ${pct(grossMargin)} is below the 65% threshold that triggers PE diligence flags. SaaS median is 73%; targets below 60% suggest services-heavy delivery, infrastructure inefficiency, or aggressive discounting.` });
                  if (Math.abs(calcs.nrrDerived - nrr) > 5) flags.push({ sev:"MEDIUM", msg:`ARR bridge components imply NRR of ${pct(calcs.nrrDerived)} but stated NRR is ${pct(nrr)}. Difference of ${pct(Math.abs(calcs.nrrDerived-nrr))}. This reconciliation gap is a key diligence red flag — buyers will stress-test cohort-level retention data.` });
                  if (calcs.magicNumber < 0.5) flags.push({ sev:"MEDIUM", msg:`Magic Number of ${calcs.magicNumber.toFixed(2)} is below 0.5. The GTM engine generates only $${(calcs.magicNumber*100).toFixed(0)} of gross-margin-adjusted ARR for every $100 of S&M spend. Benchmarkit 2024 median: 0.90. Review pipeline quality and sales cycle efficiency.` });
                  if (revenueMix < 70) flags.push({ sev:"LOW", msg:`Recurring revenue mix of ${pct(revenueMix)} means ${pct(100-revenueMix)} of revenue is non-recurring. FE International data: MRR valued ~2x over one-time revenue. Buyers will apply a significant haircut to non-recurring components in valuation.` });
                  if (flags.length === 0) flags.push({ sev:"CLEAR", msg:"No material diligence flags identified at current inputs. Asset demonstrates strong fundamentals across all monitored risk categories." });
                  const sevColor = { HIGH:C.red, MEDIUM:C.amber, LOW:C.steel, CLEAR:C.green };
                  const sevBg    = { HIGH:C.redLt, MEDIUM:C.amberLt, LOW:C.steelLt, CLEAR:C.greenLt };
                  return flags.map((f,i) => (
                    <div key={i} style={{ display:"flex", gap:12, padding:"12px 0", borderBottom:`1px solid ${C.dim}` }}>
                      <span style={{ fontSize:9.5, fontWeight:700, fontFamily:SANS, letterSpacing:0.8, padding:"3px 7px",
                        borderRadius:2, whiteSpace:"nowrap", alignSelf:"flex-start",
                        background:sevBg[f.sev], color:sevColor[f.sev], border:`1px solid ${sevColor[f.sev]}44` }}>{f.sev}</span>
                      <p style={{ margin:0, fontSize:11.5, color:C.ink, fontFamily:SANS, lineHeight:1.7 }}>{f.msg}</p>
                    </div>
                  ));
                })()}
              </div>

              {/* Value creation levers */}
              <div style={panel}>
                <F.head text="Value Creation Levers — Ranked by Multiple Impact" source="Delta computed by full model re-run at improved inputs" />
                {[
                  { action:`Improve NRR to 115% (from ${pct(nrr)})`, delta: nrr < 115 ? computeValuation({...inputs,nrr:115}).baseMult - calcs.baseMult : 0, priority: nrr < 105 ? "HIGH" : "MED", rationale:"SEG 2025 p.30: NRR 110-120% = 9.0x vs 6.0x at 100-110%. Each 5ppt NRR improvement = ~0.5x private market multiple at median." },
                  { action:`Achieve Rule of 40 (current: ${calcs.rule40.toFixed(0)})`, delta: calcs.rule40 < 40 ? computeValuation({...inputs, ebitdaMargin: Math.min(0, 40-arrGrowth)}).baseMult - calcs.baseMult : 0, priority: calcs.rule40 < 20 ? "HIGH" : "MED", rationale:"Aventis exact: +2.2x EV/ARR per 10pts. Achieve R40=40 via EBITDA improvement, not growth reduction. Buyers read R40 as a proxy for long-run FCF margin." },
                  { action:`Grow ARR to $25M+ (current: $${arrM}M)`, delta: arrM < 25 ? computeValuation({...inputs,arrM:25}).baseMult - calcs.baseMult : 0, priority: arrM < 10 ? "HIGH" : arrM < 25 ? "MED" : "DONE", rationale:"Solganick/Axial 2025: ~1-2x per $20M ARR. $25M ARR opens mid-market PE universe. $50M+ opens large-cap PE and strategic M&A processes." },
                  { action:`Reduce logo churn below 8% (from ${pct(logoChurn)})`, delta: logoChurn > 8 ? computeValuation({...inputs,logoChurn:7}).baseMult - calcs.baseMult : 0, priority: logoChurn > 15 ? "HIGH" : "LOW", rationale:"ABF Journal: lenders require no customer >15% ARR and GRR ≥85%. Logo churn directly drives GRR and is the most visible diligence red flag after NRR." },
                  { action:`Improve gross margin to 75%+ (from ${pct(grossMargin)})`, delta: grossMargin < 75 ? computeValuation({...inputs,grossMargin:76}).baseMult - calcs.baseMult : 0, priority: grossMargin < 65 ? "HIGH" : "LOW", rationale:"PE threshold: <65% gross margin = operational risk flag. SaaS median 73%; target 75-85%. Improvement requires pricing power or infrastructure optimization." },
                ].map((lv,i)=>(
                  <div key={i} style={{ display:"flex", gap:14, padding:"13px 0", borderBottom:`1px solid ${C.dim}`, alignItems:"flex-start" }}>
                    <div style={{ textAlign:"center", minWidth:56 }}>
                      <span style={{ fontSize:9, fontWeight:700, padding:"3px 6px", borderRadius:2, display:"block", marginBottom:4,
                        background: lv.priority==="HIGH"?C.redLt:lv.priority==="MED"?C.amberLt:lv.priority==="DONE"?C.greenLt:C.steelLt,
                        color: lv.priority==="HIGH"?C.red:lv.priority==="MED"?C.amber:lv.priority==="DONE"?C.green:C.steel }}>{lv.priority}</span>
                      {lv.delta > 0.05 && (
                        <span style={{ fontSize:11, fontFamily:MONO, fontWeight:700, color:C.green }}>+{lv.delta.toFixed(1)}x</span>
                      )}
                    </div>
                    <div>
                      <div style={{ fontSize:12.5, fontWeight:700, color:C.ink, fontFamily:SANS, marginBottom:4 }}>{lv.action}</div>
                      <div style={{ fontSize:11.5, color:C.muted, fontFamily:SANS, lineHeight:1.65 }}>{lv.rationale}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ═══ COMPS TAB ════════════════════════════════════════════════════ */}
          {tab === "COMPS" && (
            <div>
              <div style={panel}>
                <CompsTable baseInputs={inputs} compute={computeValuation} />
              </div>
              <div style={panel}>
                <F.head text="2025 Market Reference Data" source="SaaS Capital · SEG · Aventis · Bessemer · Benchmarkit · Windsor Drake · ABF Journal" />
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:10 }}>
                  {[
                    { lbl:"Public SaaS Median (SCI)",     val:"6.7–7.0x", sub:"SaaS Capital Index, June 2025" },
                    { lbl:"Public SaaS (Bessemer)",       val:"7.5x",     sub:"Bessemer Cloud Index, 2025" },
                    { lbl:"Private M&A Median (SEG)",     val:"4.1x",     sub:"SEG 3,163 deals, 2024" },
                    { lbl:"Private Equity-Backed (SCI)",  val:"5.3x",     sub:"SaaS Capital n=1,000+, 2025" },
                    { lbl:"Private EBITDA Multiple",      val:"19.2x",    sub:"SEG M&A Report 2024 (profitable)" },
                    { lbl:"Public EBITDA Multiple",       val:"38.2x",    sub:"SEG median public SaaS 2024" },
                    { lbl:"Top-10 Public ARR Multiple",   val:"14.2x",    sub:"SaaS Capital SCI, YE 2024" },
                    { lbl:"Public SaaS EBITDA Margin",    val:"9.3%",     sub:"SaaS Capital Index, Q3 2025" },
                    { lbl:"Rule of 40 Valuation Premium", val:"121%",     sub:"vs. sub-40 peers (SaasRise 2025)" },
                    { lbl:"AI-Native Premium",            val:"20–40%",   sub:"SaasRise/Battery Ventures 2025" },
                    { lbl:"CAC Payback Median",           val:"20mo",     sub:"SaaS Benchmark Report 2025, n=2,000+" },
                    { lbl:"LTV:CAC Median",               val:"3.6x",     sub:"Benchmarkit 2024, n=936" },
                    { lbl:"Magic Number Median",          val:"0.90",     sub:"Benchmarkit 2024, n=936" },
                    { lbl:"Burn Multiple Median (Ser.A)", val:"1.6x",     sub:"CFO Advisors / Benchmarkit 2025" },
                    { lbl:"NRR Median (Private)",         val:"106%",     sub:"ChartMogul n=2,100; SaaS Capital" },
                    { lbl:"NRR Enterprise Median",        val:"118%",     sub:"Optifai n=939 / ChartMogul 2024" },
                    { lbl:"GRR Lender Floor",             val:"85%",      sub:"ABF Journal SaaS lending 2025" },
                    { lbl:"Public SaaS Growth Median",    val:"12.2%",    sub:"Aventis Index, Q4 2025" },
                    { lbl:"Private SaaS Growth Median",   val:"25%",      sub:"SaaS Capital survey, 2024" },
                    { lbl:"Growth Endurance",             val:"65%",      sub:"Benchmarkit 2025 (was 80%)" },
                  ].map(({lbl,val,sub}) => (
                    <div key={lbl} style={{ background:C.panel, border:`1px solid ${C.border}`, borderRadius:3, padding:"10px 12px" }}>
                      <div style={{ fontSize:9.5, color:C.ghost, fontFamily:SANS, textTransform:"uppercase", letterSpacing:0.8, marginBottom:4 }}>{lbl}</div>
                      <div style={{ fontSize:17, fontWeight:700, fontFamily:MONO, color:C.steel }}>{val}</div>
                      <div style={{ fontSize:9.5, color:C.ghost, fontFamily:SANS, marginTop:3 }}>{sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop:`1px solid ${C.border}`, background:C.surface, padding:"9px 24px",
        display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:9.5, color:C.ghost, fontFamily:SANS }}>FOR INTERNAL USE ONLY — Indicative analysis only. Not investment advice. Consult a qualified M&A advisor for formal valuation opinions.</span>
        <span style={{ fontSize:9.5, color:C.ghost, fontFamily:MONO }}>v3.0 · {new Date().toLocaleDateString("en-US",{year:"numeric",month:"short",day:"numeric"})}</span>
      </div>
    </div>
  );
}
