# Revista Assaí #73 — site + editor visual

Site estático da edição #73 (mai/jun 2026) da Revista Assaí, mais um **editor
visual de posições** feito sob medida para ajustar o layout sem editar CSS na
mão.

## Contexto (leia antes de mexer)

As páginas foram **geradas a partir do Figma** (Claude Code + MCP do Figma),
reproduzindo os layouts com fidelidade de pixel — o que significa que o HTML
não é "HTML de fluxo" tradicional:

- Cada página é um **frame fixo de 402px de largura** (miolo mobile-first do
  Figma). Praticamente todos os elementos usam `position: absolute` com
  `top/left` em px, relativos ao `<main>` da página.
- O `<main>` tem **altura fixa em px** (ex.: `.page-gestao { height: 6544px }`).
  Se conteúdo sobe ou desce, a altura precisa acompanhar.
- Comentários nos HTMLs citam os nodes do Figma de origem (ex.: `Figma node
  410:2633`) e servem de referência de QA contra os PDFs do designer.

Por causa disso, "diminuir um espaçamento" exigia editar dezenas de `top:` em
cascata — foi para resolver isso que o editor visual existe.

## Como rodar

```bash
npm install          # instala Playwright/Chromium (usado nos testes visuais)
npm run editor       # sobe o servidor local com o editor visual
```

Abra <http://localhost:8080/> — o índice lista todas as páginas. Clique em
**✏️ editar** ao lado de uma página (ou `Ctrl+E` dentro dela, ou `?edit=1` na
URL) para ativar o modo edição.

Não há build: os HTML/CSS/JS da raiz são o produto final. O servidor do
editor injeta o script de edição **apenas na resposta HTTP** — os arquivos em
disco nunca contêm código do editor.

## Editor visual (`tools/`)

| Arquivo | Papel |
|---|---|
| `tools/editor-server.mjs` | Servidor Node sem dependências: serve o projeto, injeta o editor nos HTML e expõe `POST /__editor/api/save`, que localiza a regra no CSS (primeira ocorrência **fora de `@media`**) e reescreve só as propriedades alteradas, preservando o formato do arquivo |
| `tools/editor.js` | Interface no navegador: seleção, arrasto com guias/snap, setas ±1/±10px, painel numérico, box de CSS livre, modo "empurrar", undo/redo |
| `tools/EDITOR-README.md` | Manual completo de uso e atalhos |

Recursos principais:

- **Clique seleciona** (Shift+clique multi, Alt+clique pega o elemento coberto
  na pilha) · arrastar move com guias de alinhamento · setas para ajuste fino.
- **Modo "empurrar elementos abaixo" (tecla P)**: mover um elemento
  verticalmente arrasta junto todas as regras da página com `top` maior e
  ajusta a altura do `<main>` — resolve o problema da cascata.
- **Box "CSS da regra"**: textarea com todas as declarações da regra
  selecionada; dá para alterar/adicionar/remover qualquer propriedade
  (`overflow`, `border`, `background`...) e salvar com `Ctrl+S`.
- **Tudo é autosave**: cada gesto concluído grava no arquivo CSS na hora, e
  Ctrl+Z/Ctrl+Y desfazem/refazem **regravando o arquivo**. O undo vive só na
  sessão da página (F5 zera) — o histórico durável é o git.

## Estrutura do projeto

```
*.html                  páginas de matéria (principal, gestao, produto, ...)
categoria-*.html        listagens por categoria
css/<pagina>.css        um CSS por página + revista-73-shell.css (comum, sempre por último)
js/                     menu compartilhado, animações (animista), interações específicas
assets/<pagina>73/      imagens/vídeos exportados do Figma, por página
fonts/                  FS Lola e Foco (fontes licenciadas — cuidado ao tornar público)
tools/                  editor visual (servidor + cliente + docs)
qa/                     screenshots de conferência
```

## Convenções de CSS que importam

1. **Classes de posição `-lay--NNN`** (ex.: `.principal-lay--012`): exclusivas
   por elemento, geradas ao "içar" estilos inline do Figma. São regras de uma
   linha: `.principal-lay--012 { left:24.23px; top:2342px; width:352px; }`.
   **Não reformatar** — o editor e scripts dependem desse formato.
2. **Nem toda página usa `-lay--`**: `produto.html` e `mkt-digital.html` usam
   classes semânticas (`.qualidade`, `.tip-2`...) com o mesmo padrão de regra.
3. **Posição dividida entre classes**: um elemento pode ter `left` numa regra
   e `top` em outra (ex.: `.principal-lay--013` + `.z-deco-bg-mid`). A regra
   que vale para cada propriedade é a última da cascata que a define — o
   editor já lida com isso.
4. **Overrides em `@media`**: existem regras repetidas dentro de breakpoints.
   Edições (manuais ou via editor) devem alterar a regra base de nível raiz;
   o editor nunca toca nas versões dentro de `@media`.
5. **Mobile < 402px**: `js/revista-73-menu.js` aplica `transform: scale()` no
   `<main>` inteiro para caber na tela. Por isso o editor só funciona com a
   janela em largura desktop.
6. **Cache busting** por query string (`?v=73-18`) nos links de CSS/JS.

## Mídia

Vídeos pesados são comprimidos com ffmpeg antes de entrar nas páginas. Padrão
usado (ex.: jingle de 56MB → 6,2MB):

```bash
ffmpeg -i entrada.mp4 -vf "scale=720:1280:flags=lanczos" \
  -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p \
  -c:a aac -b:a 128k -movflags +faststart saida.mp4
```

720px de largura já é o dobro do frame de 402px. Manter áudio quando a página
tem botão de som (ex.: `#btn-sound-sacola` em `noticias.html`). Originais
grandes ficam fora do ar em `assets/**/_originais/` quando preservados.

## Notas para LLMs / agentes

- **Prefira o editor (ou sua API) a editar CSS na mão** para posição. O
  endpoint aceita lote: `POST /__editor/api/save` com
  `{"edits":[{"file":"css/x.css","selector":".x-lay--001","props":{"top":"100px"}}]}`
  (valor `null` remove a propriedade).
- Para deslocar um trecho inteiro da página, mova UM elemento com o modo
  empurrar em vez de editar dezenas de regras — ou replique a lógica: todas
  as regras de nível raiz do CSS da página com `top >= limiar` ganham o mesmo
  delta, e o `height` do `.page-*` também.
- O frame é 402px: coordenadas fora de 0–402 em `left` geralmente são
  decorações que sangram de propósito. Não "corrija".
- Regras genéricas de mídia (`.img-cover`, `.img-fill`) usam `width/height:
  100%` — a posição real está sempre no contêiner `.abs` pai.
- Testes do editor: scripts Playwright avulsos (ver `qa/` e histórico de
  commits). Rode `npm run editor` antes; os testes editam CSS de verdade e
  revertem — confira `git status` ao final.
- Commits seguem o padrão do histórico: mensagem em português, primeira linha
  resumindo o quê/onde.

## Histórico

- Páginas geradas do Figma via MCP (~95% de fidelidade), depois refinadas.
- Editor visual construído em 04/07/2026 para tornar os ajustes produtivos:
  servidor + UI, modo empurrar, box de CSS, correções de mapeamento
  (regras sem px, posição dividida, `pointer-events:none`, foco do teclado).
- Jingle de notícias comprimido de 56MB para 6,2MB (720p CRF26, áudio mantido).
