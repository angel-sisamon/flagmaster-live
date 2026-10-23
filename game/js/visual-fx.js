/**
 * js/visual-fx.js
 *
 * Efectos puramente decorativos (sin lógica de juego):
 *  - Banderas flotando en el fondo de la home (#float-flags).
 * Solo lee COUNTRIES (countries-data.js). Las animaciones se pausan por CSS
 * cuando la home no está activa (ver css/theme.css).
 */
(function () {
  'use strict';

  function rand(min, max) { return min + Math.random() * (max - min); }

  function buildFloatFlags() {
    var host = document.getElementById('float-flags');
    if (!host || host.childElementCount) return;
    if (typeof COUNTRIES === 'undefined' || !COUNTRIES.length) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var count = window.innerWidth < 400 ? 11 : 18;
    var frag = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var c = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
      var el = document.createElement('span');
      el.className = 'float-flag';
      el.textContent = c.flag;
      el.style.left = rand(0, 96).toFixed(1) + '%';
      el.style.fontSize = rand(1.6, 3.8).toFixed(2) + 'rem';
      el.style.animationDuration = rand(10, 20).toFixed(1) + 's';
      el.style.animationDelay = (-rand(0, 20)).toFixed(1) + 's';
      frag.appendChild(el);
    }
    host.appendChild(frag);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildFloatFlags);
  } else {
    buildFloatFlags();
  }
})();
