// Busca metas das planilhas Google Sheets.
// As planilhas sao publicas (anyone with link), entao nao ha autenticacao.
// Cache de 10 minutos para evitar requests desnecessarios.

// SP: aba "1. COCKPIT - SÃO PAULO" (gid=772618110)
//   Planejado vem do painel da SDR Raissa (col[14]=etapa, col[15]=planejado).
//   Venda/faturamento/ticket nao sao preenchidos pelos closers -> ficam null.
const SP_SHEET_ID = '1GjD7-9nZ3Mj59ObIef1o2Sg4swqGi9tn4R2Ox2VjWi0';
const SP_COCKPIT_GID = '772618110';

// FOR: aba de SINC (gid=1374334804)
//   Planejado Trafego Pago (col[9]) para todas as etapas.
const FOR_SHEET_ID = '1zH_mwVAgzFVg6kefzZ6BFOKHhAKpHPujyJsUySGuYrk';
const FOR_SINC_GID = '1374334804';

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

let _cache = null;
let _cacheAt = 0;

// Converte numero brasileiro ("2.108" ou "580") para inteiro.
function parseIntBr(s) {
  if (!s || typeof s !== 'string') return null;
  const n = parseInt(s.replace(/\./g, ''), 10);
  return isNaN(n) ? null : n;
}

// Converte string monetaria brasileira ("R$ 600.000,00") para numero.
function parseBrl(s) {
  if (!s || typeof s !== 'string') return null;
  const n = parseFloat(s.replace(/R\$\s*/, '').replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

// Parser simples de linha CSV com campos entre aspas.
function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
    else { cur += ch; }
  }
  cols.push(cur);
  return cols;
}

// Busca CSV de uma URL publica do Google Sheets.
async function fetchCsv(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheets HTTP ${res.status}: ${url}`);
  return res.text();
}

// --- SP: aba "1. COCKPIT - SÃO PAULO" (gid=772618110) ---
// Planejado vem do painel da SDR Raissa:
//   col[14] = nome da etapa ("Leads", "Conectadas", "Agendamentos", "Realizadas")
//   col[15] = valor Planejado
// Mapeamento:
//   "Leads"        -> leads
//   "Conectadas"   -> conexao
//   "Agendamentos" -> agendamento
//   "Realizadas"   -> reuniao  (show/reuniao realizada)
// Venda, faturamento e ticket ficam null (closers nao preencheram o planejado).
function parseSpCockpit(csv) {
  const rows = csv.split('\n').map(parseCsvLine);
  const metas = { leads: null, conexao: null, agendamento: null, reuniao: null, venda: null, faturamento: null, ticket: null };

  for (const row of rows) {
    const label = (row[14] || '').trim();
    const planejado = (row[15] || '').trim();
    if (!planejado) continue;

    // Usa apenas a primeira ocorrencia de cada etapa (painel da Raissa, no topo).
    // As secoes seguintes (Bases de Recuperacao, paineis de Closers) repetem os
    // mesmos labels com valores diferentes e devem ser ignoradas.
    if (label === 'Leads'        && metas.leads       === null) metas.leads       = parseIntBr(planejado);
    if (label === 'Conectadas'   && metas.conexao     === null) metas.conexao     = parseIntBr(planejado);
    if (label === 'Agendamentos' && metas.agendamento === null) metas.agendamento = parseIntBr(planejado);
    if (label === 'Realizadas'   && metas.reuniao     === null) metas.reuniao     = parseIntBr(planejado);
  }

  return metas;
}

// --- FOR: aba SINC (gid=1374334804) ---
// Estrutura relevante:
//   col[1]  = "R$ 1.500.000,00" (meta faturamento, primeira linha de dados)
//   col[8]  = nome da etapa ("Leads", "Conectados", "Agendados", "Shows", "Vendas")
//   col[9]  = Planejado Trafego Pago
//   col[2]  = ticket medio (linha logo apos a linha com "TKM" em col[1])
function parseForSinc(csv) {
  const rows = csv.split('\n').map(parseCsvLine);
  const metas = { leads: null, conexao: null, agendamento: null, reuniao: null, venda: null, faturamento: null, ticket: null };

  let nextRowIsTicket = false;

  for (const row of rows) {
    const label = (row[8] || '').trim();
    const planejado = (row[9] || '').trim();

    if (label === 'Leads')      metas.leads = parseIntBr(planejado);
    if (label === 'Conectados') metas.conexao = parseIntBr(planejado);
    if (label === 'Agendados')  metas.agendamento = parseIntBr(planejado);
    if (label === 'Shows')      metas.reuniao = parseIntBr(planejado);
    if (label === 'Vendas')     metas.venda = parseIntBr(planejado);

    // Meta de faturamento: primeira celula col[1] com "R$" e valor >= 100.000
    if (metas.faturamento === null) {
      const v = parseBrl((row[1] || '').trim());
      if (v !== null && v >= 100000) metas.faturamento = v;
    }

    // Ticket medio: linha com "TKM" em col[1] sinaliza que a proxima tem o valor em col[2]
    if ((row[1] || '').trim().toUpperCase().startsWith('TKM')) {
      nextRowIsTicket = true;
    } else if (nextRowIsTicket) {
      const v = parseBrl((row[2] || '').trim());
      if (v !== null && v >= 1000 && v <= 500000) metas.ticket = v;
      nextRowIsTicket = false;
    }
  }

  return metas;
}

// Busca e cacheia as metas de ambas as planilhas.
async function fetchMetas() {
  const now = Date.now();
  if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;

  const spUrl = `https://docs.google.com/spreadsheets/d/${SP_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SP_COCKPIT_GID}`;
  const forUrl = `https://docs.google.com/spreadsheets/d/${FOR_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${FOR_SINC_GID}`;

  const [spCsv, forCsv] = await Promise.all([fetchCsv(spUrl), fetchCsv(forUrl)]);

  _cache = {
    'sao-paulo': parseSpCockpit(spCsv),
    fortaleza: parseForSinc(forCsv),
  };
  _cacheAt = now;

  return _cache;
}

module.exports = { fetchMetas };
