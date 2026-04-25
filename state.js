/* =========================================================
   state.js — Estado central (simple y escalable)
   - Store con get/set/patch
   - subscribe() para reaccionar a cambios
   - helpers para campañas y filtros
========================================================= */

const State = (() => {
  // Estado único de la app
  const _state = {
    booted: false,

    // Data
    params: {},        // { Canales:[], Estados:[] ... } desde Parametros
    campaigns: [],     // filas de Campañas
    metrics: [],       // filas recientes de Metricas (cache)
    dashboard: null,   // respuesta de API.dashboard

    // UI / filtros
    view: "dashboard", // dashboard | campaigns | metrics
    filters: {
      from: null,      // YYYY-MM-DD
      to: null,        // YYYY-MM-DD
      campaign_id: "", // opcional
    },

    // flags UI
    loading: {
      boot: false,
      campaigns: false,
      metrics: false,
      dashboard: false,
    },

    // errores (por si quieres mostrar barra)
    lastError: null,
  };

  // Suscriptores
  const _subs = new Set();

  // -------- public API --------

  function get() {
    // Devuelve copia superficial para evitar mutaciones accidentales
    return shallowClone_(_state);
  }

  function set(next) {
    if (!next || typeof next !== "object") return;
    Object.keys(_state).forEach(k => delete _state[k]);
    Object.assign(_state, next);
    notify_({ type: "set" });
  }

  function patch(partial) {
    if (!partial || typeof partial !== "object") return;

    // Merge superficial + merges de objetos conocidos
    if (partial.filters) {
      _state.filters = { ..._state.filters, ...partial.filters };
    }
    if (partial.loading) {
      _state.loading = { ..._state.loading, ...partial.loading };
    }

    // Resto de campos directos
    Object.keys(partial).forEach(k => {
      if (k === "filters" || k === "loading") return;
      _state[k] = partial[k];
    });

    notify_({ type: "patch", keys: Object.keys(partial) });
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    _subs.add(fn);

    // Disparo inicial para que la UI se pinte si quiere
    try { fn(get(), { type: "init" }); } catch (_) {}

    return () => _subs.delete(fn);
  }

  // -------- convenience setters --------

  function setView(viewName) {
    patch({ view: viewName });
  }

  function setLoading(key, value) {
    patch({ loading: { [key]: !!value } });
  }

  function setError(err) {
    patch({ lastError: err ? String(err.message || err) : null });
  }

  // -------- campaign helpers --------

  function campaignById(id) {
    const s = str_(id);
    if (!s) return null;
    return _state.campaigns.find(c => str_(c.campaign_id) === s) || null;
  }

  function campaignsMap() {
    const map = {};
    _state.campaigns.forEach(c => {
      const id = str_(c.campaign_id);
      if (id) map[id] = c;
    });
    return map;
  }

  function setCampaigns(list) {
    patch({ campaigns: Array.isArray(list) ? list : [] });
  }

  function setParams(p) {
    patch({ params: p || {} });
  }

  function setMetrics(list) {
    patch({ metrics: Array.isArray(list) ? list : [] });
  }

  function setDashboard(obj) {
    patch({ dashboard: obj || null });
  }

  // -------- filters --------

  function setDateRange(from, to) {
    patch({ filters: { from: str_(from), to: str_(to) } });
  }

  function setCampaignFilter(campaign_id) {
    patch({ filters: { campaign_id: str_(campaign_id) } });
  }

  // -------- internal --------

  function notify_(meta) {
    const snapshot = get();
    _subs.forEach(fn => {
      try { fn(snapshot, meta || {}); } catch (_) {}
    });
  }

  function shallowClone_(obj) {
    return {
      ...obj,
      params: { ...obj.params },
      filters: { ...obj.filters },
      loading: { ...obj.loading },
      campaigns: Array.isArray(obj.campaigns) ? obj.campaigns.slice() : [],
      metrics: Array.isArray(obj.metrics) ? obj.metrics.slice() : [],
      dashboard: obj.dashboard, // esto puede ser grande; mantener referencia
    };
  }

  function str_(x) {
    return String(x ?? "").trim();
  }

  return {
    get,
    set,
    patch,
    subscribe,

    setView,
    setLoading,
    setError,

    setParams,
    setCampaigns,
    setMetrics,
    setDashboard,

    campaignById,
    campaignsMap,

    setDateRange,
    setCampaignFilter,
  };
})();

// Exponer global
window.State = State;