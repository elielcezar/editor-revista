/**
 * consumidor.html — bloco roxo sobe sobre prato.png no scroll.
 * Um único container (.consumidor-roxo-stack) mantém faixa, textos e círculo alinhados.
 * O scroll para com o footer encostado no rodapé da tela (sem cortar).
 */
(function () {
  "use strict";

  var foodEl    = document.querySelector(".subtract-image-wrap");
  var stackEl   = document.getElementById("consumidor-roxo-stack");
  var pageEl    = document.querySelector(".page");
  var footerEl  = stackEl && stackEl.querySelector(".footer");
  if (!foodEl || !stackEl || !pageEl || !footerEl) return;

  var slideUp       = -350;
  var startScroll   = 0;
  var endScroll     = 1;
  var ticking       = false;
  var maxScrollY    = 0;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Recua o corte: rola um pouco mais para o footer subir e não ser cortado */
  var SCROLL_NUDGE = 1;

  function clamp(val, lo, hi) { return Math.max(lo, Math.min(hi, val)); }
  function mix(from, to, t)   { return from + (to - from) * clamp(t, 0, 1); }

  function viewportHeight() {
    return window.innerHeight || document.documentElement.clientHeight || 800;
  }

  function recalcRange() {
    var foodTop  = foodEl.offsetTop;
    var foodH    = foodEl.offsetHeight || 421;
    var vh       = viewportHeight();
    var stackTop = stackEl.offsetTop;
    var gap      = Math.max(0, stackTop - foodTop);

    slideUp = -(gap + foodH * 0.55);

    startScroll = foodTop - vh * 0.95;
    endScroll   = foodTop + foodH * 0.2;
    if (endScroll <= startScroll) endScroll = startScroll + 700;
  }

  function progressAt(scrollY) {
    var range = endScroll - startScroll;
    if (range <= 0) return 1;
    return clamp((scrollY - startScroll) / range, 0, 1);
  }

  function transformAt(scrollY) {
    if (reducedMotion) return -150;
    return mix(0, slideUp, progressAt(scrollY));
  }

  function applyStackAtScroll(scrollY) {
    if (reducedMotion) {
      stackEl.style.transform = "translate3d(0,-150px,0)";
      return;
    }
    stackEl.style.transform =
      "translate3d(0," + transformAt(scrollY).toFixed(2) + "px,0)";
  }

  /*
   * Mede no DOM (como na v13 que estava quase certa):
   * maior scroll em que footer.bottom >= vh, depois recua SCROLL_NUDGE px
   * para o footer não cortar.
   */
  function calcMaxScroll() {
    var vh     = viewportHeight();
    var savedY = window.scrollY;
    var lo     = Math.max(0, Math.floor(startScroll));
    var hi     = Math.floor(footerDocBottom());

    for (var i = 0; i < 24; i++) {
      var mid = (lo + hi + 1) >> 1;
      window.scrollTo(0, mid);
      applyStackAtScroll(mid);
      if (footerEl.getBoundingClientRect().bottom >= vh) lo = mid;
      else hi = mid - 1;
    }

    window.scrollTo(0, savedY);
    applyStackAtScroll(savedY);

    return lo + SCROLL_NUDGE;
  }

  function footerDocBottom() {
    return stackEl.offsetTop + footerEl.offsetTop + footerEl.offsetHeight;
  }

  function clampScroll() {
    if (maxScrollY > 0 && window.scrollY > maxScrollY) {
      window.scrollTo(0, maxScrollY);
    }
  }

  function updateTransform() {
    applyStackAtScroll(window.scrollY);
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateTransform();
      clampScroll();
      ticking = false;
    });
  }

  function refresh() {
    recalcRange();
    maxScrollY = calcMaxScroll();
    updateTransform();
    clampScroll();
  }

  function init() {
    requestAnimationFrame(function () {
      requestAnimationFrame(refresh);
    });
  }

  init();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", refresh);
  window.addEventListener("load", refresh);
})();
