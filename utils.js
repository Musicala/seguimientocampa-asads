/* =========================================================
   utils.js - utilidades compartidas
========================================================= */

function parseNum(x) {
  if (x === "" || x == null) return 0;
  const n = Number(String(x).replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function moneyCOP(x) {
  const n = parseNum(x);
  return n.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

function numFmt(x, d = 2) {
  return parseNum(x).toFixed(d);
}

function pctFmt(x) {
  return `${(parseNum(x) * 100).toFixed(2)}%`;
}

function intFmt(x) {
  return Math.trunc(parseNum(x)).toLocaleString("es-CO");
}

function toISODate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d)) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

window.parseNum = parseNum;
window.moneyCOP = moneyCOP;
window.numFmt = numFmt;
window.pctFmt = pctFmt;
window.intFmt = intFmt;
window.toISODate = toISODate;
window.escapeHtml = escapeHtml;
