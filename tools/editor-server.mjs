/**
 * REVISTA #73 — Servidor do editor visual.
 *
 * Serve o projeto estático e injeta o editor visual (tools/editor.js) em toda
 * página HTML servida — os arquivos em disco não são modificados. O editor no
 * navegador envia alterações de posição para POST /__editor/api/save, e este
 * servidor reescreve a regra correspondente no arquivo CSS.
 *
 * Uso:  node tools/editor-server.mjs [--port 8080]
 *       npm run editor
 *
 * Sem dependências — apenas Node nativo (http, fs, path).
 */

import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EDITOR_JS = path.join(ROOT, "tools", "editor.js");

const argPort = process.argv.indexOf("--port");
const BASE_PORT = argPort > -1 ? Number(process.argv[argPort + 1]) : 8080;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/* ─────────────────────────── Reescrita de CSS ───────────────────────────
 *
 * localizarRegra: varre o arquivo caractere a caractere controlando a
 * profundidade de chaves (comentários são pulados), e devolve o intervalo
 * [inicioBloco, fimBloco) do corpo da PRIMEIRA regra de nível raiz cujo
 * seletor (normalizado) seja igual ao pedido. Regras dentro de @media ficam
 * em profundidade 1 e nunca são tocadas.
 */
function localizarRegra(css, seletor) {
  const alvo = seletor.replace(/\s+/g, " ").trim();
  let depth = 0;
  let selStart = 0;
  let i = 0;
  const n = css.length;
  while (i < n) {
    const ch = css[i];
    if (ch === "/" && css[i + 1] === "*") {
      const fim = css.indexOf("*/", i + 2);
      i = fim === -1 ? n : fim + 2;
      if (depth === 0) selStart = i;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      i++;
      while (i < n && css[i] !== q) i += css[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) {
        const sel = css.slice(selStart, i).replace(/\s+/g, " ").trim();
        if (sel === alvo) {
          // acha o } correspondente
          let d = 1;
          let j = i + 1;
          while (j < n && d > 0) {
            const c = css[j];
            if (c === "/" && css[j + 1] === "*") {
              const fim = css.indexOf("*/", j + 2);
              j = fim === -1 ? n : fim + 2;
              continue;
            }
            if (c === "{") d++;
            else if (c === "}") d--;
            j++;
          }
          return { corpoInicio: i + 1, corpoFim: j - 1 };
        }
      }
      depth++;
      i++;
      continue;
    }
    if (ch === "}") {
      depth = Math.max(0, depth - 1);
      i++;
      if (depth === 0) selStart = i;
      continue;
    }
    i++;
  }
  return null;
}

/* Aplica { prop: valor } no corpo de uma regra preservando o formato original
 * (uma linha compacta ou multilinha). valor === null remove a declaração. */
function aplicarProps(corpo, props) {
  let out = corpo;
  for (const [prop, valor] of Object.entries(props)) {
    const propEsc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const reDecl = new RegExp(`(^|[;{\\s])(${propEsc}\\s*:\\s*)([^;}]*?)(\\s*)(;|$)`, "i");
    if (valor === null || valor === undefined) {
      // [^\S\n]* limpa o espaço que sobra sem engolir quebras de linha
      out = out.replace(new RegExp(`(^|[;\\s])${propEsc}\\s*:\\s*[^;}]*;?[^\\S\\n]*`, "i"), "$1");
      continue;
    }
    if (reDecl.test(out)) {
      out = out.replace(reDecl, (m, pre, cab, _v, esp, fim) => `${pre}${cab}${valor}${esp}${fim}`);
    } else {
      // declaração nova: respeita o estilo do bloco
      if (out.includes("\n")) {
        const indent = (out.match(/\n(\s+)\S/) || [, "  "])[1];
        out = out.replace(/\s*$/, `\n${indent}${prop}: ${valor};\n`);
      } else {
        out = `${out.replace(/\s*$/, "")} ${prop}:${valor}; `;
      }
    }
  }
  return out;
}

function caminhoSeguro(rel) {
  const abs = path.resolve(ROOT, rel);
  if (!abs.startsWith(ROOT + path.sep) && abs !== ROOT) return null;
  return abs;
}

async function aplicarEdicoes(edits) {
  // agrupa por arquivo para uma única leitura/gravação por arquivo
  const porArquivo = new Map();
  for (const e of edits) {
    if (!porArquivo.has(e.file)) porArquivo.set(e.file, []);
    porArquivo.get(e.file).push(e);
  }
  const resultados = [];
  for (const [arquivo, lista] of porArquivo) {
    const abs = caminhoSeguro(arquivo);
    if (!abs || !abs.endsWith(".css") || !fs.existsSync(abs)) {
      for (const e of lista) resultados.push({ file: arquivo, selector: e.selector, ok: false, erro: "arquivo inválido" });
      continue;
    }
    let css = await fsp.readFile(abs, "utf8");
    for (const e of lista) {
      const pos = localizarRegra(css, e.selector);
      if (!pos) {
        resultados.push({ file: arquivo, selector: e.selector, ok: false, erro: "regra não encontrada no nível raiz" });
        continue;
      }
      const corpoNovo = aplicarProps(css.slice(pos.corpoInicio, pos.corpoFim), e.props);
      css = css.slice(0, pos.corpoInicio) + corpoNovo + css.slice(pos.corpoFim);
      resultados.push({ file: arquivo, selector: e.selector, ok: true });
    }
    await fsp.writeFile(abs, css, "utf8");
    console.log(`  ✎ ${arquivo} — ${lista.length} regra(s) atualizada(s)`);
  }
  return resultados;
}

/* ────────────────────────────── Servidor ────────────────────────────── */

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = "";
    req.on("data", (c) => {
      dados += c;
      if (dados.length > 5_000_000) reject(new Error("corpo grande demais"));
    });
    req.on("end", () => resolve(dados));
    req.on("error", reject);
  });
}

function paginaIndice() {
  const htmls = fs
    .readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .sort();
  const links = htmls
    .map((f) => `<li><a href="/${f}">${f}</a> <a class="edit" href="/${f}?edit=1">✏️ editar</a></li>`)
    .join("\n");
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>Revista #73 — Editor</title>
<style>body{font:15px/1.7 system-ui;max-width:560px;margin:40px auto;padding:0 16px;color:#222}
h1{font-size:20px}li{list-style:none;padding:2px 0}a{color:#0b5fff;text-decoration:none}
a.edit{color:#c50;margin-left:10px;font-size:13px}ul{padding:0}</style></head>
<body><h1>Revista Assaí #73 — páginas</h1>
<p>Clique numa página para navegar, ou em <b>✏️ editar</b> para abrir com o editor visual ativo (atalho: <kbd>Ctrl+E</kbd> em qualquer página).</p>
<ul>${links}</ul></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    // ── API do editor ──
    if (pathname === "/__editor/editor.js") {
      const js = await fsp.readFile(EDITOR_JS);
      res.writeHead(200, { "Content-Type": MIME[".js"], "Cache-Control": "no-store" });
      return res.end(js);
    }
    if (pathname === "/__editor/api/save" && req.method === "POST") {
      const corpo = JSON.parse(await lerCorpo(req));
      if (!Array.isArray(corpo.edits)) throw new Error("payload sem edits[]");
      const resultados = await aplicarEdicoes(corpo.edits);
      res.writeHead(200, { "Content-Type": MIME[".json"] });
      return res.end(JSON.stringify({ resultados }));
    }
    if (pathname === "/__editor/api/ping") {
      res.writeHead(200, { "Content-Type": MIME[".json"] });
      return res.end(JSON.stringify({ ok: true, root: ROOT }));
    }

    // ── índice ──
    if (pathname === "/") {
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      return res.end(paginaIndice());
    }

    // ── estáticos ──
    const abs = caminhoSeguro(pathname.slice(1));
    if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(`404 — ${pathname}`);
    }
    const ext = path.extname(abs).toLowerCase();
    const tipo = MIME[ext] || "application/octet-stream";

    if (ext === ".html") {
      let html = await fsp.readFile(abs, "utf8");
      const tag = `\n<script src="/__editor/editor.js" defer></script>\n`;
      html = html.includes("</body>") ? html.replace("</body>", `${tag}</body>`) : html + tag;
      res.writeHead(200, { "Content-Type": tipo, "Cache-Control": "no-store" });
      return res.end(html);
    }

    // css/js sempre frescos (o editor reescreve os arquivos); mídia pode cachear
    const cache = ext === ".css" || ext === ".js" || ext === ".mjs" ? "no-store" : "max-age=3600";
    res.writeHead(200, { "Content-Type": tipo, "Cache-Control": cache });
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    res.writeHead(500, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ erro: String(err.message || err) }));
  }
});

function escutar(porta, tentativas) {
  server.once("error", (err) => {
    if (err.code === "EADDRINUSE" && tentativas > 0) {
      console.log(`porta ${porta} ocupada, tentando ${porta + 1}…`);
      escutar(porta + 1, tentativas - 1);
    } else {
      console.error(err.message);
      process.exit(1);
    }
  });
  server.listen(porta, () => {
    console.log(`\n  Revista #73 — editor visual`);
    console.log(`  http://localhost:${porta}/            (índice de páginas)`);
    console.log(`  http://localhost:${porta}/principal.html?edit=1   (exemplo)\n`);
    console.log(`  Ctrl+E dentro de qualquer página liga/desliga o modo edição.\n`);
  });
}
escutar(BASE_PORT, 10);
