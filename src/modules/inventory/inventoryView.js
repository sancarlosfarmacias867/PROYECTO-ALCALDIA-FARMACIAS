/**
 * Módulo de Inventario de Medicamentos y Lotes (Supabase)
 */
import { getInventory, getExpiryStatus, updateProductMargin } from "../../services/inventoryService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { isAdmin, getCurrentUser } from "../../services/authService.js";
import { showToast } from "../../services/toastService.js";

export async function renderInventoryModule(selectedBranchId = "all") {
  const tableBody = document.getElementById("inventoryTable");
  const countEl = document.getElementById("inventoryCount");
  const searchInput = document.getElementById("inventorySearch");
  const expiryFilter = document.getElementById("expiryFilter");
  const inventorySubtitle = document.getElementById("inventorySubtitle");

  if (!tableBody) return;

  const user = getCurrentUser();
  const activeBranch = (user?.role !== "admin" && user?.branch_id !== "all") ? user.branch_id : selectedBranchId;

  const [branches, inventory] = await Promise.all([
    getBranches(),
    getInventory(activeBranch)
  ]);
  
  if (inventorySubtitle) {
    inventorySubtitle.textContent = activeBranch === "all" 
      ? "Existencias consolidadas de las seis farmacias municipales de San Carlos."
      : `Inventario y lotes vigentes en sucursal ${getBranchName(activeBranch, branches)}.`;
  }

  function filterAndRender() {
    const term = (searchInput?.value || "").toLowerCase();
    const filter = expiryFilter?.value || "all";

    const filtered = inventory.filter((item) => {
      const matchSearch =
        item.name.toLowerCase().includes(term) ||
        item.lot.toLowerCase().includes(term) ||
        getBranchName(item.branch_id, branches).toLowerCase().includes(term);

      if (!matchSearch) return false;

      const exp = getExpiryStatus(item.expiry);
      if (filter === "all") return true;
      return exp.status === filter;
    });

    if (countEl) {
      countEl.textContent = `${filtered.length} de ${inventory.length} lotes`;
    }

    if (filtered.length === 0) {
      tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-6">No se encontraron medicamentos con los filtros actuales.</td></tr>`;
      return;
    }

    const admin = isAdmin();

    tableBody.innerHTML = filtered
      .map((item) => {
        const exp = getExpiryStatus(item.expiry);
        const branchName = getBranchName(item.branch_id, branches);
        const isLowStock = item.quantity <= 10;
        const isOutOfStock = item.quantity === 0;

        const badgeClass = exp.status === "red" ? "badge-danger" : exp.status === "yellow" ? "badge-warning" : "badge-success";

        return `
          <tr class="${isOutOfStock ? "row-out-of-stock" : ""}">
            <td>
              <div class="product-cell">
                <strong>${item.name}</strong>
                <small class="text-muted">Cód: ${item.id}</small>
              </div>
            </td>
            <td><span class="branch-tag">${branchName}</span></td>
            <td><code class="lot-badge">${item.lot}</code></td>
            <td>
              <div class="stock-cell">
                <span class="stock-qty ${isOutOfStock ? "out" : isLowStock ? "low" : "ok"}">${item.quantity}</span>
                <small>${item.quantity === 1 ? "unidad" : "unidades"}</small>
              </div>
            </td>
            <td>
              <div class="expiry-cell">
                <span>${item.expiry}</span>
                <span class="status-badge ${badgeClass}">${exp.label}</span>
              </div>
            </td>
            <td class="admin-only ${admin ? "" : "hidden"}">Bs ${Number(item.unit_cost || 0).toFixed(2)}</td>
            <td>
              <div class="price-cell">
                <strong>Bs ${Number(item.sale_price || 0).toFixed(2)}</strong>
                ${admin ? `<small class="text-muted">${item.margin}% margen</small>` : ""}
              </div>
            </td>
            <td>
              <span class="status-badge ${isOutOfStock ? "badge-danger" : isLowStock ? "badge-warning" : "badge-success"}">
                ${isOutOfStock ? "Agotado" : isLowStock ? "Stock Crítico" : "Disponible"}
              </span>
            </td>
            <td class="admin-only ${admin ? "" : "hidden"}">
              <button class="button small secondary edit-price-btn" data-id="${item.id}" data-name="${item.name}" data-cost="${item.unit_cost}" data-margin="${item.margin}" data-lot="${item.lot}">
                <svg width="14" height="14"><use href="#i-grid"/></svg>
                Margen
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    // Conectar botones de edición de precio / margen
    tableBody.querySelectorAll(".edit-price-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        openPriceModal({
          id: btn.getAttribute("data-id"),
          name: btn.getAttribute("data-name"),
          cost: parseFloat(btn.getAttribute("data-cost")),
          margin: parseFloat(btn.getAttribute("data-margin")),
          lot: btn.getAttribute("data-lot")
        });
      });
    });
  }

  searchInput?.addEventListener("input", filterAndRender);
  expiryFilter?.addEventListener("change", filterAndRender);
  filterAndRender();
}

function openPriceModal(product) {
  const dialog = document.getElementById("priceDialog");
  const form = document.getElementById("priceForm");
  const nameEl = document.getElementById("priceProductName");
  const metaEl = document.getElementById("priceProductMeta");
  const costEl = document.getElementById("priceUnitCost");
  const marginInput = form?.querySelector('input[name="margin"]');
  const resultEl = document.getElementById("priceResult");
  const idInput = form?.querySelector('input[name="productId"]');

  if (!dialog || !form) return;

  if (nameEl) nameEl.textContent = product.name;
  if (metaEl) metaEl.textContent = `Lote: ${product.lot}`;
  if (costEl) costEl.textContent = `Bs ${product.cost.toFixed(2)}`;
  if (marginInput) marginInput.value = product.margin || 30;
  if (idInput) idInput.value = product.id;

  function updateCalculatedPrice() {
    const margin = parseFloat(marginInput?.value || "0") || 0;
    const finalPrice = +(product.cost * (1 + margin / 100)).toFixed(2);
    if (resultEl) resultEl.textContent = `Bs ${finalPrice.toFixed(2)}`;
  }

  if (marginInput) marginInput.oninput = updateCalculatedPrice;
  updateCalculatedPrice();

  dialog.showModal();
}

export function initPriceDialog() {
  const dialog = document.getElementById("priceDialog");
  const form = document.getElementById("priceForm");

  if (!dialog || !form) return;

  dialog.querySelectorAll("[data-close-price]").forEach((btn) => {
    btn.addEventListener("click", () => dialog.close());
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    const productId = formData.get("productId");
    const margin = formData.get("margin");
    const submitBtn = form.querySelector('button[type="submit"]');

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>Guardando...</span>`;
      }
      await updateProductMargin(productId, margin);
      dialog.close();
      const branchSelect = document.getElementById("branchSelect");
      await renderInventoryModule(branchSelect?.value || "all");
      showToast("Margen actualizado", "El precio de venta autorizado fue configurado exitosamente.", "success");
    } catch (err) {
      showToast("Error", err.message, "error");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `
          <svg width="18" height="18"><use href="#i-check"/></svg>
          <span>Guardar Precio Autorizado</span>
        `;
      }
    }
  });
}
