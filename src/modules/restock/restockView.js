/**
 * Módulo de Ingresos y Reabastecimiento de Lotes
 * Gobierno Autónomo Municipal de San Carlos
 */
import { createEntry, getEntries } from "../../services/entriesService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { getCurrentUser, isAdmin, isTechnician } from "../../services/authService.js";
import { showToast } from "../../services/toastService.js";
import { getExpiryStatus } from "../../services/inventoryService.js";

let cachedEntries = [];
let cachedBranches = [];
let currentFilterTerm = "";
let currentTargetBranch = "all";

export async function renderRestockModule(selectedBranchId = "all") {
  const branchSelect = document.getElementById("entryBranch");
  const branchLabel = document.getElementById("entryBranchLabel");
  const user = getCurrentUser();
  const isUserAdmin = isAdmin();

  cachedBranches = await getBranches();

  // Si no es admin, SIEMPRE forzar a su sucursal asignada
  const isRestricted = !isUserAdmin && user?.branch_id !== "all";
  currentTargetBranch = isRestricted ? user.branch_id : selectedBranchId;

  // 1. Panel de KPIs: Solo visible para el Administrador
  const kpiGrid = document.querySelector(".entries-kpi-grid");
  if (kpiGrid) {
    kpiGrid.style.display = isUserAdmin ? "grid" : "none";
  }

  // 2. Control del Selector de Sucursal en Formulario: Solo visible para el Administrador
  const branchGroup = document.getElementById("entryBranchGroup");
  const section1Grid = document.querySelector(".entry-grid-section-1");

  if (branchGroup) {
    branchGroup.style.display = isUserAdmin ? "" : "none";
  }

  if (section1Grid) {
    section1Grid.classList.toggle("technician-mode", !isUserAdmin);
  }

  if (branchSelect) {
    if (isUserAdmin) {
      branchSelect.disabled = false;
      const targetOption = currentTargetBranch !== "all" ? currentTargetBranch : cachedBranches[0]?.id;
      branchSelect.innerHTML = cachedBranches
        .map(
          (b) =>
            `<option value="${b.id}" ${b.id === targetOption ? "selected" : ""}>${b.name} (${b.code})</option>`
        )
        .join("");
    } else {
      const userBranchId = user?.branch_id || cachedBranches[0]?.id;
      branchSelect.innerHTML = `<option value="${userBranchId}" selected>${getBranchName(userBranchId, cachedBranches)}</option>`;
      branchSelect.value = userBranchId;
      branchSelect.disabled = true;
    }
  }

  // 3. Etiqueta superior de contexto (pill)
  if (branchLabel) {
    branchLabel.textContent = isRestricted
      ? getBranchName(user.branch_id, cachedBranches)
      : currentTargetBranch === "all"
      ? "Todas las sucursales"
      : getBranchName(currentTargetBranch, cachedBranches);
  }

  // 4. Establecer fecha de hoy por defecto si está vacía
  const entryDateInput = document.getElementById("entryDate");
  if (entryDateInput && !entryDateInput.value) {
    entryDateInput.value = new Date().toISOString().slice(0, 10);
  }

  // 5. Adaptar permisos de rol (Margen para Admin, Nota para Técnico)
  const marginGroup = document.getElementById("entryMarginGroup");
  const pricingNote = document.querySelector(".technician-only.pricing-pending-note");
  if (marginGroup) {
    marginGroup.style.display = isUserAdmin ? "flex" : "none";
  }
  if (pricingNote) {
    pricingNote.style.display = !isUserAdmin ? "flex" : "none";
  }

  // 6. Cargar ingresos históricos y calcular KPIs
  await loadAndRenderEntries();

  // 7. Recalcular valores en vivo del formulario
  updateLiveCalculations();
}

/**
 * Cargar y renderizar historial de ingresos y KPIs
 */
async function loadAndRenderEntries() {
  try {
    cachedEntries = await getEntries(currentTargetBranch);
  } catch (err) {
    console.warn("No se pudieron cargar ingresos remotos:", err);
    cachedEntries = [];
  }

  updateKpiStats(cachedEntries);
  renderEntriesTable();
}

/**
 * Actualizar tarjetas KPI superiores
 */
function updateKpiStats(entries) {
  const kpiTotalEntries = document.getElementById("kpiTotalEntries");
  const kpiTotalInvestment = document.getElementById("kpiTotalInvestment");
  const kpiBranchesSupplied = document.getElementById("kpiBranchesSupplied");
  const kpiLastEntryDate = document.getElementById("kpiLastEntryDate");
  const kpiLastEntryMedicine = document.getElementById("kpiLastEntryMedicine");

  const totalCount = entries.length;
  const totalMoney = entries.reduce((acc, e) => {
    const qty = Number(e.quantity) || 0;
    const cost = Number(e.unit_cost) || 0;
    return acc + qty * cost;
  }, 0);

  const uniqueBranches = new Set(entries.map((e) => e.branch_id)).size;

  if (kpiTotalEntries) kpiTotalEntries.textContent = totalCount;
  if (kpiTotalInvestment) {
    kpiTotalInvestment.textContent = `Bs ${totalMoney.toLocaleString("es-BO", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }
  if (kpiBranchesSupplied) {
    kpiBranchesSupplied.textContent = currentTargetBranch === "all" ? Math.max(uniqueBranches, 1) : 1;
  }

  if (entries.length > 0) {
    const latest = entries[0];
    if (kpiLastEntryDate) {
      kpiLastEntryDate.textContent = latest.date || latest.timestamp?.slice(0, 10) || "Hoy";
    }
    if (kpiLastEntryMedicine) {
      kpiLastEntryMedicine.textContent = `${latest.name} (${latest.quantity} uds.)`;
      kpiLastEntryMedicine.title = `${latest.name} - Lote: ${latest.lot}`;
    }
  } else {
    if (kpiLastEntryDate) kpiLastEntryDate.textContent = "—";
    if (kpiLastEntryMedicine) kpiLastEntryMedicine.textContent = "Sin ingresos registrados";
  }
}

/**
 * Renderizar la tabla de historial de ingresos con filtros
 */
function renderEntriesTable() {
  const tbody = document.getElementById("entriesHistoryTableBody");
  const countBadge = document.getElementById("entriesTableCount");
  if (!tbody) return;

  const term = currentFilterTerm.trim().toLowerCase();

  const filtered = cachedEntries.filter((item) => {
    if (!term) return true;
    const branchName = getBranchName(item.branch_id, cachedBranches).toLowerCase();
    return (
      (item.name || "").toLowerCase().includes(term) ||
      (item.lot || "").toLowerCase().includes(term) ||
      (item.responsible || "").toLowerCase().includes(term) ||
      (item.supplier || "").toLowerCase().includes(term) ||
      branchName.includes(term)
    );
  });

  if (countBadge) {
    countBadge.textContent = `${filtered.length} de ${cachedEntries.length} lotes`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; padding: 36px 16px; color: #64748b;">
          <div style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
            <svg style="width: 36px; height: 36px; color: #94a3b8;"><use href="#i-box"/></svg>
            <strong style="color: #334155; font-size: 0.95rem;">No se encontraron registros de ingreso</strong>
            <span style="font-size: 0.8rem;">${term ? "Intente con otro término de búsqueda." : "Los nuevos lotes registrados aparecerán aquí inmediatamente."}</span>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((item) => {
      const branchName = getBranchName(item.branch_id, cachedBranches);
      const qty = Number(item.quantity) || 0;
      const unitCost = Number(item.unit_cost) || 0;
      const totalCost = qty * unitCost;
      const exp = getExpiryStatus(item.expiry);

      const expBadgeClass =
        exp.status === "red"
          ? "badge-danger"
          : exp.status === "yellow"
          ? "badge-warning"
          : "badge-success";

      const formattedTime = item.timestamp
        ? item.timestamp.replace("T", " ").slice(0, 16)
        : item.date || "—";

      return `
        <tr>
          <td>
            <div style="display: flex; flex-direction: column;">
              <strong style="color: #0f172a; font-size: 0.82rem;">${formattedTime}</strong>
              <small style="color: #94a3b8; font-size: 0.72rem;">${item.id || "REG"}</small>
            </div>
          </td>
          <td>
            <div style="display: flex; flex-direction: column;">
              <strong style="color: #0f172a; font-size: 0.88rem;">${item.name}</strong>
              <small style="color: #64748b; font-size: 0.74rem;">${item.supplier || "Distribuidora Central"}</small>
            </div>
          </td>
          <td>
            <code class="lot-badge" style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 3px 8px; border-radius: 6px; font-weight: 700; color: #0f172a;">${item.lot}</code>
          </td>
          <td>
            <span class="branch-tag" style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 4px 10px; border-radius: 999px; font-size: 0.76rem; font-weight: 600; color: #334155;">${branchName}</span>
          </td>
          <td>
            <div style="font-weight: 800; font-family: 'Outfit', sans-serif; font-size: 0.95rem; color: #047857;">
              +${qty.toLocaleString()} <span style="font-size: 0.72rem; font-weight: 500; color: #64748b;">uds.</span>
            </div>
          </td>
          <td style="font-weight: 600; color: #475569;">
            Bs ${unitCost.toFixed(2)}
          </td>
          <td style="font-weight: 800; font-family: 'Outfit', sans-serif; color: #0f172a;">
            Bs ${totalCost.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </td>
          <td>
            <div style="display: flex; flex-direction: column; gap: 3px;">
              <span style="font-size: 0.8rem; font-weight: 600; color: #334155;">${item.expiry || "—"}</span>
              <span class="status-badge ${expBadgeClass}" style="font-size: 0.68rem; padding: 2px 7px;">${exp.label}</span>
            </div>
          </td>
          <td>
            <span style="font-size: 0.78rem; color: #475569; font-weight: 600;">
              ${item.responsible || "Personal Almacén"}
            </span>
          </td>
        </tr>
      `;
    })
    .join("");
}

/**
 * Recalcular valores en vivo (Inversión total, precio venta y margen)
 */
function updateLiveCalculations() {
  const qtyInput = document.getElementById("entryQuantity");
  const costInput = document.getElementById("entryCost");
  const marginInput = document.getElementById("entryMargin");

  const liveTotalCost = document.getElementById("liveTotalCost");
  const liveSalePrice = document.getElementById("liveSalePrice");
  const liveProfitUnit = document.getElementById("liveProfitUnit");

  const qty = parseFloat(qtyInput?.value) || 0;
  const cost = parseFloat(costInput?.value) || 0;
  const margin = parseFloat(marginInput?.value) || 30;

  const total = qty * cost;
  const salePrice = +(cost * (1 + margin / 100)).toFixed(2);
  const profitUnit = Math.max(0, salePrice - cost);

  if (liveTotalCost) {
    liveTotalCost.textContent = `Bs ${total.toLocaleString("es-BO", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  }

  if (liveSalePrice) {
    liveSalePrice.textContent = `Bs ${salePrice.toFixed(2)}`;
  }

  if (liveProfitUnit) {
    liveProfitUnit.textContent = `Bs ${profitUnit.toFixed(2)} (+${margin}%)`;
  }
}

/**
 * Validar y dar feedback del vencimiento
 */
function updateExpiryFeedback() {
  const expiryInput = document.getElementById("entryExpiry");
  const feedbackEl = document.getElementById("expiryFeedback");
  if (!expiryInput || !feedbackEl) return;

  const val = expiryInput.value;
  if (!val) {
    feedbackEl.textContent = "Seleccione fecha de vencimiento";
    feedbackEl.className = "expiry-feedback-badge";
    return;
  }

  const exp = getExpiryStatus(val);
  feedbackEl.className = `expiry-feedback-badge ${exp.status === "expired" ? "red" : exp.status}`;

  if (exp.status === "expired") {
    feedbackEl.textContent = "⚠️ Lote ya vencido (No se puede registrar)";
  } else if (exp.status === "red") {
    feedbackEl.textContent = `🔴 Vence en ${exp.months} meses (Plazo crítico)`;
  } else if (exp.status === "yellow") {
    feedbackEl.textContent = `🟡 Vence en ${exp.months} meses (Alerta)`;
  } else {
    feedbackEl.textContent = `🟢 Vigente (${exp.months} meses restantes)`;
  }
}

/**
 * Inicializar todos los eventos y reactividad del módulo de ingresos
 */
export function initRestockEvents() {
  const form = document.getElementById("entryForm");
  const searchInput = document.getElementById("entriesSearchInput");
  const qtyInput = document.getElementById("entryQuantity");
  const costInput = document.getElementById("entryCost");
  const marginInput = document.getElementById("entryMargin");
  const expiryInput = document.getElementById("entryExpiry");
  const resetBtn = document.getElementById("btnResetEntry");

  // 1. Escuchar cálculos en vivo
  [qtyInput, costInput, marginInput].forEach((input) => {
    input?.addEventListener("input", updateLiveCalculations);
  });

  // 2. Escuchar fecha de vencimiento
  expiryInput?.addEventListener("change", updateExpiryFeedback);
  expiryInput?.addEventListener("input", updateExpiryFeedback);

  // 3. Buscador en la tabla de historial
  searchInput?.addEventListener("input", (e) => {
    currentFilterTerm = e.target.value;
    renderEntriesTable();
  });

  // 4. Botón Limpiar Formulario
  resetBtn?.addEventListener("click", () => {
    setTimeout(() => {
      const entryDateInput = document.getElementById("entryDate");
      if (entryDateInput) entryDateInput.value = new Date().toISOString().slice(0, 10);
      if (marginInput) marginInput.value = "30";
      updateLiveCalculations();
      updateExpiryFeedback();
    }, 50);
  });

  // 5. Envío del Formulario
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(form);
      const user = getCurrentUser();

      const name = formData.get("name");
      const lot = formData.get("lot");
      const branchId =
        user?.role !== "admin" && user?.branch_id !== "all" ? user.branch_id : formData.get("branch");
      const quantity = formData.get("quantity");
      const unitCost = formData.get("unitCost");
      const margin = formData.get("margin") || 30;
      const entryDate = formData.get("entryDate");
      const expiry = formData.get("expiry");
      const supplier = formData.get("supplier") || "Distribuidora Municipal Central";
      const invoiceNumber = "";

      // Validar que la fecha de vencimiento sea futura
      if (new Date(expiry) <= new Date()) {
        showToast(
          "Vencimiento inválido",
          "No se puede ingresar un lote que ya esté vencido o caducado.",
          "error"
        );
        return;
      }

      const submitBtn = document.getElementById("btnSubmitEntry");
      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `
            <svg style="animation: spin 1s linear infinite;"><use href="#i-box"/></svg>
            <span>Guardando en Inventario...</span>
          `;
        }

        await createEntry({
          name,
          lot,
          branchId,
          quantity,
          unitCost,
          margin,
          entryDate,
          expiry,
          supplier,
          invoiceNumber
        });

        // Limpiar formulario manteniendo fecha de hoy
        form.reset();
        const entryDateInput = document.getElementById("entryDate");
        if (entryDateInput) entryDateInput.value = new Date().toISOString().slice(0, 10);
        if (marginInput) marginInput.value = "30";
        updateLiveCalculations();
        updateExpiryFeedback();

        // Refrescar módulo completo
        await loadAndRenderEntries();
      } catch (err) {
        showToast("Error al ingresar lote", err.message, "error");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `
            <svg width="18" height="18"><use href="#i-check"/></svg>
            <span>Guardar e Ingresar a Inventario</span>
          `;
        }
      }
    });
  }
}
