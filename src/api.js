import { currentUser, isAuthorizedUser, waitForAuthReady } from "./services/authService.js";
import { archiveCampaign, deleteCampaign, listCampaigns, reactivateCampaign, saveCampaign, updateCampaignStatus } from "./services/campaignsService.js";
import { addMetric, listMetrics, saveMetric } from "./services/metricsService.js";
import { addMusicalaReality, listMusicalaReality, normalizeReality } from "./services/realityService.js";
import { getCampaignOptions, getGlobalBudget, getMarketingSettings, saveCampaignOptions, saveMarketingSettings, setGlobalBudget } from "./services/settingsService.js";
import { addDecisionLog, listDecisionLog } from "./services/decisionLogService.js";
import { addMarketingTask, listMarketingTasks, taskFromAction, updateMarketingTask } from "./services/tasksService.js";
import { buildDashboard } from "./services/dashboardService.js";

function requireAuth() {
  if (!currentUser()) throw new Error("Inicia sesion con Google para leer y guardar en Firebase.");
  if (!isAuthorizedUser()) throw new Error("Tu correo no esta autorizado para usar esta app.");
}

// Registra una decision sin romper la operacion principal si el log falla.
async function safeLog(campaignId, payload) {
  try {
    if (campaignId) await addDecisionLog(campaignId, payload);
  } catch (_) {}
}

export const API = {
  async boot() {
    await waitForAuthReady();
    requireAuth();
    const campaigns = await listCampaigns();
    return {
      ok: true,
      params: {
        Plataformas: ["meta", "google", "tiktok", "otro"],
        Estados: ["activa", "pausada", "finalizada"],
      },
      campaigns,
    };
  },
  async listCampaigns() {
    requireAuth();
    return { ok: true, campaigns: await listCampaigns() };
  },
  async saveCampaign(payload) {
    requireAuth();
    const id = await saveCampaign(payload);
    return { ok: true, id, campaign_id: id };
  },
  async pauseCampaign(id) {
    requireAuth();
    await updateCampaignStatus(id, "pausada");
    return { ok: true };
  },
  async deleteCampaign(id) {
    requireAuth();
    await archiveCampaign(id);
    await safeLog(id, { type: "archive", label: "Campana archivada", reason: "Archivado logico desde la app." });
    return { ok: true, archived: true };
  },
  async archiveCampaign(id) {
    requireAuth();
    await archiveCampaign(id);
    await safeLog(id, { type: "archive", label: "Campana archivada", reason: "Archivado logico desde la app." });
    return { ok: true, archived: true };
  },
  async reactivateCampaign(id) {
    requireAuth();
    const newId = await reactivateCampaign(id);
    await safeLog(id, { type: "reactivate", label: "Campana reactivada", reason: `Se creo la version nueva ${newId}.`, nextAction: "Vigilar costo por matricula y calidad de contactos." });
    await safeLog(newId, { type: "reactivate", label: "Reactivacion", reason: `Reactivada desde ${id}.` });
    return { ok: true, id: newId, campaign_id: newId };
  },
  async addDecisionLog(campaignId, payload) {
    requireAuth();
    const logId = await addDecisionLog(campaignId, payload);
    return { ok: true, id: logId };
  },
  async listDecisionLog(campaignId) {
    requireAuth();
    return { ok: true, rows: await listDecisionLog(campaignId) };
  },
  async addMarketingTask(payload) {
    requireAuth();
    const id = await addMarketingTask(payload);
    return { ok: true, id };
  },
  async addTaskFromAction(action) {
    requireAuth();
    const id = await addMarketingTask(taskFromAction(action));
    return { ok: true, id };
  },
  async updateMarketingTask(id, patch) {
    requireAuth();
    await updateMarketingTask(id, patch);
    return { ok: true };
  },
  async listMarketingTasks(filters = {}) {
    requireAuth();
    return { ok: true, rows: await listMarketingTasks(filters) };
  },
  async addMetric(payload) {
    requireAuth();
    const id = await addMetric(payload);
    return { ok: true, id };
  },
  async addMusicalaReality(payload) {
    requireAuth();
    const id = await addMusicalaReality(payload);
    return { ok: true, id };
  },
  async queryMetrics(filters = {}) {
    requireAuth();
    const campaigns = await listCampaigns();
    return { ok: true, rows: await listMetrics(campaigns, filters) };
  },
  async dashboard(filters = {}) {
    requireAuth();
    const campaigns = await listCampaigns();
    const metrics = await listMetrics(campaigns, filters);
    const reality = await listMusicalaReality(filters);
    const settings = await getMarketingSettings();
    return buildDashboard(campaigns, metrics, reality, filters, settings);
  },
  async listMusicalaReality(filters = {}) {
    requireAuth();
    return { ok: true, rows: await listMusicalaReality(filters) };
  },
  async getMarketingSettings() {
    requireAuth();
    return { ok: true, settings: await getMarketingSettings() };
  },
  async saveMarketingSettings(payload) {
    requireAuth();
    await saveMarketingSettings(payload);
    return { ok: true };
  },
  async getCampaignOptions() {
    requireAuth();
    return { ok: true, options: await getCampaignOptions() };
  },
  async saveCampaignOptions(payload) {
    requireAuth();
    const res = await saveCampaignOptions(payload);
    return { ok: true, options: res.options };
  },
  async setGlobalBudget(amount) {
    requireAuth();
    const value = await setGlobalBudget(amount);
    return { ok: true, amount: value };
  },
  async getGlobalBudget() {
    const amount = await getGlobalBudget();
    return { ok: true, amount };
  },
  async ping() {
    requireAuth();
    return { ok: true, source: "firebase" };
  },
  async importMarketingWorkbook(file) {
    requireAuth();
    if (!file) throw new Error("Selecciona un archivo Excel.");

    const campaignsData = await firstAvailableSheet(file, ["campaigns", "campañas"]);
    const metricsData = await firstAvailableSheet(file, ["Metricas", "Métricas"]);
    const paramsData = await firstAvailableSheet(file, ["Parametros", "Parámetros"]);
    const realityData = await firstAvailableSheet(file, ["Realidad", "realidad", "musicalaReality"]);

    if (!campaignsData) throw new Error("No encontre una hoja campaigns/campañas.");

    const campaignRows = rowsToObjects(campaignsData.rows);
    const metricRows = metricsData ? rowsToObjects(metricsData.rows) : [];
    const paramRows = paramsData ? rowsToObjects(paramsData.rows) : [];
    const realityRows = realityData ? rowsToObjects(realityData.rows) : [];

    const warnings = [];
    let skippedRows = 0;

    const campaigns = campaignRows
      .filter((row) => row.campaign_id || row.nombre || row.name)
      .map(normalizeImportedCampaign);
    skippedRows += campaignRows.length - campaigns.length;

    const campaignIds = new Set();
    let campaignsImported = 0;
    for (const campaign of campaigns) {
      try {
        const id = await saveCampaign(campaign);
        campaignIds.add(id);
        campaignsImported += 1;
      } catch (err) {
        skippedRows += 1;
        warnings.push(`Campana ${campaign.campaign_id || campaign.nombre || "?"}: ${err.message}`);
      }
    }

    let metricsImported = 0;
    for (const rawMetric of metricRows) {
      const metric = normalizeImportedMetric(rawMetric);
      if (!metric.campaign_id || !metric.date) {
        skippedRows += 1;
        warnings.push(`Metrica omitida: falta campaign_id o fecha (${metric.campaign_id || "?"} / ${metric.date || "?"}).`);
        continue;
      }
      if (!campaignIds.has(metric.campaign_id)) campaignIds.add(metric.campaign_id);
      try {
        await saveMetric(metric, importMetricId(metric));
        metricsImported += 1;
      } catch (err) {
        skippedRows += 1;
        warnings.push(`Metrica ${metric.campaign_id} ${metric.date}: ${err.message}`);
      }
    }

    let realityImported = 0;
    for (const rawReality of realityRows) {
      const reality = normalizeReality({
        date: rawReality.fecha || rawReality.date,
        sourceCampaignId: rawReality.campaign_id || rawReality.sourcecampaignid || rawReality.campaignid,
        newContacts: rawReality.contactos_nuevos ?? rawReality.newcontacts,
        qualifiedLeads: rawReality.leads_calificados ?? rawReality.qualifiedleads,
        trialClasses: rawReality.clases_prueba ?? rawReality.trialclasses,
        enrollments: rawReality.matriculas ?? rawReality.enrollments,
        revenue: rawReality.ingreso_real ?? rawReality.revenue,
        serviceSold: rawReality.servicio_vendido ?? rawReality.servicesold,
        notes: rawReality.notas ?? rawReality.notes,
      });
      if (!reality.date && !reality.sourceCampaignId) {
        skippedRows += 1;
        continue;
      }
      try {
        await addMusicalaReality(reality);
        realityImported += 1;
      } catch (err) {
        skippedRows += 1;
        warnings.push(`Realidad ${reality.date || "?"}: ${err.message}`);
      }
    }

    const globalBudgetValue = findGlobalBudget(paramRows);
    if (globalBudgetValue) {
      await setGlobalBudget(globalBudgetValue);
    }

    return {
      ok: true,
      campaignsImported,
      metricsImported,
      realityImported,
      globalBudget: globalBudgetValue || 0,
      skippedRows,
      warnings,
      sheets: {
        campaignsSheet: campaignsData.sheet,
        metricsSheet: metricsData?.sheet || "",
        paramsSheet: paramsData?.sheet || "",
        realitySheet: realityData?.sheet || "",
      },
    };
  },
};

window.API = API;

async function firstAvailableSheet(file, sheets) {
  const { readSheet } = await import("read-excel-file/browser");
  for (const sheet of sheets) {
    try {
      const rows = await readSheet(file, sheet);
      if (rows.length > 1) return { sheet, rows };
    } catch (_) {
      // Try next known sheet name.
    }
  }
  return null;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((cell) => normalizeHeader(cell));
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      obj[header] = row[index] ?? "";
    });
    return obj;
  });
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizeImportedCampaign(row) {
  const id = str(row.campaign_id || row.id);
  return {
    ...row,
    campaign_id: id,
    id,
    nombre: str(row.nombre || row.name),
    canal: str(row.canal),
    plataforma: str(row.plataforma),
    objetivo: str(row.objetivo || row.objective),
    servicio: str(row.servicio),
    modalidad: str(row.modalidad),
    fecha_inicio: dateToIso(row.fecha_inicio || row.startdate),
    fecha_fin: dateToIso(row.fecha_fin || row.enddate),
    fecha_creacion: dateToIso(row.fecha_creacion),
    estado: str(row.estado || row.status) || "Activa",
    presupuesto_mensual: num(row.presupuesto_mensual),
    modelo_cobro: str(row.modelo_cobro),
    gasto_ads_total: num(row.gasto_ads_total),
    iva_total: num(row.iva_total),
    cobro_total: num(row.cobro_total),
    responsable: str(row.responsable),
    notas: str(row.notas || row.notes),
    presupuesto_diario: num(row.presupuesto_diario),
    tipo_duracion: str(row.tipo_duracion),
    monthly_budget_target: num(row.monthly_budget_target || row.presupuesto_mensual),
  };
}

function normalizeImportedMetric(row) {
  const campaignId = str(row.campaign_id || row.campaignid);
  return {
    ...row,
    campaign_id: campaignId,
    date: dateToIso(row.date || row.fecha),
    spend: num(row.spend),
    impressions: num(row.impressions),
    reach: num(row.reach || row.viewers),
    clicks: num(row.clicks || row.link_clicks),
    leads: num(row.leads),
    messages: num(row.messages || row.conversations_started || row.leads),
    conversions: num(row.conversions),
    sales: num(row.sales),
    revenue: num(row.revenue),
    notes: str(row.notes),
    video_plays: num(row.video_plays),
    viewers: num(row.viewers),
    link_clicks: num(row.link_clicks || row.clicks),
    post_interactions: num(row.post_interactions),
    saves: num(row.saves),
    shares: num(row.shares),
    comments: num(row.comments),
    platform_type: str(row.platform_type),
    total_charge: num(row.total_charge),
    tax_amount: num(row.tax_amount),
    daily_budget: num(row.daily_budget),
  };
}

function importMetricId(metric) {
  return `${metric.date}_${metric.campaign_id}`.replace(/[^\w-]/g, "_");
}

function findGlobalBudget(rows) {
  const match = rows.find((row) => normalizeHeader(row.lista) === "presupuesto_maximo_global");
  return match ? num(match.valor) : 0;
}

function dateToIso(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const text = String(value).trim();
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return dateToIso(parsed);
  return "";
}

function num(value) {
  if (value === "" || value == null) return 0;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function str(value) {
  return String(value ?? "").trim();
}
