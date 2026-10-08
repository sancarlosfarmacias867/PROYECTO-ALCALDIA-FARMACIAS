/**
 * Módulo de Login y Autenticación con Animaciones y Elegancia
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

  // Si no hay usuario, mostrar login a pantalla completa
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
      <div class="login-brand">
        <div class="brand-floating-logo">
          <div class="logo-glow-ring"></div>
          <img src="/assets/logo-san-carlos.png" alt="Escudo San Carlos" class="floating-logo-img" />
        </div>
        <span class="badge-municipal">SISTEMA MUNICIPAL DE SALUD</span>
        <h2>Farmacias de San Carlos</h2>
        <p>Control de Inventarios, Ventas y Entregas SUS</p>
      </div>

      <!-- Credenciales predefinidas destacadas -->
      <div class="admin-credentials-banner" id="btnAutofillAdmin" role="button" tabindex="0" title="Clic para autocompletar credenciales de Administrador">
        <div class="banner-icon">🔐</div>
        <div class="banner-text">
          <small>Credenciales de Administrador:</small>
          <strong>Usuario: <code>admin</code> &nbsp;|&nbsp; Clave: <code>admin123</code></strong>
        </div>
        <button type="button" class="btn-autofill-pill">Autocompletar ⚡</button>
      </div>

      <form id="mainLoginForm" class="login-form">
        <div class="input-group">
          <label for="loginEmail">Usuario o Correo Institucional</label>
          <div class="input-field-wrap">
            <svg class="field-icon"><use href="#i-users"/></svg>
            <input type="text" id="loginEmail" required placeholder="admin" value="admin" autocomplete="username" />
          </div>
        </div>

        <div class="input-group">
          <label for="loginPin">Contraseña de Acceso</label>
          <div class="input-field-wrap">
            <svg class="field-icon"><use href="#i-lock"/></svg>
            <input type="password" id="loginPin" required placeholder="••••••••" value="admin123" autocomplete="current-password" />
          </div>
        </div>

        <button type="submit" id="loginSubmitBtn" class="button primary full btn-glow">
          <svg width="20" height="20"><use href="#i-check"/></svg>
          Iniciar Sesión
        </button>
      </form>

      <div class="login-divider">
        <span>O accede con un rol rápido</span>
      </div>

      <div class="quick-roles-grid">
        <button type="button" class="quick-role-btn highlight" data-user="admin" data-pin="admin123">
          <span class="role-icon">👑</span>
          <div>
            <strong>Administradora</strong>
            <small>Gestión total y usuarios</small>
          </div>
        </button>
        <button type="button" class="quick-role-btn" data-user="carlos.tecnico@sancarlos.gob.bo" data-pin="admin123">
          <span class="role-icon">📦</span>
          <div>
            <strong>Técnico</strong>
            <small>Ingreso de lotes</small>
          </div>
        </button>
        <button type="button" class="quick-role-btn" data-user="ana.santafe@sancarlos.gob.bo" data-pin="admin123">
          <span class="role-icon">🛒</span>
          <div>
            <strong>Vendedora</strong>
            <small>Santa Fe (Ventas & SUS)</small>
          </div>
        </button>
        <button type="button" class="quick-role-btn" data-user="jose.sancarlos@sancarlos.gob.bo" data-pin="admin123">
          <span class="role-icon">💊</span>
          <div>
            <strong>Vendedor</strong>
            <small>San Carlos Central</small>
          </div>
        </button>
      </div>

      <div class="login-footer">
        <span class="system-indicator">
          <span class="pulse-dot"></span>
          Conectado a Base de Datos Supabase (PostgreSQL 17)
        </span>
      </div>
    </div>
  `;

  // Listener para el botón autocompletar
  document.getElementById("btnAutofillAdmin")?.addEventListener("click", () => {
    const emailInput = document.getElementById("loginEmail");
    const pinInput = document.getElementById("loginPin");
    if (emailInput) emailInput.value = "admin";
    if (pinInput) pinInput.value = "admin123";
    showToast("Datos completados", "Credenciales de Administrador cargadas. Haz clic en 'Iniciar Sesión'.");
  });

  // Submit Form
  const form = document.getElementById("mainLoginForm");
  const submitBtn = document.getElementById("loginSubmitBtn");

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const pin = document.getElementById("loginPin").value;

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Verificando en Supabase...";
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
        submitBtn.innerHTML = `<svg width="20" height="20"><use href="#i-check"/></svg> Iniciar Sesión`;
      }
    }
  });

  // Botones de rol rápido
  overlay.querySelectorAll(".quick-role-btn").forEach((btn) => {
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
  const logoutBtn = document.getElementById("topbarLogoutBtn");

  if (!user) {
    if (profileName) profileName.textContent = "Iniciar Sesión";
    if (profileRole) profileRole.textContent = "Sin autenticar";
    if (profileAvatar) profileAvatar.textContent = "??";
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

  // Asegurar botón de cerrar sesión
  ensureLogoutButton();
}

function ensureLogoutButton() {
  let logoutBtn = document.getElementById("topbarLogoutBtn");
  const actionsContainer = document.querySelector(".topbar-actions");

  if (!logoutBtn && actionsContainer) {
    logoutBtn = document.createElement("button");
    logoutBtn.id = "topbarLogoutBtn";
    logoutBtn.className = "icon-button danger-hover";
    logoutBtn.title = "Cerrar sesión";
    logoutBtn.setAttribute("aria-label", "Cerrar sesión");
    logoutBtn.innerHTML = `<svg width="18" height="18"><use href="#i-close"/></svg><span class="logout-label">Salir</span>`;
    
    logoutBtn.addEventListener("click", () => {
      if (confirm("¿Deseas cerrar tu sesión?")) {
        logout();
      }
    });

    actionsContainer.appendChild(logoutBtn);
  }
}
