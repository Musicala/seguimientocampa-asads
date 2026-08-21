import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

const BASE_CONFIG = {
  apiKey: "AIzaSyD5cHVQiZzYACLYoWEfOrTO37hDoMfpsDg",
  authDomain: "db-musicala.firebaseapp.com",
  projectId: "db-musicala",
  storageBucket: "db-musicala.firebasestorage.app",
  messagingSenderId: "511593925043",
  appId: "1:511593925043:web:326e4fb5afa5a8c0a563c6",
};

const RIP_CONFIG = {
  apiKey: "AIzaSyCaCizVkfWdx97LROV7PYQbFXLPMpxynBg",
  authDomain: "rip-musicala.firebaseapp.com",
  projectId: "rip-musicala",
  storageBucket: "rip-musicala.firebasestorage.app",
  messagingSenderId: "401885071105",
  appId: "1:401885071105:web:6bb9b6867d7d81fdec3d00",
};

const integratedRef = collection(db, "integratedLeads");
const statusRef = doc(db, "integrationSyncs", "baseRip");

// La primera sincronizacion puede requerir la ventana de Google. Despues, la
// vista de leads puede refrescarse en silencio con las sesiones ya autorizadas.
export async function syncConnectedData({ interactive = true } = {}) {
  const base = await connectProject("base-datos", BASE_CONFIG, { interactive });
  const rip = await connectProject("rip-musicala", RIP_CONFIG, { interactive });

  const [baseRows, payments, computed] = await Promise.all([
    loadBaseRows(base.db),
    loadCollection(rip.db, "registro"),
    loadCollection(rip.db, "studentComputed"),
  ]);

  const paymentByStudent = buildPaymentIndex(payments);
  const computedByStudent = buildComputedIndex(computed);
  const candidates = baseRows
    .map((row) => buildIntegratedLead(row, paymentByStudent, computedByStudent))
    .filter(Boolean);
  markAttributionOwners(candidates);

  const existing = await getDocs(integratedRef);
  const activeIds = new Set(candidates.map((lead) => lead.id));
  const operations = candidates.map((lead) => ({
    ref: doc(db, "integratedLeads", lead.id),
    data: { ...lead, active: true, syncedAt: serverTimestamp() },
  }));
  existing.docs.forEach((item) => {
    if (!activeIds.has(item.id) && item.data()?.active !== false) {
      operations.push({
        ref: item.ref,
        data: { active: false, syncedAt: serverTimestamp(), archivedReason: "not_in_latest_base_sync" },
      });
    }
  });
  await commitOperations(operations);

  const attributed = candidates.filter((lead) => lead.countsForAttribution);
  const summary = {
    baseRowsRead: baseRows.length,
    attributedRows: candidates.length,
    uniqueContacts: attributed.length,
    enrolledContacts: attributed.filter((lead) => lead.studentId).length,
    activeContacts: attributed.filter((lead) => isActiveLabel(lead.activeStatus)).length,
    contactsWithRevenue: attributed.filter((lead) => lead.paidValue > 0).length,
    totalAttributedRevenue: attributed.reduce((sum, lead) => sum + number(lead.paidValue), 0),
    unmatchedRevenueContacts: attributed.filter((lead) => !lead.studentId).length,
    paymentsRead: payments.length,
    computedStudentsRead: computed.length,
    syncedAt: serverTimestamp(),
    syncedBy: authUserPayload(),
    sourceProjects: ["db-musicala", "rip-musicala"],
  };
  await writeStatus(summary);
  return { ...summary, syncedAt: new Date() };
}

export async function listIntegratedLeads(filters = {}) {
  const snap = await getDocs(integratedRef);
  return snap.docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((lead) => lead.active !== false && lead.countsForAttribution !== false)
    .filter((lead) => inRange(lead.date, filters))
    .filter((lead) => !filters.campaign_id || lead.campaign_id === String(filters.campaign_id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export async function getIntegrationStatus() {
  const snap = await getDoc(statusRef);
  return snap.exists() ? snap.data() : null;
}

export function combineManualAndIntegratedLeads(manual = [], integrated = []) {
  const automaticCampaigns = new Set(integrated.map((lead) => String(lead.campaign_id || "")).filter(Boolean));
  const manualFallback = manual.filter((lead) => {
    const campaignId = String(lead.campaign_id || "");
    return !campaignId || !automaticCampaigns.has(campaignId);
  });
  return [
    ...integrated.map((lead) => ({ ...lead, id: `integrated:${lead.id}`, readOnly: true })),
    ...manualFallback.map((lead) => ({ ...lead, source: lead.source || "manual_marketing", sourceLabel: lead.sourceLabel || "Registro manual" })),
  ].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

export function combineManualAndIntegratedReality(manual = [], integrated = []) {
  const automaticCampaigns = new Set(integrated.map((lead) => String(lead.campaign_id || "")).filter(Boolean));
  const manualFallback = manual.filter((row) => {
    const campaignId = String(row.sourceCampaignId || row.campaign_id || "");
    return !campaignId || !automaticCampaigns.has(campaignId);
  });
  const automaticReality = integrated
    .filter((lead) => lead.campaign_id)
    .map((lead) => leadToReality(lead));
  return [...automaticReality, ...manualFallback];
}

async function connectProject(name, config, { interactive = true } = {}) {
  const app = getApps().find((item) => item.name === name) || initializeApp(config, name);
  const auth = getAuth(app);
  if (!auth.currentUser) {
    if (!interactive) {
      const error = new Error("Inicia una sincronización manual una vez para autorizar la Base y RIP en este navegador.");
      error.code = "integration/login-required";
      throw error;
    }
    const provider = new GoogleAuthProvider();
    const hint = authUserPayload()?.email;
    if (hint) provider.setCustomParameters({ login_hint: hint });
    await signInWithPopup(auth, provider);
  }
  return { app, auth, db: getFirestore(app) };
}

async function loadBaseRows(baseDb) {
  const sheets = await getDocs(collection(baseDb, "sheetCache"));
  const packs = await Promise.all(sheets.docs.map(async (sheet) => {
    const rows = await getDocs(collection(baseDb, "sheetCache", sheet.id, "rows"));
    return rows.docs
      .map((item) => ({ id: item.id, sheetId: sheet.id, ...(item.data() || {}) }))
      .filter((row) => row.active !== false);
  }));
  return packs.flat();
}

async function loadCollection(sourceDb, name) {
  const snap = await getDocs(collection(sourceDb, name));
  return snap.docs.map((item) => ({ id: item.id, ...(item.data() || {}) }));
}

function buildPaymentIndex(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const studentId = canonicalStudentId(row.studentId || row.canonicalStudentId);
    const value = number(row.valorPago || row.pago);
    if (!studentId || value <= 0) return;
    const current = map.get(studentId) || { revenue: 0, payments: 0, lastPaymentDate: "" };
    current.revenue += value;
    current.payments += 1;
    const date = isoDate(row.fecha || row.fechaTs);
    if (date > current.lastPaymentDate) current.lastPaymentDate = date;
    map.set(studentId, current);
  });
  return map;
}

function buildComputedIndex(rows) {
  const map = new Map();
  rows.forEach((row) => {
    if (row.legacyAliasOf) return;
    const studentId = canonicalStudentId(row.studentId || row.canonicalStudentId || row.id);
    if (studentId) map.set(studentId, row);
  });
  return map;
}

function buildIntegratedLead(row, paymentByStudent, computedByStudent) {
  const attribution = object(row.marketingAttribution);
  const originType = String(attribution.originType || "");
  if (!originType && !attribution.campaignId) return null;

  const data = object(row.data);
  const crm = object(row.crm);
  const enrollment = object(row.enrollment);
  const studentId = canonicalStudentId(enrollment.studentId);
  const payment = studentId ? paymentByStudent.get(studentId) : null;
  const computed = studentId ? computedByStudent.get(studentId) : null;
  const paidValue = number(payment?.revenue);
  const campaignId = originType === "paid_ads" ? String(attribution.campaignId || "") : "";
  const date = isoDate(attribution.capturedAt)
    || isoDate(valueByAliases(data, ["Fecha y hora de contacto", "Fecha de contacto", "Fecha"]))
    || isoDate(row.updatedAt);
  const stage = String(crm.stage || "new");

  return {
    id: safeId(`${row.sheetId}__${row.id}`),
    source: "base_datos",
    sourceLabel: "Base de datos + RIP",
    sourceSheetId: String(row.sheetId || ""),
    sourceRowId: String(row.id || ""),
    readOnly: true,
    date,
    originType,
    campaign_id: campaignId,
    campaignName: String(attribution.campaignName || ""),
    platform: String(attribution.platform || "").toLowerCase(),
    name: String(valueByAliases(data, ["Nombre", "Nombre de Estudiante", "Acudiente/Estudiante"]) || enrollment.studentName || "").trim(),
    contact: String(valueByAliases(data, ["Celular/Teléfono", "Celular", "Teléfono", "Correo Electrónico", "Correo"]) || "").trim(),
    service: String(valueByAliases(data, ["Arte I", "Curso/Plan", "Servicio", "Programa"]) || "").trim(),
    offerType: String(valueByAliases(data, ["Curso/Plan", "Modalidad", "Tipo de oferta"]) || "").trim(),
    profile: String(valueByAliases(data, ["Edad", "Grupo", "Perfil"]) || "").trim(),
    status: leadStatus(stage, studentId, paidValue),
    crmStage: stage,
    responsible: String(crm.lastAdvisorEmail || crm.assignedAdvisorEmail || attribution.updatedBy || ""),
    nextAction: String(crm.nextActionType || ""),
    nextContactDate: isoDate(crm.nextContactAt),
    studentId,
    enrollmentStatus: String(enrollment.status || ""),
    activeStatus: String(computed?.clasificacionFinal || enrollment.status || ""),
    paidValue,
    paymentCount: number(payment?.payments),
    lastPaymentDate: String(payment?.lastPaymentDate || ""),
    attributionCapturedAt: millis(attribution.capturedAt),
    attributionUpdatedAt: millis(attribution.updatedAt),
    countsForAttribution: true,
    duplicateOf: "",
  };
}

function markAttributionOwners(leads) {
  const byStudent = new Map();
  leads.forEach((lead) => {
    if (!lead.studentId) return;
    const current = byStudent.get(lead.studentId);
    if (!current || attributionOrder(lead) < attributionOrder(current)) byStudent.set(lead.studentId, lead);
  });
  leads.forEach((lead) => {
    if (!lead.studentId) return;
    const owner = byStudent.get(lead.studentId);
    lead.countsForAttribution = owner?.id === lead.id;
    lead.duplicateOf = lead.countsForAttribution ? "" : String(owner?.id || "");
    if (!lead.countsForAttribution) {
      lead.paidValue = 0;
      lead.paymentCount = 0;
      lead.lastPaymentDate = "";
    }
  });
}

function attributionOrder(lead) {
  return `${String(lead.attributionCapturedAt || 0).padStart(16, "0")}|${lead.date}|${lead.id}`;
}

async function commitOperations(operations) {
  for (let start = 0; start < operations.length; start += 400) {
    const batch = writeBatch(db);
    operations.slice(start, start + 400).forEach(({ ref, data }) => batch.set(ref, data, { merge: true }));
    await batch.commit();
  }
}

async function writeStatus(summary) {
  const batch = writeBatch(db);
  batch.set(statusRef, summary, { merge: true });
  await batch.commit();
}

function leadStatus(stage, studentId, paidValue) {
  if (paidValue > 0) return "Pagó";
  if (studentId || stage === "enrolled") return "Matrícula";
  if (stage === "trial_done") return "Asistió a prueba";
  if (stage === "trial_scheduled") return "Clase de prueba agendada";
  if (["interested", "payment_pending"].includes(stage)) return "Calificado";
  if (stage === "contacted" || stage === "reactivation") return "Contactado";
  if (["not_interested", "invalid", "archived"].includes(stage)) return "Perdido";
  return "Lead nuevo";
}

function leadToReality(lead) {
  const stage = leadStageIndex(lead.status);
  return {
    id: `integrated:${lead.id}`,
    date: lead.date || "",
    sourceCampaignId: lead.campaign_id || "",
    campaign_id: lead.campaign_id || "",
    newContacts: 1,
    qualifiedLeads: stage >= 3 ? 1 : 0,
    trialClasses: stage >= 4 ? 1 : 0,
    enrollments: stage >= 6 ? 1 : 0,
    revenue: number(lead.paidValue),
    serviceSold: lead.service || "",
    source: "integrated_base_rip",
  };
}

function leadStageIndex(status) {
  const stages = ["Lead nuevo", "Contactado", "Respondió", "Calificado", "Clase de prueba agendada", "Asistió a prueba", "Matrícula", "Pagó"];
  if (status === "Perdido") return 0;
  const index = stages.indexOf(String(status || ""));
  return index < 0 ? 0 : index;
}

function valueByAliases(data, aliases) {
  const wanted = aliases.map(normalizeText);
  for (const [key, value] of Object.entries(data || {})) {
    if (wanted.includes(normalizeText(key)) && value != null && String(value).trim()) return value;
  }
  return "";
}

function canonicalStudentId(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_-]{16,}$/.test(text) ? text : "";
}

function isoDate(value) {
  if (!value) return "";
  if (typeof value?.toDate === "function") return isoDate(value.toDate());
  if (value instanceof Date) return localIso(value);
  if (typeof value === "number") return localIso(new Date(value));
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const latam = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (latam) return `${latam[3]}-${latam[2].padStart(2, "0")}-${latam[1].padStart(2, "0")}`;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : localIso(parsed);
}

function localIso(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function millis(value) {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isActiveLabel(value) {
  const label = normalizeText(value);
  return label.includes("activo") && !label.includes("inactivo");
}

function inRange(date, filters) {
  if (filters.from && String(date || "") < String(filters.from)) return false;
  if (filters.to && String(date || "") > String(filters.to)) return false;
  return true;
}

function safeId(value) {
  return String(value || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 240);
}

function object(value) {
  return value && typeof value === "object" ? value : {};
}

function number(value) {
  const n = Number(String(value ?? 0).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
