import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { GoogleAuth } from "google-auth-library";
import { randomUUID } from "node:crypto";
import attribution from "./attribution.cjs";
import { campaignForCrm } from "./campaigns.js";
import { buildPaymentIndex, buildComputedIndex, buildIntegratedLead, buildCrmLead, markAttributionOwners, isActiveLabel, number } from "./model.js";

const db = getFirestore(initializeApp());
const source = (projectId) => getFirestore(initializeApp({ projectId }, projectId));
const base = source("db-musicala");
const rip = source("rip-musicala");
const crm = source("musicala-crm");
const statusRef = db.doc("integrationSyncs/baseRip");
const leaseRef = db.doc("integrationLocks/automatic");
const START = "2026-10-10";
const CATALOG_URL = "https://us-central1-musicala-crm.cloudfunctions.net/syncAdsCatalog";

async function rows(query) {
  const snap = await query.get();
  return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }));
}
async function readSource(name, work) {
  try { return await work(); }
  catch (error) { error.sourceName = name; throw error; }
}
async function readBase() {
  const sheets = await base.collection("sheetCache").get();
  const result = [];
  for (const sheet of sheets.docs) {
    const data = await rows(sheet.ref.collection("rows").select("active", "marketingAttribution", "data", "crm", "enrollment", "updatedAt"));
    result.push(...data.filter((row) => row.active !== false).map((row) => ({ ...row, sheetId: sheet.id })));
  }
  return result;
}
async function readCrm(campaigns) {
  const [conversations, students] = await Promise.all([
    rows(crm.collection("conversations").select("createdAt", "lastMessageAt", "atribucionManual", "adOrigen", "refCodigo", "leadContext", "displayName", "desenlace")),
    rows(crm.collection("estudiantesConocidos").select("estudiantes")),
  ]);
  const phone = (value) => String(value).replace(/\D/g, "").slice(-10);
  const byPhone = new Map(students.map((row) => [phone(row.id), (row.estudiantes || []).map((item) => item.studentId).filter(Boolean)]));
  const ms = (value) => value?.toMillis?.() || (typeof value === "number" ? value : 0);
  return conversations.flatMap((row) => {
    const time = ms(row.createdAt) || ms(row.lastMessageAt);
    const date = time ? new Date(time - 5 * 3600000).toISOString().slice(0, 10) : "";
    if (date < START) return [];
    const match = attribution.campanaDe(row, campaigns);
    return [{ id: row.id, fecha: date, ...match, campana: match.nombre,
      nombre: String(row.leadContext?.contactName || row.displayName || "").slice(0, 80),
      contacto: row.id, servicio: String(row.leadContext?.interestedProgram || "").slice(0, 60),
      desenlace: String(row.desenlace || ""), studentIds: byPhone.get(phone(row.id)) || [] }];
  });
}
async function syncCatalog(campaigns) {
  const client = await new GoogleAuth().getIdTokenClient(CATALOG_URL);
  await client.request({ url: CATALOG_URL, method: "POST", data: { campaigns }, timeout: 60000 });
}

export async function runSync() {
  const runId = randomUUID();
  const acquired = await db.runTransaction(async (tx) => {
    const lock = await tx.get(leaseRef);
    if ((lock.get("expiresAt") || 0) > Date.now()) return false;
    tx.set(leaseRef, { runId, expiresAt: Date.now() + 10 * 60 * 1000 });
    return true;
  });
  if (!acquired) return { skipped: true };
  try {
    const campaigns = (await rows(db.collection("campaigns"))).map((row) => ({ ...row, campaign_id: row.id }));
    const catalog = campaigns.map(campaignForCrm);
    await readSource("Catálogo de campañas", () => syncCatalog(catalog));
    const results = await Promise.allSettled([
      readSource("Base histórica", readBase),
      readSource("Pagos RIP", () => rows(rip.collection("registro").select("studentId", "canonicalStudentId", "valorPago", "pago", "fecha", "fechaTs"))),
      readSource("Estados RIP", () => rows(rip.collection("studentComputed").select("studentId", "canonicalStudentId", "legacyAliasOf", "clasificacionFinal"))),
      readSource("CRM", () => readCrm(catalog)),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
    const [baseRows, payments, computed, crmRows] = results.map((result) => result.value);
    const paymentIndex = buildPaymentIndex(payments);
    const computedIndex = buildComputedIndex(computed);
    const candidates = [
      ...baseRows.map((row) => buildIntegratedLead(row, paymentIndex, computedIndex)).filter((lead) => lead?.date && lead.date < START),
      ...crmRows.map((row) => buildCrmLead(row, paymentIndex, computedIndex, campaigns)).filter(Boolean),
    ];
    markAttributionOwners(candidates);
    const attributed = candidates.filter((lead) => lead.countsForAttribution);
    const summary = {
      baseRowsRead: baseRows.length, attributedRows: candidates.length, uniqueContacts: attributed.length,
      enrolledContacts: attributed.filter((lead) => lead.studentId || lead.crmStage === "enrolled").length,
      activeContacts: attributed.filter((lead) => isActiveLabel(lead.activeStatus)).length,
      contactsWithRevenue: attributed.filter((lead) => lead.paidValue > 0).length,
      totalAttributedRevenue: attributed.reduce((sum, lead) => sum + number(lead.paidValue), 0),
      unmatchedRevenueContacts: attributed.filter((lead) => !lead.studentId).length,
      paymentsRead: payments.length, computedStudentsRead: computed.length,
      sourceProjects: ["db-musicala", "rip-musicala", "musicala-crm"],
      crmContacts: crmRows.length, crmContactsWithCampaign: crmRows.filter((row) => row.campaignId).length,
      crmToReview: crmRows.filter((row) => row.revisar).length,
    };
    const snapshot = db.collection("integrationSnapshots").doc(runId);
    // Publish the pointer only after every immutable chunk has been stored.
    await snapshot.set({ createdAt: FieldValue.serverTimestamp(), published: false });
    let chunkCount = 0;
    for (let i = 0; i < candidates.length; i += 100) {
      await snapshot.collection("chunks").doc(String(chunkCount++)).set({ rows: candidates.slice(i, i + 100) });
    }
    await db.runTransaction(async (tx) => {
      const lock = await tx.get(leaseRef);
      if (lock.get("runId") !== runId) throw new Error("Synchronization lease expired");
      tx.set(snapshot, { createdAt: FieldValue.serverTimestamp(), chunkCount, published: true });
      tx.set(statusRef, { ...summary, snapshotId: runId, chunkCount, syncedAt: FieldValue.serverTimestamp(),
        lastAttemptAt: FieldValue.serverTimestamp(), state: "ready", failedSource: null, automatic: true });
    });
    // Keep recent generations so an in-flight reader can finish its snapshot.
    try {
    const old = await db.collection("integrationSnapshots").where("createdAt", "<", new Date(Date.now() - 60 * 60 * 1000)).get();
    for (const item of old.docs) await db.recursiveDelete(item.ref);
    } catch (error) { console.warn("Snapshot cleanup deferred", { code: error.code }); }
    console.info("Ads snapshot published", { snapshotId: runId, uniqueContacts: summary.uniqueContacts });
    return summary;
  } catch (error) {
    await statusRef.set({ lastAttemptAt: FieldValue.serverTimestamp(), state: "error", failedSource: error.sourceName || "Actualización del tablero" }, { merge: true });
    console.error("Ads synchronization failed", { source: error.sourceName, code: error.code, message: error.message });
    throw error;
  } finally {
    await db.runTransaction(async (tx) => {
      const lock = await tx.get(leaseRef);
      if (lock.get("runId") === runId) tx.delete(leaseRef);
    });
  }
}

export const refreshAdsData = onSchedule({
  // Cada hora: cada corrida lee todas las conversaciones y el directorio del
  // CRM (~4.900 lecturas); cada 5 min eran 1,4 millones de lecturas al día.
  schedule: "every 60 minutes", timeZone: "America/Bogota", region: "us-central1",
  timeoutSeconds: 540, memory: "512MiB", maxInstances: 1, concurrency: 1,
  retryCount: 0, serviceAccount: "ads-sync@marketing-musicala.iam.gserviceaccount.com",
}, runSync);
