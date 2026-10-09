/**
 * Módulo de Login Oficial e Institucional con Seguridad Progresiva
 * Gobierno Autónomo Municipal de San Carlos
 */
import { login, getCurrentUser, logout, getRoleLabel } from "../../services/authService.js";
import { showToast } from "../../services/toastService.js";
import { showSystemConfirm } from "../../services/dialogService.js";

const LOCK_KEY = "farmacias_security_lockout_v1";
let countdownInterval = null;

function getLockState() {
  try {
    const saved = localStorage.getItem(LOCK_KEY);
    if (saved) return JSON.parse(saved);
  } catch (_) {}
  return { attempts: 0, lockTier: 0, lockedUntil: 0 };
}

function saveLockState(state) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(state));
}

function clearLockState() {
  localStorage.removeItem(LOCK_KEY);
}

export function getLoginTemplate() {
  return `
    <!-- Capas de fondo con imagen panorámica y degradado verde institucional -->
    <div class="login-bg-wrapper">
      <div class="login-bg-photo"></div>
      <div class="login-bg-overlay"></div>
    </div>

    <!-- Tarjeta Principal de Inicio de Sesión -->
    <div class="login-card-official">
      <!-- Encabezado Institucional -->
      <div class="official-header">
        <div class="official-shield-container">
          <div class="shield-aura"></div>
          <img src="/assets/logo-san-carlos.png" alt="Escudo Oficial del Municipio de San Carlos" class="official-shield-img" />
        </div>
        <span class="badge-governmental">GOBIERNO AUTÓNOMO MUNICIPAL DE SAN CARLOS</span>
        <h1 class="official-title">Red Municipal de Farmacias</h1>
        <p class="official-subtitle">Sistema Integrado de Farmacias y Suministros SUS</p>
      </div>

      <!-- Banner de Seguridad Normal -->
      <div class="security-banner" id="normalSecurityBanner">
        <svg class="security-icon"><use href="#i-shield"/></svg>
        <div>
          <strong>PORTAL OFICIAL DE ACCESO</strong>
          <small>Acceso exclusivo a funcionarios y personal médico autorizado</small>
        </div>
      </div>

      <!-- Banner de Alerta Roja por Error de Credenciales -->
      <div class="security-error-banner hidden" id="loginErrorBanner">
        <svg class="security-error-icon" viewBox="0 0 24 24">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM12 8v4m0 4h.01"/>
        </svg>
        <div>
          <strong id="errorBannerTitle">Credenciales no autorizadas</strong>
          <small id="errorBannerText">Verifique su usuario y contraseña.</small>
        </div>
      </div>

      <!-- Formulario de Acceso -->
      <form id="mainLoginForm" class="official-form" autocomplete="on">
        <div class="official-form-group">
          <label for="loginEmail">Usuario Institucional</label>
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
          <div class="label-with-warning">
            <label for="loginPin">Contraseña</label>
            <span id="capsWarning" class="caps-warning hidden">
              <svg width="12" height="12" viewBox="0 0 24 24"><path d="M12 2l10 18H2L12 2zM12 9v4m0 4h.01"/></svg>
              Bloq Mayús activado
            </span>
          </div>
          <div class="official-input-wrap">
            <svg class="official-input-icon"><use href="#i-lock"/></svg>
            <input 
              type="password" 
              id="loginPin" 
              class="official-input" 
              required 
              placeholder="••••••••••••" 
              autocomplete="current-password" 
            />
            <button type="button" class="btn-toggle-password" id="togglePasswordBtn" title="Mostrar u ocultar contraseña" aria-label="Mostrar u ocultar contraseña">
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
          <span>Servidor Central Activo · Conexión Segura</span>
        </div>
        <p class="copyright-legal">
          Dirección Municipal de Salud · San Carlos, Santa Cruz, Bolivia
        </p>
      </div>
    </div>
  `;
}

export function renderLoginOverlay(forceRebuild = false) {
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
    document.documentElement.classList.remove("logged-out");
    return;
  }

  document.documentElement.classList.add("logged-out");
  document.body.classList.add("logged-out");
  overlay.classList.add("active");
  overlay.style.display = "flex";

  if (forceRebuild || !overlay.querySelector("#mainLoginForm")) {
    overlay.innerHTML = getLoginTemplate();
  }

  // Inicializar componentes interactivos
  setupInteractiveElements();
  checkExistingLockout();
}

function setupInteractiveElements() {
  const toggleBtn = document.getElementById("togglePasswordBtn");
  const pinInput = document.getElementById("loginPin");
  const eyeOpen = document.getElementById("eyeIconOpen");
  const eyeClosed = document.getElementById("eyeIconClosed");
  const capsWarning = document.getElementById("capsWarning");
  const form = document.getElementById("mainLoginForm");

  // Toggle de Contraseña visible / oculta
  toggleBtn?.addEventListener("click", () => {
    if (!pinInput) return;
    const isPassword = pinInput.type === "password";
    pinInput.type = isPassword ? "text" : "password";
    if (eyeOpen && eyeClosed) {
      eyeOpen.classList.toggle("hidden", isPassword);
      eyeClosed.classList.toggle("hidden", !isPassword);
    }
  });

  // Detección de Bloq Mayús
  pinInput?.addEventListener("keyup", (e) => {
    if (e.getModifierState && capsWarning) {
      const isCaps = e.getModifierState("CapsLock");
      capsWarning.classList.toggle("hidden", !isCaps);
    }
  });

  // Envío del Formulario
  form?.addEventListener("submit", handleFormSubmit);
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const emailInput = document.getElementById("loginEmail");
  const pinInput = document.getElementById("loginPin");
  const submitBtn = document.getElementById("loginSubmitBtn");
  const submitText = document.getElementById("submitBtnText");
  const card = document.querySelector(".login-card-official");

  const email = emailInput?.value.trim();
  const pin = pinInput?.value.trim();

  // Verificar si actualmente está bloqueado
  const lockState = getLockState();
  if (lockState.lockedUntil && Date.now() < lockState.lockedUntil) {
    triggerCardShake(card);
    showToast("Acceso Bloqueado", "El sistema se encuentra en periodo de bloqueo temporal.", "error");
    return;
  }

  try {
    if (submitBtn && submitText) {
      submitBtn.disabled = true;
      submitBtn.classList.add("loading");
      submitText.textContent = "Verificando credenciales...";
    }

    // Intento de autenticación real
    await login(email, pin);

    // Éxito: limpiar bloqueo
    clearLockState();
    const overlay = document.getElementById("loginOverlay");
    overlay?.classList.remove("active");
    if (overlay) overlay.style.display = "none";
    document.body.classList.remove("logged-out");
    document.documentElement.classList.remove("logged-out");

  } catch (err) {
    // Error de autenticación: disparar vibración y política progresiva
    triggerCardShake(card);
    handleFailedAttempt();
    showToast("Acceso Denegado", err.message, "error");
  } finally {
    const currentState = getLockState();
    if (!currentState.lockedUntil || Date.now() >= currentState.lockedUntil) {
      if (submitBtn && submitText) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("loading");
        submitText.textContent = "Ingresar al Sistema";
      }
    }
  }
}

function triggerCardShake(card) {
  if (!card) return;
  card.classList.remove("shake-error");
  void card.offsetWidth; // Forzar reflujo para reiniciar la animación
  card.classList.add("shake-error");
}

function handleFailedAttempt() {
  const state = getLockState();
  state.attempts = (state.attempts || 0) + 1;

  if (state.lockTier === 0) {
    // Primer ciclo: 3 intentos permitidos
    if (state.attempts >= 3) {
      // Primer bloqueo: 5 minutos
      state.lockTier = 1;
      const minutes = 5;
      state.lockedUntil = Date.now() + minutes * 60 * 1000;
      saveLockState(state);
      startCountdownTimer(state.lockedUntil, minutes);
      showErrorAlert(`Acceso bloqueado por seguridad (${minutes} min)`, `Superó el límite de 3 intentos fallidos. Espere el tiempo establecido.`);
    } else {
      const remaining = 3 - state.attempts;
      saveLockState(state);
      showErrorAlert(
        `Credenciales incorrectas (Intento ${state.attempts} de 3)`,
        `Le queda${remaining === 1 ? "" : "n"} ${remaining} intento${remaining === 1 ? "" : "s"} antes de suspender el acceso.`
      );
    }
  } else {
    // Si ya tuvo un bloqueo previo y se vuelve a equivocar: escalamiento progresivo
    state.lockTier += 1;
    let minutes = 15;
    if (state.lockTier === 2) minutes = 15;
    else if (state.lockTier === 3) minutes = 30;
    else if (state.lockTier === 4) minutes = 60;
    else minutes = 120; // 2 horas máximo

    state.lockedUntil = Date.now() + minutes * 60 * 1000;
    saveLockState(state);
    startCountdownTimer(state.lockedUntil, minutes);
    showErrorAlert(
      `Acceso suspendido nuevamente (${minutes} min)`,
      `Intento no autorizado tras reactivación. Bloqueo extendido a ${minutes} minutos.`
    );
  }
}

function showErrorAlert(title, message) {
  const normalBanner = document.getElementById("normalSecurityBanner");
  const errorBanner = document.getElementById("loginErrorBanner");
  const titleEl = document.getElementById("errorBannerTitle");
  const textEl = document.getElementById("errorBannerText");

  if (normalBanner) normalBanner.classList.add("hidden");
  if (errorBanner) errorBanner.classList.remove("hidden");
  if (titleEl) titleEl.textContent = title;
  if (textEl) textEl.textContent = message;
}

function checkExistingLockout() {
  const state = getLockState();
  if (state.lockedUntil && Date.now() < state.lockedUntil) {
    const remainingMs = state.lockedUntil - Date.now();
    const remainingMins = Math.ceil(remainingMs / (60 * 1000));
    startCountdownTimer(state.lockedUntil, remainingMins);
    showErrorAlert(
      `Acceso bloqueado por seguridad`,
      `El sistema se encuentra temporalmente suspendido por intentos fallidos previos.`
    );
  }
}

function startCountdownTimer(lockedUntil, totalMinutes) {
  clearInterval(countdownInterval);
  const emailInput = document.getElementById("loginEmail");
  const pinInput = document.getElementById("loginPin");
  const submitBtn = document.getElementById("loginSubmitBtn");
  const submitText = document.getElementById("submitBtnText");

  if (emailInput) emailInput.disabled = true;
  if (pinInput) pinInput.disabled = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.classList.add("is-locked");
  }

  function update() {
    const now = Date.now();
    const diff = lockedUntil - now;

    if (diff <= 0) {
      clearInterval(countdownInterval);
      const state = getLockState();
      state.lockedUntil = 0;
      saveLockState(state);

      if (emailInput) emailInput.disabled = false;
      if (pinInput) pinInput.disabled = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.classList.remove("is-locked");
      }
      if (submitText) submitText.textContent = "Ingresar al Sistema";

      showErrorAlert(
        "Bloqueo finalizado",
        "Puede ingresar sus credenciales nuevamente con precaución."
      );
      return;
    }

    const totalSecs = Math.floor(diff / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    const timeFormatted = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

    if (submitText) {
      submitText.textContent = `Bloqueado por seguridad (${timeFormatted})`;
    }
  }

  update();
  countdownInterval = setInterval(update, 1000);
}

export function updateNavbarProfile() {
  const user = getCurrentUser();
  const profileName = document.getElementById("profileName");
  const profileRole = document.getElementById("profileRole");
  const profileAvatar = document.querySelector(".profile span");

  if (!user) {
    if (profileName) profileName.textContent = "Sin sesión";
    if (profileRole) profileRole.textContent = "Acceso restringido";
    if (profileAvatar) profileAvatar.textContent = "--";
    renderLoginOverlay();
    return;
  }

  if (profileName) profileName.textContent = user.name;
  const branchName = user.branch_id === "all" ? "Central" : user.branch_id.toUpperCase();
  if (profileRole) profileRole.textContent = `${getRoleLabel(user.role)} · ${branchName}`;
  if (profileAvatar) {
    const initials = (user.name || "SC").split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
    profileAvatar.textContent = initials || "SC";
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

    logoutBtn.addEventListener("click", async () => {
      const confirmed = await showSystemConfirm({
        eyebrow: "SEGURIDAD DE LA SESIÓN",
        title: "¿Cerrar sesión ahora?",
        message: "Finalizará su acceso al sistema municipal en este dispositivo.",
        detail: "Los registros guardados ya están sincronizados. Para volver a operar deberá ingresar nuevamente sus credenciales.",
        confirmLabel: "Sí, cerrar sesión",
        cancelLabel: "Continuar trabajando",
        variant: "logout",
        icon: "i-lock"
      });
      if (confirmed) logout();
    });

    actionsContainer.appendChild(logoutBtn);
  }
}
