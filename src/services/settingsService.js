import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

// Documento unico de configuracion global de marketing.
const SETTINGS_PATH = ["settings", "marketing"];

// Documento con las listas de opciones para los desplegables de campanas.
const OPTIONS_PATH = ["settings", "options"];

// Opciones iniciales sugeridas para Musicala. Se editan desde la pestana Configuracion.
export const DEFAULT_OPTIONS = {
  canales: ["Meta", "Google Ads", "TikTok", "Otro"],
  plataformas: ["Business Meta", "Google Search", "Google Display", "Google Performance Max", "TikTok Ads", "Otro"],
  objetivos: ["Mensajes", "Leads", "Conversiones", "Trafico", "Reconocimiento", "Interaccion", "Reproducciones de video"],
  servicios: ["Talleres vacacionales", "Clases regulares", "Cursos", "Clases particulares", "Otro"],
  modalidades: ["Sede", "Hogar", "Virtual", "Hibrida"],
  modelosCobro: ["Meta cobro total", "Meta diario", "Google Ads diario", "Pago unico", "Otro"],
};

function cleanOptionList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const text = String(item || "").trim();
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

export async function getCampaignOptions() {
  try {
    const snap = await getDoc(doc(db, ...OPTIONS_PATH));
    if (snap.exists()) {
      const data = snap.data() || {};
      const merged = { ...DEFAULT_OPTIONS };
      for (const key of Object.keys(DEFAULT_OPTIONS)) {
        const stored = cleanOptionList(data[key]);
        if (stored.length) merged[key] = stored;
      }
      return merged;
    }
  } catch (_) {
    // Si Firestore falla, devolvemos los valores por defecto.
  }
  return { ...DEFAULT_OPTIONS };
}

export async function saveCampaignOptions(payload = {}) {
  const clean = {};
  for (const key of Object.keys(DEFAULT_OPTIONS)) {
    clean[key] = cleanOptionList(payload[key]);
  }
  await setDoc(
    doc(db, ...OPTIONS_PATH),
    { ...clean, updatedAt: serverTimestamp(), updatedBy: authUserPayload() },
    { merge: true }
  );
  return { ok: true, options: clean };
}

// Targets iniciales sugeridos para Musicala. Se pueden editar desde Firestore.
export const DEFAULT_SETTINGS = {
  globalMonthlyBudget: 0,
  defaultCplTarget: 4500,
  defaultCostPerTrialTarget: 18000,
  defaultCostPerEnrollmentTarget: 70000,
  minimumLeadsToDecide: 15,
  minimumSpendToPause: 30000,
};

// Clave legacy en localStorage usada solo como fallback de migracion.
const LEGACY_BUDGET_KEY = "musicalaGlobalBudget";

export async function getMarketingSettings() {
  try {
    const snap = await getDoc(doc(db, ...SETTINGS_PATH));
    if (snap.exists()) {
      return { ...DEFAULT_SETTINGS, ...snap.data() };
    }
  } catch (_) {
    // Si Firestore falla, devolvemos defaults para no romper el dashboard.
  }
  // Fallback de migracion: presupuesto que quedo en el navegador.
  const legacy = Number(localStorage.getItem(LEGACY_BUDGET_KEY) || 0) || 0;
  return { ...DEFAULT_SETTINGS, globalMonthlyBudget: legacy };
}

export async function saveMarketingSettings(payload = {}) {
  const clean = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (payload[key] != null && payload[key] !== "") {
      clean[key] = Number(payload[key]) || 0;
    }
  }
  await setDoc(
    doc(db, ...SETTINGS_PATH),
    { ...clean, updatedAt: serverTimestamp(), updatedBy: authUserPayload() },
    { merge: true }
  );
  return { ok: true };
}

export async function getGlobalBudget() {
  const settings = await getMarketingSettings();
  return Number(settings.globalMonthlyBudget || 0);
}

export async function setGlobalBudget(amount) {
  const value = Number(amount || 0);
  await saveMarketingSettings({ globalMonthlyBudget: value });
  // Mantener fallback local solo para migracion / offline.
  try {
    localStorage.setItem(LEGACY_BUDGET_KEY, String(value));
  } catch (_) {}
  return value;
}
