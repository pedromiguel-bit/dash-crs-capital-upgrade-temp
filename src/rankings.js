// Rankings de SDR e Closer por região, a partir das contagens por owner da Ploomes.
//
// SDR    = quem trabalha o topo do funil de aquisição. Ranqueado por agendamentos
//          (entrada na etapa de apresentação, via campo de data customizado).
// Closer = quem fecha. Ranqueado por vendas (ganhos do pipeline de fechamento).
//
// São Paulo tem funil único: os mesmos owners aparecem nos dois rankings
// (SDR pelo Funil Resultado; Closer pelos ganhos do mesmo funil).
// Fortaleza usa Funil SDR (agendamentos) + Funil Closer (vendas).

const { regionais, wonStatusId } = require('../config/funnels');
const ploomes = require('./ploomes');

function dateRange(field, startIso, endIso) {
  return `${field} ge ${startIso} and ${field} le ${endIso}`;
}

function customDateRange(fieldId, startIso, endIso) {
  return (
    `OtherProperties/any(o: o/FieldId eq ${fieldId}` +
    ` and o/DateTimeValue ge ${startIso} and o/DateTimeValue le ${endIso})`
  );
}

// "atingiu a etapa" (safra): campo de data preenchido em qualquer data.
function customFieldFilled(fieldId) {
  return `OtherProperties/any(o: o/FieldId eq ${fieldId} and o/DateTimeValue ne null)`;
}

// Campo "Vendedor" (usuário) = o CLOSER que fechou o negócio. Usado no breakdown
// de hit rate por closer. Quando vazio, cai no OwnerId do deal de fechamento.
const VENDEDOR_FIELD = 111066744;

// Mapa ContactId -> ownerId do SDR (deal mais recente no funil de aquisição).
// Usado em Fortaleza para ligar o ganho do Closer ao SDR que originou o lead.
async function sdrOwnerByContact(pFilter, contactIds) {
  const acc = {}; // contactId -> { owner, start }
  for (let i = 0; i < contactIds.length; i += 20) {
    const chunk = contactIds.slice(i, i + 20);
    const ors = chunk.map((id) => `ContactId eq ${id}`).join(' or ');
    const rows = await ploomes.listDeals(`${pFilter} and (${ors})`, {
      select: 'ContactId,OwnerId,StartDate',
    });
    for (const d of rows) {
      if (d.ContactId == null) continue;
      const cur = acc[d.ContactId];
      if (!cur || (d.StartDate || '') > cur.start) {
        acc[d.ContactId] = { owner: d.OwnerId, start: d.StartDate || '' };
      }
    }
  }
  const out = {};
  for (const k in acc) out[k] = acc[k].owner;
  return out;
}

// Junta listas [{ownerId,...}] num mapa por ownerId, mesclando campos.
function mergeByOwner(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const row of list) {
      const cur = map.get(row.ownerId) || { ownerId: row.ownerId };
      map.set(row.ownerId, { ...cur, ...row });
    }
  }
  return [...map.values()];
}

// Monta a lista final de SDRs a partir de contagens por owner, calculando as
// taxas (CR1/CR2/CR3, Win Rate, Hit Rate) e ordenando por CR2. Filtra quem tem
// agendamento > 0.
function buildSdrRows(byOwner) {
  return Object.values(byOwner)
    .map((b) => {
      const closers = Object.values(b.closers)
        .map((cl) => ({
          closerId: cl.closerId,
          name: cl.name || null,
          realizadas: cl.realizadas,
          vendas: cl.vendas,
          winRate: cl.realizadas > 0 ? cl.vendas / cl.realizadas : 0,
        }))
        .sort((a, b2) => b2.vendas - a.vendas || b2.realizadas - a.realizadas);
      return {
        ownerId: b.ownerId,
        leads: b.leads,
        conexoes: b.conexoes,
        agendamentos: b.agendamentos,
        realizadas: b.realizadas,
        vendas: b.vendas,
        taxaConexao: b.leads > 0 ? b.conexoes / b.leads : 0, // CR1: lead -> conexão
        taxaAgendamento: b.conexoes > 0 ? b.agendamentos / b.conexoes : 0, // CR2: conexão -> agend.
        taxaReuniao: b.agendamentos > 0 ? b.realizadas / b.agendamentos : 0, // CR3: agend. -> realizada
        winRate: b.realizadas > 0 ? b.vendas / b.realizadas : 0, // realizada -> venda
        hitRate: b.leads > 0 ? b.vendas / b.leads : 0, // lead -> venda
        closers,
      };
    })
    .filter((x) => x.agendamentos > 0)
    .sort((a, b) => b.taxaAgendamento - a.taxaAgendamento);
}

// Monta a lista final de CLOSERS: base = reuniões realizadas, win rate =
// venda ÷ realizada, + breakdown por SDR. Ordenado por vendas (frontend reordena).
function buildCloserRows(byCloser) {
  return Object.values(byCloser)
    .map((b) => {
      const sdrs = Object.values(b.sdrs)
        .map((s) => ({
          sdrId: s.sdrId,
          name: s.name || null,
          realizadas: s.realizadas,
          vendas: s.vendas,
          winRate: s.realizadas > 0 ? s.vendas / s.realizadas : 0,
        }))
        .sort((a, b2) => b2.vendas - a.vendas || b2.realizadas - a.realizadas);
      return {
        closerId: b.closerId,
        name: b.name || null,
        realizadas: b.realizadas,
        vendas: b.vendas,
        faturamento: b.faturamento,
        winRate: b.realizadas > 0 ? b.vendas / b.realizadas : 0, // realizada -> venda
        sdrs,
      };
    })
    .filter((x) => x.realizadas > 0)
    .sort((a, b) => b.vendas - a.vendas);
}

// Ranking de CLOSER: a partir das próprias reuniões realizadas (cada uma com
// Vendedor = closer). venda = ganho entre elas -> win rate <= 100%. Breakdown por
// SDR que originou cada reunião.
//   Safra: reuniões com StartDate no período. Mensal: pela data própria da reunião
//   (FOR = CreateDate no Closer; SP = "Data reunião realizada").
async function closerRanking(r, p, c, startIso, endIso, canalF, safra) {
  let filter;
  if (r.closerPipelineId) {
    filter = `${c} and ${dateRange(safra ? 'StartDate' : 'CreateDate', startIso, endIso)}${canalF}`;
  } else if (r.showFieldId) {
    filter = safra
      ? `${c} and ${dateRange('StartDate', startIso, endIso)} and ${customFieldFilled(r.showFieldId)}${canalF}`
      : `${c} and ${customDateRange(r.showFieldId, startIso, endIso)}${canalF}`;
  } else {
    filter = `${c} and ${dateRange(safra ? 'StartDate' : 'CreateDate', startIso, endIso)}${canalF}`;
  }
  const deals = await ploomes.listDeals(filter, {
    select: 'Id,OwnerId,ContactId,StatusId,Amount',
    expand: `OtherProperties($filter=FieldId eq ${VENDEDOR_FIELD};$select=UserValueId,UserValueName)`,
  });

  // SDR que originou cada reunião: FOR pelo ContactId; SP pelo OwnerId do deal.
  let contactToSdr = {};
  if (r.closerPipelineId) {
    const cids = [...new Set(deals.map((d) => d.ContactId).filter((x) => x != null))];
    contactToSdr = await sdrOwnerByContact(p, cids);
  }
  const sdrOf = (d) => (r.closerPipelineId ? contactToSdr[d.ContactId] : d.OwnerId);

  const byCloser = {};
  for (const d of deals) {
    const vp = (d.OtherProperties || [])[0];
    const cid = (vp && vp.UserValueId) || d.OwnerId; // fallback: dono do deal
    if (cid == null) continue;
    const cname = (vp && vp.UserValueName) || null;
    const won = d.StatusId === wonStatusId;
    const b =
      byCloser[cid] ||
      (byCloser[cid] = { closerId: cid, name: cname, realizadas: 0, vendas: 0, faturamento: 0, sdrs: {} });
    if (cname && !b.name) b.name = cname;
    b.realizadas += 1;
    if (won) {
      b.vendas += 1;
      b.faturamento += d.Amount || 0;
    }
    const sid = sdrOf(d);
    if (sid != null) {
      const bs = b.sdrs[sid] || (b.sdrs[sid] = { sdrId: sid, name: null, realizadas: 0, vendas: 0 });
      bs.realizadas += 1;
      if (won) bs.vendas += 1;
    }
  }
  return buildCloserRows(byCloser);
}

// SAFRA: funil por DEAL da coorte, de forma CUMULATIVA — alcançar uma etapa
// posterior conta em todas as anteriores. Isso garante o aninhamento
// (venda ⊆ realizada ⊆ agendamento ⊆ conexão ⊆ leads) e, portanto, CR ≤ 100%.
async function sdrSafra(r, p, c, startIso, endIso, canalF) {
  const cohortPeriod = dateRange('StartDate', startIso, endIso);
  const fields = [r.conexaoFieldId, r.agendamentoFieldId, VENDEDOR_FIELD];
  if (r.showFieldId) fields.push(r.showFieldId);
  const expand =
    `OtherProperties($filter=${fields.map((f) => `FieldId eq ${f}`).join(' or ')}` +
    `;$select=FieldId,DateTimeValue,UserValueId,UserValueName)`;

  // Coorte = deals do funil de aquisição que startaram no período.
  const cohort = await ploomes.listDeals(`${p} and ${cohortPeriod}${canalF}`, {
    select: 'Id,OwnerId,ContactId,StatusId',
    expand,
  });

  // Fortaleza: liga ao Closer (realizada = entrou no Closer; venda = ganho).
  const realizadaContact = {};
  const wonContact = {};
  const vendByContact = {}; // contato -> { id, name } do closer (prefere o do ganho)
  if (r.closerPipelineId) {
    const closerDeals = await ploomes.listDeals(`${c} and ${cohortPeriod}${canalF}`, {
      select: 'ContactId,StatusId',
      expand: `OtherProperties($filter=FieldId eq ${VENDEDOR_FIELD};$select=UserValueId,UserValueName)`,
    });
    for (const d of closerDeals) {
      if (d.ContactId == null) continue;
      realizadaContact[d.ContactId] = true;
      const vp = (d.OtherProperties || [])[0];
      const won = d.StatusId === wonStatusId;
      if (won) wonContact[d.ContactId] = true;
      if (won || !vendByContact[d.ContactId]) {
        vendByContact[d.ContactId] = {
          id: (vp && vp.UserValueId) || null,
          name: (vp && vp.UserValueName) || null,
        };
      }
    }
  }

  const byOwner = {};
  for (const d of cohort) {
    const o = d.OwnerId;
    if (o == null) continue;
    const dt = {};
    let vendSelf = null; // vendedor no próprio deal (SP)
    for (const pr of d.OtherProperties || []) {
      if (pr.FieldId === VENDEDOR_FIELD) {
        if (pr.UserValueId) vendSelf = { id: pr.UserValueId, name: pr.UserValueName || null };
      } else if (pr.DateTimeValue != null) {
        dt[pr.FieldId] = true;
      }
    }
    const conexStamp = !!dt[r.conexaoFieldId];
    const agendStamp = !!dt[r.agendamentoFieldId];

    let realizada;
    let venda;
    let closerInfo;
    if (r.closerPipelineId) {
      realizada = !!realizadaContact[d.ContactId];
      venda = !!wonContact[d.ContactId];
      closerInfo = vendByContact[d.ContactId] || null;
    } else {
      realizada = r.showFieldId ? !!dt[r.showFieldId] : false;
      venda = d.StatusId === wonStatusId;
      closerInfo = vendSelf;
    }

    // Cumulativo: etapa posterior implica todas as anteriores.
    const vendaR = venda;
    const realizadaR = realizada || vendaR;
    const agendR = agendStamp || realizadaR;
    const conexR = conexStamp || agendR;

    const b =
      byOwner[o] ||
      (byOwner[o] = { ownerId: o, leads: 0, conexoes: 0, agendamentos: 0, realizadas: 0, vendas: 0, closers: {} });
    b.leads += 1;
    if (conexR) b.conexoes += 1;
    if (agendR) b.agendamentos += 1;
    if (realizadaR) b.realizadas += 1;
    if (vendaR) b.vendas += 1;

    if (realizadaR) {
      const cid = (closerInfo && closerInfo.id) || 'sem-closer';
      const bc =
        b.closers[cid] ||
        (b.closers[cid] = {
          closerId: cid,
          name: (closerInfo && closerInfo.name) || (cid === 'sem-closer' ? 'Sem closer' : null),
          realizadas: 0,
          vendas: 0,
        });
      bc.realizadas += 1;
      if (vendaR) bc.vendas += 1;
    }
  }

  return buildSdrRows(byOwner);
}

// MENSAL: volume no período (cada etapa pela sua própria data). Atribuição da
// venda/realizada por contagem agregada + link Closer→SDR por contato. Pode
// passar de 100% entre etapas (coortes diferentes) — é o esperado nessa visão.
async function sdrMensal(r, p, c, startIso, endIso, canalF) {
  const leadsFilter = `${p} and ${dateRange('CreateDate', startIso, endIso)}${canalF}`;
  const conexaoFilter = `${p} and ${customDateRange(r.conexaoFieldId, startIso, endIso)}${canalF}`;
  const agendFilter = `${p} and ${customDateRange(r.agendamentoFieldId, startIso, endIso)}${canalF}`;
  const wonFilter = `${c} and StatusId eq ${wonStatusId} and ${dateRange('FinishDate', startIso, endIso)}${canalF}`;
  const vendExpand = `OtherProperties($filter=FieldId eq ${VENDEDOR_FIELD};$select=UserValueId,UserValueName)`;

  // Reuniões realizadas (denominador do win rate por closer):
  //   FOR = entradas no Closer (CreateDate); SP = "Data reunião realizada".
  let closerSideFilter;
  if (r.closerPipelineId) {
    closerSideFilter = `${c} and ${dateRange('CreateDate', startIso, endIso)}${canalF}`;
  } else if (r.showFieldId) {
    closerSideFilter = `${c} and ${customDateRange(r.showFieldId, startIso, endIso)}${canalF}`;
  } else {
    closerSideFilter = `${c} and ${dateRange('CreateDate', startIso, endIso)}${canalF}`;
  }

  const [leadsByOwner, conexaoByOwner, agendByOwner, closerDeals, wonDeals] = await Promise.all([
    ploomes.countByOwner(leadsFilter),
    ploomes.countByOwner(conexaoFilter),
    ploomes.countByOwner(agendFilter),
    ploomes.listDeals(closerSideFilter, { select: 'Id,OwnerId,ContactId,StatusId', expand: vendExpand }),
    ploomes.listDeals(wonFilter, { select: 'Id,OwnerId,ContactId' }),
  ]);

  // Atribuição ao SDR: FOR por ContactId; SP por OwnerId do próprio deal.
  let contactToSdr = {};
  if (r.closerPipelineId) {
    const cids = [
      ...new Set([...closerDeals, ...wonDeals].map((d) => d.ContactId).filter((x) => x != null)),
    ];
    contactToSdr = await sdrOwnerByContact(p, cids);
  }
  const sdrOf = (d) => (r.closerPipelineId ? contactToSdr[d.ContactId] : d.OwnerId);

  // Base por owner a partir das contagens agregadas.
  const byOwner = {};
  const ensure = (o) =>
    byOwner[o] ||
    (byOwner[o] = { ownerId: o, leads: 0, conexoes: 0, agendamentos: 0, realizadas: 0, vendas: 0, closers: {} });
  leadsByOwner.forEach((x) => (ensure(x.ownerId).leads = x.count));
  conexaoByOwner.forEach((x) => (ensure(x.ownerId).conexoes = x.count));
  agendByOwner.forEach((x) => (ensure(x.ownerId).agendamentos = x.count));

  // Vendas por SDR + breakdown por closer.
  for (const d of wonDeals) {
    const s = sdrOf(d);
    if (s == null) continue;
    ensure(s).vendas += 1;
  }
  for (const d of closerDeals) {
    const s = sdrOf(d);
    if (s == null) continue;
    const vp = (d.OtherProperties || [])[0];
    const cid = (vp && vp.UserValueId) || 'sem-closer';
    const name = (vp && vp.UserValueName) || (cid === 'sem-closer' ? 'Sem closer' : null);
    const b = ensure(s);
    b.realizadas += 1;
    const bc = b.closers[cid] || (b.closers[cid] = { closerId: cid, name, realizadas: 0, vendas: 0 });
    if (d.StatusId === wonStatusId) bc.vendas += 1;
    bc.realizadas += 1;
  }

  return buildSdrRows(byOwner);
}

// Rankings de uma regional no período (com recorte opcional por canal/OriginId).
async function computeRegionRankings(key, startIso, endIso, canalF, view) {
  const r = regionais[key];
  const p = `PipelineId eq ${r.pipelineId}`;
  const closerPid = r.closerPipelineId || r.pipelineId;
  const c = `PipelineId eq ${closerPid}`;
  const safra = view === 'safra';

  // Ranking de SDR (5 métricas + breakdown por closer).
  const sdr = safra
    ? await sdrSafra(r, p, c, startIso, endIso, canalF)
    : await sdrMensal(r, p, c, startIso, endIso, canalF);

  // Ranking de Closer (base = reuniões realizadas; win rate = venda ÷ realizada;
  // breakdown por SDR).
  const closer = await closerRanking(r, p, c, startIso, endIso, canalF, safra);

  return { key, label: r.label, sdr, closer };
}

async function computeRankings({ startIso, endIso, regional, canal, view }) {
  const keys =
    regional && regionais[regional] ? [regional] : Object.keys(regionais);
  const canalF = canal ? ` and OriginId eq ${canal}` : '';

  const regioes = await Promise.all(
    keys.map((k) => computeRegionRankings(k, startIso, endIso, canalF, view)),
  );

  // Resolve os nomes de todos os owners/closers/sdrs que apareceram, num lote.
  const ids = [];
  regioes.forEach((rg) => {
    rg.sdr.forEach((x) => {
      ids.push(x.ownerId);
      x.closers.forEach((cl) => ids.push(cl.closerId));
    });
    rg.closer.forEach((x) => {
      ids.push(x.closerId);
      x.sdrs.forEach((s) => ids.push(s.sdrId));
    });
  });
  // Resolve só ids numéricos ('sem-closer' já vem com nome próprio).
  const names = await ploomes.users(ids.filter((id) => typeof id === 'number'));
  const nameOf = (id, fallback) =>
    fallback || (id === 'sem-closer' ? 'Sem closer' : names[id]);

  const withSdrNames = (rows) =>
    rows.map((x) => ({
      ...x,
      name: names[x.ownerId],
      closers: x.closers.map((cl) => ({ ...cl, name: nameOf(cl.closerId, cl.name) })),
    }));
  const withCloserNames = (rows) =>
    rows.map((x) => ({
      ...x,
      name: nameOf(x.closerId, x.name),
      sdrs: x.sdrs.map((s) => ({ ...s, name: nameOf(s.sdrId, s.name) })),
    }));

  return {
    regioes: regioes.map((rg) => ({
      key: rg.key,
      label: rg.label,
      sdr: withSdrNames(rg.sdr),
      closer: withCloserNames(rg.closer),
    })),
  };
}

module.exports = { computeRankings };
