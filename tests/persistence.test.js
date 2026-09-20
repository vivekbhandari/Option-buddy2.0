'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSB } = require('./helpers/load-shared');

test('mintId(): generates unique, non-empty ids', () => {
  const { SB } = loadSB();
  const ids = new Set(Array.from({ length: 200 }, () => SB.mintId()));
  assert.equal(ids.size, 200, 'no collisions across 200 generated ids');
  for (const id of ids) assert.ok(id.length > 0);
});

test('blankTrade(): has every field the app reads, and starts with no positions', () => {
  const { SB } = loadSB();
  const t = SB.blankTrade('AAPL');
  assert.equal(t.ticker, 'AAPL');
  assert.deepEqual(t.positions, []);
  for (const field of ['id', 'createdAt', 'updatedAt', 'mult', 'iv', 'dte', 'ivr', 'rate']) {
    assert.ok(field in t, `blankTrade() result is missing "${field}"`);
  }
});

test('migrateTrade(): backfills missing fields on an old-shaped trade without touching existing ones', () => {
  const { SB } = loadSB();
  const old = { ticker: 'MSFT', positions: [{ legs: [] }] };
  const migrated = SB.migrateTrade(old);
  assert.equal(migrated.ticker, 'MSFT', 'preserves existing fields');
  assert.equal(migrated.rate, 4, 'backfills the risk-free rate added later');
  assert.equal(migrated.iv, 30);
  assert.ok(migrated.id, 'backfills a missing id');
  assert.equal(migrated.positions[0].status, 'idea', 'backfills position lifecycle status');
  assert.deepEqual(migrated.positions[0].events, []);
});

test('migrateTrade(): does not overwrite a rate that is already set (including falsy 0)', () => {
  const { SB } = loadSB();
  const t = SB.migrateTrade({ ticker: 'X', rate: 0, positions: [] });
  assert.equal(t.rate, 0, 'an explicit 0% rate must survive migration, not be treated as missing');
});

test('example(): produces a self-consistent starter trade', () => {
  const { SB } = loadSB();
  const ex = SB.example();
  assert.equal(ex.positions.length, 2);
  assert.ok(ex.positions.every(p => Array.isArray(p.legs) && p.legs.length > 0));
});

test('loadStore()/persistStore(): round-trips through localStorage', () => {
  const { SB } = loadSB();
  const store = { trades: [SB.blankTrade('TSLA')], active: 0 };
  SB.persistStore(store);
  const reloaded = SB.loadStore();
  assert.equal(reloaded.trades.length, 1);
  assert.equal(reloaded.trades[0].ticker, 'TSLA');
});

test('loadStore(): falls back to a fresh example trade when storage is empty', () => {
  const { SB } = loadSB();
  const store = SB.loadStore();
  assert.equal(store.trades.length, 1);
  assert.equal(store.active, 0);
});

test('loadStore(): clamps a stale "active" index into range if trades were removed elsewhere', () => {
  const { SB, localStorage } = loadSB();
  localStorage.setItem(SB.STORE_KEY, JSON.stringify({ trades: [SB.blankTrade('A')], active: 5 }));
  const store = SB.loadStore();
  assert.equal(store.active, 0);
});

test('allPositions(): flattens positions across every trade, keeping a reference back to its trade', () => {
  const { SB } = loadSB();
  const t1 = SB.blankTrade('A'); t1.positions.push({ id: 'p1', legs: [] });
  const t2 = SB.blankTrade('B'); t2.positions.push({ id: 'p2', legs: [] }, { id: 'p3', legs: [] });
  const flat = SB.allPositions({ trades: [t1, t2] });
  assert.equal(flat.length, 3);
  assert.equal(flat[0].t.ticker, 'A');
  assert.equal(flat[2].t.ticker, 'B');
});

test('mergeTrades(): a trade only present locally or only in the cloud is kept as-is', () => {
  const { SB } = loadSB();
  const local = [{ id: 'a', ticker: 'AAPL', updatedAt: 100 }];
  const cloud = [{ id: 'b', ticker: 'MSFT', updatedAt: 200 }];
  const merged = SB.mergeTrades(local, cloud);
  assert.equal(merged.length, 2);
  assert.ok(merged.some(t => t.id === 'a' && t.ticker === 'AAPL'));
  assert.ok(merged.some(t => t.id === 'b' && t.ticker === 'MSFT'));
});

test('mergeTrades(): same id on both sides -> the newer updatedAt wins, whichever side it is', () => {
  const { SB } = loadSB();
  const newerLocal = SB.mergeTrades(
    [{ id: 'x', note: 'local-newer', updatedAt: 200 }],
    [{ id: 'x', note: 'cloud-older', updatedAt: 100 }]
  );
  assert.equal(newerLocal[0].note, 'local-newer');

  const newerCloud = SB.mergeTrades(
    [{ id: 'x', note: 'local-older', updatedAt: 100 }],
    [{ id: 'x', note: 'cloud-newer', updatedAt: 200 }]
  );
  assert.equal(newerCloud[0].note, 'cloud-newer');
});

test('mergeTrades(): handles empty/missing inputs without throwing', () => {
  const { SB } = loadSB();
  assert.deepEqual(SB.mergeTrades([], []), []);
  assert.deepEqual(SB.mergeTrades(undefined, undefined), []);
  assert.equal(SB.mergeTrades([{ id: 'a', updatedAt: 1 }], undefined).length, 1);
});
