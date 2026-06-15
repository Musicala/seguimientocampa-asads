import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

// Historial de decisiones por campana: campaigns/{campaignId}/decisionLog/{logId}
function logRef(campaignId) {
  return collection(db, "campaigns", String(campaignId), "decisionLog");
}

export async function addDecisionLog(campaignId, payload = {}) {
  const id = String(campaignId || "");
  if (!id) throw new Error("Falta campaignId para registrar la decision.");
  const created = await addDoc(logRef(id), {
    date: payload.date || localIsoDate(new Date()),
    decisionType: payload.decisionType || payload.type || "",
    label: payload.label || "",
    reason: payload.reason || "",
    nextAction: payload.nextAction || payload.action || "",
    metricsSnapshot: payload.metricsSnapshot || null,
    createdAt: serverTimestamp(),
    createdBy: authUserPayload(),
  });
  return created.id;
}

export async function listDecisionLog(campaignId) {
  const id = String(campaignId || "");
  if (!id) return [];
  const snap = await getDocs(query(logRef(id), orderBy("date", "desc")));
  return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

// Snapshot compacto de las metricas clave de una fila de dashboard.
export function metricsSnapshotFromRow(row = {}) {
  const keys = [
    "spend", "leads", "cpl",
    "real_new_contacts", "real_qualified_leads", "real_trial_classes",
    "real_enrollments", "real_revenue", "cost_per_enrollment", "real_roas",
  ];
  const snap = {};
  keys.forEach((k) => { snap[k] = Number(row[k] || 0); });
  return snap;
}

function localIsoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
