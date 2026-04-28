/* =========================================================
   app.js - Seguimiento Marketing - Musicala (Frontend)
   - Control de vistas (tabs)
   - Boot (params + campaigns)
   - CRUD minimo: campañas + métricas
   - Dashboard: KPIs + rankings + chart hook
========================================================= */

(() => {
  const $ = (id) => document.getElementById(id);

  // ---------- STATE ----------
  const App = {
    booted: false,
    params: {},
    campaigns: [],
    dashboard: null,
    lastMetrics: [],
    filters: {
      from: null, // YYYY-MM-DD
      to: null,   // YYYY-MM-DD
      campaign_id: '',
    },
  };

  // ---------- SAFE UI FALLBACKS ----------
  const UIx = {
    toast(msg, type = 'info') {
      if (window.UI && UI.toast) return UI.toast(msg, type);
      console.log(`[${type}]`, msg);
    },
    setHtml(id, html) {
      const el = $(id);
      if (!el) return;
      el.innerHTML = html;
    },
  };

  // ---------- INIT ----------
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    wireTabs_();
    wireCampaigns_();
    wireMetrics_();

    // Defaults: rango mes actual
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    App.filters.from = toISODate(from);
    App.filters.to = toISODate(now);

    const connected = await boot_();

    // Dashboard por defecto
    if (connected) {
      await refreshDashboard_();
    }

    App.booted = true;
    if (connected) UIx.toast('Listo', 'success');
  }

  // ---------- BOOT ----------
  async function boot_() {
    UIx.toast('Cargando datos...', 'info');

    const res = await safeCall_(API.boot);
    if (!res?.ok) {
      App.params = {};
      App.campaigns = [];

      if (window.UI?.renderCampaignTable) UI.renderCampaignTable(App.campaigns);
      else renderCampaignTableFallback_(App.campaigns);

      if (window.UI?.fillCampaignSelect) {
        UI.fillCampaignSelect('metricCampaign', App.campaigns);
      } else {
        fillSelectFallback_($('metricCampaign'), App.campaigns);
      }

      if (window.UI?.renderGlobalKPIs) UI.renderGlobalKPIs(null);
      if (window.UI?.renderDashboardKPIs) UI.renderDashboardKPIs(null);
      if (window.UI?.renderRankingTable) UI.renderRankingTable({}, []);

      UIx.toast('La interfaz cargo, pero falta actualizar el Web App de Apps Script.', 'warning');
      return false;
    }

    App.params = res.params || {};
    App.campaigns = res.campaigns || [];

    // Render campañas
    if (window.UI?.renderCampaignTable) UI.renderCampaignTable(App.campaigns);
    else renderCampaignTableFallback_(App.campaigns);

    // Fill selects
    if (window.UI?.fillCampaignSelect) {
      UI.fillCampaignSelect('metricCampaign', App.campaigns);
    } else {
      fillSelectFallback_($('metricCampaign'), App.campaigns);
    }

    // Default fecha del formulario
    const dateEl = $('metricDate');
    if (dateEl && !dateEl.value) dateEl.value = toISODate(new Date());

    // KPIs header: vacio hasta dashboard
    if (window.UI?.renderGlobalKPIs) UI.renderGlobalKPIs(null);

    // Si quieres, aqui puedes llenar dropdowns en forms futuros con params
    return true;
  }

  // ---------- DASHBOARD ----------
  async function refreshDashboard_() {
    const filters = { from: App.filters.from, to: App.filters.to };

    const res = await safeCall_(() => API.dashboard(filters));
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo cargar dashboard', 'error');
      return;
    }

    App.dashboard = res;

    // Render KPIs globales
    if (window.UI?.renderGlobalKPIs) UI.renderGlobalKPIs(res.totals);
    else renderGlobalKPIsFallback_(res.totals);

    // Render KPIs dashboard
    if (window.UI?.renderDashboardKPIs) UI.renderDashboardKPIs(res.totals);
    else renderDashboardKPIsFallback_(res.totals);

    // Ranking
    if (window.UI?.renderRankingTable) UI.renderRankingTable(res.rankings, res.rows);
    else renderRankingFallback_(res.rankings, res.rows);

    // Resumen visual de rendimiento
    if (window.Charts?.renderPerformance) {
      Charts.renderPerformance('performanceSummary', res.series, res.rows);
    } else {
      // fallback: no llora
    }
  }

  // ---------- CAMPAIGNS ----------
  function wireCampaigns_() {
    const btnNew = $('btnNewCampaign');
    if (btnNew) btnNew.addEventListener('click', onNewCampaign_);
    const form = $('campaignForm');
    if (form) form.addEventListener('submit', onSubmitCampaign_);
    ['campaignPlatform', 'campaignChannel'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', applyCampaignPlatformDefaults_);
    });
    document.querySelectorAll('[data-action="close-campaign-modal"]').forEach(el => {
      el.addEventListener('click', closeCampaignModal_);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeCampaignModal_();
    });
    document.addEventListener('campaign:edit', (ev) => {
      const id = ev.detail?.campaign_id || '';
      if (id) onEditCampaign_(id);
    });
  }

  function onNewCampaign_() {
    openCampaignModal_();
  }

  function onEditCampaign_(campaignId) {
    const current = App.campaigns.find(c => String(c.campaign_id || '') === String(campaignId));
    if (!current) {
      UIx.toast('No encontre esa campaña para editar', 'error');
      return;
    }
    openCampaignModal_(current);
  }

  async function onSubmitCampaign_(ev) {
    ev.preventDefault();

    const payload = readCampaignForm_();
    if (!payload.nombre) {
      UIx.toast('Escribe el nombre de la campaña', 'warning');
      $('campaignName')?.focus();
      return;
    }

    const res = await safeCall_(() => API.saveCampaign(payload));
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo guardar campaña', 'error');
      return;
    }

    closeCampaignModal_();
    UIx.toast(payload._isEdit ? 'Campaña actualizada' : 'Campaña guardada', 'success');
    await refreshCampaigns_();
    await refreshDashboard_();
  }

  function openCampaignModal_(campaign = null) {
    const modal = $('campaignModal');
    const title = $('campaignModalTitle');
    if (!modal) return;

    const isEdit = Boolean(campaign?.campaign_id);
    if (title) title.textContent = isEdit ? 'Editar campaña' : 'Nueva campaña';

    setCampaignFormValue_('campaignId', campaign?.campaign_id || '');
    setCampaignFormValue_('campaignName', campaign?.nombre || '');
    setCampaignFormValue_('campaignChannel', campaign?.canal || '');
    setCampaignFormValue_('campaignPlatform', campaign?.plataforma || '');
    setCampaignFormValue_('campaignObjective', campaign?.objetivo || '');
    setCampaignFormValue_('campaignService', campaign?.servicio || '');
    setCampaignFormValue_('campaignMode', campaign?.modalidad || '');
    setCampaignFormValue_('campaignStart', normalizeDateInput_(campaign?.fecha_inicio) || toISODate(new Date()));
    setCampaignFormValue_('campaignEnd', normalizeDateInput_(campaign?.fecha_fin));
    setCampaignFormValue_('campaignStatus', campaign?.estado || 'Activa');
    setCampaignFormValue_('campaignBillingModel', campaign?.modelo_cobro || '');
    setCampaignFormValue_('campaignDailyBudget', campaign?.presupuesto_diario || '');
    setCampaignFormValue_('campaignAdsSpend', campaign?.gasto_ads_total || campaign?.reported_spend || '');
    setCampaignFormValue_('campaignTax', campaign?.iva_total || '');
    setCampaignFormValue_('campaignTotalCharge', campaign?.cobro_total || '');
    setCampaignFormValue_('campaignMonthlyBudget', campaign?.presupuesto_mensual || '');
    setCampaignFormValue_('campaignNotes', campaign?.notas || '');

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    applyCampaignPlatformDefaults_();
    $('campaignName')?.focus();
  }

  function closeCampaignModal_() {
    const modal = $('campaignModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  function readCampaignForm_() {
    const id = $('campaignId')?.value || '';
    const isEdit = Boolean(id);

    return {
      _isEdit: isEdit,
      campaign_id: id || makeCampaignId_(),
      nombre: strForm_('campaignName'),
      canal: strForm_('campaignChannel'),
      plataforma: strForm_('campaignPlatform'),
      objetivo: strForm_('campaignObjective'),
      servicio: strForm_('campaignService'),
      modalidad: strForm_('campaignMode'),
      fecha_inicio: $('campaignStart')?.value || toISODate(new Date()),
      fecha_fin: $('campaignEnd')?.value || '',
      estado: strForm_('campaignStatus') || 'Activa',
      presupuesto_diario: parseNum($('campaignDailyBudget')?.value),
      presupuesto_mensual: parseNum($('campaignMonthlyBudget')?.value),
      modelo_cobro: strForm_('campaignBillingModel'),
      gasto_ads_total: parseNum($('campaignAdsSpend')?.value),
      iva_total: parseNum($('campaignTax')?.value),
      cobro_total: parseNum($('campaignTotalCharge')?.value),
      responsable: '',
      notas: strForm_('campaignNotes'),
    };
  }

  function applyCampaignPlatformDefaults_() {
    const channel = strForm_('campaignChannel').toLowerCase();
    const platform = strForm_('campaignPlatform').toLowerCase();
    const billingEl = $('campaignBillingModel');
    const isGoogleAds = channel.includes('google') || platform.includes('google');

    if (isGoogleAds && billingEl && !String(billingEl.value || '').trim()) {
      billingEl.value = 'Google Ads diario';
    }
  }

  function setCampaignFormValue_(id, value) {
    const el = $(id);
    if (el) el.value = value ?? '';
  }

  function strForm_(id) {
    return String($(id)?.value || '').trim();
  }

  function normalizeDateInput_(value) {
    if (!value) return '';
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    return isNaN(d) ? '' : toISODate(d);
  }

  async function refreshCampaigns_() {
    const list = await safeCall_(API.listCampaigns);
    if (!list?.ok) return;

    App.campaigns = list.campaigns || [];

    if (window.UI?.renderCampaignTable) UI.renderCampaignTable(App.campaigns);
    else renderCampaignTableFallback_(App.campaigns);

    if (window.UI?.fillCampaignSelect) UI.fillCampaignSelect('metricCampaign', App.campaigns);
    else fillSelectFallback_($('metricCampaign'), App.campaigns);
  }

  // ---------- METRICS ----------
  function wireMetrics_() {
    const form = $('metricsForm');
    if (form) form.addEventListener('submit', onSubmitMetric_);
  }

  async function onSubmitMetric_(ev) {
    ev.preventDefault();

    const payload = {
      campaign_id: $('metricCampaign')?.value || '',
      date: $('metricDate')?.value || '',
      spend: parseNum($('metricSpend')?.value),
      impressions: parseInt($('metricVideoPlays')?.value || '0', 10) || 0,
      clicks: parseInt($('metricClicks')?.value || '0', 10) || 0,
      leads: parseInt($('metricLeads')?.value || '0', 10) || 0,
      sales: parseInt($('metricSales')?.value || '0', 10) || 0,
      revenue: 0,
      video_plays: parseInt($('metricVideoPlays')?.value || '0', 10) || 0,
      viewers: parseInt($('metricViewers')?.value || '0', 10) || 0,
      link_clicks: parseInt($('metricClicks')?.value || '0', 10) || 0,
      post_interactions: parseInt($('metricPostInteractions')?.value || '0', 10) || 0,
      saves: parseInt($('metricSaves')?.value || '0', 10) || 0,
      shares: parseInt($('metricShares')?.value || '0', 10) || 0,
      comments: parseInt($('metricComments')?.value || '0', 10) || 0,
      notes: '',
    };

    if (!payload.campaign_id) {
      UIx.toast('Selecciona una campaña', 'warning');
      return;
    }
    if (!payload.date) {
      UIx.toast('Selecciona una fecha', 'warning');
      return;
    }

    const res = await safeCall_(() => API.addMetric(payload));
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo guardar métrica', 'error');
      return;
    }

    UIx.toast('Métrica guardada OK', 'success');

    // Limpiar campos numericos
    ['metricSpend','metricLeads','metricClicks','metricVideoPlays','metricViewers','metricPostInteractions','metricSaves','metricShares','metricComments','metricSales']
      .forEach(id => { const el = $(id); if (el) el.value = ''; });

    // Refrescar historico + dashboard
    await refreshRecentMetrics_();
    await refreshDashboard_();
  }

  async function refreshRecentMetrics_() {
    // Usa queryMetrics para traer recientes (ultimos 30 dias por defecto)
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const res = await safeCall_(() => API.queryMetrics({
      from: toISODate(from),
      to: toISODate(to),
      campaign_id: '' // todos
    }));

    if (!res?.ok) return;

    App.lastMetrics = res.rows || [];

    if (window.UI?.renderMetricsTable) UI.renderMetricsTable(App.lastMetrics);
    else renderMetricsTableFallback_(App.lastMetrics);
  }

  // ---------- TABS ----------
  function wireTabs_() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(btn => {
      btn.addEventListener('click', async () => {
        tabs.forEach(t => t.classList.remove('active'));
        btn.classList.add('active');

        const view = btn.dataset.view;
        switchView_(view);

        if (view === 'dashboard') await refreshDashboard_();
        if (view === 'metrics') await refreshRecentMetrics_();
      });
    });
  }

  function switchView_(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(`view-${name}`);
    if (el) el.classList.add('active');
  }

  // ---------- FALLBACK RENDERERS ----------
  function renderCampaignTableFallback_(campaigns) {
    const tb = $('campaignTable');
    if (!tb) return;
    tb.innerHTML = '';
    campaigns.forEach(c => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div style="font-weight:700">${escapeHtml(c.nombre || '')}</div>
          <div class="muted" style="font-size:12px">${escapeHtml(c.campaign_id || '')}</div>
          ${parseNum(c.presupuesto_diario) > 0 ? `<div class="muted" style="font-size:12px">Presupuesto diario: ${moneyCOP(c.presupuesto_diario)}</div>` : ''}
          ${parseNum(c.cobro_total) > 0 ? `<div class="muted" style="font-size:12px">Cobro real: ${moneyCOP(c.cobro_total)}</div>` : ''}
        </td>
        <td>${escapeHtml(c.canal || '')}</td>
        <td>${escapeHtml(c.objetivo || '')}</td>
        <td><span class="badge ${badgeClass_(c.estado)}">${escapeHtml(c.estado || '')}</span></td>
        <td style="text-align:right">
          <button class="btn-mini" data-action="edit-campaign" data-id="${escapeHtml(c.campaign_id || '')}">Editar</button>
        </td>
      `;
      tb.appendChild(tr);
    });

    tb.querySelectorAll('button[data-action="edit-campaign"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id') || '';
        document.dispatchEvent(new CustomEvent('campaign:edit', { detail: { campaign_id: id } }));
      });
    });
  }

  function fillSelectFallback_(selectEl, campaigns) {
    if (!selectEl) return;
    selectEl.innerHTML = '<option value="">Selecciona...</option>';
    campaigns.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.campaign_id;
      opt.textContent = `${c.nombre || c.campaign_id} (${c.canal || ''})`;
      selectEl.appendChild(opt);
    });
  }

  function renderGlobalKPIsFallback_(totals) {
    const el = $('globalKPIs');
    if (!el || !totals) return;

    el.innerHTML = `
      <div class="kpi-item"><span>Gasto real</span><strong>${moneyCOP(totals.spend)}</strong></div>
      ${totals.reported_spend ? `<div class="kpi-item"><span>Gasto Ads</span><strong>${moneyCOP(totals.reported_spend)}</strong></div>` : ''}
      <div class="kpi-item"><span>Leads</span><strong>${intFmt(totals.leads)}</strong></div>
      <div class="kpi-item"><span>Ventas</span><strong>${intFmt(totals.sales)}</strong></div>
      <div class="kpi-item"><span>ROAS</span><strong>${numFmt(totals.roas, 2)}</strong></div>
    `;
  }

  function renderDashboardKPIsFallback_(totals) {
    const el = $('dashboardKPIs');
    if (!el || !totals) return;

    el.innerHTML = `
      <div class="kpi-item"><span>Gasto real</span><strong>${moneyCOP(totals.spend)}</strong></div>
      ${totals.reported_spend ? `<div class="kpi-item"><span>Gasto Ads reportado</span><strong>${moneyCOP(totals.reported_spend)}</strong></div>` : ''}
      <div class="kpi-item"><span>Impresiones</span><strong>${intFmt(totals.impressions)}</strong></div>
      <div class="kpi-item"><span>Clics</span><strong>${intFmt(totals.clicks)}</strong></div>
      <div class="kpi-item"><span>CTR</span><strong>${pctFmt(totals.ctr)}</strong></div>
      <div class="kpi-item"><span>CPC</span><strong>${moneyCOP(totals.cpc)}</strong></div>
      <div class="kpi-item"><span>CPL</span><strong>${moneyCOP(totals.cpl)}</strong></div>
      <div class="kpi-item"><span>CPA</span><strong>${moneyCOP(totals.cpa)}</strong></div>
      <div class="kpi-item"><span>Ingresos</span><strong>${moneyCOP(totals.revenue)}</strong></div>
      <div class="kpi-item"><span>ROAS</span><strong>${numFmt(totals.roas, 2)}</strong></div>
    `;
  }

  function renderRankingFallback_(rankings, rows) {
    const el = $('rankingTable');
    if (!el) return;

    const best = (rankings?.bestROAS || []).slice(0, 8);
    if (!best.length) {
      el.innerHTML = `<div class="muted">No hay datos suficientes aún.</div>`;
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Campaña</th><th>Gasto</th><th>Leads</th><th>ROAS</th></tr>
        </thead>
        <tbody>
          ${best.map(r => `
            <tr>
              <td>${escapeHtml(r.nombre || r.campaign_id)}</td>
              <td>${moneyCOP(r.spend)}</td>
              <td>${intFmt(r.leads)}</td>
              <td>${numFmt(r.roas, 2)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  function renderMetricsTableFallback_(rows) {
    const el = $('metricsTable');
    if (!el) return;

    const show = (rows || []).slice(0, 50);
    if (!show.length) {
      el.innerHTML = `<div class="muted">Aún no hay registros.</div>`;
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Fecha</th><th>Campaña</th><th>Gasto</th><th>Leads</th><th>Ventas</th><th>Ingreso</th>
          </tr>
        </thead>
        <tbody>
          ${show.map(r => `
            <tr>
              <td>${escapeHtml(toISODate(asDate(r.date)))}</td>
              <td>${escapeHtml(r.campaign_id)}</td>
              <td>${moneyCOP(r.spend)}</td>
              <td>${intFmt(r.leads)}</td>
              <td>${intFmt(r.sales)}</td>
              <td>${moneyCOP(r.revenue)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // ---------- HELPERS ----------
  async function safeCall_(fn) {
    try {
      return await fn();
    } catch (err) {
      UIx.toast(err?.message || String(err), 'error');
      return { ok: false, error: err?.message || String(err) };
    }
  }

  function makeCampaignId_() {
    // CMP-YYYYMMDD-HHMMSS-XXXX
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}-${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
    const rnd = Math.random().toString(16).slice(2,6).toUpperCase();
    return `CMP-${stamp}-${rnd}`;
  }

  function badgeClass_(estado) {
    const s = (estado || '').toLowerCase();
    if (s.includes('act')) return 'activa';
    if (s.includes('paus')) return 'pausada';
    if (s.includes('fin')) return 'finalizada';
    return '';
  }

  // Utils fallback (si utils.js no tiene algo)
  function parseNum(x) {
    if (window.parseNum) return window.parseNum(x);
    const n = Number(String(x || '').replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  function moneyCOP(x) {
    if (window.moneyCOP) return window.moneyCOP(x);
    const n = Number(x || 0);
    return n ? n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }) : '$0';
  }

  function numFmt(x, d=2) {
    const n = Number(x || 0);
    return n.toFixed(d);
  }

  function pctFmt(x) {
    const n = Number(x || 0);
    return (n * 100).toFixed(2) + '%';
  }

  function intFmt(x) {
    const n = Number(x || 0);
    return Math.trunc(n).toLocaleString('es-CO');
  }

  function toISODate(d) {
    if (window.toISODate) return window.toISODate(d);
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt)) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const day = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function asDate(x) {
    if (!x) return new Date(NaN);
    if (x instanceof Date) return x;
    const d = new Date(x);
    return d;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

})();
