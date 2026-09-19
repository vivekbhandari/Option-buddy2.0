'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSB } = require('./helpers/load-shared');

test('bs() matches a known textbook Black-Scholes value', () => {
  const { SB } = loadSB();
  // Hull's "Options, Futures and Other Derivatives" worked example:
  // S=42, K=40, T=0.5, r=0.10, sigma=0.20 -> call ~= 4.76, put ~= 0.81
  const call = SB.bs('call', 42, 40, 0.5, 0.20, 0.10);
  const put = SB.bs('put', 42, 40, 0.5, 0.20, 0.10);
  assert.ok(Math.abs(call.price - 4.76) < 0.01, `call price ${call.price} should be ~4.76`);
  assert.ok(Math.abs(put.price - 0.81) < 0.01, `put price ${put.price} should be ~0.81`);
});

test('bs() satisfies put-call parity: C - P = S - K*e^(-rT)', () => {
  const { SB } = loadSB();
  const S = 123, K = 115, T = 0.35, sigma = 0.28, r = 0.045;
  const call = SB.bs('call', S, K, T, sigma, r);
  const put = SB.bs('put', S, K, T, sigma, r);
  const rhs = S - K * Math.exp(-r * T);
  assert.ok(Math.abs((call.price - put.price) - rhs) < 1e-6);
});

test('bs() defaults the risk-free rate to 4% when omitted', () => {
  const { SB } = loadSB();
  const withDefault = SB.bs('call', 100, 100, 0.25, 0.3);
  const explicit = SB.bs('call', 100, 100, 0.25, 0.3, 0.04);
  assert.equal(withDefault.price, explicit.price);
});

test('bs() call delta is in (0,1) and put delta is in (-1,0) away from expiry', () => {
  const { SB } = loadSB();
  const call = SB.bs('call', 100, 100, 0.5, 0.25, 0.04);
  const put = SB.bs('put', 100, 100, 0.5, 0.25, 0.04);
  assert.ok(call.delta > 0 && call.delta < 1);
  assert.ok(put.delta > -1 && put.delta < 0);
});

test('bs() falls back to intrinsic value at/after expiry (T<=0)', () => {
  const { SB } = loadSB();
  const itmCall = SB.bs('call', 110, 100, 0, 0.3, 0.04);
  const otmCall = SB.bs('call', 90, 100, 0, 0.3, 0.04);
  const itmPut = SB.bs('put', 90, 100, 0, 0.3, 0.04);
  assert.equal(itmCall.price, 10);
  assert.equal(otmCall.price, 0);
  assert.equal(itmPut.price, 10);
});

test('bs() gamma is positive and symmetric for calls and puts at the same strike', () => {
  const { SB } = loadSB();
  const call = SB.bs('call', 100, 100, 0.5, 0.25, 0.04);
  const put = SB.bs('put', 100, 100, 0.5, 0.25, 0.04);
  assert.ok(call.gamma > 0);
  assert.ok(Math.abs(call.gamma - put.gamma) < 1e-9, 'gamma is identical for calls/puts at the same strike (put-call parity)');
});

test('solveIV() round-trips: pricing at a known IV and solving recovers it', () => {
  const { SB } = loadSB();
  const S = 150, K = 155, T = 30 / 365, r = 0.04, trueSigma = 0.42;
  const price = SB.bs('call', S, K, T, trueSigma, r).price;
  const solved = SB.solveIV('call', S, K, T, price, r);
  assert.ok(solved !== null);
  assert.ok(Math.abs(solved - trueSigma) < 0.001, `solved IV ${solved} should be ~${trueSigma}`);
});

test('solveIV() returns null when the price is at or below intrinsic value', () => {
  const { SB } = loadSB();
  // a deep ITM call priced at exactly intrinsic value implies zero time value -> no valid IV
  const S = 150, K = 100, T = 30 / 365, r = 0.04;
  const intrinsic = S - K * Math.exp(-r * T);
  assert.equal(SB.solveIV('call', S, K, T, intrinsic, r), null);
});

test('roundStrike() snaps to sensible increments by price tier', () => {
  const { SB } = loadSB();
  assert.equal(SB.roundStrike(10.3, 15), 10.5);   // S < 20 -> $0.50 increments
  assert.equal(SB.roundStrike(51.4, 50), 51);      // S < 100 -> $1 increments
  assert.equal(SB.roundStrike(151, 150), 150);     // S < 250 -> $2.50 increments
  assert.equal(SB.roundStrike(301, 300), 300);     // S >= 250 -> $5 increments
});

test('findStrikeByDelta() finds a call strike whose delta matches the target', () => {
  const { SB } = loadSB();
  const S = 100, T = 45 / 365, r = 0.04, sigma = 0.30;
  const strike = SB.findStrikeByDelta('call', 0.30, S, T, r, sigma);
  const actualDelta = SB.bs('call', S, strike, T, sigma, r).delta;
  assert.ok(Math.abs(actualDelta - 0.30) < 0.03, `actual delta ${actualDelta} should be close to 0.30`);
  assert.ok(strike > S, 'a 30-delta call strike should be out of the money (above spot)');
});

test('findStrikeByDelta() finds a put strike whose delta matches the (negative) target', () => {
  const { SB } = loadSB();
  const S = 100, T = 45 / 365, r = 0.04, sigma = 0.30;
  const strike = SB.findStrikeByDelta('put', -0.30, S, T, r, sigma);
  const actualDelta = SB.bs('put', S, strike, T, sigma, r).delta;
  assert.ok(Math.abs(actualDelta - -0.30) < 0.03, `actual delta ${actualDelta} should be close to -0.30`);
  assert.ok(strike < S, 'a 30-delta put strike should be out of the money (below spot)');
});
