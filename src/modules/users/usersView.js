/**
 * Módulo de Administración de Usuarios y Roles (Supabase)
 */
import { getUsers, createUser, updateUser, toggleUserActive, deleteUser } from "../../services/usersService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { getRoleLabel, getCurrentUser } from "../../services/authService.js";
import { showToast } from "../../services/toastService.js";

let cachedBranches = [];
let cachedUsers = [];

export async function renderUsersModule() {
  const usersContainer = document.getElementById("usersTable");
  const roleSummary = document.getElementById("roleSummary");
  const userCount = document.getElementById("userCount");
  const userSearch = document.getElementById("userSearch");

  if (!usersContainer) return;

  const users = await getUsers();
  const branches = await getBranches();
  cachedBranches = branches;
  cachedUsers = users;

  // Role summary
  if (roleSummary) {
    const adminCount = users.filter((u) => u.role === "admin").length;
    const tecnicoCount = users.filter((u) => u.role === "tecnico").length;
    const vendedorCount = users.filter((u) => u.role === "vendedor").length;

    roleSummary.innerHTML = `
      <div class="role-card admin-border">
        <span class="role-badge admin">Administrador General</span>
        <h3>${adminCount} funcionarios</h3>
        <p>Control total, asignación de roles y sucursales, márgenes y auditoría municipal.</p>
      </div>
      <div class="role-card tech-border">
        <span class="role-badge tech">Técnico Farmacéutico</span>
        <h3>${tecnicoCount} funcionarios</h3>
        <p>Reabastecimiento e ingreso de lotes en sucursal designada por administración.</p>
      </div>
      <div class="role-card seller-border">
        <span class="role-badge seller">Vendedor(a) / SUS</span>
        <h3>${vendedorCount} funcionarios</h3>
        <p>Dispensación directa y ventas bloqueadas a su sucursal municipal asignada.</p>
      </div>
    `;
  }

  function filterAndDraw() {
    const term = (userSearch?.value || "").toLowerCase();
    const filtered = users.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(term) ||
        (u.email || "").toLowerCase().includes(term) ||
        getRoleLabel(u.role).toLowerCase().includes(term) ||
        getBranchName(u.branch_id, branches).toLowerCase().includes(term)
    );

    if (userCount) userCount.textContent = `${filtered.length} de ${users.length} funcionarios`;

    if (filtered.length === 0) {
      usersContainer.innerHTML = `<tr><td colspan="6" class="text-center py-4">No se encontraron funcionarios registrados.</td></tr>`;
      return;
    }

    usersContainer.innerHTML = filtered
      .map((u) => {
        const branchName = u.branch_id === "all" ? "Central (Consolidado)" : getBranchName(u.branch_id, branches);
        const roleClass = u.role === "admin" ? "admin" : u.role === "tecnico" ? "tech" : "seller";
        const isActive = u.active !== false;

        return `
          <tr class="${isActive ? "" : "row-inactive"}">
            <td>
              <div class="user-cell">
                <span class="user-avatar ${roleClass}">${u.name.charAt(0).toUpperCase()}</span>
                <div>
                  <strong>${u.name}</strong>
                  <small>${u.email}</small>
                </div>
              </div>
            </td>
            <td><span class="role-badge ${roleClass}">${getRoleLabel(u.role)}</span></td>
            <td><span class="branch-tag">${branchName}</span></td>
            <td>
              <button class="status-pill ${isActive ? "active" : "inactive"}" data-toggle-id="${u.id}" data-current="${isActive}" title="Clic para alternar estado">
                <span class="dot"></span> ${isActive ? "Activo" : "Inactivo"}
              </button>
            </td>
            <td><small class="text-muted">${u.last_access ? new Date(u.last_access).toLocaleDateString("es-BO") : "Reciente"}</small></td>
            <td>
              <div class="action-buttons">
                <button class="icon-button edit-user-btn" data-id="${u.id}" title="Modificar rol, sucursal o clave">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
                  </svg>
                </button>
                <button class="icon-button danger delete-user-btn" data-id="${u.id}" data-name="${u.name}" title="Eliminar usuario">
                  <svg width="15" height="15"><use href="#i-close"/></svg>
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

    // Edit user handlers
    usersContainer.querySelectorAll(".edit-user-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const u = cachedUsers.find((x) => x.id === id);
        if (u) {
          openEditUserModal(u);
        }
      });
    });

    // Delete user handlers
    usersContainer.querySelectorAll(".delete-user-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const name = btn.getAttribute("data-name");
        if (confirm(`¿Confirma eliminar definitivamente la cuenta de ${name}?`)) {
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

function openEditUserModal(user) {
  const dialog = document.getElementById("userDialog");
  const form = document.getElementById("userForm");
  const branchSelect = document.getElementById("userBranch");
  const editIdInput = document.getElementById("userEditId");
  const nameInput = document.getElementById("userFormName");
  const emailInput = document.getElementById("userFormEmail");
  const pinInput = document.getElementById("userFormPin");
  const roleSelect = document.getElementById("userFormRole");
  const titleEl = document.getElementById("userDialogTitle");
  const submitText = document.getElementById("userSubmitText");

  if (!dialog || !form) return;

  if (titleEl) titleEl.textContent = "Modificar Funcionario";
  if (submitText) submitText.textContent = "Guardar Cambios";
  if (editIdInput) editIdInput.value = user.id;
  if (nameInput) nameInput.value = user.name;
  if (emailInput) emailInput.value = user.email;
  if (pinInput) {
    pinInput.value = user.pin || "";
    pinInput.placeholder = "Ingrese nueva clave o conserve la actual";
  }
  if (roleSelect) roleSelect.value = user.role;

  populateBranchSelect(branchSelect, user.branch_id);
  dialog.showModal();
}

function populateBranchSelect(selectEl, selectedId = "") {
  if (!selectEl) return;
  selectEl.innerHTML = `
    <option value="all" ${selectedId === "all" ? "selected" : ""}>Todas las sucursales (Consolidado Central - Solo Admin)</option>
    ${cachedBranches
      .map(
        (b) =>
          `<option value="${b.id}" ${b.id === selectedId ? "selected" : ""}>${b.name} (${b.code})</option>`
      )
      .join("")}
  `;
}

export function initUserDialog() {
  const dialog = document.getElementById("userDialog");
  const openBtn = document.getElementById("newUserButton");
  const form = document.getElementById("userForm");
  const branchSelect = document.getElementById("userBranch");
  const editIdInput = document.getElementById("userEditId");
  const titleEl = document.getElementById("userDialogTitle");
  const submitText = document.getElementById("userSubmitText");

  if (!dialog || !openBtn || !form) return;

  openBtn.addEventListener("click", async () => {
    if (cachedBranches.length === 0) {
      cachedBranches = await getBranches();
    }
    form.reset();
    if (editIdInput) editIdInput.value = "";
    if (titleEl) titleEl.textContent = "Crear nuevo usuario";
    if (submitText) submitText.textContent = "Guardar funcionario";
    populateBranchSelect(branchSelect, "san-carlos");
    dialog.showModal();
  });

  dialog.querySelectorAll("[data-close-user]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const userId = formData.get("userId");
    const name = formData.get("name");
    const email = formData.get("email");
    const pin = formData.get("pin");
    const role = formData.get("role");
    const branchId = formData.get("branch");

    try {
      if (userId) {
        // Modificación de usuario existente
        await updateUser(userId, { name, email, pin, role, branch_id: branchId });
      } else {
        // Creación de nuevo usuario
        await createUser({ name, email, pin, role, branchId });
      }
      dialog.close();
      await renderUsersModule();
    } catch (err) {
      showToast("Error", err.message, "error");
    }
  });
}
