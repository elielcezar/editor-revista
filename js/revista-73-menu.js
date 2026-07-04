/**
 * Menu padronizado #73 — centraliza ítem ativo (horizontal + sidebar desktop),
 * arrastar com mouse/dedo, rolagem vertical do wheel vira scroll horizontal no nav.
 * Mobile (<402px): escala o frame 402px para caber na tela (transform via JS).
 */
(function () {
  "use strict";

  var REV_FRAME_W = 402;

  function getOrCreateScaleWrap(main) {
    var parent = main.parentElement;
    if (parent && parent.classList.contains("rev-scale-wrap")) return parent;
    var wrap = document.createElement("div");
    wrap.className = "rev-scale-wrap";
    main.parentNode.insertBefore(wrap, main);
    wrap.appendChild(main);
    return wrap;
  }

  function removeScaleWrap(main) {
    var parent = main.parentElement;
    if (!parent || !parent.classList.contains("rev-scale-wrap")) return;
    parent.parentNode.insertBefore(main, parent);
    parent.remove();
  }

  function applyMobileScale() {
    var main = document.querySelector("body > main") ||
      document.querySelector("body > .rev-scale-wrap > main");
    if (!main) return;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    if (vw >= REV_FRAME_W) {
      main.classList.remove("rev-mobile-scaled");
      main.style.transform = "";
      main.style.marginBottom = "";
      main.style.minHeight = "";
      document.body.style.minHeight = "";
      removeScaleWrap(main);
      return;
    }
    var wrap = getOrCreateScaleWrap(main);
    var scale = vw / REV_FRAME_W;
    document.body.style.minHeight = "auto";
    main.style.minHeight = "auto";
    main.style.marginBottom = "0";
    main.style.transform = "scale(" + scale + ")";
    main.style.transformOrigin = "top left";
    main.classList.add("rev-mobile-scaled");

    var naturalH = main.offsetHeight;
    var minLayoutH = vh / scale;
    if (naturalH < minLayoutH) {
      main.style.minHeight = minLayoutH + "px";
    }

    var h = main.offsetHeight;
    var scaledH = h * scale;

    /* Garante que o footer não seja cortado: após o scale já aplicado,
       getBoundingClientRect retorna as posições visuais reais.
       Usa Math.max com 20px de margem para cobrir arredondamentos e
       variações entre navegadores. */
    var footEls = main.querySelectorAll('[class*="foot"], footer, .sec-foot');
    var scrollY = window.scrollY || 0;
    for (var i = 0; i < footEls.length; i++) {
      var rect = footEls[i].getBoundingClientRect();
      var elBottom = rect.bottom + scrollY;
      scaledH = Math.max(scaledH, elBottom + 20);
    }

    wrap.style.width = vw + "px";
    wrap.style.height = scaledH + "px";
    wrap.style.overflow = "hidden";
  }

  function scheduleMobileScale() {
    requestAnimationFrame(function () {
      applyMobileScale();
      requestAnimationFrame(applyMobileScale);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleMobileScale);
  } else {
    scheduleMobileScale();
  }

  window.addEventListener("load", function () {
    scheduleMobileScale();
    /* Re-executa após 600ms para capturar shifts de fontes/imagens */
    setTimeout(scheduleMobileScale, 600);
  });
  window.addEventListener("resize", scheduleMobileScale);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", scheduleMobileScale);
  }

  var nav = document.getElementById("menu-principal");

  function centerInScrollContainer(container, item, axis) {
    if (!container || !item) return;
    var isX = axis === "x";
    var maxScroll = Math.max(
      0,
      (isX ? container.scrollWidth : container.scrollHeight) -
        (isX ? container.clientWidth : container.clientHeight)
    );
    if (maxScroll <= 0) {
      if (isX) container.scrollLeft = 0;
      else container.scrollTop = 0;
      return;
    }

    var containerRect = container.getBoundingClientRect();
    var itemRect = item.getBoundingClientRect();
    var delta = isX
      ? itemRect.left +
        itemRect.width / 2 -
        (containerRect.left + containerRect.width / 2)
      : itemRect.top +
        itemRect.height / 2 -
        (containerRect.top + containerRect.height / 2);
    var next = (isX ? container.scrollLeft : container.scrollTop) + delta;

    if (isX) container.scrollLeft = Math.max(0, Math.min(next, maxScroll));
    else container.scrollTop = Math.max(0, Math.min(next, maxScroll));
  }

  function centerHeadMenu() {
    if (!nav || nav.tagName !== "NAV") return;
    if (getComputedStyle(nav).display === "none") return;
    var item = nav.querySelector("a.is-active");
    if (!item) return;
    centerInScrollContainer(nav, item, "x");
  }

  function centerSidebarMenu() {
    var sidebar = document.querySelector(".dt-sidebar");
    if (!sidebar || getComputedStyle(sidebar).display === "none") return;
    var nav = sidebar.querySelector(".dt-nav");
    if (!nav) return;

    sidebar.scrollTop = 0;

    var items = nav.querySelectorAll(".dt-nav-item");
    if (!items.length) return;

    var activeIndex = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].classList.contains("is-active")) {
        activeIndex = i;
        break;
      }
    }
    if (activeIndex < 0) return;

    var anchor = items[Math.max(0, activeIndex - 2)];
    centerInScrollContainer(nav, anchor, "y");
  }

  function centerActiveMenus() {
    requestAnimationFrame(function () {
      centerHeadMenu();
      centerSidebarMenu();
      requestAnimationFrame(function () {
        centerHeadMenu();
        centerSidebarMenu();
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", centerActiveMenus);
  } else {
    centerActiveMenus();
  }

  window.addEventListener("load", centerActiveMenus);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(centerActiveMenus).catch(function () {});
  }

  if (!nav || nav.tagName !== "NAV") return;

  var capId = null;
  var startX = 0;
  var scroll0 = 0;
  var dragMoved = false;
  var suppressClick = false;
  var dragging = false;

  nav.addEventListener(
    "pointerdown",
    function (e) {
      if (e.pointerType === "mouse") return;
      dragging = true;
      capId = e.pointerId;
      startX = e.clientX;
      scroll0 = nav.scrollLeft;
      dragMoved = false;
      nav.classList.add("is-dragging");
      try {
        nav.setPointerCapture(e.pointerId);
      } catch (err) {}
    },
    { passive: true }
  );

  nav.addEventListener(
    "pointermove",
    function (e) {
      if (!dragging || e.pointerType === "mouse" || e.pointerId !== capId) return;
      var dx = e.clientX - startX;
      if (Math.abs(dx) > 10) dragMoved = true;
      nav.scrollLeft = scroll0 - dx;
    },
    { passive: true }
  );

  function endPointer(e) {
    if (!dragging || (e && e.pointerId !== capId)) return;
    dragging = false;
    capId = null;
    nav.classList.remove("is-dragging");
    if (dragMoved && Math.abs(nav.scrollLeft - scroll0) > 6)
      suppressClick = true;
    dragMoved = false;
    try {
      if (e) nav.releasePointerCapture(e.pointerId);
    } catch (err) {}
  }

  nav.addEventListener("pointerup", endPointer);
  nav.addEventListener("pointercancel", endPointer);

  nav.addEventListener(
    "click",
    function (e) {
      if (!suppressClick) return;
      suppressClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );

  nav.addEventListener(
    "wheel",
    function (e) {
      var delta =
        Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 0.5) return;
      var maxScroll = nav.scrollWidth - nav.clientWidth;
      if (maxScroll <= 0) return;
      var next =
        delta > 0
          ? Math.min(nav.scrollLeft + delta, maxScroll)
          : Math.max(nav.scrollLeft + delta, 0);
      if (
        ((delta > 0 && nav.scrollLeft >= maxScroll - 0.5) ||
          (delta < 0 && nav.scrollLeft <= 0)) &&
        next === nav.scrollLeft
      ) {
        return;
      }
      e.preventDefault();
      nav.scrollLeft += delta;
    },
    { passive: false }
  );
})();
