// Calculo do funil Capital Upgrade
// (Leads -> Conexao -> Agendamento -> Reuniao -> Venda) por regional e
// consolidado, a partir das contagens da Ploomes.
//
// Em Fortaleza a venda e o faturamento vivem num funil separado (Closer):
// "Venda" = ganho do Closer. A "Reuniao" sai do campo de data
// "Data reuniao realizada" (showFieldId) no proprio deal do SDR — igual a Sao
// Paulo, que usa o mesmo tipo de campo. Sem showFieldId, a etapa fica null.

const { regionais, wonStatusId } = require('../config/funnels');
const ploomes = require('./ploomes');

// Filtro de intervalo de data OData para um campo de data nativo do Deal.
function dateRange(field, startIso, endIso) {
  return `${field} ge ${startIso} and ${field} le ${endIso}`;
}

// Filtro para um campo customizado de data (OtherProperties) dentro do periodo.
function customDateRange(fieldId, startIso, endIso) {
  return (
    `OtherProperties/any(o: o/FieldId eq ${fieldId}` +
    ` and o/DateTimeValue ge ${startIso} and o/DateTimeValue le ${endIso})`
  );
}

// Filtro para um campo customizado booleano (OtherProperties) marcado como Sim.
function customBoolTrue(fieldId) {
  return `OtherProperties/any(o: o/FieldId eq ${fieldId} and o/BoolValue eq true)`;
}

// Filtro "atingiu a etapa" (safra): campo customizado de data preenchido em
// qualquer data (independe do periodo — o recorte de periodo e a entrada do lead).
function customFieldFilled(fieldId) {
  return `OtherProperties/any(o: o/FieldId eq ${fieldId} and o/DateTimeValue ne null)`;
}

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

// Calcula as etapas + faturamento de uma regional no periodo.
// Leads/Conexao/Agendamento/Reuniao saem do pipeline de aquisicao (r.pipelineId):
// a reuniao e o campo de data showFieldId no proprio deal. Venda/Faturamento
// saem do pipeline de fechamento: o Closer quando existe (Fortaleza), senao o
// proprio pipeline (Sao Paulo, funil unico).
async function computeRegional(key, startIso, endIso, canal, view) {
  const r = regionais[key];
  const p = `PipelineId eq ${r.pipelineId}`;
  const closerPid = r.closerPipelineId || r.pipelineId;
  const c = `PipelineId eq ${closerPid}`;
  // Recorte por canal (campo nativo OriginId do Deal). Vazio = todos os canais.
  const canalF = canal ? ` and OriginId eq ${canal}` : '';
  const safra = view === 'safra';
  // Periodo da coorte (safra): ancorado no StartDate ("quando startou"),
  // orientacao do analista. O StartDate propaga a data de inicio do SDR para o
  // deal do Closer — no SDR, StartDate == CreateDate; no Closer ele carrega o
  // inicio do SDR. Assim a venda da safra sai direto do StartDate, sem precisar
  // ligar Closer<->SDR.
  const leadPeriod = dateRange('StartDate', startIso, endIso);

  // Exclusao de owners nas vendas/faturamento (ex.: SP desconsidera a Cristine
  // Rocha). So afeta venda/faturamento; nao toca topo do funil nem os rankings.
  const exclOwners = r.excludeWonOwnerIds || [];
  const exclF = exclOwners.map((id) => ` and OwnerId ne ${id}`).join(''); // p/ count()
  // Para sumRevenue, o recorte vai no parametro `extra` (clausulas unidas por 'and').
  const revenueExtraParts = [];
  if (canal) revenueExtraParts.push(`OriginId eq ${canal}`);
  exclOwners.forEach((id) => revenueExtraParts.push(`OwnerId ne ${id}`));
  const revenueExtra = revenueExtraParts.length ? revenueExtraParts.join(' and ') : null;

  // Leads: igual nas duas visoes (entrada do lead no periodo).
  const leadsQuery = ploomes.count(`${p} and ${leadPeriod}${canalF}`);

  // Conexao / Agendamento:
  //   - mensal: conta pela data propria de cada etapa no periodo.
  //   - safra: dos leads que entraram no periodo, quantos atingiram a etapa
  //     (campo de data preenchido em qualquer momento).
  const conexaoQuery = safra
    ? ploomes.count(`${p} and ${leadPeriod} and ${customFieldFilled(r.conexaoFieldId)}${canalF}`)
    : ploomes.countCustomDateInRange(`${p}${canalF}`, r.conexaoFieldId, startIso, endIso);
  const agendamentoQuery = safra
    ? ploomes.count(`${p} and ${leadPeriod} and ${customFieldFilled(r.agendamentoFieldId)}${canalF}`)
    : ploomes.countCustomDateInRange(`${p}${canalF}`, r.agendamentoFieldId, startIso, endIso);

  // Reuniao realizada:
  //   - Fortaleza (reuniaoFromCloserCreate): entrada no Funil Closer. Mensal =
  //     CreateDate do deal no Closer no periodo; safra = StartDate no Closer.
  //   - showFieldId / showFlagFieldId: modelos legados (SP usa a flag).
  let reuniaoQuery;
  if (r.reuniaoFromCloserCreate) {
    reuniaoQuery = safra
      ? ploomes.count(`${c} and ${leadPeriod}${canalF}`)
      : ploomes.count(`${c} and ${dateRange('CreateDate', startIso, endIso)}${canalF}`);
  } else if (r.showFieldId) {
    reuniaoQuery = safra
      ? ploomes.count(`${p} and ${leadPeriod} and ${customFieldFilled(r.showFieldId)}${canalF}`)
      : ploomes.countCustomDateInRange(`${p}${canalF}`, r.showFieldId, startIso, endIso);
  } else if (r.showFlagFieldId) {
    reuniaoQuery = safra
      ? ploomes.count(`${p} and ${leadPeriod} and ${customBoolTrue(r.showFlagFieldId)}${canalF}`)
      : ploomes.count(
          `${p} and ${customDateRange(r.agendamentoFieldId, startIso, endIso)}` +
            ` and ${customBoolTrue(r.showFlagFieldId)}${canalF}`,
        );
  } else {
    reuniaoQuery = Promise.resolve(null);
  }

  // Venda / Faturamento:
  //   - mensal: ganhos do funil de fechamento por FinishDate no periodo.
  //   - safra: ganhos cujo StartDate caiu no periodo. Como o StartDate propaga do
  //     SDR para o Closer, funciona igual para Fortaleza (Closer) e SP (funil
  //     unico), sem ligar Closer<->SDR.
  let vendaQuery;
  let faturamentoQuery;
  if (safra) {
    vendaQuery = ploomes.count(`${c} and ${leadPeriod} and StatusId eq ${wonStatusId}${canalF}${exclF}`);
    faturamentoQuery = ploomes.sumRevenue(closerPid, leadPeriod, revenueExtra);
  } else {
    vendaQuery = ploomes.count(
      `${c} and StatusId eq ${wonStatusId} and ${dateRange('FinishDate', startIso, endIso)}${canalF}${exclF}`,
    );
    faturamentoQuery = ploomes.sumRevenue(
      closerPid,
      dateRange('FinishDate', startIso, endIso),
      revenueExtra,
    );
  }

  const [leads, conexao, agendamento, reuniao, venda, faturamento] =
    await Promise.all([
      leadsQuery,
      conexaoQuery,
      agendamentoQuery,
      reuniaoQuery,
      vendaQuery,
      faturamentoQuery,
    ]);

  return { key, label: r.label, leads, conexao, agendamento, reuniao, venda, faturamento };
}

// Dias decorridos / totais / restantes do periodo (base do volume diario medio).
function periodDays(startIso, endIso, now) {
  const DAY = 86400000;
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const t = Math.min(Math.max(now.getTime(), start), end);
  const elapsed = Math.max((t - start) / DAY, 1 / 24); // >= 1h p/ evitar divisao por zero
  const total = (end - start) / DAY;
  return { elapsed, total, remaining: Math.max(total - elapsed, 0) };
}

// Enriquece um bloco de contagens com conversoes, ticket, hit rate e a PREVISAO
// DE FECHAMENTO (prov):
//   leads que ainda devem entrar ate o fim do periodo = volume diario medio de
//   leads (leads / dias decorridos) x dias restantes. Esses leads sao convertidos
//   pelas taxas atuais (lead -> etapa) e somados ao realizado. Faturamento = venda
//   prevista x ticket medio.
function decorate(base, days) {
  const ticket = safeDiv(base.faturamento, base.venda);
  const hasReuniao = base.reuniao != null;
  const vendaBase = hasReuniao ? base.reuniao : base.agendamento;

  const avgDailyLeads = safeDiv(base.leads, days.elapsed);
  const remainingLeads = avgDailyLeads * days.remaining; // leads que faltam chegar
  // prov da etapa = realizado + leads que faltam x taxa (lead -> etapa)
  const proj = (n) => Math.round(n + remainingLeads * safeDiv(n, base.leads));
  const provVenda = base.venda + remainingLeads * safeDiv(base.venda, base.leads);

  return {
    ...base,
    ticket,
    prov: {
      leads: Math.round(base.leads + remainingLeads),
      conexao: proj(base.conexao),
      agendamento: proj(base.agendamento),
      reuniao: hasReuniao ? proj(base.reuniao) : null,
      venda: Math.round(provVenda),
      faturamento: Math.round(provVenda * ticket),
    },
    conv: {
      conexao: safeDiv(base.conexao, base.leads), // Conexao / Leads
      agendamento: safeDiv(base.agendamento, base.conexao), // Agend. / Conexao
      reuniao: hasReuniao ? safeDiv(base.reuniao, base.agendamento) : null, // Reuniao / Agend.
      venda: safeDiv(base.venda, vendaBase), // Venda / (Reuniao ou Agend.)
    },
    hitRate: safeDiv(base.venda, base.leads), // Venda / Leads (ponta a ponta)
  };
}

// Soma as metas das regionais selecionadas (por etapa) para o funil consolidado.
// Aditivas: leads/conexao/agendamento/reuniao/venda/faturamento. Ticket nao soma.
function sumMetas(perRegional, metas) {
  const keys = ['leads', 'conexao', 'agendamento', 'reuniao', 'venda', 'faturamento'];
  const out = {};
  for (const k of keys) {
    let sum = null;
    for (const r of perRegional) {
      const m = metas && metas[r.key] && metas[r.key][k];
      if (m != null) sum = (sum || 0) + m;
    }
    out[k] = sum;
  }
  return out;
}

// Monta o payload completo do dashboard.
async function computeDashboard({ startIso, endIso, regional, canal, metas, now, view }) {
  const keys =
    regional && regionais[regional] ? [regional] : Object.keys(regionais);

  const perRegional = await Promise.all(
    keys.map((k) => computeRegional(k, startIso, endIso, canal, view)),
  );

  const days = periodDays(startIso, endIso, now);

  // Consolidado = soma das regionais selecionadas. Reuniao so existe onde ha
  // Closer; mantem null se nenhuma regional do recorte tiver a etapa.
  const anyReuniao = perRegional.some((r) => r.reuniao != null);
  const totalBase = perRegional.reduce(
    (acc, r) => ({
      leads: acc.leads + r.leads,
      conexao: acc.conexao + r.conexao,
      agendamento: acc.agendamento + r.agendamento,
      reuniao: anyReuniao ? acc.reuniao + (r.reuniao || 0) : null,
      venda: acc.venda + r.venda,
      faturamento: acc.faturamento + r.faturamento,
    }),
    {
      leads: 0,
      conexao: 0,
      agendamento: 0,
      reuniao: anyReuniao ? 0 : null,
      venda: 0,
      faturamento: 0,
    },
  );

  return {
    periodo: { start: startIso, end: endIso },
    view: view === 'safra' ? 'safra' : 'mensal',
    regionalFiltro: regional || 'todos',
    canalFiltro: canal || 'todos',
    geral: { ...decorate(totalBase, days), metas: sumMetas(perRegional, metas) },
    regionais: perRegional.map((r) => ({
      ...decorate(r, days),
      metas: (metas && metas[r.key]) || {},
    })),
  };
}

module.exports = { computeDashboard };
