/**
 * Módulo de Login y Autenticación - Rediseño Elegante
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
    <div class="login-backdrop-animated">
      <div class="glow-orb orb-1"></div>
      <div class="glow-orb orb-2"></div>
      <div class="glow-orb orb-3"></div>
    </div>

    <div class="login-card">
      <!-- Encabezado con Logo Municipal -->
      <div class="login-brand">
        <div class="brand-floating-logo">
          <div class="logo-glow-ring"></div>
          <img src="/assets/logo-san-carlos.png" alt="Escudo del Municipio de San Carlos" class="floating-logo-img" />
        </div>
        <span class="badge-municipal">SISTEMA INTEGRAL DE SALUD</span>
        <h1 class="login-title">Farmacias Municipales</h1>
        <p class="login-subtitle">Gobierno Autónomo Municipal de San Carlos</p>
      </div>

      <!-- Credenciales de Administrador -->
      <div class="credentials-box" id="btnAutofillAdmin" role="button" tabindex="0" title="Clic para cargar credenciales de Administrador">
        <div class="credentials-badge">
          <svg class="cred-icon"><use href="#i-key"/></svg>
        </div>
        <div class="credentials-info">
          <span class="cred-caption">Acceso Administrador Configurado</span>
          <div class="cred-values">
            <span>Usuario: <b>admin</b></span>
            <span class="cred-sep">·</span>
            <span>Clave: <b>admin123</b></span>
          </div>
        </div>
        <button type="button" class="btn-fill-pill">
          <span>Rellenar</span>
        </button>
      </div>

      <!-- Formulario de Inicio de Sesión -->
      <form id="mainLoginForm" class="login-form">
        <div class="form-group">
          <label for="loginEmail">Usuario o Correo Institucional</label>
          <div class="input-wrapper">
            <svg class="input-icon"><use href="#i-users"/></svg>
            <input 
              type="text" 
              id="loginEmail" 
              class="form-input" 
              required 
              placeholder="Ej.: admin" 
              value="admin" 
              autocomplete="username" 
            />
          </div>
        </div>

        <div class="form-group">
          <label for="loginPin">Contraseña o PIN</label>
          <div class="input-wrapper">
            <svg class="input-icon"><use href="#i-lock"/></svg>
            <input 
              type="password" 
              id="loginPin" 
              class="form-input" 
              required 
              placeholder="••••••••" 
              value="admin123" 
              autocomplete="current-password" 
            />
          </div>
        </div>

        <button type="submit" id="loginSubmitBtn" class="btn-primary-glow">
          <span>Ingresar al Sistema</span>
          <svg class="btn-arrow" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
      </form>

      <!-- Divisor -->
      <div class="login-divider">
        <span class="divider-line"></span>
        <span class="divider-text">Acceso rápido por perfil</span>
        <span class="divider-line"></span>
      </div>

      <!-- Roles Rápidos -->
      <div class="roles-selection-grid">
        <button type="button" class="role-btn-card is-admin" data-user="admin" data-pin="admin123">
          <div class="role-avatar admin-avatar">
            <svg><use href="#i-crown"/></svg>
          </div>
          <div class="role-meta">
            <strong>Administrador</strong>
            <small>Gestión y usuarios</small>
          </div>
        </button>

        <button type="button" class="role-btn-card" data-user="carlos.tecnico@sancarlos.gob.bo" data-pin="admin123">
          <div class="role-avatar tech-avatar">
            <svg><use href="#i-box"/></svg>
          </div>
          <div class="role-meta">
            <strong>Técnico</strong>
            <small>Ingreso de lotes</small>
          </div>
        </button>

        <button type="button" class="role-btn-card" data-user="ana.santafe@sancarlos.gob.bo" data-pin="admin123">
          <div class="role-avatar seller-avatar">
            <svg><use href="#i-cart"/></svg>
          </div>
          <div class="role-meta">
            <strong>Vendedora</strong>
            <small>Sucursal Santa Fe</small>
          </div>
        </button>

        <button type="button" class="role-btn-card" data-user="jose.sancarlos@sancarlos.gob.bo" data-pin="admin123">
          <div class="role-avatar seller-avatar">
            <svg><use href="#i-store"/></svg>
          </div>
          <div class="role-meta">
            <strong>Vendedor</strong>
            <small>Sucursal Central</small>
          </div>
        </button>
      </div>

      <!-- Pie de página con estado -->
      <div class="login-status-footer">
        <span class="status-indicator-dot"></span>
        <span>Conexión activa con Supabase PostgreSQL</span>
      </div>
    </div>
  `;

  // Autocompletar credenciales de admin
  document.getElementById("btnAutofillAdmin")?.addEventListener("click", () => {
    const emailInput = document.getElementById("loginEmail");
    const pinInput = document.getElementById("loginPin");
    if (emailInput) emailInput.value = "admin";
    if (pinInput) pinInput.value = "admin123";
    showToast("Credenciales cargadas", "Usuario: admin | Clave: admin123", "success");
  });

  // Envío del Formulario
  const form = document.getElementById("mainLoginForm");
  const submitBtn = document.getElementById("loginSubmitBtn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const pin = document.getElementById("loginPin").value;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("loading");
        submitBtn.innerHTML = `<span>Verificando credenciales...</span>`;
      }

      await login(email, pin);
      overlay.classList.remove("active");
      overlay.style.display = "none";
      document.body.classList.remove("logged-out");
    } catch (err) {
      showToast("Error de Acceso", err.message, "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("loading");
        submitBtn.innerHTML = `<span>Ingresar al Sistema</span><svg class="btn-arrow" viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;
      }
    }
  });

  // Botones de roles rápidos
  overlay.querySelectorAll(".role-btn-card").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const user = btn.getAttribute("data-user");
      const pin = btn.getAttribute("data-pin") || "admin123";
      try {
        await login(user, pin);
        overlay.classList.remove("active");
        overlay.style.display = "none";
        document.body.classList.remove("logged-out");
      } catch (err) {
        showToast("Error", err.message, "error");
      }
    });
  });
}

export function updateNavbarProfile() {
  const user = getCurrentUser();
  const profileName = document.getElementById("profileName");
  const profileRole = document.getElementById("profileRole");
  const profileAvatar = document.querySelector(".profile span");
  const roleSelect = document.getElementById("roleSelect");

  if (!user) {
    if (profileName) profileName.textContent = "Iniciar Sesión";
    if (profileRole) profileRole.textContent = "Sin autenticar";
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
      if (confirm("¿Deseas cerrar tu sesión?")) {
        logout();
      }
    });

    actionsContainer.appendChild(logoutBtn);
  }
}
