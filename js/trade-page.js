/*
 * OptionsBuddy — Trade Builder page.
 * Depends on window.SB (js/shared.js) for pricing math, strategy data,
 * persistence and formatting. Everything here is specific to composing,
 * pricing and tracking positions on the active trade.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];
  const { bs, solveIV, roundStrike, findStrikeByDelta, CATS, STRATS, INTENTS, stratById, L, esc, fmtUSD, fmtPx, fmtK, ticks, today, EXIT_REASONS, daysBetween, legPayoff, realized, posLabel, posMaxProfitFor } = SB;

  let store = SB.loadStore();
  let state = store.trades[store.active];

  function save() { SB.persistStore(store); }

  function ctx() { return { S: Number(state.spot) || 0, iv: (Number(state.iv) || 0) / 100, T: Math.max(Number(state.dte) || 0, 0) / 365, ivr: Math.max(0, Math.min(100, Number(state.ivr) || 0)), r: (Number(state.rate) || 4) / 100, mult: Number(state.mult) || 100 }; }
  function legGreeks(leg, c) {
    if (leg.type === 'stock') return { price: c.S, delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 };
    return bs(leg.type, c.S, Number(leg.strike) || 0, c.T, c.iv, c.r);
  }
  function posTheo(p, c) {
    let net = 0, delta = 0, gamma = 0, theta = 0, vega = 0;
    const q = (Number(p.contracts) || 0) * c.mult;
    p.legs.forEach(l => {
      const sign = l.side === 'long' ? 1 : -1, ratio = Number(l.ratio) || 1;
      const g = legGreeks(l, c);
      net += sign * ratio * g.price; delta += sign * ratio * g.delta * q; gamma += sign * ratio * g.gamma * q; theta += sign * ratio * g.theta * q; vega += sign * ratio * g.vega * q;
    });
    return { net, delta, gamma, theta, vega };
  }

  function buildPosition(s) {
    const c = ctx();
    const S = c.S > 0 ? c.S : (allStrikes()[0] || 100);
    const legs = s.legs.map(([side, type, pct, ratio]) => L(side, type, type === 'stock' ? 0 : roundStrike(S * (1 + pct), S), ratio || 1));
    const p = { id: SB.mintId(), name: s.name, strat: s.id, status: 'idea', events: [], notes: '', on: true, contracts: 1, net: 0, now: '', legs };
    const est = posTheo(p, Object.assign({}, c, { S }));
    p.net = Math.round(est.net * 100) / 100;
    return p;
  }

  function renderTabs() {
    $('tabs').innerHTML = store.trades.map((t, i) => {
      const open = t.positions.filter(p => p.status === 'open').length, ideas = t.positions.filter(p => p.status === 'idea').length;
      return `<button type="button" class="tab${i === store.active ? ' active' : ''}" data-i="${i}">${esc(t.ticker || 'Untitled')}<span class="n">${open ? open + ' open' : ''}${open && ideas ? ' · ' : ''}${ideas ? ideas + ' idea' + (ideas > 1 ? 's' : '') : ''}${!open && !ideas ? (t.positions.length ? 'closed' : 'empty') : ''}</span></button>`;
    }).join('');
    $('tabs').querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTrade(Number(b.dataset.i))));
    $('delTrade').disabled = store.trades.length <= 1;
  }
  function loadHeader() {
    $('ticker').value = state.ticker; $('spot').value = state.spot; $('mult').value = state.mult;
    $('rangeLo').value = state.lo; $('rangeHi').value = state.hi;
    $('iv').value = state.iv; $('dte').value = state.dte; $('ivr').value = state.ivr; $('rate').value = state.rate === undefined ? 4 : state.rate; $('earn').value = state.earn || ''; $('acct').value = state.acct || '';
    $('libPanel').open = !state.positions.length;
  }
  function switchTrade(i) { store.active = i; state = store.trades[i]; loadHeader(); update(); }

  // ---------- math ----------
  function posPayoff(p, S) { return SB.posPayoffFor(p, S, Number(state.mult) || 100); }
  function totalPayoff(S) { let t = 0; for (const p of state.positions) if (p.on) t += posPayoff(p, S); return t; }
  function allStrikes() {
    const ks = [];
    for (const p of state.positions) for (const l of p.legs) if (l.type !== 'stock') ks.push(Number(l.strike) || 0);
    return ks.filter(k => k > 0);
  }
  function autoRange() {
    const ks = allStrikes();
    const spot = Number(state.spot);
    if (spot > 0) ks.push(spot);
    if (!ks.length) return [0, 100];
    const lo = Math.min(...ks), hi = Math.max(...ks);
    const span = Math.max(hi - lo, hi * 0.08, 5);
    return [Math.max(0, Math.floor(lo - span * 1.2)), Math.ceil(hi + span * 1.2)];
  }
  function range() {
    const lo = Number(state.lo), hi = Number(state.hi);
    if (state.lo !== '' && state.hi !== '' && hi > lo) return [lo, hi];
    return autoRange();
  }
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
  function slope(fn, x) { return (fn(x + 1) - fn(x)); }

  // ---------- render: positions ----------
  function renderPositions() {
    const host = $('positions');
    host.innerHTML = state.positions.length ? '' : '<p class="note" style="padding:14px">No positions yet — pick a strategy above and press Add.</p>';
    state.positions.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'pos' + (p.on ? '' : ' off') + (p.status === 'closed' ? ' closed' : '');
      const net = Number(p.net) || 0;
      const total = net * (Number(p.contracts) || 0) * (Number(state.mult) || 100);
      div.innerHTML = `
        <div class="pos-top">
          <span class="swatch" style="background:${SERIES[i % SERIES.length]}"></span>
          <input class="pos-title" id="pname-${i}" value="${esc(p.name)}" aria-label="Position name" style="border:0;background:transparent;padding:0;font-weight:600;">
          <span class="pill ${p.status}">${p.status}</span>
          <label class="toggle"><input type="checkbox" id="pon-${i}" ${p.on ? 'checked' : ''}> On</label>
          <button class="btn icon ghost" id="pdel-${i}" type="button" aria-label="Remove position" title="Remove">✕</button>
        </div>
        <div class="pos-row">
          <div class="field"><label for="pnet-${i}">Net price /sh</label><input id="pnet-${i}" class="mono" type="number" step="0.01" value="${Math.abs(net)}"></div>
          <div class="field"><label for="pside-${i}">Debit / credit</label>
            <select id="pside-${i}"><option value="debit" ${net >= 0 ? 'selected' : ''}>Debit (paid)</option><option value="credit" ${net < 0 ? 'selected' : ''}>Credit (received)</option></select></div>
          <div class="field"><label for="pqty-${i}">Contracts</label><input id="pqty-${i}" class="mono" type="number" step="1" min="0" value="${p.contracts}"></div>
          <div class="field"><label for="pnow-${i}">Value now $</label><input id="pnow-${i}" class="mono" type="number" step="1" value="${p.now === undefined ? '' : p.now}" placeholder="to close"></div>
        </div>
        <table class="legs">
          <thead><tr><th>Side</th><th>Type</th><th>Strike</th><th>Ratio</th><th></th></tr></thead>
          <tbody>
            ${p.legs.map((l, j) => `
              <tr>
                <td><select id="ls-${i}-${j}"><option value="long" ${l.side === 'long' ? 'selected' : ''}>Long</option><option value="short" ${l.side === 'short' ? 'selected' : ''}>Short</option></select></td>
                <td><select id="lt-${i}-${j}"><option value="call" ${l.type === 'call' ? 'selected' : ''}>Call</option><option value="put" ${l.type === 'put' ? 'selected' : ''}>Put</option><option value="stock" ${l.type === 'stock' ? 'selected' : ''}>Stock</option></select></td>
                <td><input id="lk-${i}-${j}" class="mono" type="number" step="0.5" value="${l.strike}" ${l.type === 'stock' ? 'disabled' : ''}></td>
                <td><input id="lr-${i}-${j}" class="mono" type="number" step="1" min="1" value="${l.ratio}"><span class="dl mono" id="ld-${i}-${j}"></span></td>
                <td class="act"><button class="btn icon ghost" id="ldel-${i}-${j}" type="button" aria-label="Remove leg" title="Remove leg">−</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
        <div class="pos-net">
          <span><button class="btn small ghost" id="ladd-${i}" type="button">+ Leg</button> <button class="btn small ghost" id="pest-${i}" type="button" title="Set net price to the Black-Scholes estimate at this trade's IV and days">Est. price</button></span>
          <span class="mono">${posLabel(p)} · <b>${net >= 0 ? 'Debit' : 'Credit'} ${fmtUSD(Math.abs(total))}</b></span>
        </div>
        <div class="pos-greeks" id="pg-${i}"></div>
        <div class="life" id="pl-${i}"></div>`;
      host.appendChild(div);
      renderLife(i);

      $(`pname-${i}`).addEventListener('input', e => { p.name = e.target.value; update(false); });
      $(`pon-${i}`).addEventListener('change', e => { p.on = e.target.checked; update(); });
      $(`pdel-${i}`).addEventListener('click', () => { state.positions.splice(i, 1); update(); });
      const setNet = () => {
        const v = Math.abs(Number($(`pnet-${i}`).value) || 0);
        p.net = $(`pside-${i}`).value === 'credit' ? -v : v; update(false); refreshNetLine(i);
      };
      $(`pnet-${i}`).addEventListener('input', setNet);
      $(`pside-${i}`).addEventListener('change', setNet);
      $(`pqty-${i}`).addEventListener('input', e => { p.contracts = Number(e.target.value) || 0; update(false); refreshNetLine(i); });
      $(`pnow-${i}`).addEventListener('input', e => { p.now = e.target.value; update(false); });
      $(`pest-${i}`).addEventListener('click', () => { const c = ctx(); if (!(c.S > 0)) { $('spot').focus(); return; } const est = posTheo(p, c); p.net = Math.round(est.net * 100) / 100; update(); });
      $(`ladd-${i}`).addEventListener('click', () => { const last = p.legs[p.legs.length - 1]; p.legs.push(L('short', last ? last.type : 'call', (Number(last && last.strike) || 100) + 10, 1)); update(); });
      p.legs.forEach((l, j) => {
        $(`ls-${i}-${j}`).addEventListener('change', e => { l.side = e.target.value; update(false); refreshNetLine(i); });
        $(`lt-${i}-${j}`).addEventListener('change', e => { l.type = e.target.value; update(); });
        $(`lk-${i}-${j}`).addEventListener('input', e => { l.strike = Number(e.target.value) || 0; update(false); refreshNetLine(i); });
        $(`lr-${i}-${j}`).addEventListener('input', e => { l.ratio = Math.max(1, Number(e.target.value) || 1); update(false); refreshNetLine(i); });
        $(`ldel-${i}-${j}`).addEventListener('click', () => { p.legs.splice(j, 1); update(); });
      });
      refreshGreeks(i);
    });
  }
  function refreshNetLine(i) {
    const p = state.positions[i];
    const net = Number(p.net) || 0;
    const total = net * (Number(p.contracts) || 0) * (Number(state.mult) || 100);
    const el = $('positions').children[i].querySelector('.pos-net span.mono');
    if (el) el.innerHTML = `${posLabel(p)} · <b>${net >= 0 ? 'Debit' : 'Credit'} ${fmtUSD(Math.abs(total))}</b>`;
    refreshGreeks(i);
  }
  function refreshGreeks(i) {
    const p = state.positions[i]; const c = ctx(); const el = $(`pg-${i}`); if (!el) return;
    if (!(c.S > 0)) { el.innerHTML = '<span>Enter a spot price for theoretical value and Greeks.</span>'; p.legs.forEach((l, j) => { const d = $(`ld-${i}-${j}`); if (d) d.textContent = ''; }); return; }
    const t = posTheo(p, c);
    const mult = c.mult, q = (Number(p.contracts) || 0) * mult;
    const theoTotal = t.net * q, fill = (Number(p.net) || 0) * q;
    el.innerHTML = `<span>Theo <b>${t.net >= 0 ? 'debit' : 'credit'} ${fmtPx(Math.abs(t.net))}</b>${p.legs.some(l => l.type === 'stock') ? '' : ` · theo P/L vs fill <b class="${theoTotal - fill > 0 ? 'gain' : theoTotal - fill < 0 ? 'loss' : ''}">${fmtUSD(theoTotal - fill)}</b>`}</span>
      <span>Δ <b>${t.delta.toFixed(0)}</b></span><span>Γ <b>${t.gamma.toFixed(2)}</b></span><span>Θ <b>${fmtUSD(t.theta)}/day</b></span><span>Vega <b>${fmtUSD(t.vega)}</b></span>`;
    p.legs.forEach((l, j) => { const d = $(`ld-${i}-${j}`); if (!d) return; if (l.type === 'stock') { d.textContent = ''; return; } const g = legGreeks(l, c); const dd = (l.side === 'long' ? 1 : -1) * g.delta; d.textContent = 'Δ' + (dd >= 0 ? '+' : '') + dd.toFixed(2); });
  }
  function refreshAllGreeks() { state.positions.forEach((_, i) => refreshGreeks(i)); }

  // ---------- lifecycle: idea -> open -> closed ----------
  function renderLife(i) {
    const p = state.positions[i]; const el = $(`pl-${i}`); if (!el) return;
    const mult = Number(state.mult) || 100;
    const evs = (p.events || []).map(e => `<div class="ev"><span class="d mono">${e.date}</span><span>${esc(e.text)}</span></div>`).join('');
    if (p.status === 'idea') {
      el.innerHTML = `<span>Idea — not yet traded.</span> <button class="btn small primary" id="lopen-${i}" type="button">Mark opened</button>
        <div class="lform" id="lf-${i}" hidden>
          <div class="field"><label>Opened on</label><input type="date" id="lod-${i}" value="${today()}"></div>
          <div class="field"><label>Fill (net /sh)</label><input class="mono" type="number" step="0.01" id="lof-${i}" value="${Math.abs(Number(p.net) || 0)}"></div>
          <div class="field"><label>&nbsp;</label><select id="los-${i}"><option value="debit" ${Number(p.net) >= 0 ? 'selected' : ''}>Debit</option><option value="credit" ${Number(p.net) < 0 ? 'selected' : ''}>Credit</option></select></div>
          <button class="btn small primary" id="lok-${i}" type="button">Confirm open</button></div>`;
      $(`lopen-${i}`).addEventListener('click', () => { $(`lf-${i}`).hidden = !$(`lf-${i}`).hidden; });
      $(`lok-${i}`).addEventListener('click', () => {
        const v = Math.abs(Number($(`lof-${i}`).value) || 0); p.net = $(`los-${i}`).value === 'credit' ? -v : v;
        p.status = 'open'; p.openedAt = $(`lod-${i}`).value || today();
        p.entry = { spot: state.spot, iv: state.iv, dte: state.dte, ivr: state.ivr, strat: p.strat, legs: JSON.parse(JSON.stringify(p.legs)) };
        p.events.push({ date: p.openedAt, text: `Opened ${p.contracts}× for ${Number(p.net) >= 0 ? 'debit' : 'credit'} ${fmtPx(Math.abs(p.net))}` });
        update();
      });
    } else if (p.status === 'open') {
      const held = daysBetween(p.openedAt, today());
      el.innerHTML = `<span>Open since <b class="mono">${p.openedAt}</b>${held !== null ? ` · ${held} day${held === 1 ? '' : 's'} held` : ''}${p.entry && p.entry.dte ? ` · ~${Math.max(0, Number(p.entry.dte) - (held || 0))} DTE left` : ''}</span>
        <button class="btn small ghost" id="ladj-${i}" type="button">Log adjustment</button> <button class="btn small primary" id="lclose-${i}" type="button">Close</button>
        <div class="lform" id="laf-${i}" hidden>
          <div class="field"><label>Date</label><input type="date" id="lad-${i}" value="${today()}"></div>
          <div class="field"><label>What changed</label><input class="long" id="lat-${i}" placeholder="rolled short call to 370, +0.40 credit"></div>
          <button class="btn small primary" id="laok-${i}" type="button">Add</button></div>
        <div class="lform" id="lcf-${i}" hidden>
          <div class="field"><label>Closed on</label><input type="date" id="lcd-${i}" value="${today()}"></div>
          <div class="field"><label>Close price (net /sh)</label><input class="mono" type="number" step="0.01" id="lcf-${i}-v" placeholder="0 if expired"></div>
          <div class="field"><label>&nbsp;</label><select id="lcs-${i}"><option value="credit" ${Number(p.net) >= 0 ? 'selected' : ''}>Credit received</option><option value="debit" ${Number(p.net) < 0 ? 'selected' : ''}>Debit paid</option></select></div>
          <div class="field"><label>Reason</label><select id="lcr-${i}">${EXIT_REASONS.map(r => `<option>${r}</option>`).join('')}</select></div>
          <div class="field"><label>Note</label><input class="long" id="lcn-${i}" placeholder="what you learned"></div>
          <button class="btn small primary" id="lcok-${i}" type="button">Confirm close</button></div>
        <div class="events" style="flex-basis:100%">${evs}</div>`;
      $(`ladj-${i}`).addEventListener('click', () => { $(`laf-${i}`).hidden = !$(`laf-${i}`).hidden; $(`lcf-${i}`).hidden = true; });
      $(`lclose-${i}`).addEventListener('click', () => { $(`lcf-${i}`).hidden = !$(`lcf-${i}`).hidden; $(`laf-${i}`).hidden = true; });
      $(`laok-${i}`).addEventListener('click', () => { const t = $(`lat-${i}`).value.trim(); if (!t) return; p.events.push({ date: $(`lad-${i}`).value || today(), text: t }); update(); });
      $(`lcok-${i}`).addEventListener('click', () => {
        const v = Math.abs(Number($(`lcf-${i}-v`).value) || 0); p.exitNet = $(`lcs-${i}`).value === 'credit' ? -v : v;
        p.status = 'closed'; p.closedAt = $(`lcd-${i}`).value || today(); p.exitReason = $(`lcr-${i}`).value; p.notes = $(`lcn-${i}`).value.trim(); p.on = false;
        p.events.push({ date: p.closedAt, text: `Closed for ${v === 0 ? 'zero' : (p.exitNet < 0 ? 'credit ' : 'debit ') + fmtPx(v)} — ${p.exitReason}${p.notes ? ': ' + p.notes : ''}` });
        update();
      });
    } else {
      const pl = realized(p, mult); const held = daysBetween(p.openedAt, p.closedAt);
      const mp = Number(p.net) < 0 ? -Number(p.net) * (Number(p.contracts) || 0) * mult : posMaxProfitFor(p);
      const cap = mp && mp > 0 && pl > 0 ? Math.round(pl / mp * 100) : null;
      el.innerHTML = `<span class="pill ${pl >= 0 ? 'win' : 'lose'}">${pl >= 0 ? 'Win' : 'Loss'}</span><span class="mono">Realized <b class="${pl > 0 ? 'gain' : pl < 0 ? 'loss' : ''}">${fmtUSD(pl)}</b></span>
        <span>${p.openedAt} → ${p.closedAt}${held !== null ? ` · ${held}d` : ''}${cap !== null ? ` · ${cap}% of max profit` : ''} · ${esc(p.exitReason || '')}</span>
        <button class="btn small ghost" id="lreopen-${i}" type="button">Reopen</button>
        <div class="events" style="flex-basis:100%">${evs}</div>`;
      $(`lreopen-${i}`).addEventListener('click', () => { p.status = 'open'; p.on = true; delete p.closedAt; delete p.exitNet; p.events.push({ date: today(), text: 'Reopened (close undone)' }); update(); });
    }
  }

  // ---------- live price (Alpha Vantage) ----------
  $('avKey').value = SB.getAVKey();
  $('avKey').addEventListener('input', e => SB.setAVKey(e.target.value.trim()));
  $('avGo').addEventListener('click', async () => {
    const key = $('avKey').value.trim();
    const tk = (state.ticker || '').trim();
    if (!key) { $('avOut').textContent = 'Enter an Alpha Vantage API key first — get a free one at alphavantage.co/support/#api-key.'; return; }
    if (!tk) { $('avOut').textContent = 'Enter a ticker first.'; return; }
    $('avGo').disabled = true; $('avOut').textContent = 'Fetching…';
    const q = await SB.fetchAlphaVantageQuote(tk, key);
    $('avGo').disabled = false;
    if (q.error) { $('avOut').textContent = q.error; return; }
    state.spot = q.price; $('spot').value = q.price;
    $('avOut').textContent = `${tk} last close ${fmtPx(q.price)}${q.date ? ' on ' + q.date : ''}${q.changePct ? ' (' + q.changePct + ')' : ''}.`;
    if (!$('svK').value) $('svK').value = roundStrike(q.price, q.price);
    update(false); refreshAllGreeks();
  });

  // ---------- IV solver ----------
  $('svGo').addEventListener('click', () => {
    const c = ctx(); const K = Number($('svK').value), P = Number($('svP').value), type = $('svT').value;
    if (!(c.S > 0)) { $('svOut').textContent = 'Enter the spot price first.'; return; }
    if (!(c.T > 0)) { $('svOut').textContent = 'Days to expiry must be above zero.'; return; }
    const iv = solveIV(type, c.S, K, c.T, P);
    if (iv === null) { $('svOut').textContent = 'No volatility reproduces that price — check strike, type and that the price is above intrinsic value.'; return; }
    state.iv = Math.round(iv * 1000) / 10; $('iv').value = state.iv;
    $('svOut').textContent = `Implied vol ${state.iv}% from the ${K} ${type} at ${fmtPx(P)} — applied to every leg.`;
    update(false); refreshAllGreeks();
  });

  // ---------- export ----------
  $('exportBtn').addEventListener('click', () => SB.downloadCSV(store));

  // ---------- render: stats ----------
  function renderStats() {
    const [lo, hi] = range();
    const on = state.positions.filter(p => p.on);
    const mult = Number(state.mult) || 100;
    const netTotal = on.reduce((a, p) => a + (Number(p.net) || 0) * (Number(p.contracts) || 0) * mult, 0);
    const xs = [];
    const n = 400;
    for (let i = 0; i <= n; i++) xs.push(lo + (hi - lo) * i / n);
    allStrikes().forEach(k => { if (k >= lo && k <= hi) xs.push(k); });
    const ys = xs.map(totalPayoff);
    let maxP = -Infinity, minP = Infinity, maxAt = 0, minAt = 0;
    ys.forEach((y, i) => { if (y > maxP) { maxP = y; maxAt = xs[i]; } if (y < minP) { minP = y; minAt = xs[i]; } });
    const sUp = slope(totalPayoff, hi + 1000), sDn = slope(totalPayoff, 0.5);
    const upUnbounded = sUp > 1e-9, downUnbounded = sUp < -1e-9;
    const bes = breakevens(totalPayoff, Math.max(0, lo - (hi - lo)), hi + (hi - lo));
    const maxProfit = upUnbounded ? 'Unlimited' : (maxP <= 0 ? 'None' : fmtUSD(maxP));
    const maxLoss = downUnbounded ? 'Unlimited' : (minP >= 0 ? 'None' : fmtUSD(minP));
    const flat = Math.abs(maxP - minP) < 1e-6;
    const rr = (!upUnbounded && !downUnbounded && minP < 0) ? (maxP / -minP) : null;
    const spot = Number(state.spot);
    const cards = [
      { k: 'Net ' + (netTotal >= 0 ? 'debit' : 'credit'), v: fmtUSD(Math.abs(netTotal)), s: on.length + ' position' + (on.length === 1 ? '' : 's') + ' on', cls: '' },
      { k: 'Max profit', v: maxProfit, s: upUnbounded ? 'grows above ' + fmtK(hi) : flat ? 'locked in at every price' : maxP <= 0 ? 'best case ' + fmtUSD(maxP) : 'at ' + fmtK(maxAt), cls: maxP > 0 ? 'pos-v' : '' },
      { k: 'Max loss', v: maxLoss, s: downUnbounded ? 'grows above ' + fmtK(hi) : flat ? 'locked in at every price' : minP >= 0 ? 'worst case ' + fmtUSD(minP) : 'at ' + fmtK(minAt), cls: minP < 0 ? 'neg-v' : '' },
      { k: 'Breakeven' + (bes.length === 1 ? '' : 's'), v: bes.length ? bes.map(fmtPx).join(' · ') : 'None', s: bes.length ? 'underlying at expiry' : (minP >= 0 ? 'never below zero' : 'never above zero'), cls: '' },
    ];
    if (rr !== null) cards.push({ k: 'Reward : risk', v: rr.toFixed(2) + ' : 1', s: 'max profit ÷ max loss', cls: '' });
    const c = ctx();
    if (c.S > 0 && on.length) {
      const g = on.reduce((a, p) => { const t = posTheo(p, c); a.d += t.delta; a.g += t.gamma; a.t += t.theta; a.v += t.vega; return a; }, { d: 0, g: 0, t: 0, v: 0 });
      cards.push({ k: 'Book Greeks', v: `Δ ${g.d.toFixed(0)} · Θ ${fmtUSD(g.t)}`, s: `Γ ${g.g.toFixed(2)} · vega ${fmtUSD(g.v)} · like ${g.d >= 0 ? 'long' : 'short'} ~${Math.abs(g.d).toFixed(0)} shares`, cls: '' });
    }
    if (spot > 0) { const v = totalPayoff(spot); cards.push({ k: 'P/L if held at spot', v: fmtUSD(v), s: 'expiry at ' + fmtPx(spot), cls: v > 0 ? 'pos-v' : v < 0 ? 'neg-v' : '' }); }
    $('stats').innerHTML = cards.map(c => `<div class="stat"><div class="k">${c.k}</div><div class="v mono ${c.cls}">${c.v}</div><div class="s">${c.s}</div></div>`).join('');
    return { lo, hi, bes };
  }

  // ---------- render: chart ----------
  let chartModel = null;
  function renderChart(lo, hi, bes) {
    const W = 860, H = 420, m = { t: 18, r: 20, b: 40, l: 66 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const on = state.positions.map((p, i) => ({ p, i })).filter(o => o.p.on);
    const n = 300;
    const xs = [];
    for (let i = 0; i <= n; i++) xs.push(lo + (hi - lo) * i / n);
    allStrikes().forEach(k => { if (k > lo && k < hi) xs.push(k); });
    xs.sort((a, b) => a - b);
    const series = on.map(o => ({ i: o.i, name: o.p.name, ys: xs.map(x => posPayoff(o.p, x)) }));
    const tot = xs.map(totalPayoff);
    const showTotal = $('showTotal').checked;
    let yMin = 0, yMax = 0;
    if (showTotal) { yMin = Math.min(0, ...tot); yMax = Math.max(0, ...tot); }
    if ($('showLegs').checked || !showTotal) series.forEach(s => { yMin = Math.min(yMin, ...s.ys); yMax = Math.max(yMax, ...s.ys); });
    if (yMax - yMin < 1e-9) { yMax += 100; yMin -= 100; }
    const pad = (yMax - yMin) * 0.08; yMin -= pad; yMax += pad;
    const X = x => m.l + (x - lo) / (hi - lo) * iw;
    const Y = y => m.t + (yMax - y) / (yMax - yMin) * ih;
    chartModel = { X, Y, lo, hi, m, iw, ih, xs, tot, series };

    const yt = ticks(yMin, yMax, 6), xt = ticks(lo, hi, 8);
    let g = '';
    yt.forEach(t => { g += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="var(--hair)" stroke-width="1"/>`; g += `<text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${fmtUSD(t)}</text>`; });
    xt.forEach(t => { g += `<line y1="${m.t}" y2="${H - m.b}" x1="${X(t)}" x2="${X(t)}" stroke="var(--hair)" stroke-width="1"/>`; g += `<text x="${X(t)}" y="${H - m.b + 18}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${fmtK(t)}</text>`; });
    g += `<text x="${W - m.r}" y="${H - 6}" text-anchor="end" font-size="11" fill="var(--muted)">${esc(state.ticker || 'Underlying')} price at expiry</text>`;
    const y0 = Y(0);
    g += `<line x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}" stroke="var(--axis)" stroke-width="1.5"/>`;
    if (showTotal) {
      const above = [], below = [];
      xs.forEach((x, i) => { const yv = tot[i]; above.push(`${X(x)},${Y(Math.max(yv, 0))}`); below.push(`${X(x)},${Y(Math.min(yv, 0))}`); });
      g += `<polygon points="${X(xs[0])},${y0} ${above.join(' ')} ${X(xs[xs.length - 1])},${y0}" fill="var(--good-fill)"/>`;
      g += `<polygon points="${X(xs[0])},${y0} ${below.join(' ')} ${X(xs[xs.length - 1])},${y0}" fill="var(--bad-fill)"/>`;
    }
    const ks = Array.from(new Set(allStrikes())).filter(k => k > lo && k < hi);
    ks.forEach(k => { g += `<line x1="${X(k)}" x2="${X(k)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--axis)" stroke-width="1" stroke-dasharray="2 4"/>`; g += `<text x="${X(k)}" y="${m.t + 10}" text-anchor="middle" font-size="10" fill="var(--ink-2)" font-family="IBM Plex Mono, monospace">${k}</text>`; });
    const spot = Number(state.spot);
    if (spot > lo && spot < hi) { g += `<line x1="${X(spot)}" x2="${X(spot)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--ink-2)" stroke-width="1.5"/>`; g += `<text x="${X(spot) + 4}" y="${H - m.b - 6}" font-size="10" fill="var(--ink-2)">spot ${fmtPx(spot)}</text>`; }
    const legsOnly = !showTotal;
    if ($('showLegs').checked || legsOnly) series.forEach(s => {
      const d = xs.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(s.ys[i])}`).join(' ');
      g += `<path d="${d}" fill="none" stroke="${SERIES[s.i % SERIES.length]}" stroke-width="${legsOnly ? 2.5 : 2}" ${legsOnly ? '' : 'stroke-dasharray="6 4"'} stroke-linejoin="round"/>`;
    });
    const dT = xs.map((x, i) => `${i ? 'L' : 'M'}${X(x)},${Y(tot[i])}`).join(' ');
    if (showTotal) {
      g += `<path d="${dT}" fill="none" stroke="var(--surface)" stroke-width="5" stroke-linejoin="round"/>`;
      g += `<path d="${dT}" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>`;
    }
    if (showTotal) bes.forEach(b => { if (b > lo && b < hi) { g += `<circle cx="${X(b)}" cy="${y0}" r="5" fill="var(--surface)" stroke="var(--ink)" stroke-width="2"/>`; g += `<text x="${X(b)}" y="${y0 - 10}" text-anchor="middle" font-size="11" fill="var(--ink)" font-family="IBM Plex Mono, monospace">BE ${fmtPx(b)}</text>`; } });
    g += `<g id="xh" style="display:none"><line id="xhL" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-width="1"/><circle id="xhC" r="5" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/></g>`;
    g += `<rect id="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>`;
    $('chart').innerHTML = g;

    const lg = showTotal ? [`<span class="li"><span class="sw" style="border-color:var(--ink)"></span>Combined</span>`] : [];
    if ($('showLegs').checked || legsOnly) series.forEach(s => lg.push(`<span class="li"><span class="sw${legsOnly ? '' : ' dash'}" style="border-color:${SERIES[s.i % SERIES.length]}"></span>${esc(s.name)}</span>`));
    if (showTotal) lg.push(`<span class="li"><span class="sw" style="border-color:var(--good);background:var(--good-fill);height:10px;border-width:1px"></span>Profit zone</span><span class="li"><span class="sw" style="border-color:var(--bad);background:var(--bad-fill);height:10px;border-width:1px"></span>Loss zone</span>`);
    $('legend').innerHTML = lg.join('');
  }

  // hover
  const svg = $('chart'), tip = $('tip');
  function onMove(ev) {
    if (!chartModel) return;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const loc = pt.matrixTransform(svg.getScreenCTM().inverse());
    const { X, Y, lo, hi, m, iw } = chartModel;
    const px = (loc.x - m.l) / iw; if (px < 0 || px > 1) return hide();
    const S = lo + px * (hi - lo);
    const t = totalPayoff(S);
    const xh = $('xh'); xh.style.display = '';
    $('xhL').setAttribute('x1', X(S)); $('xhL').setAttribute('x2', X(S));
    const showTotal = $('showTotal').checked;
    $('xhC').setAttribute('cx', X(S)); $('xhC').setAttribute('cy', Y(t)); $('xhC').style.display = showTotal ? '' : 'none';
    let rows = `<div class="row"><span>${esc(state.ticker)} @</span><b>${fmtPx(S)}</b></div>`;
    if ($('showLegs').checked || !showTotal) state.positions.forEach((p, i) => { if (!p.on) return; const v = posPayoff(p, S); rows += `<div class="row"><span style="color:${SERIES[i % SERIES.length]}">${esc(p.name)}</span><span class="${v > 0 ? 'gain' : v < 0 ? 'loss' : ''}">${fmtUSD(v)}</span></div>`; });
    if (showTotal) rows += `<div class="row total"><span>Combined</span><span class="${t > 0 ? 'gain' : t < 0 ? 'loss' : ''}">${fmtUSD(t)}</span></div>`;
    tip.innerHTML = rows; tip.style.display = 'block';
    const body = $('chartBody').getBoundingClientRect();
    let left = ev.clientX - body.left + 14, top = ev.clientY - body.top - 10;
    if (left + tip.offsetWidth > body.width - 8) left = ev.clientX - body.left - tip.offsetWidth - 14;
    tip.style.left = left + 'px'; tip.style.top = Math.max(0, top) + 'px';
  }
  function hide() { tip.style.display = 'none'; const xh = $('xh'); if (xh) xh.style.display = 'none'; }
  svg.addEventListener('mousemove', onMove); svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchmove', e => { onMove(e.touches[0]); }, { passive: true });

  // ---------- render: table ----------
  function renderTable(lo, hi, bes) {
    const on = state.positions.filter(p => p.on);
    const pts = Array.from(new Set([lo, ...allStrikes(), ...bes.map(b => Math.round(b * 100) / 100), hi].filter(x => x >= lo && x <= hi))).sort((a, b) => a - b);
    const spot = Number(state.spot); if (spot >= lo && spot <= hi && !pts.includes(spot)) { pts.push(spot); pts.sort((a, b) => a - b); }
    let h = `<thead><tr><th>Price at expiry</th>${on.map(p => `<th>${esc(p.name)}</th>`).join('')}<th>Combined</th></tr></thead><tbody>`;
    pts.forEach(x => {
      const t = totalPayoff(x);
      const tag = bes.some(b => Math.abs(b - x) < 0.006) ? ' <span style="color:var(--muted);font-size:11px">BE</span>' : (x === spot ? ' <span style="color:var(--muted);font-size:11px">spot</span>' : '');
      h += `<tr><td>${fmtPx(x)}${tag}</td>${on.map(p => { const v = posPayoff(p, x); return `<td class="${v > 0 ? 'gain' : v < 0 ? 'loss' : ''}">${fmtUSD(v)}</td>`; }).join('')}<td class="${t > 0 ? 'gain' : t < 0 ? 'loss' : ''}"><b>${fmtUSD(t)}</b></td></tr>`;
    });
    $('tbl').innerHTML = h + '</tbody>';
  }

  // ---------- render: scenario (%-move) table ----------
  const SCENARIO_MOVES = [-20, -10, -5, 0, 5, 10, 20];
  function renderScenario() {
    const spot = Number(state.spot);
    const el = $('scenario');
    if (!(spot > 0)) { el.innerHTML = '<tbody><tr><td class="empty">Enter a spot price to see P/L at different % moves.</td></tr></tbody>'; return; }
    const on = state.positions.filter(p => p.on);
    let h = `<thead><tr><th>Move</th><th>Price at expiry</th>${on.map(p => `<th>${esc(p.name)}</th>`).join('')}<th>Combined</th></tr></thead><tbody>`;
    SCENARIO_MOVES.forEach(pct => {
      const x = spot * (1 + pct / 100);
      const t = totalPayoff(x);
      h += `<tr><td>${pct > 0 ? '+' : ''}${pct}%</td><td>${fmtPx(x)}</td>${on.map(p => { const v = posPayoff(p, x); return `<td class="${v > 0 ? 'gain' : v < 0 ? 'loss' : ''}">${fmtUSD(v)}</td>`; }).join('')}<td class="${t > 0 ? 'gain' : t < 0 ? 'loss' : ''}"><b>${fmtUSD(t)}</b></td></tr>`;
    });
    el.innerHTML = h + '</tbody>';
  }

  // ---------- commentary ----------
  function analyze(lo, hi, bes) {
    const on = state.positions.filter(p => p.on);
    const mult = Number(state.mult) || 100;
    const spot = Number(state.spot);
    const tk = state.ticker || 'the underlying';
    if (!on.length) return { facts: null, paras: ['Add a position to get a read on the trade.'] };
    const net = on.reduce((a, p) => a + (Number(p.net) || 0) * (Number(p.contracts) || 0) * mult, 0);
    const xs = []; for (let i = 0; i <= 400; i++) xs.push(lo + (hi - lo) * i / 400);
    allStrikes().forEach(k => { if (k >= lo && k <= hi) xs.push(k); });
    xs.sort((a, b) => a - b);
    const ys = xs.map(totalPayoff);
    let maxP = -Infinity, minP = Infinity, maxAt = 0, minAt = 0;
    ys.forEach((y, i) => { if (y > maxP) { maxP = y; maxAt = xs[i]; } if (y < minP) { minP = y; minAt = xs[i]; } });
    const sUp = slope(totalPayoff, hi + 1000), sDn = slope(totalPayoff, 0.5);
    const upUnb = sUp > 1e-9, upUnbLoss = sUp < -1e-9, dnRisk = sDn > 1e-9;
    const flat = Math.abs(maxP - minP) < 1e-6;
    const ks = Array.from(new Set(allStrikes())).sort((a, b) => a - b);
    const regions = []; let cur = null;
    xs.forEach((x, i) => { if (ys[i] > 0) { if (!cur) cur = [x, x]; else cur[1] = x; } else if (cur) { regions.push(cur); cur = null; } });
    if (cur) regions.push(cur);
    const step = (hi - lo) / 400;
    regions.forEach(r => { bes.forEach(b => { if (Math.abs(b - r[0]) <= step * 1.5) r[0] = b; if (Math.abs(b - r[1]) <= step * 1.5) r[1] = b; }); });
    const regionText = regions.map(r => (r[0] <= lo + 1e-9 ? 'below ' + fmtPx(r[1]) : r[1] >= hi - 1e-9 ? 'above ' + fmtPx(r[0]) : 'between ' + fmtPx(r[0]) + ' and ' + fmtPx(r[1]))).join(' or ');

    const paras = [];
    const names = on.map(p => `${p.name.toLowerCase()} (${posLabel(p)}${Number(p.contracts) !== 1 ? ' ×' + p.contracts : ''})`);
    let s1 = `You hold ${on.length === 1 ? 'one position' : on.length + ' positions'} on ${tk}: ${names.join('; ')}. ` +
      `Net you ${net >= 0 ? 'paid ' + fmtUSD(net) : 'collected ' + fmtUSD(-net)} across the book.`;
    if (flat) s1 += ` The positions cancel each other out — the combined line is flat, so this is a closed trade with ${maxP >= 0 ? 'a locked-in gain' : 'a locked-in loss'} of ${fmtUSD(maxP)} whatever ${tk} does.`;
    paras.push(s1);
    if (flat) return { facts: { net, maxP, minP, bes, flat: true }, paras };

    let bias;
    if (upUnb && !dnRisk) bias = 'bullish with open-ended upside';
    else if (upUnb && dnRisk) bias = 'bullish and long the stock, so it gains dollar-for-dollar on the way up and loses on the way down';
    else if (upUnbLoss) bias = 'bearish with unlimited risk if price rallies';
    else if (regions.length === 1 && regions[0][1] >= hi - 1e-9) bias = 'bullish';
    else if (regions.length === 1 && regions[0][0] <= lo + 1e-9) bias = 'bearish';
    else if (regions.length === 1) bias = 'range-bound — it wants price to stay pinned';
    else if (regions.length >= 2) bias = 'looking for a move away from the middle';
    else bias = 'currently negative everywhere in the chart range';
    let s2 = `The combined payoff is ${bias}. `;
    if (regions.length) s2 += `It makes money at expiry ${regionText}. `;
    s2 += `Max profit is ${upUnb ? 'uncapped' : fmtUSD(maxP) + ' (at ' + fmtPx(maxAt) + (maxP === ys[ys.length - 1] ? ' and above' : maxP === ys[0] ? ' and below' : '') + ')'}; ` +
      `max loss is ${upUnbLoss ? 'uncapped on the upside' : dnRisk ? fmtUSD(minP) + ' at ' + fmtPx(minAt) + ' in this range and keeps growing if price falls further' : fmtUSD(minP) + ' (at ' + fmtPx(minAt) + (minP === ys[0] ? ' and below' : minP === ys[ys.length - 1] ? ' and above' : '') + ')'}.`;
    paras.push(s2);

    if (bes.length) {
      let s3 = `Breakeven${bes.length > 1 ? 's sit' : ' sits'} at ${bes.map(fmtPx).join(' and ')}`;
      if (spot > 0) {
        const d = bes.map(b => ((b - spot) / spot * 100));
        s3 += ` — ${bes.map((b, i) => `${Math.abs(d[i]).toFixed(1)}% ${d[i] >= 0 ? 'above' : 'below'} spot`).join(' and ')}`;
        const v = totalPayoff(spot);
        s3 += `. If ${tk} closed at today's ${fmtPx(spot)} the book would ${v >= 0 ? 'show ' + fmtUSD(v) : 'lose ' + fmtUSD(-v)}.`;
      } else s3 += '. Enter a spot price to see how far away they are.';
      paras.push(s3);
    }

    const notes = [];
    if (!upUnb && !upUnbLoss && !dnRisk && minP < 0 && maxP > 0) {
      const rr = maxP / -minP;
      notes.push(`Reward to risk is ${rr.toFixed(2)} : 1${rr >= 1 ? ', so you are risking less than you can make — the trade-off is usually a lower probability of reaching max profit' : ', which is typical of a high-probability credit structure: the trade pays for itself through win rate, not size'}.`);
    }
    on.forEach(p => {
      const opt = p.legs.filter(l => l.type !== 'stock');
      const hasStock = p.legs.some(l => l.type === 'stock');
      const netP = Number(p.net) || 0;
      if (opt.length === 2 && !hasStock && netP < 0 && opt[0].type === opt[1].type) {
        const width = Math.abs(opt[0].strike - opt[1].strike);
        const ratio = -netP / width;
        if (width > 0) notes.push(`${p.name} collects ${fmtPx(-netP)} on a ${width}-wide spread (${(ratio * 100).toFixed(0)}% of width)${ratio >= 1 / 3 ? ' — clears the one-third rule of thumb' : ' — below the one-third-of-width guideline, so the credit is thin for the risk'}.`);
      }
      if (hasStock && p.legs.some(l => l.side === 'short' && l.type === 'call')) notes.push(`${p.name}: the short call caps your shares at its strike — expect assignment if ${tk} finishes above it.`);
      if (!hasStock) { const sh = p.legs.find(l => l.side === 'short'); if (sh && !p.legs.some(l => l.side === 'long' && l.type === sh.type)) notes.push(`<span class="flag">${p.name} has a naked short ${sh.type}</span> — margin will be heavy and the loss ${sh.type === 'call' ? 'is unlimited on a rally' : 'runs all the way to zero (' + fmtUSD(sh.strike * mult * (Number(p.contracts) || 0) * (Number(sh.ratio) || 1)) + ' of exposure)'}.`); }
    });
    if (upUnbLoss) notes.push('<span class="flag">The book loses without limit on a rally.</span> A long call above the short strike would define the risk.');
    if (ks.length && !flat) {
      const inner = ks.filter(k => k > lo && k < hi);
      if (inner.length >= 2) notes.push(`The kinks in the line are your strikes (${inner.join(', ')}); between ${inner[0]} and ${inner[1]} P/L moves ${fmtUSD(Math.abs(slope(totalPayoff, (inner[0] + inner[1]) / 2)))} per $1 of ${tk}.`);
      else if (inner.length === 1) notes.push(`The kink in the line is your ${inner[0]} strike.`);
    }
    if (notes.length) paras.push(notes.join(' '));
    paras.push('This is an expiry picture: before expiry, time decay and implied volatility move the mark-to-market, and short legs can be assigned early when they go deep in the money.');
    return { facts: { net, maxP, minP, bes, upUnb, upUnbLoss, dnRisk, regions, spot }, paras };
  }

  function coachLines(lo, hi, bes) {
    const on = state.positions.filter(p => p.on);
    const c = ctx(); const out = [];
    const line = (kind, html) => out.push({ kind, html });
    if (!on.length) return out;
    const ivr = c.ivr, dte = Number(state.dte) || 0;
    const sells = on.filter(p => p.strat && stratById(p.strat).ivEnv === 'sell').map(p => p.name);
    const buys = on.filter(p => p.strat && stratById(p.strat).ivEnv === 'buy').map(p => p.name);
    if (sells.length) {
      if (ivr < 30) line('bad', `<em>IV Rank looks low (${ivr}) for premium selling</em> (${sells.join(', ')}) — you're not getting paid much for the risk. Consider waiting for higher IV or a debit structure.`);
      else if (ivr < 50) line('warn', `<em>IV Rank is middling (${ivr})</em> — workable for ${sells.join(', ')}, but more attractive above ~50.`);
      else line('ok', `<em>IV Rank (${ivr}) looks supportive</em> for selling premium (${sells.join(', ')}).`);
    }
    if (buys.length) {
      if (ivr > 60) line('bad', `<em>IV Rank looks high (${ivr})</em> for buying premium (${buys.join(', ')}) — you'd be paying up, and a post-event IV crush can hurt even if direction is right.`);
      else if (ivr > 40) line('warn', `<em>IV Rank is middling (${ivr})</em> — fine for ${buys.join(', ')}, but a better setup below ~40.`);
      else line('ok', `<em>IV Rank (${ivr}) is low</em>, the right environment for buying premium (${buys.join(', ')}).`);
    }
    if (dte <= 21) line('warn', `<em>You're inside the 21-DTE window</em> tastytrade traders watch closely — gamma risk accelerates from here. Many would close or roll rather than hold.`);
    else if (dte >= 40 && dte <= 50) line('ok', `<em>~${dte} DTE</em> sits right in the classic 45-DTE entry window.`);
    if (state.earn) {
      const days = Math.round((new Date(state.earn + 'T00:00:00') - new Date()) / 86400000);
      if (days >= 0 && days <= dte) {
        const dstr = `<em>Earnings in ${days} day${days === 1 ? '' : 's'}</em> falls inside this trade's window`;
        const undef = on.some(p => p.strat && stratById(p.strat).undefinedRisk);
        const big = on.some(p => p.strat && stratById(p.strat).cat === 'bigmove');
        if (big) line('ok', `${dstr} — that's exactly the catalyst a big-move structure is built for. Just make sure you're in before IV has priced the whole move.`);
        else if (undef) line('bad', `${dstr}, and the book carries undefined risk — a surprise gap can produce an outsized loss with no floor.`);
        else if (sells.length) line('warn', `${dstr} — risk is capped, but expect the chance of a gap through a strike overnight.`);
        else line('warn', `${dstr} — a surprise gap against the position is a real risk.`);
      }
    }
    on.forEach(p => {
      const fill = Math.abs(Number(p.net) || 0) * (Number(p.contracts) || 0) * c.mult;
      const now = Number(p.now);
      if (p.now !== '' && !isNaN(now) && fill > 0 && !p.legs.some(l => l.type === 'stock')) {
        const credit = Number(p.net) < 0;
        const pct = credit ? (fill - now) / fill * 100 : (now - fill) / fill * 100;
        if (pct >= 50) line('ok', `${p.name}: you've captured about <em>${pct.toFixed(0)}%</em> of ${credit ? 'the credit' : 'the cost'} — many tastytrade-style traders take it off around 50% rather than holding for the rest.`);
        else if (pct > 0) line('info', `${p.name}: about <em>${pct.toFixed(0)}%</em> captured so far — no rush, but know your exit plan.`);
        else line('warn', `${p.name} is underwater versus your fill — decide the management plan before it decides for you.`);
      }
    });
    on.forEach(p => {
      if (p.strat !== 'csp' || dte <= 0) return;
      const leg = p.legs[0]; if (!leg || Number(p.net) >= 0) return;
      const capital = (Number(leg.strike) || 0) * c.mult * (Number(p.contracts) || 0);
      const credit = -Number(p.net) * c.mult * (Number(p.contracts) || 0);
      if (capital > 0 && credit > 0) {
        const annualized = credit / capital * (365 / dte) * 100;
        line('info', `${p.name}: ${fmtUSD(credit)} of credit on ${fmtUSD(capital)} of secured cash is a <em>${annualized.toFixed(1)}% annualized yield</em> if it expires worthless.`);
      }
    });
    const acct = Number(state.acct);
    if (acct > 0) {
      const xs = []; for (let i = 0; i <= 200; i++) xs.push(lo + (hi - lo) * i / 200);
      const minP = Math.min(...xs.map(totalPayoff));
      if (minP < 0) { const pct = -minP / acct * 100; line(pct > 5 ? 'bad' : 'ok', `This book risks about <em>${pct.toFixed(1)}%</em> of your account in the chart range — ${pct > 5 ? 'most small-size, high-occurrence approaches keep single trades well under 5%' : 'reasonably sized'}.`); }
    }
    on.forEach(p => { if (p.strat) { const st = stratById(p.strat); line('info', `<em>${p.name}:</em> ${st.tip}`); line('warn', `<em>Watch (${p.name.toLowerCase()}):</em> ${st.watch}`); } });
    return out;
  }
  function renderCommentary(lo, hi, bes) {
    const cl = coachLines(lo, hi, bes);
    $('coach').innerHTML = cl.length ? '<div class="eyebrow">Coach</div>' + cl.map(l => `<div class="cl ${l.kind}"><span class="dot"></span><p>${l.html}</p></div>`).join('') : '';
    $('coach').hidden = !cl.length;
    const { paras } = analyze(lo, hi, bes);
    $('autoComm').innerHTML = '<div class="eyebrow">Trade read · updates as you edit</div>' + paras.map(p => `<p>${p}</p>`).join('');
  }

  // ---------- orchestration ----------
  function update(rebuildPositions = true) {
    save();
    renderTabs();
    if (rebuildPositions) renderPositions();
    $('chartTitle').textContent = (state.ticker || 'Underlying').toUpperCase() + ' · P/L at expiry';
    const [alo, ahi] = autoRange();
    $('rangeLo').placeholder = alo; $('rangeHi').placeholder = ahi;
    const { lo, hi, bes } = renderStats();
    renderChart(lo, hi, bes);
    renderCommentary(lo, hi, bes);
    renderTable(lo, hi, bes);
    renderScenario();
  }

  // header controls
  loadHeader();
  $('newTrade').addEventListener('click', () => {
    store.trades.push(SB.blankTrade('')); store.active = store.trades.length - 1; state = store.trades[store.active];
    loadHeader(); update(); $('ticker').focus();
  });
  $('dupTrade').addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(state)); copy.ticker = (copy.ticker || 'Untitled') + ' copy'; copy.id = SB.mintId(); copy.createdAt = Date.now(); copy.positions.forEach(p => { p.id = SB.mintId(); });
    store.trades.push(copy); store.active = store.trades.length - 1; state = copy; loadHeader(); update();
  });
  $('delTrade').addEventListener('click', () => {
    if (store.trades.length <= 1) return;
    store.trades.splice(store.active, 1); store.active = Math.max(0, store.active - 1); state = store.trades[store.active];
    loadHeader(); update();
  });
  $('ticker').addEventListener('input', e => { state.ticker = e.target.value.toUpperCase(); update(false); });
  $('spot').addEventListener('input', e => { state.spot = e.target.value; update(false); refreshAllGreeks(); if (!$('svK').value && Number(state.spot) > 0) $('svK').value = roundStrike(Number(state.spot), Number(state.spot)); });
  $('mult').addEventListener('input', e => { state.mult = Number(e.target.value) || 100; update(false); });
  $('rangeLo').addEventListener('input', e => { state.lo = e.target.value; update(false); });
  $('rangeHi').addEventListener('input', e => { state.hi = e.target.value; update(false); });
  ['iv', 'dte', 'ivr', 'rate', 'earn', 'acct'].forEach(id => $(id).addEventListener('input', e => { state[id] = e.target.value; update(false); refreshAllGreeks(); }));
  $('autoRange').addEventListener('click', () => { state.lo = ''; state.hi = ''; $('rangeLo').value = ''; $('rangeHi').value = ''; update(false); });
  $('showLegs').addEventListener('change', () => update(false));
  $('showTotal').addEventListener('change', () => update(false));
  $('addCustom').addEventListener('click', () => {
    const c = ctx(); const S = c.S > 0 ? c.S : (allStrikes()[0] || 100);
    state.positions.push({ id: SB.mintId(), name: 'Custom', strat: null, status: 'idea', events: [], notes: '', on: true, contracts: 1, net: 0, now: '', legs: [L('long', 'call', roundStrike(S, S), 1)] });
    update();
  });
  let intent = 'all';
  function renderLibrary() {
    $('intents').innerHTML = INTENTS.map(i => `<button type="button" class="chip${i.id === intent ? ' active' : ''}" data-i="${i.id}">${i.title}</button>`).join('');
    $('intents').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { intent = b.dataset.i; renderLibrary(); }));
    const f = INTENTS.find(i => i.id === intent).f;
    $('strats').innerHTML = STRATS.filter(f).map(st => `<button type="button" class="strat" data-s="${st.id}">
      <span class="nm">${st.name}<span class="badge ${st.cat}">${CATS[st.cat]}</span></span>
      <span class="ol">${st.outlook}</span>
      <span class="rk">${st.undefinedRisk ? '⚠ Undefined risk' : 'Defined risk'} · ${st.ivEnv === 'sell' ? 'wants high IV rank' : st.ivEnv === 'buy' ? 'wants low IV rank' : 'any IV environment'}</span></button>`).join('');
    $('strats').querySelectorAll('.strat').forEach(b => b.addEventListener('click', () => {
      state.positions.push(buildPosition(stratById(b.dataset.s))); update();
      $('positions').lastElementChild && $('positions').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }));
  }
  renderLibrary();

  // ---------- guided strategy picker ----------
  const WZ_PICK = {
    bullish: { conservative: ['bull_put_spread', 'covered_call'], moderate: ['bull_call_spread', 'bull_put_spread'], aggressive: ['long_call', 'bull_call_spread'] },
    bearish: { conservative: ['bear_call_spread', 'bear_put_spread'], moderate: ['bear_put_spread', 'bear_call_spread'], aggressive: ['long_put', 'bear_put_spread'] },
    neutral: { conservative: ['iron_condor', 'iron_fly'], moderate: ['iron_fly', 'iron_condor'], aggressive: ['short_strangle', 'iron_fly'] },
    bigmove: { conservative: ['long_strangle', 'long_straddle'], moderate: ['long_straddle', 'long_strangle'], aggressive: ['long_straddle', 'long_strangle'] },
  };
  const WZ_HORIZON_DTE = { short: 21, standard: 45, longer: 60 };
  const wz = { experience: 'some', risk: 'moderate', outlook: 'bullish', horizon: 'standard' };
  function wzPills(id, options, key) {
    $(id).innerHTML = options.map(o => `<button type="button" class="chip${wz[key] === o.v ? ' active' : ''}" data-v="${o.v}">${o.label}</button>`).join('');
    $(id).querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { wz[key] = b.dataset.v; renderWizardPills(); renderWizardNote(); }));
  }
  function renderWizardPills() {
    wzPills('wzExperience', [{ v: 'new', label: 'New to options' }, { v: 'some', label: 'Some experience' }, { v: 'experienced', label: 'Experienced' }], 'experience');
    wzPills('wzRisk', [{ v: 'conservative', label: 'Conservative' }, { v: 'moderate', label: 'Moderate' }, { v: 'aggressive', label: 'Aggressive' }], 'risk');
    wzPills('wzOutlook', [{ v: 'bullish', label: 'Bullish' }, { v: 'bearish', label: 'Bearish' }, { v: 'neutral', label: 'Neutral / range-bound' }, { v: 'bigmove', label: 'Big move, unsure which way' }], 'outlook');
    wzPills('wzHorizon', [{ v: 'short', label: '~2-3 weeks' }, { v: 'standard', label: '~45 days' }, { v: 'longer', label: '60+ days' }], 'horizon');
  }
  function wzPickIds() {
    const group = WZ_PICK[wz.outlook] || WZ_PICK.bullish;
    let [id, altId] = group[wz.risk] || group.moderate;
    if (wz.experience === 'new' && stratById(id).undefinedRisk && altId && !stratById(altId).undefinedRisk) { const swap = id; id = altId; altId = swap; }
    return { id, altId };
  }
  function renderWizardNote() {
    const { id, altId } = wzPickIds();
    const st = stratById(id), alt = altId ? stratById(altId) : null;
    let html = `Based on your inputs: <b>${st.name}</b> — ${st.outlook}`;
    if (st.undefinedRisk) html += ' <span class="flag">Carries undefined risk — size it very small.</span>';
    if (alt) html += ` <span style="color:var(--muted)">Alternative: ${alt.name}.</span>`;
    $('wzNote').innerHTML = html;
  }
  // target |delta| for a leg based on how far its library template places it from spot —
  // small offsets sit closer to the money (higher delta), wide offsets are the classic ~16-20Δ wings
  function wzTargetDelta(pct) {
    const a = Math.abs(pct);
    if (a === 0) return 0.5;
    if (a <= 0.03) return 0.35;
    if (a <= 0.06) return 0.30;
    if (a <= 0.09) return 0.20;
    return 0.16;
  }
  function buildAutoLegs(strat, c) {
    return strat.legs.map(([side, type, pct, ratio]) => {
      if (type === 'stock') return L(side, type, 0, ratio || 1);
      const targetDelta = wzTargetDelta(pct) * (type === 'call' ? 1 : -1);
      const strike = findStrikeByDelta(type, targetDelta, c.S, c.T, c.r, c.iv);
      return L(side, type, strike, ratio || 1);
    });
  }
  $('wzBuild').addEventListener('click', () => {
    const { id } = wzPickIds();
    const strat = stratById(id);
    state.dte = WZ_HORIZON_DTE[wz.horizon] || 45; $('dte').value = state.dte;
    const c = ctx();
    const S = c.S > 0 ? c.S : (allStrikes()[0] || 100);
    const legs = (c.S > 0 && c.iv > 0)
      ? buildAutoLegs(strat, Object.assign({}, c, { S }))
      : strat.legs.map(([side, type, pct, ratio]) => L(side, type, type === 'stock' ? 0 : roundStrike(S * (1 + pct), S), ratio || 1));
    const p = { id: SB.mintId(), name: strat.name, strat: strat.id, status: 'idea', events: [], notes: '', on: true, contracts: 1, net: 0, now: '', legs };
    const est = posTheo(p, Object.assign({}, c, { S }));
    p.net = Math.round(est.net * 100) / 100;
    const acct = Number(state.acct), riskPct = Number($('wzRiskPct').value) || 5;
    if (acct > 0) {
      const maxLoss = SB.posMaxLossFor(p, c.mult);
      if (maxLoss !== null && maxLoss < 0) p.contracts = Math.max(1, Math.floor((acct * riskPct / 100) / -maxLoss));
    }
    state.positions.push(p);
    update();
    $('positions').lastElementChild && $('positions').lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  renderWizardPills();
  renderWizardNote();

  $('resetBtn').addEventListener('click', () => { const keep = { id: state.id, createdAt: state.createdAt }; state = Object.assign(SB.blankTrade(state.ticker), keep); store.trades[store.active] = state; loadHeader(); update(); });

  update();
})();
