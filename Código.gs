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

    case 'setGlobalBudget':
      return api_setGlobalBudget_(params);

    case 'getGlobalBudget':
      return { ok: true, amount: getGlobalMaxBudget_() };

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

  if (!str_(p.nombre)) throw new Error('La campana necesita un nombre.');

  const sh = sheet_(CFG.SHEET_CAMPAIGNS);
  const headers = headers_(sh);

  const obj = {};
  headers.forEach(h => obj[h] = p[h] ?? '');

  // Normalizaciones utiles
  const rowIndex = findRowById_(sh, CFG.CAMPAIGN_ID_COL, id);
  const existing = rowIndex === -1 ? {} : readObjects_(sh)[rowIndex - 2] || {};

  obj[CFG.CAMPAIGN_ID_COL] = id;
  obj.fecha_inicio = normalizeDateMaybe_(obj.fecha_inicio);
  obj.fecha_fin = normalizeDateMaybe_(obj.fecha_fin);
  obj.fecha_creacion = normalizeDateMaybe_(obj.fecha_creacion) || normalizeDateMaybe_(existing.fecha_creacion) || obj.fecha_inicio || new Date();
  obj.tipo_duracion = obj.fecha_fin ? 'Con fecha de finalizaci?n' : 'Continua';
  obj.presupuesto_diario = num_(obj.presupuesto_diario);
  obj.presupuesto_mensual = num_(obj.presupuesto_mensual);
  obj.budget_mode = normalizeBudgetMode_(obj.budget_mode || existing.budget_mode || inferBudgetMode_(obj));
  obj.monthly_budget_target = num_(obj.monthly_budget_target || existing.monthly_budget_target || obj.presupuesto_mensual);
  obj.cpl_target = num_(obj.cpl_target || existing.cpl_target);
  obj.budget_notes = str_(obj.budget_notes || existing.budget_notes);
  obj.gasto_ads_total = num_(obj.gasto_ads_total);
  obj.iva_total = num_(obj.iva_total);
  obj.cobro_total = num_(obj.cobro_total);

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

  obj.platform_type = str_(obj.platform_type || p.platform_type || 'general');
  obj.spend_entry_type = normalizeSpendEntryType_(obj.spend_entry_type || p.spend_entry_type);
  obj.spend = num_(obj.spend);
  obj.total_charge = num_(obj.total_charge);
  obj.tax_amount = num_(obj.tax_amount);
  obj.daily_budget = num_(obj.daily_budget);
  obj.duration_days = int_(obj.duration_days);
  obj.conversations_started = int_(obj.conversations_started);
  obj.cost_per_conversation = num_(obj.cost_per_conversation);
  obj.impressions = int_(obj.impressions);
  obj.clicks = int_(obj.clicks);
  obj.leads = int_(obj.leads || obj.conversations_started || obj.raw_leads || obj.conversions);
  obj.sales = int_(obj.sales);
  obj.revenue = num_(obj.revenue);
  obj.video_plays = int_(obj.video_plays || obj.impressions);
  obj.viewers = int_(obj.viewers);
  obj.link_clicks = int_(obj.link_clicks || obj.clicks);
  obj.post_interactions = int_(obj.post_interactions);
  obj.saves = int_(obj.saves);
  obj.shares = int_(obj.shares);
  obj.comments = int_(obj.comments);
  obj.reactions = int_(obj.reactions);
  obj.optimization_score = num_(obj.optimization_score);
  obj.ctr = num_(obj.ctr);
  obj.avg_cpc = num_(obj.avg_cpc);
  obj.conversions = int_(obj.conversions);
  obj.interactions = int_(obj.interactions);
  obj.raw_leads = int_(obj.raw_leads);
  obj.qualified_leads = int_(obj.qualified_leads);
  obj.converted_leads = int_(obj.converted_leads);
  obj.top_searches = str_(obj.top_searches);
  obj.costly_keywords = str_(obj.costly_keywords);
  obj.best_keywords = str_(obj.best_keywords);
  obj.quick_observation = str_(obj.quick_observation || obj.notes);
  obj.notes = str_(obj.notes || obj.quick_observation);

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

  const campMap = {};
  listCampaigns_().forEach(c => campMap[str_(c.campaign_id)] = c);
  filtered.forEach(r => {
    const c = campMap[str_(r.campaign_id)] || {};
    r.nombre = c.nombre || r.nombre || '';
    r.canal = c.canal || r.canal || '';
    r.plataforma = c.plataforma || r.plataforma || '';
    r.platform_type = r.platform_type || inferPlatformType_(c);
  });

  // Orden por fecha desc
  filtered.sort((a, b) => (asDate_(b.date) || 0) - (asDate_(a.date) || 0));

  return { ok: true, rows: filtered };
}

function api_dashboard_(p) {
  const from = p.from ? new Date(p.from) : null;
  const to = p.to ? new Date(p.to) : null;

  const campaigns = listCampaigns_()
    .filter(c => campaignOverlapsRange_(c, from, to))
    .filter(c => !campaignOutsideBudgetMonth_(c, from, to));
  const allMetrics = api_queryMetrics_({}).rows;
  const metrics = allMetrics.filter(m => {
    const d = asDate_(m.date);
    if (!d) return false;
    if (from && d < startOfDay_(from)) return false;
    if (to && d > endOfDay_(to)) return false;
    return true;
  });

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
    // Solo agrega metricas de campanas que pasaron el filtro del periodo. Asi una campana
    // excluida (ej. cerrada de un mes anterior) no genera una fila fantasma sin nombre ni
    // filtra su gasto a los totales del mes actual.
    if (!id || !campMap[id]) return;
    byCampaign[id] = byCampaign[id] || baseAgg_();
    addAgg_(byCampaign[id], m);
  });

  // Construir filas con KPIs
  const rows = Object.keys(byCampaign).map(id => {
    const agg = byCampaign[id];
    const c = campMap[id] || {};
    const budget = getBudgetAnalytics_(c, allMetrics, from, to);
    const reportedSpend = num_(c.gasto_ads_total) > 0 ? num_(c.gasto_ads_total) : (num_(budget.spend_to_date) || num_(agg.spend));
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
      budget_mode: c.budget_mode || inferBudgetMode_(c),
      monthly_budget_target: num_(c.monthly_budget_target || c.presupuesto_mensual),
      cpl_target: num_(c.cpl_target),
      budget_notes: c.budget_notes || '',
      presupuesto_diario: num_(c.presupuesto_diario),
      presupuesto_mensual: num_(c.presupuesto_mensual),
      gasto_ads_total: num_(c.gasto_ads_total),
      iva_total: num_(c.iva_total),
      cobro_total: num_(c.cobro_total),
      reported_spend: reportedSpend,
      spend_source: num_(c.cobro_total) > 0 ? 'cobro_total' : 'metricas',
      ...agg,
      spend: realSpend,
      budget,
      budget_status: budget.status,
      budget_recommendation: budget.recommendation,
      monthly_budget_estimated: budget.monthly_budget_estimated,
      budget_used_pct: budget.used_pct,
      budget_remaining: budget.remaining,
      projected_spend: budget.projected_spend,
      safe_daily_spend: budget.safe_daily_spend,
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
    acc.budget_monthly_target += num_(r.budget && r.budget.monthly_budget_target);
    acc.budget_spend_to_date += num_(r.budget && r.budget.spend_to_date);
    acc.budget_committed += num_(r.budget && (r.budget.committed_spend != null ? r.budget.committed_spend : r.budget.spend_to_date));
    acc.budget_remaining += num_(r.budget && r.budget.remaining);
    acc.budget_projected_spend += num_(r.budget && r.budget.projected_spend);
    acc.budget_campaigns += 1;
    if ((r.budget && r.budget.status) === 'danger') acc.budget_danger += 1;
    if ((r.budget && r.budget.status) === 'warning') acc.budget_warning += 1;
    if ((r.budget && r.budget.status) === 'missing') acc.budget_missing += 1;
    return acc;
  }, { ...baseAgg_(), reported_spend: 0, cobro_total: 0, budget_monthly_target: 0, budget_spend_to_date: 0, budget_committed: 0, budget_remaining: 0, budget_projected_spend: 0, budget_campaigns: 0, budget_danger: 0, budget_warning: 0, budget_missing: 0 });
  const globalMax = getGlobalMaxBudget_();
  total.global_max_budget = globalMax;
  if (globalMax > 0) {
    total.budget_monthly_target = globalMax;
    total.budget_remaining = globalMax - total.budget_committed;
  } else {
    total.budget_remaining = total.budget_monthly_target - total.budget_committed;
  }
  total.budget_used_pct = safeDiv_(total.budget_spend_to_date, total.budget_monthly_target);
  total.budget_global_status = total.budget_missing === total.budget_campaigns ? 'missing' : total.budget_danger ? 'danger' : total.budget_warning ? 'warning' : 'ok';

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
    reactions: 0,
    conversions: 0,
    interactions: 0,
    raw_leads: 0,
    qualified_leads: 0,
    converted_leads: 0,
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
  agg.reactions += int_(m.reactions);
  agg.conversions += int_(m.conversions);
  agg.interactions += int_(m.interactions);
  agg.raw_leads += int_(m.raw_leads);
  agg.qualified_leads += int_(m.qualified_leads);
  agg.converted_leads += int_(m.converted_leads);
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

function campaignOutsideBudgetMonth_(campaign, from, to) {
  if (!from && !to) return false;
  const mode = normalizeBudgetMode_(campaign.budget_mode || inferBudgetMode_(campaign));
  const fin = asDate_(campaign.fecha_fin);
  const status = str_(campaign.estado).toLowerCase();
  const isFinished = status.indexOf('fin') !== -1 || (fin && fin < startOfDay_(new Date()));
  const billing = asDate_(campaign.fecha_facturacion);
  // Pago unico/anticipado o cualquier campana con fecha de facturacion: su gasto es un monto
  // que pertenece al MES en que nos cobraron. Las campanas finalizadas tambien se anclan a su
  // mes (facturacion si existe; si no, inicio/creacion). Las continuas activas sin facturacion
  // y con gasto diario se dejan como antes (no se excluyen aqui).
  const isLumpSum = mode === 'one_time' || !!billing;
  if (!isFinished && !isLumpSum) return false;
  const anchor = billing || asDate_(campaign.fecha_inicio) || asDate_(campaign.fecha_creacion) || fin;
  if (!anchor) return false;
  if (from && startOfDay_(anchor) < startOfDay_(from)) return true;
  if (to && startOfDay_(anchor) > endOfDay_(to)) return true;
  return false;
}

function getGlobalMaxBudget_() {
  const sh = sheet_(CFG.SHEET_PARAMS);
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (str_(values[i][0]) === 'presupuesto_maximo_global') return num_(values[i][1]);
  }
  return 0;
}

function setGlobalMaxBudget_(amount) {
  const sh = sheet_(CFG.SHEET_PARAMS);
  const values = sh.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    if (str_(values[i][0]) === 'presupuesto_maximo_global') {
      sh.getRange(i + 1, 2).setValue(num_(amount));
      return num_(amount);
    }
  }
  sh.appendRow(['presupuesto_maximo_global', num_(amount)]);
  return num_(amount);
}

function api_setGlobalBudget_(p) {
  const amount = num_(p && p.amount);
  setGlobalMaxBudget_(amount);
  return { ok: true, amount };
}

function campaignOverlapsRange_(campaign, from, to) {
  if (!from && !to) return true;
  const start = startOfDay_(asDate_(campaign.fecha_inicio) || asDate_(campaign.fecha_creacion) || new Date(1900, 0, 1));
  const end = asDate_(campaign.fecha_fin)
    ? endOfDay_(asDate_(campaign.fecha_fin))
    : endOfDay_(new Date(2999, 11, 31));
  const rangeStart = from ? startOfDay_(from) : new Date(1900, 0, 1);
  const rangeEnd = to ? endOfDay_(to) : new Date(2999, 11, 31);
  return start <= rangeEnd && end >= rangeStart;
}

function getCampaignPeriod_(campaign, from, to) {
  const now = new Date();
  const status = str_(campaign.estado).toLowerCase();
  const campaignStart = asDate_(campaign.fecha_inicio) || asDate_(campaign.fecha_creacion) || now;
  const campaignEnd = asDate_(campaign.fecha_fin);
  const isFinished = status.indexOf('fin') !== -1 || (campaignEnd && campaignEnd < startOfDay_(now));
  let start;
  let end;

  if (isFinished) {
    start = startOfDay_(campaignStart);
    end = endOfDay_(campaignEnd || campaignStart);
  } else {
    const monthAnchor = from || now;
    const monthStart = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth(), 1);
    const monthEnd = new Date(monthAnchor.getFullYear(), monthAnchor.getMonth() + 1, 0);
    start = startOfDay_(campaignStart > monthStart ? campaignStart : monthStart);
    end = endOfDay_(campaignEnd && campaignEnd < monthEnd ? campaignEnd : monthEnd);
  }

  const today = endOfDay_(now);
  const elapsedEnd = today < end ? today : end;
  const totalDays = Math.max(1, daysBetweenInclusive_(start, end));
  const elapsedDays = elapsedEnd < start ? 0 : Math.min(totalDays, daysBetweenInclusive_(start, elapsedEnd));
  return {
    start,
    end,
    scope: isFinished ? 'campaign_closed' : 'monthly_active',
    is_finished: isFinished,
    total_days: totalDays,
    elapsed_days: elapsedDays,
    remaining_days: Math.max(0, totalDays - elapsedDays),
    expected_progress: safeDiv_(elapsedDays, totalDays),
  };
}

function getSpendToDate_(campaign, metrics, period) {
  const id = str_(campaign.campaign_id);
  const relevant = (metrics || [])
    .filter(m => str_(m.campaign_id) === id)
    .filter(m => {
      const d = asDate_(m.date);
      return d && d >= startOfDay_(period.start) && d <= endOfDay_(period.end);
    })
    .sort((a, b) => (asDate_(a.date) || 0) - (asDate_(b.date) || 0));

  let dailyTotal = 0;
  let lastSnapshot = null;
  let finalTotal = null;

  relevant.forEach(m => {
    const type = normalizeSpendEntryType_(m.spend_entry_type);
    const spend = num_(m.spend);
    if (type === 'final_total') finalTotal = spend;
    else if (type === 'period_snapshot') lastSnapshot = spend;
    else dailyTotal += spend;
  });

  if (finalTotal != null) return { spend: finalTotal, source: 'final_total' };
  if (lastSnapshot != null) return { spend: lastSnapshot, source: 'period_snapshot' };

  const campaignSpend = num_(campaign.cobro_total || campaign.gasto_ads_total);
  if (campaignSpend > 0) return { spend: campaignSpend, source: num_(campaign.cobro_total) > 0 ? 'cobro_total' : 'gasto_ads_total' };
  return { spend: dailyTotal, source: 'daily_amount' };
}

function getBudgetAnalytics_(campaign, allMetrics, from, to) {
  const c = campaign || {};
  const mode = normalizeBudgetMode_(c.budget_mode || inferBudgetMode_(c));
  const period = getCampaignPeriod_(c, from, to);
  const spendInfo = getSpendToDate_(c, allMetrics, period);
  const dailyBudget = num_(c.presupuesto_diario);
  const explicitMonthly = num_(c.monthly_budget_target || c.presupuesto_mensual);
  const googleMonthlyEstimate = dailyBudget > 0 ? dailyBudget * 30.4 : 0;
  const monthlyTarget = explicitMonthly || ((mode === 'daily_google' || mode === 'daily_meta') ? googleMonthlyEstimate : num_(c.cobro_total || c.gasto_ads_total));
  const spendToDate = num_(spendInfo.spend);
  const usedPct = safeDiv_(spendToDate, monthlyTarget);
  const expectedSpend = monthlyTarget * period.expected_progress;
  const pacingPct = safeDiv_(spendToDate, expectedSpend);
  const projectedSpend = period.is_finished ? spendToDate : (period.elapsed_days > 0 ? (spendToDate / period.elapsed_days) * period.total_days : spendToDate);
  const remaining = monthlyTarget ? monthlyTarget - spendToDate : 0;
  const safeDailySpend = period.is_finished ? 0 : (period.remaining_days > 0 ? Math.max(0, remaining / period.remaining_days) : Math.max(0, remaining));
  const possibleDailyMax = dailyBudget > 0 ? dailyBudget * 2 : 0;
  // "Comprometido / estimado": lo que vamos a tener que cubrir aunque aun no se haya cobrado.
  // Para campanas continuas diarias (Google/Meta) reservamos el estimado mensual aunque no haya
  // gasto registrado todavia, asi se puede planear cuanto margen queda para las demas.
  const isDaily = mode === 'daily_google' || mode === 'daily_meta';
  const monthlyEstimate = isDaily ? (monthlyTarget || googleMonthlyEstimate) : 0;
  const committedSpend = period.is_finished
    ? spendToDate
    : Math.max(spendToDate, projectedSpend, monthlyEstimate);
  const status = getBudgetStatus_({ monthlyTarget, usedPct, pacingPct, projectedSpend, isFinished: period.is_finished });
  const recommendation = getBudgetRecommendation_({ status, mode, projectedSpend, monthlyTarget, safeDailySpend, dailyBudget, isFinished: period.is_finished, remaining });

  return {
    mode,
    monthly_budget_target: monthlyTarget,
    monthly_budget_estimated: googleMonthlyEstimate,
    possible_daily_max: possibleDailyMax,
    spend_to_date: spendToDate,
    spend_source: spendInfo.source,
    committed_spend: committedSpend,
    remaining,
    used_pct: usedPct,
    expected_progress: period.expected_progress,
    expected_spend_to_date: expectedSpend,
    pacing_pct: pacingPct,
    projected_spend: projectedSpend,
    safe_daily_spend: safeDailySpend,
    status,
    recommendation,
    scope: period.scope,
    is_finished: period.is_finished,
    period_start: isoDate_(period.start),
    period_end: isoDate_(period.end),
    period_total_days: period.total_days,
    period_elapsed_days: period.elapsed_days,
    period_remaining_days: period.remaining_days,
  };
}

function getBudgetStatus_(data) {
  if (!num_(data.monthlyTarget)) return 'missing';
  if (data.isFinished) return num_(data.usedPct) > 1.0001 ? 'danger' : 'ok';
  if (num_(data.usedPct) > 1 || num_(data.projectedSpend) > num_(data.monthlyTarget) * 1.08) return 'danger';
  if (num_(data.usedPct) >= 0.85 || num_(data.pacingPct) > 1.15) return 'warning';
  return 'ok';
}

function getBudgetRecommendation_(data) {
  if (data.status === 'missing') return 'Completar presupuesto objetivo antes de decidir inversion.';
  if (data.isFinished && data.status === 'ok') return 'Cerrada dentro del presupuesto maximo definido por Musicala.';
  if (data.isFinished && data.status === 'danger') return 'Cerrada por encima del presupuesto maximo. Revisar antes de repetir.';
  if (data.status === 'danger') return 'Pausar o bajar presupuesto: la proyeccion puede pasar el techo planeado.';
  if (data.status === 'warning') return `Ajustar ritmo: no superar ${moneyText_(data.safeDailySpend)} diarios para cerrar dentro del plan.`;
  if (num_(data.safeDailySpend) > num_(data.dailyBudget) * 1.25 && num_(data.projectedSpend) < num_(data.monthlyTarget) * 0.75) return 'Escalar con cuidado: hay margen disponible frente al presupuesto planeado.';
  return 'Mantener: el gasto va dentro del presupuesto esperado.';
}

function inferBudgetMode_(campaign) {
  const c = campaign || {};
  const text = `${c.canal || ''} ${c.plataforma || ''} ${c.modelo_cobro || ''}`.toLowerCase();
  if (text.indexOf('google') !== -1) return 'daily_google';
  if ((num_(c.cobro_total) > 0 || num_(c.gasto_ads_total) > 0) && !num_(c.presupuesto_diario)) return 'one_time';
  if (text.indexOf('meta') !== -1 || text.indexOf('facebook') !== -1 || text.indexOf('instagram') !== -1) return num_(c.presupuesto_diario) ? 'daily_meta' : 'one_time';
  return 'monthly_cap';
}

function normalizeBudgetMode_(value) {
  const v = str_(value);
  if (['one_time', 'daily_google', 'daily_meta', 'monthly_cap'].indexOf(v) !== -1) return v;
  return 'monthly_cap';
}

function normalizeSpendEntryType_(value) {
  const v = str_(value);
  if (['daily_amount', 'period_snapshot', 'final_total'].indexOf(v) !== -1) return v;
  return 'daily_amount';
}

function daysBetweenInclusive_(start, end) {
  const a = startOfDay_(start);
  const b = startOfDay_(end);
  return Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
}

function moneyText_(value) {
  return '$' + Math.round(num_(value)).toLocaleString('es-CO');
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
    'fecha_creacion',
    'fecha_inicio',
    'fecha_fin',
    'fecha_facturacion',
    'tipo_duracion',
    'estado',
    'presupuesto_diario',
    'presupuesto_mensual',
    'budget_mode',
    'monthly_budget_target',
    'cpl_target',
    'budget_notes',
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
    'spend_entry_type',
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
    'platform_type',
    'total_charge',
    'tax_amount',
    'daily_budget',
    'duration_days',
    'conversations_started',
    'cost_per_conversation',
    'reactions',
    'optimization_score',
    'ctr',
    'avg_cpc',
    'conversions',
    'interactions',
    'raw_leads',
    'qualified_leads',
    'converted_leads',
    'top_searches',
    'costly_keywords',
    'best_keywords',
    'quick_observation',
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

function inferPlatformType_(campaign) {
  const text = str_((campaign && campaign.canal) || '') + ' ' + str_((campaign && campaign.plataforma) || '');
  const lower = text.toLowerCase();
  if (lower.indexOf('meta') !== -1 || lower.indexOf('facebook') !== -1 || lower.indexOf('instagram') !== -1) return 'meta';
  if (lower.indexOf('google') !== -1) return 'google';
  return 'general';
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
