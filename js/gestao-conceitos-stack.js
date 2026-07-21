/**
 * gestao.html — blocos FATURAMENTO / LUCRO empilham no scroll.
 * Cards com position: sticky (CSS) + escala/opacidade/brilho calculados a
 * partir da sobreposição real entre cards (getBoundingClientRect), em vez de
 * uma janela de scroll estimada manualmente.
 * Baseado no protótipo _components/cards-conceito (ref.: https://codepen.io/tahazsh/pen/WNYKage).
 */
(function () {
  "use strict";

  var cards = Array.prototype.slice.call(
    document.querySelectorAll("#gestao-conceitos-cards .gestao-conceitos-card")
  );
  if (cards.length < 2) return;

  var inners = cards.map(function (card) {
    return card.querySelector(".gestao-conceitos-card__inner");
  });
  if (inners.indexOf(null) !== -1) return;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var MAX_SCALE_DROP = 0.06;
  var MAX_OPACITY_DROP = 0.35;
  var MAX_BRIGHTNESS_DROP = 0.42;
  var ticking = false;

  function updateCards() {
    var lastIndex = cards.length - 1;
    for (var i = 0; i < cards.length; i++) {
      var inner = inners[i];

      if (i === lastIndex) {
        inner.style.transform = "";
        inner.style.opacity = "";
        inner.style.filter = "";
        continue;
      }

      var rect = cards[i].getBoundingClientRect();
      var nextRect = cards[i + 1].getBoundingClientRect();
      var overlap = rect.bottom - nextRect.top;
      var progress = Math.max(0, Math.min(1, overlap / rect.height));

      inner.style.transform = "scale(" + (1 - progress * MAX_SCALE_DROP).toFixed(4) + ")";
      inner.style.opacity = (1 - progress * MAX_OPACITY_DROP).toFixed(3);
      inner.style.filter = "brightness(" + (1 - progress * MAX_BRIGHTNESS_DROP).toFixed(3) + ")";
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      updateCards();
      ticking = false;
    });
  }

  updateCards();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  window.addEventListener("load", updateCards);
})();
