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
    continuationSource: null,
    leads: [],
    editingLead: null,
    budgetDistribution: [],
    calendarEvents: [],
    calendarMonth: null,
    editingCalendarEvent: null,
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
    wireLeads_();
    wireStrategicViews_();
    wireReactivate_();
    wireDashboardFilters_();
    wireBudgetQuickEdit_();
    wireDecisionExports_();
    wireConfig_();
    wireMetricsHistoryFilter_();
    wireCalendar_();
    wireIntegration_();

    // Opciones por defecto para que los desplegables no esten vacios antes de conectar.
    App.options = normalizeOptions_(null);
    populateOptionSelects_();
    populateLeadSelects_();
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
      await refreshIntegrationStatus_();
      await refreshDashboard_();
    }

    App.booted = true;
    if (connected) UIx.toast('Listo', 'success');
  }

  function wireIntegration_() {
    const button = $('btnSyncConnectedData');
    if (!button) return;
    button.addEventListener('click', async () => {
      const status = $('integrationSyncStatus');
      const original = button.textContent;
      try {
        button.disabled = true;
        button.textContent = 'Conectando…';
        if (status) status.textContent = 'Leyendo clientes de la Base, estados e ingresos de RIP…';
        const result = await safeCall_(() => API.syncConnectedData());
        if (!result?.ok) throw new Error(result?.error || 'No se pudo completar la sincronización.');
        renderIntegrationStatus_(result.summary);
        await refreshDashboard_();
        if (document.getElementById('view-leads')?.classList.contains('active')) await refreshLeads_();
        UIx.toast('Datos reales sincronizados', 'success');
      } catch (err) {
        if (status) status.textContent = `${err?.message || err} Si el navegador bloqueó la segunda ventana de Google, pulsa sincronizar otra vez.`;
        UIx.toast(err?.message || String(err), 'error');
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  async function refreshIntegrationStatus_() {
    if (!API?.getIntegrationStatus) return;
    const result = await safeCall_(() => API.getIntegrationStatus());
    if (result?.ok) renderIntegrationStatus_(result.status);
  }

  function renderIntegrationStatus_(summary) {
    const status = $('integrationSyncStatus');
    if (!status) return;
    if (!summary) {
      status.textContent = 'Todavía no se ha sincronizado la Base de datos con RIP.';
      return;
    }
    const rawDate = summary.syncedAt?.toDate?.() || summary.syncedAt || null;
    const date = rawDate ? new Date(rawDate) : null;
    const when = date && !Number.isNaN(date.getTime())
      ? date.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })
      : 'fecha no disponible';
    status.textContent = `Actualizado ${when}: ${intFmt(summary.uniqueContacts || 0)} contacto(s) único(s), ${intFmt(summary.enrolledContacts || 0)} matriculado(s), ${intFmt(summary.activeContacts || 0)} activo(s) y ${moneyCOP(summary.totalAttributedRevenue || 0)} de ingreso atribuido.`;
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
    fillLeadCampaignSelects_();
    updateMetricPlatformUI_();

    // Default fecha del formulario
    const dateEl = $('metricDate');
    if (dateEl && !dateEl.value) dateEl.value = toISODate(new Date());
    setDefaultMetricBudgetPeriod_();

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

    renderStrategicDashboard_(res);
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
    document.addEventListener('campaign:continue', (ev) => {
      const id = ev.detail?.campaign_id || '';
      if (id) onContinueCampaign_(id);
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

  function onReactivateCampaign_(campaignId) {
    const current = App.campaigns.find(c => String(c.campaign_id || '') === String(campaignId));
    if (!current) return;
    openReactivateModal_(current);
  }

  function openReactivateModal_(campaign) {
    const modal = $('reactivateModal');
    if (!modal) return;
    setCampaignFormValue_('reactivateCampaignId', campaign.campaign_id || '');
    const name = $('reactivateSourceName');
    if (name) name.textContent = `Se creará una versión nueva de "${campaign.nombre || campaign.name || campaign.campaign_id}".`;
    if ($('reactivateMode')) $('reactivateMode').value = 'igual';
    if ($('reactivateLearning')) $('reactivateLearning').value = '';
    if ($('reactivateHypothesis')) $('reactivateHypothesis').value = '';
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    $('reactivateLearning')?.focus();
  }

  function closeReactivateModal_() {
    const modal = $('reactivateModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  function wireReactivate_() {
    const form = $('reactivateForm');
    if (form) form.addEventListener('submit', onSubmitReactivate_);
    document.querySelectorAll('[data-action="close-reactivate-modal"]').forEach(el => {
      el.addEventListener('click', closeReactivateModal_);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeReactivateModal_();
    });
  }

  async function onSubmitReactivate_(ev) {
    ev.preventDefault();
    const btn = $('reactivateSaveBtn') || ev.submitter;
    const campaignId = $('reactivateCampaignId')?.value || '';
    const learning = strForm_('reactivateLearning');
    const hypothesis = strForm_('reactivateHypothesis');
    if (!learning || !hypothesis) {
      UIx.toast('Escribe el aprendizaje y la hipótesis', 'warning');
      return;
    }
    const options = { mode: strForm_('reactivateMode') || 'igual', learning, hypothesis };
    setButtonLoading(btn, true, 'Reactivando...');
    let res;
    try {
      res = await safeCall_(() => API.reactivateCampaign(campaignId, options));
    } finally {
      setButtonLoading(btn, false);
    }
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo reactivar la campana', 'error');
      return;
    }
    closeReactivateModal_();
    UIx.toast('Campaña reactivada', 'success');
    await refreshCampaigns_();
    await refreshDashboard_();
  }

  function onContinueCampaign_(campaignId) {
    const source = App.campaigns.find(c => String(c.campaign_id || '') === String(campaignId));
    if (!source) {
      UIx.toast('No encontre esa campaña para continuar', 'error');
      return;
    }

    // Clon para el mes siguiente: mismos datos, sin id (será nueva campaña),
    // nombre y fechas avanzados un mes, y métricas de gasto en cero.
    const range = nextMonthRange_(source.fecha_inicio, source.fecha_fin);
    const clone = {
      ...source,
      campaign_id: '',
      fecha_creacion: '',
      nombre: nextMonthName_(source.nombre || '') || `${source.nombre || ''} (continuación)`,
      fecha_inicio: range.start,
      fecha_fin: range.end,
      fecha_facturacion: '',
      estado: 'Activa',
      // empezar limpio: el gasto/cobro del mes anterior no se arrastra
      gasto_ads_total: 0,
      reported_spend: 0,
      iva_total: 0,
      cobro_total: 0,
    };

    openCampaignModal_(clone);
    // openCampaignModal_ reinicia continuationSource; lo fijamos después
    App.continuationSource = String(source.campaign_id || '');
    if ($('campaignBudgetMode')) $('campaignBudgetMode').dataset.userTouched = '1';
    const title = $('campaignModalTitle');
    if (title) title.textContent = 'Continuar campaña';
    UIx.toast('Revisa nombre, fechas y presupuesto antes de guardar', 'info');
  }

  // Meses en español para detectar y avanzar el mes en el nombre de la campaña
  const MESES_ES_ = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function nextMonthName_(name) {
    const original = String(name || '');
    if (!original) return '';
    const lower = original.toLowerCase();
    let bestIdx = -1;
    let bestMonth = -1;
    for (let i = 0; i < MESES_ES_.length; i++) {
      const idx = lower.lastIndexOf(MESES_ES_[i]);
      if (idx > bestIdx) {
        bestIdx = idx;
        bestMonth = i;
      }
    }
    if (bestIdx === -1) return '';
    const found = original.substr(bestIdx, MESES_ES_[bestMonth].length);
    const next = MESES_ES_[(bestMonth + 1) % 12];
    const replacement = /^[A-ZÁÉÍÓÚÑ]/.test(found) ? next.charAt(0).toUpperCase() + next.slice(1) : next;
    return original.slice(0, bestIdx) + replacement + original.slice(bestIdx + found.length);
  }

  function nextMonthRange_(startStr, endStr) {
    const base = parseYMD_(startStr) || new Date();
    const y = base.getFullYear();
    const m = base.getMonth();
    const firstNext = new Date(y, m + 1, 1);
    const lastNext = new Date(y, m + 2, 0);
    return {
      start: toISODate(firstNext),
      end: endStr ? toISODate(lastNext) : '',
    };
  }

  function parseYMD_(s) {
    const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
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
    App.continuationSource = campaign?.continua_de || null;

    setCampaignFormValue_('campaignId', campaign?.campaign_id || '');
    if ($('campaignBudgetMode')) $('campaignBudgetMode').dataset.userTouched = isEdit ? '1' : '';
    setCampaignFormValue_('campaignName', campaign?.nombre || '');
    setCampaignSelectValue_('campaignChannel', campaign?.canal || '');
    setCampaignSelectValue_('campaignPlatform', campaign?.plataforma || '');
    setCampaignSelectValue_('campaignObjective', campaign?.objetivo || '');
    setCampaignSelectValue_('campaignService', campaign?.servicio || '');
    setCampaignSelectValue_('campaignOfferType', campaign?.tipo_oferta || '');
    setCampaignSelectValue_('campaignMode', campaign?.modalidad || '');
    setCampaignSelectValue_('campaignFocus', campaign?.enfoque || '');
    setCampaignSelectValue_('campaignKpi', campaign?.kpi_principal || '');
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
      tipo_oferta: strForm_('campaignOfferType'),
      modalidad: strForm_('campaignMode'),
      enfoque: strForm_('campaignFocus'),
      kpi_principal: strForm_('campaignKpi'),
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
      continua_de: App.continuationSource || '',
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
    fillLeadCampaignSelects_();
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
    if (select) select.addEventListener('change', () => {
      updateMetricPlatformUI_();
      setDefaultMetricBudgetPeriod_();
    });
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
      budget_period: $('metricBudgetPeriod')?.value || String($('metricDate')?.value || '').slice(0, 7),
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
    const keep = new Set(['metricCampaign', 'metricDate', 'metricBudgetPeriod']);
    $('metricsForm')?.querySelectorAll('input, textarea').forEach(el => {
      if (!keep.has(el.id)) el.value = '';
    });
    updateMetricPlatformUI_();
  }

  function setDefaultMetricBudgetPeriod_() {
    const period = $('metricBudgetPeriod');
    if (!period || period.value) return;
    period.value = String($('metricDate')?.value || toISODate(new Date())).slice(0, 7);
  }

  function startMetricEdit_({ campaign_id, metric_id } = {}) {
    const row = (App.lastMetrics || []).find(item =>
      String(item.campaign_id || '') === String(campaign_id || '') &&
      String(item.metric_id || item.id || '') === String(metric_id || '')
    );
    if (!row) return UIx.toast('No encontré el registro para editar', 'warning');

    App.editingMetric = { campaign_id, metric_id };
    const values = {
      metricCampaign: campaign_id, metricDate: row.date,
      metricBudgetPeriod: row.budget_period || inferMetricBudgetPeriod_(row, getCampaignById_(campaign_id)),
      metricSpendEntryType: row.spend_entry_type || 'period_snapshot',
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

  function inferMetricBudgetPeriod_(metric, campaign) {
    const startMonth = String(campaign?.fecha_inicio || campaign?.startDate || '').slice(0, 7);
    const endMonth = String(campaign?.fecha_fin || campaign?.endDate || '').slice(0, 7);
    const namedMonth = /(?:^|\s|-)mayo(?:\s|$|-)/i.test(String(campaign?.nombre || campaign?.name || ''));
    if (startMonth && (startMonth === endMonth || namedMonth)) return startMonth;
    return String(metric?.date || '').slice(0, 7);
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
    servicios: ['Multiservicio / marca general', 'Musica general', 'Piano', 'Canto', 'Bateria', 'Cuerdas frotadas', 'Musicalitos / exploracion musical', 'Artes plasticas', 'Danza', 'Teatro', 'Vacacionales', 'Talleres especiales', 'Otro'],
    tiposOferta: ['Personalizada', 'Grupal', 'Taller', 'Vacacional', 'Evento', 'Mixta'],
    modalidades: ['Sede', 'Hogar', 'Virtual', 'Hibrida', 'No aplica'],
    enfoques: ['General', 'Servicio especifico', 'Taller / temporada', 'Remarketing', 'Reactivacion', 'Test'],
    kpisPrincipales: ['Costo por lead', 'Costo por contacto real', 'Costo por lead calificado', 'Costo por clase de prueba', 'Costo por matricula', 'ROAS real', 'Ingreso real'],
    modelosCobro: ['Meta cobro total', 'Meta diario', 'Google Ads diario', 'Pago unico', 'Otro'],
  };

  // Cada campo del formulario de campana ligado a su lista de opciones.
  const OPTION_FIELDS = [
    { selectId: 'campaignChannel', key: 'canales', label: 'Canales' },
    { selectId: 'campaignPlatform', key: 'plataformas', label: 'Plataformas' },
    { selectId: 'campaignObjective', key: 'objetivos', label: 'Objetivos' },
    { selectId: 'campaignService', key: 'servicios', label: 'Servicios' },
    { selectId: 'campaignOfferType', key: 'tiposOferta', label: 'Tipos de oferta' },
    { selectId: 'campaignMode', key: 'modalidades', label: 'Lugar / modalidad' },
    { selectId: 'campaignFocus', key: 'enfoques', label: 'Enfoques de campaña' },
    { selectId: 'campaignKpi', key: 'kpisPrincipales', label: 'KPI principal' },
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
    populateLeadSelects_();
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

  // ---------- CALENDARIO DE PUBLICACIONES ----------
  const CAL_MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const CAL_DAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const CAL_STATUS_LABELS = { idea: 'Idea', en_diseno: 'En diseño', programada: 'Programada', publicada: 'Publicada' };
  const CAL_TYPE_LABELS = { temporada: 'Temporada', publicacion: 'Publicación', fecha_clave: 'Fecha clave' };

  function wireCalendar_() {
    $('btnCalendarNew')?.addEventListener('click', () => openCalendarModal_());
    $('btnCalendarSeed')?.addEventListener('click', onCalendarSeed_);
    $('calendarPrev')?.addEventListener('click', () => shiftCalendarMonth_(-1));
    $('calendarNext')?.addEventListener('click', () => shiftCalendarMonth_(1));
    $('calendarToday')?.addEventListener('click', () => {
      const now = new Date();
      App.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      renderCalendar_();
    });
    $('calendarForm')?.addEventListener('submit', onCalendarSubmit_);
    $('calendarArchiveBtn')?.addEventListener('click', onCalendarArchive_);
    document.querySelectorAll('[data-action="close-calendar-modal"]').forEach(el => {
      el.addEventListener('click', closeCalendarModal_);
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeCalendarModal_();
    });
  }

  function shiftCalendarMonth_(delta) {
    const base = App.calendarMonth || new Date();
    App.calendarMonth = new Date(base.getFullYear(), base.getMonth() + delta, 1);
    renderCalendar_();
  }

  async function refreshCalendar_() {
    if (!API?.listCalendarEvents) return;
    const res = await safeCall_(() => API.listCalendarEvents());
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo cargar el calendario', 'error');
      return;
    }
    App.calendarEvents = res.rows || [];
    if (!App.calendarMonth) {
      const now = new Date();
      App.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    renderCalendar_();
  }

  function calendarProgramClass_(event) {
    const program = String(event.program || '').toLowerCase();
    if (program.includes('vacacional') || program.includes('vacaciones')) return 'cal-vacacionales';
    if (program.includes('preuniversitario') || program.includes('preu')) return 'cal-preu';
    if (program.includes('regular') || program.includes('clases')) return 'cal-regular';
    if (event.type === 'publicacion') return 'cal-publicacion';
    return 'cal-otro';
  }

  function calendarEventRange_(event) {
    const start = String(event.startDate || '');
    const end = String(event.endDate || '') || start;
    return { start, end: end < start ? start : end };
  }

  function renderCalendar_() {
    renderCalendarGrid_();
    renderCalendarUpcoming_();
    renderCalendarAllEvents_();
  }

  function renderCalendarAllEvents_() {
    const el = $('calendarAllEvents');
    if (!el) return;

    const events = (App.calendarEvents || [])
      .map(e => ({ event: e, range: calendarEventRange_(e) }))
      .sort((a, b) => a.range.start.localeCompare(b.range.start));

    if (!events.length) {
      el.innerHTML = '<p class="muted">Todavía no hay eventos. Usa "Cargar temporadas del año" o "+ Nuevo evento".</p>';
      return;
    }

    el.innerHTML = events.map(({ event, range }) => {
      const dates = range.end !== range.start ? `${range.start} → ${range.end}` : range.start;
      return `
        <div class="calendar-upcoming-row">
          <span class="calendar-dot ${calendarProgramClass_(event)}"></span>
          <div class="calendar-upcoming-info">
            <strong>${escapeHtml(event.title)}</strong>
            <span class="muted">${dates}${event.program ? ` · ${escapeHtml(event.program)}` : ''}${event.channel ? ` · ${escapeHtml(event.channel)}` : ''}</span>
          </div>
          <span class="badge">${escapeHtml(CAL_STATUS_LABELS[event.status] || event.status || '')}</span>
          <button type="button" class="btn-mini" data-cal-edit-all="${escapeHtml(event.id)}">Editar</button>
        </div>`;
    }).join('');

    el.querySelectorAll('[data-cal-edit-all]').forEach(btn => {
      btn.addEventListener('click', () => {
        const event = (App.calendarEvents || []).find(e => e.id === btn.dataset.calEditAll);
        if (event) openCalendarModal_(event);
      });
    });
  }

  function renderCalendarGrid_() {
    const grid = $('calendarGrid');
    const label = $('calendarMonthLabel');
    if (!grid) return;

    const month = App.calendarMonth || new Date();
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    if (label) label.textContent = `${CAL_MONTHS[monthIndex]} ${year}`;

    const firstDay = new Date(year, monthIndex, 1);
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    // Lunes = 0 ... Domingo = 6
    const leadingBlanks = (firstDay.getDay() + 6) % 7;
    const todayIso = toISODate(new Date());

    let html = CAL_DAYS.map(d => `<div class="calendar-dow">${d}</div>`).join('');
    for (let i = 0; i < leadingBlanks; i++) html += '<div class="calendar-cell calendar-cell-empty"></div>';

    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toISODate(new Date(year, monthIndex, day));
      const events = (App.calendarEvents || []).filter(e => {
        const { start, end } = calendarEventRange_(e);
        return start && start <= iso && iso <= end;
      });
      const chips = events.map(e => `
        <button type="button" class="calendar-chip ${calendarProgramClass_(e)}" data-cal-id="${escapeHtml(e.id)}" title="${escapeHtml(e.title)} · ${escapeHtml(CAL_TYPE_LABELS[e.type] || e.type || '')}">
          ${escapeHtml(e.title)}
        </button>`).join('');
      html += `
        <div class="calendar-cell${iso === todayIso ? ' calendar-cell-today' : ''}" data-cal-date="${iso}">
          <span class="calendar-daynum">${day}</span>
          ${chips}
        </div>`;
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.calendar-chip').forEach(chip => {
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const event = (App.calendarEvents || []).find(e => e.id === chip.dataset.calId);
        if (event) openCalendarModal_(event);
      });
    });
    grid.querySelectorAll('.calendar-cell[data-cal-date]').forEach(cell => {
      cell.addEventListener('click', () => openCalendarModal_(null, cell.dataset.calDate));
    });
  }

  function renderCalendarUpcoming_() {
    const el = $('calendarUpcoming');
    if (!el) return;

    const today = toISODate(new Date());
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 60);
    const limit = toISODate(horizon);

    const upcoming = (App.calendarEvents || [])
      .map(e => ({ event: e, range: calendarEventRange_(e) }))
      .filter(({ range }) => range.start && range.end >= today && range.start <= limit)
      .sort((a, b) => a.range.start.localeCompare(b.range.start));

    if (!upcoming.length) {
      el.innerHTML = '<p class="muted">No hay fechas próximas en los siguientes 60 días. Usa "Cargar temporadas del año" o crea un evento.</p>';
      return;
    }

    el.innerHTML = upcoming.map(({ event, range }) => {
      const ongoing = range.start <= today;
      const dates = range.end !== range.start ? `${range.start} → ${range.end}` : range.start;
      return `
        <div class="calendar-upcoming-row">
          <span class="calendar-dot ${calendarProgramClass_(event)}"></span>
          <div class="calendar-upcoming-info">
            <strong>${escapeHtml(event.title)}</strong>
            <span class="muted">${dates}${event.program ? ` · ${escapeHtml(event.program)}` : ''}${event.channel ? ` · ${escapeHtml(event.channel)}` : ''}</span>
          </div>
          <span class="badge">${ongoing ? 'En curso' : escapeHtml(CAL_STATUS_LABELS[event.status] || event.status || '')}</span>
          <button type="button" class="btn-mini" data-cal-edit="${escapeHtml(event.id)}">Editar</button>
        </div>`;
    }).join('');

    el.querySelectorAll('[data-cal-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const event = (App.calendarEvents || []).find(e => e.id === btn.dataset.calEdit);
        if (event) openCalendarModal_(event);
      });
    });
  }

  function openCalendarModal_(event = null, presetDate = '') {
    const modal = $('calendarModal');
    if (!modal) return;

    App.editingCalendarEvent = event ? event.id : null;
    $('calendarModalTitle').textContent = event ? 'Editar evento' : 'Nuevo evento';
    $('calendarEventId').value = event?.id || '';
    $('calendarEventTitle').value = event?.title || '';
    $('calendarEventType').value = event?.type || 'fecha_clave';
    $('calendarEventStart').value = event?.startDate || presetDate || '';
    $('calendarEventEnd').value = event?.endDate || '';
    $('calendarEventProgram').value = event?.program || '';
    $('calendarEventChannel').value = event?.channel || '';
    $('calendarEventStatus').value = event?.status || 'idea';
    $('calendarEventNotes').value = event?.notes || '';
    $('calendarArchiveBtn').style.display = event ? '' : 'none';

    const campaignSelect = $('calendarEventCampaign');
    if (campaignSelect) {
      campaignSelect.innerHTML = '<option value="">Ninguna</option>';
      (App.campaigns || []).forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.campaign_id;
        opt.textContent = c.nombre || c.campaign_id;
        campaignSelect.appendChild(opt);
      });
      campaignSelect.value = event?.campaignId || '';
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    $('calendarEventTitle')?.focus();
  }

  function closeCalendarModal_() {
    const modal = $('calendarModal');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    App.editingCalendarEvent = null;
  }

  async function onCalendarSubmit_(ev) {
    ev.preventDefault();
    const btn = $('calendarSaveBtn');
    const payload = {
      title: $('calendarEventTitle').value,
      type: $('calendarEventType').value,
      startDate: $('calendarEventStart').value,
      endDate: $('calendarEventEnd').value,
      program: $('calendarEventProgram').value,
      channel: $('calendarEventChannel').value,
      status: $('calendarEventStatus').value,
      campaignId: $('calendarEventCampaign')?.value || '',
      notes: $('calendarEventNotes').value,
    };

    setButtonLoading(btn, true, 'Guardando...');
    try {
      const id = App.editingCalendarEvent;
      const res = await safeCall_(() => id ? API.updateCalendarEvent(id, payload) : API.addCalendarEvent(payload));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo guardar el evento', 'error');
        return;
      }
      closeCalendarModal_();
      UIx.toast(id ? 'Evento actualizado' : 'Evento creado', 'success');
      await refreshCalendar_();
    } finally {
      setButtonLoading(btn, false);
    }
  }

  async function onCalendarArchive_() {
    const id = App.editingCalendarEvent;
    if (!id) return;
    if (!confirm('¿Archivar este evento? Dejará de verse en el calendario.')) return;
    const res = await safeCall_(() => API.archiveCalendarEvent(id));
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudo archivar el evento', 'error');
      return;
    }
    closeCalendarModal_();
    UIx.toast('Evento archivado', 'success');
    await refreshCalendar_();
  }

  async function onCalendarSeed_() {
    const btn = $('btnCalendarSeed');
    const year = (App.calendarMonth || new Date()).getFullYear();
    if (!confirm(`Se cargarán las temporadas de Musicala para ${year} (inicio de año, Semana Santa, mitad de año, preuniversitario, receso de octubre y fin de año). Las que ya existan no se duplican. ¿Continuar?`)) return;
    setButtonLoading(btn, true, 'Cargando...');
    try {
      const res = await safeCall_(() => API.seedCalendarDefaults(year));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudieron cargar las temporadas', 'error');
        return;
      }
      const count = res.created?.length || 0;
      UIx.toast(count ? `${count} temporadas agregadas` : 'Las temporadas de este año ya estaban cargadas', 'success');
      await refreshCalendar_();
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
        if (view === 'leads') await refreshLeads_();
        if (view === 'services') await refreshServices_();
        if (view === 'funnel') await refreshFunnel_();
        if (view === 'budget') await refreshBudget_();
        if (view === 'calendar') await refreshCalendar_();
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

  // ---------- LEADS ----------
  function fillLeadCampaignSelects_() {
    const campaigns = App.campaigns || [];
    const form = $('leadCampaign');
    if (form) {
      const current = form.value;
      form.innerHTML = '<option value="">Sin campaña / directo</option>';
      campaigns.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.campaign_id || '';
        opt.textContent = `${c.nombre || c.campaign_id || ''}${c.canal ? ` - ${c.canal}` : ''}`;
        form.appendChild(opt);
      });
      form.value = current;
    }
    ['leadFilterCampaign', 'funnelFilterCampaign'].forEach(id => {
      const filter = $(id);
      if (!filter) return;
      const current = filter.value;
      filter.innerHTML = '<option value="">Todas</option>';
      campaigns.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.campaign_id || '';
        opt.textContent = c.nombre || c.campaign_id || '';
        filter.appendChild(opt);
      });
      filter.value = current;
    });
  }

  function fillLeadOptionSelect_(id, list, placeholder) {
    const sel = $(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>`;
    (list || []).forEach(value => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      sel.appendChild(opt);
    });
    // Conserva valores antiguos que ya no esten en la lista.
    if (current && !Array.from(sel.options).some(o => o.value === current)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current;
      sel.appendChild(opt);
    }
    sel.value = current;
  }

  function populateLeadSelects_() {
    const opts = App.options || FALLBACK_OPTIONS;
    fillLeadOptionSelect_('leadPlatform', opts.canales, 'Selecciona...');
    fillLeadOptionSelect_('leadService', opts.servicios, 'Selecciona...');
    fillLeadOptionSelect_('leadOfferType', opts.tiposOferta, 'Selecciona...');
    fillLeadOptionSelect_('leadFilterPlatform', opts.canales, 'Todas');
    fillLeadOptionSelect_('leadFilterService', opts.servicios, 'Todos');
    fillLeadOptionSelect_('leadFilterOfferType', opts.tiposOferta, 'Todos');
    fillLeadOptionSelect_('funnelFilterPlatform', opts.canales, 'Todas');
    fillLeadOptionSelect_('funnelFilterService', opts.servicios, 'Todos');
    fillLeadOptionSelect_('funnelFilterOfferType', opts.tiposOferta, 'Todos');
  }

  function wireLeads_() {
    const form = $('leadForm');
    if (form) form.addEventListener('submit', onSubmitLead_);
    const dateEl = $('leadDate');
    if (dateEl && !dateEl.value) dateEl.value = toISODate(new Date());

    ['leadFilterCampaign', 'leadFilterPlatform', 'leadFilterService', 'leadFilterOfferType', 'leadFilterStatus'].forEach(id => {
      const el = $(id);
      if (el) el.addEventListener('change', renderLeadsTable_);
    });
    const resp = $('leadFilterResponsible');
    if (resp) resp.addEventListener('input', renderLeadsTable_);
    const clear = $('leadFilterClear');
    if (clear) clear.addEventListener('click', () => {
      ['leadFilterCampaign', 'leadFilterPlatform', 'leadFilterService', 'leadFilterOfferType', 'leadFilterStatus', 'leadFilterResponsible'].forEach(id => {
        const el = $(id);
        if (el) el.value = '';
      });
      renderLeadsTable_();
    });
    const cancel = $('leadCancelEditBtn');
    if (cancel) cancel.addEventListener('click', resetLeadForm_);
  }

  function readLeadForm_() {
    return {
      date: $('leadDate')?.value || '',
      campaign_id: $('leadCampaign')?.value || '',
      platform: strForm_('leadPlatform'),
      name: strForm_('leadName'),
      contact: strForm_('leadContact'),
      service: strForm_('leadService'),
      offerType: strForm_('leadOfferType'),
      profile: strForm_('leadProfile'),
      status: strForm_('leadStatus'),
      lossReason: strForm_('leadLossReason'),
      responsible: strForm_('leadResponsible'),
      nextAction: strForm_('leadNextAction'),
      nextContactDate: $('leadNextContactDate')?.value || '',
      paidValue: parseNum($('leadPaidValue')?.value),
      notes: strForm_('leadNotes'),
    };
  }

  async function onSubmitLead_(ev) {
    ev.preventDefault();
    const btn = $('leadSaveBtn') || ev.submitter;
    const payload = readLeadForm_();
    if (!payload.date) {
      UIx.toast('Selecciona una fecha', 'warning');
      return;
    }
    const editingId = App.editingLead;
    setButtonLoading(btn, true, 'Guardando...');
    try {
      const res = editingId
        ? await safeCall_(() => API.updateLead(editingId, payload))
        : await safeCall_(() => API.addLead(payload));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo guardar el lead', 'error');
        return;
      }
      UIx.toast(editingId ? 'Lead actualizado' : 'Lead guardado', 'success');
      resetLeadForm_();
      await refreshLeads_();
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function resetLeadForm_() {
    App.editingLead = null;
    $('leadForm')?.reset();
    if ($('leadDate')) $('leadDate').value = toISODate(new Date());
    const cancel = $('leadCancelEditBtn');
    if (cancel) cancel.hidden = true;
    const btn = $('leadSaveBtn');
    if (btn) btn.textContent = 'Guardar lead';
  }

  function startLeadEdit_(id) {
    const lead = (App.leads || []).find(l => String(l.id) === String(id));
    if (!lead) return;
    App.editingLead = lead.id;
    if ($('leadDate')) $('leadDate').value = lead.date || '';
    setLeadSelectValue_('leadCampaign', lead.campaign_id);
    setLeadSelectValue_('leadPlatform', lead.platform);
    if ($('leadName')) $('leadName').value = lead.name || '';
    if ($('leadContact')) $('leadContact').value = lead.contact || '';
    setLeadSelectValue_('leadService', lead.service);
    setLeadSelectValue_('leadOfferType', lead.offerType);
    setLeadSelectValue_('leadProfile', lead.profile);
    setLeadSelectValue_('leadStatus', lead.status);
    setLeadSelectValue_('leadLossReason', lead.lossReason);
    if ($('leadResponsible')) $('leadResponsible').value = lead.responsible || '';
    if ($('leadNextAction')) $('leadNextAction').value = lead.nextAction || '';
    if ($('leadNextContactDate')) $('leadNextContactDate').value = lead.nextContactDate || '';
    if ($('leadPaidValue')) $('leadPaidValue').value = lead.paidValue || '';
    if ($('leadNotes')) $('leadNotes').value = lead.notes || '';
    const cancel = $('leadCancelEditBtn');
    if (cancel) cancel.hidden = false;
    const btn = $('leadSaveBtn');
    if (btn) btn.textContent = 'Actualizar lead';
    document.getElementById('leadForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setLeadSelectValue_(id, value) {
    const sel = $(id);
    if (!sel) return;
    const v = String(value || '');
    if (v && !Array.from(sel.options).some(o => o.value === v)) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      sel.appendChild(opt);
    }
    sel.value = v;
  }

  function getLeadFilters_() {
    return {
      campaign_id: $('leadFilterCampaign')?.value || '',
      platform: $('leadFilterPlatform')?.value || '',
      service: $('leadFilterService')?.value || '',
      offerType: $('leadFilterOfferType')?.value || '',
      status: $('leadFilterStatus')?.value || '',
      responsible: $('leadFilterResponsible')?.value || '',
    };
  }

  async function refreshLeads_() {
    if (!API?.listLeads) return;
    const res = await safeCall_(() => API.listLeads());
    if (!res?.ok) {
      UIx.toast(res?.error || 'No se pudieron cargar los leads', 'error');
      return;
    }
    App.leads = res.rows || [];
    fillLeadCampaignSelects_();
    renderLeadsTable_();
  }

  function renderLeadsTable_() {
    const host = $('leadsTable');
    if (!host) return;
    const f = getLeadFilters_();
    const resp = f.responsible.toLowerCase();
    const rows = (App.leads || []).filter(l => {
      if (f.campaign_id && l.campaign_id !== f.campaign_id) return false;
      if (f.platform && l.platform !== f.platform) return false;
      if (f.service && l.service !== f.service) return false;
      if (f.offerType && l.offerType !== f.offerType) return false;
      if (f.status && l.status !== f.status) return false;
      if (resp && !String(l.responsible || '').toLowerCase().includes(resp)) return false;
      return true;
    });

    if (!rows.length) {
      host.innerHTML = '<p class="muted">No hay leads con estos filtros. Registra el primero en el formulario de la izquierda.</p>';
      return;
    }

    const nameFor = (id) => {
      const c = (App.campaigns || []).find(x => String(x.campaign_id) === String(id));
      return c ? (c.nombre || c.campaign_id) : (id ? '(campaña eliminada)' : 'Directo');
    };

    const body = rows.map(l => `
      <tr>
        <td>${formatShortDate_(l.date)}</td>
        <td>
          <div style="font-weight:600">${escapeHtml(l.name || 'Sin nombre')}</div>
          ${l.contact ? `<div class="muted" style="font-size:12px">${escapeHtml(l.contact)}</div>` : ''}
          ${l.profile ? `<div class="muted" style="font-size:12px">${escapeHtml(l.profile)}</div>` : ''}
        </td>
        <td>
          <div>${escapeHtml(nameFor(l.campaign_id))}</div>
          ${l.platform ? `<div class="muted" style="font-size:12px">${escapeHtml(l.platform)}</div>` : ''}
          ${l.sourceLabel ? `<div class="muted" style="font-size:12px">${escapeHtml(l.sourceLabel)}</div>` : ''}
        </td>
        <td>
          <div>${escapeHtml(l.service || '-')}</div>
          ${l.offerType ? `<div class="muted" style="font-size:12px">${escapeHtml(l.offerType)}</div>` : ''}
        </td>
        <td>
          <span class="lead-status">${escapeHtml(l.status || 'Lead nuevo')}</span>
          ${l.status === 'Perdido' && l.lossReason ? `<div class="muted" style="font-size:12px">${escapeHtml(l.lossReason)}</div>` : ''}
          ${l.activeStatus ? `<div class="muted" style="font-size:12px">Estado actual: ${escapeHtml(l.activeStatus)}</div>` : ''}
        </td>
        <td>
          ${l.nextAction ? escapeHtml(l.nextAction) : '<span class="muted">-</span>'}
          ${l.nextContactDate ? `<div class="muted" style="font-size:12px">${formatShortDate_(l.nextContactDate)}</div>` : ''}
        </td>
        <td style="text-align:right">${parseNum(l.paidValue) > 0 ? moneyCOP(l.paidValue) : '<span class="muted">-</span>'}</td>
        <td style="text-align:right">${l.readOnly
          ? '<span class="integration-source-badge">Automático</span>'
          : `<button class="btn-mini" data-action="edit-lead" data-id="${escapeHtml(l.id)}">Editar</button>`}</td>
      </tr>
    `).join('');

    host.innerHTML = `
      <div class="lead-summary muted">${rows.length} lead(s)</div>
      <table class="data-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Contacto</th>
            <th>Campaña / plataforma</th>
            <th>Servicio / oferta</th>
            <th>Estado</th>
            <th>Próxima acción</th>
            <th style="text-align:right">Valor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    `;

    host.querySelectorAll('button[data-action="edit-lead"]').forEach(btn => {
      btn.addEventListener('click', () => startLeadEdit_(btn.getAttribute('data-id') || ''));
    });
  }

  // ---------- VISTAS ESTRATEGICAS (Servicios / Embudo / Presupuesto) ----------
  const LEAD_STAGE_ORDER = ['Lead nuevo', 'Contactado', 'Respondió', 'Calificado', 'Clase de prueba agendada', 'Asistió a prueba', 'Matrícula', 'Pagó'];
  const FUNNEL_STEPS = [
    { label: 'Leads', min: 0 },
    { label: 'Contactados', min: 1 },
    { label: 'Calificados', min: 3 },
    { label: 'Prueba agendada', min: 4 },
    { label: 'Asistió a prueba', min: 5 },
    { label: 'Matrículas', min: 6 },
    { label: 'Pagos', min: 7 },
  ];

  function leadStageIndex_(status) {
    if (String(status || '') === 'Perdido') return 0;
    const i = LEAD_STAGE_ORDER.indexOf(String(status || ''));
    return i < 0 ? 0 : i;
  }

  function pctText_(part, whole) {
    const w = parseNum(whole);
    if (!w) return 'no medible';
    return `${Math.round((parseNum(part) / w) * 100)}%`;
  }

  function wireStrategicViews_() {
    const funnelInputs = ['funnelFilterCampaign', 'funnelFilterPlatform', 'funnelFilterService', 'funnelFilterOfferType', 'funnelFilterFrom', 'funnelFilterTo'];
    funnelInputs.forEach(id => {
      const el = $(id);
      if (el) el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', renderFunnel_);
    });
    const clr = $('funnelFilterClear');
    if (clr) clr.addEventListener('click', () => {
      funnelInputs.forEach(id => { const el = $(id); if (el) el.value = ''; });
      renderFunnel_();
    });
    const saveDist = $('budgetDistributionSave');
    if (saveDist) saveDist.addEventListener('click', onSaveBudgetDistribution_);
  }

  // ----- SERVICIOS -----
  async function refreshServices_() {
    const leadsRes = API?.listLeads ? await safeCall_(() => API.listLeads()) : null;
    if (leadsRes?.ok) App.leads = leadsRes.rows || [];
    const dash = API?.dashboard ? await safeCall_(() => API.dashboard({})) : null;
    const rows = dash?.ok ? (dash.rows || []) : [];
    renderServices_(App.leads || [], App.campaigns || [], rows);
  }

  function renderServices_(leads, campaigns, dashRows) {
    const host = $('servicesTable');
    if (!host) return;

    const spendByCampaign = new Map(dashRows.map(r => [String(r.campaign_id || r.id || ''), parseNum(r.spend)]));
    const map = new Map();
    const ensure = (name) => {
      const key = name || 'Sin clasificar';
      if (!map.has(key)) map.set(key, { service: key, leads: 0, contacts: 0, qualified: 0, trials: 0, enrollments: 0, paid: 0, revenue: 0, spend: 0, byCampaign: new Map(), byPlatform: new Map() });
      return map.get(key);
    };
    const bump = (m, k) => { if (k) m.set(k, (m.get(k) || 0) + 1); };

    leads.forEach(l => {
      const s = ensure(l.service);
      const idx = leadStageIndex_(l.status);
      s.leads += 1;
      if (idx >= 1) s.contacts += 1;
      if (idx >= 3) s.qualified += 1;
      if (idx >= 4) s.trials += 1;
      if (idx >= 6) s.enrollments += 1;
      if (idx >= 7) s.paid += 1;
      s.revenue += parseNum(l.paidValue);
      bump(s.byCampaign, l.campaign_id);
      bump(s.byPlatform, l.platform);
    });

    campaigns.forEach(c => {
      if (!c.servicio) return;
      const s = ensure(c.servicio);
      s.spend += spendByCampaign.get(String(c.campaign_id)) || 0;
    });

    const stats = Array.from(map.values()).sort((a, b) => b.leads - a.leads || b.spend - a.spend);
    if (!stats.length) {
      host.innerHTML = '<div class="insight-alert warning">Faltan datos: aún no hay leads registrados ni campañas clasificadas por servicio.</div>';
      return;
    }

    const nameFor = (id) => {
      const c = (campaigns || []).find(x => String(x.campaign_id) === String(id));
      return c ? (c.nombre || c.campaign_id) : id;
    };
    const topOf = (m, resolver) => {
      let best = '', bestN = 0;
      for (const [k, n] of m.entries()) { if (n > bestN) { bestN = n; best = k; } }
      return best ? (resolver ? resolver(best) : best) : '-';
    };

    const body = stats.map(s => {
      const cpe = s.spend > 0 && s.enrollments > 0 ? moneyCOP(s.spend / s.enrollments) : '<span class="muted">no medible</span>';
      const topSrc = s.byCampaign.size ? topOf(s.byCampaign, nameFor) : topOf(s.byPlatform);
      return `
        <tr>
          <td style="font-weight:600">${escapeHtml(s.service)}</td>
          <td style="text-align:right">${intFmt(s.leads)}</td>
          <td style="text-align:right">${intFmt(s.contacts)}</td>
          <td style="text-align:right">${intFmt(s.qualified)}</td>
          <td style="text-align:right">${intFmt(s.trials)}</td>
          <td style="text-align:right">${intFmt(s.enrollments)}</td>
          <td style="text-align:right">${s.revenue > 0 ? moneyCOP(s.revenue) : '<span class="muted">-</span>'}</td>
          <td style="text-align:right">${s.spend > 0 ? moneyCOP(s.spend) : '<span class="muted">-</span>'}</td>
          <td style="text-align:right">${cpe}</td>
          <td>${escapeHtml(topSrc)}</td>
        </tr>
      `;
    }).join('');

    host.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Servicio</th>
            <th style="text-align:right">Leads</th>
            <th style="text-align:right">Contactos</th>
            <th style="text-align:right">Calificados</th>
            <th style="text-align:right">Pruebas</th>
            <th style="text-align:right">Matrículas</th>
            <th style="text-align:right">Ingreso</th>
            <th style="text-align:right">Gasto</th>
            <th style="text-align:right">Costo/matrícula</th>
            <th>Más lo trae</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <p class="form-help">Contactos = leads que respondieron o avanzaron. "No medible" aparece cuando falta gasto o matrículas para el cálculo.</p>
    `;
  }

  // ----- EMBUDO -----
  async function refreshFunnel_() {
    if (API?.listLeads) {
      const res = await safeCall_(() => API.listLeads());
      if (res?.ok) App.leads = res.rows || [];
    }
    renderFunnel_();
  }

  function renderFunnel_() {
    const host = $('funnelStages');
    if (!host) return;
    const f = {
      campaign: $('funnelFilterCampaign')?.value || '',
      platform: $('funnelFilterPlatform')?.value || '',
      service: $('funnelFilterService')?.value || '',
      offer: $('funnelFilterOfferType')?.value || '',
      from: $('funnelFilterFrom')?.value || '',
      to: $('funnelFilterTo')?.value || '',
    };
    const leads = (App.leads || []).filter(l => {
      if (f.campaign && l.campaign_id !== f.campaign) return false;
      if (f.platform && l.platform !== f.platform) return false;
      if (f.service && l.service !== f.service) return false;
      if (f.offer && l.offerType !== f.offer) return false;
      if (f.from && String(l.date) < f.from) return false;
      if (f.to && String(l.date) > f.to) return false;
      return true;
    });

    if (!leads.length) {
      host.innerHTML = '<div class="insight-alert warning">Faltan datos: no hay leads que cumplan estos filtros. Registra leads en la pestaña Leads o ajusta los filtros.</div>';
      return;
    }

    const counts = FUNNEL_STEPS.map(s => leads.filter(l => leadStageIndex_(l.status) >= s.min).length);
    const top = counts[0] || 1;
    const rows = FUNNEL_STEPS.map((s, i) => {
      const width = Math.max(2, Math.round((counts[i] / top) * 100));
      const conv = i === 0 ? '' : `<span class="funnel-rate">${pctText_(counts[i], counts[i - 1])} desde ${FUNNEL_STEPS[i - 1].label.toLowerCase()}</span>`;
      return `
        <div class="funnel-row">
          <div class="funnel-label">${escapeHtml(s.label)}</div>
          <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${width}%"></div></div>
          <div class="funnel-value">${intFmt(counts[i])} ${conv}</div>
        </div>
      `;
    }).join('');

    host.innerHTML = `
      <div class="funnel-chart">${rows}</div>
      <p class="form-help">Cada etapa cuenta los leads que alcanzaron ese punto o más. Los leads marcados "Perdido" cuentan solo como lead.</p>
    `;
  }

  // ----- PRESUPUESTO -----
  async function refreshBudget_() {
    // El simulador debe poder usarse aun mientras Firebase carga o sin datos guardados.
    if (!Array.isArray(App.budgetDistribution) || !App.budgetDistribution.length) {
      App.budgetDistribution = DEFAULT_BUDGET_DISTRIBUTION_.map(x => ({ ...x }));
      App.budgetPlannerTotal = App.budgetDistribution.reduce((acc, x) => acc + parseNum(x.amount), 0);
    }
    drawBudgetDistribution_();
    const now = new Date();
    const from = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
    const to = toISODate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
    const dash = API?.dashboard ? await safeCall_(() => API.dashboard({ from, to })) : null;
    const settingsRes = API?.getMarketingSettings ? await safeCall_(() => API.getMarketingSettings()) : null;
    const d = dash?.ok ? dash : { totals: {}, rows: [] };
    const settings = settingsRes?.ok ? (settingsRes.settings || {}) : {};
    renderBudgetSummary_(d.totals || {});
    renderBudgetRisks_(d.rows || [], d.totals || {}, settings);
    renderBudgetDistribution_(settings);
  }

  function renderBudgetSummary_(totals) {
    const host = $('budgetSummary');
    if (!host) return;
    const max = parseNum(totals.global_max_budget) || parseNum(totals.budget_monthly_target);
    const spend = parseNum(totals.spend);
    const remaining = Math.max(0, max - spend);
    const pct = max ? Math.round((spend / max) * 100) : 0;
    host.innerHTML = `
      <div class="kpi-grid">
        <div class="kpi-item"><span>Presupuesto máximo mensual</span><strong>${max ? moneyCOP(max) : '<span class="muted">sin definir</span>'}</strong></div>
        <div class="kpi-item"><span>Inversión registrada</span><strong>${moneyCOP(spend)}</strong></div>
        <div class="kpi-item"><span>Presupuesto restante</span><strong>${max ? moneyCOP(remaining) : 'no medible'}</strong></div>
        <div class="kpi-item"><span>Porcentaje usado</span><strong>${max ? pct + '%' : 'no medible'}</strong></div>
      </div>
      ${!max ? '<div class="insight-alert info">Define el presupuesto máximo mensual en Configuración o desde el control de presupuesto del Dashboard.</div>' : ''}
      ${max && pct >= 100 ? '<div class="insight-alert danger">El gasto supera el presupuesto máximo mensual.</div>' : ''}
      ${max && pct >= 80 && pct < 100 ? '<div class="insight-alert warning">El gasto ya supera el 80% del presupuesto mensual.</div>' : ''}
    `;
  }

  function renderBudgetRisks_(rows, totals, settings) {
    const host = $('budgetRisks');
    if (!host) return;
    const max = parseNum(totals.global_max_budget) || parseNum(totals.budget_monthly_target);
    const cplTarget = parseNum(settings.defaultCplTarget) || 4500;
    const nameFor = (r) => escapeHtml(r.nombre || r.name || r.campaign_id || '');

    const groups = [];
    const overShare = rows.filter(r => max > 0 && parseNum(r.spend) / max > 0.4);
    if (overShare.length) groups.push(['danger', 'Superan el 40% del presupuesto mensual', overShare.map(r => `${nameFor(r)} — ${moneyCOP(r.spend)} (${Math.round(parseNum(r.spend) / max * 100)}%)`)]);

    const spendNoReality = rows.filter(r => parseNum(r.spend) > 0 && parseNum(r.real_new_contacts) === 0 && parseNum(r.real_enrollments) === 0);
    if (spendNoReality.length) groups.push(['warning', 'Con gasto pero sin realidad comercial', spendNoReality.map(r => `${nameFor(r)} — ${moneyCOP(r.spend)}`)]);

    const leadsNoEnroll = rows.filter(r => parseNum(r.leads) >= 10 && parseNum(r.real_enrollments) === 0);
    if (leadsNoEnroll.length) groups.push(['warning', 'Muchos leads pero sin matrículas', leadsNoEnroll.map(r => `${nameFor(r)} — ${intFmt(r.leads)} leads`)]);

    const lowCplNoTracking = rows.filter(r => parseNum(r.cpl) > 0 && parseNum(r.cpl) <= cplTarget && parseNum(r.real_new_contacts) === 0);
    if (lowCplNoTracking.length) groups.push(['info', 'CPL bajo pero sin seguimiento real', lowCplNoTracking.map(r => `${nameFor(r)} — CPL ${moneyCOP(r.cpl)}`)]);

    if (!groups.length) {
      host.innerHTML = '<p class="muted">Sin alertas de presupuesto con los datos actuales.</p>';
      return;
    }
    host.innerHTML = groups.map(([tone, title, items]) => `
      <div class="insight-alert ${tone}">
        <strong>${escapeHtml(title)}</strong>
        <ul class="risk-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>
      </div>
    `).join('');
  }

  function renderBudgetDistribution_(settings) {
    const host = $('budgetDistribution');
    if (!host) return;
    const stored = Array.isArray(settings.budgetDistribution) && settings.budgetDistribution.length ? settings.budgetDistribution : null;
    const source = stored || DEFAULT_BUDGET_DISTRIBUTION_;
    const sourceTotal = source.reduce((acc, x) => acc + parseNum(x.amount), 0) || 3000000;
    App.budgetPlannerTotal = parseNum(App.budgetPlannerTotal) || sourceTotal;
    App.budgetDistribution = source.map(x => {
      const amount = parseNum(x.amount);
      const hasPercent = x.percent !== undefined && x.percent !== null && String(x.percent) !== '';
      const percent = hasPercent ? Math.max(0, parseNum(x.percent)) : (sourceTotal ? (amount / sourceTotal) * 100 : 0);
      return {
        label: String(x.label || ''),
        percent,
        amount: App.budgetPlannerTotal ? App.budgetPlannerTotal * percent / 100 : amount,
      };
    });
    drawBudgetDistribution_();
  }

  const DEFAULT_BUDGET_DISTRIBUTION_ = [
    { label: 'Meta general Musicala', amount: 900000 },
    { label: 'Google búsqueda específica o controlada', amount: 750000 },
    { label: 'Meta talleres / temporada', amount: 600000 },
    { label: 'Remarketing / rescate', amount: 300000 },
    { label: 'Bolsa de prueba', amount: 300000 },
    { label: 'Reserva de optimización', amount: 150000 },
  ];

  function drawBudgetDistribution_() {
    const host = $('budgetDistribution');
    if (!host) return;
    const plannedTotal = Math.max(0, parseNum(App.budgetPlannerTotal));
    const list = (App.budgetDistribution || [])
      .map(x => {
        const amount = Math.max(0, parseNum(x.amount));
        const hasPercent = x.percent !== undefined && x.percent !== null && String(x.percent) !== '';
        const percent = hasPercent ? Math.max(0, parseNum(x.percent)) : (plannedTotal ? amount / plannedTotal * 100 : 0);
        return { label: String(x.label || ''), percent, amount };
      })
      .sort((a, b) => parseNum(b.amount) - parseNum(a.amount));
    App.budgetDistribution = list;
    const allocated = list.reduce((acc, x) => acc + parseNum(x.amount), 0);
    const allocatedPct = plannedTotal ? (allocated / plannedTotal) * 100 : 0;
    const difference = plannedTotal - allocated;
    const averageMonthly = allocated;
    const palette = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#64748b'];
    const segments = list.map((x, i) => {
      const pct = plannedTotal ? Math.max(0, parseNum(x.amount) / plannedTotal * 100) : 0;
      return `<span class="budget-allocation-segment" style="width:${Math.min(pct, 100)}%;background:${palette[i % palette.length]}" title="${escapeHtml(x.label || 'Sin nombre')}: ${pct.toFixed(1)}%"></span>`;
    }).join('');
    const rows = list.map((x, i) => `
      <tr>
        <td><span class="budget-allocation-dot" style="background:${palette[i % palette.length]}"></span><input type="text" class="dist-label" data-index="${i}" value="${escapeHtml(x.label)}" placeholder="Ej: Meta Ads" /></td>
        <td><div class="budget-percent-input"><input type="number" class="dist-percent" data-index="${i}" min="0" step="0.1" value="${parseNum(x.percent).toFixed(1)}" /><span>%</span></div></td>
        <td><div class="budget-money-input"><span>$</span><input type="number" class="dist-amount" data-index="${i}" min="0" step="1000" value="${parseNum(x.amount)}" /></div></td>
        <td style="text-align:right"><button type="button" class="btn-mini danger dist-remove" data-index="${i}">Quitar</button></td>
      </tr>
    `).join('');
    host.innerHTML = `
      <div class="budget-planner-head">
        <label>Presupuesto que quieres repartir
          <div class="budget-total-input"><span>$</span><input id="budgetPlannerTotal" type="number" min="0" step="1000" value="${plannedTotal}" /></div>
        </label>
        <div class="budget-planner-kpis">
          <div><span>Asignado</span><strong>${moneyCOP(allocated)}</strong></div>
          <div><span>Distribuido</span><strong>${allocatedPct.toFixed(1)}%</strong></div>
          <div><span>Promedio mensual</span><strong>${moneyCOP(averageMonthly)}</strong></div>
          <div class="${difference < 0 ? 'is-over' : difference > 0 ? 'is-pending' : 'is-complete'}"><span>${difference < 0 ? 'Excedente' : 'Por asignar'}</span><strong>${moneyCOP(Math.abs(difference))}</strong></div>
        </div>
      </div>
      <div class="budget-allocation-track" aria-label="Distribución visual del presupuesto">${segments}</div>
      <div class="budget-allocation-status ${difference < 0 ? 'is-over' : difference > 0 ? 'is-pending' : 'is-complete'}">
        ${difference < 0 ? `Te pasaste ${Math.abs(100 - allocatedPct).toFixed(1)}% del presupuesto de prueba.` : difference > 0 ? `Todavía puedes repartir ${moneyCOP(difference)} (${Math.max(0, 100 - allocatedPct).toFixed(1)}%).` : 'Listo: repartiste el 100% del presupuesto.'}
      </div>
      <div class="table-wrap budget-distribution-table"><table class="data-table">
        <thead><tr><th>Destino <span class="muted">/ mayor gasto primero</span></th><th>Porcentaje</th><th>Dinero</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><th>Total asignado</th><th>${allocatedPct.toFixed(1)}%</th><th>${moneyCOP(allocated)}</th><th></th></tr></tfoot>
      </table></div>
      <button type="button" class="btn-mini dist-add">+ Agregar concepto</button>
    `;

    let redrawTimer = null;
    const scheduleRedraw = () => {
      clearTimeout(redrawTimer);
      redrawTimer = setTimeout(() => drawBudgetDistribution_(), 280);
    };
    $('budgetPlannerTotal')?.addEventListener('input', (event) => {
      const nextTotal = Math.max(0, parseNum(event.target.value));
      App.budgetPlannerTotal = nextTotal;
      App.budgetDistribution = (App.budgetDistribution || []).map(item => ({
        ...item,
        amount: nextTotal * Math.max(0, parseNum(item.percent)) / 100,
      }));
      scheduleRedraw();
    });
    host.querySelectorAll('.dist-label').forEach(el => el.addEventListener('input', () => {
      App.budgetDistribution[Number(el.dataset.index)].label = el.value;
    }));
    host.querySelectorAll('.dist-percent').forEach(el => el.addEventListener('input', () => {
      const percent = Math.max(0, parseNum(el.value));
      App.budgetDistribution[Number(el.dataset.index)].percent = percent;
      App.budgetDistribution[Number(el.dataset.index)].amount = Math.max(0, parseNum(App.budgetPlannerTotal)) * percent / 100;
      scheduleRedraw();
    }));
    host.querySelectorAll('.dist-amount').forEach(el => el.addEventListener('input', () => {
      const amount = Math.max(0, parseNum(el.value));
      const total = Math.max(0, parseNum(App.budgetPlannerTotal));
      App.budgetDistribution[Number(el.dataset.index)].amount = amount;
      App.budgetDistribution[Number(el.dataset.index)].percent = total ? amount / total * 100 : 0;
      scheduleRedraw();
    }));
    host.querySelectorAll('.dist-remove').forEach(el => el.addEventListener('click', () => {
      App.budgetDistribution.splice(Number(el.dataset.index), 1);
      drawBudgetDistribution_();
    }));
    host.querySelector('.dist-add')?.addEventListener('click', () => {
      App.budgetDistribution.push({ label: '', percent: 0, amount: 0 });
      drawBudgetDistribution_();
    });
  }

  async function onSaveBudgetDistribution_() {
    const btn = $('budgetDistributionSave');
    if (!API?.saveBudgetDistribution) {
      UIx.toast('No se pudo guardar: API no disponible', 'error');
      return;
    }
    setButtonLoading(btn, true, 'Guardando...');
    try {
      const res = await safeCall_(() => API.saveBudgetDistribution(App.budgetDistribution || []));
      if (!res?.ok) {
        UIx.toast(res?.error || 'No se pudo guardar la distribución', 'error');
        return;
      }
      UIx.toast('Distribución guardada', 'success');
    } finally {
      setButtonLoading(btn, false);
    }
  }

  // ----- DASHBOARD ESTRATEGICO (ideas, demanda, datos incompletos) -----
  async function renderStrategicDashboard_(res) {
    const rows = res?.rows || [];
    const totals = res?.totals || {};
    if (API?.listLeads) {
      const r = await safeCall_(() => API.listLeads());
      if (r?.ok) App.leads = r.rows || [];
    }
    const leads = App.leads || [];
    renderDemandList_('demandByService', leads, 'service', 'Sin servicio clasificado');
    renderDemandList_('demandByOffer', leads, 'offerType', 'Sin tipo de oferta');
    renderIncompleteData_(rows, leads);
    renderUpcomingLeadActions_(leads);
    renderStrategicIdeas_(rows, leads, totals);
  }

  function countBy_(items, field) {
    const map = new Map();
    items.forEach(it => {
      const k = String(it[field] || '').trim();
      if (!k) return;
      map.set(k, (map.get(k) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }

  function renderDemandList_(hostId, leads, field, emptyLabel) {
    const host = $(hostId);
    if (!host) return;
    if (!leads.length) {
      host.innerHTML = '<p class="muted">Faltan datos: aún no hay leads registrados.</p>';
      return;
    }
    const ranked = countBy_(leads, field);
    const missing = leads.filter(l => !String(l[field] || '').trim()).length;
    if (!ranked.length) {
      host.innerHTML = `<p class="muted">${escapeHtml(emptyLabel)} en todos los leads.</p>`;
      return;
    }
    const top = ranked[0][1] || 1;
    host.innerHTML = `
      <div class="demand-list">
        ${ranked.slice(0, 6).map(([name, n]) => `
          <div class="demand-row">
            <span class="demand-name">${escapeHtml(name)}</span>
            <span class="demand-bar-wrap"><span class="demand-bar" style="width:${Math.max(4, Math.round(n / top * 100))}%"></span></span>
            <span class="demand-count">${intFmt(n)}</span>
          </div>
        `).join('')}
      </div>
      ${missing ? `<p class="form-help">${intFmt(missing)} lead(s) sin clasificar en este campo.</p>` : ''}
    `;
  }

  function renderIncompleteData_(rows, leads) {
    const host = $('incompleteData');
    if (!host) return;
    const items = [];

    const unclassified = rows.filter(r => !String(r.servicio || '').trim() || !String(r.tipo_oferta || '').trim());
    if (unclassified.length) items.push(['warning', `${intFmt(unclassified.length)} campaña(s) sin servicio o tipo de oferta`, unclassified.slice(0, 5).map(r => escapeHtml(r.nombre || r.name || r.campaign_id))]);

    const noBudget = rows.filter(r => !parseNum(r.monthly_budget_target) && !parseNum(r.presupuesto_mensual));
    if (noBudget.length) items.push(['info', `${intFmt(noBudget.length)} campaña(s) sin presupuesto máximo definido`, noBudget.slice(0, 5).map(r => escapeHtml(r.nombre || r.name || r.campaign_id))]);

    const leadsNoService = leads.filter(l => !String(l.service || '').trim()).length;
    if (leadsNoService) items.push(['warning', `Hay ${intFmt(leadsNoService)} lead(s) sin servicio clasificado`, []]);

    const leadsNoOffer = leads.filter(l => !String(l.offerType || '').trim()).length;
    if (leadsNoOffer) items.push(['info', `Hay ${intFmt(leadsNoOffer)} registro(s) sin tipo de oferta`, []]);

    const enrollNoCampaign = leads.filter(l => ['Matrícula', 'Pagó'].includes(l.status) && !String(l.campaign_id || '').trim()).length;
    if (enrollNoCampaign) items.push(['danger', `Hay ${intFmt(enrollNoCampaign)} matrícula(s) sin campaña origen`, []]);

    if (!items.length) {
      host.innerHTML = '<p class="muted">Todo clasificado. Sin brechas de medición detectadas.</p>';
      return;
    }
    host.innerHTML = items.map(([tone, title, list]) => `
      <div class="insight-alert ${tone}">
        <strong>${title}</strong>
        ${list.length ? `<ul class="risk-list">${list.map(i => `<li>${i}</li>`).join('')}</ul>` : ''}
      </div>
    `).join('');
  }

  function renderUpcomingLeadActions_(leads) {
    const host = $('upcomingLeadActions');
    if (!host) return;
    const today = toISODate(new Date());
    const pending = leads
      .filter(l => String(l.nextContactDate || '').trim() && !['Pagó', 'Perdido'].includes(l.status))
      .sort((a, b) => String(a.nextContactDate).localeCompare(String(b.nextContactDate)))
      .slice(0, 8);
    if (!pending.length) {
      host.innerHTML = '<p class="muted">No hay próximas acciones agendadas en leads.</p>';
      return;
    }
    const nameFor = (id) => {
      const c = (App.campaigns || []).find(x => String(x.campaign_id) === String(id));
      return c ? (c.nombre || c.campaign_id) : (id || 'Directo');
    };
    host.innerHTML = `
      <ul class="action-list">
        ${pending.map(l => {
          const overdue = String(l.nextContactDate) < today;
          return `<li class="${overdue ? 'action-overdue' : ''}">
            <strong>${formatShortDate_(l.nextContactDate)}</strong> · ${escapeHtml(l.name || 'Lead')} — ${escapeHtml(l.nextAction || 'Seguimiento')}
            <span class="muted">(${escapeHtml(nameFor(l.campaign_id))})</span>
            ${overdue ? '<span class="lead-status" style="background:#fee2e2">vencida</span>' : ''}
          </li>`;
        }).join('')}
      </ul>
    `;
  }

  function renderStrategicIdeas_(rows, leads, totals) {
    const host = $('strategicIdeas');
    if (!host) return;
    const ideas = [];
    const cplTarget = parseNum(App.dashboard?.settings?.defaultCplTarget) || 4500;

    // Servicios con mucha demanda -> anuncio especifico.
    countBy_(leads, 'service').filter(([, n]) => n >= 5).slice(0, 3).forEach(([svc, n]) => {
      ideas.push(['good', `"${svc}" tiene ${n} leads: considera un anuncio específico dentro de una campaña general.`]);
    });

    // Servicios con muchos leads pero pocas matriculas.
    const byService = new Map();
    leads.forEach(l => {
      const s = l.service || '';
      if (!s) return;
      const acc = byService.get(s) || { leads: 0, enroll: 0 };
      acc.leads += 1;
      if (['Matrícula', 'Pagó'].includes(l.status)) acc.enroll += 1;
      byService.set(s, acc);
    });
    for (const [svc, acc] of byService.entries()) {
      if (acc.leads >= 8 && acc.enroll === 0) ideas.push(['watch', `"${svc}" trae leads pero sin matrículas: revisa oferta, horarios, precio o seguimiento.`]);
    }

    // Campanas: bajo CPL sin realidad -> seguir midiendo.
    rows.filter(r => parseNum(r.cpl) > 0 && parseNum(r.cpl) <= cplTarget && parseNum(r.real_new_contacts) === 0)
      .slice(0, 3).forEach(r => ideas.push(['watch', `"${r.nombre || r.name || r.campaign_id}" tiene CPL bajo pero sin realidad comercial: sigue midiendo antes de escalar.`]));

    // Campanas: alto gasto y pocos leads -> pausar u optimizar.
    rows.filter(r => parseNum(r.spend) >= 30000 && parseNum(r.leads) < 3)
      .slice(0, 3).forEach(r => ideas.push(['bad', `"${r.nombre || r.name || r.campaign_id}" gasta con pocos leads: considera pausar u optimizar.`]));

    // Meta con bajo CPL -> usarla para generales/talleres.
    const metaRows = rows.filter(r => String(r.plataforma || r.canal || r.platform || '').toLowerCase().includes('meta'));
    const metaAvgCpl = avgCpl_(metaRows);
    if (metaAvgCpl > 0 && metaAvgCpl <= cplTarget) ideas.push(['good', 'Meta muestra CPL bajo: buena opción para campañas generales, talleres, temporada y marca.']);

    // Google presente -> usar para busquedas especificas.
    if (rows.some(r => String(r.plataforma || r.canal || r.platform || '').toLowerCase().includes('google'))) {
      ideas.push(['neutral', 'Google conviene enfocarlo a búsquedas específicas y evaluarlo por intención y calidad, no solo por CPL.']);
    }

    // Falta de datos para escalar.
    if (parseNum(totals.spend) > 0 && parseNum(totals.real_new_contacts) === 0) {
      ideas.push(['watch', 'No hay datos suficientes para decidir escalar: registra realidad comercial (contactos, pruebas, matrículas).']);
    }

    if (!ideas.length) {
      host.innerHTML = '<p class="muted">Sin sugerencias por ahora. A medida que registres leads y realidad comercial aparecerán ideas.</p>';
      return;
    }
    host.innerHTML = `
      <div class="quick-read-list">
        ${ideas.map(([tone, text]) => `<div class="quick-read-item ${tone}"><span>${escapeHtml(text)}</span></div>`).join('')}
      </div>
      <p class="form-help">Son sugerencias basadas en reglas, no decisiones absolutas.</p>
    `;
  }

  function avgCpl_(rows) {
    const valid = rows.filter(r => parseNum(r.cpl) > 0);
    if (!valid.length) return 0;
    return valid.reduce((acc, r) => acc + parseNum(r.cpl), 0) / valid.length;
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
