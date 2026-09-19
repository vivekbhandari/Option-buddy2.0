'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSB } = require('./helpers/load-shared');

// A real (if minimal) CSV line parser: handles both the unquoted header row
// and the quoted data rows csvText() produces, including "" as an escaped quote.
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
function parseCsv(text) { return text.trim().split('\n').map(parseCsvLine); }

test('csvText(): header row matches the documented column order', () => {
  const { SB } = loadSB();
  const rows = parseCsv(SB.csvText({ trades: [] }));
  assert.deepEqual(rows[0], [
    'trade_id', 'ticker', 'position_id', 'strategy', 'status', 'opened', 'closed', 'days_held',
    'contracts', 'multiplier', 'legs', 'entry_net_per_share', 'exit_net_per_share', 'entry_cost',
    'realized_pl', 'exit_reason', 'spot_at_entry', 'iv_at_entry', 'iv_rank_at_entry', 'dte_at_entry',
    'notes', 'events',
  ]);
});

test('csvText(): one row per position, across every trade', () => {
  const { SB } = loadSB();
  const t1 = SB.blankTrade('AAPL'); t1.positions.push({ id: 'p1', name: 'Long call', status: 'open', contracts: 1, net: 2, legs: [SB.L('long', 'call', 200, 1)], events: [] });
  const t2 = SB.blankTrade('MSFT'); t2.positions.push({ id: 'p2', name: 'CSP', status: 'idea', contracts: 1, net: -1, legs: [SB.L('short', 'put', 300, 1)], events: [] });
  const rows = parseCsv(SB.csvText({ trades: [t1, t2] }));
  assert.equal(rows.length, 3, 'header + 2 position rows');
  assert.equal(rows[1][1], 'AAPL');
  assert.equal(rows[2][1], 'MSFT');
});

test('csvText(): a comma or quote inside a field does not break the row shape', () => {
  const { SB } = loadSB();
  const t = SB.blankTrade('AAPL');
  t.positions.push({ id: 'p1', name: 'Weird "name", with stuff', status: 'idea', contracts: 1, net: 1, legs: [SB.L('long', 'call', 100, 1)], events: [], notes: 'a, b, "c"' });
  const rows = parseCsv(SB.csvText({ trades: [t] }));
  assert.equal(rows.length, 2);
  assert.equal(rows[1].length, 22, 'still exactly 22 columns despite embedded commas/quotes');
  assert.equal(rows[1][20], 'a, b, "c"', 'the notes field survives round-trip intact');
});

test('csvText(): only closed positions carry an exit price and realized P/L', () => {
  const { SB } = loadSB();
  const t = SB.blankTrade('AAPL');
  t.positions.push(
    { id: 'p1', name: 'Open one', status: 'open', contracts: 1, net: 2, legs: [SB.L('long', 'call', 100, 1)], events: [] },
    { id: 'p2', name: 'Closed one', status: 'closed', contracts: 1, net: 2, exitNet: -1, legs: [SB.L('long', 'call', 100, 1)], events: [] },
  );
  const rows = parseCsv(SB.csvText({ trades: [t] }));
  const [, openRow, closedRow] = rows;
  assert.equal(openRow[12], '', 'open position has no exit_net_per_share');
  assert.equal(openRow[14], '', 'open position has no realized_pl');
  assert.equal(closedRow[12], '-1');
  assert.equal(Number(closedRow[14]), -100, 'realized_pl for the closed position matches realized(): paid $2 to open, only $1 back closing = -$100');
});
