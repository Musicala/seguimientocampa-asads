import { watchAuth, signInWithGoogle, signOutUser, isAuthorizedUser } from "./services/authService.js";
import "./api.js";

function renderAuthBar(user) {
  let bar = document.getElementById("authBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "authBar";
    bar.className = "auth-bar";
    document.body.prepend(bar);
  }

  if (!user) {
    bar.innerHTML = `
      <span>Conecta con Google para cargar los datos de marketing.</span>
      <button type="button" class="primary" id="btnGoogleLogin">Entrar con Google</button>
    `;
    document.getElementById("btnGoogleLogin")?.addEventListener("click", () => signInWithGoogle());
    return;
  }

  if (!isAuthorizedUser(user)) {
    bar.innerHTML = `
      <span>No autorizado: ${escapeHtml(user.email || "este correo")} no tiene permiso para usar esta app.</span>
      <button type="button" class="btn-mini" id="btnGoogleLogout">Salir</button>
    `;
    document.getElementById("btnGoogleLogout")?.addEventListener("click", () => signOutUser());
    return;
  }

  bar.innerHTML = `
    <span>Firebase conectado: ${escapeHtml(user.email || user.displayName || "usuario")}</span>
    <button type="button" class="btn-mini" id="btnGoogleLogout">Salir</button>
  `;
  document.getElementById("btnGoogleLogout")?.addEventListener("click", () => signOutUser());
}

watchAuth((user) => {
  renderAuthBar(user);
  if (user && window.__adsAppBootedOnce) window.location.reload();
  window.__adsAppBootedOnce = true;
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}
