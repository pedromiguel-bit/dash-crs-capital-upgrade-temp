# Capital Upgrade · Dashboard de Funil

Dashboard de funil comercial da **Capital Upgrade (CAUP)** com dados **ao vivo da
Ploomes**. Duas regionais (São Paulo e Fortaleza), duas visões (**Mensal** e
**Safra**), rankings de SDR e Closer, previsão de fechamento (Prov.) e
documentação embutida.

```
Leads → Conexão → Agendamento → Reunião realizada → Venda  (+ Faturamento / Ticket)
```

---

## Como rodar

```bash
npm install
npm start            # http://localhost:3000  (ou PORT=xxxx npm start)
```

A chave da Ploomes fica no `.env` (`ploomes-api=...`) e **nunca** vai pro front — o
servidor Node é quem consulta a API (`api2.ploomes.com`, header `User-Key`).

---

## Funcionalidades

- **Funil consolidado** (geral) + **por regional**, com conversões entre etapas,
  Ticket Médio e Hit Rate.
- **Duas visões** (toggle no topo):
  - **Mensal** — volume no período (cada etapa pela sua própria data).
  - **Safra** — coorte por `StartDate` ("quando startou", propaga SDR→Closer).
- **Prov. (previsão de fechamento)** + **Meta** lado a lado em cada etapa:
  realizado + leads que ainda devem entrar (volume diário médio × dias restantes)
  convertidos pelas taxas atuais.
- **Rankings**:
  - **SDR** — Leads · Tx Conexão (CR1) · Tx Agendamento (CR2) · Tx Reunião (CR3) ·
    Win Rate · Hit Rate. Popup de win rate **por closer** no hover.
  - **Closer** — Reuniões realizadas · Vendas · Win Rate · Faturamento. Popup de
    win rate **por SDR** no hover.
  - Ordenáveis por qualquer métrica; respeitam a visão (na Safra as taxas são
    funil aninhado, ≤ 100%).
- **Filtros**: período, região, canal (ordenado por volume histórico).
- **Transições** com skeleton shimmer + fade-in.
- **📄 Documentação** embutida (`docs.html`) — como cada número é extraído da API,
  com queries de validação.

---

## Estrutura

```
server.js            Express: serve o front + /api/dashboard, /api/rankings, /api/origins, /doc-files
src/metrics.js       funil, conversões, ticket, hit rate, Prov. (previsão), Mensal × Safra
src/rankings.js      rankings de SDR e Closer (5 métricas, win rate, breakdowns)
src/ploomes.js       cliente da API Ploomes (contagem, soma, listagem, owners)
src/sheets.js        metas via Google Sheets (fallback config/metas.json)
config/funnels.js    mapa fixo de funis, campos e exclusões (fonte de verdade dos IDs)
config/metas.json    metas por regional × etapa
public/              index.html · docs.html · app.js · styles.css · favicon.svg
docs/                extracao-de-dados.md (documentação viva, renderizada em docs.html)
design-system/       capital-upgrade.html (living style guide da identidade)
specs/               histórico de decisões (visões, ajustes SP, etc.)
CLAUDE.md            orientações do projeto (inclui regra de marca)
```

---

## Convenções de dados (resumo)

> Detalhe completo em [`docs/extracao-de-dados.md`](docs/extracao-de-dados.md) (ou
> botão **📄 Documentação** no dashboard).

- **Fortaleza** — Funil SDR (`110024809`) + Funil Closer (`110022868`). Reunião
  realizada = entrada no Closer.
- **São Paulo** — Funil Resultado (`110066420`), funil único. Vendas/faturamento
  **excluem a Cristine Rocha** (`OwnerId 110072902`).
- **Safra** ancora tudo no `StartDate`; no ranking o funil é cumulativo (taxa ≤ 100%).
- **Mensal** conta por volume — taxas entre etapas podem passar de 100% (coortes
  diferentes), o que é esperado.

---

## Identidade visual

Derivada do Playbook "Processo de Indicação". Tokens em `public/styles.css`
(`:root`, prefixo `--caup-*`) e no living style guide `design-system/capital-upgrade.html`.

- **Cores:** verde de marca `#15A34A`, verde claro `#3DDC84` (sobre escuro), verde
  escuro `#0A2E1E` / `#06190F`, off-white `#EEF1ED`, tinta `#13201A`. Vermelho só
  para erro / indicador ruim.
- **Tipografia (trinca):** `Hanken Grotesk` (títulos/números), `Source Serif 4`
  (corpo), `JetBrains Mono` (eyebrows, labels, rodapés).

---

## Marca

A sigla/logo é sempre **`CAUP`** (Capital Upgrade) — **nunca `CU`**. Ver `CLAUDE.md`.

---

## Idioma

Tudo em **pt-br** (UI, comentários, documentação).
