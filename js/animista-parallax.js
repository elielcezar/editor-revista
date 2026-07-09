(function () {
  var wraps = document.querySelectorAll("[data-parallax]");
  if (!wraps.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var items = [];

  wraps.forEach(function (wrap) {
    var img = wrap.querySelector("img");
    if (!img) return;
    var minAttr = wrap.dataset.parallaxMin;
    items.push({
      wrap: wrap,
      img: img,
      factor: parseFloat(wrap.dataset.parallaxFactor || "0.45"),
      max: parseFloat(wrap.dataset.parallaxMax || "90"),
      min: minAttr === undefined ? null : parseFloat(minAttr),
    });
  });

  if (!items.length) return;

  function update() {
    var vh = window.innerHeight;
    var viewCenter = vh * 0.5;

    items.forEach(function (item) {
      var rect = item.wrap.getBoundingClientRect();
      if (rect.bottom < -50 || rect.top > vh + 50) return;

      var shift = (viewCenter - (rect.top + rect.height * 0.5)) * item.factor;
      if (shift > item.max) shift = item.max;
      if (item.min !== null && !isNaN(item.min)) {
        if (shift < item.min) shift = item.min;
      } else if (shift < -item.max) {
        shift = -item.max;
      }

      item.img.style.transform =
        "translate3d(0," + shift.toFixed(2) + "px,0)";
    });
  }

  var ticking = false;

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      update();
      ticking = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", update);
  update();
})();
