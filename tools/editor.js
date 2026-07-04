/**
 * REVISTA #73 — Editor visual de posições.
 *
 * Injetado pelo tools/editor-server.mjs em toda página HTML servida.
 * Ativação: botão ✏️ no canto, atalho Ctrl+E, ou abrir a página com ?edit=1.
 *
 * O editor localiza, para cada elemento, a regra CSS de nível raiz que o
 * posiciona (preferindo as classes exclusivas *-lay--NNN geradas do Figma),
 * altera os valores direto no CSSOM (preview instantâneo) e persiste no
 * arquivo via POST /__editor/api/save.
 *
 * Recursos:
 *  · clique seleciona · Shift+clique multi-seleção · Alt+clique seleciona o
 *    elemento de baixo na pilha
 *  · arrastar move · setas ±1px · Shift+setas ±10px
 *  · guias de alinhamento com snap (Alt durante o arrasto desliga o snap)
 *  · modo "empurrar abaixo": mover verticalmente arrasta junto TODAS as
 *    regras com top ≥ ao do elemento (e ajusta a altura da página)
 *  · Ctrl+Z / Ctrl+Y desfazer e refazer (persistidos no arquivo também)
 *  · painel com edição numérica de top/left/width/height/bottom/right
 */
(function () {
  "use strict";

  var FRAME_W = 402;
  var SNAP = 4; // px de tolerância das guias

  var editMode = false;
  var mainEl = null;
  var pageCssFile = null; // ex.: "css/principal.css"
  var ruleIndex = []; // {selector, style, file, lay:boolean}
  var elMap = new Map(); // Element -> entrada de ruleIndex
  var selection = []; // [Element]; o primeiro é o "primário"
  var undoStack = [];
  var redoStack = [];
  var gesture = null; // arrasto/nudge em andamento
  var nudgeTimer = null;
  var ui = {};

  /* ─────────────────────────── utilidades ─────────────────────────── */

  function px(v) {
    if (typeof v !== "string") return null;
    var m = v.match(/^(-?\d+(?:\.\d+)?)px$/);
    return m ? parseFloat(m[1]) : null;
  }
  function fmt(n) {
    return Math.round(n * 100) / 100 + "px";
  }
  function norm(s) {
    return s.replace(/\s+/g, " ").trim();
  }

  function toast(msg, erro) {
    var t = document.createElement("div");
    t.className = "rev-ed-toast" + (erro ? " rev-ed-toast--erro" : "");
    t.textContent = msg;
    ui.toasts.appendChild(t);
    setTimeout(function () {
      t.classList.add("rev-ed-toast--sumir");
      setTimeout(function () { t.remove(); }, 400);
    }, erro ? 5000 : 1800);
  }

  /* ──────────────────────── índice de regras ──────────────────────── */

  function buildIndex() {
    ruleIndex = [];
    elMap = new Map();
    for (var s = 0; s < document.styleSheets.length; s++) {
      var sheet = document.styleSheets[s];
      var rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin
      if (!rules || !sheet.href) continue;
      var file = new URL(sheet.href).pathname.replace(/^\//, "");
      if (file.indexOf("__editor") === 0) continue;
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        if (rule.type !== 1 /* STYLE_RULE */ || rule.parentRule) continue;
        var st = rule.style;
        if (!st) continue;
        // só interessa regra com pelo menos uma medida em px — descarta
        // utilitárias tipo .img-cover { width:100%; height:100% }, que
        // "roubavam" o clique da imagem sem ter nada editável
        var temPx = ["top", "left", "bottom", "right", "width", "height"].some(function (p) {
          return px(st.getPropertyValue(p)) !== null;
        });
        if (!temPx) continue;
        var entry = {
          selector: norm(rule.selectorText),
          style: st,
          file: file,
          lay: /-lay--\d+/.test(rule.selectorText),
        };
        ruleIndex.push(entry);
      }
    }
    // mapeia elemento -> TODAS as regras que casam (a posição pode estar
    // dividida: ex. left na .principal-lay--013 e top na .z-deco-bg-mid)
    var els = mainEl.querySelectorAll("*");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var cands = [];
      for (var j = 0; j < ruleIndex.length; j++) {
        var en = ruleIndex[j];
        if (en.selector.indexOf(",") !== -1) continue;
        try {
          if (!el.matches(en.selector)) continue;
        } catch (e) { continue; }
        cands.push(en);
      }
      if (!cands.length) continue;
      var prim = null;
      for (var k = 0; k < cands.length; k++) if (cands[k].lay) { prim = cands[k]; break; }
      elMap.set(el, { cands: cands, prim: prim || cands[cands.length - 1] });
    }

    // arquivo da página (base do modo empurrar): o CSS com mais regras
    // realmente usadas pelos elementos do main. Páginas com -lay-- ganham
    // peso extra; páginas sem -lay-- (produto, mkt-digital) caem no arquivo
    // próprio delas em vez de ficarem sem referência.
    pageCssFile = null;
    var contag = {};
    elMap.forEach(function (m) {
      m.cands.forEach(function (en) {
        contag[en.file] = (contag[en.file] || 0) + 1 + (en.lay ? 1000 : 0);
      });
    });
    var melhor = 0;
    for (var f in contag) {
      if (contag[f] > melhor) { melhor = contag[f]; pageCssFile = f; }
    }
  }

  function mapOf(el) { return elMap.get(el) || null; }

  /* Dona de uma propriedade = a ÚLTIMA regra na ordem da cascata que a
   * define em px (é a que o navegador aplica entre classes de mesmo peso). */
  function propOwner(map, prop) {
    var win = null;
    for (var i = 0; i < map.cands.length; i++) {
      if (px(map.cands[i].style.getPropertyValue(prop)) !== null) win = map.cands[i];
    }
    return win;
  }

  function editableFromPoint(x, y, aposEl) {
    var pilha = document.elementsFromPoint(x, y);
    var achouApos = !aposEl;
    for (var i = 0; i < pilha.length; i++) {
      var el = pilha[i];
      while (el && el !== mainEl && !elMap.has(el)) el = el.parentElement;
      if (!el || el === mainEl) continue;
      if (!achouApos) { if (el === aposEl) achouApos = true; continue; }
      if (el !== aposEl) return el;
    }
    return null;
  }

  /* ───────────────────────── persistência ─────────────────────────── */

  function persist(edits) {
    return fetch("/__editor/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ edits: edits }),
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var falhas = (j.resultados || []).filter(function (x) { return !x.ok; });
        if (falhas.length) {
          toast("⚠ " + falhas.length + " regra(s) não gravada(s): " + falhas[0].selector + " — " + falhas[0].erro, true);
        } else {
          var arqs = {};
          (j.resultados || []).forEach(function (x) { arqs[x.file] = 1; });
          toast("✓ salvo " + Object.keys(arqs).join(", "));
        }
      })
      .catch(function (e) { toast("⚠ erro ao salvar: " + e.message, true); });
  }

  function batchEdits(batch, useBefore) {
    return batch.map(function (it) {
      return { file: it.file, selector: it.selector, props: useBefore ? it.before : it.after };
    });
  }

  function commitBatch(batch) {
    if (!batch.length) return;
    undoStack.push(batch);
    redoStack = [];
    persist(batchEdits(batch, false));
    refreshUI();
  }

  function applyProps(entry, props) {
    for (var p in props) {
      if (props[p] === null) entry.style.removeProperty(p);
      else entry.style.setProperty(p, props[p]);
    }
  }

  function undo() {
    var batch = undoStack.pop();
    if (!batch) { toast("nada para desfazer"); return; }
    batch.forEach(function (it) { applyProps(it.entry, it.before); });
    redoStack.push(batch);
    persist(batchEdits(batch, true));
    refreshUI();
  }
  function redo() {
    var batch = redoStack.pop();
    if (!batch) { toast("nada para refazer"); return; }
    batch.forEach(function (it) { applyProps(it.entry, it.after); });
    undoStack.push(batch);
    persist(batchEdits(batch, false));
    refreshUI();
  }

  /* ─────────────────────────── gestos ─────────────────────────────── */

  var PROPS_X = ["left", "right"];
  var PROPS_Y = ["top", "bottom"];

  function snapshotEntry(entry) {
    var vals = {};
    ["top", "left", "bottom", "right", "width", "height"].forEach(function (p) {
      var v = px(entry.style.getPropertyValue(p));
      if (v !== null) vals[p] = v;
    });
    return vals;
  }

  function gestureStart(tipo) {
    var pushMode = ui.chkPush.checked;
    var itens = [];
    var porEntry = new Map();
    selection.forEach(function (el) {
      var map = mapOf(el);
      if (!map) return;
      var ox = propOwner(map, "left") || propOwner(map, "right");
      var oy = propOwner(map, "top") || propOwner(map, "bottom");
      [[ox, "mx"], [oy, "my"]].forEach(function (par) {
        var en = par[0];
        if (!en) return;
        var item = porEntry.get(en);
        if (!item) {
          item = { entry: en, start: snapshotEntry(en), mx: false, my: false, sel: true };
          porEntry.set(en, item);
          itens.push(item);
        }
        item[par[1]] = true;
      });
    });
    if (!itens.length) {
      toast("este elemento não tem posição em px para mover — tente Alt+clique no contêiner", true);
      return null;
    }

    var vistos = new Set(porEntry.keys());
    var mapPrim = mapOf(selection[0]);
    var oyPrim = mapPrim ? propOwner(mapPrim, "top") : null;
    var afetadas = [];
    var heightItem = null;
    if (pushMode && oyPrim) {
      var limiar = px(oyPrim.style.getPropertyValue("top"));
      for (var i = 0; i < ruleIndex.length; i++) {
        var en = ruleIndex[i];
        if (en.file !== pageCssFile || vistos.has(en)) continue;
        if (en.selector.indexOf(",") !== -1) continue;
        var t = px(en.style.getPropertyValue("top"));
        if (t === null || t < limiar) continue;
        // snapshot completo: o diff do commit compara todas as props,
        // então o "antes" precisa registrar o que já existia
        afetadas.push({ entry: en, start: snapshotEntry(en), sel: false });
        vistos.add(en);
      }
      if (ui.chkAltura.checked) {
        var clsMain = mainEl.classList[0];
        for (var k = 0; k < ruleIndex.length; k++) {
          if (norm(ruleIndex[k].selector) === "." + clsMain) {
            var h = px(ruleIndex[k].style.getPropertyValue("height"));
            if (h !== null) heightItem = { entry: ruleIndex[k], start: snapshotEntry(ruleIndex[k]), sel: false };
            break;
          }
        }
      }
    }

    var outros = null; // rects para guias — só no arrasto de seleção única
    if (tipo === "drag" && selection.length === 1) {
      outros = coletarRects(selection[0]);
    }

    return {
      tipo: tipo,
      pushMode: pushMode,
      itens: itens,
      afetadas: afetadas,
      heightItem: heightItem,
      outros: outros,
      startRect: rectFrame(selection[0]),
      dx: 0,
      dy: 0,
    };
  }

  function gestureApply(g, dx, dy, semSnap) {
    if (g.outros && !semSnap) {
      var aj = calcularSnap(g, dx, dy);
      dx = aj.dx; dy = aj.dy;
      desenharGuias(aj.guias);
    } else {
      desenharGuias([]);
    }
    g.dx = dx; g.dy = dy;

    g.itens.forEach(function (it) {
      var props = {};
      if (it.mx) {
        if (it.start.left !== undefined) props.left = fmt(it.start.left + dx);
        else if (it.start.right !== undefined) props.right = fmt(it.start.right - dx);
      }
      if (it.my) {
        if (it.start.top !== undefined) props.top = fmt(it.start.top + dy);
        else if (it.start.bottom !== undefined) props.bottom = fmt(it.start.bottom - dy);
      }
      applyProps(it.entry, props);
    });
    g.afetadas.forEach(function (it) {
      applyProps(it.entry, { top: fmt(it.start.top + dy) });
    });
    if (g.heightItem && dy !== 0) {
      applyProps(g.heightItem.entry, { height: fmt(g.heightItem.start.height + dy) });
    }
    posicionarCaixas();
    atualizarPainelValores();
  }

  function gestureCommit(g) {
    desenharGuias([]);
    if (g.dx === 0 && g.dy === 0) return;
    var batch = [];
    function add(it) {
      var after = snapshotEntry(it.entry);
      var before = {}, delta = {};
      var mudou = false;
      for (var p in after) {
        var b = it.start[p] !== undefined ? it.start[p] : null;
        if (b === null || Math.abs(after[p] - b) > 0.001) {
          before[p] = b === null ? null : fmt(b);
          delta[p] = fmt(after[p]);
          mudou = true;
        }
      }
      if (mudou) {
        batch.push({ entry: it.entry, file: it.entry.file, selector: it.entry.selector, before: before, after: delta });
      }
    }
    g.itens.forEach(add);
    g.afetadas.forEach(add);
    if (g.heightItem) add(g.heightItem);
    commitBatch(batch);
    if (g.afetadas.length) {
      toast("↕ " + g.afetadas.length + " elemento(s) abaixo acompanharam o movimento");
    }
  }

  /* ─────────────────────── guias e alinhamento ────────────────────── */

  function rectFrame(el) {
    var m = mainEl.getBoundingClientRect();
    var r = el.getBoundingClientRect();
    return { l: r.left - m.left, t: r.top - m.top, r: r.right - m.left, b: r.bottom - m.top, w: r.width, h: r.height };
  }

  function coletarRects(exceto) {
    var lista = [];
    elMap.forEach(function (en, el) {
      if (el === exceto || exceto.contains(el) || el.contains(exceto)) return;
      var r = rectFrame(el);
      if (r.w < 2 || r.h < 2) return;
      lista.push(r);
    });
    lista.push({ l: 0, t: -1e9, r: FRAME_W, b: 1e9, w: FRAME_W, h: 2e9 }); // bordas do frame
    return lista;
  }

  function calcularSnap(g, dx, dy) {
    var c = {
      l: g.startRect.l + dx, r: g.startRect.r + dx,
      t: g.startRect.t + dy, b: g.startRect.b + dy,
    };
    c.cx = (c.l + c.r) / 2; c.cy = (c.t + c.b) / 2;
    var melhorX = null, melhorY = null, guias = [];
    g.outros.forEach(function (o) {
      var ocx = (o.l + o.r) / 2, ocy = (o.t + o.b) / 2;
      [[c.l, o.l], [c.l, o.r], [c.r, o.l], [c.r, o.r], [c.cx, ocx]].forEach(function (par) {
        var d = par[1] - par[0];
        if (Math.abs(d) <= SNAP && (melhorX === null || Math.abs(d) < Math.abs(melhorX.d))) {
          melhorX = { d: d, x: par[1] };
        }
      });
      [[c.t, o.t], [c.t, o.b], [c.b, o.t], [c.b, o.b], [c.cy, ocy]].forEach(function (par) {
        var d = par[1] - par[0];
        if (Math.abs(d) <= SNAP && (melhorY === null || Math.abs(d) < Math.abs(melhorY.d))) {
          melhorY = { d: d, y: par[1] };
        }
      });
    });
    if (melhorX) { dx += melhorX.d; guias.push({ eixo: "v", pos: melhorX.x }); }
    if (melhorY) { dy += melhorY.d; guias.push({ eixo: "h", pos: melhorY.y }); }
    return { dx: dx, dy: dy, guias: guias };
  }

  function desenharGuias(guias) {
    ui.guias.innerHTML = "";
    guias.forEach(function (gg) {
      var d = document.createElement("div");
      d.className = "rev-ed-guia rev-ed-guia--" + gg.eixo;
      if (gg.eixo === "v") d.style.left = gg.pos + "px";
      else d.style.top = gg.pos + "px";
      ui.guias.appendChild(d);
    });
  }

  /* ─────────────────────────── seleção ────────────────────────────── */

  function select(els) {
    selection = els.filter(function (el) { return elMap.has(el); });
    refreshUI();
  }

  function posicionarCaixas() {
    ui.caixas.innerHTML = "";
    selection.forEach(function (el, i) {
      var r = rectFrame(el);
      var box = document.createElement("div");
      box.className = "rev-ed-box" + (i === 0 ? " rev-ed-box--prim" : "");
      box.style.left = r.l + "px";
      box.style.top = r.t + "px";
      box.style.width = r.w + "px";
      box.style.height = r.h + "px";
      ui.caixas.appendChild(box);
      if (i === 0) {
        var map = mapOf(el);
        var badge = document.createElement("div");
        badge.className = "rev-ed-badge";
        var ot = propOwner(map, "top");
        var ol = propOwner(map, "left");
        var t = ot ? px(ot.style.getPropertyValue("top")) : null;
        var l = ol ? px(ol.style.getPropertyValue("left")) : null;
        badge.textContent = map.prim.selector + (t !== null ? "  top:" + t : "") + (l !== null ? "  left:" + l : "");
        badge.style.left = r.l + "px";
        badge.style.top = (r.t > 24 ? r.t - 22 : r.b + 4) + "px";
        ui.caixas.appendChild(badge);
      }
    });
  }

  /* ─────────────────────────── painel ─────────────────────────────── */

  var CAMPOS = ["top", "left", "width", "height", "bottom", "right"];

  function atualizarPainelValores() {
    var map = selection.length ? mapOf(selection[0]) : null;
    CAMPOS.forEach(function (p) {
      var inp = ui.campos[p];
      if (document.activeElement === inp) return;
      var v = "";
      if (map) {
        var own = propOwner(map, p);
        v = own ? own.style.getPropertyValue(p) : map.prim.style.getPropertyValue(p);
      }
      inp.value = v ? v.replace(/px$/, "") : "";
    });
  }

  function refreshUI() {
    posicionarCaixas();
    if (!selection.length) {
      ui.info.textContent = "clique num elemento para selecionar";
      ui.arquivo.textContent = pageCssFile || "";
    } else {
      var prim = mapOf(selection[0]).prim;
      ui.info.textContent = prim.selector + (selection.length > 1 ? "  (+" + (selection.length - 1) + ")" : "");
      ui.arquivo.textContent = prim.file;
    }
    atualizarPainelValores();
    preencherCssBox();
    ui.btnUndo.disabled = !undoStack.length;
    ui.btnRedo.disabled = !redoStack.length;
  }

  function aplicarCampo(prop) {
    if (!selection.length) return;
    var map = mapOf(selection[0]);
    // grava na regra dona da propriedade; se ninguém a define ainda,
    // cria na regra principal (-lay--) do elemento
    var en = propOwner(map, prop) || map.prim;
    var bruto = ui.campos[prop].value.trim();
    var antes = en.style.getPropertyValue(prop) || null;
    var depois = bruto === "" ? null : (isNaN(parseFloat(bruto)) ? null : fmt(parseFloat(bruto)));
    if (bruto !== "" && depois === null) { toast("valor inválido", true); return; }
    if (antes === depois || (antes && depois && Math.abs(px(antes) - px(depois)) < 0.001)) return;

    // top com modo empurrar: reusa o pipeline de gesto para arrastar os de baixo
    if (prop === "top" && ui.chkPush.checked && antes && depois) {
      var g = gestureStart("input");
      if (g) {
        gestureApply(g, 0, px(depois) - px(antes), true);
        gestureCommit(g);
        return;
      }
    }
    var props = {};
    props[prop] = depois;
    applyProps(en, props);
    var before = {}; before[prop] = antes;
    var after = {}; after[prop] = depois;
    commitBatch([{ entry: en, file: en.file, selector: en.selector, before: before, after: after }]);
  }

  /* ──────────────────── box de CSS livre da regra ─────────────────── */

  var cssBoxEntry = null; // regra exibida no textarea

  /* divide declarações por ';' ignorando ';' dentro de parênteses (url(data:...)) */
  function splitDecls(texto) {
    var partes = [];
    var atual = "";
    var depth = 0;
    for (var i = 0; i < texto.length; i++) {
      var ch = texto[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === ";" && depth === 0) { partes.push(atual); atual = ""; continue; }
      atual += ch;
    }
    partes.push(atual);
    return partes.map(function (p) { return p.trim(); }).filter(Boolean);
  }

  /* aceita prop normal (left), com prefixo (-webkit-mask) e custom (--minha-var) */
  var RE_DECL = /^(-{0,2}[a-zA-Z][\w-]*)\s*:\s*([\s\S]+)$/;

  function nomeProp(bruto) {
    return bruto.indexOf("--") === 0 ? bruto : bruto.toLowerCase();
  }

  function declsParaMapa(cssText) {
    var mapa = {};
    splitDecls(cssText).forEach(function (d) {
      var m = d.match(RE_DECL);
      if (m) mapa[nomeProp(m[1])] = m[2].trim().replace(/\s+/g, " ");
    });
    return mapa;
  }

  function preencherCssBox() {
    var map = selection.length ? mapOf(selection[0]) : null;
    ui.selRegra.innerHTML = "";
    if (!map) {
      cssBoxEntry = null;
      ui.txtCss.value = "";
      ui.txtCss.disabled = true;
      ui.btnCssSalvar.disabled = true;
      return;
    }
    map.cands.forEach(function (en, i) {
      var opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = en.selector + "  (" + en.file.replace(/^css\//, "") + ")";
      ui.selRegra.appendChild(opt);
    });
    var idx = map.cands.indexOf(cssBoxEntry);
    if (idx === -1) { cssBoxEntry = map.prim; idx = map.cands.indexOf(map.prim); }
    ui.selRegra.value = String(idx);
    ui.txtCss.disabled = false;
    ui.btnCssSalvar.disabled = false;
    if (document.activeElement !== ui.txtCss) {
      ui.txtCss.value = splitDecls(cssBoxEntry.style.cssText)
        .map(function (d) { return d + ";"; })
        .join("\n");
    }
  }

  function salvarCssBox() {
    if (!cssBoxEntry) return;
    var en = cssBoxEntry;
    var atual = declsParaMapa(en.style.cssText);
    var novo = {};
    var invalidas = [];
    var probe = document.createElement("div");
    splitDecls(ui.txtCss.value).forEach(function (d) {
      var m = d.match(RE_DECL);
      if (!m) { if (d) invalidas.push(d); return; }
      var prop = nomeProp(m[1]);
      var valor = m[2].trim().replace(/\s+/g, " ");
      probe.style.cssText = "";
      probe.style.setProperty(prop, valor);
      if (prop.indexOf("--") !== 0 && probe.style.getPropertyValue(prop) === "") {
        invalidas.push(d);
        return;
      }
      novo[prop] = valor;
    });
    if (invalidas.length) {
      toast("⚠ declaração inválida ignorada: " + invalidas[0], true);
    }

    // diff atual → novo (inclui remoções)
    var before = {}, after = {};
    var mudou = false;
    for (var p in novo) {
      if (atual[p] === undefined || atual[p] !== novo[p]) {
        before[p] = atual[p] === undefined ? null : atual[p];
        after[p] = novo[p];
        mudou = true;
      }
    }
    for (var q in atual) {
      if (novo[q] === undefined) {
        before[q] = atual[q];
        after[q] = null;
        mudou = true;
      }
    }
    if (!mudou) { toast("nada mudou"); return; }

    applyProps(en, after);
    commitBatch([{ entry: en, file: en.file, selector: en.selector, before: before, after: after }]);
    preencherCssBox();
    posicionarCaixas();
  }

  /* ─────────────────────── eventos de mouse ───────────────────────── */

  var mouseDownInfo = null;

  function onMouseDown(ev) {
    if (!editMode || ev.button !== 0) return;
    if (ui.painel.contains(ev.target) || ui.toggle.contains(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    // preventDefault impede a troca de foco nativa; solta o foco do painel
    // para os atalhos de teclado voltarem a valer
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();

    var alvo;
    if (ev.altKey && selection.length === 1) {
      alvo = editableFromPoint(ev.clientX, ev.clientY, selection[0]) || editableFromPoint(ev.clientX, ev.clientY, null);
    } else {
      alvo = editableFromPoint(ev.clientX, ev.clientY, null);
    }

    if (!alvo) { if (!ev.shiftKey) select([]); return; }

    if (ev.shiftKey) {
      var idx = selection.indexOf(alvo);
      if (idx > -1) { selection.splice(idx, 1); select(selection.slice()); }
      else select(selection.concat([alvo]));
      return;
    }
    if (selection.indexOf(alvo) === -1) select([alvo]);

    mouseDownInfo = { x: ev.clientX, y: ev.clientY, movendo: false };
  }

  function onMouseMove(ev) {
    if (!mouseDownInfo) return;
    var dx = Math.round(ev.clientX - mouseDownInfo.x);
    var dy = Math.round(ev.clientY - mouseDownInfo.y);
    if (!mouseDownInfo.movendo) {
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      mouseDownInfo.movendo = true;
      gesture = gestureStart("drag");
      if (!gesture) { mouseDownInfo = null; return; }
      document.body.classList.add("rev-ed-arrastando");
    }
    ev.preventDefault();
    gestureApply(gesture, dx, dy, ev.altKey);
  }

  function onMouseUp() {
    if (mouseDownInfo && mouseDownInfo.movendo && gesture) {
      gestureCommit(gesture);
      gesture = null;
      document.body.classList.remove("rev-ed-arrastando");
    }
    mouseDownInfo = null;
  }

  function onClickCapture(ev) {
    if (!editMode) return;
    if (ui.painel.contains(ev.target) || ui.toggle.contains(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
  }

  /* ─────────────────────── eventos de teclado ─────────────────────── */

  function commitNudge() {
    if (gesture && gesture.tipo === "nudge") {
      gestureCommit(gesture);
      gesture = null;
    }
  }

  function onKeyDown(ev) {
    if (ev.key === "e" && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      toggleEdit();
      return;
    }
    if (!editMode) return;
    // foco em campo de TEXTO: teclado fica nativo (inclusive Ctrl+Z do textarea).
    // foco em select/checkbox/botão: Ctrl+Z/Y do editor continuam valendo;
    // setas continuam nativas no select (mudam a opção).
    var ae = document.activeElement;
    var focoTexto =
      ae &&
      (ae.tagName === "TEXTAREA" ||
        (ae.tagName === "INPUT" && !/^(checkbox|radio|button|submit)$/.test(ae.type)));
    var noInput = focoTexto || (ae && ae.tagName === "SELECT");

    if ((ev.ctrlKey || ev.metaKey) && !focoTexto) {
      if (ev.key === "z" && !ev.shiftKey) { ev.preventDefault(); commitNudge(); undo(); return; }
      if (ev.key === "y" || (ev.key === "z" && ev.shiftKey)) { ev.preventDefault(); commitNudge(); redo(); return; }
    }
    if (noInput) return;

    if (ev.key === "Escape") { commitNudge(); select([]); return; }
    if (ev.key.toLowerCase() === "p" && !ev.ctrlKey && !ev.metaKey) {
      ui.chkPush.checked = !ui.chkPush.checked;
      toast("modo empurrar: " + (ui.chkPush.checked ? "LIGADO" : "desligado"));
      return;
    }

    var mapa = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (!mapa[ev.key] || !selection.length) return;
    ev.preventDefault();
    var passo = ev.shiftKey ? 10 : 1;
    var d = mapa[ev.key];

    if (!gesture || gesture.tipo !== "nudge") {
      commitNudge();
      gesture = gestureStart("nudge");
      if (!gesture) return;
    }
    gestureApply(gesture, gesture.dx + d[0] * passo, gesture.dy + d[1] * passo, true);
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(commitNudge, 500);
  }

  /* ─────────────────────── montagem da UI ─────────────────────────── */

  var CSS_UI = [
    "#rev-ed-toggle{position:fixed;right:14px;bottom:14px;z-index:2147483646;width:44px;height:44px;border-radius:50%;border:none;",
    " background:#1f6feb;color:#fff;font-size:20px;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.35)}",
    "#rev-ed-toggle.ativo{background:#e5534b}",
    "#rev-ed-painel{position:fixed;right:14px;top:14px;z-index:2147483646;width:230px;background:#161b22;color:#e6edf3;",
    " font:12px/1.5 system-ui,sans-serif;border-radius:10px;box-shadow:0 4px 24px rgba(0,0,0,.5);padding:12px;display:none}",
    "#rev-ed-painel.ativo{display:block}",
    "#rev-ed-painel h1{font-size:12px;margin:0 0 2px;font-weight:700;color:#79c0ff;word-break:break-all}",
    "#rev-ed-painel .rev-ed-arq{color:#8b949e;font-size:10px;margin-bottom:8px;word-break:break-all}",
    ".rev-ed-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:8px}",
    ".rev-ed-grid label{display:flex;flex-direction:column;font-size:10px;color:#8b949e}",
    ".rev-ed-grid input{width:100%;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;",
    " border-radius:5px;padding:3px 6px;font:12px monospace}",
    ".rev-ed-check{display:flex;align-items:center;gap:6px;margin:4px 0;cursor:pointer;font-size:11px}",
    ".rev-ed-botoes{display:flex;gap:6px;margin-top:8px}",
    ".rev-ed-botoes button{flex:1;background:#21262d;color:#e6edf3;border:1px solid #30363d;border-radius:5px;",
    " padding:4px 0;cursor:pointer;font-size:11px}",
    ".rev-ed-botoes button:disabled{opacity:.35;cursor:default}",
    ".rev-ed-atalhos{margin-top:8px;color:#8b949e;font-size:10px;line-height:1.7}",
    ".rev-ed-atalhos b{color:#c9d1d9;font-weight:600}",
    ".rev-ed-css-sec{margin-top:10px;border-top:1px solid #30363d;padding-top:8px}",
    ".rev-ed-css-titulo{font-size:10px;color:#8b949e;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px}",
    "#rev-ed-css-regra{width:100%;box-sizing:border-box;background:#0d1117;color:#79c0ff;border:1px solid #30363d;",
    " border-radius:5px;font:10px monospace;padding:3px 4px;margin-bottom:5px}",
    "#rev-ed-css{width:100%;box-sizing:border-box;background:#0d1117;color:#e6edf3;border:1px solid #30363d;",
    " border-radius:5px;padding:6px;font:11px/1.55 monospace;resize:vertical;min-height:90px}",
    "#rev-ed-css:focus{border-color:#1f6feb;outline:none}",
    "#rev-ed-css-salvar{width:100%;margin-top:6px;background:#238636;color:#fff;border:none;border-radius:5px;",
    " padding:5px 0;cursor:pointer;font-size:11px;font-weight:600}",
    "#rev-ed-css-salvar:disabled{opacity:.35;cursor:default}",
    "#rev-ed-css-salvar span{font-weight:400;opacity:.7}",
    "#rev-ed-painel{max-height:calc(100vh - 28px);overflow-y:auto}",
    "#rev-ed-caixas,#rev-ed-guias{position:absolute;inset:0;pointer-events:none;z-index:2147483600}",
    ".rev-ed-box{position:absolute;outline:1.5px solid #1f6feb;outline-offset:1px;background:rgba(31,111,235,.06)}",
    ".rev-ed-box--prim{outline-color:#e5534b;background:rgba(229,83,75,.05)}",
    ".rev-ed-badge{position:absolute;background:#e5534b;color:#fff;font:10px/1.6 monospace;padding:0 6px;",
    " border-radius:4px;white-space:nowrap;transform:translateY(-2px)}",
    ".rev-ed-guia{position:absolute;background:#d29922;z-index:2147483601}",
    ".rev-ed-guia--v{top:0;bottom:0;width:1px}",
    ".rev-ed-guia--h{left:0;right:0;height:1px}",
    "#rev-ed-toasts{position:fixed;left:14px;bottom:14px;z-index:2147483646;display:flex;flex-direction:column;gap:6px}",
    ".rev-ed-toast{background:#238636;color:#fff;font:12px system-ui;padding:6px 12px;border-radius:6px;",
    " box-shadow:0 2px 8px rgba(0,0,0,.4);transition:opacity .4s}",
    ".rev-ed-toast--erro{background:#da3633}",
    ".rev-ed-toast--sumir{opacity:0}",
    "body.rev-ed-arrastando{cursor:grabbing!important;user-select:none}",
    "html[data-rev-editor] main *{animation:none!important;transition:none!important}",
    "html[data-rev-editor] main [data-animista]{opacity:1!important;visibility:visible!important}",
    /* camadas decorativas com pointer-events:none precisam ser clicáveis no
       modo edição; os overlays do próprio editor continuam transparentes */
    "html[data-rev-editor] main :not(#rev-ed-caixas):not(#rev-ed-guias):not(.rev-ed-box):not(.rev-ed-guia):not(.rev-ed-badge){pointer-events:auto!important}",
    "#rev-ed-caixas,#rev-ed-guias{pointer-events:none!important}",
  ].join("\n");

  function montarUI() {
    var style = document.createElement("style");
    style.textContent = CSS_UI;
    document.head.appendChild(style);

    ui.toggle = document.createElement("button");
    ui.toggle.id = "rev-ed-toggle";
    ui.toggle.title = "Editor visual (Ctrl+E)";
    ui.toggle.textContent = "✏️";
    ui.toggle.addEventListener("click", toggleEdit);
    document.body.appendChild(ui.toggle);

    ui.painel = document.createElement("div");
    ui.painel.id = "rev-ed-painel";
    ui.painel.innerHTML =
      '<h1 id="rev-ed-info">—</h1>' +
      '<div class="rev-ed-arq" id="rev-ed-arquivo"></div>' +
      '<div class="rev-ed-grid" id="rev-ed-campos"></div>' +
      '<label class="rev-ed-check"><input type="checkbox" id="rev-ed-push"> Empurrar elementos abaixo <b>(P)</b></label>' +
      '<label class="rev-ed-check"><input type="checkbox" id="rev-ed-altura" checked> Ajustar altura da página</label>' +
      '<div class="rev-ed-botoes">' +
      '<button id="rev-ed-undo">↩ desfazer</button>' +
      '<button id="rev-ed-redo">↪ refazer</button>' +
      "</div>" +
      '<div class="rev-ed-css-sec">' +
      '<div class="rev-ed-css-titulo">CSS da regra</div>' +
      '<select id="rev-ed-css-regra" title="Regra exibida"></select>' +
      '<textarea id="rev-ed-css" rows="9" spellcheck="false" placeholder="selecione um elemento" disabled></textarea>' +
      '<button id="rev-ed-css-salvar" disabled>💾 Salvar CSS <span>(Ctrl+S)</span></button>' +
      "</div>" +
      '<div class="rev-ed-atalhos">' +
      "<b>clique</b> seleciona · <b>shift+clique</b> multi<br>" +
      "<b>alt+clique</b> elemento de baixo<br>" +
      "<b>setas</b> ±1px · <b>shift+setas</b> ±10px<br>" +
      "<b>alt+arrasto</b> sem snap · <b>esc</b> solta<br>" +
      "<b>ctrl+z / ctrl+y</b> desfaz / refaz" +
      "</div>";
    document.body.appendChild(ui.painel);
    ui.info = ui.painel.querySelector("#rev-ed-info");
    ui.arquivo = ui.painel.querySelector("#rev-ed-arquivo");
    ui.chkPush = ui.painel.querySelector("#rev-ed-push");
    ui.chkAltura = ui.painel.querySelector("#rev-ed-altura");
    ui.btnUndo = ui.painel.querySelector("#rev-ed-undo");
    ui.btnRedo = ui.painel.querySelector("#rev-ed-redo");
    ui.btnUndo.addEventListener("click", undo);
    ui.btnRedo.addEventListener("click", redo);

    ui.selRegra = ui.painel.querySelector("#rev-ed-css-regra");
    ui.txtCss = ui.painel.querySelector("#rev-ed-css");
    ui.btnCssSalvar = ui.painel.querySelector("#rev-ed-css-salvar");
    ui.selRegra.addEventListener("change", function () {
      var map = selection.length ? mapOf(selection[0]) : null;
      if (!map) return;
      cssBoxEntry = map.cands[Number(ui.selRegra.value)] || map.prim;
      ui.txtCss.blur();
      ui.selRegra.blur();
      preencherCssBox();
    });
    ui.btnCssSalvar.addEventListener("click", salvarCssBox);
    ui.txtCss.addEventListener("keydown", function (ev) {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "s") {
        ev.preventDefault();
        salvarCssBox();
        ui.txtCss.blur();
      }
      if (ev.key === "Escape") ui.txtCss.blur();
    });

    var grid = ui.painel.querySelector("#rev-ed-campos");
    ui.campos = {};
    CAMPOS.forEach(function (p) {
      var lab = document.createElement("label");
      lab.textContent = p;
      var inp = document.createElement("input");
      inp.type = "text";
      inp.setAttribute("data-prop", p);
      inp.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") { aplicarCampo(p); inp.blur(); }
        ev.stopPropagation();
      });
      inp.addEventListener("change", function () { aplicarCampo(p); });
      lab.appendChild(inp);
      grid.appendChild(lab);
      ui.campos[p] = inp;
    });

    ui.toasts = document.createElement("div");
    ui.toasts.id = "rev-ed-toasts";
    document.body.appendChild(ui.toasts);

    ui.caixas = document.createElement("div");
    ui.caixas.id = "rev-ed-caixas";
    ui.guias = document.createElement("div");
    ui.guias.id = "rev-ed-guias";
  }

  /* ─────────────────────── liga / desliga ─────────────────────────── */

  function toggleEdit() {
    if (!editMode) ativar();
    else desativar();
  }

  function ativar() {
    mainEl = document.querySelector("body > main") || document.querySelector("body > .rev-scale-wrap > main");
    if (!mainEl) { toast("nenhum <main> encontrado nesta página", true); return; }
    if (window.innerWidth < FRAME_W || mainEl.classList.contains("rev-mobile-scaled")) {
      toast("alargue a janela (≥402px) para editar — o modo mobile usa scale", true);
      return;
    }
    editMode = true;
    document.documentElement.setAttribute("data-rev-editor", "1");
    ui.toggle.classList.add("ativo");
    ui.toggle.textContent = "✕";
    ui.painel.classList.add("ativo");
    mainEl.appendChild(ui.caixas);
    mainEl.appendChild(ui.guias);
    buildIndex();
    select([]);
    toast("modo edição LIGADO — " + elMap.size + " elementos editáveis");
  }

  function desativar() {
    commitNudge();
    editMode = false;
    document.documentElement.removeAttribute("data-rev-editor");
    ui.toggle.classList.remove("ativo");
    ui.toggle.textContent = "✏️";
    ui.painel.classList.remove("ativo");
    ui.caixas.remove();
    ui.guias.remove();
    selection = [];
    toast("modo edição desligado");
  }

  function init() {
    montarUI();
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("click", onClickCapture, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", function () { if (editMode) posicionarCaixas(); });
    if (new URLSearchParams(location.search).get("edit") === "1") ativar();
  }

  if (document.readyState === "complete") init();
  else window.addEventListener("load", init);
})();
