# Documentação de extração de dados — Dashboard Capital Upgrade

> Objetivo: descrever **exatamente** como cada número do dashboard é extraído da
> Ploomes, para que qualquer pessoa consiga **validar** os dados na fonte.
> Fonte: API pública da Ploomes (`https://api2.ploomes.com`), autenticada pelo
> header `User-Key`. Última atualização: 2026-06-25.

---

## Índice

1. [Conceitos da Ploomes](#1-conceitos-da-ploomes)
2. [As duas visões: Mensal e Safra](#2-as-duas-visões-mensal-e-safra)
3. [São Paulo — funil, campos e regras](#3-são-paulo--funil-campos-e-regras)
4. [Fortaleza — funis, campos e regras](#4-fortaleza--funis-campos-e-regras)
5. [Como cada etapa é contada (resumo lado a lado)](#5-como-cada-etapa-é-contada-resumo-lado-a-lado)
6. [Conversões, ticket, hit rate e provisionado](#6-conversões-ticket-hit-rate-e-provisionado)
7. [Rankings de SDR e Closer](#7-rankings-de-sdr-e-closer)
8. [Como validar manualmente na API](#8-como-validar-manualmente-na-api)
9. [Ressalvas conhecidas](#9-ressalvas-conhecidas)

---

## 1. Conceitos da Ploomes

Tudo gira em torno da entidade **Deal** (Negócio). Campos nativos relevantes:

| Campo nativo | Significado |
|---|---|
| `PipelineId` | A qual **funil** o negócio pertence |
| `StageId` | Em qual **etapa** do funil o negócio está |
| `StatusId` | `1` = Em aberto · `2` = **Ganho** · `3` = Perdido |
| `CreateDate` | Quando o negócio foi **criado** no funil |
| `StartDate` | Quando o negócio **"startou"**. Propaga do SDR para o Closer (ver §2) |
| `FinishDate` | Quando o negócio foi **fechado** (ganho/perdido) |
| `Amount` | Valor (R$) do negócio |
| `OwnerId` | Usuário **dono** do negócio |
| `ContactId` | Contato (empresa/pessoa) vinculado |

**Campos customizados** ficam em `OtherProperties` — uma lista onde cada item tem
um `FieldId` e o valor no slot do tipo certo (`DateTimeValue`, `BoolValue`, etc.).
Datas de etapa (ex.: "entrou em Qualificação") são campos customizados de data.

> Os IDs deste documento foram **descobertos e validados direto na API**. A fonte
> de verdade no código é `config/funnels.js`; o cálculo está em `src/metrics.js`.

---

## 2. As duas visões: Mensal e Safra

O dashboard tem um seletor **Mensal | Safra**. A diferença é **qual data ancora
cada etapa** dentro do período filtrado.

### 2.1 Visão MENSAL (volume no período)

> "Quantas conexões / agendamentos / reuniões / vendas **aconteceram** no período?"

Cada etapa é contada pela **sua própria data**, caindo dentro do período —
**independente de quando o lead entrou**. É a foto do que aconteceu no mês.

- Leads → `CreateDate` no período
- Conexão → data de conexão no período
- Agendamento → data de agendamento no período
- Reunião realizada → data de reunião no período
- Venda → `FinishDate` do ganho no período
- Faturamento → soma do `Amount` dos ganhos com `FinishDate` no período

**Característica:** como cada etapa é um conjunto diferente de negócios (entraram
em meses diferentes), as conversões entre etapas são **aproximadas** e podem
passar de 100% em meses de virada. É esperado nessa visão.

### 2.2 Visão SAFRA (coorte por início)

> "Dos negócios que **começaram** no período, quantos avançaram em cada etapa?"

Fixa a coorte pela **data de início** (`StartDate`, "quando startou") e acompanha
**esse mesmo grupo** ao longo do funil — contando quem **atingiu** cada etapa, em
qualquer data.

- A âncora é **sempre** `StartDate ∈ período`.
- Cada etapa adiciona a condição "atingiu a etapa" (campo preenchido / ganho /
  entrou no Closer), **sem** restringir a data dessa etapa ao período.

**Por que `StartDate`:** ele **propaga a informação de início do SDR para o Funil
Closer**. Assim, a venda da safra de Fortaleza (que mora no Closer) é ancorada no
início correto **sem precisar cruzar** Closer × SDR. No Funil SDR,
`StartDate == CreateDate` (validado), então o topo do funil dá o mesmo número que
usar `CreateDate`.

**Características:**
- Conversões **verdadeiras** (é sempre a mesma coorte).
- Safras recentes ficam **em maturação**: negócios que começaram no período mas
  ainda não fecharam não aparecem como venda ainda → a safra do mês corrente
  cresce ao longo das semanas. O dashboard sinaliza isso na visão Safra.

---

## 3. São Paulo — funil, campos e regras

São Paulo opera num **funil único**: aquisição e fechamento moram no mesmo
negócio (mesmo `PipelineId`).

| Item | Valor |
|---|---|
| **Funil Resultado** (`PipelineId`) | `110066420` |

**Etapas do Funil Resultado (em ordem):**

| Ordem | StageId | Nome |
|---|---|---|
| 0 | 110349048 | 1 Entrada |
| 1–5 | 110349058 / 110357932 / 110357933 / 110357934 / 110357935 | DIA 1 … DIA 5 |
| 6 | 110349049 | 3 Qualificação |
| 7 | 110349050 | 4 Apresentação agendada |
| 8 | 110349051 | 5 Reunião |
| 9 | 110349052 | 6 Negócio provável |
| 10 | 110349053 | 7 Confeccionar Contrato |

**Campos usados:**

| Etapa | Regra | Como é extraído | Campo / ID |
|---|---|---|---|
| **Leads** | entrada no Funil Resultado | `CreateDate` (mensal) / `StartDate` (safra) no funil `110066420` | nativo |
| **Conexão** | etapa Qualificação ou adiante | campo de data preenchido = entrou em Qualificação | `111457445` "[VD] DT de entrada em Qualificação" |
| **Agendamento** | "DT de entrada em Apresentação Agendada" preenchido | campo de data | `111457447` "[VD] DT de entrada em Apresentação Agendada" |
| **Reunião realizada** | a reunião aconteceu (tem data) | campo de data "Data reunião realizada" preenchido | `111442405` "Data reunião realizada" |
| **Venda** | Ganho | `StatusId = 2` no funil `110066420`, por `FinishDate` (mensal) / `StartDate` (safra) | nativo |
| **Valor / Faturamento** | valor + data do Ganho | soma de `Amount` dos ganhos | nativo (`Amount`) |

**Exclusão (regra do analista):** as vendas/faturamento de SP **desconsideram a
Cristine Rocha**.

| Quem | OwnerId |
|---|---|
| Cristine Rocha (**excluir**) | `110072902` |
| Laryssa Cristine (**NÃO** excluir — pessoa diferente) | `110074388` |

> A exclusão é aplicada **apenas** em Venda e Faturamento (não em Leads/Conexão/
> Agendamento/Reunião, e não nos rankings), via `OwnerId ne 110072902`.

---

## 4. Fortaleza — funis, campos e regras

Fortaleza opera em **dois funis encadeados**. **NÃO** usa o Funil Resultado (esse
é exclusivo de São Paulo).

| Item | Valor |
|---|---|
| **Funil SDR** (pré-venda — Leads/Conexão/Agendamento) | `110024809` |
| **Funil Closer** (fechamento — Reunião/Venda/Faturamento) | `110022868` |

**Etapas do Funil SDR (em ordem):**

| Ordem | StageId | Nome |
|---|---|---|
| 0 | 110108636 | 1 Entrada SDR |
| 1 | 110108640 | 2 Conexão SDR |
| 2 | 110108641 | 3 **Abertura** \| Diagnóstico SPIN SDR |
| 3 | 110108642 | 4 Apresentação Agendada SDR |

**Campos usados:**

| Etapa | Regra (estrutura do analista) | Como é extraído | Campo / Funil |
|---|---|---|---|
| **Leads** | `start date` | `StartDate` (= `CreateDate` no SDR) no funil `110024809` | nativo · Funil SDR |
| **Conexão** | data de entrada **Abertura** | campo de data preenchido (entrada na etapa "Abertura \| Diagnóstico SPIN") | `111459363` "Data de entrada em diagnóstico SDR" · Funil SDR |
| **Agendamento** | data de entrada agendamento | campo de data preenchido (entrada na etapa "Apresentação Agendada") | `111421731` "Data de entrada em apresentação sdr" · Funil SDR |
| **Reunião realizada** | `create date` do funil de fechamento | **entrada no Funil Closer** = `CreateDate` do deal no Closer (mensal) / `StartDate` no Closer (safra) | nativo · Funil Closer `110022868` |
| **Venda** | Ganho no fechamento | `StatusId = 2` no Funil Closer, por `FinishDate` (mensal) / `StartDate` (safra) | nativo · Funil Closer |
| **Valor / Faturamento** | valor + data do Ganho | soma de `Amount` dos ganhos do Closer | nativo (`Amount`) · Funil Closer |

> **Importante:** em Fortaleza, "reunião realizada" = **entrou no Funil Closer**
> (o deal passou do SDR para o Closer = a reunião aconteceu). Por isso usa o
> `CreateDate` do deal no Closer — não um campo customizado de data.

---

## 5. Como cada etapa é contada (resumo lado a lado)

Notação: `período` = intervalo de datas filtrado. `campoX preenchido` =
existe `OtherProperties` com aquele `FieldId` e `DateTimeValue` não nulo.

### São Paulo (funil `110066420`)

| Etapa | MENSAL | SAFRA |
|---|---|---|
| Leads | `CreateDate ∈ período` | `StartDate ∈ período` |
| Conexão | `111457445` com data ∈ período | `StartDate ∈ período` **e** `111457445` preenchido |
| Agendamento | `111457447` com data ∈ período | `StartDate ∈ período` **e** `111457447` preenchido |
| Reunião realizada | `111442405` com data ∈ período | `StartDate ∈ período` **e** `111442405` preenchido |
| Venda | `StatusId=2` **e** `FinishDate ∈ período` **e** `OwnerId ne 110072902` | `StatusId=2` **e** `StartDate ∈ período` **e** `OwnerId ne 110072902` |
| Faturamento | Σ `Amount` dos ganhos acima (mesmo recorte) | Σ `Amount` dos ganhos acima (mesmo recorte) |

### Fortaleza (SDR `110024809` + Closer `110022868`)

| Etapa | MENSAL | SAFRA |
|---|---|---|
| Leads | SDR · `CreateDate ∈ período` | SDR · `StartDate ∈ período` |
| Conexão | SDR · `111459363` com data ∈ período | SDR · `StartDate ∈ período` **e** `111459363` preenchido |
| Agendamento | SDR · `111421731` com data ∈ período | SDR · `StartDate ∈ período` **e** `111421731` preenchido |
| Reunião realizada | Closer · `CreateDate ∈ período` | Closer · `StartDate ∈ período` |
| Venda | Closer · `StatusId=2` **e** `FinishDate ∈ período` | Closer · `StatusId=2` **e** `StartDate ∈ período` |
| Faturamento | Closer · Σ `Amount` dos ganhos acima | Closer · Σ `Amount` dos ganhos acima |

---

## 6. Conversões, ticket, hit rate e provisionado

Calculados em `src/metrics.js` a partir das contagens acima:

- **Conversão Conexão** = Conexão ÷ Leads
- **Conversão Agendamento** = Agendamento ÷ Conexão
- **Conversão Reunião** = Reunião ÷ Agendamento
- **Conversão Venda** = Venda ÷ Reunião (quando há reunião) ou Venda ÷ Agendamento
- **Ticket Médio** = Faturamento ÷ Venda
- **Hit Rate** = Venda ÷ Leads (ponta a ponta)
- **Prov. (previsão de fechamento)** = realizado **+** leads que ainda devem entrar
  até o fim do período, convertidos pelas taxas atuais. Os leads que faltam =
  **volume diário médio** (leads ÷ dias decorridos) × dias restantes. Cada etapa
  recebe `realizado + leadsQueFaltam × (etapa ÷ leads)`; o faturamento previsto =
  venda prevista × ticket médio. Só faz sentido para o período em curso.
- **Meta** acompanha o Prov. em cada etapa do funil. No funil consolidado, a meta é
  a **soma** das metas das regionais do recorte (vem de `config/metas.json` /
  Google Sheets). A barra de cada etapa mostra o **atingimento** (Real ÷ Meta);
  sem meta, mostra Real ÷ Prov.

---

## 7. Rankings de SDR e Closer

Dois rankings por regional, com seletor de ordenação (maior → menor) e que
**respeitam a visão** (Mensal/Safra) selecionada no topo.

> **Identificação dos papéis:**
> - **SDR** = dono (`OwnerId`) do negócio no funil de aquisição (SDR em FOR;
>   Resultado em SP).
> - **Closer** = campo **"Vendedor" (`111066744`)** do negócio de fechamento;
>   quando vazio, cai no `OwnerId` do negócio.
> - Em **Fortaleza**, o ganho do Closer é ligado ao SDR pelo `ContactId`. Em
>   **São Paulo** (funil único), SDR e Closer costumam ser a mesma pessoa — quando
>   há handoff real (Vendedor ≠ dono), aparecem separados.

### 7.1 Ranking de SDR

Colunas (ordenáveis): **Leads · Tx Conexão (CR1) · Tx Agendamento (CR2) ·
Tx Reunião (CR3) · Win Rate · Hit Rate**.

| Métrica | Cálculo |
|---|---|
| Leads | nº de leads do SDR |
| **CR1** Tx Conexão | conexão ÷ leads |
| **CR2** Tx Agendamento | agendamento ÷ **conexão** |
| **CR3** Tx Reunião realizada | realizada ÷ **agendamento** |
| **Win Rate** | venda ÷ **reunião realizada** |
| **Hit Rate** | venda ÷ **leads** (ponta a ponta) |

- **Popup (hover na Win Rate):** win rate **por closer** que recebeu reuniões
  daquele SDR (venda ÷ realizada, com `vendas/realizadas`).
- **Safra:** o funil é calculado **por negócio da coorte, de forma cumulativa**
  (alcançar uma etapa posterior conta em todas as anteriores). Isso garante o
  aninhamento `venda ⊆ realizada ⊆ agendamento ⊆ conexão ⊆ leads` e, portanto,
  **toda taxa ≤ 100%**.
- **Mensal:** cada etapa é contada por volume (datas próprias); as taxas entre
  etapas podem **passar de 100%** (coortes diferentes) — é esperado nessa visão.

### 7.2 Ranking de Closer

Colunas (ordenáveis): **Reuniões realizadas · Vendas · Win Rate · Faturamento**.

| Métrica | Cálculo |
|---|---|
| Realizadas | reuniões realizadas que o closer recebeu (base) |
| Vendas | ganhos entre essas reuniões |
| **Win Rate** | venda ÷ **reunião realizada** |
| Faturamento | Σ `Amount` dos ganhos do closer |

- **Popup (hover na Win Rate):** win rate **por SDR** que originou as reuniões
  daquele closer (venda ÷ realizada).
- Computado a partir das **próprias reuniões realizadas** (venda é subconjunto das
  realizadas) → **Win Rate ≤ 100%** nas duas visões.
- **Safra:** reuniões com `StartDate` no período. **Mensal:** reuniões pela data
  própria (FOR = `CreateDate` no Closer; SP = "Data reunião realizada").

> **Observação:** os rankings filtram quem tem volume > 0 (SDR com agendamento > 0;
> closer com realizada > 0). A **exclusão da Cristine Rocha** vale só para as
> métricas do funil regional — **não** afeta os rankings.

## 8. Como validar manualmente na API

Toda contagem usa `$apply=filter(...)/aggregate($count as Total)` e toda soma usa
`aggregate(Amount with sum as Total)`. Exemplos prontos (trocar as datas):

**Leads de Fortaleza (mensal), junho/2026:**
```
GET /Deals?$apply=filter(PipelineId eq 110024809 and CreateDate ge 2026-06-01T00:00:00-03:00 and CreateDate le 2026-06-30T23:59:59-03:00)/aggregate($count as Total)
```

**Venda de SP (mensal, excluindo Cristine):**
```
GET /Deals?$apply=filter(PipelineId eq 110066420 and StatusId eq 2 and FinishDate ge 2026-06-01T00:00:00-03:00 and FinishDate le 2026-06-30T23:59:59-03:00 and OwnerId ne 110072902)/aggregate($count as Total)
```

**Reunião realizada de Fortaleza (mensal) = entradas no Closer:**
```
GET /Deals?$apply=filter(PipelineId eq 110022868 and CreateDate ge 2026-06-01T00:00:00-03:00 and CreateDate le 2026-06-30T23:59:59-03:00)/aggregate($count as Total)
```

**Conexão de SP (safra) — começaram no período e atingiram Qualificação:**
```
GET /Deals?$apply=filter(PipelineId eq 110066420 and StartDate ge 2026-06-01T00:00:00-03:00 and StartDate le 2026-06-30T23:59:59-03:00 and OtherProperties/any(o: o/FieldId eq 111457445 and o/DateTimeValue ne null))/aggregate($count as Total)
```

**Faturamento de Fortaleza (mensal):**
```
GET /Deals?$apply=filter(PipelineId eq 110022868 and StatusId eq 2 and FinishDate ge 2026-06-01T00:00:00-03:00 and FinishDate le 2026-06-30T23:59:59-03:00)/aggregate(Amount with sum as Total)
```

> Cabeçalho obrigatório em toda chamada: `User-Key: <chave>` (fica no `.env`,
> nunca no front). Datas no fuso `-03:00` (America/São_Paulo).

**Números de referência validados (junho/2026, mês inteiro):**

| | FOR Mensal | FOR Safra | SP Mensal | SP Safra |
|---|---|---|---|---|
| Leads | 1.428 | 1.428 | 1.546 | 1.546 |
| Conexão | 635 | 578 | 655 | 542 |
| Agendamento | 178 | 163 | 93 | 69 |
| Reunião realizada | 179 | 149 | 39 | 24 |
| Venda | 27 | 19 | 11 | 8 |

> Pequenas variações são normais (dados ao vivo). Use como ordem de grandeza.

---

## 9. Ressalvas conhecidas

1. **Fortaleza · Reunião mensal pode encostar/passar de Agendamento.** Como a
   reunião conta a **entrada no Closer no período** e o agendamento conta a etapa
   no SDR, são coortes diferentes; além disso há um **lote de ~33 negócios
   importados em 10/06** no Closer que infla a reunião mensal. Na **Safra** o
   efeito some (tudo ancorado no mesmo `StartDate`).

2. **Indicação / entrada direta no Closer (Fortaleza).** Negócios criados direto
   no Closer (sem passar pelo SDR) **entram** na safra pelo próprio `StartDate`
   (têm início próprio). Isso é intencional.

3. **Reunião é medida de formas diferentes entre regionais** (por definição de
   cada analista): SP = campo "Data reunião realizada"; Fortaleza = entrada no
   Closer (`CreateDate`). Comparações de "reunião" entre regionais devem
   considerar isso.

4. **Canal (OriginId) + Fortaleza + Venda.** O `OriginId` vem nulo nos deals do
   Closer; filtrar venda de Fortaleza por canal retorna zero. O filtro de canal é
   confiável no topo do funil (SDR), não na venda do Closer.

5. **Safra recente em maturação.** A safra do mês corrente é parcial por natureza
   (negócios começaram mas ainda não fecharam). Não interpretar como "vendeu
   pouco".

6. **Rankings acompanham a visão.** Na Safra, as taxas dos rankings são funil
   aninhado (≤ 100%); no Mensal, podem passar de 100% (volume, coortes diferentes).
   Ver §7.

---

### Arquivos de referência no projeto

- `config/funnels.js` — mapa fixo de funis, campos e exclusões (fonte de verdade dos IDs).
- `src/metrics.js` — cálculo do funil, conversões, ticket, provisionado, Mensal × Safra.
- `src/ploomes.js` — cliente da API (contagem, soma, rankings).
- `specs/funil-visoes-safra-mensal.md` · `specs/funil-sao-paulo-ajustes.md` — histórico das decisões.
