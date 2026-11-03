// Attribution logic from Musicala CRM, functions/lib/crm/atribucion.js.
/**
 * De qué anuncio viene cada contacto.
 *
 * Cuando alguien escribe desde un anuncio de Meta de los que abren WhatsApp
 * («Enviar mensaje»), el primer mensaje trae `referral`: el id del anuncio, su
 * título y el enlace. Meta lo manda UNA vez, en ese mensaje; si no se guarda
 * ahí, se pierde para siempre. Durante meses se ignoró y la asistente tenía
 * que marcar la campaña a mano en la Base de datos.
 *
 * Se guardan dos cosas en la conversación:
 *   adOrigen   el PRIMER anuncio por el que llegó. No se pisa nunca: es el que
 *              se lleva el crédito de la venta.
 *   adUltimo   el más reciente, por si vuelve meses después por otro anuncio.
 */

const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);

/** El `referral` de Meta, limpio. `null` si el mensaje no vino de un anuncio. */
function desdeReferral(referral, timestampMs = Date.now()) {
  if (!referral || typeof referral !== "object") return null;
  const adId = str(referral.source_id, 64);
  const url = str(referral.source_url, 500);
  if (!adId && !url) return null;
  return {
    adId,
    // «ad» o «post»: un post promocionado también trae referral.
    tipo: str(referral.source_type, 20) || "ad",
    url,
    titulo: str(referral.headline, 200),
    texto: str(referral.body, 500),
    // El identificador del clic: sirve para devolverle a Meta la conversión.
    ctwaClid: str(referral.ctwa_clid, 200),
    plataforma: "meta",
    at: timestampMs
  };
}

/** Lo que se escribe en la conversación (merge). */
function cambiosParaConversacion(conversacionActual, origen) {
  if (!origen) return null;
  const cambios = { adUltimo: origen };
  if (!conversacionActual?.adOrigen) cambios.adOrigen = origen;
  return cambios;
}

/**
 * El código de campaña escrito en el mensaje: «… (ref PIANO-G1)».
 *
 * Es lo que hace automático a Google Ads (y a cualquier anuncio que no abra
 * WhatsApp directo): el botón del anuncio o de la página lleva el mensaje
 * pre-escrito con su código, y el cliente lo envía sin tocarlo. Meta no avisa
 * de esos clics; el código sí llega.
 */
function codigoEnTexto(texto = "") {
  // Con separador obligatorio: «referido» o «refuerzo» no son un código.
  const m = /(?:^|[^a-z0-9])ref[\s:#-]+([a-z0-9][a-z0-9_-]{1,23})(?![a-z0-9_-])/i.exec(String(texto || ""));
  return m ? m[1].toUpperCase() : "";
}

/**
 * La campaña de una conversación, con el catálogo de HOY.
 *
 * Se calcula al leer y no se congela al llegar: si el anuncio se asocia a su
 * campaña una semana después, todos los contactos que ya entraron por él
 * quedan bien sin rehacer nada.
 *
 * Orden: lo que corrigió una persona → el anuncio de Meta → el código del
 * mensaje → la campaña del bot (por palabras) → sin identificar.
 *
 * @returns {{campaignId, nombre, plataforma, metodo, revisar}}
 */
function campanaDe(conv = {}, campanas = []) {
  const porId = new Map(campanas.map((c) => [c.id, c]));
  const salida = (c, metodo, revisar = false) => ({
    campaignId: c?.id || "",
    nombre: c?.nombre || "",
    plataforma: c?.plataforma || "",
    metodo,
    revisar
  });

  const manual = conv.atribucionManual;
  if (manual?.campaignId !== undefined) {
    const c = porId.get(manual.campaignId);
    if (c) return salida(c, "manual");
    // «Orgánico», «Referido»… son orígenes sin campaña pagada.
    return { campaignId: "", nombre: manual.origen || "Sin campaña", plataforma: "", metodo: "manual", revisar: false };
  }

  const adId = conv.adOrigen?.adId;
  if (adId) {
    const c = campanas.find((x) => (x.metaAdIds || []).map(String).includes(String(adId)));
    if (c) return salida(c, "anuncio");
    // Vino de un anuncio que nadie ha asociado: se sabe que es Meta pagado.
    return { campaignId: "", nombre: conv.adOrigen.titulo || "Anuncio de Meta sin asociar", plataforma: "meta", metodo: "anuncio", revisar: true };
  }

  const codigo = String(conv.refCodigo || "").toUpperCase();
  if (codigo) {
    const c = campanas.find((x) => String(x.codigo || "").toUpperCase() === codigo);
    if (c) return salida(c, "codigo");
    return { campaignId: "", nombre: `Código ${codigo} sin campaña`, plataforma: "", metodo: "codigo", revisar: true };
  }

  return { campaignId: "", nombre: "Sin identificar", plataforma: "", metodo: "ninguno", revisar: false };
}

module.exports = { desdeReferral, cambiosParaConversacion, codigoEnTexto, campanaDe };
