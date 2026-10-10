import { getApps, initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { doc, getFirestore, serverTimestamp, writeBatch } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { authUserPayload } from "./authService.js";

// Conexión con el CRM (musicala-crm).
//
// El CRM es quien sabe de qué campaña llegó cada contacto: lee el anuncio de
// Meta que trae el primer mensaje de WhatsApp, o el código «ref …» del mensaje
// pre-escrito (Google Ads, la página, QR). Para traducir eso a una campaña
// necesita el catálogo, y el catálogo vive aquí. Por eso:
//   - esta app le MANDA las campañas (ids de anuncio de Meta y código),
//   - y le PIDE los contactos por campaña para cruzarlos con el gasto.
const CRM_CONFIG = {
  apiKey: "AIzaSyCj78u6_-jdAwZj3aN3Sx6LcpitLiwnsy0",
  authDomain: "musicala-crm.firebaseapp.com",
  projectId: "musicala-crm",
  storageBucket: "musicala-crm.firebasestorage.app",
  messagingSenderId: "776078601391",
  appId: "1:776078601391:web:522ca90254cc25ecb0b85a",
};

// Desde cuándo el CRM marca la campaña solo. Antes de esta fecha los
// resultados siguen saliendo de la Base de datos (lo que marcaba la asistente).
export const CRM_ATTRIBUTION_START = "2026-10-10";

export async function connectCrm({ interactive = true } = {}) {
  const app = getApps().find((item) => item.name === "musicala-crm") || initializeApp(CRM_CONFIG, "musicala-crm");
  const auth = getAuth(app);
  if (!auth.currentUser) {
    await auth.authStateReady?.();
  }
  if (!auth.currentUser) {
    if (!interactive) {
      const error = new Error("Conecta el CRM una vez (botón Sincronizar) para autorizarlo en este navegador.");
      error.code = "integration/login-required";
      throw error;
    }
    const provider = new GoogleAuthProvider();
    const hint = authUserPayload()?.email;
    if (hint) provider.setCustomParameters({ login_hint: hint });
    await signInWithPopup(auth, provider);
  }
  return { app, auth, db: getFirestore(app), functions: getFunctions(app, "us-central1") };
}

/** Lo que el CRM necesita de una campaña para reconocer a sus contactos. */
export function campaignForCrm(campaign = {}) {
  const id = String(campaign.campaign_id || campaign.id || "");
  return {
    id,
    nombre: String(campaign.nombre || campaign.name || id),
    plataforma: String(campaign.platform || campaign.platform_type || "").toLowerCase(),
    activa: String(campaign.status || "").toLowerCase() === "activa",
    metaAdIds: parseAdIds(campaign.meta_ad_ids),
    codigo: normalizeRefCode(campaign.ref_code),
    desde: String(campaign.fecha_inicio || campaign.startDate || ""),
    hasta: String(campaign.fecha_fin || campaign.endDate || ""),
  };
}

/** Manda al CRM una o varias campañas (merge: el CRM no guarda nada más ahí). */
export async function syncCampaignsToCrm(campaigns = [], { interactive = true } = {}) {
  const list = campaigns.map(campaignForCrm).filter((c) => c.id);
  if (!list.length) return 0;
  const { db } = await connectCrm({ interactive });
  for (let start = 0; start < list.length; start += 400) {
    const batch = writeBatch(db);
    list.slice(start, start + 400).forEach((c) => batch.set(doc(db, "campanasAds", c.id), {
      ...c,
      actualizadoAt: serverTimestamp(),
      actualizadoPor: authUserPayload()?.email || null,
    }, { merge: true }));
    await batch.commit();
  }
  return list.length;
}

/** Los contactos por campaña según el CRM, para el rango pedido («AAAA-MM-DD»). */
export async function loadCrmAttribution({ desde = "", hasta = "", interactive = true } = {}) {
  const { functions } = await connectCrm({ interactive });
  const call = httpsCallable(functions, "getAtribucionCampanas");
  const res = await call({ desde, hasta });
  return res.data?.filas || [];
}

/** «123, 456\n789» → ["123", "456", "789"]. Solo dígitos: son ids de anuncio de Meta. */
export function parseAdIds(value) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  return [...new Set(raw.split(/[\s,;]+/).map((v) => v.replace(/\D/g, "")).filter((v) => v.length >= 6))];
}

/** El código que va en el mensaje pre-escrito: mayúsculas, letras, números y guiones. */
export function normalizeRefCode(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
}

/** Un código sugerido a partir del nombre: «Piano Google Octubre» → «PIANO-GOOGLE-OCT». */
export function suggestRefCode(name = "") {
  const words = String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  return normalizeRefCode(words.slice(0, 3).map((w) => w.slice(0, 6)).join("-"));
}

/** El enlace de WhatsApp con el mensaje pre-escrito que lleva el código. */
export function whatsappLink(phone, code, text = "Hola Musicala 🎵 quiero más información") {
  const digits = String(phone || "").replace(/\D/g, "");
  const ref = normalizeRefCode(code);
  if (!digits || !ref) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(`${text} (ref ${ref})`)}`;
}
