(function () {
  var nodes = document.querySelectorAll("[data-animista]");
  if (!nodes.length) return;

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function play(el) {
    var name = el.dataset.animista;
    if (!name) return;
    el.classList.add(name);
    if (el.dataset.animistaDelay !== undefined) {
      el.style.animationDelay = el.dataset.animistaDelay;
    }
    if (el.dataset.animistaDuration !== undefined) {
      el.style.animationDuration = el.dataset.animistaDuration;
    }
  }

  if (reduceMotion || !("IntersectionObserver" in window)) {
    nodes.forEach(play);
    return;
  }

  var observeTargets = new Map();

  function registerObserveTarget(target, el) {
    if (!observeTargets.has(target)) {
      observeTargets.set(target, []);
    }
    observeTargets.get(target).push(el);
  }

  nodes.forEach(function (el) {
    if (el.dataset.animistaOn === "load") {
      play(el);
      return;
    }

    var target = el;
    if (el.dataset.animistaObserve === "parent" && el.parentElement) {
      target = el.parentElement;
    }

    registerObserveTarget(target, el);
  });

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;

        var list = observeTargets.get(entry.target);
        if (!list) return;

        list.forEach(play);
        observeTargets.delete(entry.target);
        io.unobserve(entry.target);
      });
    },
    { threshold: 0.2, rootMargin: "0px 0px -5% 0px" }
  );

  observeTargets.forEach(function (_list, target) {
    io.observe(target);
  });
})();
