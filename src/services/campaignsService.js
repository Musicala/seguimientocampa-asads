import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

const campaignsRef = collection(db, "campaigns");

export async function listCampaigns(options = {}) {
  const includeArchived = options.includeArchived === true;
  const snap = await getDocs(campaignsRef);
  return snap.docs
    .map((item) => fromFirestoreCampaign(item.id, item.data()))
    .filter((campaign) => includeArchived || campaign.archived !== true)
    .sort((a, b) => sortDateValue(b) - sortDateValue(a));
}

export async function saveCampaign(payload) {
  const user = authUserPayload();
  const now = serverTimestamp();
  const normalized = toFirestoreCampaign(payload);

  if (payload.campaign_id || payload.id) {
    const id = String(payload.campaign_id || payload.id);
    await setDoc(doc(db, "campaigns", id), {
      ...normalized,
      createdAt: payload.createdAt || now,
      updatedAt: now,
      createdBy: payload.createdBy || user,
    }, { merge: true });
    return id;
  }

  const created = await addDoc(campaignsRef, {
    ...normalized,
    createdAt: now,
    updatedAt: now,
    createdBy: user,
  });
  await updateDoc(created, { id: created.id });
  return created.id;
}

export async function updateCampaignStatus(id, status) {
  await updateDoc(doc(db, "campaigns", id), {
    status,
    estado: statusLabel(status),
    updatedAt: serverTimestamp(),
  });
}

const REACTIVATION_MODES = {
  igual: { suffix: "Reactivación", enfoque: "", budgetFactor: 1 },
  creativo: { suffix: "Reactivación (nuevo creativo)", enfoque: "", budgetFactor: 1 },
  presupuesto_reducido: { suffix: "Reactivación (presupuesto reducido)", enfoque: "", budgetFactor: 0.5 },
  test: { suffix: "Test", enfoque: "Test", budgetFactor: 0.5 },
  remarketing: { suffix: "Remarketing", enfoque: "Remarketing", budgetFactor: 1 },
  taller: { suffix: "Taller / temporada", enfoque: "Taller / temporada", budgetFactor: 1 },
};

export async function reactivateCampaign(id, options = {}) {
  const campaigns = await listCampaigns();
  const source = campaigns.find((campaign) => String(campaign.campaign_id || campaign.id) === String(id));
  if (!source) throw new Error("No encontre la campana para reactivar.");

  const mode = REACTIVATION_MODES[options.mode] || REACTIVATION_MODES.igual;
  const learning = String(options.learning || "").trim();
  const hypothesis = String(options.hypothesis || "").trim();

  const baseName = source.nombre || source.name || "Campana";
  const today = localIsoDate(new Date());
  const newId = `RE-${today.replaceAll("-", "")}-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;

  const baseNotes = `Reactivada desde ${source.campaign_id || source.id}.`;
  const learnNote = learning ? ` Aprendizaje: ${learning}.` : "";
  const hypoNote = hypothesis ? ` Hipótesis: ${hypothesis}.` : "";
  const combinedNotes = `${baseNotes}${learnNote}${hypoNote} ${source.notes || source.notas || ""}`.trim();

  await saveCampaign({
    ...source,
    campaign_id: newId,
    id: newId,
    nombre: `${baseName} - ${mode.suffix}`,
    name: `${baseName} - ${mode.suffix}`,
    estado: "Activa",
    status: "activa",
    enfoque: mode.enfoque || source.enfoque || "",
    presupuesto_diario: Math.round(Number(source.presupuesto_diario || 0) * mode.budgetFactor),
    monthly_budget_target: Math.round(Number(source.monthly_budget_target || source.presupuesto_mensual || 0) * mode.budgetFactor),
    fecha_inicio: today,
    startDate: today,
    fecha_fin: "",
    endDate: "",
    fecha_creacion: today,
    createdAt: null,
    notes: combinedNotes,
    notas: combinedNotes,
    sourceCampaignId: source.campaign_id || source.id,
    reactivation_mode: options.mode || "igual",
    aprendizaje_previo: learning,
    hipotesis: hypothesis,
  });
  return newId;
}

// Archivado logico: no se borra el documento ni sus subcolecciones (metricas).
export async function archiveCampaign(id) {
  await updateDoc(doc(db, "campaigns", id), {
    archived: true,
    status: "archivada",
    estado: "Archivada",
    updatedAt: serverTimestamp(),
    archivedAt: serverTimestamp(),
    archivedBy: authUserPayload(),
  });
}

// Compatibilidad: deleteCampaign ahora archiva en vez de borrar.
export async function deleteCampaign(id) {
  await archiveCampaign(id);
}

export function toFirestoreCampaign(payload = {}) {
  const platform = normalizePlatform(payload.platform || payload.platform_type || payload.canal || payload.plataforma);
  const status = normalizeStatus(payload.status || payload.estado);
  return {
    id: payload.id || payload.campaign_id || "",
    name: payload.name || payload.nombre || "",
    platform,
    objective: payload.objective || payload.objetivo || "",
    status,
    budget: Number(payload.budget ?? payload.monthly_budget_target ?? payload.presupuesto_mensual ?? 0) || 0,
    startDate: payload.startDate || payload.fecha_inicio || "",
    endDate: payload.endDate || payload.fecha_fin || "",
    notes: payload.notes || payload.notas || "",
    canal: payload.canal || platformLabel(platform),
    plataforma: payload.plataforma || platformLabel(platform),
    nombre: payload.nombre || payload.name || "",
    objetivo: payload.objetivo || payload.objective || "",
    estado: payload.estado || statusLabel(status),
    fecha_inicio: payload.fecha_inicio || payload.startDate || "",
    fecha_fin: payload.fecha_fin || payload.endDate || "",
    fecha_creacion: payload.fecha_creacion || "",
    fecha_facturacion: payload.fecha_facturacion || "",
    servicio: payload.servicio || "",
    tipo_oferta: payload.tipo_oferta || "",
    modalidad: payload.modalidad || "",
    enfoque: payload.enfoque || "",
    kpi_principal: payload.kpi_principal || "",
    modelo_cobro: payload.modelo_cobro || "",
    presupuesto_diario: Number(payload.presupuesto_diario || 0),
    presupuesto_mensual: Number(payload.presupuesto_mensual || payload.budget || 0),
    budget_mode: payload.budget_mode || "monthly_cap",
    monthly_budget_target: Number(payload.monthly_budget_target || payload.budget || payload.presupuesto_mensual || 0),
    cpl_target: Number(payload.cpl_target || 0),
    budget_notes: payload.budget_notes || "",
    gasto_ads_total: Number(payload.gasto_ads_total || 0),
    iva_total: Number(payload.iva_total || 0),
    cobro_total: Number(payload.cobro_total || 0),
    responsable: payload.responsable || "",
    notas: payload.notas || payload.notes || "",
    continua_de: payload.continua_de || "",
    reactivation_mode: payload.reactivation_mode || "",
    aprendizaje_previo: payload.aprendizaje_previo || "",
    hipotesis: payload.hipotesis || "",
  };
}

export function fromFirestoreCampaign(id, data = {}) {
  const platform = normalizePlatform(data.platform || data.canal || data.plataforma);
  const status = normalizeStatus(data.status || data.estado);
  return {
    ...data,
    id,
    campaign_id: id,
    name: data.name || data.nombre || "",
    nombre: data.nombre || data.name || "",
    platform,
    platform_type: platform,
    canal: data.canal || platformLabel(platform),
    plataforma: data.plataforma || platformLabel(platform),
    objective: data.objective || data.objetivo || "",
    objetivo: data.objetivo || data.objective || "",
    status,
    estado: data.estado || statusLabel(status),
    budget: Number(data.budget ?? data.monthly_budget_target ?? 0),
    startDate: data.startDate || data.fecha_inicio || "",
    endDate: data.endDate || data.fecha_fin || "",
    notes: data.notes || data.notas || "",
  };
}

export function normalizePlatform(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("meta") || text.includes("facebook") || text.includes("instagram")) return "meta";
  if (text.includes("google")) return "google";
  if (text.includes("tiktok") || text.includes("tik tok")) return "tiktok";
  return "otro";
}

export function normalizeStatus(value) {
  const text = String(value || "").toLowerCase();
  if (text.includes("archiv")) return "archivada";
  if (text.includes("paus")) return "pausada";
  if (text.includes("fin")) return "finalizada";
  return "activa";
}

function statusLabel(status) {
  if (status === "pausada") return "Pausada";
  if (status === "finalizada") return "Finalizada";
  return "Activa";
}

function platformLabel(platform) {
  if (platform === "meta") return "Meta";
  if (platform === "google") return "Google Ads";
  if (platform === "tiktok") return "TikTok";
  return "Otro";
}

function sortDateValue(campaign) {
  const raw = campaign.createdAt?.toDate?.() || campaign.fecha_creacion || campaign.startDate || campaign.fecha_inicio || "";
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
