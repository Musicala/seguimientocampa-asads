import {
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

// Realidad comercial interna de Musicala: contactos, leads, pruebas, matriculas, ingreso real.
const realityRef = collection(db, "musicalaReality");

export function normalizeReality(payload = {}) {
  const campaignId = String(
    payload.sourceCampaignId || payload.campaign_id || payload.campaignId || ""
  );
  return {
    date: payload.date || payload.fecha || "",
    sourceCampaignId: campaignId,
    campaign_id: campaignId,
    newContacts: num(payload.newContacts ?? payload.contactos_nuevos),
    qualifiedLeads: num(payload.qualifiedLeads ?? payload.leads_calificados),
    trialClasses: num(payload.trialClasses ?? payload.clases_prueba),
    enrollments: num(payload.enrollments ?? payload.matriculas),
    serviceSold: String(payload.serviceSold ?? payload.servicio_vendido ?? "").trim(),
    revenue: num(payload.revenue ?? payload.ingreso_real),
    notes: String(payload.notes ?? payload.notas ?? "").trim(),
  };
}

export async function addMusicalaReality(payload) {
  const created = await addDoc(realityRef, {
    ...normalizeReality(payload),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: authUserPayload(),
  });
  return created.id;
}

export async function listMusicalaReality(filters = {}) {
  const selected = String(filters.campaign_id || filters.campaignId || "");
  const constraints = [];
  if (filters.from) constraints.push(where("date", ">=", filters.from));
  if (filters.to) constraints.push(where("date", "<=", filters.to));
  constraints.push(orderBy("date", "desc"));

  let docs = [];
  try {
    const snap = await getDocs(query(realityRef, ...constraints));
    docs = snap.docs;
  } catch (_) {
    // Si falta indice o no hay fechas, traer todo y filtrar en memoria.
    const snap = await getDocs(realityRef);
    docs = snap.docs;
  }

  return docs
    .map((item) => ({ id: item.id, ...normalizeReality(item.data()) }))
    .filter((row) => {
      if (filters.from && String(row.date) < String(filters.from)) return false;
      if (filters.to && String(row.date) > String(filters.to)) return false;
      if (selected && row.sourceCampaignId !== selected && row.campaign_id !== selected) return false;
      return true;
    })
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

function num(value) {
  if (value === "" || value == null) return 0;
  const n = Number(String(value).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
