// Cliente minimo da API publica da Ploomes (OData / api2.ploomes.com).
// Expoe contagem por filtro e soma de faturamento. A chave fica so no servidor.

const { base, wonStatusId, revenueFieldId } = require('../config/funnels');

const USER_KEY = process.env['ploomes-api'];
if (!USER_KEY) {
  console.error('ERRO: variavel "ploomes-api" nao encontrada no .env');
}

const CONCURRENCY = 4;
let active = 0;
const queue = [];

function schedule(fn) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    pump();
  });
}

function pump() {
  if (active >= CONCURRENCY || queue.length === 0) return;
  const { fn, resolve, reject } = queue.shift();
  active++;
  fn().then(resolve, reject).finally(() => {
    active--;
    pump();
  });
}

// Monta a query string preservando os operadores OData, codificando so espacos.
function buildUrl(path, params) {
  const qs = Object.entries(params)
    .map(([k, v]) => `${k}=${String(v).replace(/ /g, '%20')}`)
    .join('&');
  return `${base}${path}?${qs}`;
}

// Executa o fetch com timeout e retry — sem re-agendar (evita deadlock no scheduler).
async function doFetch(url, attempt = 1) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000); // 15s timeout por tentativa
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Key': USER_KEY }, signal: ctrl.signal });
  } catch (err) {
    clearTimeout(timer);
    if (attempt <= 4) {
      const wait = 400 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
      return doFetch(url, attempt + 1);
    }
    throw new Error(`Ploomes fetch falhou: ${err.message}`);
  }
  clearTimeout(timer);
  if (res.status === 429 || res.status >= 500) {
    if (attempt <= 4) {
      const wait = 400 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, wait));
      return doFetch(url, attempt + 1);
    }
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ploomes ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function request(url) {
  return schedule(() => doFetch(url));
}

// Conta deals que satisfazem o filtro OData via $apply/aggregate.
// Mais eficiente que $count=true para filtros com OtherProperties/any().
async function count(filter) {
  const url = buildUrl('/Deals', {
    $apply: `filter(${filter})/aggregate($count as Total)`,
  });
  const data = await request(url);
  return (data.value && data.value[0] && data.value[0].Total) || 0;
}

// Soma o faturamento dos deals ganhos do pipeline dentro do periodo (por FinishDate).
// `extra` permite recortes adicionais (ex.: canal/OriginId).
async function sumRevenue(pipelineId, periodFilter, extra) {
  const wonFilter =
    `PipelineId eq ${pipelineId} and StatusId eq ${wonStatusId}` +
    (periodFilter ? ` and ${periodFilter}` : '') +
    (extra ? ` and ${extra}` : '');

  // Sem campo de receita configurado: usa o Amount nativo via agregacao.
  if (!revenueFieldId) {
    const url = buildUrl('/Deals', {
      $apply: `filter(${wonFilter})/aggregate(Amount with sum as Total)`,
    });
    const data = await request(url);
    return (data.value && data.value[0] && data.value[0].Total) || 0;
  }

  // Com campo customizado: pagina os ganhos e soma o DecimalValue do campo.
  let total = 0;
  let skip = 0;
  const pageSize = 200;
  for (;;) {
    const url = buildUrl('/Deals', {
      $filter: wonFilter,
      $top: pageSize,
      $skip: skip,
      $select: 'Id',
      $expand: `OtherProperties($filter=FieldId eq ${revenueFieldId};$select=DecimalValue,IntegerValue)`,
    });
    const data = await request(url);
    const rows = data.value || [];
    for (const d of rows) {
      const p = (d.OtherProperties || [])[0];
      if (p) total += p.DecimalValue || p.IntegerValue || 0;
    }
    if (rows.length < pageSize) break;
    skip += pageSize;
  }
  return total;
}

// Lista deals (paginado) com $select/$expand opcionais. Para joins/breakdowns
// que precisam de dados por-deal (e nao so contagem agregada).
async function listDeals(filter, { select, expand } = {}) {
  const out = [];
  let skip = 0;
  const top = 300;
  for (;;) {
    const params = { $filter: filter, $top: top, $skip: skip };
    if (select) params.$select = select;
    if (expand) params.$expand = expand;
    const data = await request(buildUrl('/Deals', params));
    const rows = data.value || [];
    out.push(...rows);
    if (rows.length < top) break;
    skip += top;
  }
  return out;
}

// Lista os canais (Origens) usados nos pipelines informados, com nome e volume.
// Resultado cacheado em memoria pelo ciclo de vida do processo (muda raramente).
let _originsCache = null;
async function origins(pipelineIds) {
  if (_originsCache) return _originsCache;

  // 1. groupby OriginId em cada pipeline para descobrir os ids em uso.
  const counts = new Map();
  for (const pid of pipelineIds) {
    const apply = `filter(PipelineId eq ${pid})/groupby((OriginId),aggregate($count as Total))`;
    const data = await request(buildUrl('/Deals', { $apply: apply }));
    for (const row of data.value || []) {
      if (row.OriginId == null) continue;
      counts.set(row.OriginId, (counts.get(row.OriginId) || 0) + (row.Total || 0));
    }
  }

  // 2. resolve o nome de cada canal (1 deal de amostra por id).
  const ids = [...counts.keys()];
  const named = await Promise.all(
    ids.map(async (id) => {
      const url = buildUrl('/Deals', {
        $top: 1,
        $select: 'Id',
        $expand: 'Origin($select=Id,Name)',
        $filter: `OriginId eq ${id}`,
      });
      const data = await request(url);
      const d = (data.value || [])[0];
      const name = (d && d.Origin && d.Origin.Name) || `Origem ${id}`;
      return { id, name, count: counts.get(id) };
    }),
  );

  _originsCache = named.sort((a, b) => b.count - a.count);
  return _originsCache;
}

// groupby OwnerId com $count. Retorna [{ ownerId, count }].
async function countByOwner(filter) {
  const apply = `filter(${filter})/groupby((OwnerId),aggregate($count as Total))`;
  const data = await request(buildUrl('/Deals', { $apply: apply }));
  return (data.value || [])
    .filter((r) => r.OwnerId != null)
    .map((r) => ({ ownerId: r.OwnerId, count: r.Total || 0 }));
}

// groupby OwnerId nos ganhos: $count + soma de Amount. Retorna [{ ownerId, vendas, faturamento }].
async function wonByOwner(filter) {
  const apply =
    `filter(${filter})/groupby((OwnerId),aggregate($count as Total, Amount with sum as Fat))`;
  const data = await request(buildUrl('/Deals', { $apply: apply }));
  return (data.value || [])
    .filter((r) => r.OwnerId != null)
    .map((r) => ({ ownerId: r.OwnerId, vendas: r.Total || 0, faturamento: r.Fat || 0 }));
}

// Conta deals cujo campo de DATA customizado (DateTimeValue) cai no período.
// Evita o agregado OtherProperties/any(... ge..le), que é caro e instável na
// Ploomes em pipelines grandes (chega a 504/timeout). Em vez disso lista só os
// deals com o campo preenchido (ne null — barato/estável) e filtra o intervalo
// localmente. `baseFilter` recorta pipeline/canal/etc. Retorna o total.
async function countCustomDateInRange(baseFilter, fieldId, startIso, endIso) {
  const rows = await listDeals(
    `${baseFilter} and OtherProperties/any(o: o/FieldId eq ${fieldId} and o/DateTimeValue ne null)`,
    { select: 'Id', expand: `OtherProperties($filter=FieldId eq ${fieldId};$select=DateTimeValue)` },
  );
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  let total = 0;
  for (const d of rows) {
    const v = (d.OtherProperties || [])[0];
    if (!v || !v.DateTimeValue) continue;
    const t = new Date(v.DateTimeValue).getTime();
    if (t >= s && t <= e) total += 1;
  }
  return total;
}

// Igual ao countCustomDateInRange, mas agrupado por OwnerId. [{ ownerId, count }].
async function countByOwnerCustomDateInRange(baseFilter, fieldId, startIso, endIso) {
  const rows = await listDeals(
    `${baseFilter} and OtherProperties/any(o: o/FieldId eq ${fieldId} and o/DateTimeValue ne null)`,
    { select: 'Id,OwnerId', expand: `OtherProperties($filter=FieldId eq ${fieldId};$select=DateTimeValue)` },
  );
  const s = new Date(startIso).getTime();
  const e = new Date(endIso).getTime();
  const map = new Map();
  for (const d of rows) {
    if (d.OwnerId == null) continue;
    const v = (d.OtherProperties || [])[0];
    if (!v || !v.DateTimeValue) continue;
    const t = new Date(v.DateTimeValue).getTime();
    if (t >= s && t <= e) map.set(d.OwnerId, (map.get(d.OwnerId) || 0) + 1);
  }
  return [...map.entries()].map(([ownerId, count]) => ({ ownerId, count }));
}

// Resolve nomes de usuarios por Id (lote, com cache em memoria pelo processo).
const _userCache = new Map();
async function users(ids) {
  const missing = [...new Set(ids)].filter((id) => !_userCache.has(id));
  // Resolve em lotes para nao estourar o tamanho do $filter.
  for (let i = 0; i < missing.length; i += 25) {
    const chunk = missing.slice(i, i + 25);
    const filter = chunk.map((id) => `Id eq ${id}`).join(' or ');
    const url = buildUrl('/Users', { $filter: filter, $select: 'Id,Name', $top: 50 });
    const data = await request(url);
    for (const u of data.value || []) _userCache.set(u.Id, u.Name);
  }
  const out = {};
  ids.forEach((id) => (out[id] = _userCache.get(id) || `Usuário ${id}`));
  return out;
}

module.exports = { count, sumRevenue, listDeals, origins, countByOwner, wonByOwner, countCustomDateInRange, countByOwnerCustomDateInRange, users };
