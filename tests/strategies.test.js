'use strict';
// Data-integrity checks for the strategy library — catches typos/missing
// fields the moment a strategy is added or edited, rather than at render time.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSB } = require('./helpers/load-shared');

test('STRATS: every id is unique', () => {
  const { SB } = loadSB();
  const ids = SB.STRATS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate strategy id found');
});

test('STRATS: every entry has the fields the UI and wizard both depend on', () => {
  const { SB } = loadSB();
  for (const s of SB.STRATS) {
    assert.ok(s.id && typeof s.id === 'string', `${s.name}: missing id`);
    assert.ok(s.name && typeof s.name === 'string', `${s.id}: missing name`);
    assert.ok(s.cat in SB.CATS, `${s.id}: category "${s.cat}" is not in CATS`);
    assert.ok(['buy', 'sell', 'either'].includes(s.ivEnv), `${s.id}: ivEnv "${s.ivEnv}" is not a recognized value`);
    assert.ok(Array.isArray(s.legs) && s.legs.length > 0, `${s.id}: legs must be a non-empty array`);
    assert.ok(typeof s.tip === 'string' && s.tip.length > 0, `${s.id}: missing tip`);
    assert.ok(typeof s.watch === 'string' && s.watch.length > 0, `${s.id}: missing watch`);
  }
});

test('STRATS: every leg tuple has a valid side/type and a numeric offset', () => {
  const { SB } = loadSB();
  for (const s of SB.STRATS) {
    for (const [side, type, pct, ratio] of s.legs) {
      assert.ok(['long', 'short'].includes(side), `${s.id}: invalid leg side "${side}"`);
      assert.ok(['call', 'put', 'stock'].includes(type), `${s.id}: invalid leg type "${type}"`);
      assert.equal(typeof pct, 'number', `${s.id}: leg offset must be numeric`);
      if (ratio !== undefined) assert.ok(ratio >= 1, `${s.id}: leg ratio must be >= 1 when present`);
    }
  }
});

test('stratById(): resolves every id declared in STRATS, and nothing else', () => {
  const { SB } = loadSB();
  for (const s of SB.STRATS) assert.equal(SB.stratById(s.id), s);
  assert.equal(SB.stratById('does_not_exist'), undefined);
});

test('INTENTS: every filter is satisfied by at least one real strategy (an intent with zero matches is a dead filter)', () => {
  const { SB } = loadSB();
  for (const intent of SB.INTENTS) {
    const matches = SB.STRATS.filter(intent.f);
    assert.ok(matches.length > 0, `intent "${intent.id}" matches no strategies`);
  }
});

test('EXIT_REASONS: is a non-empty list of distinct strings', () => {
  const { SB } = loadSB();
  assert.ok(SB.EXIT_REASONS.length > 0);
  assert.equal(new Set(SB.EXIT_REASONS).size, SB.EXIT_REASONS.length);
});
