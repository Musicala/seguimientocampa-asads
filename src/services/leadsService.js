import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

// Seguimiento detallado de leads / contactos asociados a campanas.
const leadsRef = collection(db, "leads");

export function normalizeLead(payload = {}) {
  return {
    date: payload.date || payload.fecha || "",
    campaign_id: String(payload.campaign_id || payload.campaignId || payload.sourceCampaignId || ""),
    platform: String(payload.platform || payload.plataforma || "").trim(),
    name: String(payload.name || payload.nombre || "").trim(),
    contact: String(payload.contact || payload.telefono || payload.referencia || "").trim(),
    service: String(payload.service || payload.servicio || "").trim(),
    offerType: String(payload.offerType || payload.tipo_oferta || "").trim(),
    profile: String(payload.profile || payload.perfil || "").trim(),
    status: String(payload.status || payload.estado_comercial || "").trim(),
    lossReason: String(payload.lossReason || payload.motivo_perdida || "").trim(),
    responsible: String(payload.responsible || payload.responsable || "").trim(),
    nextAction: String(payload.nextAction || payload.proxima_accion || "").trim(),
    nextContactDate: payload.nextContactDate || payload.fecha_proximo_contacto || "",
    paidValue: num(payload.paidValue ?? payload.valor_pagado),
    notes: String(payload.notes || payload.notas || "").trim(),
  };
}

export async function addLead(payload) {
  const created = await addDoc(leadsRef, {
    ...normalizeLead(payload),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: authUserPayload(),
  });
  return created.id;
}

export async function updateLead(id, patch = {}) {
  if (!id) throw new Error("Falta el identificador del lead.");
  await updateDoc(doc(db, "leads", id), {
    ...normalizeLead(patch),
    updatedAt: serverTimestamp(),
    updatedBy: authUserPayload(),
  });
  return id;
}

export async function listLeads(filters = {}) {
  const constraints = [];
  if (filters.from) constraints.push(where("date", ">=", filters.from));
  if (filters.to) constraints.push(where("date", "<=", filters.to));
  constraints.push(orderBy("date", "desc"));

  let docs = [];
  try {
    const snap = await getDocs(query(leadsRef, ...constraints));
    docs = snap.docs;
  } catch (_) {
    // Si falta indice o fechas, traer todo y filtrar en memoria.
    const snap = await getDocs(leadsRef);
    docs = snap.docs;
  }

  const campaignId = String(filters.campaign_id || filters.campaignId || "");
  const platform = String(filters.platform || "").toLowerCase();
  const service = String(filters.service || "").toLowerCase();
  const offerType = String(filters.offerType || "").toLowerCase();
  const status = String(filters.status || "").toLowerCase();
  const responsible = String(filters.responsible || "").toLowerCase();

  return docs
    .map((item) => ({ id: item.id, ...normalizeLead(item.data()) }))
    .filter((row) => {
      if (filters.from && String(row.date) < String(filters.from)) return false;
      if (filters.to && String(row.date) > String(filters.to)) return false;
      if (campaignId && row.campaign_id !== campaignId) return false;
      if (platform && row.platform.toLowerCase() !== platform) return false;
      if (service && row.service.toLowerCase() !== service) return false;
      if (offerType && row.offerType.toLowerCase() !== offerType) return false;
      if (status && row.status.toLowerCase() !== status) return false;
      if (responsible && !row.responsible.toLowerCase().includes(responsible)) return false;
      return true;
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function num(value) {
  if (value === "" || value == null) return 0;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
