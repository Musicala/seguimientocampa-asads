/* =========================================================
   ui.js - Render y componentes UI (sin logica de negocio)
   Requiere: index.html IDs
   Opcional: utils.js con moneyCOP, toISODate, etc.
========================================================= */

const UI = (() => {
  const $ = (id) => document.getElementById(id);

  // ---------------- Public API ----------------

  function renderGlobalKPIs(totals) {
    const el = $("globalKPIs");
    if (!el) return;

    if (!totals) {
      el.innerHTML = `<div class="muted" style="font-size:12px">Sin datos</div>`;
      return;
    }

    el.innerHTML = `
      ${kpiLine_("Gasto real", moneyCOP_(totals.spend))}
      ${totals.reported_spend ? kpiLine_("Gasto Ads", moneyCOP_(totals.reported_spend)) : ""}
      ${kpiLine_("Leads", intFmt_(totals.leads))}
      ${kpiLine_("Ventas", intFmt_(totals.sales))}
      ${kpiLine_("Resultado", numFmt_(totals.roas, 2))}
    `;
  }

  function renderDashboardKPIs(totals) {
    const el = $("dashboardKPIs");
    if (!el) return;

    if (!totals) {
      el.innerHTML = `<div class="muted">No hay datos suficientes para el rango.</div>`;
      return;
    }

    el.innerHTML = `
      <div class="kpi-card">
        ${decisionBlock_(totals)}
        ${kpiLine_("Gasto real", moneyCOP_(totals.spend))}
        ${totals.reported_spend ? kpiLine_("Gasto Ads reportado", moneyCOP_(totals.reported_spend)) : ""}
        ${kpiLine_("Mensajes iniciados", intFmt_(totals.leads))}
        ${kpiLine_("Costo por mensaje", moneyCOP_(totals.cpl))}
        ${kpiLine_("Clics al enlace", intFmt_(totals.link_clicks || totals.clicks))}
        ${kpiLine_("Costo por clic", moneyCOP_(totals.cpc))}
        ${kpiLine_("Reproducciones", intFmt_(totals.video_plays || totals.impressions))}
        ${totals.viewers ? kpiLine_("Espectadores / alcance", intFmt_(totals.viewers)) : ""}
        ${totals.post_interactions ? kpiLine_("Interacciones", intFmt_(totals.post_interactions)) : ""}
        ${totals.saves || totals.shares || totals.comments ? kpiLine_("Guardados / compartidos / comentarios", `${intFmt_(totals.saves)} / ${intFmt_(totals.shares)} / ${intFmt_(totals.comments)}`) : ""}
        ${totals.sales ? kpiLine_("Ventas confirmadas", intFmt_(totals.sales)) : ""}
      </div>
    `;
  }

  function renderRankingTable(rankings, rows) {
    const el = $("rankingTable");
    if (!el) return;

    const bestROAS = (rankings?.bestROAS || []).slice(0, 8);
    const bestCPL = (rankings?.bestCPL || []).slice(0, 8);
    const waste = (rankings?.waste || []).slice(0, 8);

    if (!bestROAS.length && !bestCPL.length && !waste.length) {
      el.innerHTML = `<div class="muted">No hay suficientes datos aun.</div>`;
      return;
    }

    el.innerHTML = `
      <div style="display:grid; gap:14px">
        ${bestROAS.length ? block_("Mejor rendimiento", tableRank_(bestROAS, ["Campana","Gasto real","Leads","Resultado"], (r)=>[
          safeName_(r),
          moneyCOP_(r.spend),
          intFmt_(r.leads),
          decisionLabel_(r),
        ])) : ""}

        ${bestCPL.length ? block_("Mejor costo por mensaje", tableRank_(bestCPL, ["Campana","Gasto real","Leads","Costo por mensaje"], (r)=>[
          safeName_(r),
          moneyCOP_(r.spend),
          intFmt_(r.leads),
          moneyCOP_(r.cpl),
        ])) : ""}

        ${waste.length ? block_("Plata sin leads", tableRank_(waste, ["Campana","Gasto real","Leads","Nota"], (r)=>[
          safeName_(r),
          moneyCOP_(r.spend),
          intFmt_(r.leads),
          "0 leads",
        ])) : ""}
      </div>
    `;
  }

  function renderCampaignTable(campaigns) {
    const tb = $("campaignTable");
    if (!tb) return;

    const list = (campaigns || []).slice();

    if (!list.length) {
      tb.innerHTML = `<tr><td colspan="5" class="muted">Aun no hay campanas.</td></tr>`;
      return;
    }

    tb.innerHTML = "";
    list.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="font-weight:700">${esc_(c.nombre || "")}</div>
          <div class="muted" style="font-size:12px">${esc_(c.campaign_id || "")}</div>
          ${num_(c.cobro_total) > 0 ? `<div class="muted" style="font-size:12px">Cobro real: ${moneyCOP_(c.cobro_total)}</div>` : ""}
        </td>
        <td>${esc_(c.canal || "")}</td>
        <td>${esc_(c.objetivo || "")}</td>
        <td>${badge_(c.estado || "")}</td>
        <td style="text-align:right">
          <button class="btn-mini" data-action="edit-campaign" data-id="${escAttr_(c.campaign_id || "")}">
            Editar
          </button>
          <button class="btn-mini" data-action="copy-id" data-id="${escAttr_(c.campaign_id || "")}">
            Copiar ID
          </button>
        </td>
      `;
      tb.appendChild(tr);
    });

    // delegacion de eventos
    tb.querySelectorAll('button[data-action="copy-id"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id") || "";
        copy_(id);
        toast("ID copiado OK", "success");
      });
    });

    tb.querySelectorAll('button[data-action="edit-campaign"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id") || "";
        document.dispatchEvent(new CustomEvent("campaign:edit", { detail: { campaign_id: id } }));
      });
    });
  }

  function fillCampaignSelect(selectId, campaigns) {
    const sel = $(selectId);
    if (!sel) return;

    const list = (campaigns || []).slice();

    sel.innerHTML = `<option value="">Selecciona...</option>`;
    list.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.campaign_id || "";
      opt.textContent = `${c.nombre || c.campaign_id} ${c.canal ? `- ${c.canal}` : ""}`;
      sel.appendChild(opt);
    });
  }

  function renderMetricsTable(rows) {
    const el = $("metricsTable");
    if (!el) return;

    const list = (rows || []).slice(0, 60);

    if (!list.length) {
      el.innerHTML = `<div class="muted">Aun no hay registros.</div>`;
      return;
    }

    el.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>ID</th>
            <th>Gasto</th>
            <th>Reprod.</th>
            <th>Clics enlace</th>
            <th>Mensajes</th>
            <th>CPMje</th>
            <th>Decision</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(r => {
            const spend = num_(r.spend);
            return `
              <tr>
                <td>${esc_(dateFmt_(r.date))}</td>
                <td class="muted" style="font-size:12px">${esc_(r.campaign_id || "")}</td>
                <td>${moneyCOP_(spend)}</td>
                <td>${intFmt_(r.video_plays || r.impressions)}</td>
                <td>${intFmt_(r.link_clicks || r.clicks)}</td>
                <td>${intFmt_(r.leads)}</td>
                <td>${moneyCOP_(safeDiv_(spend, r.leads))}</td>
                <td>${esc_(decisionLabel_(r))}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  function toast(message, type = "info") {
    const id = "toast-root";
    let root = $(id);
    if (!root) {
      root = document.createElement("div");
      root.id = id;
      root.style.position = "fixed";
      root.style.right = "16px";
      root.style.bottom = "16px";
      root.style.display = "grid";
      root.style.gap = "10px";
      root.style.zIndex = "9999";
      document.body.appendChild(root);
    }

    const item = document.createElement("div");
    item.style.padding = "12px 14px";
    item.style.borderRadius = "12px";
    item.style.border = "1px solid rgba(229,231,235,1)";
    item.style.boxShadow = "0 10px 28px rgba(16,24,40,0.10)";
    item.style.background = "#fff";
    item.style.fontSize = "13px";
    item.style.maxWidth = "360px";

    const color = typeColor_(type);
    item.innerHTML = `
      <div style="display:flex; gap:10px; align-items:flex-start">
        <div style="width:10px; height:10px; border-radius:999px; margin-top:4px; background:${color}"></div>
        <div style="flex:1">
          <div style="font-weight:700; margin-bottom:2px">${esc_(title_(type))}</div>
          <div style="color:#374151">${esc_(message)}</div>
        </div>
      </div>
    `;

    root.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  }

  // ---------------- Private helpers ----------------

  function kpiLine_(label, value) {
    return `
      <div class="kpi-item">
        <span class="muted">${esc_(label)}</span>
        <strong>${esc_(value)}</strong>
      </div>
    `;
  }

  function block_(title, innerHtml) {
    return `
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <div style="font-weight:800">${esc_(title)}</div>
        </div>
        ${innerHtml}
      </div>
    `;
  }

  function tableRank_(rows, headers, rowMapper) {
    return `
      <table class="data-table">
        <thead>
          <tr>${headers.map(h => `<th>${esc_(h)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const cells = rowMapper(r);
            return `<tr>${cells.map(c => `<td>${esc_(String(c ?? ""))}</td>`).join("")}</tr>`;
          }).join("")}
        </tbody>
      </table>
    `;
  }

  function decisionBlock_(totals) {
    const decision = decision_(totals);
    return `
      <div class="decision-box ${decision.tone}">
        <strong>${esc_(decision.title)}</strong>
        <span>${esc_(decision.body)}</span>
        <small>${esc_(decision.why)}</small>
        <small>${esc_(decision.next)}</small>
      </div>
    `;
  }

  function decisionLabel_(row) {
    return decision_(row).title;
  }

  function decision_(row) {
    const spend = num_(row.spend);
    const messages = num_(row.leads);
    const clicks = num_(row.link_clicks || row.clicks);
    const costPerMessage = safeDiv_(spend, messages);
    const costText = costPerMessage ? moneyCOP_(costPerMessage) : "$0";
    const spendText = moneyCOP_(spend);

    if (spend <= 0) {
      return {
        tone: "neutral",
        title: "Falta gasto",
        body: "Todavia no puedo decir si funciono.",
        why: "Por que: no hay gasto real o gasto reportado para comparar contra mensajes.",
        next: "Siguiente paso: agrega cuanto se gasto y cuantos mensajes llegaron.",
      };
    }
    if (messages >= 20 && costPerMessage > 0 && costPerMessage <= 2500) {
      return {
        tone: "good",
        title: "Funciono: escalar",
        body: "Esta campana trajo bastantes conversaciones a bajo costo.",
        why: `Por que: gastaste ${spendText}, llegaron ${messages} mensajes y cada mensaje costo ${costText}.`,
        next: "Siguiente paso: repetirla o subir presupuesto poco a poco, sin cambiar muchas cosas a la vez.",
      };
    }
    if (messages >= 5 && costPerMessage > 0 && costPerMessage <= 4500) {
      return {
        tone: "watch",
        title: "Funciona: mejorar antes de escalar",
        body: "Hay interes, pero todavia puede salir mas barata.",
        why: `Por que: llegaron ${messages} mensajes y cada uno costo ${costText}. No esta mal, pero puede mejorar.`,
        next: "Siguiente paso: prueba otra imagen, texto o publico antes de subir mas presupuesto.",
      };
    }
    if (clicks > 0 && messages === 0) {
      return {
        tone: "bad",
        title: "No convierte",
        body: "La gente muestra curiosidad, pero no termina escribiendo.",
        why: `Por que: hubo ${clicks} clics, pero llegaron 0 mensajes.`,
        next: "Siguiente paso: revisa el WhatsApp, la oferta, el precio visible o el llamado a escribir.",
      };
    }
    if (messages === 0) {
      return {
        tone: "bad",
        title: "Pausar o cambiar",
        body: "Se esta gastando dinero y no llegan conversaciones.",
        why: `Por que: gastaste ${spendText} y llegaron 0 mensajes.`,
        next: "Siguiente paso: no metas mas plata igual; cambia imagen, texto, publico u objetivo.",
      };
    }
    return {
      tone: "watch",
      title: "Poca informacion",
      body: "Hay senales, pero aun falta volumen para decidir tranquilo.",
      why: `Por que: solo hay ${messages} mensajes. Con tan poquitos datos es facil equivocarse.`,
      next: "Siguiente paso: deja correr un poco mas o compara contra otra campana similar.",
    };
  }
  function safeName_(r) {
    return r?.nombre || r?.campaign_id || "-";
  }

  function badge_(estado) {
    const s = (estado || "").toLowerCase();
    let cls = "";
    if (s.includes("act")) cls = "activa";
    else if (s.includes("paus")) cls = "pausada";
    else if (s.includes("fin")) cls = "finalizada";

    return `<span class="badge ${cls}">${esc_(estado || "")}</span>`;
  }

  async function copy_(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
    } catch (_) {
      // fallback viejo
      const t = document.createElement("textarea");
      t.value = String(text || "");
      document.body.appendChild(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
  }

  function typeColor_(type) {
    if (type === "success") return "rgba(22,163,74,1)";
    if (type === "error") return "rgba(220,38,38,1)";
    if (type === "warning") return "rgba(245,158,11,1)";
    return "rgba(12,65,196,1)";
  }

  function title_(type) {
    if (type === "success") return "Listo";
    if (type === "error") return "Ups";
    if (type === "warning") return "Ojo";
    return "Info";
  }

  function dateFmt_(x) {
    // muestra YYYY-MM-DD si viene Date o string
    if (window.toISODate) return window.toISODate(x);
    const d = (x instanceof Date) ? x : new Date(x);
    if (isNaN(d)) return String(x || "");
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function moneyCOP_(x) {
    if (window.moneyCOP) return window.moneyCOP(x);
    const n = num_(x);
    return n.toLocaleString("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    });
  }

  function pctFmt_(x) {
    const n = num_(x);
    return (n * 100).toFixed(2) + "%";
  }

  function intFmt_(x) {
    const n = Math.trunc(num_(x));
    return n.toLocaleString("es-CO");
  }

  function numFmt_(x, d = 2) {
    const n = num_(x);
    return n.toFixed(d);
  }

  function num_(x) {
    const n = Number(String(x ?? 0).replace(",", "."));
    return isNaN(n) ? 0 : n;
  }

  function safeDiv_(a, b) {
    const den = num_(b);
    return den ? num_(a) / den : 0;
  }

  function esc_(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function escAttr_(s) {
    // mismo escape, pero por claridad
    return esc_(s);
  }

  // Extra: estilos para mini-botones en tabla (sin tocar styles.css)
  // (se inyecta una sola vez)
  (function injectMiniBtnStyle_() {
    const id = "ui-mini-btn-style";
    if (document.getElementById(id)) return;
    const st = document.createElement("style");
    st.id = id;
    st.textContent = `
      .btn-mini{
        padding: 7px 10px;
        border-radius: 10px;
        border: 1px solid rgba(229,231,235,1);
        background: #fff;
        cursor: pointer;
        font-weight: 700;
        font-size: 12px;
      }
      .btn-mini:hover{
        background: rgba(12,65,196,0.06);
        border-color: rgba(12,65,196,0.25);
      }
      .muted{ color: #6b7280; }
    `;
    document.head.appendChild(st);
  })();

  return {
    renderGlobalKPIs,
    renderDashboardKPIs,
    renderRankingTable,
    renderCampaignTable,
    fillCampaignSelect,
    renderMetricsTable,
    toast,
  };
})();

window.UI = UI;
