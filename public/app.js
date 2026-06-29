// Front do dashboard Capital Upgrade. Busca /api/dashboard e renderiza
// o funil geral, a eficiencia e os cards por regional.

const $ = (id) => document.getElementById(id);

const fmtInt = (n) => Math.round(n || 0).toLocaleString('pt-BR');
const fmtBRL = (n) =>
  (n || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
const fmtPct = (r) => `${Math.round((r || 0) * 100)}%`;
// Hit rate é pequeno (vendas/leads ~2%); duas casas para não arredondar p/ 0.
const fmtPct2 = (r) =>
  `${((r || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

function setDefaultDates() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  $('f-start').value = iso(start);
  $('f-end').value = iso(now);
}

// Visao atual: 'mensal' (default) | 'safra'. Controlada pelo toggle #f-view.
let currentView = 'mensal';

// Monta os filtros atuais (período/visão/região/canal) como query string.
function currentParams() {
  const params = new URLSearchParams();
  if ($('f-start').value) params.set('start', $('f-start').value);
  if ($('f-end').value) params.set('end', $('f-end').value);
  params.set('view', currentView);
  if ($('f-regional').value) params.set('regional', $('f-regional').value);
  if ($('f-canal').value) params.set('canal', $('f-canal').value);
  return params;
}

// ---------- Skeleton (transição suave entre visões) ----------
const skLine = (w, h, m) =>
  `<div class="skeleton sk-line" style="width:${w};${h ? `height:${h};` : ''}${m ? `margin:${m};` : ''}"></div>`;
const rep = (n, fn) => Array.from({ length: n }, fn).join('');

function skStage(grow, dark) {
  return `<div class="sk-card stage${dark ? ' dark' : ''}" style="flex-grow:${grow}">
    ${skLine('50%', '10px', '0 0 0')}
    <div class="skeleton" style="width:72%;height:26px;margin:12px 0 14px"></div>
    ${skLine('100%', '6px', '0')}
  </div>`;
}
const skEff = () => `<div class="sk-card eff-card" style="min-width:200px">
  ${skLine('55%', '10px', '0 auto')}
  <div class="skeleton" style="width:60%;height:24px;margin:12px auto 0"></div>
</div>`;
const skRegCard = () => `<div class="sk-card">
  ${skLine('42%', '16px', '0 0 16px')}${rep(6, () => skLine('100%'))}
  <div class="skeleton" style="width:55%;height:26px;margin:18px 0 0"></div>
</div>`;
const skRankCard = () => `<div class="sk-card">
  ${skLine('35%', '16px', '0 0 16px')}${rep(7, () => skLine('100%'))}
</div>`;

// Mostra placeholders shimmer no lugar do conteúdo enquanto carrega.
function showSkeleton() {
  $('loading').hidden = true;
  const n = $('f-regional').value ? 1 : 2; // 1 card se filtrar uma regional
  $('funnel').innerHTML = [skStage(1), skStage(1), skStage(1), skStage(1), skStage(1), skStage(1.7, true)].join('');
  $('funnel').hidden = false;
  $('efficiency').innerHTML = skEff() + skEff();
  $('efficiency').hidden = false;
  $('regional').innerHTML = rep(n, skRegCard);
  document.querySelector('.regional-wrap').hidden = false;
  $('rank-sdr').innerHTML = rep(n, skRankCard);
  $('rank-closer').innerHTML = rep(n, skRankCard);
  document.querySelectorAll('.ranking-wrap').forEach((el) => (el.hidden = false));
}

// Reinicia a animação de fade-in num container (força reflow).
function fadeIn(el) {
  if (!el) return;
  el.classList.remove('caup-fade-in');
  void el.offsetWidth;
  el.classList.add('caup-fade-in');
}

async function load() {
  $('error').hidden = true;
  showSkeleton();

  const qs = currentParams().toString();

  try {
    const res = await fetch('/api/dashboard?' + qs, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || 'Erro');
    render(data);
  } catch (err) {
    document
      .querySelectorAll('#funnel, #efficiency, .regional-wrap, .ranking-wrap')
      .forEach((el) => (el.hidden = true));
    $('error').textContent = 'Não foi possível carregar: ' + err.message;
    $('error').hidden = false;
  }

  loadRankings(qs); // carrega os rankings em seguida, sem travar o dashboard
}

// ---------- Funil geral ----------
const STAGES = [
  { key: 'leads', name: 'Leads' },
  { key: 'conexao', name: 'Conexão' },
  { key: 'agendamento', name: 'Agendamento' },
  { key: 'reuniao', name: 'Reunião' },
  { key: 'venda', name: 'Venda' },
];

function renderFunnel(g) {
  const el = $('funnel');
  el.innerHTML = '';

  // Etapas com valor null (ex.: Reunião quando o recorte é só São Paulo)
  // não aparecem; as conversões se reencadeiam automaticamente.
  const stages = STAGES.filter((s) => g[s.key] != null);

  const metas = g.metas || {};

  stages.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'stage';
    card.innerHTML = `
      <div class="stage-name">${s.name}</div>
      <div class="stage-value">${fmtInt(g[s.key])}</div>
      ${projBlock(g[s.key], g.prov[s.key], metas[s.key], false)}`;
    el.appendChild(card);

    // chip de conversao entre este estagio e o proximo
    if (i < stages.length - 1) {
      const nextKey = stages[i + 1].key;
      const rate = g.conv[nextKey];
      const chip = document.createElement('div');
      chip.className = 'conv-chip';
      const low = rate < 0.2;
      chip.innerHTML = `
        <div class="conv-name">${s.name} → ${stages[i + 1].name}</div>
        <div class="pct ${low ? 'low' : ''}">${fmtPct(rate)}</div>
        <div class="arrow">→</div>`;
      el.appendChild(chip);
    }
  });

  // card de faturamento (verde)
  const rev = document.createElement('div');
  rev.className = 'conv-chip';
  rev.innerHTML = `<div class="conv-name">Ticket</div><div class="pct">${fmtBRL(g.ticket)}</div><div class="arrow">→</div>`;
  el.appendChild(rev);

  const fat = document.createElement('div');
  fat.className = 'stage revenue';
  fat.innerHTML = `
    <div class="stage-name">Faturamento</div>
    <div class="stage-value">${fmtBRL(g.faturamento)}</div>
    ${projBlock(g.faturamento, g.prov.faturamento, metas.faturamento, true)}`;
  el.appendChild(fat);

  el.hidden = false;
}

// Bloco Prov. + Meta sob o valor da etapa, com barra de atingimento.
// A barra mede Real ÷ Meta (quando há meta); sem meta, mede Real ÷ Prov.
function projBlock(real, prov, meta, money) {
  const fmt = money ? fmtBRL : fmtInt;
  const hasMeta = meta != null;
  const base = hasMeta ? meta : prov;
  return `
    <div class="proj">
      <div class="proj-row"><span>Prov.</span><b>${fmt(prov)}</b></div>
      <div class="proj-row"><span>Meta</span><b>${hasMeta ? fmt(meta) : '—'}</b></div>
    </div>
    <div class="bar"><span class="${hasMeta ? 'meta' : 'prov'}" style="width:${pctWidth(real, base)}"></span></div>`;
}

function pctWidth(real, prov) {
  if (!prov) return '0%';
  return Math.min(100, Math.round((real / prov) * 100)) + '%';
}

// ---------- Eficiencia ----------
function renderEfficiency(g) {
  const el = $('efficiency');
  el.innerHTML = `
    <div class="eff-card"><div class="eff-label">HIT RATE</div><div class="eff-value">${fmtPct2(g.hitRate)}</div></div>
    <div class="eff-card"><div class="eff-label">TICKET MÉDIO</div><div class="eff-value">${fmtBRL(g.ticket)}</div></div>`;
  el.hidden = false;
}

// ---------- Regional ----------
function metaCell(v, money) {
  if (v == null) return '<td>—</td>';
  return `<td>${money ? fmtBRL(v) : fmtInt(v)}</td>`;
}

function metricRow(label, real, prov, meta, money) {
  return `<tr class="metric">
      <td>${label}</td>
      ${metaCell(meta, money)}
      ${metaCell(prov, money)}
      <td class="real">${money ? fmtBRL(real) : fmtInt(real)}</td>
    </tr>`;
}

function convRow(label, rate) {
  return `<tr class="conv"><td>${label}</td><td></td><td></td><td>${fmtPct(rate)}</td></tr>`;
}

function renderRegional(regionais) {
  const el = $('regional');
  el.innerHTML = '';
  regionais.forEach((r) => {
    const m = r.metas || {};
    const card = document.createElement('div');
    card.className = 'reg-card';
    card.innerHTML = `
      <div class="reg-head">
        <div class="reg-name"><span class="dot"></span>${r.label}</div>
        <div class="reg-hit">Hit Rate: ${fmtPct2(r.hitRate)}</div>
      </div>
      <table class="reg-table">
        <thead>
          <tr><th>Métrica</th><th>Meta</th><th>Prov.</th><th>Real.</th></tr>
        </thead>
        <tbody>
          ${metricRow('Leads', r.leads, r.prov.leads, m.leads, false)}
          ${convRow('Leads → Conexão', r.conv.conexao)}
          ${metricRow('Conexão', r.conexao, r.prov.conexao, m.conexao, false)}
          ${convRow('Conexão → Agend.', r.conv.agendamento)}
          ${metricRow('Agendamento', r.agendamento, r.prov.agendamento, m.agendamento, false)}
          ${
            r.reuniao != null
              ? convRow('Agend. → Reunião', r.conv.reuniao) +
                metricRow('Reunião', r.reuniao, r.prov.reuniao, m.reuniao, false) +
                convRow('Reunião → Venda', r.conv.venda)
              : convRow('Agend. → Venda', r.conv.venda)
          }
          ${metricRow('Venda', r.venda, r.prov.venda, m.venda, false)}
          ${metricRow('Ticket Médio', r.ticket, null, m.ticket, true)}
          <tr class="metric">
            <td>Hit Rate</td>
            <td>—</td>
            <td>—</td>
            <td class="real">${fmtPct2(r.hitRate)}</td>
          </tr>
        </tbody>
      </table>
      <div class="reg-foot">
        <div>
          <div class="lbl">FATURAMENTO</div>
          <div class="sub">Prov.: ${fmtBRL(r.prov.faturamento)} · Meta: ${m.faturamento != null ? fmtBRL(m.faturamento) : '—'}</div>
        </div>
        <div class="big">${fmtBRL(r.faturamento)}</div>
      </div>`;
    el.appendChild(card);
  });
  document.querySelector('.regional-wrap').hidden = false;
}

// ---------- Rankings (SDR / Closer) ----------
// Percentil (interpolado) de um array já ordenado.
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Heatmap por quartil: >= P75 = melhor (verde); <= P25 = pior (vermelho);
// meio = âmbar. Tons claros via CSS. Funciona a partir de 2 valores (caso de SP,
// com poucos SDRs: o melhor fica verde e o pior vermelho). Sem heatmap se houver
// < 2 valores (ex.: 1 SDR) ou distribuição sem dispersão.
function makeBucketer(values) {
  const nums = values.filter((v) => typeof v === 'number' && isFinite(v));
  if (nums.length < 2) return () => '';
  const sorted = [...nums].sort((a, b) => a - b);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  if (p25 === p75) return () => '';
  return (v) => {
    if (typeof v !== 'number' || !isFinite(v)) return '';
    if (v >= p75) return 'hm-good';
    if (v <= p25) return 'hm-bad';
    return 'hm-mid';
  };
}

// Monta um card de ranking por região com as colunas informadas.
function rankCard(label, rows, cols) {
  // Um bucketer (quartis) por coluna, calculado sobre as linhas deste card.
  const buckets = {};
  cols.forEach((c) => (buckets[c.key] = makeBucketer(rows.map((r) => r[c.key]))));

  const head = cols.map((c) => `<th>${c.title}</th>`).join('');
  const body = rows.length
    ? rows
        .map((r, i) => {
          const cells = cols
            .map((c) => {
              const cls = [c.cls || '', buckets[c.key](r[c.key])].filter(Boolean).join(' ');
              return `<td class="${cls}">${c.fmt(r[c.key], r)}</td>`;
            })
            .join('');
          return `<tr><td class="rank-pos">${i + 1}</td><td class="rank-name">${r.name}</td>${cells}</tr>`;
        })
        .join('')
    : `<tr><td colspan="${cols.length + 2}" class="rank-empty">Sem dados no período</td></tr>`;

  return `<div class="reg-card">
      <div class="reg-head"><div class="reg-name"><span class="dot"></span>${label}</div></div>
      <table class="reg-table rank-table">
        <thead><tr><th>#</th><th>Nome</th>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

// Estado de ordenação dos rankings e último payload (p/ re-ordenar sem refetch).
let rankSort = 'taxaAgendamento';
let closerSort = 'vendas';
let lastRankings = null;

// Célula de Win Rate com popup de breakdown no hover. `rows` é a lista do
// detalhe (closers de um SDR, ou SDRs de um closer), cada item com
// {name, winRate, vendas, realizadas}.
function breakdownCell(v, rows, title, emptyMsg) {
  const list = (rows || []).length
    ? rows
        .map(
          (it) =>
            `<div class="hr-row"><span class="hr-name">${it.name || '—'}</span>` +
            `<span class="hr-pct">${fmtPct(it.winRate)}</span>` +
            `<span class="hr-frac">${fmtInt(it.vendas)}/${fmtInt(it.realizadas)}</span></div>`,
        )
        .join('')
    : `<div class="hr-empty">${emptyMsg || 'Sem dados'}</div>`;
  return (
    `<span class="hr-cell">${fmtPct(v)}` +
    `<span class="hr-pop"><span class="hr-pop-title">${title}</span>${list}</span></span>`
  );
}

function renderRankings(data) {
  lastRankings = data;
  const regioes = data.regioes || [];

  // Coluna sendo ordenada fica em destaque (negrito).
  // CR1 lead→conexão · CR2 conexão→agend. · CR3 agend.→realizada ·
  // Win Rate realizada→venda (com popup por closer) · Hit Rate lead→venda.
  const sdrCols = [
    { title: 'Leads', key: 'leads', fmt: fmtInt },
    { title: 'Tx Conex.', key: 'taxaConexao', fmt: fmtPct },
    { title: 'Tx Agend.', key: 'taxaAgendamento', fmt: fmtPct },
    { title: 'Tx Reun.', key: 'taxaReuniao', fmt: fmtPct },
    { title: 'Win Rate', key: 'winRate', fmt: (v, row) =>
        breakdownCell(v, row.closers, 'Win rate por closer · realizada → venda', 'Sem dados de closer') },
    { title: 'Hit Rate', key: 'hitRate', fmt: fmtPct },
  ].map((col) => ({ ...col, cls: col.key === rankSort ? 'real' : '' }));

  // Closer: base = reuniões realizadas; Win Rate com popup por SDR.
  const closerCols = [
    { title: 'Realizadas', key: 'realizadas', fmt: fmtInt },
    { title: 'Vendas', key: 'vendas', fmt: fmtInt },
    { title: 'Win Rate', key: 'winRate', fmt: (v, row) =>
        breakdownCell(v, row.sdrs, 'Win rate por SDR · realizada → venda', 'Sem dados de SDR') },
    { title: 'Faturamento', key: 'faturamento', fmt: fmtBRL },
  ].map((col) => ({ ...col, cls: col.key === closerSort ? 'real' : '' }));

  // Re-ordena pela métrica escolhida (maior → menor).
  const sortSdr = (rows) => [...rows].sort((a, b) => (b[rankSort] || 0) - (a[rankSort] || 0));
  const sortCloser = (rows) => [...rows].sort((a, b) => (b[closerSort] || 0) - (a[closerSort] || 0));

  $('rank-sdr').innerHTML = regioes
    .map((rg) => rankCard(rg.label, sortSdr(rg.sdr), sdrCols))
    .join('');
  $('rank-closer').innerHTML = regioes
    .map((rg) => rankCard(rg.label, sortCloser(rg.closer), closerCols))
    .join('');

  document
    .querySelectorAll('.ranking-wrap')
    .forEach((el) => (el.hidden = false));
  fadeIn($('rank-sdr'));
  fadeIn($('rank-closer'));
}

async function loadRankings(qs) {
  try {
    const res = await fetch('/api/rankings?' + qs, { cache: 'no-store' });
    if (!res.ok) return;
    renderRankings(await res.json());
  } catch (_) {
    /* rankings são complementares; falha não derruba o dashboard */
  }
}

function render(data) {
  renderFunnel(data.geral);
  renderEfficiency(data.geral);
  renderRegional(data.regionais);
  fadeIn($('funnel'));
  fadeIn($('efficiency'));
  fadeIn($('regional'));
}

// Popula o filtro de canal com as origens reais da Ploomes.
async function loadOrigins() {
  try {
    const res = await fetch('/api/origins', { cache: 'no-store' });
    if (!res.ok) return;
    const list = await res.json();
    const sel = $('f-canal');
    // A lista já vem ordenada por volume histórico (do back). Exibe só o nome.
    list.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.id;
      opt.textContent = o.name;
      sel.appendChild(opt);
    });
  } catch (_) {
    /* mantem apenas "Todos" se a lista falhar */
  }
}

// Toggle de visão Mensal | Safra.
document.querySelectorAll('#f-view .seg-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    if (btn.classList.contains('active')) return;
    document
      .querySelectorAll('#f-view .seg-btn')
      .forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    load();
  }),
);

// Toggles de ordenação dos rankings (re-ordenam sem refetch).
function wireSortToggle(containerId, apply) {
  document.querySelectorAll(`#${containerId} .seg-btn`).forEach((btn) =>
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) return;
      document
        .querySelectorAll(`#${containerId} .seg-btn`)
        .forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      apply(btn.dataset.sort);
      if (lastRankings) renderRankings(lastRankings);
    }),
  );
}
wireSortToggle('rank-sort', (v) => (rankSort = v));
wireSortToggle('closer-sort', (v) => (closerSort = v));

// Recarrega o dashboard quando qualquer filtro muda (alem do botao Atualizar).
$('f-apply').addEventListener('click', load);
['f-start', 'f-end', 'f-regional', 'f-canal'].forEach((id) =>
  $(id).addEventListener('change', load),
);

setDefaultDates();
loadOrigins();
load();
