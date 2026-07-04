# Editor visual — Revista Assaí #73

Ferramenta para ajustar com precisão a posição dos elementos das páginas
(geradas do Figma com posicionamento absoluto) **sem editar CSS na mão**.
As alterações são gravadas direto na regra certa do arquivo CSS da página
(ex.: `.principal-lay--012` em `css/principal.css`).

## Como usar

```bash
npm run editor        # ou: node tools/editor-server.mjs [--port 8080]
```

Abra <http://localhost:8080/> — o índice lista todas as páginas. Clique em
**✏️ editar** (ou abra qualquer página e aperte **Ctrl+E**, ou adicione
`?edit=1` na URL).

Os HTML/CSS em disco **não recebem nenhum código do editor** — o script é
injetado apenas na resposta HTTP do servidor local.

## Comandos no modo edição

| Ação | Como |
|---|---|
| Selecionar | clique no elemento |
| Multi-seleção | Shift + clique |
| Selecionar elemento coberto por outro | Alt + clique (cicla a pilha) |
| Mover | arrastar com o mouse |
| Ajuste fino | setas ±1px · Shift+setas ±10px |
| Valor exato | digitar no painel (top/left/width/height/bottom/right) + Enter |
| Desligar snap das guias | segurar Alt durante o arrasto |
| **Empurrar elementos abaixo** | ligar o checkbox no painel (atalho **P**) |
| Desfazer / Refazer | Ctrl+Z / Ctrl+Y (também regrava o arquivo) |
| Soltar seleção | Esc |
| Sair do modo edição | Ctrl+E ou o botão ✕ |

Todo movimento é **salvo automaticamente** no CSS ao soltar o mouse (ou meio
segundo depois do último toque de seta). O toast verde no canto confirma o
arquivo gravado.

## Modo "empurrar elementos abaixo"

É o recurso feito para o problema clássico deste projeto: reduzir um
espaçamento no meio da página exigia reposicionar dezenas de elementos.

Com o modo ligado (**P**), mover um elemento verticalmente move junto **todas
as regras da página com `top` maior ou igual** ao dele, e o checkbox
"Ajustar altura da página" também soma o mesmo delta no `height` do
`main` (ex.: `.page-gestao { height: 6544px }`).

## Segurança

- O projeto é um repositório git — `git diff` mostra exatamente o que o editor
  alterou, e `git checkout -- css/` desfaz tudo.
- O servidor só grava em arquivos `.css` dentro do projeto, e só na primeira
  ocorrência da regra **fora de `@media`** (overrides responsivos nunca são
  tocados).
- Elementos posicionados por regras dentro de `@media`, com seletor agrupado
  (`a, b`) ou com valores não-px são ignorados pelo "empurrar".

## Como o editor escolhe a regra a editar

- Clicar numa **imagem dentro de um contêiner posicionado** seleciona o
  contêiner automaticamente — regras genéricas sem medidas em px (ex.:
  `.img-cover { width:100%; height:100% }`) são ignoradas.
- Quando a posição está **dividida entre classes** (ex.: `left` na
  `.principal-lay--013` e `top` na `.z-deco-bg-mid`), cada eixo é gravado na
  regra que realmente o define (a última da cascata, que é a que vale).
- Camadas decorativas com `pointer-events:none` ficam clicáveis dentro do
  modo edição (fora dele, nada muda).

## Limitações conhecidas

- Só funciona com a janela em largura desktop (≥ 402px) — abaixo disso o
  `revista-73-menu.js` aplica `transform: scale()` no frame e as coordenadas
  do mouse deixariam de bater.
- Se uma regra tiver override em `@media`, o editor altera o valor base;
  confira o resultado no breakpoint correspondente.
- O editor move e redimensiona; não cria nem apaga elementos.
