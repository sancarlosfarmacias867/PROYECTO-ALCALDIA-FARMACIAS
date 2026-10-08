/**
 * Farmacias Municipales de San Carlos
 * Orquestador Principal Modular
 */

import { checkSupabaseConnection } from "../config/supabase.js";
import { initAuth, getCurrentUser, switchRole, logout, isAdmin, isTechnician, isSeller, getRoleLabel } from "../services/authService.js";
import { getBranches, getBranchName } from "../services/branchesService.js";
import { showToast } from "../services/toastService.js";

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

  // 2. Verificar Conexión con Supabase
  const syncStatus = document.getElementById("syncStatus");
  const conn = await checkSupabaseConnection();
  if (syncStatus) {
    syncStatus.textContent = conn.message;
  }

  // 3. Cargar Sucursales en el Selector Global
  await populateBranchSelector();

  // 4. Inicializar Navegación y Vistas
  initNavigation();
  applyRoleVisibility();

  // 5. Inicializar Eventos de Diálogos y Módulos
  initUserDialog();
  initPriceDialog();
  initPosEvents();
  initRestockEvents();
  initGlobalEvents();

  // 6. Cargar la vista activa
  await loadActiveView();
}

async function populateBranchSelector() {
  const branchSelect = document.getElementById("branchSelect");
  if (!branchSelect) return;

  const branches = await getBranches();
  const user = getCurrentUser();

  if (user?.role === "vendedor" && user.branch_id !== "all") {
    // Si es vendedor, solo su sucursal
    const userBranch = branches.find((b) => b.id === user.branch_id) || branches[0];
    branchSelect.innerHTML = `<option value="${userBranch.id}">${userBranch.name}</option>`;
    selectedBranch = userBranch.id;
  } else {
    // Admin o Técnico: todas
    branchSelect.innerHTML = `
      <option value="all">Consolidado (Todas las 6)</option>
      ${branches.map((b) => `<option value="${b.id}">${b.name} (${b.code})</option>`).join("")}
    `;
    branchSelect.value = selectedBranch;
  }

  branchSelect.addEventListener("change", async (e) => {
    selectedBranch = e.target.value;
    await loadActiveView();
  });
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
  if (user?.role === "vendedor" && (viewName === "reports" || viewName === "users" || viewName === "entries")) {
    showToast("Acceso Restringido", "Este módulo es exclusivo para administradores o técnicos.", "warning");
    return;
  }
  if (user?.role === "tecnico" && (viewName === "reports" || viewName === "users")) {
    showToast("Acceso Restringido", "Este módulo es exclusivo para administración.", "warning");
    return;
  }

  currentView = viewName;

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

  // Ajustar vista por defecto si el rol actual no tiene acceso a la vista activa
  if (role === "vendedor" && (currentView === "dashboard" || currentView === "reports" || currentView === "users" || currentView === "entries")) {
    switchView("sales");
  } else if (role === "tecnico" && (currentView === "reports" || currentView === "users" || currentView === "sales")) {
    switchView("entries");
  }
}

function initGlobalEvents() {
  // Selector de Rol Rápido en Topbar
  const roleSelect = document.getElementById("roleSelect");
  roleSelect?.addEventListener("change", async (e) => {
    const newRole = e.target.value;
    switchRole(newRole);
    updateNavbarProfile();
    await populateBranchSelector();
    applyRoleVisibility();
    await loadActiveView();
  });

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
    updateNavbarProfile();
    await populateBranchSelector();
    applyRoleVisibility();
    await loadActiveView();
  });
}

// Iniciar aplicación
document.addEventListener("DOMContentLoaded", initApp);

