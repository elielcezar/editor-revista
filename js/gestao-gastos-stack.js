/**
 * gestao.html — stack de cards do bloco laranja
 * (CUSTOS DIRETOS, DESPESAS OPERACIONAIS, INVESTIMENTO)
 */
(function () {
  "use strict";

  var section = document.getElementById("gestao-gastos-stack");
  var cardCustos = document.querySelector(".gestao-gastos-card--custos");
  var cardDespesas = document.querySelector(".gestao-gastos-card--despesas");
  var cardInvestimento = document.querySelector(".gestao-gastos-card--investimento");
  if (!section || !cardCustos || !cardDespesas || !cardInvestimento) return;

  var innerCustos = cardCustos.querySelector(".gestao-gastos-card__inner");
  var innerDespesas = cardDespesas.querySelector(".gestao-gastos-card__inner");
  if (!innerCustos || !innerDespesas) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var startScroll = 0;
  var endScroll = 1;
  var ticking = false;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function mix(from, to, progress) {
    return from + (to - from) * clamp(progress, 0, 1);
  }

  function remap(value, start, end) {
    if (end <= start) return value >= end ? 1 : 0;
    return clamp((value - start) / (end - start), 0, 1);
  }

  function recalcRange() {
    var sectionTop = section.getBoundingClientRect().top + window.scrollY;
    var sectionHeight = section.offsetHeight || 680;
    var vh = window.innerHeight || 800;

    startScroll = sectionTop - vh * 0.42;
    endScroll = sectionTop + sectionHeight * 0.56;
    if (endScroll <= startScroll) {
      endScroll = startScroll + 420;
    }
  }

  function getProgress() {
    var range = endScroll - startScroll;
    if (range <= 0) return 0;
    return clamp((window.scrollY - startScroll) / range, 0, 1);
  }

  function updateCards() {
    var progress = getProgress();
    var phase2 = remap(progress, 0.22, 1);

    innerCustos.style.transform =
      "translate3d(0," + mix(0, -28, progress).toFixed(2) + "px,0) scale(" + mix(1, 0.9, progress).toFixed(4) + ")";
    innerCustos.style.filter =
      "brightness(" + mix(1, 0.66, progress).toFixed(4) + ")";

    cardDespesas.style.transform =
      "translate3d(0," + mix(0, -170, progress).toFixed(2) + "px,0)";
    innerDespesas.style.transform =
      "translate3d(0," + mix(0, -28, phase2).toFixed(2) + "px,0) scale(" + mix(1, 0.92, phase2).toFixed(4) + ")";
    innerDespesas.style.filter =
      "brightness(" + mix(1, 0.72, phase2).toFixed(4) + ")";

    cardInvestimento.style.transform =
      "translate3d(0," + mix(0, -340, phase2).toFixed(2) + "px,0)";
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
