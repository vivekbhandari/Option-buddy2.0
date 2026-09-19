'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSB } = require('./helpers/load-shared');

test('legPayoff() computes call/put intrinsic value at expiry, signed by side', () => {
  const { SB } = loadSB();
  const longCall = { side: 'long', type: 'call', strike: 100, ratio: 1 };
  const shortCall = { side: 'short', type: 'call', strike: 100, ratio: 1 };
  assert.equal(SB.legPayoff(longCall, 110), 10);
  assert.equal(SB.legPayoff(longCall, 90), 0);
  assert.equal(SB.legPayoff(shortCall, 110), -10);
  const longPut = { side: 'long', type: 'put', strike: 100, ratio: 1 };
  assert.equal(SB.legPayoff(longPut, 90), 10);
  assert.equal(SB.legPayoff(longPut, 110), 0);
});

test('legPayoff() scales by ratio, and stock legs pay the raw price (no strike)', () => {
  const { SB } = loadSB();
  const twoCalls = { side: 'short', type: 'call', strike: 100, ratio: 2 };
  assert.equal(SB.legPayoff(twoCalls, 110), -20);
  const stock = { side: 'long', type: 'stock', ratio: 1 };
  assert.equal(SB.legPayoff(stock, 87.5), 87.5);
});

test('posPayoffFor(): a bull call spread has the textbook capped payoff shape', () => {
  const { SB } = loadSB();
  // long 100C / short 110C, paid $4 net debit, 1 contract, $100 multiplier
  const pos = {
    legs: [SB.L('long', 'call', 100, 1), SB.L('short', 'call', 110, 1)],
    net: 4, contracts: 1,
  };
  const mult = 100;
  assert.equal(SB.posPayoffFor(pos, 90, mult), -400, 'below both strikes: lose the full debit');
  assert.equal(SB.posPayoffFor(pos, 104, mult), 0, 'breakeven at long strike + debit');
  assert.equal(SB.posPayoffFor(pos, 110, mult), 600, 'at the short strike: max profit = width - debit');
  assert.equal(SB.posPayoffFor(pos, 130, mult), 600, 'above the short strike: capped at max profit');
});

test('posPayoffFor(): a naked short put loses dollar-for-dollar below the strike', () => {
  const { SB } = loadSB();
  const pos = { legs: [SB.L('short', 'put', 50, 1)], net: -2, contracts: 3 };
  const mult = 100;
  // credit received: $2/share * 100 * 3 contracts = $600 max profit, at or above strike
  assert.equal(SB.posPayoffFor(pos, 55, mult), 600);
  // at $40: intrinsic loss is (50-40)=10/share, net of the $2 credit = $8/share * 100 * 3 = $2400 loss
  assert.equal(SB.posPayoffFor(pos, 40, mult), -2400);
});

test('posMaxProfitFor()/posMaxLossFor() agree with hand-computed bounds for an iron condor', () => {
  const { SB } = loadSB();
  // classic iron condor: short 95P/long 90P, short 105C/long 110C, collected $2 credit
  const pos = {
    legs: [
      SB.L('short', 'put', 95, 1), SB.L('long', 'put', 90, 1),
      SB.L('short', 'call', 105, 1), SB.L('long', 'call', 110, 1),
    ],
    net: -2, contracts: 1,
  };
  const maxProfit = SB.posMaxProfitFor(pos); // per 100-multiplier contract, hardcoded inside posMaxProfitFor
  const maxLoss = SB.posMaxLossFor(pos, 100);
  assert.ok(Math.abs(maxProfit - 200) < 1, `max profit ${maxProfit} should be ~$200 (the credit)`);
  // width (5) - credit (2) = $3/share = $300 max loss
  assert.ok(Math.abs(maxLoss - -300) < 1, `max loss ${maxLoss} should be ~-$300`);
});

test('realized(): debit paid to open, sold for a larger credit to close -> profit', () => {
  const { SB } = loadSB();
  // paid $3.00 debit to open, sold to close for $5.00 credit -> $2.00/share profit
  const pos = { net: 3, exitNet: -5, contracts: 2 };
  assert.equal(SB.realized(pos, 100), 400);
});

test('realized(): debit paid to open, sold for a smaller credit to close -> loss', () => {
  const { SB } = loadSB();
  // paid $3.00 debit to open, only got $1.00 credit back closing -> $2.00/share loss
  const pos = { net: 3, exitNet: -1, contracts: 2 };
  assert.equal(SB.realized(pos, 100), -400);
});

test('realized(): credit received to open, bought back cheaper to close -> profit', () => {
  const { SB } = loadSB();
  // collected $2.00 credit to open, paid $0.50 debit to close -> $1.50/share profit
  const creditPos = { net: -2, exitNet: 0.5, contracts: 1 };
  assert.equal(SB.realized(creditPos, 100), 150);
});

test('posLabel(): formats legs compactly with side/ratio/strike/type', () => {
  const { SB } = loadSB();
  const pos = { legs: [SB.L('long', 'call', 350, 1), SB.L('short', 'call', 360, 1)] };
  assert.equal(SB.posLabel(pos), '+350C −360C');
  const ratioed = { legs: [SB.L('long', 'call', 100, 1), SB.L('short', 'call', 110, 2)] };
  assert.equal(SB.posLabel(ratioed), '+100C −2×110C');
  const stockPos = { legs: [SB.L('long', 'stock', 0, 1)] };
  assert.equal(SB.posLabel(stockPos), '+stock');
});

test('breakevens(): finds a single zero-crossing by linear interpolation', () => {
  const { SB } = loadSB();
  // f(x) = x - 50: crosses zero at x=50
  const bes = SB.breakevens(x => x - 50, 0, 100);
  assert.equal(bes.length, 1);
  assert.ok(Math.abs(bes[0] - 50) < 0.05);
});

test('breakevens(): finds two zero-crossings for a symmetric V shape', () => {
  const { SB } = loadSB();
  // f(x) = |x - 50| - 10: crosses zero at x=40 and x=60
  const bes = SB.breakevens(x => Math.abs(x - 50) - 10, 0, 100);
  assert.equal(bes.length, 2);
  assert.ok(Math.abs(bes[0] - 40) < 0.05);
  assert.ok(Math.abs(bes[1] - 60) < 0.05);
});

test('slope(): approximates the derivative via a unit forward difference', () => {
  const { SB } = loadSB();
  assert.equal(SB.slope(x => 3 * x, 10), 3);
  assert.equal(SB.slope(() => 42, 10), 0);
});
