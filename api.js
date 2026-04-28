/* =========================================================
   api.js - Cliente para Apps Script Web App
   Usa JSONP para funcionar desde 127.0.0.1 / Live Server sin CORS.
========================================================= */

const WEBAPP_URL =
  "https://script.google.com/macros/s/AKfycbxHeue5Jon-1lnY5u_Rh6dU3Hw3mN85tdmaQYsUuGg5-1cebTzD_rCU66KVohOhEbn0/exec";

const API = {
  async call(action, params = {}) {
    const data = await jsonp_(action, params);
    if (!data.ok) throw new Error(data.error || "Error API");
    return data;
  },

  boot() {
    return API.call("boot");
  },
  listCampaigns() {
    return API.call("listCampaigns");
  },
  saveCampaign(payload) {
    return API.call("upsertCampaign", payload);
  },
  addMetric(payload) {
    return API.call("addMetric", payload);
  },
  queryMetrics(filters) {
    return API.call("queryMetrics", filters);
  },
  dashboard(filters) {
    return API.call("dashboard", filters);
  },
  ping() {
    return API.call("ping");
  },
};

function jsonp_(action, params = {}) {
  return new Promise((resolve, reject) => {
    const callback = `__adsApiCallback_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const url = new URL(WEBAPP_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("params", JSON.stringify(params || {}));
    url.searchParams.set("callback", callback);
    url.searchParams.set("_", String(Date.now()));

    const script = document.createElement("script");
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tiempo de espera agotado llamando Apps Script"));
    }, 20000);

    function cleanup() {
      window.clearTimeout(timer);
      delete window[callback];
      script.remove();
    }

    window[callback] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("No se pudo cargar la respuesta de Apps Script"));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

window.API = API;
