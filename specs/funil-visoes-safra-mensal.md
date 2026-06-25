# Plano — Visões Safra × Mensal + ajuste da etapa "Realizado"

> Status: **implementado** (Mensal + Safra, FOR e SP) · Realizado segue em
> stand-by · Autor: dashboard Capital Upgrade
> Data: 2026-06-24 (impl. 2026-06-25)
>
> **Defaults aplicados:** abre em Mensal · rankings sempre mensal · aviso de
> maturação na Safra. **Âncora da safra = `StartDate`** (orientação do analista;
> propaga SDR→Closer, dispensa o join). Validado na API (junho): FOR venda mensal
> 27 vs safra 19; SP venda mensal 11 vs safra 8 (excl. Cristine); leads safra =
> mensal.

## 1. Contexto

O dashboard hoje calcula o funil de cada regional sempre da mesma forma: cada etapa
conta os eventos cuja **data própria** caiu no período (volume no período). Queremos
oferecer **duas visões alternáveis**:

- **Visão Mensal (período / volume)** — conta o volume que aconteceu no período
  analisado, **independente de quando o lead entrou**. É o comportamento atual.
- **Visão Safra (coorte)** — fixa o conjunto de leads que **entraram no período**
  (data de criação do lead) e acompanha **esse mesmo grupo** ao longo do funil,
  contando quantos atingiram cada etapa **em qualquer momento**.

A diferença é puramente **qual data ancora cada etapa**:

| | Mensal | Safra |
|---|---|---|
| Âncora | a data própria de cada etapa | sempre a **data de entrada do lead** (CreateDate) |
| Pergunta | "quantas conexões/agendamentos/vendas aconteceram em junho?" | "dos leads que entraram em junho, quantos conectaram/agendaram/venderam?" |

## 2. Estado atual (confirmado)

Mapeamento de Fortaleza validado na API. 5 das 6 etapas seguem o padrão passado
pelo time e **não precisam de mudança**:

| Etapa | Implementação atual (`src/metrics.js`) | Status |
|---|---|---|
| Leads | `CreateDate` no Funil SDR (`110024809`) | ✅ ok |
| Conexão | campo `111459363` (Data de entrada em diagnóstico SDR) | ✅ ok |
| Agendamento | campo `111421731` (Data de entrada em apresentação sdr) | ✅ ok |
| Venda | `StatusId=2` no Funil Closer (`110022868`), por `FinishDate` | ✅ ok |
| Valor / Data | Σ `Amount` dos ganhos do Closer, por `FinishDate` | ✅ ok |
| **Realizado** | hoje exibe "Reunião" via campo `111442405` — **fora do padrão** | ⏸️ **stand-by** (ver §6) |

## 3. Visão Mensal (definição)

Cada etapa conta pela **sua própria data** dentro do período. É exatamente o que
`computeRegional` faz hoje:

- **Leads** — `CreateDate ∈ período`
- **Conexão** — campo de conexão com `DateTimeValue ∈ período`
- **Agendamento** — campo de agendamento com `DateTimeValue ∈ período`
- **Realizada** — ⏸️ **pendente de definição** (ver §6). Uma vez definida: ganhos do
  SDR + indicação criada no Closer, **com data própria ∈ período**.
- **Venda** — `StatusId=2` e `FinishDate ∈ período` (Closer)
- **Faturamento** — Σ `Amount` dos ganhos com `FinishDate ∈ período`

**Esforço:** nenhum cálculo novo (exceto Realizada) — é o caminho atual, apenas
vira a opção "mensal".

## 4. Visão Safra (definição)

Define-se a coorte pela **data de início** (`StartDate`, "quando startou") — campo
nativo que **propaga do SDR para o Closer**. Todas as etapas passam a contar, dentro
dessa coorte, quem **atingiu** a etapa (em qualquer data).

> No SDR `StartDate == CreateDate`, então o topo do funil dá o mesmo número que
> usar `CreateDate`. A vantagem do `StartDate` está na venda (§4.3): ele já vem
> propagado no deal do Closer, dispensando o join.

### 4.1 São Paulo (funil único) — direto

Tudo mora no mesmo deal; a âncora é o `StartDate` + a condição "atingiu a etapa":

- **Leads** — `StartDate ∈ período`
- **Conexão** — `StartDate ∈ período` **e** campo conexão preenchido (qualquer data)
- **Agendamento** — `StartDate ∈ período` **e** campo agendamento preenchido
- **Venda** — `StartDate ∈ período` **e** `StatusId=2` (ganho em qualquer data)
- **Faturamento** — Σ `Amount` dos deals com `StartDate ∈ período` **e** `StatusId=2`
  (descontando `excludeWonOwnerIds`, ex.: Cristine — ver `funil-sao-paulo-ajustes.md`)

### 4.2 Fortaleza — topo do funil (Leads/Conexão/Agendamento) — direto

Mesmo deal do Funil SDR (onde `StartDate == CreateDate`):

- **Leads** — `StartDate ∈ período` (SDR)
- **Conexão** — `StartDate ∈ período` **e** campo `111459363` preenchido
- **Agendamento** — `StartDate ∈ período` **e** campo `111421731` preenchido

### 4.3 Fortaleza — Venda / Faturamento — **via `StartDate` (sem join)** ✅

> **Atualização (orientação do analista):** usar o campo **`StartDate`** ("quando
> startou") como âncora da safra. O `StartDate` **propaga a data de início do SDR
> para o deal do Closer**, então a venda-safra sai direto, **sem precisar ligar
> Closer↔SDR**. Isso substitui o antigo join por `ContactId`.

**Validado na API (junho/2026):**

- `StartDate` preenchido em **100%** — 1428/1428 leads do SDR e **27/27 ganhos do
  Closer**.
- No **SDR**, `StartDate == CreateDate`. No **Closer**, `StartDate` carrega o início
  do SDR (propagado).
- Venda-safra de Fortaleza via `StartDate`: **19** (fat. R$ 535.500) — vs 18 do
  join antigo. A diferença é **+1 indicação** que começou em junho: com `StartDate`
  ela tem início próprio e **entra** na safra (ver §4.4).

**Cálculo:**

- **Venda safra** = ganhos do Closer (`StatusId=2`) com **`StartDate ∈ período`**.
- **Faturamento safra** = Σ `Amount` desses ganhos.
- **Maturação**: safras recentes aparecem incompletas — negócios que começaram no
  período mas ainda não fecharam. Esperado em coorte; sinalizado na UI.

> O mesmo `StartDate` serve para SP (funil único) — ver §4.1 — então venda/faturamento
> da safra ficam **idênticos em código** para as duas regionais.

### 4.4 Fortaleza — Realizada (nas duas visões) — ⏸️ pendente de definição

A etapa Realizada está em stand-by até o analista definir a regra (§6). O plano de
como ela entra em cada visão, **assim que definida**:

- **Mensal** — conta pela data própria da realização ∈ período (ganho no SDR pela
  data do ganho + indicação criada no Closer no período).
- **Safra** — ancorada no `StartDate` (igual às demais etapas). Como `StartDate`
  existe em todo deal (inclusive indicação), tanto o ganho-no-SDR quanto a
  indicação entram na safra pelo seu início.

## 5. Mudanças no código

### 5.1 Backend

- **`server.js`** — aceitar `?view=mensal|safra` em `/api/dashboard` (default
  `mensal`), validar e repassar.
- **`src/metrics.js`** — `computeRegional` ganha o parâmetro `view`:
  - `mensal`: filtros atuais (data própria ∈ período).
  - `safra`: `StartDate ∈ período` + condição "atingiu etapa". Venda/faturamento =
    ganhos do fechamento com `StartDate ∈ período` (vale para FOR e SP, sem join).
- **`src/ploomes.js`** — sem helper de join (o `StartDate` dispensa). Usa
  `count`/`sumRevenue` existentes.
- **`src/rankings.js`** — rankings sempre mensais (não seguem a visão).

### 5.2 Frontend (`public/`)

- Toggle **Mensal | Safra** na barra de filtros (`index.html` + `app.js`),
  enviado como `view` na chamada da API.
- Rótulo/tooltip explicando cada visão e o aviso de "safra em maturação".

## 6. Etapa "Realizado" — STAND-BY

Mantida como está por ora (decisão do time). Quando voltar, o padrão alvo é:

```
Realizado (FOR) = [Ganhos no Funil SDR, StatusId=2]
                + [Criação no Closer SEM atuação do SDR (indicação)]
```

**Pendências com o analista (já enviadas):**

1. **Critério de indicação** — não há campo "Origem = Indicação". Sinal mais
   confiável: ausência do campo **"Passagem de bastão SDR" (`111113240`)**
   (presente em 27/27 ganhos de junho).
2. **Lote de importação** — 33 deals criados em 10/06, todos perdidos (leads de
   landing page importados) poluem a contagem de "sem SDR". Definir se entram e
   como filtrar (ex.: excluir Suborigem "Recuperação Perdido").
3. **Data base dos ganhos do SDR** — `FinishDate` (131 em junho) vs data de criação
   (104). Sugerido `FinishDate`, coerente com a etapa "Venda".

> Observação: hoje a coluna exibe "Reunião" (campo `111442405`), que o novo padrão
> não usa. Enquanto não houver definição, considerar esconder a etapa (vira `—`,
> como em SP) para não mostrar número fora do padrão.

## 7. Decisões em aberto

- [x] ~~Join por `ContactId`~~ → **substituído por `StartDate`** (orientação do
      analista; 100% de cobertura, sem join). Ver §4.3.
- [x] Rankings sempre mensais (não seguem a visão) — **aplicado**.
- [x] Default da UI: abre em **Mensal** — **aplicado**.
- [x] Aviso de "safra em maturação" exibido na Safra — **aplicado**.

> Defaults aplicados. Ajustáveis depois se o time preferir outro comportamento.

## 8. Plano de execução (passos)

1. ✅ Backend: parâmetro `view` em `server.js` + `computeRegional` ramificado
   (mensal = data própria; safra = `StartDate ∈ período` + "atingiu etapa").
2. ✅ Backend: venda/faturamento safra = ganhos com `StartDate ∈ período`
   (FOR e SP, sem join — §4.3).
3. ✅ Frontend: toggle Mensal|Safra + aviso de maturação na Safra.
4. ✅ Validação na API (FOR venda safra 19; SP venda safra 8 excl. Cristine).
5. (Depois) Corrigir "Realizado" quando o analista responder §6 — nas duas visões
   conforme §4.4.

## 9. Apêndice — IDs validados na API

- Funil SDR: `110024809` · Funil Closer: `110022868` · Funil Resultado (SP): `110066420`
- Conexão (FOR): `111459363` · Agendamento (FOR): `111421731`
- Conexão (SP): `111457445` · Agendamento (SP): `111066741`
- Passagem de bastão SDR: `111113240` · Cliente oficial SDR: `111071249`
- "Realizado" atual (Reunião): `111442405`
- **Âncora da safra: `Deal.StartDate`** (nativo) — propaga SDR→Closer; 100% de
  cobertura (1428/1428 SDR, 27/27 ganhos Closer). No SDR `StartDate == CreateDate`.
- Abandonados: join por `ContactId` (substituído pelo `StartDate`); campo
  `111459669` "Data de entrada no SDR" (vazio em todo o CRM, não usar).
