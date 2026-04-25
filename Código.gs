/*******************************
 * Musicala - Seguimiento Marketing (Backend unico)
 * Sheets: campaigns | Metricas | Parametros
 * Frontend externo (fetch) -> Web App Apps Script
 *
 * Rutas (action):
 *  - boot
 *  - listCampaigns
 *  - upsertCampaign
 *  - addMetric
 *  - queryMetrics
 *  - dashboard
 *
 * Deploy: Web App (Execute as: Me) (Who has access: Anyone with the link)
 *******************************/

const CFG = {
  SHEET_CAMPAIGNS: 'campaigns',
  SHEET_METRICS: 'Metricas',
  SHEET_PARAMS: 'Parametros',

  // Campo ID requerido en Campanas
  CAMPAIGN_ID_COL: 'campaign_id',

  // Si quieres restringir CORS a tu dominio, cambia '*'
  CORS_ORIGIN: '*',
};

// --------- ENTRYPOINTS (HTTP) ----------

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) ? String(e.parameter.action) : 'boot';
    ensureSchema_();

    const params = parseGetParams_(e.parameter || {});
    const result = route_(action, params);
    if (e && e.parameter && e.parameter.callback) {
      return jsonp_(result, e.parameter.callback);
    }
    return json_(result);
  } catch (err) {
    const result = { ok: false, error: (err && err.message) ? err.message : String(err) };
    if (e && e.parameter && e.parameter.callback) {
      return jsonp_(result, e.parameter.callback);
    }
    return json_(result, 500);
  }
}

function doPost(e) {
  try {
    ensureSchema_();

    const payload = parseBody_(e);
    const action = payload.action || 'boot';
    const params = payload.params || {};

    const result = route_(action, params);
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: (err && err.message) ? err.message : String(err) }, 500);
  }
}

// --------- ROUTER ----------

function route_(action, params) {
  switch (action) {
    case 'boot':
      return api_boot_();

    case 'listCampaigns':
      return { ok: true, campaigns: listCampaigns_() };

    case 'upsertCampaign':
      return api_upsertCampaign_(params);

    case 'addMetric':
      return api_addMetric_(params);

    case 'queryMetrics':
      return api_queryMetrics_(params);

    case 'dashboard':
      return api_dashboard_(params);

    // "preflight" friendly (por si tu hosting hace OPTIONS y te toca probar)
    case 'ping':
      return { ok: true, message: 'pong', now: new Date().toISOString() };

    case 'repairSchema':
      return api_repairSchema_();

    default:
      return { ok: false, error: `Accion no soportada: ${action}` };
  }
}

// --------- APIs ----------

function api_boot_() {
  const params = getParams_();
  const campaigns = listCampaigns_();
  return {
    ok: true,
    params,
    campaigns,
    sheet: SpreadsheetApp.getActive().getName(),
  };
}

function api_repairSchema_() {
  ensureSchema_();
  return { ok: true, message: 'Schema reparado' };
}

function api_upsertCampaign_(p) {
  if (!p) throw new Error('Payload vacio');

  const id = str_(p[CFG.CAMPAIGN_ID_COL] ?? p.campaign_id ?? p.id);
  if (!id) throw new Error(`Falta ${CFG.CAMPAIGN_ID_COL} en Campanas`);

  const sh = sheet_(CFG.SHEET_CAMPAIGNS);
  const headers = headers_(sh);

  const obj = {};
  headers.forEach(h => obj[h] = p[h] ?? '');

  // Normalizaciones utiles
  obj[CFG.CAMPAIGN_ID_COL] = id;
  obj.fecha_inicio = normalizeDateMaybe_(obj.fecha_inicio);
  obj.fecha_fin = normalizeDateMaybe_(obj.fecha_fin);
  obj.presupuesto_mensual = num_(obj.presupuesto_mensual);
  obj.gasto_ads_total = num_(obj.gasto_ads_total);
  obj.iva_total = num_(obj.iva_total);
  obj.cobro_total = num_(obj.cobro_total);

  const rowIndex = findRowById_(sh, CFG.CAMPAIGN_ID_COL, id);

  if (rowIndex === -1) {
    sh.appendRow(headers.map(h => obj[h]));
    return { ok: true, mode: 'insert', campaign: obj };
  } else {
    sh.getRange(rowIndex, 1, 1, headers.length).setValues([headers.map(h => obj[h])]);
    return { ok: true, mode: 'update', campaign: obj };
  }
}

function api_addMetric_(p) {
  if (!p) throw new Error('Payload vacio');

  const id = str_(p.campaign_id ?? p.id);
  if (!id) throw new Error('Falta campaign_id en Metricas');

  // Valida que exista campana (opcional, pero recomendado)
  const exists = findRowById_(sheet_(CFG.SHEET_CAMPAIGNS), CFG.CAMPAIGN_ID_COL, id) !== -1;
  if (!exists) throw new Error(`campaign_id no existe en Campanas: ${id}`);

  const sh = sheet_(CFG.SHEET_METRICS);
  const headers = headers_(sh);

  const obj = {};
  headers.forEach(h => obj[h] = p[h] ?? '');

  // normalizaciones minimas
  obj.date = normalizeDateRequired_(p.date ?? p.fecha ?? p.Date);
  obj.campaign_id = id;

  obj.spend = num_(obj.spend);
  obj.impressions = int_(obj.impressions);
  obj.clicks = int_(obj.clicks);
  obj.leads = int_(obj.leads);
  obj.sales = int_(obj.sales);
  obj.revenue = num_(obj.revenue);
  obj.video_plays = int_(obj.video_plays || obj.impressions);
  obj.viewers = int_(obj.viewers);
  obj.link_clicks = int_(obj.link_clicks || obj.clicks);
  obj.post_interactions = int_(obj.post_interactions);
  obj.saves = int_(obj.saves);
  obj.shares = int_(obj.shares);
  obj.comments = int_(obj.comments);
  obj.notes = str_(obj.notes);

  sh.appendRow(headers.map(h => obj[h]));
  return { ok: true, metric: obj };
}

function api_queryMetrics_(p) {
  const sh = sheet_(CFG.SHEET_METRICS);
  const rows = readObjects_(sh);

  const from = p.from ? new Date(p.from) : null;
  const to = p.to ? new Date(p.to) : null; // inclusivo
  const campaignId = str_(p.campaign_id);

  const filtered = rows.filter(r => {
    const d = asDate_(r.date);
    if (!d) return false;

    if (from && d < startOfDay_(from)) return false;
    if (to && d > endOfDay_(to)) return false;
    if (campaignId && str_(r.campaign_id) !== campaignId) return false;

    return true;
  });

  // Orden por fecha desc
  filtered.sort((a, b) => (asDate_(b.date) || 0) - (asDate_(a.date) || 0));

  return { ok: true, rows: filtered };
}

function api_dashboard_(p) {
  const from = p.from ? new Date(p.from) : null;
  const to = p.to ? new Date(p.to) : null;

  const campaigns = listCampaigns_();
  const metrics = api_queryMetrics_({ from: p.from, to: p.to }).rows;

  // Index campanas por id
  const campMap = {};
  campaigns.forEach(c => campMap[str_(c.campaign_id)] = c);

  // Aggregate por campana
  const byCampaign = {};
  campaigns.forEach(c => {
    const id = str_(c.campaign_id);
    if (id) byCampaign[id] = baseAgg_();
  });

  metrics.forEach(m => {
    const id = str_(m.campaign_id);
    if (!id) return;
    byCampaign[id] = byCampaign[id] || baseAgg_();
    addAgg_(byCampaign[id], m);
  });

  // Construir filas con KPIs
  const rows = Object.keys(byCampaign).map(id => {
    const agg = byCampaign[id];
    const c = campMap[id] || {};
    const reportedSpend = num_(c.gasto_ads_total) > 0 ? num_(c.gasto_ads_total) : num_(agg.spend);
    const realSpend = num_(c.cobro_total) > 0 ? num_(c.cobro_total) : reportedSpend;
    const kpi = kpis_({ ...agg, spend: realSpend });
    return {
      campaign_id: id,
      nombre: c.nombre || '',
      canal: c.canal || '',
      plataforma: c.plataforma || '',
      objetivo: c.objetivo || '',
      servicio: c.servicio || '',
      modalidad: c.modalidad || '',
      estado: c.estado || '',
      modelo_cobro: c.modelo_cobro || '',
      gasto_ads_total: num_(c.gasto_ads_total),
      iva_total: num_(c.iva_total),
      cobro_total: num_(c.cobro_total),
      reported_spend: reportedSpend,
      spend_source: num_(c.cobro_total) > 0 ? 'cobro_total' : 'metricas',
      ...agg,
      spend: realSpend,
      ...kpi
    };
  });

  // Totales globales
  const total = rows.reduce((acc, r) => {
    acc.spend += num_(r.spend);
    acc.reported_spend += num_(r.reported_spend);
    acc.cobro_total += num_(r.cobro_total);
    acc.impressions += int_(r.impressions);
    acc.clicks += int_(r.clicks);
    acc.leads += int_(r.leads);
    acc.sales += int_(r.sales);
    acc.revenue += num_(r.revenue);
    return acc;
  }, { ...baseAgg_(), reported_spend: 0, cobro_total: 0 });

  const totalsKpi = kpis_(total);

  // Rankings utiles
  const bestROAS = rows
    .filter(r => num_(r.spend) > 0)
    .slice()
    .sort((a, b) => num_(b.roas) - num_(a.roas))
    .slice(0, 10);

  const bestCPL = rows
    .filter(r => int_(r.leads) > 0)
    .slice()
    .sort((a, b) => num_(a.cpl) - num_(b.cpl))
    .slice(0, 10);

  const waste = rows
    .filter(r => num_(r.spend) > 0 && int_(r.leads) === 0)
    .slice()
    .sort((a, b) => num_(b.spend) - num_(a.spend))
    .slice(0, 10);

  // Serie por dia (para graficos)
  const series = seriesByDay_(metrics, from, to);

  return {
    ok: true,
    range: { from: p.from || null, to: p.to || null },
    totals: { ...total, ...totalsKpi },
    rows,           // por campana
    rankings: { bestROAS, bestCPL, waste },
    series,         // por dia: spend/leads/sales/revenue/clicks/impressions
  };
}

// --------- PARAMS ----------

function getParams_() {
  const sh = sheet_(CFG.SHEET_PARAMS);
  const values = sh.getDataRange().getValues();
  const out = {};

  if (values.length < 2) return out;

  // headers: Lista | Valor (tolerante a may/min)
  for (let i = 1; i < values.length; i++) {
    const key = str_(values[i][0]);
    const val = str_(values[i][1]);
    if (!key || !val) continue;
    out[key] = out[key] || [];
    out[key].push(val);
  }

  // Opcional: quitar duplicados
  Object.keys(out).forEach(k => {
    out[k] = Array.from(new Set(out[k]));
  });

  return out;
}

// --------- DATA HELPERS ----------

function listCampaigns_() {
  const sh = sheet_(CFG.SHEET_CAMPAIGNS);
  const rows = readObjects_(sh);

  // Solo filas con campaign_id
  const out = rows.filter(r => str_(r[CFG.CAMPAIGN_ID_COL]));
  out.sort((a, b) => str_(a.campaign_id).localeCompare(str_(b.campaign_id)));
  return out;
}

function readObjects_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0].map(h => str_(h));
  return values.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => o[h] = r[i]);
    return o;
  });
}

function headers_(sh) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) throw new Error(`La hoja ${sh.getName()} no tiene headers`);
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => str_(h));
}

function findRowById_(sh, idColName, idValue) {
  const headers = headers_(sh);
  const idx = headers.indexOf(idColName);
  if (idx === -1) throw new Error(`No existe columna "${idColName}" en ${sh.getName()}`);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;

  const rng = sh.getRange(2, idx + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < rng.length; i++) {
    if (str_(rng[i][0]) === str_(idValue)) return i + 2; // row number in sheet
  }
  return -1;
}

// --------- ANALYTICS HELPERS ----------

function baseAgg_() {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    sales: 0,
    revenue: 0,
    video_plays: 0,
    viewers: 0,
    link_clicks: 0,
    post_interactions: 0,
    saves: 0,
    shares: 0,
    comments: 0,
  };
}

function addAgg_(agg, m) {
  agg.spend += num_(m.spend);
  agg.impressions += int_(m.impressions);
  agg.clicks += int_(m.clicks);
  agg.leads += int_(m.leads);
  agg.sales += int_(m.sales);
  agg.revenue += num_(m.revenue);
  agg.video_plays += int_(m.video_plays || m.impressions);
  agg.viewers += int_(m.viewers);
  agg.link_clicks += int_(m.link_clicks || m.clicks);
  agg.post_interactions += int_(m.post_interactions);
  agg.saves += int_(m.saves);
  agg.shares += int_(m.shares);
  agg.comments += int_(m.comments);
}

function kpis_(agg) {
  const spend = num_(agg.spend);
  const impressions = int_(agg.impressions);
  const clicks = int_(agg.link_clicks || agg.clicks);
  const leads = int_(agg.leads);
  const sales = int_(agg.sales);
  const revenue = num_(agg.revenue);

  return {
    ctr: safeDiv_(clicks, impressions),          // ratio
    cpc: safeDiv_(spend, clicks),
    cpl: safeDiv_(spend, leads),
    cpa: safeDiv_(spend, sales),
    roas: safeDiv_(revenue, spend),
    conv_lead: safeDiv_(sales, leads),          // ventas/leads
  };
}

function seriesByDay_(metrics, from, to) {
  // Agrupa por YYYY-MM-DD
  const map = {};
  metrics.forEach(m => {
    const d = asDate_(m.date);
    if (!d) return;
    const key = isoDate_(d);

    map[key] = map[key] || baseAgg_();
    addAgg_(map[key], m);
  });

  const keys = Object.keys(map).sort(); // asc

  return keys.map(k => ({
    date: k,
    ...map[k],
    ...kpis_(map[k]),
  }));
}

// --------- SCHEMA ----------

function ensureSchema_() {
  const ss = SpreadsheetApp.getActive();
  normalizeSheetNames_(ss);

  ensureSheet_(ss, CFG.SHEET_PARAMS, ['Lista', 'Valor']);
  ensureSheet_(ss, CFG.SHEET_CAMPAIGNS, [
    'campaign_id',
    'nombre',
    'canal',
    'plataforma',
    'objetivo',
    'servicio',
    'modalidad',
    'fecha_inicio',
    'fecha_fin',
    'estado',
    'presupuesto_mensual',
    'modelo_cobro',
    'gasto_ads_total',
    'iva_total',
    'cobro_total',
    'responsable',
    'notas',
  ]);
  ensureSheet_(ss, CFG.SHEET_METRICS, [
    'date',
    'campaign_id',
    'spend',
    'impressions',
    'clicks',
    'leads',
    'sales',
    'revenue',
    'video_plays',
    'viewers',
    'link_clicks',
    'post_interactions',
    'saves',
    'shares',
    'comments',
    'notes',
  ]);
}

function ensureSheet_(ss, name, headersWanted) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);

  const lastCol = sh.getLastColumn();
  if (lastCol < 1) {
    sh.getRange(1, 1, 1, headersWanted.length).setValues([headersWanted]);
    sh.setFrozenRows(1);
    return;
  }

  normalizeHeaders_(sh, headersWanted);

  const current = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => str_(h));
  const hasAnyHeader = current.some(Boolean);

  if (!hasAnyHeader) {
    sh.getRange(1, 1, 1, headersWanted.length).setValues([headersWanted]);
    sh.setFrozenRows(1);
    return;
  }

  // Agrega columnas faltantes al final
  const missing = headersWanted.filter(h => current.indexOf(h) === -1);
  if (missing.length) {
    sh.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
  }

  sh.setFrozenRows(1);
}

function normalizeSheetNames_(ss) {
  const aliases = [
    { canonical: CFG.SHEET_CAMPAIGNS, bad: ['Campanas', 'campanas', 'Campa' + String.fromCharCode(0x00f1) + 'as', 'campa' + String.fromCharCode(0x00f1) + 'as', 'Campa' + String.fromCharCode(0x00c3) + String.fromCharCode(0x00b1) + 'as', 'campa' + String.fromCharCode(0x00c3) + String.fromCharCode(0x00b1) + 'as'] },
    { canonical: CFG.SHEET_METRICS, bad: ['Metricas', 'Metrica', 'M' + String.fromCharCode(0x00e9) + 'tricas', 'M' + String.fromCharCode(0x00c3) + String.fromCharCode(0x00a9) + 'tricas'] },
    { canonical: CFG.SHEET_PARAMS, bad: ['Parametros', 'Parametros', 'Par' + String.fromCharCode(0x00e1) + 'metros', 'Par' + String.fromCharCode(0x00c3) + String.fromCharCode(0x00a1) + 'metros'] },
  ];

  aliases.forEach(group => {
    let canonical = ss.getSheetByName(group.canonical);
    group.bad.forEach(name => {
      const bad = ss.getSheetByName(name);
      if (!bad || bad.getName() === group.canonical) return;

      if (!canonical && bad.getLastRow() > 0) {
        bad.setName(group.canonical);
        canonical = bad;
      }
    });
  });
}

function normalizeHeaders_(sh, headersWanted) {
  let lastCol = sh.getLastColumn();
  if (lastCol < 1) return;

  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(h => str_(h));
  const canonicalByNormalized = {};
  headersWanted.forEach(h => canonicalByNormalized[normalizeHeaderKey_(h)] = h);

  headers.forEach((header, index) => {
    const canonical = canonicalByNormalized[normalizeHeaderKey_(header)];
    if (canonical && header !== canonical) {
      sh.getRange(1, index + 1).setValue(canonical);
    }
  });

  headersWanted.forEach(header => {
    removeDuplicateHeaderColumns_(sh, header);
  });
}

function normalizeHeaderKey_(header) {
  return str_(header)
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, '')
    .replace(/[^\w]/g, '');
}

function removeDuplicateHeaderColumns_(sh, header) {
  let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => str_(h));
  const cols = [];
  headers.forEach((h, index) => {
    if (h === header) cols.push(index + 1);
  });
  if (cols.length <= 1) return;

  const keep = cols[0];
  const lastRow = sh.getLastRow();

  for (let i = cols.length - 1; i >= 1; i--) {
    const col = cols[i];
    if (lastRow > 1) {
      const source = sh.getRange(2, col, lastRow - 1, 1).getValues();
      const target = sh.getRange(2, keep, lastRow - 1, 1).getValues();
      let changed = false;
      for (let r = 0; r < source.length; r++) {
        if (!target[r][0] && source[r][0]) {
          target[r][0] = source[r][0];
          changed = true;
        }
      }
      if (changed) sh.getRange(2, keep, lastRow - 1, 1).setValues(target);
    }
    sh.deleteColumn(col);
  }
}

// --------- RESPONSE / PARSING ----------

function json_(obj, statusCode) {
  const out = ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);

  return out;
}

function jsonp_(obj, callback) {
  const safeCallback = String(callback || '').replace(/[^\w.$]/g, '');
  if (!safeCallback) return json_({ ok: false, error: 'Callback invalido' });

  return ContentService
    .createTextOutput(`${safeCallback}(${JSON.stringify(obj)});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function parseGetParams_(query) {
  if (query.params) {
    try {
      return JSON.parse(query.params);
    } catch (err) {
      throw new Error('Parametro params no es JSON valido');
    }
  }

  const params = {};
  Object.keys(query || {}).forEach(key => {
    if (key !== 'action' && key !== 'callback' && key !== '_') {
      params[key] = query[key];
    }
  });
  return params;
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  const c = e.postData.contents;

  try {
    return JSON.parse(c);
  } catch (err) {
    // Permite form-encoded basico: action=...&params=...
    const obj = {};
    c.split('&').forEach(pair => {
      const [k, v] = pair.split('=');
      obj[decodeURIComponent(k)] = decodeURIComponent(v || '');
    });
    if (obj.params) {
      try { obj.params = JSON.parse(obj.params); } catch (_) {}
    }
    return obj;
  }
}

// --------- NORMALIZERS ----------

function sheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) throw new Error(`No existe la hoja: ${name}`);
  return sh;
}

function str_(x) {
  return String(x ?? '').trim();
}

function num_(x) {
  if (x === '' || x == null) return 0;
  const n = Number(String(x).replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

function int_(x) {
  return Math.trunc(num_(x));
}

function safeDiv_(a, b) {
  const A = num_(a), B = num_(b);
  if (!B) return 0;
  return A / B;
}

function asDate_(x) {
  if (!x) return null;
  if (x instanceof Date && !isNaN(x)) return x;
  const d = new Date(x);
  if (isNaN(d)) return null;
  return d;
}

function isoDate_(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

function endOfDay_(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

function normalizeDateRequired_(x) {
  const d = asDate_(x);
  if (!d) throw new Error(`Fecha invalida: ${x}`);
  return d;
}

function normalizeDateMaybe_(x) {
  const s = str_(x);
  if (!s) return '';
  const d = asDate_(s);
  return d ? d : '';
}
