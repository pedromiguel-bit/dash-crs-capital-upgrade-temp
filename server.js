require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { computeDashboard } = require('./src/metrics');
const { computeRankings } = require('./src/rankings');
const ploomes = require('./src/ploomes');
const { regionais } = require('./config/funnels');
const { fetchMetas } = require('./src/sheets');

const app = express();
const PORT = process.env.PORT || 3000;
const TZ = '-03:00'; // America/Sao_Paulo

app.use(express.static(path.join(__dirname, 'public')));
// Markdown da documentação (consumido pela tela public/docs.html).
app.use('/doc-files', express.static(path.join(__dirname, 'docs')));

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

// Resolve o periodo a partir da query (?start=YYYY-MM-DD&end=YYYY-MM-DD).
// Padrao: "mes todo" = do dia 1 do mes corrente ate hoje.
function resolvePeriod(query) {
  const now = new Date();
  const defStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const defEnd = ymd(now);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(query.start) ? query.start : defStart;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(query.end) ? query.end : defEnd;
  return {
    startIso: `${start}T00:00:00${TZ}`,
    endIso: `${end}T23:59:59${TZ}`,
    now,
  };
}

// Busca metas do Google Sheets com fallback para config/metas.json.
async function loadMetas() {
  try {
    return await fetchMetas();
  } catch (err) {
    console.warn('Falha ao buscar metas do Sheets, usando metas.json:', err.message);
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'config/metas.json'), 'utf8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
}

app.get('/api/dashboard', async (req, res) => {
  try {
    const { startIso, endIso, now } = resolvePeriod(req.query);
    const regional = req.query.regional; // 'sao-paulo' | 'fortaleza' | undefined
    // Canal = OriginId do Deal. Aceita apenas digitos para nao injetar OData.
    const canal = /^\d+$/.test(req.query.canal || '') ? req.query.canal : undefined;
    // Visao: 'mensal' (volume no periodo, default) | 'safra' (coorte por entrada do lead).
    const view = req.query.view === 'safra' ? 'safra' : 'mensal';
    const metas = await loadMetas();
    const data = await computeDashboard({ startIso, endIso, regional, canal, metas, now, view });
    res.json(data);
  } catch (err) {
    console.error('Erro ao montar dashboard:', err.message);
    res.status(502).json({ error: 'Falha ao consultar a Ploomes', detail: err.message });
  }
});

// Rankings de SDR e Closer por regiao, no mesmo recorte de periodo/regiao/canal.
app.get('/api/rankings', async (req, res) => {
  try {
    const { startIso, endIso } = resolvePeriod(req.query);
    const regional = req.query.regional;
    const canal = /^\d+$/.test(req.query.canal || '') ? req.query.canal : undefined;
    const view = req.query.view === 'safra' ? 'safra' : 'mensal';
    const data = await computeRankings({ startIso, endIso, regional, canal, view });
    res.json(data);
  } catch (err) {
    console.error('Erro ao montar rankings:', err.message);
    res.status(502).json({ error: 'Falha ao consultar rankings', detail: err.message });
  }
});

// Lista de canais (Origens) disponiveis para o filtro, com volume por canal.
app.get('/api/origins', async (_req, res) => {
  try {
    const pids = Object.values(regionais).map((r) => r.pipelineId);
    const list = await ploomes.origins(pids);
    res.json(list);
  } catch (err) {
    console.error('Erro ao listar canais:', err.message);
    res.status(502).json({ error: 'Falha ao consultar canais', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Capital Upgrade dashboard rodando em http://localhost:${PORT}`);
});
