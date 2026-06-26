import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { db } from "../firebase.js";

export async function addMetric(payload) {
  const campaignId = String(payload.campaign_id || payload.campaignId || "");
  if (!campaignId) throw new Error("Falta campaignId");
  const ref = collection(db, "campaigns", campaignId, "metrics");
  const created = await addDoc(ref, {
    ...normalizeMetric(payload),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

export async function saveMetric(payload, metricId) {
  const campaignId = String(payload.campaign_id || payload.campaignId || "");
  if (!campaignId) throw new Error("Falta campaignId");
  const id = String(metricId || payload.metric_id || payload.id || payload.date || crypto.randomUUID());
  await setDoc(doc(db, "campaigns", campaignId, "metrics", id), {
    ...normalizeMetric(payload),
    updatedAt: serverTimestamp(),
    createdAt: payload.createdAt || serverTimestamp(),
  }, { merge: true });
  return id;
}

export async function archiveMetric(campaignId, metricId) {
  if (!campaignId || !metricId) throw new Error("Falta identificar la metrica");
  await setDoc(doc(db, "campaigns", String(campaignId), "metrics", String(metricId)), {
    archived: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function listMetrics(campaigns = [], filters = {}) {
  const all = [];
  const selected = String(filters.campaign_id || filters.campaignId || "");
  const source = selected ? campaigns.filter((c) => c.campaign_id === selected || c.id === selected) : campaigns;

  for (const campaign of source) {
    const campaignId = campaign.campaign_id || campaign.id;
    if (!campaignId) continue;
    const constraints = [orderBy("date", "desc")];
    if (filters.from) constraints.unshift(where("date", ">=", filters.from));
    if (filters.to) constraints.unshift(where("date", "<=", filters.to));
    const snap = await getDocs(query(collection(db, "campaigns", campaignId, "metrics"), ...constraints));
    snap.docs.forEach((item) => {
      if (item.data().archived === true) return;
      all.push({
        id: item.id,
        metric_id: item.id,
        campaign_id: campaignId,
        campaign_name: campaign.nombre || campaign.name || "",
        nombre: campaign.nombre || campaign.name || "",
        canal: campaign.canal || "",
        plataforma: campaign.plataforma || "",
        platform_type: campaign.platform_type || campaign.platform || "",
        ...item.data(),
      });
    });
  }

  return all.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

// La realidad comercial vive ahora en realityService.js (musicalaReality).

export function normalizeMetric(payload = {}) {
  return {
    date: payload.date || "",
    spend: Number(payload.spend || 0),
    impressions: Number(payload.impressions || 0),
    reach: Number(payload.reach || payload.viewers || 0),
    clicks: Number(payload.clicks || payload.link_clicks || 0),
    leads: Number(payload.leads || payload.raw_leads || payload.conversations_started || 0),
    messages: Number(payload.messages || payload.conversations_started || 0),
    conversions: Number(payload.conversions || 0),
    sales: Number(payload.sales || 0),
    revenue: Number(payload.revenue || 0),
    notes: payload.notes || payload.quick_observation || "",
    ...payload,
  };
}
