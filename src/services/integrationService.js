import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase.js";
import { leadToReality, inRange } from "../../functions/model.js";
const statusRef = doc(db, "integrationSyncs", "baseRip");

export async function getIntegrationStatus() {
  const snap = await getDoc(statusRef);
  return snap.exists() ? snap.data() : null;
}

export async function listIntegratedLeads(filters = {}) {
  const status = await getIntegrationStatus();
  let rows;
  if (status?.snapshotId) {
    const chunks = await getDocs(collection(db, "integrationSnapshots", status.snapshotId, "chunks"));
    if (chunks.size !== status.chunkCount) throw new Error("La actualización está incompleta. Intenta recargar la página.");
    rows = chunks.docs.flatMap((item) => item.data().rows || []);
  } else {
    const snap = await getDocs(collection(db, "integratedLeads"));
    rows = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
  }
  return rows.filter((lead) => lead.active !== false && lead.countsForAttribution !== false)
    .filter((lead) => inRange(lead.date, filters))
    .filter((lead) => !filters.campaign_id || lead.campaign_id === String(filters.campaign_id))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
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
