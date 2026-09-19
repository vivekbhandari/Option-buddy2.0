/*
 * OptionsBuddy — shared engine.
 * Pricing math, strategy library data, local persistence, and formatting
 * helpers shared by every page (Trade Builder, Dashboard, Learn).
 * Everything lives on window.SB so plain <script> tags can share it
 * without a bundler or ES modules (keeps the site openable from file://).
 */
window.SB = (function () {
  'use strict';

  // ---------- Black-Scholes ----------
  const DEFAULT_RATE = 0.04;
  function erf(x) {
    const s = x < 0 ? -1 : 1; x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
    return s * y;
  }
  const ncdf = x => 0.5 * (1 + erf(x / Math.SQRT2));
  const npdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);

  function bs(type, S, K, T, sigma, r) {
    if (r === undefined || r === null || isNaN(r)) r = DEFAULT_RATE;
    if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) {
      const intr = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
      return { price: intr, delta: type === 'call' ? (S > K ? 1 : 0) : (S < K ? -1 : 0), gamma: 0, theta: 0, vega: 0, rho: 0 };
    }
    const sq = sigma * Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sq, d2 = d1 - sq;
    const price = type === 'call' ? S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2) : K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
    const delta = type === 'call' ? ncdf(d1) : ncdf(d1) - 1;
    const sgn = type === 'call' ? 1 : -1;
    const gamma = npdf(d1) / (S * sq);
    const theta = (-(S * npdf(d1) * sigma) / (2 * Math.sqrt(T)) - sgn * r * K * Math.exp(-r * T) * ncdf(sgn * d2)) / 365;
    const vega = S * npdf(d1) * Math.sqrt(T) / 100;
    const rho = sgn * K * T * Math.exp(-r * T) * ncdf(sgn * d2) / 100;
    return { price, delta, gamma, theta, vega, rho };
  }
  function solveIV(type, S, K, T, price, r) {
    if (r === undefined || r === null || isNaN(r)) r = DEFAULT_RATE;
    if (!(S > 0 && K > 0 && T > 0 && price > 0)) return null;
    const intr = type === 'call' ? Math.max(S - K * Math.exp(-r * T), 0) : Math.max(K * Math.exp(-r * T) - S, 0);
    if (price <= intr + 1e-6) return null;
    let lo = 0.01, hi = 5;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (bs(type, S, K, T, mid, r).price > price) hi = mid; else lo = mid; }
    return (lo + hi) / 2;
  }
  function roundStrike(x, S) { const inc = S < 20 ? 0.5 : S < 100 ? 1 : S < 250 ? 2.5 : 5; return Math.round(x / inc) * inc; }
  // bisection search for the strike whose Black-Scholes delta is closest to targetDelta
  // (targetDelta is signed: positive for calls, negative for puts, matching bs().delta —
  // both are decreasing functions of strike, since both derive from N(d1), so the same
  // bisection direction works for calls and puts)
  function findStrikeByDelta(type, targetDelta, S, T, r, sigma) {
    let lo = S * 0.5, hi = S * 1.8;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const d = bs(type, S, mid, T, sigma, r).delta;
      if (d > targetDelta) lo = mid; else hi = mid;
    }
    return roundStrike((lo + hi) / 2, S);
  }

  // ---------- strategy library ----------
  const CATS = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral', bigmove: 'Big move', hedge: 'Hedge' };
  const STRATS = [
    { id: 'long_call', name: 'Long call', cat: 'bullish', outlook: 'Strongly bullish, expecting a real move.', ivEnv: 'buy', legs: [['long', 'call', 0.02]], tip: 'Needs IV low and a real move to happen before expiration — theta fights you the whole way.', watch: 'IV crush after a catalyst can hurt even a correct directional call.' },
    { id: 'bull_call_spread', name: 'Bull call spread', cat: 'bullish', outlook: 'Moderately bullish, defined risk (debit).', ivEnv: 'either', legs: [['long', 'call', 0], ['short', 'call', 0.08]], tip: "You're trading some upside for a lower cost and a hard cap on loss.", watch: 'Profit is capped even if the stock rips straight through your short strike.' },
    { id: 'bull_put_spread', name: 'Bull put spread', cat: 'bullish', outlook: 'Bullish to neutral, income (credit).', ivEnv: 'sell', legs: [['short', 'put', -0.05], ['long', 'put', -0.12]], tip: 'The tastytrade workhorse income trade — small, defined, repeatable.', watch: 'A fast drop through the short strike happens quicker than it feels like it should.' },
    { id: 'covered_call', name: 'Covered call', cat: 'bullish', outlook: 'Neutral to mildly bullish on stock you hold.', ivEnv: 'sell', legs: [['long', 'stock', 0], ['short', 'call', 0.06]], tip: "You're getting paid to cap your upside above the strike — decide in advance if that trade is worth it.", watch: 'Selling too close to the money can get shares called away right before a rally.' },
    { id: 'csp', name: 'Cash-secured put', cat: 'bullish', outlook: 'Neutral to bullish; happy to own the stock.', ivEnv: 'sell', legs: [['short', 'put', -0.06]], tip: 'A limit order to buy stock you already wanted, with a paycheck attached for waiting.', watch: "If assigned, cost basis is strike minus premium — make sure that's still a price you like." },
    { id: 'long_put', name: 'Long put', cat: 'bearish', outlook: 'Strongly bearish, expecting a real move.', ivEnv: 'buy', legs: [['long', 'put', -0.02]], tip: 'Same logic as a long call, aimed down — a strong opinion with bad timing still loses money.', watch: 'IV often rises as stocks fall, which can help — but a slow grind down still bleeds theta.' },
    { id: 'bear_put_spread', name: 'Bear put spread', cat: 'bearish', outlook: 'Moderately bearish, defined risk (debit).', ivEnv: 'either', legs: [['long', 'put', 0], ['short', 'put', -0.08]], tip: 'Mirror image of the bull call spread — same defined-risk trade-off, aimed the other way.', watch: 'Profit caps out below the short strike, even on a crash.' },
    { id: 'bear_call_spread', name: 'Bear call spread', cat: 'bearish', outlook: 'Bearish to neutral, income (credit).', ivEnv: 'sell', legs: [['short', 'call', 0.05], ['long', 'call', 0.12]], tip: 'Mirror image of the bull put spread — same workhorse logic, upside-down.', watch: 'A sharp melt-up can run through the short strike fast, especially in thinner names.' },
    { id: 'iron_condor', name: 'Iron condor', cat: 'neutral', outlook: 'Range-bound, no strong directional view.', ivEnv: 'sell', legs: [['short', 'put', -0.07], ['long', 'put', -0.14], ['short', 'call', 0.07], ['long', 'call', 0.14]], tip: "tastytrade's bread-and-butter trade — small, defined, high-probability, boring on purpose.", watch: "Resist holding to expiration for the last few dollars — that's where pin risk and gamma risk live." },
    { id: 'iron_fly', name: 'Iron butterfly', cat: 'neutral', outlook: 'Range-bound, more precise view.', ivEnv: 'sell', legs: [['short', 'put', 0], ['long', 'put', -0.10], ['short', 'call', 0], ['long', 'call', 0.10]], tip: "More credit, tighter profit zone — you're betting on where it stays range-bound, not just whether.", watch: 'Needs more precision than a condor; a wrong guess on center hurts faster.' },
    { id: 'short_strangle', name: 'Short strangle', cat: 'neutral', outlook: 'Range-bound. Undefined risk.', ivEnv: 'sell', undefinedRisk: true, legs: [['short', 'put', -0.08], ['short', 'call', 0.08]], tip: "tastytrade's most-backtested “sell high IV, buy back at half” trade — but undefined risk wants real capital behind it.", watch: 'A surprise move can produce an outsized loss; risk is theoretically uncapped on the call side.' },
    { id: 'short_straddle', name: 'Short straddle', cat: 'neutral', outlook: 'Very tight range expected. Undefined risk.', ivEnv: 'sell', undefinedRisk: true, legs: [['short', 'put', 0], ['short', 'call', 0]], tip: 'The highest premium of any single-expiration strategy, and the least room for error.', watch: 'Undefined risk in both directions at once — size it very small.' },
    { id: 'long_straddle', name: 'Long straddle', cat: 'bigmove', outlook: 'Expect a large move, direction unclear.', ivEnv: 'buy', legs: [['long', 'put', 0], ['long', 'call', 0]], tip: "Being right on direction isn't enough — the move also has to happen before IV collapses.", watch: 'Buying right before earnings, when IV is already sky-high, means paying peak price.' },
    { id: 'long_strangle', name: 'Long strangle', cat: 'bigmove', outlook: 'Expect a large move, lower cost entry.', ivEnv: 'buy', legs: [['long', 'put', -0.05], ['long', 'call', 0.05]], tip: 'Cheaper than a straddle, but needs a bigger move to pay off — decide which trade-off fits.', watch: 'Needs a larger move than a straddle just to reach breakeven.' },
    { id: 'protective_put', name: 'Married / protective put', cat: 'hedge', outlook: 'Bullish long-term, cap near-term downside.', ivEnv: 'buy', legs: [['long', 'stock', 0], ['long', 'put', -0.08]], tip: 'This literally is insurance — a known premium to cap an unknown loss.', watch: "If the stock doesn't fall, the premium is a pure cost, like insurance you didn't end up needing." },
    { id: 'collar', name: 'Collar', cat: 'hedge', outlook: 'Protect a large gain, cap further upside.', ivEnv: 'either', legs: [['long', 'stock', 0], ['long', 'put', -0.08], ['short', 'call', 0.08]], tip: 'Trading away some upside for downside protection, often for little or no net cost.', watch: "If the stock rallies hard, the short call caps your gain right when you'd want it most." },
    { id: 'long_stock', name: 'Long stock', cat: 'bullish', outlook: 'Shares only — the base for overlays.', ivEnv: 'either', legs: [['long', 'stock', 0]], tip: 'Add a covered call or a put on top to shape the payoff.', watch: 'Full downside to zero with no premium cushion.' },
    { id: 'call_ratio_spread', name: 'Call ratio spread', cat: 'bullish', outlook: 'Bullish to a point, less so beyond it. Undefined risk above.', ivEnv: 'sell', undefinedRisk: true, legs: [['long', 'call', 0.02, 1], ['short', 'call', 0.10, 2]], tip: 'Selling the extra call funds (or overfunds) the long call, but caps out and then reverses on a big rally.', watch: 'Above the short strikes the extra uncovered short call turns losses uncapped — this is not a defined-risk trade.' },
    { id: 'long_call_butterfly', name: 'Long call butterfly', cat: 'neutral', outlook: 'Pinned to a specific price by expiry.', ivEnv: 'sell', legs: [['long', 'call', -0.05, 1], ['short', 'call', 0, 2], ['long', 'call', 0.05, 1]], tip: 'Cheap, defined-risk bet that price sits near the body strike at expiry — small cost, small but sharp max profit.', watch: "Needs price to land close to the center strike; drift either way gives back most of the edge." },
    { id: 'long_put_butterfly', name: 'Long put butterfly', cat: 'neutral', outlook: 'Pinned to a specific price by expiry.', ivEnv: 'sell', legs: [['long', 'put', 0.05, 1], ['short', 'put', 0, 2], ['long', 'put', -0.05, 1]], tip: 'Same trade as a call butterfly, built with puts — defined-risk, cheap, wants a pin at the body strike.', watch: "Needs price to land close to the center strike; drift either way gives back most of the edge." },
  ];
  const INTENTS = [
    { id: 'all', title: 'Everything', f: () => true },
    { id: 'income', title: 'Bring in income', f: s => s.ivEnv === 'sell' },
    { id: 'direction', title: 'Directional bet', f: s => s.ivEnv !== 'sell' && s.cat !== 'hedge' && s.cat !== 'bigmove' },
    { id: 'bigmove', title: 'Big move either way', f: s => s.cat === 'bigmove' },
    { id: 'hedge', title: 'Protect stock I own', f: s => s.cat === 'hedge' },
  ];
  const stratById = id => STRATS.find(s => s.id === id);
  function L(side, type, strike, ratio) { return { side, type, strike, ratio }; }

  // ---------- persistence ----------
  const STORE_KEY = 'spreadstack.trades.v1';
  const LEGACY_KEY = 'spreadstack.v1';
  function mintId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function example() {
    return {
      ticker: 'PANW', spot: '', mult: 100, lo: '', hi: '', iv: 30, dte: 45, ivr: 50, rate: 4, earn: '', acct: '',
      positions: [
        { name: 'Bull call spread', strat: 'bull_call_spread', on: true, contracts: 1, net: 2.6, now: '',
          legs: [L('long', 'call', 350, 1), L('short', 'call', 360, 1)] },
        { name: 'Bear call spread', strat: 'bear_call_spread', on: true, contracts: 1, net: -4.1, now: '',
          legs: [L('short', 'call', 350, 1), L('long', 'call', 360, 1)] },
      ],
    };
  }
  function blankTrade(ticker) {
    return { id: mintId(), createdAt: Date.now(), updatedAt: Date.now(), ticker: ticker || '', spot: '', mult: 100, lo: '', hi: '', iv: 30, dte: 45, ivr: 50, rate: 4, earn: '', acct: '', positions: [] };
  }
  function migrateTrade(t) {
    if (!t.id) t.id = mintId();
    if (!t.createdAt) t.createdAt = Date.now();
    if (!t.updatedAt) t.updatedAt = t.createdAt;
    if (t.iv === undefined) Object.assign(t, { iv: 30, dte: 45, ivr: 50, earn: '', acct: '' });
    if (t.rate === undefined) t.rate = 4;
    (t.positions || []).forEach(p => { if (p.now === undefined) p.now = ''; if (!p.status) p.status = 'idea'; if (!p.events) p.events = []; if (!p.id) p.id = mintId(); if (p.notes === undefined) p.notes = ''; });
    return t;
  }
  function loadStore() {
    try {
      const s = localStorage.getItem(STORE_KEY);
      if (s) {
        const st = JSON.parse(s);
        if (st && Array.isArray(st.trades) && st.trades.length) { st.active = Math.min(st.active || 0, st.trades.length - 1); st.trades.forEach(migrateTrade); return st; }
      }
      const old = localStorage.getItem(LEGACY_KEY);
      if (old) { const t = JSON.parse(old); if (t && t.positions) return { trades: [migrateTrade(t)], active: 0 }; }
    } catch (e) { /* ignore */ }
    return { trades: [migrateTrade(example())], active: 0 };
  }
  function persistStore(store) { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* ignore */ } }

  // ---------- formatting ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
  const fmtUSD = (v) => { const r = Math.round(v); return (r < 0 ? '−' : '') + '$' + Math.abs(r).toLocaleString('en-US'); };
  const fmtPx = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtK = (v) => v.toFixed(0);
  function ticks(lo, hi, n) {
    const span = hi - lo, raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const steps = [1, 2, 2.5, 5, 10]; let step = p;
    for (const s of steps) { if (raw / p <= s) { step = s * p; break; } }
    const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
    return out;
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const EXIT_REASONS = ['Profit target', 'Stop / max loss', '21 DTE rule', 'Expired worthless', 'Assigned / exercised', 'Rolled', 'Thesis changed', 'Other'];
  function daysBetween(a, b) { if (!a || !b) return null; return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }

  // ---------- payoff math shared by the trade builder and the dashboard ----------
  function legPayoff(leg, S) {
    const sign = leg.side === 'long' ? 1 : -1;
    let intrinsic;
    if (leg.type === 'call') intrinsic = Math.max(S - leg.strike, 0);
    else if (leg.type === 'put') intrinsic = Math.max(leg.strike - S, 0);
    else intrinsic = S; // stock
    return sign * (Number(leg.ratio) || 1) * intrinsic;
  }
  function posPayoffFor(p, S, mult) { let v = 0; for (const leg of p.legs) v += legPayoff(leg, S); return (v - (Number(p.net) || 0)) * (Number(p.contracts) || 0) * mult; }
  function posTheoFor(p, c) {
    let delta = 0, gamma = 0, theta = 0; const q = (Number(p.contracts) || 0) * c.mult;
    p.legs.forEach(l => { const sign = l.side === 'long' ? 1 : -1, ratio = Number(l.ratio) || 1; const g = l.type === 'stock' ? { delta: 1, gamma: 0, theta: 0 } : bs(l.type, c.S, Number(l.strike) || 0, c.T, c.iv, c.r); delta += sign * ratio * g.delta * q; gamma += sign * ratio * g.gamma * q; theta += sign * ratio * g.theta * q; });
    return { delta, gamma, theta };
  }
  function posMaxProfitFor(p) {
    const ks = p.legs.filter(l => l.type !== 'stock').map(l => Number(l.strike) || 0).filter(k => k > 0);
    if (!ks.length) return null;
    const lo = Math.min(...ks) * 0.5, hi = Math.max(...ks) * 1.5; let m = -Infinity;
    for (let i = 0; i <= 400; i++) m = Math.max(m, posPayoffFor(p, lo + (hi - lo) * i / 400, 100));
    return m;
  }
  // worst-case loss over a wide strike-anchored range, for one contract — a lower bound
  // (won't reflect a truly unlimited-risk leg, since the scan range is finite)
  function posMaxLossFor(p, mult) {
    const ks = p.legs.filter(l => l.type !== 'stock').map(l => Number(l.strike) || 0).filter(k => k > 0);
    if (!ks.length) return null;
    const lo = Math.min(...ks) * 0.3, hi = Math.max(...ks) * 2;
    let m = Infinity;
    for (let i = 0; i <= 400; i++) m = Math.min(m, posPayoffFor(p, lo + (hi - lo) * i / 400, mult || 100));
    return m;
  }
  // realized P/L in dollars: entry net (debit +) and exit net (debit +, i.e. what you paid to close; credit received is negative)
  function realized(p, mult) { return -((Number(p.net) || 0) + (Number(p.exitNet) || 0)) * (Number(p.contracts) || 0) * (mult || 100); }
  function posLabel(p) {
    return p.legs.map(l => {
      if (l.type === 'stock') return (l.side === 'long' ? '+' : '−') + 'stock';
      return (l.side === 'long' ? '+' : '−') + (Number(l.ratio) !== 1 ? l.ratio + '×' : '') + l.strike + (l.type === 'call' ? 'C' : 'P');
    }).join(' ');
  }
  function allPositions(store) { const out = []; store.trades.forEach(t => t.positions.forEach(p => out.push({ t, p }))); return out; }

  // ---------- book-level payoff engine ----------
  // Finds every zero-crossing of fn between lo and hi via linear interpolation on a fine grid.
  function breakevens(fn, lo, hi) {
    const out = [];
    const n = 2000; const step = (hi - lo) / n;
    let prev = fn(lo);
    for (let i = 1; i <= n; i++) {
      const x = lo + i * step, y = fn(x);
      if ((prev < 0 && y >= 0) || (prev > 0 && y <= 0)) {
        const x0 = x - step;
        const bx = Math.abs(y - prev) < 1e-9 ? x : x0 + (0 - prev) * step / (y - prev);
        if (!out.length || Math.abs(out[out.length - 1] - bx) > step * 2) out.push(bx);
      }
      prev = y;
    }
    return out;
  }
  function slope(fn, x) { return fn(x + 1) - fn(x); }
  // Samples every ON position's payoff (and the combined book) once across [lo, hi], plus the
  // strikes in range, and derives the extrema/unbounded/breakeven facts every view needs —
  // computed once per update() instead of once per view, since they all need the same curve.
  function computeBook(positions, mult, lo, hi) {
    const on = positions.map((p, i) => ({ p, i })).filter(o => o.p.on);
    const strikes = Array.from(new Set(
      on.flatMap(o => o.p.legs.filter(l => l.type !== 'stock').map(l => Number(l.strike) || 0).filter(k => k > 0))
    ));
    const n = 400;
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(lo + (hi - lo) * i / n);
    strikes.forEach(k => { if (k > lo && k < hi) xs.push(k); });
    xs.sort((a, b) => a - b);
    const series = on.map(o => ({ i: o.i, p: o.p, name: o.p.name, ys: xs.map(x => posPayoffFor(o.p, x, mult)) }));
    const tot = xs.map((_, idx) => series.reduce((a, s) => a + s.ys[idx], 0));
    const totalAt = x => on.reduce((a, o) => a + posPayoffFor(o.p, x, mult), 0);
    let maxP = -Infinity, minP = Infinity, maxAt = xs[0] || 0, minAt = xs[0] || 0;
    tot.forEach((y, idx) => { if (y > maxP) { maxP = y; maxAt = xs[idx]; } if (y < minP) { minP = y; minAt = xs[idx]; } });
    const sUp = slope(totalAt, hi + 1000), sDn = slope(totalAt, 0.5);
    const upUnbounded = sUp > 1e-9, upUnboundedLoss = sUp < -1e-9, dnRisk = sDn > 1e-9;
    const bes = breakevens(totalAt, Math.max(0, lo - (hi - lo)), hi + (hi - lo));
    return { on, xs, series, tot, totalAt, maxP, minP, maxAt, minAt, upUnbounded, upUnboundedLoss, dnRisk, bes, strikes };
  }

  // ---------- CSV export (Ledger-compatible columns), real browser download ----------
  function csvText(store) {
    const cols = ['trade_id', 'ticker', 'position_id', 'strategy', 'status', 'opened', 'closed', 'days_held', 'contracts', 'multiplier', 'legs', 'entry_net_per_share', 'exit_net_per_share', 'entry_cost', 'realized_pl', 'exit_reason', 'spot_at_entry', 'iv_at_entry', 'iv_rank_at_entry', 'dte_at_entry', 'notes', 'events'];
    const q = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const lines = [cols.join(',')];
    allPositions(store).forEach(({ t, p }) => {
      const mult = Number(t.mult) || 100; const e = p.entry || {};
      lines.push([t.id, t.ticker, p.id, p.name, p.status, p.openedAt || '', p.closedAt || '', daysBetween(p.openedAt, p.closedAt) ?? '', p.contracts, mult, posLabel(p), p.net, p.status === 'closed' ? p.exitNet : '', (Number(p.net) || 0) * (Number(p.contracts) || 0) * mult, p.status === 'closed' ? realized(p, mult) : '', p.exitReason || '', e.spot || '', e.iv || '', e.ivr || '', e.dte || '', p.notes || '', (p.events || []).map(ev => ev.date + ' ' + ev.text).join(' | ')].map(q).join(','));
    });
    return lines.join('\n');
  }
  function downloadCSV(store) {
    const csv = csvText(store);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'spread-stack-' + today() + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- live price (Alpha Vantage, optional — user supplies their own free key) ----------
  const AV_KEY_STORAGE = 'spreadstack.avkey';
  function getAVKey() { try { return localStorage.getItem(AV_KEY_STORAGE) || ''; } catch (e) { return ''; } }
  function setAVKey(key) { try { if (key) localStorage.setItem(AV_KEY_STORAGE, key); else localStorage.removeItem(AV_KEY_STORAGE); } catch (e) { /* ignore */ } }
  async function fetchAlphaVantageQuote(ticker, key) {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(key)}`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctl.signal });
      if (!res.ok) return { error: `Alpha Vantage returned an error (HTTP ${res.status}).` };
      const data = await res.json();
      if (data['Note']) return { error: 'Rate limited by Alpha Vantage — the free tier allows 25 requests/day. Try again later.' };
      if (data['Information']) return { error: data['Information'] };
      const quote = data['Global Quote'];
      const price = quote && Number(quote['05. price']);
      if (!(price > 0)) return { error: 'No quote returned — check the ticker symbol and API key.' };
      return { price, date: quote['07. latest trading day'], changePct: quote['10. change percent'] };
    } catch (e) {
      return { error: e.name === 'AbortError' ? 'Request to Alpha Vantage timed out.' : 'Network error reaching Alpha Vantage.' };
    } finally { clearTimeout(timer); }
  }

  // ---------- fundamentals (Yahoo Finance, via a small proxy — see yahoo-proxy/README.md) ----------
  // Yahoo has no public API and its fundamentals endpoint can't be called directly from a
  // browser (cookie+crumb auth, no CORS headers), so this goes through a Cloudflare Worker
  // that does that handshake server-to-server. Fill in the Worker's URL once it's deployed.
  const YAHOO_PROXY_URL = 'https://spread-stack-yahoo-proxy.vivekbhandari6104.workers.dev';
  async function fetchFundamentals(ticker) {
    if (!YAHOO_PROXY_URL) return { error: 'Fundamentals proxy not configured yet — see yahoo-proxy/README.md.' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10000);
    try {
      const url = `${YAHOO_PROXY_URL}/quote/${encodeURIComponent(ticker)}?modules=assetProfile,summaryDetail,price`;
      const res = await fetch(url, { signal: ctl.signal });
      const data = await res.json();
      if (!res.ok) return { error: data && data.error ? data.error : `Proxy returned HTTP ${res.status}` };
      return { data };
    } catch (e) {
      return { error: e.name === 'AbortError' ? 'Request to the fundamentals proxy timed out.' : 'Network error reaching the fundamentals proxy.' };
    } finally { clearTimeout(timer); }
  }

  return {
    bs, solveIV, roundStrike, findStrikeByDelta,
    CATS, STRATS, INTENTS, stratById, L,
    STORE_KEY, mintId, blankTrade, example, migrateTrade, loadStore, persistStore,
    esc, fmtUSD, fmtPx, fmtK, ticks, today, EXIT_REASONS, daysBetween,
    legPayoff, posPayoffFor, posTheoFor, posMaxProfitFor, posMaxLossFor, realized, posLabel, allPositions,
    breakevens, slope, computeBook,
    csvText, downloadCSV,
    getAVKey, setAVKey, fetchAlphaVantageQuote,
    fetchFundamentals,
  };
})();
