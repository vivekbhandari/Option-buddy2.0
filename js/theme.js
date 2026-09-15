/*
 * Theme toggle — System -> Light -> Dark -> System, persisted in localStorage.
 * Standalone (no dependency on shared.js) so every page, including the
 * static Learn page, can use it with one script tag.
 */
(function () {
  'use strict';
  const KEY = 'ob-theme';
  const ORDER = ['system', 'light', 'dark'];
  const LABEL = { system: '🖥 Auto', light: '☀ Light', dark: '🌙 Dark' };

  function getTheme() { try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; } }
  function applyTheme(t) {
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  function setTheme(t) {
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch (e) { /* ignore */ }
    applyTheme(t);
  }

  applyTheme(getTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    btn.textContent = LABEL[getTheme()];
    btn.addEventListener('click', () => {
      const next = ORDER[(ORDER.indexOf(getTheme()) + 1) % ORDER.length];
      setTheme(next);
      btn.textContent = LABEL[next];
    });
  });
})();
