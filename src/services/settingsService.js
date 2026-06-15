import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { authUserPayload } from "./authService.js";

// Documento unico de configuracion global de marketing.
const SETTINGS_PATH = ["settings", "marketing"];

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
