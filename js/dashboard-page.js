/*
 * OptionsBuddy — Dashboard page.
 * Read-only analytics across every saved trade: realized P/L, win rate,
 * open book Greeks/risk, breakdowns, and a trade journal.
 * Depends on window.SB (js/shared.js).
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { bs, esc, fmtUSD, fmtPx, ticks, daysBetween, posLabel, realized, posPayoffFor, posTheoFor } = SB;

  const store = SB.loadStore();

  $('exportBtn').addEventListener('click', () => SB.downloadCSV(store));

  function renderDashboard() {
    const host = $('dashView');
    const rows = SB.allPositions(store);
    const closed = rows.filter(r => r.p.status === 'closed').map(r => ({ ...r, pl: realized(r.p, Number(r.t.mult) || 100), held: daysBetween(r.p.openedAt, r.p.closedAt) })).sort((a, b) => (a.p.closedAt || '').localeCompare(b.p.closedAt || ''));
    const open = rows.filter(r => r.p.status === 'open');
    if (!rows.length) { host.innerHTML = '<div class="panel"><p class="empty">Nothing to analyse yet. Add a position on the Trade Builder page, mark it opened, and close it when you exit — every closed trade lands here.</p></div>'; return; }
    const wins = closed.filter(r => r.pl > 0), losses = closed.filter(r => r.pl < 0);
    const total = closed.reduce((a, r) => a + r.pl, 0);
    const gross = wins.reduce((a, r) => a + r.pl, 0), grossL = -losses.reduce((a, r) => a + r.pl, 0);
    const avgW = wins.length ? gross / wins.length : 0, avgL = losses.length ? grossL / losses.length : 0;
    const wr = closed.length ? wins.length / closed.length : 0;
    const expectancy = closed.length ? total / closed.length : 0;
    const heldVals = closed.map(r => r.held).filter(h => h !== null);
    const avgHeld = heldVals.length ? heldVals.reduce((a, b) => a + b, 0) / heldVals.length : null;
    const caps = closed.filter(r => Number(r.p.net) < 0 && r.pl > 0).map(r => r.pl / (-Number(r.p.net) * (Number(r.p.contracts) || 0) * (Number(r.t.mult) || 100)));
    const avgCap = caps.length ? caps.reduce((a, b) => a + b, 0) / caps.length * 100 : null;
    let openTheta = 0, openDelta = 0, openGamma = 0, openRisk = 0;
    open.forEach(r => { const c = { S: Number(r.t.spot) || 0, iv: (Number(r.t.iv) || 0) / 100, T: Math.max(Number(r.t.dte) || 0, 0) / 365, r: (Number(r.t.rate) || 4) / 100, mult: Number(r.t.mult) || 100 }; if (c.S > 0) { const g = posTheoFor(r.p, c); openTheta += g.theta; openDelta += g.delta; openGamma += g.gamma; } const ks = r.p.legs.filter(l => l.type !== 'stock').map(l => Number(l.strike) || 0).filter(k => k > 0); if (ks.length) { let m = Infinity; const lo = Math.min(...ks) * 0.5, hi = Math.max(...ks) * 1.5; for (let i = 0; i <= 200; i++) m = Math.min(m, posPayoffFor(r.p, lo + (hi - lo) * i / 200, Number(r.t.mult) || 100)); openRisk += Math.min(0, m); } });

    const tiles = [
      { k: 'Realized P/L', v: fmtUSD(total), s: `${closed.length} closed trade${closed.length === 1 ? '' : 's'}`, cls: total > 0 ? 'pos-v' : total < 0 ? 'neg-v' : '' },
      { k: 'Win rate', v: closed.length ? Math.round(wr * 100) + '%' : '—', s: `${wins.length} W · ${losses.length} L`, cls: '' },
      { k: 'Expectancy', v: closed.length ? fmtUSD(expectancy) : '—', s: 'average P/L per closed trade', cls: expectancy > 0 ? 'pos-v' : expectancy < 0 ? 'neg-v' : '' },
      { k: 'Profit factor', v: grossL > 0 ? (gross / grossL).toFixed(2) : (gross > 0 ? '∞' : '—'), s: `avg win ${fmtUSD(avgW)} · avg loss ${fmtUSD(avgL)}`, cls: '' },
      { k: 'Avg days held', v: avgHeld !== null ? avgHeld.toFixed(0) : '—', s: avgCap !== null ? `credit trades closed at ${avgCap.toFixed(0)}% of max` : 'closed trades', cls: '' },
      { k: 'Open book', v: `${open.length} position${open.length === 1 ? '' : 's'}`, s: `max risk ${fmtUSD(openRisk)} · Θ ${fmtUSD(openTheta)}/day · Δ ${openDelta.toFixed(0)} · Γ ${openGamma.toFixed(2)}`, cls: '' },
    ];
    let cum = 0; const pts = closed.map(r => { cum += r.pl; return { d: r.p.closedAt, v: cum, r }; });
    if (pts.length) pts.unshift({ d: 'start', v: 0, r: null });
    const W = 860, H = 260, m = { t: 16, r: 16, b: 30, l: 64 }; const iw = W - m.l - m.r, ih = H - m.t - m.b;
    let chart = '';
    if (pts.length) {
      const ys = [0, ...pts.map(p => p.v)]; let yMin = Math.min(...ys), yMax = Math.max(...ys); if (yMax - yMin < 1) { yMax += 100; yMin -= 100; } const pad = (yMax - yMin) * 0.1; yMin -= pad; yMax += pad;
      const X = i => m.l + (pts.length === 1 ? iw / 2 : i / (pts.length - 1) * iw), Y = v => m.t + (yMax - v) / (yMax - yMin) * ih;
      const yt = ticks(yMin, yMax, 5);
      yt.forEach(t => { chart += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--hair)"/><text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${fmtUSD(t)}</text>`; });
      chart += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis)" stroke-width="1.5"/>`;
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(i)},${Y(p.v)}`).join(' ');
      chart += `<path d="M${X(0)},${Y(0)} ${pts.map((p, i) => `L${X(i)},${Y(p.v)}`).join(' ')} L${X(pts.length - 1)},${Y(0)} Z" fill="${cum >= 0 ? 'var(--good-fill)' : 'var(--bad-fill)'}"/>`;
      chart += `<path d="${d}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"/>`;
      pts.forEach((p, i) => { if (!p.r) return; chart += `<circle cx="${X(i)}" cy="${Y(p.v)}" r="4" fill="${p.r.pl >= 0 ? 'var(--good)' : 'var(--bad)'}" stroke="var(--surface)" stroke-width="1.5"><title>${p.d} · ${esc(p.r.t.ticker)} ${esc(p.r.p.name)} ${fmtUSD(p.r.pl)} → cumulative ${fmtUSD(p.v)}</title></circle>`; });
      const step = Math.max(1, Math.ceil(pts.length / 8));
      pts.forEach((p, i) => { if (i % step === 0 || i === pts.length - 1) chart += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${p.r ? p.d.slice(5) : ''}</text>`; });
    }
    const group = (key) => { const g = {}; closed.forEach(r => { const k = key(r); (g[k] = g[k] || { n: 0, w: 0, pl: 0 }); g[k].n++; if (r.pl > 0) g[k].w++; g[k].pl += r.pl; }); return Object.entries(g).sort((a, b) => b[1].pl - a[1].pl); };
    const tbl = (title, rowsG) => `<div class="panel"><h3>${title}</h3><div class="tbl-wrap"><table class="tbl mono"><thead><tr><th>${title.split(' ')[1] || ''}</th><th>Trades</th><th>Win rate</th><th>P/L</th><th>Avg</th></tr></thead><tbody>${rowsG.map(([k, g]) => `<tr><td>${esc(k)}</td><td>${g.n}</td><td>${Math.round(g.w / g.n * 100)}%</td><td class="${g.pl > 0 ? 'gain' : g.pl < 0 ? 'loss' : ''}">${fmtUSD(g.pl)}</td><td>${fmtUSD(g.pl / g.n)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No closed trades yet</td></tr>'}</tbody></table></div></div>`;
    const ivrBucket = r => { const v = Number(r.p.entry && r.p.entry.ivr); if (isNaN(v)) return 'unknown'; return v < 25 ? 'IVR 0–25' : v < 50 ? 'IVR 25–50' : v < 75 ? 'IVR 50–75' : 'IVR 75–100'; };
    const journal = [...closed].reverse().slice(0, 25).map(r => `<tr><td>${r.p.closedAt}</td><td>${esc(r.t.ticker)}</td><td>${esc(r.p.name)}</td><td>${esc(posLabel(r.p))}</td><td>${r.p.openedAt} → ${r.p.closedAt}${r.held !== null ? ' (' + r.held + 'd)' : ''}</td><td class="${r.pl > 0 ? 'gain' : r.pl < 0 ? 'loss' : ''}">${fmtUSD(r.pl)}</td><td>${esc(r.p.exitReason || '')}</td><td>${esc(r.p.notes || '')}</td></tr>`).join('');
    const openRows = open.map(r => { const held = daysBetween(r.p.openedAt, SB.today()); return `<tr><td>${esc(r.t.ticker)}</td><td>${esc(r.p.name)}</td><td>${esc(posLabel(r.p))}</td><td>${r.p.openedAt}${held !== null ? ' (' + held + 'd)' : ''}</td><td>${Number(r.p.net) >= 0 ? 'debit' : 'credit'} ${fmtPx(Math.abs(Number(r.p.net)))} × ${r.p.contracts}</td><td>${r.p.entry && r.p.entry.dte ? Math.max(0, Number(r.p.entry.dte) - (held || 0)) + ' DTE' : ''}</td></tr>`; }).join('');
    host.innerHTML = `
      <div class="stats">${tiles.map(c => `<div class="stat"><div class="k">${c.k}</div><div class="v mono ${c.cls}">${c.v}</div><div class="s">${c.s}</div></div>`).join('')}</div>
      <div class="panel"><h3>Cumulative realized P/L</h3><div class="body">${pts.length ? `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative realized P/L by close date">${chart}</svg>` : '<p class="empty">Closes will plot here in order.</p>'}</div></div>
      <div class="dash-row">${tbl('By strategy', group(r => r.p.name))}${tbl('By ticker', group(r => r.t.ticker || 'Untitled'))}${tbl('By IV-rank at entry', group(ivrBucket))}${tbl('By exit reason', group(r => r.p.exitReason || 'unspecified'))}</div>
      <div class="panel"><h3>Open positions</h3><div class="tbl-wrap"><table class="tbl mono"><thead><tr><th>Ticker</th><th>Position</th><th>Legs</th><th>Opened</th><th>Fill</th><th>Time left</th></tr></thead><tbody>${openRows || '<tr><td colspan="6" class="empty">Nothing open</td></tr>'}</tbody></table></div></div>
      <div class="panel"><h3>Journal — last ${Math.min(25, closed.length)} closes</h3><div class="tbl-wrap"><table class="tbl mono"><thead><tr><th>Closed</th><th>Ticker</th><th>Position</th><th>Legs</th><th>Held</th><th>P/L</th><th>Reason</th><th>Note</th></tr></thead><tbody>${journal || '<tr><td colspan="8" class="empty">No closed trades yet</td></tr>'}</tbody></table></div></div>`;
  }

  renderDashboard();

  // ---------- account (Google sign-in, cloud sync via trades-api) ----------
  function renderAuthUI(user) {
    const configured = window.SBAuth && SBAuth.configured();
    $('authSignIn').hidden = !configured || !!user;
    $('authChip').hidden = !configured || !user;
    if (user) $('authEmail').textContent = user.email || '';
  }
  async function syncFromCloud() {
    if (!(window.SBAuth && SBAuth.syncConfigured())) return;
    const r = await SBAuth.fetchCloudTrades();
    if (r.error || !r.data || !Array.isArray(r.data.trades) || !r.data.trades.length) return;
    store.trades = SB.mergeTrades(store.trades, r.data.trades);
    SB.persistStore(store);
    renderDashboard();
  }
  if (window.SBAuth) {
    SBAuth.onChange(user => { renderAuthUI(user); if (user) syncFromCloud(); });
    $('authSignIn').addEventListener('click', () => SBAuth.signInWithGoogle());
    $('authSignOut').addEventListener('click', () => SBAuth.signOut());
  }
})();
