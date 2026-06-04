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
      ${totals.budget_monthly_target ? kpiLine_("Presupuesto max.", moneyCOP_(totals.budget_monthly_target)) : ""}
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
        ${totals.budget_monthly_target ? kpiLine_("Presupuesto maximo usado", `${pctFmt_(totals.budget_used_pct)} de ${moneyCOP_(totals.budget_monthly_target)}`) : ""}
        ${totals.budget_projected_spend ? kpiLine_("Proyeccion / cierre", moneyCOP_(totals.budget_projected_spend)) : ""}
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
      tb.innerHTML = `<tr><td colspan="7" class="muted">Aun no hay campanas.</td></tr>`;
      return;
    }

    tb.innerHTML = "";
    list.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="font-weight:700">${esc_(c.nombre || "")}</div>
          <div class="muted" style="font-size:12px">${esc_(c.campaign_id || "")}</div>
          ${num_(c.presupuesto_diario) > 0 ? `<div class="muted" style="font-size:12px">Presupuesto diario: ${moneyCOP_(c.presupuesto_diario)}</div>` : ""}
          ${num_(c.cobro_total) > 0 ? `<div class="muted" style="font-size:12px">Cobro real: ${moneyCOP_(c.cobro_total)}</div>` : ""}
        </td>
        <td>
          ${platformChip_(platformType_(c))}
          <div class="muted" style="font-size:12px; margin-top:4px">${esc_(c.canal || c.plataforma || "")}</div>
        </td>
        <td>${esc_(c.objetivo || "")}</td>
        <td>${campaignDates_(c)}</td>
        <td>${campaignBudgetSummary_(c)}</td>
        <td>${badge_(c.estado || "")}</td>
        <td style="text-align:right">
          <button class="btn-mini" data-action="edit-budget" data-id="${escAttr_(c.campaign_id || "")}">Presupuesto</button>
          <button class="btn-mini" data-action="edit-campaign" data-id="${escAttr_(c.campaign_id || "")}">Editar</button>
          <button class="btn-mini" data-action="copy-id" data-id="${escAttr_(c.campaign_id || "")}">Copiar ID</button>
        </td>
      `;
      tb.appendChild(tr);
    });

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

    tb.querySelectorAll('button[data-action="edit-budget"]').forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id") || "";
        document.dispatchEvent(new CustomEvent("budget:edit", { detail: { campaign_id: id } }));
      });
    });
  }

  function renderBudgetControl(rows, totals) {
    const el = $("budgetControl");
    if (!el) return;

    const list = (rows || []).slice().sort((a, b) => budgetPriority_(a) - budgetPriority_(b));
    if (!list.length) {
      el.innerHTML = `
        <div class="budget-empty-action">
          <span>No hay campanas en este periodo.</span>
          <button type="button" class="primary budget-add-btn" data-action="open-budget-modal">Agregar presupuesto maximo</button>
        </div>
      `;
      el.querySelector('[data-action="open-budget-modal"]')?.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("budget:edit", { detail: { campaign_id: "" } }));
      });
      return;
    }

    const summary = totals?.budget_monthly_target ? `
      <div class="budget-summary-row">
        <div class="budget-summary">
          ${budgetStat_("Presupuesto maximo", moneyCOP_(totals.budget_monthly_target))}
          ${budgetStat_("Gasto registrado", moneyCOP_(totals.budget_spend_to_date))}
          ${budgetStat_("Comprometido / estimado", moneyCOP_(totals.budget_committed))}
          ${budgetStat_("Restante", moneyCOP_(totals.budget_remaining))}
          ${budgetStat_("Proyeccion / cierre", moneyCOP_(totals.budget_projected_spend))}
        </div>
        <button type="button" class="primary budget-add-btn" data-action="open-budget-modal">Agregar presupuesto maximo</button>
      </div>
    ` : `
      <div class="budget-empty-action">
        <span>Define el presupuesto maximo aprobado para empezar el control.</span>
        <button type="button" class="primary budget-add-btn" data-action="open-budget-modal">Agregar presupuesto maximo</button>
      </div>
    `;

    el.innerHTML = `
      ${summary}
      <div class="budget-card-list">
        ${list.map(r => budgetCard_(r)).join("")}
      </div>
    `;

    el.querySelectorAll('[data-action="open-budget-modal"]').forEach(btn => {
      btn.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("budget:edit", { detail: { campaign_id: "" } }));
      });
    });

    el.querySelectorAll('[data-action="edit-budget"]').forEach(btn => {
      btn.addEventListener("click", () => {
        document.dispatchEvent(new CustomEvent("budget:edit", { detail: { campaign_id: btn.getAttribute("data-id") || "" } }));
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
      ${quickReadBlock_(list)}
      <table class="data-table metrics-history-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Campana</th>
            <th>Plataforma</th>
            <th>Gasto / costo</th>
            <th>Resultado principal</th>
            <th>Clics</th>
            <th>Ventas</th>
            <th>Costo por resultado</th>
            <th>Observacion</th>
          </tr>
        </thead>
        <tbody>
          ${list.map(r => {
            const result = primaryResult_(r);
            const spend = num_(r.spend);
            return `
              <tr>
                <td>${esc_(dateFmt_(r.date))}</td>
                <td>${esc_(r.nombre || r.campaign_name || r.campaign_id || "")}</td>
                <td>${platformChip_(platformType_(r))}</td>
                <td>${moneyCOP_(spend)}</td>
                <td><strong>${intFmt_(result.value)}</strong><div class="muted" style="font-size:11px">${esc_(result.label)}</div></td>
                <td>${intFmt_(r.link_clicks || r.clicks)}</td>
                <td>${intFmt_(r.sales)}</td>
                <td>${result.value > 0 ? moneyCOP_(spend / result.value) : "Sin resultado"}</td>
                <td>${esc_(r.quick_observation || r.notes || "")}</td>
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


  function platformType_(row) {
    const explicit = String(row?.platform_type || "").toLowerCase();
    if (explicit.includes("meta")) return "meta";
    if (explicit.includes("google")) return "google";
    const text = `${row?.canal || ""} ${row?.plataforma || ""}`.toLowerCase();
    if (text.includes("meta") || text.includes("facebook") || text.includes("instagram")) return "meta";
    if (text.includes("google")) return "google";
    return "general";
  }

  function platformLabel_(type) {
    if (type === "meta") return "Meta";
    if (type === "google") return "Google Ads";
    return "General";
  }

  function platformChip_(type) {
    return `<span class="chip chip-${escAttr_(type)}">${esc_(platformLabel_(type))}</span>`;
  }

  function campaignDates_(c) {
    const created = c.fecha_creacion || c.fecha_inicio || "";
    const start = c.fecha_inicio || "";
    const end = c.fecha_fin || "";
    const finished = String(c.estado || "").toLowerCase().includes("fin");
    return `
      <div class="date-stack">
        <span>Creada: ${esc_(dateDMY_(created) || "Sin fecha")}</span>
        <span>Inicio: ${esc_(dateDMY_(start) || "Sin fecha")}</span>
        ${end ? `<span class="chip chip-end">${finished ? "Finalizo" : "Finaliza"}: ${esc_(dateDMY_(end))}</span>` : `<span class="chip chip-continuous">Continua</span>`}
      </div>
    `;
  }

  function primaryResult_(row) {
    const type = platformType_(row);
    if (type === "meta") return { label: "Conversaciones", value: num_(row.conversations_started || row.leads) };
    if (type === "google") return { label: "Conversiones / clientes potenciales", value: num_(row.conversions || row.raw_leads || row.leads) };
    return { label: "Leads / contactos", value: num_(row.raw_leads || row.leads) };
  }

  function quickReadBlock_(rows) {
    const items = rows.slice(0, 5).map(r => quickRead_(r));
    return `
      <div class="quick-read">
        <h4>Lectura rapida</h4>
        <div class="quick-read-list">
          ${items.map(item => `<div class="quick-read-item ${escAttr_(item.tone)}"><strong>${esc_(item.name)}</strong><span>${esc_(item.text)}</span></div>`).join("")}
        </div>
      </div>
    `;
  }

  function quickRead_(row) {
    const spend = num_(row.spend);
    const result = primaryResult_(row).value;
    const clicks = num_(row.link_clicks || row.clicks);
    const sales = num_(row.sales);
    const name = row.nombre || row.campaign_name || row.campaign_id || "Campana";
    if (sales > 0) return { name, tone: "good", text: "Tiene ventas registradas. Revisar costo por venta." };
    if (spend > 0 && result === 0) return { name, tone: "bad", text: "Mucho gasto y cero resultados. Revisar segmentacion, anuncio u objetivo." };
    if (clicks > 0 && result === 0) return { name, tone: "watch", text: "Tiene clics, pero pocos contactos. Revisar anuncio o pagina destino." };
    if (result > 0 && sales === 0) return { name, tone: "watch", text: "Esta generando mensajes o contactos, pero aun no registra ventas." };
    if (clicks > 0 && spend > 0) return { name, tone: "neutral", text: "Buen volumen de clics con bajo costo, pero falta medir ventas." };
    return { name, tone: "neutral", text: "Faltan datos para decidir con tranquilidad." };
  }

  function campaignBudgetSummary_(c) {
    const b = c.budget || {};
    const target = num_(b.monthly_budget_target || c.monthly_budget_target || c.presupuesto_mensual);
    const estimate = num_(b.monthly_budget_estimated || c.monthly_budget_estimated);
    const status = b.status || c.budget_status || "missing";
    const scope = b.scope === "campaign_closed" ? "Campana cerrada" : "Mes en curso";
    return `
      <div class="date-stack">
        <span>Maximo: ${target ? moneyCOP_(target) : "Sin dato"}</span>
        ${estimate ? `<span>Techo estimado: ${moneyCOP_(estimate)}</span>` : ""}
        <span class="muted">${esc_(scope)}</span>
        <span class="budget-pill ${escAttr_(status)}">${esc_(budgetStatusLabel_(status))}</span>
      </div>
    `;
  }

  function budgetCard_(row) {
    const b = row.budget || {};
    const status = b.status || "missing";
    const usedPct = Math.min(1.25, Math.max(0, num_(b.used_pct)));
    const isClosed = Boolean(b.is_finished || b.scope === "campaign_closed");
    return `
      <article class="budget-campaign-card ${escAttr_(status)}">
        <div class="budget-card-head">
          <div>
            <strong>${esc_(row.nombre || row.campaign_id || "Campana")}</strong>
            <span>${esc_(budgetModeLabel_(b.mode || row.budget_mode))} · ${esc_(isClosed ? "campana cerrada" : "control mensual")}</span>
            ${row.fecha_creacion ? `<span class="budget-created">Creada: ${esc_(dateDMY_(row.fecha_creacion))}</span>` : ""}
          </div>
          <span class="budget-pill ${escAttr_(status)}">${esc_(budgetStatusLabel_(status))}</span>
        </div>
        <div class="budget-progress" aria-label="Presupuesto usado">
          <span style="width:${Math.round(Math.min(100, usedPct * 100))}%"></span>
        </div>
        <div class="budget-metrics">
          ${budgetStat_(isClosed ? "Usado final" : "Usado del mes", pctFmt_(b.used_pct))}
          ${budgetStat_("Gasto", moneyCOP_(b.spend_to_date))}
          ${budgetStat_("Restante", moneyCOP_(b.remaining))}
          ${budgetStat_(isClosed ? "Gasto final" : "Proyeccion / estimado", moneyCOP_(isClosed ? b.projected_spend : (b.committed_spend != null ? b.committed_spend : b.projected_spend)))}
          ${isClosed ? budgetStat_("Estado", "Finalizada") : budgetStat_("Diario seguro", moneyCOP_(b.safe_daily_spend))}
          ${budgetStat_(isClosed ? "Periodo cerrado" : "Avance del mes", pctFmt_(b.expected_progress))}
        </div>
        <div class="budget-card-footer">
          <p>${esc_(b.recommendation || "Completar datos para recomendar.")}</p>
          <button type="button" class="btn-mini" data-action="edit-budget" data-id="${escAttr_(row.campaign_id || "")}">Definir maximo</button>
        </div>
      </article>
    `;
  }

  function budgetStat_(label, value) {
    return `<div class="budget-stat"><span>${esc_(label)}</span><strong>${esc_(value)}</strong></div>`;
  }

  function budgetPriority_(row) {
    const status = row?.budget?.status || "missing";
    return { danger: 0, warning: 1, missing: 2, ok: 3 }[status] ?? 4;
  }

  function budgetStatusLabel_(status) {
    if (status === "ok") return "OK";
    if (status === "warning") return "Alerta";
    if (status === "danger") return "Riesgo";
    return "Faltan datos";
  }

  function budgetModeLabel_(mode) {
    if (mode === "daily_google") return "Google Ads diario";
    if (mode === "daily_meta") return "Meta diario";
    if (mode === "one_time") return "Pago unico";
    return "Tope mensual";
  }

  function dateDMY_(x) {
    const iso = dateFmt_(x);
    const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
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
    renderBudgetControl,
    renderCampaignTable,
    fillCampaignSelect,
    renderMetricsTable,
    toast,
  };
})();

window.UI = UI;
