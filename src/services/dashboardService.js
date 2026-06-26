import { normalizePlatform, normalizeStatus } from "./campaignsService.js";
import { buildDashboardInsights, enrichCampaignDecision } from "./decisionService.js";

export function buildDashboard(campaigns = [], metrics = [], realityRows = [], filters = {}, settings = {}) {
  const globalBudget = num(settings.globalMonthlyBudget);

  const filteredCampaigns = campaigns.filter((campaign) => {
    if (campaign.archived === true) return false;
    const platformOk = !filters.platform || normalizePlatform(campaign.platform || campaign.canal || campaign.plataforma) === filters.platform;
    const statusOk = !filters.status || normalizeStatus(campaign.status || campaign.estado) === filters.status;
    return platformOk && statusOk;
  });
  const ids = new Set(filteredCampaigns.map((c) => c.campaign_id || c.id));
  const scopedMetrics = metrics.filter((m) => ids.has(m.campaign_id) && isMetricInRange(m, filters));
  const scopedReality = realityRows.filter((r) => ids.has(r.sourceCampaignId) || ids.has(r.campaign_id));

  const realityByCampaign = groupRealityByCampaign(scopedReality);
  const spendByCampaign = buildSpendByCampaign(metrics.filter((m) => ids.has(m.campaign_id)), filters, filteredCampaigns);
  const rows = groupByCampaign(scopedMetrics, filteredCampaigns, realityByCampaign, spendByCampaign);
  const totals = summarize(rows);
  totals.active_campaigns = filteredCampaigns.filter((c) => normalizeStatus(c.status || c.estado) === "activa").length;
  totals.global_max_budget = globalBudget || 0;
  totals.budget_monthly_target = globalBudget || rows.reduce((acc, r) => acc + num(r.monthly_budget_target), 0);
  totals.budget_spend_to_date = totals.spend;
  totals.budget_remaining = Math.max(0, totals.budget_monthly_target - totals.spend);
  totals.budget_used_pct = safeDiv(totals.spend, totals.budget_monthly_target);
  totals.budget_projected_spend = totals.spend;
  totals.budget_committed = totals.spend;

  const enrichedRows = rows.map((r) => enrichCampaignDecision({ ...r, budget: buildBudget(r), settings }, settings));
  const insights = buildDashboardInsights(enrichedRows, totals, filters, settings);

  return {
    ok: true,
    settings,
    totals,
    rows: enrichedRows,
    rankings: {
      bestROAS: enrichedRows.slice().sort((a, b) => (b.real_roas || b.roas) - (a.real_roas || a.roas)),
      bestCPL: enrichedRows.filter((r) => r.leads > 0).sort((a, b) => a.cpl - b.cpl),
      bestSales: enrichedRows.filter((r) => r.sales > 0).sort((a, b) => b.sales - a.sales),
      bestRevenue: enrichedRows.filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue),
      bestEnrollments: enrichedRows.filter((r) => r.real_enrollments > 0).sort((a, b) => b.real_enrollments - a.real_enrollments),
      waste: enrichedRows.filter((r) => r.spend > 0 && r.real_new_contacts === 0 && r.leads === 0).sort((a, b) => b.spend - a.spend),
      winners: insights.winners,
      needsAttention: insights.needsAttention,
    },
    insights,
    funnel: buildFunnel(totals),
    series: groupByDate(scopedMetrics),
  };
}

function groupRealityByCampaign(realityRows) {
  const map = new Map();
  realityRows.forEach((r) => {
    const id = r.sourceCampaignId || r.campaign_id;
    if (!id) return;
    const acc = map.get(id) || {
      real_new_contacts: 0,
      real_qualified_leads: 0,
      real_trial_classes: 0,
      real_enrollments: 0,
      real_revenue: 0,
    };
    acc.real_new_contacts += num(r.newContacts);
    acc.real_qualified_leads += num(r.qualifiedLeads);
    acc.real_trial_classes += num(r.trialClasses);
    acc.real_enrollments += num(r.enrollments);
    acc.real_revenue += num(r.revenue);
    map.set(id, acc);
  });
  return map;
}

function groupByCampaign(metrics, campaigns, realityByCampaign, spendByCampaign = new Map()) {
  const byId = new Map(campaigns.map((c) => [c.campaign_id || c.id, {
    ...c,
    spend: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, leads: 0, messages: 0, conversions: 0, sales: 0, revenue: 0, video_plays: 0, post_interactions: 0,
    real_new_contacts: 0, real_qualified_leads: 0, real_trial_classes: 0, real_enrollments: 0, real_revenue: 0,
  }]));
  metrics.forEach((m) => {
    const row = byId.get(m.campaign_id);
    if (!row) return;
    addMetrics(row, m);
  });
  for (const [id, spend] of spendByCampaign.entries()) {
    const row = byId.get(id);
    if (row) row.spend = spend;
  }
  for (const [id, reality] of realityByCampaign.entries()) {
    const row = byId.get(id);
    if (!row) continue;
    Object.assign(row, reality);
  }
  return Array.from(byId.values()).map(derive);
}

function groupByDate(metrics) {
  const byDate = new Map();
  metrics.forEach((m) => {
    const date = m.date || "";
    if (!date) return;
    const row = byDate.get(date) || { date, spend: 0, impressions: 0, clicks: 0, leads: 0, conversions: 0, sales: 0, revenue: 0 };
    addMetrics(row, m);
    byDate.set(date, derive(row));
  });
  return Array.from(byDate.values()).sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function buildSpendByCampaign(metrics, filters = {}, campaigns = []) {
  const byId = new Map();
  metrics.forEach((m) => {
    const id = m.campaign_id;
    if (!id) return;
    const rows = byId.get(id) || [];
    rows.push(m);
    byId.set(id, rows);
  });

  const out = new Map();
  for (const [id, rows] of byId.entries()) {
    const campaign = campaigns.find((item) => String(item.campaign_id || item.id) === String(id));
    out.set(id, spendForPeriod(rows, filters, campaign));
  }
  return out;
}

function spendForPeriod(metrics, filters = {}, campaign = {}) {
  const sorted = metrics
    .filter((m) => m.date)
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  const latestCumulativeInRange = lastOf(sorted.filter((m) => isSpendInRange(m, filters, campaign) && isCumulativeSpend(m)));
  const dailyAfterLatestCumulative = latestCumulativeInRange
    ? sorted.filter((m) => isSpendInRange(m, filters, campaign) && spendEntryType(m) === "daily_amount" && String(m.date || "") > String(latestCumulativeInRange.date || ""))
    : sorted.filter((m) => isSpendInRange(m, filters, campaign) && spendEntryType(m) === "daily_amount");
  const dailyTotal = dailyAfterLatestCumulative.reduce((acc, m) => acc + num(m.spend), 0);

  if (!latestCumulativeInRange) return dailyTotal;

  // El acumulado corresponde al periodo seleccionado en la plataforma (normalmente el mes).
  // El registro mas reciente reemplaza snapshots anteriores del mismo periodo.
  return dailyTotal + num(latestCumulativeInRange.spend);
}

function isSpendInRange(metric, filters = {}, campaign = {}) {
  const period = spendBudgetPeriod(metric, campaign);
  if (!period) return isMetricInRange(metric, filters);
  const fromPeriod = String(filters.from || "").slice(0, 7);
  const toPeriod = String(filters.to || "").slice(0, 7);
  if (fromPeriod && period < fromPeriod) return false;
  if (toPeriod && period > toPeriod) return false;
  return true;
}

function spendBudgetPeriod(metric, campaign = {}) {
  const explicit = String(metric?.budget_period || "").slice(0, 7);
  if (explicit) return explicit;

  const startMonth = String(campaign.fecha_inicio || campaign.startDate || "").slice(0, 7);
  const endMonth = String(campaign.fecha_fin || campaign.endDate || "").slice(0, 7);
  const metricDate = String(metric?.date || "");
  const endDate = String(campaign.fecha_fin || campaign.endDate || "");
  const namedForStartMonth = /(?:^|\s|-)mayo(?:\s|$|-)/i.test(String(campaign.nombre || campaign.name || ""));
  if (startMonth && endDate && metricDate >= endDate && (startMonth === endMonth || namedForStartMonth)) {
    return startMonth;
  }
  return metricDate.slice(0, 7);
}

function isMetricInRange(metric, filters = {}) {
  const date = String(metric.date || "");
  if (!date) return false;
  if (filters.from && date < filters.from) return false;
  if (filters.to && date > filters.to) return false;
  return true;
}

function isCumulativeSpend(metric) {
  const type = spendEntryType(metric);
  return type === "period_snapshot" || type === "final_total";
}

function spendEntryType(metric) {
  const type = String(metric?.spend_entry_type || "").trim();
  return type === "period_snapshot" || type === "final_total" ? type : "daily_amount";
}

function lastOf(items) {
  return items.length ? items[items.length - 1] : null;
}

function summarize(rows) {
  const total = {
    spend: 0, reported_spend: 0, impressions: 0, reach: 0, clicks: 0, link_clicks: 0, leads: 0, messages: 0, conversions: 0, sales: 0, revenue: 0, video_plays: 0, post_interactions: 0,
    saves: 0, shares: 0, comments: 0, reactions: 0, page_likes: 0, meta_leads: 0,
    real_new_contacts: 0, real_qualified_leads: 0, real_trial_classes: 0, real_enrollments: 0, real_revenue: 0,
  };
  rows.forEach((r) => addMetrics(total, r));
  const derived = derive(total);
  // Alias para la capa de UI / reportes ejecutivos.
  derived.new_contacts = derived.real_new_contacts;
  derived.qualified_leads = derived.real_qualified_leads;
  derived.trial_classes = derived.real_trial_classes;
  derived.enrollments = derived.real_enrollments;
  return derived;
}

const SUM_KEYS = [
  "spend", "reported_spend", "impressions", "reach", "clicks", "link_clicks", "leads", "messages", "conversions", "sales", "revenue", "video_plays", "post_interactions",
  "saves", "shares", "comments", "reactions", "page_likes", "meta_leads",
  "real_new_contacts", "real_qualified_leads", "real_trial_classes", "real_enrollments", "real_revenue",
];

function addMetrics(target, source) {
  SUM_KEYS.forEach((key) => {
    target[key] = num(target[key]) + num(source[key]);
  });
}

function derive(row) {
  // Metricas de pauta (plataforma).
  row.cpl = safeDiv(row.spend, row.leads);
  row.cpc = safeDiv(row.spend, row.clicks || row.link_clicks);
  row.cpa = safeDiv(row.spend, row.sales || row.conversions);
  row.cost_per_sale = safeDiv(row.spend, row.sales);
  row.click_to_lead_rate = safeDiv(row.leads, row.clicks || row.link_clicks);
  row.lead_to_sale_rate = safeDiv(row.sales, row.leads);
  row.revenue_per_lead = safeDiv(row.revenue, row.leads);
  row.ctr = safeDiv(row.clicks || row.link_clicks, row.impressions);
  row.roas = safeDiv(row.revenue, row.spend);

  // Realidad comercial Musicala.
  row.cost_per_contact = safeDiv(row.spend, row.real_new_contacts);
  row.cost_per_qualified_lead = safeDiv(row.spend, row.real_qualified_leads);
  row.cost_per_trial = safeDiv(row.spend, row.real_trial_classes);
  row.cost_per_enrollment = safeDiv(row.spend, row.real_enrollments);
  row.real_roas = safeDiv(row.real_revenue, row.spend);

  // Tasas del embudo comercial.
  row.contact_to_qualified_rate = safeDiv(row.real_qualified_leads, row.real_new_contacts);
  row.qualified_to_trial_rate = safeDiv(row.real_trial_classes, row.real_qualified_leads);
  row.trial_to_enrollment_rate = safeDiv(row.real_enrollments, row.real_trial_classes);
  row.lead_to_enrollment_rate = safeDiv(row.real_enrollments, row.real_qualified_leads);
  return row;
}

function buildFunnel(totals) {
  return [
    { key: "impressions", label: "Impresiones", value: num(totals.impressions) },
    { key: "clicks", label: "Clics", value: num(totals.link_clicks || totals.clicks) },
    { key: "leads", label: "Mensajes/Leads", value: num(totals.leads || totals.messages) },
    { key: "real_new_contacts", label: "Contactos reales", value: num(totals.real_new_contacts) },
    { key: "real_qualified_leads", label: "Leads calificados", value: num(totals.real_qualified_leads) },
    { key: "real_trial_classes", label: "Clases de prueba", value: num(totals.real_trial_classes) },
    { key: "real_enrollments", label: "Matriculas", value: num(totals.real_enrollments) },
    { key: "real_revenue", label: "Ingreso real", value: num(totals.real_revenue), money: true },
  ];
}

function buildBudget(row) {
  const target = num(row.monthly_budget_target || row.presupuesto_mensual || row.budget);
  const used = safeDiv(row.spend, target);
  return {
    monthly_budget_target: target,
    spend_to_date: row.spend,
    remaining: Math.max(0, target - row.spend),
    projected_spend: row.spend,
    committed_spend: row.spend,
    safe_daily_spend: Math.max(0, target - row.spend),
    used_pct: used,
    expected_progress: 1,
    status: !target ? "missing" : used >= 1 ? "danger" : used >= 0.8 ? "warning" : "ok",
    mode: row.budget_mode,
    recommendation: !target ? "Define presupuesto maximo." : used >= 1 ? "Pausar o revisar antes de seguir gastando." : "Ritmo dentro del presupuesto.",
  };
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(a, b) {
  const den = num(b);
  return den ? num(a) / den : 0;
}
