/**
 * consumidor.html — lista "Adaptação na prática" empilha no scroll.
 * Dois cards: card-1 (circulo-roxo) sobe/escurece, card-2 (prato) sobe por baixo.
 */
(function () {
  "use strict";

  var section = document.getElementById("consumidor-lista-stack");
  var card1   = document.querySelector(".consumidor-lista-card--1");
  var card2   = document.querySelector(".consumidor-lista-card--2");
  if (!section || !card1 || !card2) return;

  var inner1 = card1.querySelector(".consumidor-lista-card__inner");
  if (!inner1) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var startScroll = 0;
  var endScroll   = 1;
  var ticking     = false;

  function clamp(val, lo, hi) { return Math.max(lo, Math.min(hi, val)); }
  function mix(from, to, t)   { return from + (to - from) * clamp(t, 0, 1); }
  function remap(val, s, e) {
    if (e <= s) return val >= e ? 1 : 0;
    return clamp((val - s) / (e - s), 0, 1);
  }

  function recalcRange() {
    var top = section.getBoundingClientRect().top + window.scrollY;
    var h   = section.offsetHeight || 520;
    var vh  = window.innerHeight || 800;
    startScroll = top - vh * 0.24;
    endScroll   = top + h * 0.56;
    if (endScroll <= startScroll) endScroll = startScroll + 400;
  }

  function getProgress() {
    var range = endScroll - startScroll;
    if (range <= 0) return 0;
    return clamp((window.scrollY - startScroll) / range, 0, 1);
  }

  function updateCards() {
    var p  = getProgress();
    var p2 = remap(p, 0.28, 1);

    inner1.style.transform =
      "translate3d(0," + mix(0, -10, p).toFixed(2) + "px,0) scale(" +
      mix(1, 0.92, p).toFixed(4) + ")";
    inner1.style.filter = "brightness(" + mix(1, 0.66, p).toFixed(4) + ")";

    card2.style.transform =
      "translate3d(0," + mix(0, -130, p2).toFixed(2) + "px,0)";
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { updateCards(); ticking = false; });
  }

  recalcRange();
  updateCards();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () { recalcRange(); updateCards(); });
  window.addEventListener("load",   function () { recalcRange(); updateCards(); });
})();
