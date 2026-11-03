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
