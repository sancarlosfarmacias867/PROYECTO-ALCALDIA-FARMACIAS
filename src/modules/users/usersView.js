/**
 * Módulo de Administración de Usuarios y Roles (Supabase)
 */
import { getUsers, createUser, updateUser, toggleUserActive, deleteUser } from "../../services/usersService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { getRoleLabel, getCurrentUser } from "../../services/authService.js";
import { showToast } from "../../services/toastService.js";

export async function renderUsersModule() {
  const usersContainer = document.getElementById("usersTable");
  const roleSummary = document.getElementById("roleSummary");
  const userCount = document.getElementById("userCount");
  const userSearch = document.getElementById("userSearch");

  if (!usersContainer) return;

  const users = await getUsers();
  const branches = await getBranches();

  // Role summary
  if (roleSummary) {
    const adminCount = users.filter((u) => u.role === "admin").length;
    const tecnicoCount = users.filter((u) => u.role === "tecnico").length;
    const vendedorCount = users.filter((u) => u.role === "vendedor").length;

    roleSummary.innerHTML = `
      <div class="role-card admin-border">
        <span class="role-badge admin">Administrador</span>
        <h3>${adminCount} usuarios</h3>
        <p>Control total, márgenes de ganancia, usuarios y auditoría de las 6 sucursales.</p>
      </div>
      <div class="role-card tech-border">
        <span class="role-badge tech">Técnico Farmacéutico</span>
        <h3>${tecnicoCount} usuarios</h3>
        <p>Ingreso de lotes, control de existencias, vencimientos y abastecimiento.</p>
      </div>
      <div class="role-card seller-border">
        <span class="role-badge seller">Vendedor(a) / SUS</span>
        <h3>${vendedorCount} usuarios</h3>
        <p>Punto de venta directo, ventas normales y dispensación gratuita SUS.</p>
      </div>
    `;
  }

  function filterAndDraw() {
    const term = (userSearch?.value || "").toLowerCase();
    const filtered = users.filter(
      (u) =>
        u.name.toLowerCase().includes(term) ||
        u.email.toLowerCase().includes(term) ||
        getRoleLabel(u.role).toLowerCase().includes(term) ||
        getBranchName(u.branch_id, branches).toLowerCase().includes(term)
    );

    if (userCount) userCount.textContent = `${filtered.length} de ${users.length} usuarios`;

    if (filtered.length === 0) {
      usersContainer.innerHTML = `<tr><td colspan="6" class="text-center py-4">No se encontraron usuarios.</td></tr>`;
      return;
    }

    usersContainer.innerHTML = filtered
      .map((u) => {
        const branchName = u.branch_id === "all" ? "Todas las sucursales" : getBranchName(u.branch_id, branches);
        const roleClass = u.role === "admin" ? "admin" : u.role === "tecnico" ? "tech" : "seller";
        const isActive = u.active !== false;

        return `
          <tr class="${isActive ? "" : "row-inactive"}">
            <td>
              <div class="user-cell">
                <span class="user-avatar ${roleClass}">${u.name.charAt(0)}</span>
                <div>
                  <strong>${u.name}</strong>
                  <small>${u.email}</small>
                </div>
              </div>
            </td>
            <td><span class="role-badge ${roleClass}">${getRoleLabel(u.role)}</span></td>
            <td><span class="branch-tag">${branchName}</span></td>
            <td>
              <button class="status-pill ${isActive ? "active" : "inactive"}" data-toggle-id="${u.id}" data-current="${isActive}">
                <span class="dot"></span> ${isActive ? "Activo" : "Inactivo"}
              </button>
            </td>
            <td><small class="text-muted">${u.last_access ? new Date(u.last_access).toLocaleDateString("es-BO") : "Reciente"}</small></td>
            <td>
              <div class="action-buttons">
                <button class="icon-button danger delete-user-btn" data-id="${u.id}" data-name="${u.name}" title="Eliminar usuario">
                  <svg width="16" height="16"><use href="#i-close"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    // Toggle status handlers
    usersContainer.querySelectorAll("[data-toggle-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-toggle-id");
        const current = btn.getAttribute("data-current") === "true";
        try {
          await toggleUserActive(id, current);
          await renderUsersModule();
        } catch (e) {
          showToast("Error", e.message, "error");
        }
      });
    });

    // Delete user handlers
    usersContainer.querySelectorAll(".delete-user-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");
        if (confirm(`¿Está seguro de eliminar al usuario ${name}? Esta acción se reflejará en Supabase.`)) {
          try {
            await deleteUser(id);
            await renderUsersModule();
          } catch (e) {
            showToast("Error", e.message, "error");
          }
        }
      });
    });
  }

  userSearch?.addEventListener("input", filterAndDraw);
  filterAndDraw();
}

export function initUserDialog() {
  const dialog = document.getElementById("userDialog");
  const openBtn = document.getElementById("newUserButton");
  const form = document.getElementById("userForm");
  const branchSelect = document.getElementById("userBranch");

  if (!dialog || !openBtn || !form) return;

  openBtn.addEventListener("click", async () => {
    const branches = await getBranches();
    if (branchSelect) {
      branchSelect.innerHTML = `
        <option value="all">Todas las sucursales (Central)</option>
        ${branches.map((b) => `<option value="${b.id}">${b.name} (${b.code})</option>`).join("")}
      `;
    }
    form.reset();
    dialog.showModal();
  });

  dialog.querySelectorAll("[data-close-user]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const name = formData.get("name");
    const email = formData.get("email");
    const role = formData.get("role");
    const branchId = formData.get("branch");

    try {
      await createUser({ name, email, role, branchId });
      dialog.close();
      await renderUsersModule();
    } catch (err) {
      showToast("Error", err.message, "error");
    }
  });
}
