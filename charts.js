/* =========================================================
   charts.js - Resumen visual para decidir rapido
========================================================= */

const Charts = (() => {
  function renderPerformance(containerId, series = [], campaignRows = []) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const rows = (campaignRows || []).slice();
    const daily = (series || []).filter(r => r && r.date).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));

    if (!rows.length && !daily.length) {
      el.innerHTML = `<div class="empty-performance">Aun no hay datos para decidir.</div>`;
      return;
    }

    const best = chooseBest_(rows, daily);
    const trend = daily.length > 1 ? renderTrend_(daily) : renderSingleDayBars_(best);
    const decision = decisionFor_(best);

    el.innerHTML = `
      <div class="performance-decision ${decision.tone}">
        <div>
          <span class="eyebrow">Lectura rapida</span>
          <strong>${esc_(decision.title)}</strong>
          <p>${esc_(decision.body)}</p>
        </div>
      </div>

      <div class="performance-stats">
        ${stat_("Gasto real", money_(best.spend), "Lo que realmente se fue en la campana")}
        ${stat_("Mensajes", int_(best.leads), "Conversaciones iniciadas")}
        ${stat_("Costo por mensaje", money_(safeDiv_(best.spend, best.leads)), "Entre mas bajo, mejor")}
      </div>

      <div class="repeat-card">
        <span class="eyebrow">Base para repetir</span>
        <strong>${esc_(best.nombre || "Campana actual")}</strong>
        <p>${esc_(decision.why)}</p>
        <p>${esc_(decision.next)}</p>
      </div>

      ${trend}
    `;
  }

  function chooseBest_(rows, daily) {
    if (rows.length) {
      return rows
        .slice()
        .sort((a, b) => score_(b) - score_(a))[0];
    }
    const total = daily.reduce((acc, r) => {
      acc.spend += num_(r.spend);
      acc.leads += num_(r.leads);
      acc.link_clicks += num_(r.link_clicks || r.clicks);
      acc.video_plays += num_(r.video_plays || r.impressions);
      return acc;
    }, { spend: 0, leads: 0, link_clicks: 0, video_plays: 0, nombre: "Campana actual" });
    return total;
  }

  function score_(row) {
    const messages = num_(row.leads);
    const cpm = safeDiv_(row.spend, row.leads);
    if (!messages) return -num_(row.spend);
    return messages * 1000 - cpm;
  }

  function renderSingleDayBars_(row) {
    const messages = num_(row.leads);
    const clicks = num_(row.link_clicks || row.clicks);
    const plays = num_(row.video_plays || row.impressions);
    const max = Math.max(messages, clicks, plays, 1);

    return `
      <div class="simple-bars">
        ${bar_("Mensajes", messages, max)}
        ${bar_("Clics", clicks, max)}
        ${bar_("Reproducciones", plays, max)}
      </div>
    `;
  }

  function renderTrend_(daily) {
    const last = daily[daily.length - 1];
    const prev = daily[daily.length - 2];
    const lastCpm = safeDiv_(last.spend, last.leads);
    const prevCpm = safeDiv_(prev.spend, prev.leads);
    const improved = prevCpm && lastCpm && lastCpm < prevCpm;

    return `
      <div class="trend-box">
        <span class="eyebrow">Tendencia</span>
        <strong>${improved ? "Va mejorando" : "Revisar evolucion"}</strong>
        <p>Ultimo dia: ${int_(last.leads)} mensajes a ${money_(lastCpm)} cada uno.</p>
      </div>
    `;
  }

  function decisionFor_(row) {
    const spend = num_(row.spend);
    const messages = num_(row.leads);
    const clicks = num_(row.link_clicks || row.clicks);
    const cpm = safeDiv_(spend, messages);

    if (spend <= 0) {
      return {
        tone: "neutral",
        title: "Falta gasto",
        body: "Todavia no se puede decidir.",
        why: "Falta saber cuanto se gasto para comparar contra los mensajes.",
        next: "Agrega gasto y mensajes iniciados.",
      };
    }
    if (messages >= 20 && cpm <= 2500) {
      return {
        tone: "good",
        title: "Repetir esta campana",
        body: "Trajo suficientes conversaciones a buen costo.",
        why: `Gastaste ${money_(spend)}, llegaron ${int_(messages)} mensajes y cada mensaje costo ${money_(cpm)}.`,
        next: "Usala como base: misma oferta, mismo tono y sube presupuesto poco a poco.",
      };
    }
    if (messages >= 5 && cpm <= 4500) {
      return {
        tone: "watch",
        title: "Sirve, pero mejorala",
        body: "Hay interes, aunque todavia puede ser mas eficiente.",
        why: `Llegaron ${int_(messages)} mensajes, pero cada uno costo ${money_(cpm)}.`,
        next: "Prueba otra imagen, texto o publico antes de invertir mas fuerte.",
      };
    }
    if (clicks > 0 && messages === 0) {
      return {
        tone: "bad",
        title: "No usar igual",
        body: "La gente hace clic, pero no escribe.",
        why: `Hubo ${int_(clicks)} clics y 0 mensajes.`,
        next: "Revisa WhatsApp, oferta, precio visible o llamado a la accion.",
      };
    }
    return {
      tone: "bad",
      title: "Cambiar antes de gastar mas",
      body: "Se gasto dinero sin traer conversaciones suficientes.",
      why: `Gastaste ${money_(spend)} y llegaron ${int_(messages)} mensajes.`,
      next: "Cambia creatividad, publico u objetivo antes de repetir.",
    };
  }

  function stat_(label, value, help) {
    return `
      <div class="performance-stat">
        <span>${esc_(label)}</span>
        <strong>${esc_(value)}</strong>
        <small>${esc_(help)}</small>
      </div>
    `;
  }

  function bar_(label, value, max) {
    const pct = Math.max(3, Math.round((num_(value) / max) * 100));
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${esc_(label)}</span><strong>${int_(value)}</strong></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  function num_(x) {
    const n = Number(x || 0);
    return isNaN(n) ? 0 : n;
  }

  function safeDiv_(a, b) {
    const den = num_(b);
    return den ? num_(a) / den : 0;
  }

  function money_(n) {
    return num_(n).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
  }

  function int_(n) {
    return Math.round(num_(n)).toLocaleString("es-CO");
  }

  function esc_(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  return { renderPerformance };
})();

window.Charts = Charts;