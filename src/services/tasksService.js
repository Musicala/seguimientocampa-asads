import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

// Tareas de marketing: marketingTasks/{taskId}
const tasksRef = collection(db, "marketingTasks");

const PRIORITIES = ["high", "medium", "low"];
const STATUSES = ["pendiente", "en_proceso", "hecha", "descartada"];

export function normalizeTask(payload = {}) {
  return {
    title: String(payload.title || "").trim(),
    campaignId: String(payload.campaignId || payload.campaign_id || ""),
    campaignName: String(payload.campaignName || "").trim(),
    priority: PRIORITIES.includes(payload.priority) ? payload.priority : "medium",
    status: STATUSES.includes(payload.status) ? payload.status : "pendiente",
    reason: String(payload.reason || "").trim(),
    suggestedAction: String(payload.suggestedAction || payload.action || "").trim(),
    dueDate: payload.dueDate || "",
  };
}

export async function addMarketingTask(payload) {
  const task = normalizeTask(payload);
  if (!task.title) throw new Error("La tarea necesita un titulo.");
  const created = await addDoc(tasksRef, {
    ...task,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: authUserPayload(),
  });
  return created.id;
}

export async function updateMarketingTask(id, patch = {}) {
  const ref = doc(db, "marketingTasks", String(id));
  const clean = {};
  if (patch.status && STATUSES.includes(patch.status)) clean.status = patch.status;
  if (patch.priority && PRIORITIES.includes(patch.priority)) clean.priority = patch.priority;
  if (patch.title != null) clean.title = String(patch.title).trim();
  if (patch.dueDate != null) clean.dueDate = patch.dueDate;
  if (patch.reason != null) clean.reason = String(patch.reason).trim();
  if (patch.suggestedAction != null) clean.suggestedAction = String(patch.suggestedAction).trim();
  await updateDoc(ref, { ...clean, updatedAt: serverTimestamp() });
  return { ok: true };
}

export async function listMarketingTasks(filters = {}) {
  let docs = [];
  try {
    const snap = await getDocs(query(tasksRef, orderBy("createdAt", "desc")));
    docs = snap.docs;
  } catch (_) {
    const snap = await getDocs(tasksRef);
    docs = snap.docs;
  }
  const status = String(filters.status || "");
  return docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((t) => !status || t.status === status);
}

// Convierte una accion recomendada (insights.todayActions) en payload de tarea.
export function taskFromAction(action = {}) {
  return normalizeTask({
    title: action.title || "Accion de marketing",
    campaignId: action.campaignId,
    campaignName: action.campaignName,
    priority: action.priority,
    reason: action.reason,
    suggestedAction: action.action,
  });
}
