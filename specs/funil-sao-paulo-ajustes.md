# Plano — Ajustes no funil de São Paulo (Funil Resultado)

> Status: **implementado** · Foco: **São Paulo** · Autor: dashboard Capital Upgrade
> Data: 2026-06-25
>
> **Aplicado e validado na API (FOR/junho):** Agendamento (safra) 56 → **72**
> (campo `111457447`); Venda SP mensal 14 → **11** (−3 da Cristine); Fortaleza
> inalterada (27). Default da §6 aplicado: exclusão **só no funil**, rankings
> mantêm todos os closers.
>
> Origem: regras passadas pelo analista para SP. Auditoria feita na API
> (api2.ploomes.com) confirmou 4 etapas corretas e **2 ajustes necessários**
> (fora o Realizado, que segue em stand-by — ver `funil-visoes-safra-mensal.md` §6).

## 1. Regras do analista (São Paulo · Funil Resultado `110066420`)

- **Leads:** entrada no Funil Resultado (data de criação)
- **Conexão:** etapa Qualificação ou adiante
- **Agendamento:** campo "DT de entrada em Apresentação Agendada" preenchido
- **Realizado:** etapa Reunião ou adiante
- **Venda:** Ganho
- **Valor / Data da venda:** valor + data do Ganho
- **Exclusão:** desconsiderar as vendas da **Cristine Rocha**

## 2. Auditoria — estado atual vs regra

| Etapa | Regra | Hoje no código | Veredito |
|---|---|---|---|
| Leads | entrada no funil (CreateDate) | `CreateDate` em `110066420` | ✅ ok |
| Conexão | etapa Qualificação ou adiante | campo `111457445` "[VD] DT de entrada em Qualificação" | ✅ ok (carimbo de entrada = "ou adiante") |
| **Agendamento** | campo `111457447` "[VD] DT de entrada em Apresentação Agendada" | usa `111066741` "Data para apresentação" | ❌ **campo errado** |
| Realizado | etapa Reunião ou adiante | flag `111427962` "Apresentação concluída?" | ⏸️ stand-by **e** fora do padrão |
| Venda | Ganho | `StatusId=2` por `FinishDate` | ✅ ok* |
| Valor / Data | valor + data do Ganho | Σ `Amount` por `FinishDate` | ✅ ok* |
| **Exclusão Cristine** | desconsiderar vendas dela | inexistente | ❌ **faltando** |

\* mecânica correta, mas **sem a exclusão da Cristine**.

Validação na API (junho/2026): Agendamento dá **72** com o campo certo vs **56**
com o atual. Vendas SP = **14**, das quais **3 são da Cristine** → com a exclusão,
SP vai para **11** vendas.

## 3. Ajustes a implementar

### 3.1 Corrigir o campo de Agendamento

- Em `config/funnels.js`, regional `sao-paulo`: trocar
  `agendamentoFieldId: 111066741` → **`111457447`** ("[VD] DT de entrada em
  Apresentação Agendada").
- **Efeito automático** (sem mais mudanças, pois o código já referencia
  `r.agendamentoFieldId`):
  - Mensal: agendamento conta pela data do campo correto no período.
  - Safra: agendamento conta os leads da coorte com o campo correto preenchido.
  - `src/rankings.js`: o ranking de SDR de SP (por agendamentos) passa a usar o
    campo correto — **efeito desejado**.

### 3.2 Excluir as vendas da Cristine Rocha

- **Quem:** Cristine Rocha = `OwnerId` **`110072902`**.
  ⚠️ Não confundir com "Laryssa Cristine" (`110074388`) — essa **não** é excluída.
- **Onde:** só nas métricas de **Venda** e **Faturamento** de SP (que saem do
  pipeline de fechamento). **Não** afeta Leads/Conexão/Agendamento, **não** afeta
  Fortaleza, **não** afeta os rankings.
- **Como (config-driven):**
  - Em `config/funnels.js`, regional `sao-paulo`: novo campo
    `excludeWonOwnerIds: [110072902]`.
  - Em `src/metrics.js`, montar um fragmento de filtro a partir desse array:
    `` ` and OwnerId ne 110072902` `` (encadeia `and OwnerId ne X` por id) e
    aplicá-lo em **todas** as consultas de venda/faturamento da regional:
    - Mensal — venda: `count(... StatusId=2 and FinishDate∈período <excl>)`;
      faturamento: `sumRevenue(pid, FinishDate, <canal + excl>)`.
    - Safra (SP, funil único) — venda: `count(... leadPeriod and StatusId=2 <excl>)`;
      faturamento: `sumRevenue(pid, leadPeriod, <canal + excl>)`.
  - `src/ploomes.js` `sumRevenue` já aceita o parâmetro `extra` — combinar o
    recorte de canal com a exclusão de owner nesse parâmetro.
- **Consistência:** como venda já sai descontada, as conversões finais
  (Agend.→Venda / Reunião→Venda), o Hit Rate e o Ticket Médio de SP refletem a
  exclusão automaticamente.

### 3.3 Realizado (stand-by) — anotação para o futuro

- Não existe campo "[VD] DT de entrada em Reunião" (a lista de campos [VD] vai de
  Qualificação → Apresentação Agendada → Relacionamento → Negócio Provável →
  Confeccionar Contrato; **não há "Reunião"**).
- Logo, "Reunião ou adiante" em SP terá que ser por **StageId** (deals na etapa
  `110349051` "5 Reunião" ou adiante: `110349052` Negócio provável,
  `110349053` Confeccionar Contrato, mais os ganhos), **não** por campo de data.
- Fica para quando a etapa Realizado sair do stand-by (definição geral em
  `funil-visoes-safra-mensal.md` §6).

## 4. Mudanças por arquivo

- **`config/funnels.js`** — `sao-paulo`: `agendamentoFieldId` → `111457447`;
  adicionar `excludeWonOwnerIds: [110072902]`.
- **`src/metrics.js`** — ler `r.excludeWonOwnerIds`, montar o fragmento de
  exclusão e aplicá-lo nas consultas de venda/faturamento (mensal e safra-SP).
- **`src/ploomes.js`** — nenhuma assinatura nova (usa o `extra` de `sumRevenue`);
  só garantir que o fragmento de exclusão seja repassado.

> Observação: a exclusão é **genérica por regional** (`excludeWonOwnerIds`). Hoje
> só SP a usa; Fortaleza fica sem o campo e, portanto, sem exclusão.

## 5. Validação (após implementar)

1. **Agendamento SP (junho):** deve passar a refletir o campo `111457447`
   (~72 no período testado), não mais ~56.
2. **Venda SP (junho):** total cai de **14 → 11** (3 da Cristine removidas);
   conferir que Fortaleza permanece inalterada.
3. **Faturamento SP:** deve cair pelo valor das 3 vendas da Cristine.
4. **Mensal e Safra:** checar que a exclusão vale nas duas visões.
5. **Rankings:** Closer de SP ainda pode exibir a Cristine (rankings não são
   afetados pela exclusão — confirmar se é o comportamento desejado; ver §6).

## 6. Decisões em aberto

- [x] Exclusão da Cristine só nas métricas do funil (rankings mantêm todos os
      closers) — **aplicado** (default). Ajustável depois se o time quiser excluí-la
      também do ranking de Closer de SP.

## 7. Plano de execução

1. `config/funnels.js`: corrigir `agendamentoFieldId` + adicionar
   `excludeWonOwnerIds`.
2. `src/metrics.js`: aplicar o fragmento de exclusão em venda/faturamento (mensal
   e safra-SP).
3. Validar na API conforme §5 (subir servidor local, comparar números).
4. (Futuro, stand-by) Realizado de SP por StageId conforme §3.3.

## 8. Apêndice — IDs validados na API

**Etapas do Funil Resultado (`110066420`), em ordem:**

| ord | StageId | Nome |
|---|---|---|
| 0 | 110349048 | 1 Entrada |
| 1–5 | 110349058 / 110357932 / 110357933 / 110357934 / 110357935 | DIA 1…DIA 5 |
| 6 | 110349049 | 3 Qualificação |
| 7 | 110349050 | 4 Apresentação agendada |
| 8 | 110349051 | 5 Reunião |
| 9 | 110349052 | 6 Negócio provável |
| 10 | 110349053 | 7 Confeccionar Contrato |

**Campos:**
- Conexão: `111457445` "[VD] DT de entrada em Qualificação"
- Agendamento (correto): `111457447` "[VD] DT de entrada em Apresentação Agendada"
- Agendamento (atual, a substituir): `111066741` "Data para apresentação"
- Realizado atual (flag): `111427962` "Apresentação concluída?"
- "Data reunião realizada": `111442405`

**Usuários:**
- Cristine Rocha (excluir): `OwnerId 110072902`
- Laryssa Cristine (NÃO excluir): `110074388`
