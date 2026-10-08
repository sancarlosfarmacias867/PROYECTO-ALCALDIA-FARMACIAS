/**
 * Farmacias Municipales de San Carlos
 * Orquestador Principal Modular
 */

import { checkSupabaseConnection } from "../config/supabase.js";
import { initAuth, getCurrentUser, logout, isAdmin, isTechnician, isSeller, getRoleLabel } from "../services/authService.js";
import { getBranches, getBranchName } from "../services/branchesService.js";
import { showToast } from "../services/toastService.js";
import { initSyncEngine } from "../services/syncService.js";

// Importar Vistas Modulares
import { renderLoginOverlay, updateNavbarProfile } from "../modules/auth/loginView.js";
import { renderDashboardModule } from "../modules/dashboard/dashboardView.js";
import { renderInventoryModule, initPriceDialog } from "../modules/inventory/inventoryView.js";
import { renderPosModule, initPosEvents } from "../modules/pos/posView.js";
import { renderRestockModule, initRestockEvents } from "../modules/restock/restockView.js";
import { renderUsersModule, initUserDialog } from "../modules/users/usersView.js";
import { renderAnalyticsModule } from "../modules/analytics/analyticsView.js";

let currentView = "dashboard";
let selectedBranch = "all";

async function initApp() {
  // 1. Inicializar Autenticación
  const user = initAuth();
  updateNavbarProfile();

  // Si no hay usuario logueado, asegurar estado de Login
  if (!user) {
    renderLoginOverlay();
  } else {
    document.documentElement.classList.remove("logged-out");
    document.body.classList.remove("logged-out");
    const overlay = document.getElementById("loginOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.style.display = "none";
    }
  }

  // 2. Inicializar Motor de Sincronización en Tiempo Real y Conectividad
  initSyncEngine();

  // 3. Cargar Sucursales según Rol del Usuario
  await populateBranchSelector();

  // 4. Inicializar Navegación y Vistas con Permisos Estrictos
  initNavigation();
  applyRoleVisibility();

  // 5. Inicializar Eventos de Diálogos y Módulos
  initUserDialog();
  initPriceDialog();
  initPosEvents();
  initRestockEvents();
  initGlobalEvents();

  // 6. Cargar la vista activa si hay sesión iniciada
  if (user) {
    await loadActiveView();
  }
}


async function populateBranchSelector() {
  const branchSelect = document.getElementById("branchSelect");
  const branchLabel = document.querySelector('.context label[for="branchSelect"]');
  if (!branchSelect) return;

  const branches = await getBranches();
  const user = getCurrentUser();

  if (!user) return;

  if (user.role === "admin") {
    // El Administrador ve TODO y puede elegir cualquier sucursal o el consolidado
    branchSelect.disabled = false;
    branchSelect.classList.remove("locked-branch");
    if (branchLabel) branchLabel.innerHTML = "Sucursal";

    branchSelect.innerHTML = `
      <option value="all">Consolidado (Todas las 6)</option>
      ${branches.map((b) => `<option value="${b.id}">${b.name} (${b.code})</option>`).join("")}
    `;
    branchSelect.value = selectedBranch;
  } else {
    // Vendedor o Técnico: SU SUCURSAL ES FIJA, ASIGNADA POR EL ADMINISTRADOR
    const userBranch = branches.find((b) => b.id === user.branch_id) || branches[0];
    selectedBranch = userBranch.id;

    branchSelect.innerHTML = `
      <option value="${userBranch.id}">${userBranch.name} (${userBranch.code})</option>
    `;
    branchSelect.value = userBranch.id;
    branchSelect.disabled = true;
    branchSelect.classList.add("locked-branch");

    if (branchLabel) {
      branchLabel.innerHTML = `Sucursal Asignada 🔒`;
      branchLabel.title = "Sucursal designada por la administración municipal";
    }
  }

  branchSelect.onchange = async (e) => {
    if (user.role === "admin") {
      selectedBranch = e.target.value;
      await loadActiveView();
    }
  };
}

function initNavigation() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetView = btn.getAttribute("data-view");
      await switchView(targetView);
    });
  });

  // Botones de salto rápido (data-go)
  document.querySelectorAll("[data-go]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetView = btn.getAttribute("data-go");
      await switchView(targetView);
    });
  });
}

async function switchView(viewName) {
  const user = getCurrentUser();

  // Validar permisos por rol
  if (user?.role === "vendedor" && viewName !== "sales" && viewName !== "inventory") {
    showToast("Acceso Restringido", "Este módulo es exclusivo para administradores o técnicos.", "warning");
    return;
  }
  if (user?.role === "tecnico" && viewName !== "entries" && viewName !== "inventory") {
    showToast("Acceso Restringido", "Este módulo es exclusivo para administración o ventas.", "warning");
    return;
  }

  currentView = viewName;
  document.body.setAttribute("data-current-view", viewName);

  // En Control y Reportes se usan filtros propios dedicados: ocultar selector superior
  const topbarContext = document.querySelector(".topbar .context");
  if (topbarContext) {
    topbarContext.style.display = (viewName === "reports" || viewName === "users") ? "none" : "";
  }

  // Actualizar clases de botones
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === viewName);
  });

  // Mostrar sección activa
  document.querySelectorAll(".view").forEach((viewEl) => {
    viewEl.classList.toggle("active", viewEl.id === `view-${viewName}`);
  });

  // Cerrar sidebar en móvil si está abierto
  document.getElementById("sidebar")?.classList.remove("open");

  await loadActiveView();
}

async function loadActiveView() {
  switch (currentView) {
    case "dashboard":
      await renderDashboardModule(selectedBranch);
      break;
    case "inventory":
      await renderInventoryModule(selectedBranch);
      break;
    case "sales":
      await renderPosModule(selectedBranch);
      break;
    case "entries":
      await renderRestockModule(selectedBranch);
      break;
    case "reports":
      await renderAnalyticsModule(selectedBranch);
      break;
    case "users":
      await renderUsersModule();
      break;
  }
}

function applyRoleVisibility() {
  const user = getCurrentUser();
  if (!user) return;

  const role = user.role;

  // Ocultar / Mostrar elementos según data-roles
  document.querySelectorAll("[data-roles]").forEach((el) => {
    const allowed = el.getAttribute("data-roles").split(",").map((r) => r.trim());
    el.style.display = allowed.includes(role) ? "" : "none";
  });

  // Clases admin-only
  document.querySelectorAll(".admin-only").forEach((el) => {
    if (role === "admin") {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });

  // Redirigir a vista autorizada según rol
  if (role === "vendedor") {
    if (currentView !== "sales" && currentView !== "inventory") {
      switchView("sales");
    }
  } else if (role === "tecnico") {
    if (currentView !== "entries" && currentView !== "inventory") {
      switchView("entries");
    }
  } else if (role === "admin") {
    // Si estaba en vista no válida, volver a dashboard
    if (!["dashboard", "inventory", "sales", "entries", "reports", "users"].includes(currentView)) {
      switchView("dashboard");
    }
  }
}

function initGlobalEvents() {

  // Click en Perfil para abrir Login / Switch
  document.querySelector(".profile")?.addEventListener("click", () => {
    renderLoginOverlay();
  });

  // Click en Brand / Logo flotante para abrir Login
  document.querySelector(".brand")?.addEventListener("click", () => {
    renderLoginOverlay();
  });

  // Cerrar Diálogo de Movimiento / Comprobante
  document.querySelectorAll("[data-close-movement]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dialog = document.getElementById("movementDialog");
      dialog?.close();
    });
  });

  // Alertas Drawer
  const notifBtn = document.getElementById("notificationButton");
  const alertDrawer = document.getElementById("alertDrawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const closeAlerts = document.getElementById("closeAlerts");

  notifBtn?.addEventListener("click", async () => {
    alertDrawer?.classList.add("open");
    drawerBackdrop?.classList.add("open");
  });

  closeAlerts?.addEventListener("click", () => {
    alertDrawer?.classList.remove("open");
    drawerBackdrop?.classList.remove("open");
  });

  drawerBackdrop?.addEventListener("click", () => {
    alertDrawer?.classList.remove("open");
    drawerBackdrop?.classList.remove("open");
    document.getElementById("sidebar")?.classList.remove("open");
  });

  // Menú Móvil Hamburguesa
  const menuBtn = document.getElementById("menuButton");
  const sidebar = document.getElementById("sidebar");
  menuBtn?.addEventListener("click", () => {
    sidebar?.classList.toggle("open");
    drawerBackdrop?.classList.toggle("open");
  });

  // Evento de cambio de autenticación
  window.addEventListener("pharmacy-auth-change", async (e) => {
    const user = e.detail?.user;
    updateNavbarProfile();
    if (!user) {
      renderLoginOverlay(true);
      return;
    }
    await populateBranchSelector();
    applyRoleVisibility();
    await loadActiveView();
  });

  // Evento de sincronización y cambio de datos en tiempo real
  let reloadTimeout = null;
  window.addEventListener("pharmacy-data-change", () => {
    // Evitar recargar vistas de forma disruptiva si un diálogo modal o un input de texto está activo
    const activeDialog = document.querySelector("dialog[open]");
    if (activeDialog) return;

    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(async () => {
      const user = getCurrentUser();
      if (user) {
        await loadActiveView();
      }
    }, 450);
  });
}

// Iniciar aplicación
document.addEventListener("DOMContentLoaded", initApp);

