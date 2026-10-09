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
import { getInventory, getExpiryStatus, invalidateInventoryCache } from "../services/inventoryService.js";
import { invalidateMovementsCache } from "../services/salesService.js";
import { invalidateEntriesCache } from "../services/entriesService.js";
import { invalidateUsersCache } from "../services/usersService.js";

let currentView = "dashboard";
let selectedBranch = "all";
let lastSpecificBranch = "san-carlos";

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
    updateNotificationsUI();
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
    // El Administrador ve las sucursales según el contexto del módulo
    branchSelect.disabled = false;
    branchSelect.classList.remove("locked-branch");
    if (branchLabel) branchLabel.innerHTML = "Sucursal";

    // En Ventas y en Ingresos está prohibido el consolidado (debe ser una farmacia física individual)
    const isSingleBranchModule = currentView === "sales" || currentView === "entries";

    if (isSingleBranchModule) {
      // Si la sucursal seleccionada era "all", cambiar automáticamente a una sucursal específica
      if (selectedBranch === "all" || !branches.some((b) => b.id === selectedBranch)) {
        selectedBranch = (lastSpecificBranch && branches.some((b) => b.id === lastSpecificBranch))
          ? lastSpecificBranch
          : branches[0]?.id || "san-carlos";
      } else {
        lastSpecificBranch = selectedBranch;
      }

      // Opciones SIN "Consolidado"
      branchSelect.innerHTML = branches
        .map((b) => `<option value="${b.id}">${b.name} (${b.code})</option>`)
        .join("");
      branchSelect.value = selectedBranch;
    } else {
      // En Dashboard, Inventario y Reportes se permite "Consolidado (Todas las 6)"
      branchSelect.innerHTML = `
        <option value="all">Consolidado (Todas las 6)</option>
        ${branches.map((b) => `<option value="${b.id}">${b.name} (${b.code})</option>`).join("")}
      `;
      branchSelect.value = selectedBranch;
    }
  } else {
    // Vendedor o Técnico: SU SUCURSAL ES FIJA, ASIGNADA POR EL ADMINISTRADOR
    const userBranch = branches.find((b) => b.id === user.branch_id) || branches[0];
    selectedBranch = userBranch.id;
    lastSpecificBranch = userBranch.id;

    branchSelect.innerHTML = `
      <option value="${userBranch.id}">${userBranch.name} (${userBranch.code})</option>
    `;
    branchSelect.value = userBranch.id;
    branchSelect.disabled = true;
    branchSelect.classList.add("locked-branch");

    if (branchLabel) {
      branchLabel.innerHTML = `Sucursal Asignada`;
      branchLabel.title = "Sucursal designada por la administración municipal";
    }
  }

  branchSelect.onchange = async (e) => {
    if (user.role === "admin") {
      selectedBranch = e.target.value;
      if (selectedBranch !== "all") {
        lastSpecificBranch = selectedBranch;
      }
      await loadActiveView();
      updateNotificationsUI();
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

  // Cerrar sidebar y backdrop en móvil si está abierto
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("drawerBackdrop")?.classList.remove("open");

  // Actualizar el selector de sucursal según las reglas del módulo activo (excluyendo consolidado en ventas e ingresos)
  await populateBranchSelector();

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
    await updateNotificationsUI();
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
    await updateNotificationsUI();
  });

  // Evento de sincronización y cambio de datos en tiempo real
  let reloadTimeout = null;
  window.addEventListener("pharmacy-data-change", () => {
    const activeDialog = document.querySelector("dialog[open]");
    if (activeDialog) return;

    if (reloadTimeout) clearTimeout(reloadTimeout);
    reloadTimeout = setTimeout(async () => {
      invalidateInventoryCache();
      invalidateMovementsCache();
      invalidateEntriesCache();
      invalidateUsersCache();
      const user = getCurrentUser();
      if (user) {
        await loadActiveView();
        updateNotificationsUI();
      }
    }, 450);
  });
}

/**
 * Actualizar contador y contenido de notificaciones según el rol y sucursal
 */
export async function updateNotificationsUI() {
  const user = getCurrentUser();
  if (!user) return;

  const branches = await getBranches();
  const alertCountEl = document.getElementById("alertCount");
  const drawerAlertsEl = document.getElementById("drawerAlerts");

  // Al administrador le salen todos ("all"); a cada sucursal individual solo su inventario
  const branchFilter = user.role === "admin" ? "all" : (user.branch_id || "all");
  const inventory = await getInventory(branchFilter, false);

  // Filtrar medicamentos con existencias que vencen en menos de 3 meses (rojo/vencido) o hasta 6 meses (amarillo)
  const expiringItems = (inventory || [])
    .filter((item) => Number(item.quantity) > 0)
    .map((item) => {
      const exp = getExpiryStatus(item.expiry);
      return { ...item, expiryStatus: exp };
    })
    .filter((item) =>
      item.expiryStatus.status === "expired" ||
      item.expiryStatus.status === "red" ||
      item.expiryStatus.status === "yellow"
    )
    .sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

  // Actualizar contador en la campana
  if (alertCountEl) {
    alertCountEl.textContent = expiringItems.length;
    alertCountEl.style.display = expiringItems.length > 0 ? "inline-flex" : "none";
  }

  // Renderizar contenido del panel lateral
  if (drawerAlertsEl) {
    if (expiringItems.length === 0) {
      drawerAlertsEl.innerHTML = `
        <div class="drawer-empty-state">
          <div class="drawer-empty-icon">
            <svg width="24" height="24"><use href="#i-check"/></svg>
          </div>
          <h3>Sin alertas de vencimiento</h3>
          <p>${
            user.role === "admin"
              ? "No se registran medicamentos próximos a vencer en el inventario municipal."
              : "No se registran medicamentos próximos a vencer en el inventario de esta sucursal."
          }</p>
        </div>
      `;
    } else {
      drawerAlertsEl.innerHTML = `
        <span class="drawer-alerts-summary">
          ${expiringItems.length} lote(s) en seguimiento de vencimiento
        </span>
        <div class="drawer-alerts-list">
          ${expiringItems
            .map((item) => {
              const branchName = getBranchName(item.branch_id, branches);
              const isUrgent = item.expiryStatus.status === "expired" || item.expiryStatus.status === "red";
              const badgeClass = isUrgent ? "badge-danger" : "badge-warning";
              const statusText =
                item.expiryStatus.status === "expired"
                  ? "Lote vencido"
                  : item.expiryStatus.status === "red"
                  ? `Vence en ${item.expiryStatus.months} mes(es) (Crítico)`
                  : `Vence en ${item.expiryStatus.months} mes(es) (Atención)`;

              return `
                <div class="drawer-alert-card ${isUrgent ? "urgent" : "warning"}" data-name="${item.name}" data-branch="${item.branch_id}">
                  <div class="drawer-alert-top">
                    <strong class="drawer-alert-title">${item.name}</strong>
                    <span class="status-badge ${badgeClass}">${statusText}</span>
                  </div>
                  <div class="drawer-alert-meta">
                    <span class="drawer-alert-lot">LOTE: ${item.lot}</span>
                    <span class="drawer-alert-stock">Stock: ${item.quantity} unidades</span>
                    ${user.role === "admin" ? `<span class="drawer-alert-branch">${branchName}</span>` : ""}
                  </div>
                  <div class="drawer-alert-bottom">
                    <span class="drawer-alert-date">Vencimiento: ${item.expiry}</span>
                    <button type="button" class="btn-drawer-goto">
                      <span>Ver en inventario</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m9 18 6-6-6-6"/></svg>
                    </button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `;

      // Evento de redirección al inventario al hacer clic en cualquier tarjeta
      drawerAlertsEl.querySelectorAll(".drawer-alert-card").forEach((card) => {
        card.addEventListener("click", async () => {
          const medName = card.getAttribute("data-name");
          const medBranch = card.getAttribute("data-branch");
          await navigateToInventory(medName, medBranch);
        });
      });
    }
  }
}

/**
 * Cerrar panel de alertas y redirigir al inventario filtrando por el medicamento
 */
async function navigateToInventory(medicineName = "", branchId = "") {
  const user = getCurrentUser();

  // Cerrar el panel de notificaciones
  document.getElementById("alertDrawer")?.classList.remove("open");
  document.getElementById("drawerBackdrop")?.classList.remove("open");

  // Si es admin y el producto es de una sucursal específica, sincronizar selector de sucursal
  if (user?.role === "admin" && branchId) {
    selectedBranch = branchId;
    const branchSelect = document.getElementById("branchSelect");
    if (branchSelect) branchSelect.value = branchId;
  }

  // Redirigir al módulo de Inventario
  await switchView("inventory");

  // Filtrar automáticamente por el nombre del medicamento en la tabla
  if (medicineName) {
    setTimeout(() => {
      const searchInput = document.getElementById("inventorySearch");
      if (searchInput) {
        searchInput.value = medicineName;
        searchInput.dispatchEvent(new Event("input"));
        searchInput.focus();
      }
    }, 120);
  }
}

// Iniciar aplicación
document.addEventListener("DOMContentLoaded", initApp);

