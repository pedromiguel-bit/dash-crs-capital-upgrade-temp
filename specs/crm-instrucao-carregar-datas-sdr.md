# Instrução ao analista de CRM — carregar datas do SDR no deal do Closer (Fortaleza)

> Status: **EM GRANDE PARTE RESOLVIDO** · Ploomes · Foco: Fortaleza
> Data: 2026-06-24
>
> ⚠️ **Atualização (2026-06-25):** o analista indicou o campo nativo **`StartDate`**
> ("quando startou"), que **já propaga a data de início do SDR para o Closer** e
> está preenchido em 100% dos deals. Isso **já resolve o item 1** (data de entrada
> do lead) — a safra usa o `StartDate` direto, sem join. Os itens 2–4
> (conexão/agendamento/realizada no Closer) **não são necessários** para o
> dashboard atual (essas etapas são medidas no deal do SDR; Realizado está em
> stand-by). Manter este documento apenas como referência; **não é mais um
> bloqueio**.

## Objetivo

Hoje, quando um negócio nasce no **Funil Closer** (vindo do **Funil SDR** por
passagem de bastão), ele **não carrega de forma completa as datas do funil de
origem**. Isso nos obriga a "religar" o ganho do Closer ao lead do SDR por
`ContactId` para fazer análise de **safra** (coorte por data de entrada do lead).

Queremos que **o próprio deal do Closer já nasça com essas datas preenchidas**,
copiadas do deal de origem do SDR. Assim a análise de safra passa a ser direta
(sem depender de cruzamento) e fica mais confiável.

## O que precisamos (automação na passagem de bastão)

Quando o negócio for **criado no Funil Closer** a partir de um negócio do Funil
SDR, copiar do deal de origem (SDR) para o novo deal (Closer) **estas 4 datas**:

| # | Conceito | Origem (deal do **SDR**) | Destino (deal do **Closer**) |
|---|---|---|---|
| 1 | **Data de entrada do lead** | `CreateDate` (data de criação do negócio no SDR) | campo de data **"Data de entrada no SDR" (`111459669`)** — hoje vazio, pode ser reaproveitado para isso *(ou criar um campo novo "Data de entrada do lead")* |
| 2 | **Data que virou conexão** | campo `111459363` "Data de entrada em diagnóstico SDR" | mesmo campo no Closer (`111459363`) |
| 3 | **Data que virou agendamento** | campo `111421731` "Data de entrada em apresentação sdr" | mesmo campo no Closer (`111421731`) |
| 4 | **Data que virou realizada** | campo `111442405` "Data reunião realizada" | mesmo campo no Closer (`111442405`) |

### Observações importantes

- **Item 1 é o mais crítico** e o que falta hoje. Não existe nenhum campo
  guardando a data de entrada do lead no deal do Closer. O campo
  `111459669` ("Data de entrada no SDR") está **sem uso em todo o CRM** (0
  preenchidos, inclusive no próprio SDR), então é o candidato natural para receber
  essa informação — desde que o nome/uso faça sentido pra vocês. Se preferirem,
  criem um campo novo exclusivo (ex.: "Data de entrada do lead").
- **Itens 2, 3 e 4 já são copiados parcialmente** hoje (vimos em parte dos deals
  do Closer), mas **não em 100%**. O pedido é garantir a cópia **sempre** que
  houver valor na origem.
- **Negócios de indicação / entrada direta no Closer** (sem passar pelo SDR) vão
  ficar com esses campos vazios — isso é **esperado e correto** (não houve entrada
  de lead no SDR).
- **Histórico (retroativo):** a automação vale para deals **criados a partir de
  agora**. Se for possível rodar um **backfill** nos negócios já existentes do
  Closer (preenchendo as 4 datas a partir do deal de origem do SDR), seria ótimo —
  mas não é bloqueante; podemos seguir com o cruzamento por `ContactId` para o
  período anterior.

## Por que isso ajuda (contexto técnico)

- Com a **Data de entrada do lead** no próprio deal do Closer, a **venda da safra**
  passa a ser um simples filtro de data nesse campo — sem precisar cruzar
  Closer↔SDR por contato.
- As datas de conexão/agendamento/realizada completas permitem montar o **funil de
  safra inteiro dentro de um único funil**, com taxas de conversão coerentes.

## Validação após a configuração

Depois de implementado, vamos conferir na API (amostra de negócios novos do Closer):

1. `111459669` (ou o campo novo) preenchido = `CreateDate` do lead de origem.
2. `111459363`, `111421731`, `111442405` preenchidos sempre que existirem na origem.
3. Negócios de indicação com os 4 campos vazios (sem origem no SDR).

## Pendência relacionada (não bloqueia este pedido)

A **definição da etapa "Realizado"** ainda está em discussão (ver
`funil-visoes-safra-mensal.md` §6). Independente dela, **carregar a data do item 4
já é útil** — a métrica final usa essa data como insumo.
