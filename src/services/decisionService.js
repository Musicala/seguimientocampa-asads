import { normalizeStatus } from "./campaignsService.js";

const DEFAULTS = {
  defaultCplTarget: 4500,
  defaultCostPerTrialTarget: 18000,
  defaultCostPerEnrollmentTarget: 70000,
  minimumLeadsToDecide: 15,
  minimumSpendToPause: 30000,
};

export function enrichCampaignDecision(row, settings = {}) {
  const cfg = { ...DEFAULTS, ...settings };
  const data = {
    ...row,
    spend: num(row.spend),
    leads: num(row.leads),
    clicks: num(row.link_clicks || row.clicks),
    sales: num(row.sales),
    revenue: num(row.revenue),
    cpl: num(row.cpl),
    real_new_contacts: num(row.real_new_contacts),
    real_qualified_leads: num(row.real_qualified_leads),
    real_trial_classes: num(row.real_trial_classes),
    real_enrollments: num(row.real_enrollments),
    real_revenue: num(row.real_revenue),
    real_roas: num(row.real_roas),
    cost_per_enrollment: num(row.cost_per_enrollment),
    cost_per_trial: num(row.cost_per_trial),
    status: normalizeStatus(row.status || row.estado),
  };

  const decision = chooseDecision(data, cfg);
  const alerts = campaignAlerts(data, cfg);
  const semaphore = semaphoreFor(decision.type);

  return { ...row, decision, alerts, semaphore };
}

export function buildDashboardInsights(rows = [], totals = {}, filters = {}, settings = {}) {
  const cfg = { ...DEFAULTS, ...settings };
  const activeRows = rows.filter((r) => normalizeStatus(r.status || r.estado) === "activa");
  const finishedRows = rows.filter((r) => normalizeStatus(r.status || r.estado) === "finalizada");
  const winnerRows = rows.filter((r) => ["scale", "reactivate"].includes(r.decision?.type));

  const alerts = [];
  if (!activeRows.length) {
    alerts.push(alert("danger", "No hay campanas activas", "Este mes no hay ninguna campana activa para alimentar el embudo."));
  }
  if (num(totals.budget_monthly_target) > 0 && num(totals.budget_used_pct) >= 0.8) {
    alerts.push(alert("warning", "Presupuesto cerca del limite", "El gasto ya esta sobre 80% del presupuesto mensual aprobado."));
  }

  const commercialAlerts = buildCommercialAlerts(rows, totals, cfg);
  const funnelLeaks = buildFunnelLeaks(totals);
  const budgetAlerts = buildBudgetAlerts(rows, totals);
  const todayActions = buildTodayActions(rows, cfg);

  return {
    alerts: [...alerts, ...commercialAlerts],
    commercialAlerts,
    funnelLeaks,
    budgetAlerts,
    todayActions,
    winners: winnerRows.sort((a, b) => decisionScore(b) - decisionScore(a)),
    finishedWinners: finishedRows.filter((r) => r.decision?.type === "reactivate").sort((a, b) => decisionScore(b) - decisionScore(a)),
    needsAttention: rows.filter((r) => ["pause", "optimize"].includes(r.decision?.type)).sort((a, b) => decisionRisk(b) - decisionRisk(a)),
    filteredPeriod: {
      from: filters.from || "",
      to: filters.to || "",
      platform: filters.platform || "",
      status: filters.status || "",
    },
  };
}

function chooseDecision(row, cfg) {
  const {
    status, spend, leads, clicks,
    real_new_contacts: contacts, real_qualified_leads: qualified,
    real_trial_classes: trials, real_enrollments: enrollments,
    real_revenue: realRevenue, real_roas: realRoas, cost_per_enrollment: cpe,
  } = row;
  const enrollTarget = num(cfg.defaultCostPerEnrollmentTarget);
  const minSpend = num(cfg.minimumSpendToPause);
  const minLeads = num(cfg.minimumLeadsToDecide);

  // REACTIVAR: campana finalizada con buenas senales comerciales reales.
  if (status === "finalizada" && (enrollments > 0 || realRevenue > 0 || (cpe > 0 && enrollTarget > 0 && cpe <= enrollTarget) || (trials > 0 && row.trial_to_enrollment_rate >= 0.3))) {
    return decision("reactivate", "Reactivar campana ganadora", "Campana finalizada con matriculas o ingreso real y buen costo por matricula.", "Crear una version nueva con presupuesto controlado durante 3 dias y vigilar la calidad de contactos.");
  }

  // ESCALAR: realidad comercial positiva.
  if (enrollments > 0 && realRoas >= 1) {
    return decision("scale", "Escalar", "Genera matriculas reales con ROAS real positivo.", "Subir presupuesto 15% por 3 dias y mantener el registro comercial al dia.");
  }
  if (enrollments > 0 && enrollTarget > 0 && cpe > 0 && cpe <= enrollTarget) {
    return decision("scale", "Escalar con cuidado", "Costo por matricula por debajo del objetivo.", "Aumentar presupuesto en pequeno porcentaje y vigilar que el costo por matricula se mantenga.");
  }
  if (qualified >= minLeads && row.qualified_to_trial_rate >= 0.4) {
    return decision("scale", "Escalar con cuidado", "Buen volumen de leads calificados y buena conversion a clase de prueba.", "Aumentar presupuesto gradualmente y sostener la velocidad de respuesta.");
  }

  // OPTIMIZAR: fugas en el embudo comercial.
  if (clicks > 0 && contacts === 0 && leads === 0) {
    return decision("optimize", "Optimizar captacion", "Hay clics pero no se convierten en contactos.", "Revisar oferta, segmentacion, landing y llamado a la accion.");
  }
  if (contacts > 0 && qualified === 0) {
    return decision("optimize", "Optimizar calificacion", "Llegan contactos pero ninguno se califica.", "Revisar guion de calificacion, velocidad de respuesta y filtros de publico.");
  }
  if (qualified > 0 && trials === 0) {
    return decision("optimize", "Optimizar agendamiento", "Hay leads calificados pero ninguno toma clase de prueba.", "Revisar el proceso de agendamiento, recordatorios y objeciones frecuentes.");
  }
  if (trials > 0 && enrollments === 0) {
    return decision("optimize", "Optimizar cierre", "Hay clases de prueba pero ninguna matricula.", "Revisar la experiencia de la clase de prueba, el seguimiento y la oferta de cierre.");
  }

  // PAUSAR: gasto significativo sin avance comercial.
  if (spend >= minSpend && contacts === 0 && leads === 0) {
    return decision("pause", "Pausar", "Gasto significativo sin contactos ni leads.", "No aumentar presupuesto hasta cambiar creatividad, segmentacion o configuracion.");
  }
  if (enrollments > 0 && enrollTarget > 0 && cpe > enrollTarget * 2) {
    return decision("pause", "Pausar o reformular", "Costo por matricula muy por encima del objetivo.", "Pausar y reformular oferta o publico antes de seguir gastando.");
  }

  // MEDIR VENTAS: hay leads pero falta realidad comercial.
  if (leads > 0 && contacts === 0 && qualified === 0 && enrollments === 0) {
    return decision("measure", "Medir ventas", "Hay leads/mensajes pero no hay realidad comercial registrada.", "Registrar contactos, clases de prueba, matriculas e ingreso real en Realidad Musicala.");
  }
  if (spend === 0 && leads === 0 && contacts === 0) {
    return decision("measure", "Completar datos", "Falta inversion o resultados para decidir.", "Registrar gasto y resultados del periodo.");
  }

  return decision("watch", "Seguir midiendo", "Hay datos, pero aun no son suficientes para una decision fuerte.", "Comparar contra otra campana similar o dejar correr unos dias mas.");
}

function campaignAlerts(row, cfg) {
  const alerts = [];
  if (row.spend >= num(cfg.minimumSpendToPause) && row.real_new_contacts === 0 && row.leads === 0) alerts.push(alert("danger", "Gasto sin contactos", "Revisar antes de invertir mas."));
  if (row.real_new_contacts > 0 && row.real_qualified_leads === 0) alerts.push(alert("warning", "Contactos sin calificar", "Revisar el guion de calificacion comercial."));
  if (row.real_qualified_leads > 0 && row.real_trial_classes === 0) alerts.push(alert("warning", "Leads sin clase de prueba", "Mejorar el agendamiento de clases de prueba."));
  if (row.real_trial_classes > 0 && row.real_enrollments === 0) alerts.push(alert("info", "Pruebas sin matricula", "Revisar el cierre comercial y la experiencia de la prueba."));
  if (row.leads > 0 && row.real_new_contacts === 0) alerts.push(alert("info", "Falta realidad comercial", "Registrar contactos reales para medir calidad."));
  if (!num(row.monthly_budget_target || row.presupuesto_mensual || row.budget)) alerts.push(alert("info", "Sin presupuesto maximo", "Definir techo ayuda a controlar gasto."));
  return alerts;
}

function buildCommercialAlerts(rows, totals, cfg) {
  const out = [];
  if (num(totals.spend) > 0 && num(totals.real_new_contacts) === 0) {
    out.push(alert("danger", "Hay gasto sin contactos reales", "Se esta invirtiendo pero no se registran contactos reales en Realidad Musicala."));
  }
  if (num(totals.real_new_contacts) > 0 && num(totals.real_qualified_leads) === 0) {
    out.push(alert("warning", "Contactos sin calificar", "Llegan contactos pero ninguno se ha calificado."));
  }
  if (num(totals.real_qualified_leads) > 0 && num(totals.real_trial_classes) === 0) {
    out.push(alert("warning", "Leads sin clases de prueba", "Hay leads calificados sin clases de prueba agendadas."));
  }
  if (num(totals.real_trial_classes) > 0 && num(totals.real_enrollments) === 0) {
    out.push(alert("warning", "Clases de prueba sin matriculas", "Se hicieron pruebas pero no se concreto ninguna matricula."));
  }
  if (num(totals.leads) > 0 && num(totals.real_new_contacts) === 0) {
    out.push(alert("info", "Falta registrar realidad comercial", "Hay leads en pauta pero no se ha registrado realidad comercial."));
  }
  rows.filter((r) => normalizeStatus(r.status || r.estado) === "finalizada" && num(r.real_enrollments) > 0).forEach((r) => {
    out.push(alert("info", "Campana finalizada con matriculas", `${r.nombre || r.name || r.campaign_id}: candidata a reactivacion.`));
  });
  return out;
}

function buildFunnelLeaks(totals) {
  const leaks = [];
  const steps = [
    ["Clics -> Contactos", num(totals.link_clicks || totals.clicks), num(totals.real_new_contacts)],
    ["Contactos -> Calificados", num(totals.real_new_contacts), num(totals.real_qualified_leads)],
    ["Calificados -> Clases de prueba", num(totals.real_qualified_leads), num(totals.real_trial_classes)],
    ["Clases de prueba -> Matriculas", num(totals.real_trial_classes), num(totals.real_enrollments)],
  ];
  steps.forEach(([label, from, to]) => {
    if (from > 0 && to === 0) {
      leaks.push({ step: label, from, to, rate: 0, severity: "high" });
    } else if (from > 0 && safeDiv(to, from) < 0.2) {
      leaks.push({ step: label, from, to, rate: safeDiv(to, from), severity: "medium" });
    }
  });
  return leaks;
}

function buildBudgetAlerts(rows, totals) {
  const out = [];
  if (num(totals.budget_monthly_target) > 0 && num(totals.budget_used_pct) >= 0.8) {
    out.push(alert("warning", "Presupuesto mensual sobre 80%", `Usado ${(num(totals.budget_used_pct) * 100).toFixed(0)}% del presupuesto.`));
  }
  rows.filter((r) => num(r.budget?.used_pct) >= 1).forEach((r) => {
    out.push(alert("danger", "Campana sobre presupuesto", `${r.nombre || r.name || r.campaign_id} supero su presupuesto maximo.`));
  });
  return out;
}

function buildTodayActions(rows, cfg) {
  const actions = [];
  rows.forEach((r) => {
    const d = r.decision;
    if (!d) return;
    const priority = ({ reactivate: "high", scale: "high", pause: "high", optimize: "medium", measure: "low" })[d.type];
    if (!priority) return;
    actions.push({
      priority,
      type: d.type,
      title: d.label,
      campaignId: r.campaign_id || r.id || "",
      campaignName: r.nombre || r.name || r.campaign_id || "",
      reason: d.reason,
      action: d.nextAction,
      metric: actionMetric(r, d.type),
    });
  });
  const order = { high: 0, medium: 1, low: 2 };
  return actions
    .sort((a, b) => (order[a.priority] - order[b.priority]) || (decisionScore(b) - decisionScore(a)))
    .slice(0, 5);
}

function actionMetric(r, type) {
  if (type === "scale" || type === "reactivate") {
    return `Matriculas: ${num(r.real_enrollments)} | Costo/matricula: ${fmtMoney(r.cost_per_enrollment)} | ROAS real: ${num(r.real_roas).toFixed(2)}`;
  }
  if (type === "pause") {
    return `Gasto: ${fmtMoney(r.spend)} | Contactos: ${num(r.real_new_contacts)} | Leads: ${num(r.leads)}`;
  }
  if (type === "optimize") {
    return `Contactos: ${num(r.real_new_contacts)} | Calificados: ${num(r.real_qualified_leads)} | Pruebas: ${num(r.real_trial_classes)} | Matriculas: ${num(r.real_enrollments)}`;
  }
  return `Leads: ${num(r.leads)} | Realidad registrada: ${num(r.real_new_contacts) > 0 ? "si" : "no"}`;
}

function semaphoreFor(type) {
  if (["scale", "reactivate"].includes(type)) return "green";
  if (["measure", "optimize"].includes(type)) return "yellow";
  if (type === "pause") return "red";
  return "gray";
}

function decision(type, label, reason, nextAction) {
  return { type, label, reason, nextAction };
}

function alert(tone, title, body) {
  return { tone, title, body };
}

function decisionScore(row) {
  return num(row.real_enrollments) * 1000000 + num(row.real_revenue) + num(row.sales) * 100000 + num(row.leads) * 100;
}

function decisionRisk(row) {
  return num(row.spend) - (num(row.real_enrollments) * 100000) - (num(row.real_new_contacts) * 1000);
}

function fmtMoney(value) {
  const n = num(value);
  return n ? `$${Math.round(n).toLocaleString("es-CO")}` : "-";
}

function num(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function safeDiv(a, b) {
  const den = num(b);
  return den ? num(a) / den : 0;
}
