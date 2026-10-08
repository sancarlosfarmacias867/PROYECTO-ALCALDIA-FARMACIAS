/**
 * Módulo de Ingresos y Reabastecimiento de Lotes (Técnico / Admin)
 */
import { createEntry, getEntries } from "../../services/entriesService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { getCurrentUser, isAdmin, isTechnician } from "../../services/authService.js";
import { showToast } from "../../services/toastService.js";

export async function renderRestockModule(selectedBranchId = "all") {
  const branchSelect = document.getElementById("entryBranch");
  const branchLabel = document.getElementById("entryBranchLabel");
  const branches = await getBranches();
  const user = getCurrentUser();

  const isRestricted = user?.role !== "admin" && user?.branch_id !== "all";
  const targetBranch = isRestricted ? user.branch_id : selectedBranchId;

  if (branchSelect) {
    if (isRestricted) {
      const userBranch = branches.find((b) => b.id === user.branch_id) || branches[0];
      branchSelect.innerHTML = `<option value="${userBranch.id}">${userBranch.name} (${userBranch.code})</option>`;
      branchSelect.value = userBranch.id;
      branchSelect.disabled = true;
    } else {
      branchSelect.disabled = false;
      branchSelect.innerHTML = branches
        .map((b) => `<option value="${b.id}" ${b.id === selectedBranchId ? "selected" : ""}>${b.name} (${b.code})</option>`)
        .join("");
    }
  }

  if (branchLabel) {
    branchLabel.textContent = isRestricted 
      ? getBranchName(user.branch_id, branches)
      : (selectedBranchId === "all" ? "Todas las sucursales" : getBranchName(selectedBranchId, branches));
  }

  // Establecer fecha de hoy en el formulario si está vacío
  const entryDateInput = document.querySelector('#entryForm input[name="entryDate"]');
  if (entryDateInput && !entryDateInput.value) {
    entryDateInput.value = new Date().toISOString().slice(0, 10);
  }

  // Mostrar / Ocultar notas de técnico vs admin
  const pricingNote = document.querySelector(".technician-only.pricing-pending-note");
  const adminMarginLabel = document.querySelector('.admin-only label[name="margin"], .form-grid .admin-only');
  
  if (pricingNote) {
    pricingNote.style.display = isTechnician() ? "flex" : "none";
  }
}

export function initRestockEvents() {
  const form = document.getElementById("entryForm");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const user = getCurrentUser();
    
    const name = formData.get("name");
    const lot = formData.get("lot");
    const branchId = (user?.role !== "admin" && user?.branch_id !== "all") ? user.branch_id : formData.get("branch");
    const quantity = formData.get("quantity");
    const unitCost = formData.get("unitCost");
    const margin = formData.get("margin") || 30;
    const entryDate = formData.get("entryDate");
    const expiry = formData.get("expiry");

    // Validar que la fecha de vencimiento sea futura
    if (new Date(expiry) <= new Date()) {
      showToast("Vencimiento inválido", "No se puede ingresar un lote que ya esté vencido.", "error");
      return;
    }

    try {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = "Guardando en Supabase...";
      }

      await createEntry({
        name,
        lot,
        branchId,
        quantity,
        unitCost,
        margin,
        entryDate,
        expiry
      });

      form.reset();
      
      // Re-establecer fecha actual
      const entryDateInput = form.querySelector('input[name="entryDate"]');
      if (entryDateInput) entryDateInput.value = new Date().toISOString().slice(0, 10);

      // Si estamos en la vista de inventario o ingresos, refrescar
      const branchSelect = document.getElementById("branchSelect");
      await renderRestockModule(branchSelect?.value || "all");
    } catch (err) {
      showToast("Error", err.message, "error");
    } finally {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<svg><use href="#i-check"/></svg>Guardar en inventario`;
      }
    }
  });
}
