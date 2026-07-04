/**
 * gestao.html — blocos FATURAMENTO / LUCRO empilham no scroll
 * Ref.: https://codepen.io/tahazsh/pen/WNYKage
 */
(function () {
  "use strict";

  var section = document.getElementById("gestao-conceitos");
  var cardIntro = document.querySelector(".gestao-conceitos-card--intro");
  var cardFaturamento = document.querySelector(".gestao-conceitos-card--faturamento");
  var cardLucro = document.querySelector(".gestao-conceitos-card--lucro");
  if (!section || !cardIntro || !cardFaturamento || !cardLucro) return;

  var innerIntro = cardIntro.querySelector(".gestao-conceitos-card__inner");
  var innerFaturamento = cardFaturamento.querySelector(".gestao-conceitos-card__inner");
  if (!innerIntro || !innerFaturamento) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var INTRO_TRANSLATE_END = -18;
  var INTRO_SCALE_END = 0.92;
  var INTRO_BRIGHTNESS_END = 0.58;
  var FATURAMENTO_TRANSLATE_END = -22;
  var FATURAMENTO_SCALE_END = 0.9;
  var FATURAMENTO_BRIGHTNESS_END = 0.66;
  var LUCRO_TRANSLATE_END = -150;
  var startScroll = 0;
  var endScroll = 1;
  var ticking = false;

  function mix(from, to, percentage) {
    var p = Math.max(0, Math.min(1, percentage));
    return from + (to - from) * p;
  }

  function remapProgress(value, start, end) {
    if (end <= start) return value >= end ? 1 : 0;
    return Math.max(0, Math.min(1, (value - start) / (end - start)));
  }

  function recalcRange() {
    var sectionTop = section.getBoundingClientRect().top + window.scrollY;
    var sectionHeight = section.offsetHeight || 420;
    var vh = window.innerHeight || 800;

    // Janela estável para diferentes telas:
    // começa antes do centro da seção e termina quando o bloco principal já passou.
    startScroll = sectionTop - vh * 0.35;
    endScroll = sectionTop + sectionHeight * 0.55;

    if (endScroll <= startScroll) {
      endScroll = startScroll + 320;
    }
  }

  function getProgress() {
    var range = endScroll - startScroll;
    if (range <= 0) return 0;
    return Math.max(0, Math.min(1, (window.scrollY - startScroll) / range));
  }

  function updateCards() {
    var progress = getProgress();
    // Mantem mais tempo de leitura no bloco 2 (FATURAMENTO):
    // o bloco 3 (LUCRO) acelera um pouco antes, para reduzir o atraso percebido.
    var lucroProgress = remapProgress(progress, 0.30, 1);

    innerIntro.style.transform =
      "translate3d(0," +
      mix(0, INTRO_TRANSLATE_END, progress).toFixed(2) +
      "px,0) scale(" +
      mix(1, INTRO_SCALE_END, progress).toFixed(4) +
      ")";
    innerIntro.style.filter =
      "brightness(" + mix(1, INTRO_BRIGHTNESS_END, progress).toFixed(4) + ")";

    innerFaturamento.style.transform =
      "translate3d(0," +
      mix(0, FATURAMENTO_TRANSLATE_END, progress).toFixed(2) +
      "px,0) scale(" +
      mix(1, FATURAMENTO_SCALE_END, progress).toFixed(4) +
      ")";
    innerFaturamento.style.filter =
      "brightness(" + mix(1, FATURAMENTO_BRIGHTNESS_END, progress).toFixed(4) + ")";

    cardLucro.style.transform =
      "translate3d(0," + mix(0, LUCRO_TRANSLATE_END, lucroProgress).toFixed(2) + "px,0)";
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateCards();
      ticking = false;
    });
  }

  recalcRange();
  updateCards();

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", function () {
    recalcRange();
    updateCards();
  });
  window.addEventListener("load", function () {
    recalcRange();
    updateCards();
  });
})();
