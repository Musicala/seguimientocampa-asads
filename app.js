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
    editingMetric: null,
    options: null,
    metricsHistoryFilter: '',
    filters: {
      from: null, // YYYY-MM-DD
      to: null,   // YYYY-MM-DD
      campaign_id: '',
      platform: '',
      status: '',
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
    wireCampaignSorting_();
    wireMetrics_();
    wireReality_();
    wireDashboardFilters_();
    wireBudgetQuickEdit_();
    wireDecisionExports_();
    wireConfig_();
    wireMetricsHistoryFilter_();

    // Opciones por defecto para que los desplegables no esten vacios antes de conectar.
    App.options = normalizeOptions_(null);
    populateOptionSelects_();
    renderOptionsConfig_();

    // Defaults: rango mes actual
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    App.filters.from = toISODate(from);
    App.filters.to = toISODate(to);
    syncPeriodInputs_();

    const connected = await boot_();

    // Dashboard por defecto
    if (connected) {
      await refreshDashboard_();
    }

    App.booted = true;
    if (connected) UIx.toast('Listo', 'success');
  }

  function wireCampaignSorting_() {
    const select = $('campaignSort');
    const direction = $('campaignSortDirection');
    if (!select || !direction) return;

    select.value = localStorage.getItem('campaignSort') || 'created';
    direction.dataset.direction = localStorage.getItem('campaignSortDirection') || 'desc';

    const syncDirection = () => {
      const ascending = direction.dataset.direction === 'asc';
      direction.textContent = ascending ? '↑' : '↓';
      direction.setAttribute('aria-label', ascending ? 'Orden ascendente; invertir' : 'Orden descendente; invertir');
      direction.title = ascending ? 'Orden ascendente' : 'Orden descendente';
    };
    const render = () => {
      if (window.UI?.renderCampaignTable) UI.renderCampaignTable(App.campaigns);
      else renderCampaignTableFallback_(App.campaigns);
    };

    select.addEventListener('change', () => {
      localStorage.setItem('campaignSort', select.value);
      render();
    });
    direction.addEventListener('click', () => {
      direction.dataset.direction = direction.dataset.direction === 'asc' ? 'desc' : 'asc';
      localStorage.setItem('campaignSortDirection', direction.dataset.direction);
      syncDirection();
      render();
    });
    syncDirection();
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

    // Opciones de los desplegables (canal, plataforma, objetivo, etc.)
    await loadCampaignOptions_();

    // Render campañas
    if (window.UI?.renderCampaignTable) UI.renderCampaignTable(App.campaigns);
    else renderCampaignTableFallback_(App.campaigns);

    // Fill selects
    if (window.UI?.fillCampaignSelect) {
      UI.fillCampaignSelect('metricCampaign', App.campaigns);
      UI.fillCampaignSelect('realityCampaign', App.campaigns);
    } else {
      fillSelectFallback_($('metricCampaign'), App.campaigns);
      fillSelectFallback_($('realityCampaign'), App.campaigns);
    }
    fillBudgetCampaignSelect_();
    fillMetricsHistoryFilter_();
    updateMetricPlatformUI_();

    // Default fecha del formulario
    const dateEl = $('metricDate');
    if (dateEl && !dateEl.value) dateEl.value = toISODate(new Date());

    // KPIs header: vacio hasta dashboard
    if (window.UI?.renderGlobalKPIs) UI.renderGlobalKPIs(null);

    // Si quieres, aqui puedes llenar dropdowns en forms futuros con params
    return true;
  }

  // ---------- DASHBOARD ----------
  function setDashboardLoading_(isLoading) {
    const overlay = $('dashboardLoading');
    if (overlay) overlay.classList.toggle('hidden', !isLoading);
    document.querySelector('.dashboard-grid')?.classList.toggle('is-loading', isLoading);
    document.querySelectorAll('[data-period], #btnApplyPeriod').forEach(btn => {
      btn.disabled = isLoading;
    });
  }

  async function refreshDashboard_() {
    const filters = {
      from: App.filters.from,
      to: App.filters.to,
      platform: App.filters.platform,
      status: App.filters.status,
    };

    setDashboardLoading_(true);
    let res;
    try {
      res = await safeCall_(() => API.dashboard(filters));
    } finally {
      setDashboardLoading_(false);
    }
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo cargar dashboard', 'error');
      return;
    }

    App.dashboard = res;
    const budgetById = {};
    (res.rows || []).forEach(r => { budgetById[String(r.campaign_id || '')] = r; });
    App.campaigns = mergeCampaignRows_(App.campaigns, res.rows || []);
    if (window.UI?.renderCampaignTable) UI.renderCampaignTable(App.campaigns);

    // Render KPIs globales
    if (window.UI?.renderGlobalKPIs) UI.renderGlobalKPIs(res.totals);
    else renderGlobalKPIsFallback_(res.totals);

    // Render KPIs dashboard
    if (window.UI?.renderDashboardKPIs) UI.renderDashboardKPIs(res.totals);
    else renderDashboardKPIsFallback_(res.totals);

    // Ranking
    if (window.UI?.renderRankingTable) UI.renderRankingTable(res.rankings, res.rows);
    else renderRankingFallback_(res.rankings, res.rows);

    const campaignById = {};
    App.campaigns.forEach(c => { campaignById[String(c.campaign_id || '')] = c; });
    const budgetRows = (res.rows || []).map(r => {
      const c = campaignById[String(r.campaign_id || '')] || {};
      return {
        ...r,
        fecha_creacion: r.fecha_creacion || c.fecha_creacion || c.fecha_inicio || '',
        fecha_inicio: r.fecha_inicio || c.fecha_inicio || '',
      };
    });
    renderExecutiveKPIs_(res.totals);
    renderFunnelView_(res.funnel, res.insights);
    renderTodayActions_(res.insights?.todayActions || []);
    refreshMarketingTasks_();

    if (window.UI?.renderBudgetControl) UI.renderBudgetControl(budgetRows, res.totals);
    if (window.UI?.renderDecisionPanel) UI.renderDecisionPanel(res.insights, res.rows, res.totals);
    if (window.UI?.renderWinnerCampaigns) UI.renderWinnerCampaigns(res.insights?.winners || [], res.insights?.finishedWinners || []);
    renderDashboardRangeLabel_();

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
    const btnImport = $('btnImportWorkbook');
    const inputImport = $('workbookImportInput');
    if (btnImport && inputImport) {
      btnImport.addEventListener('click', () => inputImport.click());
      inputImport.addEventListener('change', onImportWorkbook_);
    }
    const form = $('campaignForm');
    if (form) form.addEventListener('submit', onSubmitCampaign_);
    ['campaignPlatform', 'campaignChannel'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('input', applyCampaignPlatformDefaults_);
    });
    const budgetMode = $('campaignBudgetMode');
    if (budgetMode) budgetMode.addEventListener('change', () => { budgetMode.dataset.userTouched = '1'; });
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
    document.addEventListener('campaign:pause', (ev) => {
      const id = ev.detail?.campaign_id || '';
      if (id) onPauseCampaign_(id);
    });
    document.addEventListener('campaign:delete', (ev) => {
      const id = ev.detail?.campaign_id || '';
      if (id) onDeleteCampaign_(id);
    });
    document.addEventListener('campaign:reactivate', (ev) => {
      const id = ev.detail?.campaign_id || '';
      if (id) onReactivateCampaign_(id);
    });
  }

  function onNewCampaign_() {
    openCampaignModal_();
  }

  async function onImportWorkbook_(ev) {
    const file = ev.target?.files?.[0];
    if (!file) return;
    const btn = $('btnImportWorkbook');
    setButtonLoading(btn, true, 'Importando...');
    try {
      const res = await safeCall_(() => API.importMarketingWorkbook(file));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo importar el Excel', 'error');
        return;
      }
      const realityMsg = res.realityImported ? ` y ${res.realityImported} de realidad comercial` : '';
      UIx.toast(`Importado: ${res.campaignsImported || 0} campanas, ${res.metricsImported || 0} metricas${realityMsg}`, 'success');
      if (res.skippedRows) {
        UIx.toast(`${res.skippedRows} filas omitidas. ${(res.warnings || []).slice(0, 3).join(' | ')}`, 'warning');
      }
      await refreshCampaigns_();
      await refreshRecentMetrics_();
      await refreshDashboard_();
    } finally {
      setButtonLoading(btn, false);
      ev.target.value = '';
    }
  }

  function onEditCampaign_(campaignId) {
    const current = App.campaigns.find(c => String(c.campaign_id || '') === String(campaignId));
    if (!current) {
      UIx.toast('No encontre esa campaña para editar', 'error');
      return;
    }
    openCampaignModal_(current);
  }

  async function onPauseCampaign_(campaignId) {
    const current = App.campaigns.find(c => String(c.campaign_id || '') === String(campaignId));
    if (!current) return;
    if (!confirm(`Pausar la campana "${current.nombre || current.name || campaignId}"?`)) return;

    const res = await safeCall_(() => API.pauseCampaign(campaignId));
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo pausar la campana', 'error');
      return;
    }

    UIx.toast('Campana pausada', 'success');
    await refreshCampaigns_();
    await refreshDashboard_();
  }

  async function onDeleteCampaign_(campaignId) {
    const current = App.campaigns.find(c => String(c.campaign_id || '') === String(campaignId));
    if (!current) return;
    if (!confirm(`Archivar la campana "${current.nombre || current.name || campaignId}"? No se borra: deja de aparecer en la lista pero conserva sus metricas.`)) return;

    const res = await safeCall_(() => API.deleteCampaign(campaignId));
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo archivar la campana', 'error');
      return;
    }

    UIx.toast('Campana archivada', 'success');
    await refreshCampaigns_();
    await refreshDashboard_();
  }

  async function onReactivateCampaign_(campaignId) {
    const current = App.campaigns.find(c => String(c.campaign_id || '') === String(campaignId));
    if (!current) return;
    if (!confirm(`Reactivar "${current.nombre || current.name || campaignId}" como una nueva campana activa?`)) return;

    const res = await safeCall_(() => API.reactivateCampaign(campaignId));
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo reactivar la campana', 'error');
      return;
    }

    UIx.toast('Campana reactivada', 'success');
    await refreshCampaigns_();
    await refreshDashboard_();
  }

  async function onSubmitCampaign_(ev) {
    ev.preventDefault();
    const btn = $('campaignSaveBtn') || ev.submitter || $('campaignForm')?.querySelector('button[type="submit"]');

    const payload = readCampaignForm_();
    if (!payload.nombre) {
      UIx.toast('Escribe el nombre de la campaña', 'warning');
      $('campaignName')?.focus();
      return;
    }

    setButtonLoading(btn, true, 'Guardando...');
    let res;
    try {
      res = await safeCall_(() => API.saveCampaign(payload));
    } finally {
      setButtonLoading(btn, false);
    }
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
    if ($('campaignBudgetMode')) $('campaignBudgetMode').dataset.userTouched = isEdit ? '1' : '';
    setCampaignFormValue_('campaignName', campaign?.nombre || '');
    setCampaignSelectValue_('campaignChannel', campaign?.canal || '');
    setCampaignSelectValue_('campaignPlatform', campaign?.plataforma || '');
    setCampaignSelectValue_('campaignObjective', campaign?.objetivo || '');
    setCampaignSelectValue_('campaignService', campaign?.servicio || '');
    setCampaignSelectValue_('campaignMode', campaign?.modalidad || '');
    setCampaignFormValue_('campaignStart', normalizeDateInput_(campaign?.fecha_inicio) || toISODate(new Date()));
    setCampaignFormValue_('campaignEnd', normalizeDateInput_(campaign?.fecha_fin));
    setCampaignFormValue_('campaignBillingDate', normalizeDateInput_(campaign?.fecha_facturacion));
    setCampaignFormValue_('campaignStatus', campaign?.estado || 'Activa');
    setCampaignSelectValue_('campaignBillingModel', campaign?.modelo_cobro || '');
    setCampaignFormValue_('campaignBudgetMode', campaign?.budget_mode || inferBudgetMode_(campaign));
    setCampaignFormValue_('campaignDailyBudget', campaign?.presupuesto_diario || '');
    setCampaignFormValue_('campaignAdsSpend', campaign?.gasto_ads_total || campaign?.reported_spend || '');
    setCampaignFormValue_('campaignTax', campaign?.iva_total || '');
    setCampaignFormValue_('campaignTotalCharge', campaign?.cobro_total || '');
    setCampaignFormValue_('campaignMonthlyBudget', campaign?.presupuesto_mensual || '');
    setCampaignFormValue_('campaignMonthlyBudgetTarget', campaign?.monthly_budget_target || campaign?.presupuesto_mensual || '');
    setCampaignFormValue_('campaignCplTarget', campaign?.cpl_target || '');
    setCampaignFormValue_('campaignBudgetNotes', campaign?.budget_notes || '');
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
      fecha_creacion: isEdit ? '' : toISODate(new Date()),
      nombre: strForm_('campaignName'),
      canal: strForm_('campaignChannel'),
      plataforma: strForm_('campaignPlatform'),
      objetivo: strForm_('campaignObjective'),
      servicio: strForm_('campaignService'),
      modalidad: strForm_('campaignMode'),
      fecha_inicio: $('campaignStart')?.value || toISODate(new Date()),
      fecha_fin: $('campaignEnd')?.value || '',
      fecha_facturacion: $('campaignBillingDate')?.value || '',
      tipo_duracion: $('campaignEnd')?.value ? 'Con fecha de finalizaci?n' : 'Continua',
      estado: strForm_('campaignStatus') || 'Activa',
      presupuesto_diario: parseNum($('campaignDailyBudget')?.value),
      presupuesto_mensual: parseNum($('campaignMonthlyBudget')?.value),
      budget_mode: strForm_('campaignBudgetMode') || inferBudgetMode_({
        canal: strForm_('campaignChannel'),
        plataforma: strForm_('campaignPlatform'),
        presupuesto_diario: parseNum($('campaignDailyBudget')?.value),
        cobro_total: parseNum($('campaignTotalCharge')?.value),
        gasto_ads_total: parseNum($('campaignAdsSpend')?.value),
      }),
      monthly_budget_target: parseNum($('campaignMonthlyBudgetTarget')?.value) || parseNum($('campaignMonthlyBudget')?.value),
      cpl_target: parseNum($('campaignCplTarget')?.value),
      budget_notes: strForm_('campaignBudgetNotes'),
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
    const budgetModeEl = $('campaignBudgetMode');
    const isGoogleAds = channel.includes('google') || platform.includes('google');

    if (isGoogleAds && billingEl && !String(billingEl.value || '').trim()) {
      billingEl.value = 'Google Ads diario';
    }
    if (budgetModeEl && !budgetModeEl.dataset.userTouched) {
      budgetModeEl.value = isGoogleAds ? 'daily_google' : (channel.includes('meta') || platform.includes('meta') || platform.includes('facebook') || platform.includes('instagram')) ? 'daily_meta' : budgetModeEl.value || 'monthly_cap';
    }
  }

  // ---------- DASHBOARD FILTERS ----------
  function wireDashboardFilters_() {
    document.querySelectorAll('[data-period]').forEach(btn => {
      btn.addEventListener('click', async () => {
        setPeriodPreset_(btn.dataset.period || 'this_month');
        await refreshDashboard_();
      });
    });

    const apply = $('btnApplyPeriod');
    if (apply) {
      apply.addEventListener('click', async () => {
        App.filters.from = $('filterFrom')?.value || null;
        App.filters.to = $('filterTo')?.value || null;
        App.filters.platform = $('filterPlatform')?.value || '';
        App.filters.status = $('filterStatus')?.value || '';
        markPeriodPreset_('custom');
        await refreshDashboard_();
      });
    }
  }

  function setPeriodPreset_(preset) {
    const now = new Date();
    if (preset === 'last_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      App.filters.from = toISODate(start);
      App.filters.to = toISODate(end);
    } else if (preset === 'all') {
      App.filters.from = null;
      App.filters.to = null;
    } else {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      App.filters.from = toISODate(start);
      App.filters.to = toISODate(end);
      preset = 'this_month';
    }
    syncPeriodInputs_();
    markPeriodPreset_(preset);
  }

  function syncPeriodInputs_() {
    if ($('filterFrom')) $('filterFrom').value = App.filters.from || '';
    if ($('filterTo')) $('filterTo').value = App.filters.to || '';
    if ($('filterPlatform')) $('filterPlatform').value = App.filters.platform || '';
    if ($('filterStatus')) $('filterStatus').value = App.filters.status || '';
  }

  function markPeriodPreset_(active) {
    document.querySelectorAll('[data-period]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.period === active);
    });
  }

  function renderDashboardRangeLabel_() {
    const el = $('dashboardRangeLabel');
    if (!el) return;
    if (!App.filters.from && !App.filters.to) {
      el.textContent = filterSummary_('Mostrando todos los periodos');
      return;
    }
    el.textContent = filterSummary_(`Mostrando ${formatShortDate_(App.filters.from)} - ${formatShortDate_(App.filters.to)}`);
  }

  function filterSummary_(base) {
    const parts = [];
    if (App.filters.platform) parts.push(`plataforma ${App.filters.platform}`);
    if (App.filters.status) parts.push(`estado ${App.filters.status}`);
    return parts.length ? `${base} (${parts.join(', ')})` : base;
  }

  // ---------- PANEL EJECUTIVO ----------
  function renderExecutiveKPIs_(totals) {
    const el = $('executiveKPIs');
    if (!el || !totals) return;
    const cards = [
      ['Gasto total', moneyCOP(totals.spend)],
      ['Contactos nuevos', intFmt(totals.real_new_contacts)],
      ['Leads calificados', intFmt(totals.real_qualified_leads)],
      ['Clases de prueba', intFmt(totals.real_trial_classes)],
      ['Matriculas', intFmt(totals.real_enrollments)],
      ['Ingreso real', moneyCOP(totals.real_revenue)],
      ['ROAS real', numFmt(totals.real_roas, 2)],
      ['Costo por matricula', moneyCOP(totals.cost_per_enrollment)],
      ['Presupuesto usado', pctFmt(totals.budget_used_pct)],
      ['Presupuesto restante', moneyCOP(totals.budget_remaining)],
    ];
    el.innerHTML = `<div class="exec-kpi-grid">${cards.map(([label, value]) =>
      `<div class="exec-kpi"><span class="exec-kpi-value">${escapeHtmlApp_(value)}</span><span class="exec-kpi-label">${escapeHtmlApp_(label)}</span></div>`
    ).join('')}</div>`;
  }

  function renderFunnelView_(funnel, insights) {
    const el = $('funnelView');
    if (!el) return;
    const steps = funnel || [];
    if (!steps.length) { el.innerHTML = '<p class="muted">Sin datos de embudo.</p>'; return; }
    const max = Math.max(...steps.map(s => Number(s.value) || 0), 1);
    const bars = steps.map(s => {
      const val = Number(s.value) || 0;
      const pct = Math.max(2, Math.round((val / max) * 100));
      const text = s.money ? moneyCOP(val) : intFmt(val);
      return `<div class="funnel-step">
        <span class="funnel-label">${escapeHtmlApp_(s.label)}</span>
        <span class="funnel-bar"><span class="funnel-fill" style="width:${pct}%"></span></span>
        <span class="funnel-value">${escapeHtmlApp_(text)}</span>
      </div>`;
    }).join('');
    const leaks = (insights?.funnelLeaks || []);
    const leaksHtml = leaks.length
      ? `<div class="funnel-leaks">${leaks.map(l => `<span class="leak leak-${l.severity}">Fuga: ${escapeHtmlApp_(l.step)}</span>`).join('')}</div>`
      : '';
    el.innerHTML = `<div class="funnel">${bars}</div>${leaksHtml}`;
  }

  function renderTodayActions_(actions) {
    const el = $('todayActions');
    if (!el) return;
    if (!actions.length) { el.innerHTML = '<p class="muted">Sin acciones prioritarias hoy. Registra mas realidad comercial para obtener recomendaciones.</p>'; return; }
    App._todayActions = actions;
    el.innerHTML = actions.map((a, i) => `
      <div class="today-action prio-${escapeHtmlApp_(a.priority)}">
        <div class="today-action-head">
          <span class="badge badge-${escapeHtmlApp_(a.priority)}">${escapeHtmlApp_((a.priority || '').toUpperCase())}</span>
          <strong>${escapeHtmlApp_(a.campaignName || a.title)}</strong>
          <span class="today-action-type">${escapeHtmlApp_(a.title)}</span>
          <button type="button" class="btn-mini" data-add-task="${i}">+ Tarea</button>
        </div>
        <p class="today-action-reason">${escapeHtmlApp_(a.reason)}</p>
        <p class="today-action-do"><strong>Accion:</strong> ${escapeHtmlApp_(a.action)}</p>
        <p class="today-action-metric muted">${escapeHtmlApp_(a.metric)}</p>
      </div>`).join('');
    el.querySelectorAll('[data-add-task]').forEach(btn => {
      btn.addEventListener('click', () => onAddTaskFromAction_(Number(btn.dataset.addTask)));
    });
  }

  async function onAddTaskFromAction_(index) {
    const action = (App._todayActions || [])[index];
    if (!action) return;
    const res = await safeCall_(() => API.addTaskFromAction(action));
    if (!res?.ok) { UIx.toast(res?.error || 'No se pudo crear la tarea', 'error'); return; }
    UIx.toast('Tarea creada', 'success');
    await refreshMarketingTasks_();
  }

  async function refreshMarketingTasks_() {
    const el = $('marketingTasks');
    if (!el) return;
    const res = await safeCall_(() => API.listMarketingTasks());
    if (!res?.ok) { el.innerHTML = '<p class="muted">No se pudieron cargar las tareas.</p>'; return; }
    renderMarketingTasks_(res.rows || []);
  }

  function renderMarketingTasks_(tasks) {
    const el = $('marketingTasks');
    if (!el) return;
    const open = tasks.filter(t => t.status !== 'hecha' && t.status !== 'descartada');
    if (!open.length) { el.innerHTML = '<p class="muted">Sin tareas pendientes. Usa "+ Tarea" en las acciones recomendadas.</p>'; return; }
    const order = { high: 0, medium: 1, low: 2 };
    el.innerHTML = open
      .sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1))
      .map(t => `
        <div class="task-row prio-${escapeHtmlApp_(t.priority)}">
          <div class="task-main">
            <span class="badge badge-${escapeHtmlApp_(t.priority)}">${escapeHtmlApp_((t.priority || '').toUpperCase())}</span>
            <strong>${escapeHtmlApp_(t.campaignName || '')}</strong>
            <span>${escapeHtmlApp_(t.title)}</span>
            <span class="task-status muted">${escapeHtmlApp_(t.status)}</span>
          </div>
          <div class="task-actions">
            <button type="button" class="btn-mini" data-task-status="en_proceso" data-task-id="${escapeHtmlApp_(t.id)}">En proceso</button>
            <button type="button" class="btn-mini" data-task-status="hecha" data-task-id="${escapeHtmlApp_(t.id)}">Hecha</button>
            <button type="button" class="btn-mini" data-task-status="descartada" data-task-id="${escapeHtmlApp_(t.id)}">Descartar</button>
          </div>
        </div>`).join('');
    el.querySelectorAll('[data-task-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const res = await safeCall_(() => API.updateMarketingTask(btn.dataset.taskId, { status: btn.dataset.taskStatus }));
        if (!res?.ok) { UIx.toast(res?.error || 'No se pudo actualizar la tarea', 'error'); return; }
        await refreshMarketingTasks_();
      });
    });
  }

  function escapeHtmlApp_(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function wireDecisionExports_() {
    $('btnDownloadDecisionReport')?.addEventListener('click', () => {
      if (!App.dashboard) {
        UIx.toast('Primero carga el dashboard', 'warning');
        return;
      }
      downloadTextFile_(`informe-marketing-musicala-${toISODate(new Date())}.md`, buildDecisionReport_());
      UIx.toast('Informe descargado', 'success');
    });

    $('btnCopyDecisionPrompt')?.addEventListener('click', async () => {
      if (!App.dashboard) {
        UIx.toast('Primero carga el dashboard', 'warning');
        return;
      }
      const prompt = buildDecisionPrompt_();
      try {
        await navigator.clipboard.writeText(prompt);
        UIx.toast('Prompt copiado para IA', 'success');
      } catch (_) {
        downloadTextFile_(`prompt-ia-marketing-musicala-${toISODate(new Date())}.txt`, prompt);
        UIx.toast('No pude copiarlo; lo descargue como TXT', 'warning');
      }
    });
  }

  function buildDecisionReport_() {
    const d = App.dashboard || {};
    const totals = d.totals || {};
    const rows = (d.rows || []).slice().sort((a, b) => parseNum(b.spend) - parseNum(a.spend));
    const best = (d.rankings?.bestROAS || []).slice(0, 5);
    const waste = (d.rankings?.waste || []).slice(0, 5);
    const winners = (d.insights?.winners || []).slice(0, 8);
    const alerts = d.insights?.alerts || [];
    const commercialAlerts = d.insights?.commercialAlerts || [];
    const todayActions = (d.insights?.todayActions || []).slice(0, 5);
    const funnel = d.funnel || [];
    const generatedAt = new Date().toLocaleString('es-CO');

    return [
      '# Informe de marketing Musicala',
      '',
      `Generado: ${generatedAt}`,
      `Rango: ${currentFilterLabel_()}`,
      '',
      '## Resumen ejecutivo',
      '',
      `- Inversion total: ${moneyCOP(totals.spend)}`,
      `- Presupuesto mensual: ${moneyCOP(totals.budget_monthly_target)} | Usado: ${pctFmt(totals.budget_used_pct)} | Restante: ${moneyCOP(totals.budget_remaining)}`,
      `- Leads / mensajes totales: ${intFmt(totals.leads)}`,
      `- Costo por lead: ${moneyCOP(totals.cpl)}`,
      `- Clics totales: ${intFmt(totals.link_clicks || totals.clicks)}`,
      `- Campanas activas: ${intFmt(totals.active_campaigns)}`,
      '',
      '### Realidad comercial Musicala',
      '',
      `- Contactos nuevos: ${intFmt(totals.real_new_contacts)}`,
      `- Leads calificados: ${intFmt(totals.real_qualified_leads)}`,
      `- Clases de prueba: ${intFmt(totals.real_trial_classes)}`,
      `- Matriculas: ${intFmt(totals.real_enrollments)}`,
      `- Ingreso real: ${moneyCOP(totals.real_revenue)}`,
      `- Costo por contacto: ${moneyCOP(totals.cost_per_contact)}`,
      `- Costo por lead calificado: ${moneyCOP(totals.cost_per_qualified_lead)}`,
      `- Costo por clase de prueba: ${moneyCOP(totals.cost_per_trial)}`,
      `- Costo por matricula: ${moneyCOP(totals.cost_per_enrollment)}`,
      `- ROAS real: ${numFmt(totals.real_roas, 2)}`,
      '',
      '## Embudo',
      '',
      funnel.length ? funnel.map(s => `- ${s.label}: ${s.money ? moneyCOP(s.value) : intFmt(s.value)}`).join('\n') : '- Sin datos de embudo.',
      '',
      '## Acciones recomendadas hoy',
      '',
      todayActions.length
        ? todayActions.map(a => `- [${a.priority.toUpperCase()}] ${a.campaignName}: ${a.title}. ${a.reason} Accion: ${a.action} (${a.metric})`).join('\n')
        : '- Sin acciones prioritarias; registrar mas datos comerciales.',
      '',
      '## Lectura rapida',
      '',
      decisionNarrative_(totals),
      '',
      '## Alertas del periodo',
      '',
      alerts.length ? alerts.map(a => `- ${a.title}: ${a.body}`).join('\n') : '- Sin alertas criticas.',
      '',
      '## Alertas comerciales',
      '',
      commercialAlerts.length ? commercialAlerts.map(a => `- ${a.title}: ${a.body}`).join('\n') : '- Sin alertas comerciales.',
      '',
      '## Campanas ganadoras / reactivables',
      '',
      winners.length ? markdownCampaignTable_(winners) : 'Sin ganadoras claras todavia.',
      '',
      '## Campanas por gasto',
      '',
      markdownCampaignTable_(rows.slice(0, 20)),
      '',
      '## Mejores senales',
      '',
      best.length ? markdownCampaignTable_(best) : 'Sin datos suficientes.',
      '',
      '## Alertas',
      '',
      waste.length ? markdownCampaignTable_(waste) : 'No hay campanas con gasto y cero leads en este rango.',
      '',
      '## Siguientes preguntas recomendadas',
      '',
      '- Que campanas deberian escalarse, pausarse o cambiarse?',
      '- Hay mucho gasto sin leads, ventas o ingresos?',
      '- Que dato falta para decidir con menos riesgo?',
      '- Que experimento pequeno conviene correr esta semana?',
      '',
    ].join('\n');
  }

  function buildDecisionPrompt_() {
    return [
      'Actua como estratega senior de marketing para una escuela de musica llamada Musicala.',
      'Necesito que me ayudes a tomar decisiones con base UNICAMENTE en los datos que te comparto. No inventes datos ni supongas resultados que no esten aqui.',
      '',
      'Objetivo del analisis:',
      '- Decidir que campanas escalar, pausar, optimizar, reactivar o seguir midiendo.',
      '- Usar la REALIDAD COMERCIAL (contactos, leads calificados, clases de prueba, matriculas, ingreso real) y no solo leads o ventas de plataforma.',
      '- Identificar fugas del embudo, riesgos de gasto y datos faltantes.',
      '- Proponer acciones concretas para hoy y para la proxima semana.',
      '',
      'Contexto:',
      '- Los datos vienen de registros manuales en Firestore (pauta + realidad comercial de Musicala).',
      '- Todavia no estan conectadas APIs externas de Meta Ads o Google Ads.',
      '- Distingue: "revenue/sales" (plataforma o manual) de "real_revenue/matriculas" (realidad comercial Musicala).',
      '- Puede haber campos vacios; si falta informacion, dilo como brecha de medicion. NO INVENTES DATOS.',
      '',
      'Formato de respuesta esperado (separa claramente estas secciones):',
      '1. Diagnostico ejecutivo en 5 bullets (incluye lectura del embudo).',
      '2. Decisiones inmediatas: tabla con campana, decision, razon, accion concreta y metrica que la justifica.',
      '3. Riesgos: gasto sin retorno, fugas de embudo y datos faltantes.',
      '4. Experimentos sugeridos para esta semana.',
      '5. Proximo presupuesto recomendado por campana y global.',
      '6. Campanas finalizadas que vale la pena reactivar y con que presupuesto inicial.',
      '',
      'Datos:',
      '',
      buildDecisionReport_(),
    ].join('\n');
  }

  function markdownCampaignTable_(rows) {
    if (!rows.length) return 'Sin campanas para mostrar.';
    const lines = [
      '| Campana | Plataforma | Estado | Gasto | Leads | CPL | Contactos | Calif. | Pruebas | Matriculas | Costo/Matr. | Ing. real | ROAS real |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ];
    rows.forEach(r => {
      lines.push(`| ${mdCell_(r.nombre || r.name || r.campaign_id)} | ${mdCell_(r.platform || r.platform_type || r.canal)} | ${mdCell_(r.estado || r.status)} | ${moneyCOP(r.spend)} | ${intFmt(r.leads)} | ${moneyCOP(r.cpl)} | ${intFmt(r.real_new_contacts)} | ${intFmt(r.real_qualified_leads)} | ${intFmt(r.real_trial_classes)} | ${intFmt(r.real_enrollments)} | ${moneyCOP(r.cost_per_enrollment)} | ${moneyCOP(r.real_revenue)} | ${numFmt(r.real_roas, 2)} |`);
    });
    return lines.join('\n');
  }

  function decisionNarrative_(totals) {
    const spend = parseNum(totals.spend);
    const leads = parseNum(totals.leads);
    const sales = parseNum(totals.sales);
    if (!spend) return 'Todavia no hay inversion registrada en el rango. La prioridad es registrar gasto y resultados reales antes de decidir.';
    if (!leads) return `Hay ${moneyCOP(spend)} de inversion sin leads registrados. Revisar campanas, mensajes, segmentacion y registro de contactos antes de aumentar presupuesto.`;
    if (!sales) return `Hay ${intFmt(leads)} leads con CPL de ${moneyCOP(totals.cpl)}, pero no hay ventas registradas. La decision depende de cerrar el seguimiento comercial.`;
    return `El rango muestra ${intFmt(leads)} leads, ${intFmt(sales)} ventas y ROAS ${numFmt(totals.roas, 2)}. Priorizar campanas con menor CPL y ventas reales.`;
  }

  function currentFilterLabel_() {
    const range = (!App.filters.from && !App.filters.to)
      ? 'Todos los periodos'
      : `${formatShortDate_(App.filters.from)} - ${formatShortDate_(App.filters.to)}`;
    return filterSummary_(range);
  }

  function mdCell_(value) {
    return String(value || '-').replace(/\|/g, '/').replace(/\n/g, ' ');
  }

  function downloadTextFile_(filename, content) {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ---------- QUICK BUDGET ----------
  function wireBudgetQuickEdit_() {
    const form = $('budgetForm');
    if (form) form.addEventListener('submit', onSubmitBudgetQuick_);

    const select = $('budgetCampaignSelect');
    if (select) select.addEventListener('change', () => openBudgetModal_(select.value));

    document.querySelectorAll('[data-action="close-budget-modal"]').forEach(el => {
      el.addEventListener('click', closeBudgetModal_);
    });

    document.addEventListener('budget:edit', (ev) => {
      openBudgetModal_(ev.detail?.campaign_id || '');
    });
  }

  function fillBudgetCampaignSelect_() {
    const sel = $('budgetCampaignSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecciona...</option>';
    App.campaigns.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.campaign_id || '';
      opt.textContent = c.nombre || c.campaign_id || '';
      sel.appendChild(opt);
    });
  }

  function openBudgetModal_(campaignId = '') {
    const modal = $('budgetModal');
    if (!modal) return;
    const isGlobal = !campaignId;
    modal.dataset.mode = isGlobal ? 'global' : 'campaign';

    const campaignFields = modal.querySelectorAll('[data-budget-scope="campaign"]');
    campaignFields.forEach(el => { el.style.display = isGlobal ? 'none' : ''; });
    const titleEl = modal.querySelector('[data-budget-title]');
    const descEl = modal.querySelector('[data-budget-desc]');
    if (titleEl) titleEl.textContent = isGlobal ? 'Presupuesto máximo Musicala' : 'Presupuesto máximo de campaña';
    if (descEl) descEl.textContent = isGlobal
      ? 'Define un único techo global aprobado por Musicala. Se aplica a la suma del mes en curso.'
      : 'Define el techo aprobado para esta campaña. Para finalizadas se compara contra el total de la campaña.';

    if (isGlobal) {
      const current = App.dashboard?.totals?.global_max_budget || '';
      setCampaignFormValue_('budgetCampaignId', '');
      setCampaignFormValue_('budgetMaxQuick', current);
      setCampaignFormValue_('budgetCplQuick', '');
      setCampaignFormValue_('budgetNotesQuick', '');
    } else {
      fillBudgetCampaignSelect_();
      const id = campaignId || $('budgetCampaignSelect')?.value || '';
      const campaign = App.campaigns.find(c => String(c.campaign_id || '') === String(id)) || App.campaigns[0] || null;
      if (!campaign) {
        UIx.toast('Primero crea una campana', 'warning');
        return;
      }
      setCampaignFormValue_('budgetCampaignId', campaign.campaign_id || '');
      setCampaignFormValue_('budgetCampaignSelect', campaign.campaign_id || '');
      setCampaignFormValue_('budgetModeQuick', campaign.budget_mode || inferBudgetMode_(campaign));
      setCampaignFormValue_('budgetMaxQuick', campaign.monthly_budget_target || campaign.presupuesto_mensual || '');
      setCampaignFormValue_('budgetCplQuick', campaign.cpl_target || '');
      setCampaignFormValue_('budgetNotesQuick', campaign.budget_notes || '');
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    $('budgetMaxQuick')?.focus();
  }

  function closeBudgetModal_() {
    const modal = $('budgetModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  async function onSubmitBudgetQuick_(ev) {
    ev.preventDefault();
    const modal = $('budgetModal');
    const isGlobal = modal?.dataset.mode === 'global';
    const maxBudget = parseNum($('budgetMaxQuick')?.value);
    if (!maxBudget) {
      UIx.toast('Escribe el presupuesto maximo aprobado', 'warning');
      return;
    }

    if (isGlobal) {
      const btn = $('budgetSaveBtn') || ev.submitter;
      setButtonLoading(btn, true, 'Guardando...');
      try {
        const res = await safeCall_(() => API.setGlobalBudget(maxBudget));
        if (!res?.ok) {
          UIx.toast(res?.error || 'No se pudo guardar el presupuesto global', 'error');
          return;
        }
        closeBudgetModal_();
        UIx.toast('Presupuesto maximo global guardado', 'success');
        await refreshDashboard_();
      } finally {
        setButtonLoading(btn, false);
      }
      return;
    }

    const id = $('budgetCampaignId')?.value || $('budgetCampaignSelect')?.value || '';
    const campaign = App.campaigns.find(c => String(c.campaign_id || '') === String(id));
    if (!campaign) {
      UIx.toast('Selecciona una campana', 'warning');
      return;
    }

    const payload = {
      ...campaign,
      budget_mode: strForm_('budgetModeQuick') || inferBudgetMode_(campaign),
      monthly_budget_target: maxBudget,
      cpl_target: parseNum($('budgetCplQuick')?.value),
      budget_notes: strForm_('budgetNotesQuick'),
    };

    const btn = $('budgetSaveBtn') || ev.submitter;
    setButtonLoading(btn, true, 'Guardando...');
    try {
      const res = await safeCall_(() => API.saveCampaign(payload));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo guardar presupuesto', 'error');
        return;
      }
      closeBudgetModal_();
      UIx.toast('Presupuesto maximo guardado', 'success');
      await refreshCampaigns_();
      await refreshDashboard_();
    } finally {
      setButtonLoading(btn, false);
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
    const d = window.parseLocalDate ? window.parseLocalDate(value) : parseLocalDateFallback_(value);
    return isNaN(d) ? '' : toISODate(d);
  }

  async function refreshCampaigns_() {
    const list = await safeCall_(API.listCampaigns);
    if (!list?.ok) return;

    App.campaigns = mergeCampaignRows_(list.campaigns || [], App.dashboard?.rows || []);

    if (window.UI?.renderCampaignTable) UI.renderCampaignTable(App.campaigns);
    else renderCampaignTableFallback_(App.campaigns);

    if (window.UI?.fillCampaignSelect) UI.fillCampaignSelect('metricCampaign', App.campaigns);
    else fillSelectFallback_($('metricCampaign'), App.campaigns);
    if (window.UI?.fillCampaignSelect) UI.fillCampaignSelect('realityCampaign', App.campaigns);
    else fillSelectFallback_($('realityCampaign'), App.campaigns);
    fillBudgetCampaignSelect_();
    fillMetricsHistoryFilter_();
    updateMetricPlatformUI_();
  }

  function mergeCampaignRows_(campaigns, dashboardRows) {
    if (!(campaigns || []).length && (dashboardRows || []).length) {
      console.warn('[Marketing Musicala] La lista de campaigns vino vacia; usando filas del dashboard como respaldo.', dashboardRows.length);
    }
    const byId = new Map();
    (campaigns || []).forEach(c => {
      const id = String(c.campaign_id || c.id || '').trim();
      if (id) byId.set(id, { ...c });
    });

    (dashboardRows || []).forEach(r => {
      const id = String(r.campaign_id || r.id || '').trim();
      if (!id) return;
      const current = byId.get(id) || {};
      const merged = { ...current };
      Object.keys(r).forEach(k => {
        const v = r[k];
        if (v !== '' && v !== null && v !== undefined) merged[k] = v;
      });
      merged.campaign_id = merged.campaign_id || id;
      merged.id = merged.id || id;
      merged.nombre = merged.nombre || merged.name || r.name || id;
      merged.estado = merged.estado || r.estado || r.status || 'Activa';
      byId.set(id, merged);
    });

    return Array.from(byId.values());
  }

  // ---------- METRICS ----------
  function wireMetrics_() {
    const form = $('metricsForm');
    if (form) form.addEventListener('submit', onSubmitMetric_);
    const select = $('metricCampaign');
    if (select) select.addEventListener('change', updateMetricPlatformUI_);
    $('metricEditCancelBtn')?.addEventListener('click', cancelMetricEdit_);
    document.addEventListener('metric:edit', ev => startMetricEdit_(ev.detail));
    document.addEventListener('metric:archive', ev => archiveMetric_(ev.detail));
  }

  async function onSubmitMetric_(ev) {
    ev.preventDefault();
    const btn = $('metricSaveBtn') || ev.submitter;
    const payload = readMetricForm_();

    if (!payload.campaign_id) {
      UIx.toast('Selecciona una campa?a', 'warning');
      return;
    }
    if (!payload.date) {
      UIx.toast('Selecciona una fecha', 'warning');
      return;
    }

    const validationError = validateMetricPayload_(payload);
    if (validationError) {
      UIx.toast(validationError, 'warning');
      return;
    }

    setButtonLoading(btn, true, 'Guardando...');
    try {
      const res = App.editingMetric
        ? await safeCall_(() => API.updateMetric(payload, App.editingMetric.metric_id))
        : await safeCall_(() => API.addMetric(payload));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo guardar m?trica', 'error');
        return;
      }

      UIx.toast(App.editingMetric ? 'Métrica actualizada' : 'Métrica guardada', 'success');
      App.editingMetric = null;
      syncMetricEditState_();
      clearMetricFormAfterSave_();
      await refreshRecentMetrics_();
      await refreshDashboard_();
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function readMetricForm_() {
    const campaign = getSelectedCampaign_();
    const platformType = getCampaignPlatformType_(campaign);
    const spend = platformType === 'google'
      ? parseNum($('metricGoogleCost')?.value)
      : platformType === 'general'
        ? parseNum($('metricGeneralSpend')?.value)
        : parseNum($('metricSpend')?.value);
    const linkClicks = intForm_('metricLinkClicks');
    const googleClicks = intForm_('metricClicks');
    const conversations = intForm_('metricConversationsStarted');
    const conversions = intForm_('metricConversions');
    const rawLeads = intForm_('metricRawLeads');
    const videoPlays = intForm_('metricVideoPlays');

    return {
      campaign_id: $('metricCampaign')?.value || '',
      date: $('metricDate')?.value || '',
      platform_type: platformType,
      spend_entry_type: strForm_('metricSpendEntryType') || 'period_snapshot',
      spend,
      total_charge: 0,
      tax_amount: 0,
      daily_budget: parseNum($('metricDailyBudget')?.value),
      duration_days: intForm_('metricDurationDays'),
      conversations_started: conversations,
      cost_per_conversation: parseNum($('metricCostPerConversation')?.value),
      impressions: intForm_('metricImpressions') || videoPlays,
      clicks: platformType === 'meta' ? linkClicks : googleClicks,
      leads: platformType === 'meta' ? conversations : (conversions || rawLeads),
      sales: intForm_('metricSales'),
      revenue: parseNum($('metricRevenue')?.value),
      video_plays: videoPlays,
      viewers: intForm_('metricViewers'),
      link_clicks: linkClicks || googleClicks,
      post_interactions: intForm_('metricPostInteractions'),
      saves: intForm_('metricSaves'),
      shares: intForm_('metricShares'),
      comments: intForm_('metricComments'),
      page_likes: intForm_('metricPageLikes'),
      meta_leads: intForm_('metricMetaLeads'),
      reactions: intForm_('metricReactions'),
      optimization_score: parseNum($('metricOptimizationScore')?.value),
      ctr: parseNum($('metricCtr')?.value),
      avg_cpc: parseNum($('metricAvgCpc')?.value),
      conversions,
      interactions: intForm_('metricInteractions'),
      raw_leads: rawLeads,
      qualified_leads: intForm_('metricQualifiedLeads'),
      converted_leads: intForm_('metricConvertedLeads'),
      top_searches: strForm_('metricTopSearches'),
      costly_keywords: strForm_('metricCostlyKeywords'),
      best_keywords: strForm_('metricBestKeywords'),
      quick_observation: strForm_('metricQuickObservation'),
      notes: strForm_('metricQuickObservation'),
    };
  }

  function updateMetricPlatformUI_() {
    const campaign = getSelectedCampaign_();
    const platformType = getCampaignPlatformType_(campaign);
    const platformHelp = $('platformHelp');
    if (platformHelp) {
      platformHelp.textContent = platformType === 'meta'
        ? 'Usa los nombres que aparecen en Meta: conversaciones con mensajes iniciadas, clics en el enlace, interacciones, reproducciones, espectadores, importe gastado.'
        : platformType === 'google'
          ? 'Usa los nombres que aparecen en Google Ads: clics, impresiones, CPC prom., costo, CTR, conversiones, nivel de optimizacion y busquedas.'
          : 'Usa los campos generales para registrar gasto, clics, contactos, ventas e ingreso estimado.';
    }

    document.querySelectorAll('[data-platforms]').forEach(el => {
      const platforms = String(el.getAttribute('data-platforms') || '').split(/\s+/).filter(Boolean);
      const visible = platforms.includes('all') || platforms.includes(platformType);
      el.classList.toggle('hidden-platform-field', !visible);
      el.querySelectorAll('input, textarea, select').forEach(input => {
        input.disabled = !visible;
      });
    });
  }

  function getSelectedCampaign_() {
    const id = $('metricCampaign')?.value || '';
    return App.campaigns.find(c => String(c.campaign_id || '') === String(id)) || null;
  }

  function getCampaignPlatformType_(campaign) {
    const text = `${campaign?.canal || ''} ${campaign?.plataforma || ''}`.toLowerCase();
    if (text.includes('meta') || text.includes('facebook') || text.includes('instagram')) return 'meta';
    if (text.includes('google')) return 'google';
    return 'general';
  }

  function inferBudgetMode_(campaign) {
    const text = `${campaign?.canal || ''} ${campaign?.plataforma || ''} ${campaign?.modelo_cobro || ''}`.toLowerCase();
    if (text.includes('google')) return 'daily_google';
    if ((parseNum(campaign?.cobro_total) > 0 || parseNum(campaign?.gasto_ads_total) > 0) && !parseNum(campaign?.presupuesto_diario)) return 'one_time';
    if (text.includes('meta') || text.includes('facebook') || text.includes('instagram')) return parseNum(campaign?.presupuesto_diario) ? 'daily_meta' : 'one_time';
    return 'monthly_cap';
  }

  function validateMetricPayload_(payload) {
    const numericKeys = [
      'spend','total_charge','tax_amount','daily_budget','duration_days','conversations_started','cost_per_conversation',
      'impressions','clicks','leads','sales','revenue','video_plays','viewers','link_clicks','post_interactions','reactions',
      'saves','shares','comments','page_likes','meta_leads',
      'optimization_score','ctr','avg_cpc','conversions','interactions','raw_leads','qualified_leads','converted_leads'
    ];
    for (const key of numericKeys) {
      if (Number(payload[key] || 0) < 0) return 'Los campos numericos no pueden ser negativos.';
    }
    if (payload.ctr < 0 || payload.ctr > 100) return 'El CTR debe estar entre 0 y 100.';
    if (payload.optimization_score < 0 || payload.optimization_score > 100) return 'El nivel de optimizacion debe estar entre 0 y 100.';
    return '';
  }

  function clearMetricFormAfterSave_() {
    const keep = new Set(['metricCampaign', 'metricDate']);
    $('metricsForm')?.querySelectorAll('input, textarea').forEach(el => {
      if (!keep.has(el.id)) el.value = '';
    });
    updateMetricPlatformUI_();
  }

  function startMetricEdit_({ campaign_id, metric_id } = {}) {
    const row = (App.lastMetrics || []).find(item =>
      String(item.campaign_id || '') === String(campaign_id || '') &&
      String(item.metric_id || item.id || '') === String(metric_id || '')
    );
    if (!row) return UIx.toast('No encontré el registro para editar', 'warning');

    App.editingMetric = { campaign_id, metric_id };
    const values = {
      metricCampaign: campaign_id, metricDate: row.date, metricSpendEntryType: row.spend_entry_type || 'period_snapshot',
      metricDailyBudget: row.daily_budget, metricDurationDays: row.duration_days,
      metricConversationsStarted: row.conversations_started, metricCostPerConversation: row.cost_per_conversation,
      metricImpressions: row.impressions, metricClicks: row.clicks, metricLinkClicks: row.link_clicks,
      metricSales: row.sales, metricRevenue: row.revenue, metricVideoPlays: row.video_plays,
      metricViewers: row.viewers, metricPostInteractions: row.post_interactions, metricSaves: row.saves,
      metricShares: row.shares, metricComments: row.comments, metricPageLikes: row.page_likes,
      metricMetaLeads: row.meta_leads, metricReactions: row.reactions, metricOptimizationScore: row.optimization_score,
      metricCtr: row.ctr, metricAvgCpc: row.avg_cpc, metricConversions: row.conversions,
      metricInteractions: row.interactions, metricRawLeads: row.raw_leads,
      metricQualifiedLeads: row.qualified_leads, metricConvertedLeads: row.converted_leads,
      metricTopSearches: row.top_searches, metricCostlyKeywords: row.costly_keywords,
      metricBestKeywords: row.best_keywords, metricQuickObservation: row.quick_observation || row.notes,
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = $(id);
      if (el) el.value = value ?? '';
    });
    updateMetricPlatformUI_();
    const platform = getCampaignPlatformType_(getSelectedCampaign_());
    const spendId = platform === 'google' ? 'metricGoogleCost' : platform === 'general' ? 'metricGeneralSpend' : 'metricSpend';
    if ($(spendId)) $(spendId).value = row.spend ?? '';
    syncMetricEditState_();
    $('metricsForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function cancelMetricEdit_() {
    App.editingMetric = null;
    syncMetricEditState_();
    clearMetricFormAfterSave_();
  }

  function syncMetricEditState_() {
    const editing = Boolean(App.editingMetric);
    if ($('metricSaveBtn')) $('metricSaveBtn').textContent = editing ? 'Guardar cambios' : 'Guardar';
    if ($('metricEditCancelBtn')) $('metricEditCancelBtn').hidden = !editing;
  }

  async function archiveMetric_({ campaign_id, metric_id } = {}) {
    if (!campaign_id || !metric_id || !confirm('¿Quitar este registro del cálculo y del histórico?')) return;
    const res = await safeCall_(() => API.archiveMetric(campaign_id, metric_id));
    if (!res?.ok) return UIx.toast(res?.error || 'No se pudo quitar el registro', 'error');
    if (App.editingMetric?.metric_id === metric_id) cancelMetricEdit_();
    UIx.toast('Registro quitado del cálculo', 'success');
    await refreshRecentMetrics_();
    await refreshDashboard_();
  }

  function intForm_(id) {
    return parseInt($(id)?.value || '0', 10) || 0;
  }

  function setButtonLoading(button, isLoading, loadingText = 'Guardando...') {
    if (!button) return;
    if (isLoading) {
      button.dataset.originalText = button.dataset.originalText || button.textContent;
      button.textContent = loadingText;
      button.disabled = true;
      button.classList.add('is-loading');
    } else {
      button.textContent = button.dataset.originalText || button.textContent;
      button.disabled = false;
      button.classList.remove('is-loading');
    }
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
    renderMetricsHistory_();
  }

  function renderMetricsHistory_() {
    const filterId = String(App.metricsHistoryFilter || '');
    const rows = filterId
      ? (App.lastMetrics || []).filter(r => String(r.campaign_id || '') === filterId)
      : (App.lastMetrics || []);

    if (window.UI?.renderMetricsTable) UI.renderMetricsTable(rows);
    else renderMetricsTableFallback_(rows);
  }

  // ---------- OPTIONS / CONFIG ----------
  const FALLBACK_OPTIONS = {
    canales: ['Meta', 'Google Ads', 'TikTok', 'Otro'],
    plataformas: ['Business Meta', 'Google Search', 'Google Display', 'Google Performance Max', 'TikTok Ads', 'Otro'],
    objetivos: ['Mensajes', 'Leads', 'Conversiones', 'Trafico', 'Reconocimiento', 'Interaccion', 'Reproducciones de video'],
    servicios: ['Talleres vacacionales', 'Clases regulares', 'Cursos', 'Clases particulares', 'Otro'],
    modalidades: ['Sede', 'Hogar', 'Virtual', 'Hibrida'],
    modelosCobro: ['Meta cobro total', 'Meta diario', 'Google Ads diario', 'Pago unico', 'Otro'],
  };

  // Cada campo del formulario de campana ligado a su lista de opciones.
  const OPTION_FIELDS = [
    { selectId: 'campaignChannel', key: 'canales', label: 'Canales' },
    { selectId: 'campaignPlatform', key: 'plataformas', label: 'Plataformas' },
    { selectId: 'campaignObjective', key: 'objetivos', label: 'Objetivos' },
    { selectId: 'campaignService', key: 'servicios', label: 'Servicios' },
    { selectId: 'campaignMode', key: 'modalidades', label: 'Modalidades' },
    { selectId: 'campaignBillingModel', key: 'modelosCobro', label: 'Modelos de cobro' },
  ];

  async function loadCampaignOptions_() {
    let options = null;
    if (API?.getCampaignOptions) {
      const res = await safeCall_(() => API.getCampaignOptions());
      if (res?.ok && res.options) options = res.options;
    }
    App.options = normalizeOptions_(options);
    populateOptionSelects_();
    renderOptionsConfig_();
  }

  function normalizeOptions_(options) {
    const out = {};
    for (const key of Object.keys(FALLBACK_OPTIONS)) {
      const list = Array.isArray(options?.[key]) ? options[key] : null;
      out[key] = (list && list.length ? list : FALLBACK_OPTIONS[key]).map(v => String(v || '').trim()).filter(Boolean);
    }
    return out;
  }

  function populateOptionSelects_() {
    const opts = App.options || FALLBACK_OPTIONS;
    OPTION_FIELDS.forEach(({ selectId, key }) => {
      const sel = $(selectId);
      if (!sel) return;
      const current = sel.value;
      const list = opts[key] || [];
      sel.innerHTML = '<option value="">Selecciona...</option>';
      list.forEach(value => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = value;
        sel.appendChild(opt);
      });
      if (current) setCampaignSelectValue_(selectId, current);
    });
  }

  // Asigna el valor a un select; si no existe en la lista (datos antiguos), lo agrega.
  function setCampaignSelectValue_(id, value) {
    const sel = $(id);
    if (!sel) return;
    const v = String(value || '').trim();
    if (!v) { sel.value = ''; return; }
    const exists = Array.from(sel.options).some(o => o.value === v);
    if (!exists) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function fillMetricsHistoryFilter_() {
    const sel = $('metricsHistoryFilter');
    if (!sel) return;
    const current = sel.value || App.metricsHistoryFilter || '';
    sel.innerHTML = '<option value="">Todas las campañas</option>';
    (App.campaigns || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.campaign_id || '';
      opt.textContent = `${c.nombre || c.campaign_id || ''}${c.canal ? ` - ${c.canal}` : ''}`;
      sel.appendChild(opt);
    });
    sel.value = current;
    App.metricsHistoryFilter = sel.value;
  }

  function wireMetricsHistoryFilter_() {
    const sel = $('metricsHistoryFilter');
    if (!sel) return;
    sel.addEventListener('change', () => {
      App.metricsHistoryFilter = sel.value || '';
      renderMetricsHistory_();
    });
  }

  function wireConfig_() {
    const btn = $('btnSaveOptions');
    if (btn) btn.addEventListener('click', onSaveOptions_);
  }

  function renderOptionsConfig_() {
    const host = $('optionsConfig');
    if (!host) return;
    const opts = App.options || FALLBACK_OPTIONS;
    host.innerHTML = OPTION_FIELDS.map(({ key, label }) => {
      const list = opts[key] || [];
      const chips = list.map((value, idx) => `
        <span class="option-chip">
          <span>${escapeHtml(value)}</span>
          <button type="button" class="option-remove" data-key="${escapeHtml(key)}" data-index="${idx}" aria-label="Eliminar">×</button>
        </span>
      `).join('');
      return `
        <div class="option-group" data-group="${escapeHtml(key)}">
          <h4>${escapeHtml(label)}</h4>
          <div class="option-chips">${chips || '<span class="muted">Sin opciones todavia.</span>'}</div>
          <div class="option-add">
            <input type="text" class="option-add-input" data-key="${escapeHtml(key)}" placeholder="Agregar opción y Enter" />
            <button type="button" class="btn-mini option-add-btn" data-key="${escapeHtml(key)}">Agregar</button>
          </div>
        </div>
      `;
    }).join('');

    host.querySelectorAll('.option-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const index = Number(btn.dataset.index);
        if (App.options?.[key]) {
          App.options[key].splice(index, 1);
          renderOptionsConfig_();
        }
      });
    });
    host.querySelectorAll('.option-add-btn').forEach(btn => {
      btn.addEventListener('click', () => addOptionFromInput_(btn.dataset.key));
    });
    host.querySelectorAll('.option-add-input').forEach(input => {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          addOptionFromInput_(input.dataset.key);
        }
      });
    });
  }

  function addOptionFromInput_(key) {
    const input = document.querySelector(`.option-add-input[data-key="${key}"]`);
    if (!input) return;
    const value = String(input.value || '').trim();
    if (!value) return;
    if (!App.options) App.options = normalizeOptions_(null);
    if (!App.options[key]) App.options[key] = [];
    const exists = App.options[key].some(v => v.toLowerCase() === value.toLowerCase());
    if (!exists) App.options[key].push(value);
    input.value = '';
    renderOptionsConfig_();
  }

  async function onSaveOptions_() {
    const btn = $('btnSaveOptions');
    if (!API?.saveCampaignOptions) {
      UIx.toast('No se pudo guardar: API no disponible', 'error');
      return;
    }
    setButtonLoading(btn, true, 'Guardando...');
    try {
      const res = await safeCall_(() => API.saveCampaignOptions(App.options || {}));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo guardar la configuración', 'error');
        return;
      }
      App.options = normalizeOptions_(res.options || App.options);
      populateOptionSelects_();
      renderOptionsConfig_();
      UIx.toast('Configuración guardada', 'success');
    } finally {
      setButtonLoading(btn, false);
    }
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
    const dt = (d instanceof Date) ? d : parseLocalDateFallback_(d);
    if (isNaN(dt)) return '';
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,'0');
    const day = String(dt.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function asDate(x) {
    if (!x) return new Date(NaN);
    if (x instanceof Date) return x;
    const d = window.parseLocalDate ? window.parseLocalDate(x) : parseLocalDateFallback_(x);
    return d;
  }

  function wireReality_() {
    const form = $('realityForm');
    if (form) form.addEventListener('submit', onSubmitReality_);
    const dateEl = $('realityDate');
    if (dateEl && !dateEl.value) dateEl.value = toISODate(new Date());
  }

  async function onSubmitReality_(ev) {
    ev.preventDefault();
    const btn = $('realitySaveBtn') || ev.submitter;
    const payload = {
      date: $('realityDate')?.value || '',
      sourceCampaignId: $('realityCampaign')?.value || '',
      newContacts: intForm_('realityNewContacts'),
      qualifiedLeads: intForm_('realityQualifiedLeads'),
      trialClasses: intForm_('realityTrialClasses'),
      enrollments: intForm_('realityEnrollments'),
      serviceSold: strForm_('realityServiceSold'),
      revenue: parseNum($('realityRevenue')?.value),
      notes: strForm_('realityNotes'),
    };
    if (!payload.date) {
      UIx.toast('Selecciona una fecha', 'warning');
      return;
    }
    setButtonLoading(btn, true, 'Guardando...');
    try {
      const res = await safeCall_(() => API.addMusicalaReality(payload));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo guardar realidad Musicala', 'error');
        return;
      }
      UIx.toast('Realidad Musicala guardada', 'success');
      $('realityForm')?.reset();
      if ($('realityDate')) $('realityDate').value = toISODate(new Date());
      await refreshDashboard_();
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function parseLocalDateFallback_(value) {
    const raw = String(value || '').trim();
    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return new Date(value);
  }

  function formatShortDate_(value) {
    if (!value) return 'sin limite';
    const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!parts) return value;
    return `${parts[3]}/${parts[2]}/${parts[1]}`;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

})();
