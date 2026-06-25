# CLAUDE.md — Capital Upgrade · Dashboard de Funil

Orientações para qualquer pessoa (ou IA) que trabalhe neste projeto.

---

## ⛔ REGRA DE MARCA — INEGOCIÁVEL

**A sigla / logo da marca é sempre `CAUP` (Capital Upgrade). NUNCA use `CU`.**

- ✅ Correto: `CAUP`
- ❌ Errado: `CU`, `C.U.`, `Cap`, qualquer outra abreviação

Isso vale em **todo lugar**: brand-mark do header, favicon, títulos, textos,
componentes, exemplos, documentação, design system e qualquer artefato novo.
Se for criar um ícone/logo/favicon, o texto é **`CAUP`**.

Onde a marca aparece hoje (mantenha como `CAUP`):
- `public/index.html` — `.brand-mark` no topo do dashboard
- `public/docs.html` — `.brand-mark` no topo da documentação
- `public/favicon.svg` — favicon (texto `CAUP`)
- `design-system/capital-upgrade.html` — wordmark / exemplos

---

## O que é o projeto

Dashboard de funil comercial da **Capital Upgrade**, com dados ao vivo da Ploomes
(`api2.ploomes.com`). Duas regionais (São Paulo e Fortaleza), duas visões
(**Mensal** e **Safra**), rankings de SDR e Closer, e previsão de fechamento (Prov.).

### Estrutura
```
server.js            Express: serve o front + /api/dashboard, /api/rankings, /api/origins, /doc-files
src/metrics.js       funil, conversões, ticket, hit rate, Prov. (previsão), Mensal × Safra
src/rankings.js      rankings de SDR e Closer (5 métricas, win rate, breakdown)
src/ploomes.js       cliente da API Ploomes (contagem, soma, listagem, owners)
src/sheets.js        metas via Google Sheets (fallback config/metas.json)
config/funnels.js    mapa fixo de funis, campos e exclusões (fonte de verdade dos IDs)
config/metas.json    metas por regional × etapa
public/              index.html · docs.html · app.js · styles.css · favicon.svg
docs/                extracao-de-dados.md (documentação viva, renderizada em docs.html)
design-system/       capital-upgrade.html (living style guide da identidade)
specs/               histórico de decisões (visões, ajustes SP, etc.)
```

### Como rodar
```bash
npm install
npm start          # http://localhost:3000  (ou PORT=xxxx npm start)
```
A chave da Ploomes fica no `.env` (`ploomes-api=...`) e **nunca** vai pro front.

---

## Identidade visual (Design System)

Derivada do Playbook "Processo de Indicação". Tokens em `public/styles.css` (`:root`)
e no living style guide `design-system/capital-upgrade.html`.

- **Cores:** verde de marca `#15A34A`, verde claro `#3DDC84` (sobre escuro), verde
  escuro de fundo `#0A2E1E` / `#06190F`, off-white `#EEF1ED`, tinta `#13201A`.
  Vermelho **só** para erro / indicador ruim (não é cor de marca).
- **Tipografia (trinca):** `Hanken Grotesk` (títulos/números), `Source Serif 4`
  (corpo/prosa), `JetBrains Mono` (eyebrows, labels, números, rodapés).

---

## Convenções de dados (resumo — detalhe em `docs/extracao-de-dados.md`)

- **Mensal:** cada etapa pela sua própria data no período (volume).
- **Safra:** coorte por `StartDate` ("quando startou", propaga SDR→Closer). No
  ranking, o funil da safra é **cumulativo** (etapa posterior conta nas anteriores)
  → toda taxa ≤ 100%. No mensal pode passar de 100% (coortes diferentes).
- **Fortaleza:** Funil SDR (`110024809`) + Funil Closer (`110022868`).
- **São Paulo:** Funil Resultado (`110066420`), funil único. Vendas/faturamento
  **excluem a Cristine Rocha** (`OwnerId 110072902`).
- **Prov. (previsão de fechamento):** realizado + leads que ainda devem entrar
  (volume diário médio × dias restantes) convertidos pelas taxas atuais. Sempre
  exibido **junto da Meta**.

---

## Idioma

Tudo em **pt-br** (UI, comentários, documentação), com acentuação correta.
