/** Administración visual de la red municipal de farmacias. */
import { createBranch, deleteBranch, getBranches, toggleBranchActive, updateBranch } from "../../services/branchesService.js";
import { getInventory } from "../../services/inventoryService.js";
import { getUsers } from "../../services/usersService.js";
import { showToast } from "../../services/toastService.js";
import { showSystemConfirm } from "../../services/dialogService.js";

let branchRows = [];
let branchPendingDeletion = null;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

export async function renderBranchesModule() {
  const grid = document.getElementById("branchesAdminGrid");
  const summary = document.getElementById("branchesAdminSummary");
  const count = document.getElementById("branchesAdminCount");
  if (!grid) return;

  const [branches, inventory, users] = await Promise.all([
    getBranches(false, true), getInventory("all"), getUsers()
  ]);
  branchRows = branches;
  const active = branches.filter((branch) => branch.active !== false);
  const totalUnits = inventory.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  if (summary) summary.innerHTML = `
    <article><span>Red municipal</span><strong>${branches.length}</strong><small>farmacias registradas</small></article>
    <article><span>Operativas</span><strong>${active.length}</strong><small>sucursales activas</small></article>
    <article><span>Personal</span><strong>${users.filter((user) => user.active !== false).length}</strong><small>funcionarios activos</small></article>
    <article><span>Existencias</span><strong>${totalUnits.toLocaleString("es-BO")}</strong><small>unidades en toda la red</small></article>
  `;
  if (count) count.textContent = `${branches.length} sucursales · ${active.length} activas`;

  grid.innerHTML = branches.map((branch) => {
    const lots = inventory.filter((item) => item.branch_id === branch.id);
    const units = lots.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const staff = users.filter((user) => user.branch_id === branch.id && user.active !== false).length;
    const isActive = branch.active !== false;
    return `
      <article class="branch-admin-card ${isActive ? "" : "is-inactive"}">
        <div class="branch-admin-head">
          <span class="branch-admin-code">${escapeHtml(branch.code)}</span>
          <span class="status-pill ${isActive ? "active" : "inactive"}"><span class="dot"></span>${isActive ? "Activa" : "Inactiva"}</span>
        </div>
        <div class="branch-admin-name">
          <div class="branch-admin-icon"><svg><use href="#i-store"/></svg></div>
          <div><h2>${escapeHtml(branch.name)}</h2><p>${escapeHtml(branch.address || "Dirección no registrada")}</p></div>
        </div>
        <div class="branch-admin-contact"><span>Teléfono</span><strong>${escapeHtml(branch.phone || "Sin teléfono")}</strong></div>
        <div class="branch-admin-stats">
          <div><strong>${lots.length}</strong><span>Lotes</span></div>
          <div><strong>${units.toLocaleString("es-BO")}</strong><span>Unidades</span></div>
          <div><strong>${staff}</strong><span>Personal</span></div>
        </div>
        <div class="branch-admin-actions">
          <button class="button secondary edit-branch" data-id="${escapeHtml(branch.id)}">Editar datos</button>
          <button class="branch-toggle ${isActive ? "deactivate" : "activate"}" data-id="${escapeHtml(branch.id)}" data-active="${isActive}">${isActive ? "Desactivar" : "Activar"}</button>
          <button class="branch-delete" data-id="${escapeHtml(branch.id)}" title="Eliminar sucursal definitivamente"><svg><use href="#i-close"/></svg><span>Eliminar</span></button>
        </div>
      </article>`;
  }).join("");

  grid.querySelectorAll(".edit-branch").forEach((button) => button.addEventListener("click", () => {
    const branch = branchRows.find((item) => item.id === button.dataset.id);
    if (branch) openBranchDialog(branch);
  }));
  grid.querySelectorAll(".branch-toggle").forEach((button) => button.addEventListener("click", async () => {
    const branch = branchRows.find((item) => item.id === button.dataset.id);
    if (!branch) return;
    const activeNow = button.dataset.active === "true";
    if (activeNow) {
      const confirmed = await showSystemConfirm({
        eyebrow: "ESTADO DE LA RED MUNICIPAL",
        title: `¿Desactivar ${branch.name}?`,
        message: "La farmacia dejará de estar disponible para nuevas ventas, ingresos y asignaciones.",
        detail: "Su inventario y todo el historial permanecerán protegidos. Podrá activarla nuevamente cuando lo necesite.",
        confirmLabel: "Desactivar sucursal",
        cancelLabel: "Mantener activa",
        variant: "warning",
        icon: "i-store"
      });
      if (!confirmed) return;
    }
    button.disabled = true;
    try {
      await toggleBranchActive(branch.id, activeNow);
      await renderBranchesModule();
    } catch (error) {
      showToast("No se pudo cambiar el estado", error.message, "error");
      button.disabled = false;
    }
  }));
  grid.querySelectorAll(".branch-delete").forEach((button) => button.addEventListener("click", () => {
    const branch = branchRows.find((item) => item.id === button.dataset.id);
    if (branch) openDeleteDialog(branch);
  }));
}

function openDeleteDialog(branch) {
  const dialog = document.getElementById("branchDeleteDialog");
  if (!dialog) return;
  branchPendingDeletion = branch;
  document.getElementById("branchDeleteName").textContent = branch.name;
  document.getElementById("branchDeleteCode").textContent = branch.code;
  dialog.showModal();
}

function openBranchDialog(branch = null) {
  const dialog = document.getElementById("branchDialog");
  const form = document.getElementById("branchForm");
  if (!dialog || !form) return;
  form.reset();
  form.elements.branchId.value = branch?.id || "";
  form.elements.name.value = branch?.name || "";
  form.elements.code.value = branch?.code || "";
  form.elements.address.value = branch?.address || "";
  form.elements.phone.value = branch?.phone || "";
  document.getElementById("branchDialogTitle").textContent = branch ? "Editar sucursal" : "Registrar nueva farmacia";
  document.getElementById("branchDialogSubtitle").textContent = branch
    ? "Actualice la información institucional visible en toda la red."
    : "La nueva farmacia quedará integrada a inventario, ingresos, ventas, usuarios y reportes.";
  document.getElementById("branchSubmitText").textContent = branch ? "Guardar cambios" : "Crear sucursal";
  dialog.showModal();
  requestAnimationFrame(() => form.elements.name.focus());
}

export function initBranchDialog() {
  const dialog = document.getElementById("branchDialog");
  const form = document.getElementById("branchForm");
  document.getElementById("newBranchButton")?.addEventListener("click", () => openBranchDialog());
  dialog?.querySelectorAll("[data-close-branch]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form?.elements.code?.addEventListener("input", (event) => {
    event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = document.getElementById("branchSubmitBtn");
    const data = new FormData(form);
    const branchId = data.get("branchId");
    const fields = { name: data.get("name"), code: data.get("code"), address: data.get("address"), phone: data.get("phone") };
    submit.disabled = true;
    try {
      if (branchId) await updateBranch(branchId, fields);
      else await createBranch(fields);
      dialog.close();
      await renderBranchesModule();
    } catch (error) {
      showToast("Revise los datos", error.message, "error");
    } finally { submit.disabled = false; }
  });

  const deleteDialog = document.getElementById("branchDeleteDialog");
  const confirmDelete = document.getElementById("confirmBranchDelete");
  deleteDialog?.querySelectorAll("[data-close-branch-delete]").forEach((button) => button.addEventListener("click", () => {
    branchPendingDeletion = null;
    deleteDialog.close();
  }));
  confirmDelete?.addEventListener("click", async () => {
    if (!branchPendingDeletion) return;
    confirmDelete.disabled = true;
    const label = confirmDelete.querySelector("span");
    if (label) label.textContent = "Verificando…";
    try {
      await deleteBranch(branchPendingDeletion.id);
      branchPendingDeletion = null;
      deleteDialog.close();
      await renderBranchesModule();
    } catch (error) {
      showToast("Eliminación protegida", error.message, "error");
    } finally {
      confirmDelete.disabled = false;
      if (label) label.textContent = "Eliminar definitivamente";
    }
  });
}
