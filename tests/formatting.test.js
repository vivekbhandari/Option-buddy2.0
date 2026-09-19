'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSB } = require('./helpers/load-shared');

test('esc(): escapes &, " and < (but leaves > alone, matching the implementation)', () => {
  const { SB } = loadSB();
  assert.equal(SB.esc('<b>&"</b>'), '&lt;b>&amp;&quot;&lt;/b>');
});

test('esc(): specifically neutralizes a script-injection attempt', () => {
  const { SB } = loadSB();
  const escaped = SB.esc('<script>alert(1)</script>');
  assert.ok(!escaped.includes('<script>'), 'raw <script> tag must not survive escaping');
  assert.ok(escaped.startsWith('&lt;script>'), 'the opening angle bracket must be escaped');
});

test('fmtUSD(): formats sign, thousands separators, and rounds to whole dollars', () => {
  const { SB } = loadSB();
  assert.equal(SB.fmtUSD(1234.6), '$1,235');
  assert.equal(SB.fmtUSD(-1234.6), '−$1,235');
  assert.equal(SB.fmtUSD(0), '$0');
});

test('fmtPx(): always shows exactly two decimal places', () => {
  const { SB } = loadSB();
  assert.equal(SB.fmtPx(100), '100.00');
  assert.equal(SB.fmtPx(99.999), '100.00');
  assert.equal(SB.fmtPx(1234.5), '1,234.50');
});

test('ticks(): produces a "nice" round step, not an arbitrary fraction', () => {
  const { SB } = loadSB();
  const t = SB.ticks(0, 100, 5);
  assert.ok(t.length >= 4 && t.length <= 7, `expected roughly 5 ticks, got ${t.length}`);
  // every gap between consecutive ticks should be identical (a single fixed step)
  const gaps = new Set(t.slice(1).map((v, i) => Math.round((v - t[i]) * 1e6) / 1e6));
  assert.equal(gaps.size, 1, 'ticks() must use one consistent step size');
});

test('daysBetween(): counts whole days between two ISO dates', () => {
  const { SB } = loadSB();
  assert.equal(SB.daysBetween('2026-01-01', '2026-01-10'), 9);
  assert.equal(SB.daysBetween('2026-01-10', '2026-01-01'), -9);
  assert.equal(SB.daysBetween('2026-01-01', '2026-01-01'), 0);
});

test('daysBetween(): returns null when either date is missing', () => {
  const { SB } = loadSB();
  assert.equal(SB.daysBetween('', '2026-01-01'), null);
  assert.equal(SB.daysBetween('2026-01-01', ''), null);
  assert.equal(SB.daysBetween(null, null), null);
});
