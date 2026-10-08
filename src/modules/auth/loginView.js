/**
 * Módulo de Login Oficial e Institucional
 * Gobierno Autónomo Municipal de San Carlos
 */
import { login, getCurrentUser, logout, getRoleLabel } from "../../services/authService.js";
import { showToast } from "../../services/toastService.js";

export function renderLoginOverlay() {
  let overlay = document.getElementById("loginOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loginOverlay";
    overlay.className = "login-overlay";
    document.body.appendChild(overlay);
  }

  const currentUser = getCurrentUser();
  if (currentUser) {
    overlay.classList.remove("active");
    overlay.style.display = "none";
    document.body.classList.remove("logged-out");
    return;
  }

  document.body.classList.add("logged-out");
  overlay.classList.add("active");
  overlay.style.display = "flex";

  overlay.innerHTML = `
    <div class="login-background-photo"></div>
    <div class="login-backdrop-dark"></div>

    <div class="login-card-official">
      <!-- Escudo y Encabezado Institucional -->
      <div class="official-header">
        <div class="official-shield-container">
          <div class="shield-aura"></div>
          <img src="/assets/logo-san-carlos.png" alt="Escudo Oficial del Municipio de San Carlos" class="official-shield-img" />
        </div>
        <span class="badge-governmental">GOBIERNO AUTÓNOMO MUNICIPAL DE SAN CARLOS</span>
        <h1 class="official-title">Red Municipal de Farmacias</h1>
        <p class="official-subtitle">Sistema de Control de Inventario, Ventas y Entregas SUS</p>
      </div>

      <div class="security-banner">
        <svg class="security-icon"><use href="#i-shield"/></svg>
        <div>
          <strong>PORTAL INSTITUCIONAL SEGURO</strong>
          <small>Acceso restringido únicamente a funcionarios autorizados</small>
        </div>
      </div>

      <!-- Formulario de Acceso Oficial -->
      <form id="mainLoginForm" class="official-form">
        <div class="official-form-group">
          <label for="loginEmail">Usuario o Correo Institucional</label>
          <div class="official-input-wrap">
            <svg class="official-input-icon"><use href="#i-users"/></svg>
            <input 
              type="text" 
              id="loginEmail" 
              class="official-input" 
              required 
              placeholder="Ingrese su usuario o correo" 
              autocomplete="username" 
              autofocus
            />
          </div>
        </div>

        <div class="official-form-group">
          <label for="loginPin">Contraseña o PIN de Seguridad</label>
          <div class="official-input-wrap">
            <svg class="official-input-icon"><use href="#i-lock"/></svg>
            <input 
              type="password" 
              id="loginPin" 
              class="official-input" 
              required 
              placeholder="Ingrese su contraseña" 
              autocomplete="current-password" 
            />
            <button type="button" class="btn-toggle-password" id="togglePasswordBtn" aria-label="Mostrar u ocultar contraseña">
              <svg id="eyeIconOpen"><use href="#i-eye"/></svg>
              <svg id="eyeIconClosed" class="hidden"><use href="#i-eye-off"/></svg>
            </button>
          </div>
        </div>

        <button type="submit" id="loginSubmitBtn" class="btn-official-submit">
          <svg class="submit-lock-icon"><use href="#i-lock"/></svg>
          <span id="submitBtnText">Ingresar al Sistema</span>
        </button>
      </form>

      <!-- Pie Institucional -->
      <div class="official-card-footer">
        <div class="db-status-pill">
          <span class="pulse-indicator"></span>
          <span>Base de Datos Supabase (PostgreSQL 17) · Activa</span>
        </div>
        <p class="copyright-legal">
          Dirección Municipal de Salud · San Carlos, Santa Cruz, Bolivia
        </p>
      </div>
    </div>
  `;

  // Toggle de Contraseña visible / oculta
  const toggleBtn = document.getElementById("togglePasswordBtn");
  const pinInput = document.getElementById("loginPin");
  const eyeOpen = document.getElementById("eyeIconOpen");
  const eyeClosed = document.getElementById("eyeIconClosed");

  toggleBtn?.addEventListener("click", () => {
    if (!pinInput) return;
    const isPassword = pinInput.type === "password";
    pinInput.type = isPassword ? "text" : "password";
    if (eyeOpen && eyeClosed) {
      eyeOpen.classList.toggle("hidden", isPassword);
      eyeClosed.classList.toggle("hidden", !isPassword);
    }
  });

  // Envío del Formulario
  const form = document.getElementById("mainLoginForm");
  const submitBtn = document.getElementById("loginSubmitBtn");
  const submitText = document.getElementById("submitBtnText");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const pin = document.getElementById("loginPin").value;

    try {
      if (submitBtn && submitText) {
        submitBtn.disabled = true;
        submitBtn.classList.add("loading");
        submitText.textContent = "Verificando credenciales...";
      }

      await login(email, pin);
      overlay.classList.remove("active");
      overlay.style.display = "none";
      document.body.classList.remove("logged-out");
    } catch (err) {
      showToast("Acceso Denegado", err.message, "error");
    } finally {
      if (submitBtn && submitText) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("loading");
        submitText.textContent = "Ingresar al Sistema";
      }
    }
  });
}

export function updateNavbarProfile() {
  const user = getCurrentUser();
  const profileName = document.getElementById("profileName");
  const profileRole = document.getElementById("profileRole");
  const profileAvatar = document.querySelector(".profile span");
  const roleSelect = document.getElementById("roleSelect");

  if (!user) {
    if (profileName) profileName.textContent = "Sin sesión";
    if (profileRole) profileRole.textContent = "Acceso restringido";
    if (profileAvatar) profileAvatar.textContent = "--";
    renderLoginOverlay();
    return;
  }

  if (profileName) profileName.textContent = user.name;
  if (profileRole) profileRole.textContent = `${getRoleLabel(user.role)} · ${user.branch_id === "all" ? "Central" : user.branch_id}`;
  if (profileAvatar) {
    const initials = user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
    profileAvatar.textContent = initials || "SC";
  }
  if (roleSelect) {
    roleSelect.value = user.role;
  }

  ensureLogoutButton();
}

function ensureLogoutButton() {
  let logoutBtn = document.getElementById("topbarLogoutBtn");
  const actionsContainer = document.querySelector(".topbar-actions");

  if (!logoutBtn && actionsContainer) {
    logoutBtn = document.createElement("button");
    logoutBtn.id = "topbarLogoutBtn";
    logoutBtn.className = "logout-action-btn";
    logoutBtn.title = "Cerrar sesión actual";
    logoutBtn.setAttribute("aria-label", "Cerrar sesión");
    logoutBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      <span>Salir</span>
    `;

    logoutBtn.addEventListener("click", () => {
      if (confirm("¿Deseas cerrar tu sesión del sistema?")) {
        logout();
      }
    });

    actionsContainer.appendChild(logoutBtn);
  }
}
