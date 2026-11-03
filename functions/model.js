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

/**
 * Un contacto del CRM, con la misma forma que los de la Base de datos.
 *
 * Solo cuentan los que llegaron por una campaña pagada (con `campaignId`):
 * los orgánicos y «sin identificar» también vienen, pero no se le cargan a
 * ninguna campaña. Los pagos salen del RIP por `studentId`, igual que antes.
 */
function buildCrmLead(row, paymentByStudent, computedByStudent, campaigns = []) {
  if (!row?.campaignId) return null;
  const studentId = (row.studentIds || []).map(canonicalStudentId).find(Boolean) || "";
  const payment = studentId ? paymentByStudent.get(studentId) : null;
  const computed = studentId ? computedByStudent.get(studentId) : null;
  const paidValue = number(payment?.revenue);
  const campaign = campaigns.find((c) => String(c.campaign_id || c.id) === String(row.campaignId));
  const stage = row.desenlace === "matriculado" ? "enrolled"
    : ["sin_opcion", "no_es_cliente"].includes(row.desenlace) ? "not_interested"
      : "new";

  return {
    id: safeId(`crm__${row.id}`),
    source: "crm",
    sourceLabel: "CRM + RIP",
    sourceSheetId: "",
    sourceRowId: String(row.id || ""),
    readOnly: true,
    date: String(row.fecha || ""),
    originType: "paid_ads",
    campaign_id: String(row.campaignId),
    campaignName: String(row.campana || campaign?.nombre || ""),
    platform: String(row.plataforma || campaign?.platform || "").toLowerCase(),
    attributionMethod: String(row.metodo || ""),
    name: String(row.nombre || ""),
    contact: String(row.contacto || ""),
    service: String(row.servicio || campaign?.servicio || ""),
    offerType: String(campaign?.tipo_oferta || ""),
    profile: "",
    status: leadStatus(stage, studentId, paidValue),
    crmStage: stage,
    responsible: "",
    nextAction: "",
    nextContactDate: "",
    studentId,
    enrollmentStatus: "",
    activeStatus: String(computed?.clasificacionFinal || ""),
    paidValue,
    paymentCount: number(payment?.payments),
    lastPaymentDate: String(payment?.lastPaymentDate || ""),
    attributionCapturedAt: Date.parse(`${row.fecha}T00:00:00-05:00`) || 0,
    attributionUpdatedAt: 0,
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
  const bogota = new Date(date.getTime() - 5 * 3600000);
  const y = bogota.getUTCFullYear();
  const m = String(bogota.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bogota.getUTCDate()).padStart(2, "0");
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

export { buildPaymentIndex, buildComputedIndex, buildIntegratedLead, buildCrmLead, markAttributionOwners, isActiveLabel, number, leadToReality, inRange };
