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

// Calendario de publicaciones / fechas importantes: contentCalendar/{eventId}
const calendarRef = collection(db, "contentCalendar");

const EVENT_TYPES = ["temporada", "publicacion", "fecha_clave"];
const EVENT_STATUSES = ["idea", "en_diseno", "programada", "publicada"];

export function normalizeCalendarEvent(payload = {}) {
  return {
    title: String(payload.title || "").trim(),
    type: EVENT_TYPES.includes(payload.type) ? payload.type : "fecha_clave",
    startDate: String(payload.startDate || payload.date || "").trim(),
    endDate: String(payload.endDate || "").trim(),
    program: String(payload.program || "").trim(),
    channel: String(payload.channel || "").trim(),
    status: EVENT_STATUSES.includes(payload.status) ? payload.status : "idea",
    campaignId: String(payload.campaignId || ""),
    notes: String(payload.notes || "").trim(),
    archived: payload.archived === true,
  };
}

export async function addCalendarEvent(payload) {
  const event = normalizeCalendarEvent(payload);
  if (!event.title) throw new Error("El evento necesita un titulo.");
  if (!event.startDate) throw new Error("El evento necesita una fecha de inicio.");
  const created = await addDoc(calendarRef, {
    ...event,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: authUserPayload(),
  });
  return created.id;
}

export async function updateCalendarEvent(id, patch = {}) {
  const ref = doc(db, "contentCalendar", String(id));
  const clean = {};
  if (patch.title != null) clean.title = String(patch.title).trim();
  if (patch.type && EVENT_TYPES.includes(patch.type)) clean.type = patch.type;
  if (patch.startDate != null) clean.startDate = String(patch.startDate).trim();
  if (patch.endDate != null) clean.endDate = String(patch.endDate).trim();
  if (patch.program != null) clean.program = String(patch.program).trim();
  if (patch.channel != null) clean.channel = String(patch.channel).trim();
  if (patch.status && EVENT_STATUSES.includes(patch.status)) clean.status = patch.status;
  if (patch.campaignId != null) clean.campaignId = String(patch.campaignId);
  if (patch.notes != null) clean.notes = String(patch.notes).trim();
  if (patch.archived != null) clean.archived = patch.archived === true;
  await updateDoc(ref, { ...clean, updatedAt: serverTimestamp() });
  return { ok: true };
}

export async function archiveCalendarEvent(id) {
  return updateCalendarEvent(id, { archived: true });
}

export async function listCalendarEvents(filters = {}) {
  let docs = [];
  try {
    const snap = await getDocs(query(calendarRef, orderBy("startDate", "asc")));
    docs = snap.docs;
  } catch (_) {
    const snap = await getDocs(calendarRef);
    docs = snap.docs;
  }
  const includeArchived = filters.includeArchived === true;
  return docs
    .map((item) => ({ id: item.id, ...item.data() }))
    .filter((e) => includeArchived || e.archived !== true)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
}

// Fecha del Domingo de Pascua (algoritmo de computus) para ubicar Semana Santa.
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function iso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Temporadas fuertes de Musicala para un año dado. Fechas aproximadas y editables desde la app.
export function defaultSeasonEvents(year) {
  const easter = easterSunday(year);
  const holyWeekStart = new Date(easter);
  holyWeekStart.setDate(easter.getDate() - 7); // Domingo de Ramos
  const holyWeekEnd = new Date(easter);
  holyWeekEnd.setDate(easter.getDate() - 1); // Sabado Santo

  // Semana de receso: primera semana completa (lunes a domingo) de octubre.
  const octFirst = new Date(year, 9, 1);
  const offsetToMonday = (8 - octFirst.getDay()) % 7;
  const recessStart = new Date(year, 9, 1 + offsetToMonday);
  const recessEnd = new Date(recessStart);
  recessEnd.setDate(recessStart.getDate() + 6);

  return [
    {
      title: `Inicio de año ${year}`,
      type: "temporada",
      startDate: `${year}-01-07`,
      endDate: `${year}-01-31`,
      program: "Clases regulares",
      notes: "Temporada de matriculas de inicio de año.",
    },
    {
      title: `Semana Santa ${year}`,
      type: "temporada",
      startDate: iso(holyWeekStart),
      endDate: iso(holyWeekEnd),
      program: "Vacacionales",
      notes: "Receso escolar de Semana Santa.",
    },
    {
      title: `Preuniversitario - cierre primer semestre ${year}`,
      type: "temporada",
      startDate: `${year}-05-15`,
      endDate: `${year}-06-15`,
      program: "Preuniversitario",
      notes: "Cierre del primer semestre academico.",
    },
    {
      title: `Vacaciones mitad de año ${year}`,
      type: "temporada",
      startDate: `${year}-06-15`,
      endDate: `${year}-07-12`,
      program: "Vacacionales",
      notes: "Vacaciones escolares de mitad de año.",
    },
    {
      title: `Semana de receso octubre ${year}`,
      type: "temporada",
      startDate: iso(recessStart),
      endDate: iso(recessEnd),
      program: "Vacacionales",
      notes: "Semana de receso escolar de octubre.",
    },
    {
      title: `Preuniversitario - cierre segundo semestre ${year}`,
      type: "temporada",
      startDate: `${year}-10-15`,
      endDate: `${year}-11-15`,
      program: "Preuniversitario",
      notes: "Cierre del segundo semestre academico.",
    },
    {
      title: `Vacaciones fin de año ${year}`,
      type: "temporada",
      startDate: `${year}-11-20`,
      endDate: `${year}-12-31`,
      program: "Vacacionales",
      notes: "Temporada de vacaciones de fin de año.",
    },
  ];
}

// Crea las temporadas del año que no existan todavia (compara por titulo).
export async function seedDefaultSeasons(year) {
  const target = Number(year) || new Date().getFullYear();
  const existing = await listCalendarEvents({ includeArchived: true });
  const existingTitles = new Set(existing.map((e) => String(e.title || "").toLowerCase()));
  const created = [];
  for (const event of defaultSeasonEvents(target)) {
    if (existingTitles.has(event.title.toLowerCase())) continue;
    const id = await addCalendarEvent(event);
    created.push({ id, ...event });
  }
  return created;
}
