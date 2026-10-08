/**
 * Módulo de Login y Autenticación
 */
import { login, getCurrentUser, logout, DEFAULT_USERS, getRoleLabel } from "../../services/authService.js";
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
    return;
  }

  overlay.classList.add("active");
  overlay.innerHTML = `
    <div class="login-card">
      <div class="login-brand">
        <div class="brand-floating-logo">
          <img src="/assets/logo-san-carlos.png" alt="Escudo San Carlos" class="floating-logo-img" />
          <div class="logo-glow"></div>
        </div>
        <h2>Farmacias Municipales</h2>
        <p>Gobierno Autónomo Municipal de San Carlos</p>
        <span class="badge-municipal">Sistema Integral de Salud</span>
      </div>

      <form id="mainLoginForm" class="login-form">
        <div class="input-group">
          <label for="loginEmail">Correo Institucional</label>
          <input type="email" id="loginEmail" required placeholder="ejemplo@sancarlos.gob.bo" autocomplete="username" />
        </div>
        <div class="input-group">
          <label for="loginPin">PIN o Contraseña</label>
          <input type="password" id="loginPin" required placeholder="••••" value="1234" autocomplete="current-password" />
        </div>
        <button type="submit" class="button primary full btn-glow">
          <svg width="18" height="18"><use href="#i-check"/></svg>
          Ingresar al Sistema
        </button>
      </form>

      <div class="login-divider"><span>O ingresa con un rol de prueba</span></div>

      <div class="quick-roles-grid">
        <button type="button" class="quick-role-btn" data-email="admin@sancarlos.gob.bo">
          <span class="role-icon">👑</span>
          <div><strong>Administradora</strong><small>María Aguilera</small></div>
        </button>
        <button type="button" class="quick-role-btn" data-email="carlos.tecnico@sancarlos.gob.bo">
          <span class="role-icon">📦</span>
          <div><strong>Técnico Farmacéutico</strong><small>Carlos Rivero</small></div>
        </button>
        <button type="button" class="quick-role-btn" data-email="ana.santafe@sancarlos.gob.bo">
          <span class="role-icon">🛒</span>
          <div><strong>Vendedora · Santa Fe</strong><small>Ana Rojas</small></div>
        </button>
        <button type="button" class="quick-role-btn" data-email="jose.sancarlos@sancarlos.gob.bo">
          <span class="role-icon">💊</span>
          <div><strong>Vendedor · San Carlos</strong><small>José Vaca</small></div>
        </button>
      </div>

      <div class="login-footer">
        <span class="system-indicator">🟢 Supabase PostgreSQL Conectado</span>
      </div>
    </div>
  `;

  // Event Listeners
  const form = document.getElementById("mainLoginForm");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("loginEmail").value;
    const pin = document.getElementById("loginPin").value;
    try {
      await login(email, pin);
      overlay.classList.remove("active");
    } catch (err) {
      showToast("Error de acceso", err.message, "error");
    }
  });

  overlay.querySelectorAll(".quick-role-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const email = btn.getAttribute("data-email");
      try {
        await login(email, "1234");
        overlay.classList.remove("active");
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

  if (!user) return;

  if (profileName) profileName.textContent = user.name;
  if (profileRole) profileRole.textContent = `${getRoleLabel(user.role)} · ${user.branch_id === "all" ? "Central" : user.branch_id}`;
  if (profileAvatar) {
    const initials = user.name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
    profileAvatar.textContent = initials || "SC";
  }
  if (roleSelect) {
    roleSelect.value = user.role;
  }
}
