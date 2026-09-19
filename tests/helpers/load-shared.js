'use strict';
// Loads js/shared.js in plain Node by stubbing the handful of browser globals
// it touches (window, localStorage, fetch). shared.js attaches itself to
// window.SB, so each call returns a fresh copy — tests that mutate localStorage
// get a clean in-memory store per call instead of leaking state between tests.
const fs = require('fs');
const path = require('path');

const SHARED_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'shared.js'), 'utf8');

// Run shared.js in THIS realm (via `new Function`, not vm.createContext) so arrays/objects
// it returns share the same Array/Object prototypes as the test files — vm.createContext
// creates a separate V8 realm, which makes assert.deepStrictEqual fail on otherwise-identical
// arrays because their prototypes are different objects across realms.
const runShared = new Function(
  'window', 'localStorage', 'fetch', 'document', 'URL', 'AbortController', 'setTimeout', 'clearTimeout',
  SHARED_SRC + '\n;return window.SB;'
);

function makeLocalStorage() {
  let data = Object.create(null);
  return {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    removeItem: (k) => { delete data[k]; },
    clear: () => { data = Object.create(null); },
  };
}

function loadSB(overrides) {
  const localStorage = makeLocalStorage();
  const fetchStub = (overrides && overrides.fetch) || (() => Promise.reject(new Error('fetch not stubbed in this test')));
  const documentStub = { createElement: () => ({ style: {}, click() {}, remove() {} }), body: { appendChild() {}, removeChild() {} } };
  const urlStub = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };
  const window = {};
  runShared(window, localStorage, fetchStub, documentStub, urlStub, AbortController, setTimeout, clearTimeout);
  return { SB: window.SB, localStorage };
}

module.exports = { loadSB };
