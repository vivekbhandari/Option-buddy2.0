'use strict';
// computeBook() is the consolidated payoff-curve engine that replaced four
// independent sampling loops previously duplicated across renderStats(),
// renderChart(), analyze() and coachLines() in js/trade-page.js. These tests
// pin its behavior against hand-derived textbook results so that refactor
// stays honest going forward.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSB } = require('./helpers/load-shared');

test('computeBook(): bull call spread — capped profit/loss, one breakeven', () => {
  const { SB } = loadSB();
  const positions = [{
    on: true, contracts: 1, net: 4,
    legs: [SB.L('long', 'call', 100, 1), SB.L('short', 'call', 110, 1)],
  }];
  const book = SB.computeBook(positions, 100, 50, 150);
  assert.ok(Math.abs(book.maxP - 600) < 5, `maxP ${book.maxP} ~ 600`);
  assert.ok(Math.abs(book.minP - -400) < 5, `minP ${book.minP} ~ -400`);
  assert.equal(book.upUnbounded, false);
  assert.equal(book.upUnboundedLoss, false);
  assert.equal(book.bes.length, 1);
  assert.ok(Math.abs(book.bes[0] - 104) < 0.5, `breakeven ${book.bes[0]} ~ 104`);
  assert.deepEqual(book.strikes.slice().sort((a, b) => a - b), [100, 110]);
});

test('computeBook(): iron condor — two breakevens, credit capped both sides', () => {
  const { SB } = loadSB();
  const positions = [{
    on: true, contracts: 1, net: -2,
    legs: [
      SB.L('short', 'put', 95, 1), SB.L('long', 'put', 90, 1),
      SB.L('short', 'call', 105, 1), SB.L('long', 'call', 110, 1),
    ],
  }];
  const book = SB.computeBook(positions, 100, 60, 140);
  assert.ok(Math.abs(book.maxP - 200) < 5);
  assert.ok(Math.abs(book.minP - -300) < 5);
  assert.equal(book.bes.length, 2);
  assert.ok(Math.abs(book.bes[0] - 93) < 0.5);
  assert.ok(Math.abs(book.bes[1] - 107) < 0.5);
});

test('computeBook(): long stock is unbounded on profit and loss, no breakeven above zero cost', () => {
  const { SB } = loadSB();
  const positions = [{ on: true, contracts: 1, net: 100, legs: [SB.L('long', 'stock', 0, 1)] }];
  const book = SB.computeBook(positions, 100, 0, 200);
  assert.equal(book.upUnbounded, true, 'profit grows without limit above the range');
  assert.equal(book.dnRisk, true, 'loss grows as price falls toward zero');
  assert.equal(book.bes.length, 1);
  assert.ok(Math.abs(book.bes[0] - 100) < 1, 'breakeven at cost basis');
});

test('computeBook(): a naked short call is unbounded-loss on the upside', () => {
  const { SB } = loadSB();
  const positions = [{ on: true, contracts: 1, net: -3, legs: [SB.L('short', 'call', 100, 1)] }];
  const book = SB.computeBook(positions, 100, 50, 150);
  assert.equal(book.upUnboundedLoss, true);
  assert.equal(book.upUnbounded, false);
});

test('computeBook(): positions with on:false are excluded from the book entirely', () => {
  const { SB } = loadSB();
  const positions = [
    { on: true, contracts: 1, net: 4, legs: [SB.L('long', 'call', 100, 1), SB.L('short', 'call', 110, 1)] },
    { on: false, contracts: 1, net: -50, legs: [SB.L('short', 'put', 200, 1)] },
  ];
  const book = SB.computeBook(positions, 100, 50, 150);
  assert.equal(book.on.length, 1, 'only the on:true position is included');
  assert.deepEqual(book.strikes.slice().sort((a, b) => a - b), [100, 110], 'the off position\'s strike is not sampled');
});

test('computeBook(): a flat (fully hedged) book has maxP === minP', () => {
  const { SB } = loadSB();
  // long 100C and short 100C at the same strike/ratio/net cancel out exactly
  const positions = [
    { on: true, contracts: 1, net: 5, legs: [SB.L('long', 'call', 100, 1)] },
    { on: true, contracts: 1, net: -5, legs: [SB.L('short', 'call', 100, 1)] },
  ];
  const book = SB.computeBook(positions, 100, 50, 150);
  assert.ok(Math.abs(book.maxP - book.minP) < 1e-6);
  assert.ok(Math.abs(book.maxP) < 1e-6, 'net cost was zero, so P/L is flat at zero');
});

test('computeBook(): series preserves each position\'s original index for stable chart coloring', () => {
  const { SB } = loadSB();
  const positions = [
    { on: false, contracts: 1, net: 1, legs: [SB.L('long', 'call', 100, 1)] },
    { on: true, contracts: 1, net: 2, legs: [SB.L('long', 'call', 110, 1)] },
    { on: true, contracts: 1, net: 3, legs: [SB.L('long', 'call', 120, 1)] },
  ];
  const book = SB.computeBook(positions, 100, 50, 150);
  assert.deepEqual(book.series.map(s => s.i), [1, 2], 'off position (index 0) excluded; remaining keep original indices 1 and 2');
});

test('computeBook(): tot at each x equals the sum of every position\'s payoff there', () => {
  const { SB } = loadSB();
  const positions = [
    { on: true, contracts: 1, net: 4, legs: [SB.L('long', 'call', 100, 1), SB.L('short', 'call', 110, 1)] },
    { on: true, contracts: 2, net: -1, legs: [SB.L('short', 'put', 90, 1)] },
  ];
  const book = SB.computeBook(positions, 100, 50, 150);
  const mult = 100;
  const idx = book.xs.findIndex(x => Math.abs(x - 105) < 0.5);
  assert.ok(idx >= 0);
  const expected = SB.posPayoffFor(positions[0], book.xs[idx], mult) + SB.posPayoffFor(positions[1], book.xs[idx], mult);
  assert.ok(Math.abs(book.tot[idx] - expected) < 1e-6);
});
