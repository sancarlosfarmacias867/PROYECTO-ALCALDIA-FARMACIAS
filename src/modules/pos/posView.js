/**
 * Módulo de Punto de Venta (Ventas Comerciales y Entregas SUS)
 * Gobierno Autónomo Municipal de San Carlos
 */
import { getInventory, getExpiryStatus } from "../../services/inventoryService.js";
import { processSale } from "../../services/salesService.js";
import { getCurrentUser, isAdmin } from "../../services/authService.js";
import { getBranchName, getBranches } from "../../services/branchesService.js";
import { showToast } from "../../services/toastService.js";
import { formatBusinessDateTime } from "../../utils/dateTime.js";

let currentSaleType = "normal";
let cart = [];
let currentAvailableStock = [];
let currentActiveBranch = "all";
let currentBranchesList = [];

export async function renderPosModule(selectedBranchId = "all") {
  const user = getCurrentUser();

  // Si el usuario no es admin, forzar estrictamente a su sucursal asignada
  let activeBranch =
    user?.role !== "admin" && user?.branch_id !== "all"
      ? user.branch_id
      : selectedBranchId;

  // En el punto de venta nunca puede venderse en 'all' / consolidado: asegurar sucursal física individual
  if (activeBranch === "all") {
    activeBranch = "san-carlos";
  }

  currentActiveBranch = activeBranch;

  const [branches, inventory] = await Promise.all([
    getBranches(),
    getInventory(activeBranch)
  ]);
  currentBranchesList = branches;

  const saleBranchLabel = document.getElementById("saleBranchLabel");
  if (saleBranchLabel) {
    saleBranchLabel.textContent = getBranchName(activeBranch, branches);
  }

  // Cargar inventario disponible de la sucursal o consolidado
  currentAvailableStock = inventory.filter((item) => item.quantity > 0);

  // Ordenar por FEFO (First Expired, First Out)
  currentAvailableStock.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

  populateProductSelect();

  // Actualizar estado de campos SUS y métodos de pago
  updateModeUI();

  // Actualizar tira de detalle del medicamento seleccionado
  updateProductPreview();

  // Actualizar lista del carrito
  updateCartUI();
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Llenar el select oculto y las opciones del combobox desplegable
 */
function populateProductSelect() {
  const productSelect = document.getElementById("saleProduct");
  if (!productSelect) return;

  const isConsolidated = currentActiveBranch === "all";

  if (currentAvailableStock.length === 0) {
    productSelect.innerHTML = `<option value="">Sin medicamentos disponibles en esta sucursal</option>`;
    selectProductById("");
  } else {
    productSelect.innerHTML = currentAvailableStock
      .map((item) => {
        const priceStr =
          currentSaleType === "sus" ? "SUS (Gratuito)" : `Bs ${Number(item.sale_price).toFixed(2)}`;
        const branchTag = isConsolidated ? ` · ${getBranchName(item.branch_id, currentBranchesList)}` : "";
        return `
          <option value="${item.id}" data-branch="${item.branch_id}" data-price="${item.sale_price}" data-cost="${item.unit_cost}" data-stock="${item.quantity}" data-lot="${item.lot}" data-name="${item.name}" data-expiry="${item.expiry}">
            ${item.name} | Lote: ${item.lot}${branchTag} (Stock: ${item.quantity} · ${priceStr})
          </option>
        `;
      })
      .join("");

    // Seleccionar por defecto el primero según FEFO
    selectProductById(currentAvailableStock[0].id);
  }

  const searchInput = document.getElementById("comboboxSearchInput");
  renderComboboxOptions(searchInput?.value.trim().toLowerCase() || "");
}

/**
 * Renderizar las opciones dentro del desplegable con filtro en tiempo real
 */
function renderComboboxOptions(query = "") {
  const optionsContainer = document.getElementById("comboboxOptions");
  const clearBtn = document.getElementById("comboboxClearBtn");
  const productSelect = document.getElementById("saleProduct");
  if (!optionsContainer) return;

  if (clearBtn) {
    clearBtn.style.display = query ? "block" : "none";
  }

  let items = currentAvailableStock;
  if (query) {
    items = currentAvailableStock.filter((item) => {
      const name = (item.name || "").toLowerCase();
      const lot = (item.lot || "").toLowerCase();
      return name.includes(query) || lot.includes(query);
    });
  }

  if (items.length === 0) {
    optionsContainer.innerHTML = `
      <div class="pos-option-empty">
        ${query ? `No se encontraron medicamentos para "<strong>${escapeHtml(query)}</strong>"` : "Sin medicamentos disponibles en esta sucursal"}
      </div>
    `;
    return;
  }

  const currentSelectedId = productSelect?.value || "";
  const isConsolidated = currentActiveBranch === "all";

  optionsContainer.innerHTML = items
    .map((item) => {
      const isSelected = item.id === currentSelectedId;
      const isSus = currentSaleType === "sus";
      const priceStr = isSus ? "Gratis (SUS)" : `Bs ${Number(item.sale_price).toFixed(2)}`;
      const isLowStock = item.quantity <= 10;
      const branchName = isConsolidated ? getBranchName(item.branch_id, currentBranchesList) : "";

      return `
        <div class="pos-option-item ${isSelected ? "selected" : ""}" data-id="${item.id}" role="option" aria-selected="${isSelected}">
          <div class="pos-option-main">
            <span class="pos-option-name">${item.name}</span>
            <div class="pos-option-sub">
              <span>LOTE:</span>
              <span class="pos-option-lot">${item.lot}</span>
              ${branchName ? `<span class="pos-option-branch">${branchName}</span>` : ""}
              <span>· Vence: ${item.expiry || "—"}</span>
            </div>
          </div>
          <div class="pos-option-badges">
            <span class="pos-stock-badge ${isLowStock ? "low" : ""}">Stock: ${item.quantity}</span>
            <span class="pos-price-badge ${isSus ? "sus" : ""}">${priceStr}</span>
          </div>
        </div>
      `;
    })
    .join("");

  optionsContainer.querySelectorAll(".pos-option-item").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-id");
      selectProductById(id);
      closeCombobox();
      document.getElementById("saleQuantity")?.focus();
    });
  });
}

/**
 * Seleccionar un producto y sincronizar el trigger y preview
 */
function selectProductById(id) {
  const productSelect = document.getElementById("saleProduct");
  const comboboxLabel = document.getElementById("comboboxLabel");
  if (!productSelect) return;

  productSelect.value = id;
  const selectedOpt = productSelect.selectedOptions[0];
  if (selectedOpt && selectedOpt.value) {
    const name = selectedOpt.getAttribute("data-name");
    const lot = selectedOpt.getAttribute("data-lot");
    const stock = selectedOpt.getAttribute("data-stock");
    const isSus = currentSaleType === "sus";
    const priceStr = isSus ? "SUS (Gratuito)" : `Bs ${Number(selectedOpt.getAttribute("data-price") || 0).toFixed(2)}`;
    if (comboboxLabel) {
      comboboxLabel.textContent = `${name} | Lote: ${lot} (Stock: ${stock} · ${priceStr})`;
      comboboxLabel.classList.remove("placeholder");
    }
  } else {
    if (comboboxLabel) {
      comboboxLabel.textContent = currentAvailableStock.length === 0 ? "Sin medicamentos disponibles" : "Seleccionar medicamento...";
      comboboxLabel.classList.add("placeholder");
    }
  }

  updateProductPreview();
}

/**
 * Abrir el desplegable y enfocar el campo de búsqueda
 */
function openCombobox() {
  const combobox = document.getElementById("posCombobox");
  const dropdown = document.getElementById("comboboxDropdown");
  const trigger = document.getElementById("comboboxTrigger");
  const searchInput = document.getElementById("comboboxSearchInput");

  if (!combobox || !dropdown) return;
  combobox.classList.add("open");
  dropdown.classList.remove("hidden");
  trigger?.setAttribute("aria-expanded", "true");

  const currentQuery = searchInput?.value.trim().toLowerCase() || "";
  renderComboboxOptions(currentQuery);

  setTimeout(() => {
    searchInput?.focus();
    searchInput?.select();
  }, 50);
}

/**
 * Cerrar el desplegable
 */
function closeCombobox() {
  const combobox = document.getElementById("posCombobox");
  const dropdown = document.getElementById("comboboxDropdown");
  const trigger = document.getElementById("comboboxTrigger");

  if (!combobox || !dropdown) return;
  combobox.classList.remove("open");
  dropdown.classList.add("hidden");
  trigger?.setAttribute("aria-expanded", "false");
}

/**
 * Actualizar interfaz según modalidad seleccionada (Normal vs SUS)
 */
function updateModeUI() {
  const isSus = currentSaleType === "sus";
  const susContainer = document.getElementById("susExtraFields");
  const summaryTitle = document.getElementById("summaryTitle");
  const posTotalCard = document.getElementById("posTotalCard");
  const posTotalLabel = document.getElementById("posTotalLabel");
  const posTotalCaption = document.getElementById("posTotalCaption");
  const paymentSection = document.getElementById("paymentMethodSection");

  if (susContainer) {
    susContainer.classList.toggle("hidden", !isSus);
  }

  if (summaryTitle) {
    summaryTitle.textContent = isSus ? "Entrega Gratuita SUS" : "Venta Normal";
  }

  if (posTotalCard) {
    posTotalCard.classList.toggle("sus-mode", isSus);
  }

  if (posTotalLabel) {
    posTotalLabel.textContent = isSus ? "TOTAL BENEFICIARIO (SUS)" : "TOTAL A COBRAR";
  }

  if (posTotalCaption) {
    posTotalCaption.textContent = isSus
      ? "Dispensación 100% gratuita Ley N.º 1152"
      : "Cobro directo al paciente en mostrador";
  }

  if (paymentSection) {
    paymentSection.style.display = isSus ? "none" : "";
  }
}

/**
 * Actualizar la tira interactiva de detalle del medicamento seleccionado
 */
function updateProductPreview() {
  const productSelect = document.getElementById("saleProduct");
  const qtyInput = document.getElementById("saleQuantity");
  const previewStock = document.getElementById("previewStock");
  const previewPrice = document.getElementById("previewPrice");
  const previewExpiry = document.getElementById("previewExpiry");
  const previewSubtotal = document.getElementById("previewSubtotal");

  const opt = productSelect?.selectedOptions[0];
  if (!opt || !opt.value) {
    if (previewStock) previewStock.textContent = "0 unidades";
    if (previewPrice) previewPrice.textContent = "—";
    if (previewExpiry) previewExpiry.textContent = "—";
    if (previewSubtotal) previewSubtotal.textContent = "Bs 0,00";
    return;
  }

  const stock = parseInt(opt.getAttribute("data-stock"), 10) || 0;
  const salePrice = parseFloat(opt.getAttribute("data-price")) || 0;
  const expiry = opt.getAttribute("data-expiry");
  const qty = parseInt(qtyInput?.value || "1", 10) || 1;

  const expStatus = getExpiryStatus(expiry);
  const isSus = currentSaleType === "sus";
  const subtotal = isSus ? 0 : salePrice * qty;

  if (previewStock) {
    previewStock.textContent = `${stock} unidades`;
    previewStock.style.color = stock <= 10 ? "#d97706" : "#0f172a";
  }

  if (previewPrice) {
    previewPrice.textContent = isSus ? "Gratis (SUS)" : `Bs ${salePrice.toFixed(2)}`;
  }

  if (previewExpiry) {
    previewExpiry.textContent = `${expiry || "—"} (${expStatus.label})`;
    previewExpiry.className = `preview-badge ${
      expStatus.status === "red"
        ? "badge-danger"
        : expStatus.status === "yellow"
        ? "badge-warning"
        : "badge-success"
    }`;
  }

  if (previewSubtotal) {
    previewSubtotal.textContent = isSus ? "Bs 0,00 (Exonerado)" : `Bs ${subtotal.toFixed(2)}`;
  }
}

export function initPosEvents() {
  // 1. Selector de Tipo de Salida (Normal vs SUS)
  const typeButtons = document.querySelectorAll("[data-sale-type]");
  typeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      typeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentSaleType = btn.getAttribute("data-sale-type");

      populateProductSelect();
      updateModeUI();
      updateProductPreview();
      updateCartUI();
    });
  });

  // 2. Eventos del Combobox con Buscador Integrado en el Desplegable
  const trigger = document.getElementById("comboboxTrigger");
  const searchInput = document.getElementById("comboboxSearchInput");
  const clearBtn = document.getElementById("comboboxClearBtn");
  const productSelect = document.getElementById("saleProduct");
  const qtyInput = document.getElementById("saleQuantity");

  trigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    const combobox = document.getElementById("posCombobox");
    if (combobox?.classList.contains("open")) {
      closeCombobox();
    } else {
      openCombobox();
    }
  });

  trigger?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openCombobox();
    }
  });

  searchInput?.addEventListener("input", (e) => {
    const query = e.target.value.trim().toLowerCase();
    renderComboboxOptions(query);
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeCombobox();
      trigger?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const firstOpt = document.querySelector("#comboboxOptions .pos-option-item");
      if (firstOpt) {
        const id = firstOpt.getAttribute("data-id");
        selectProductById(id);
        closeCombobox();
        qtyInput?.focus();
        qtyInput?.select();
      }
    }
  });

  clearBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (searchInput) {
      searchInput.value = "";
      renderComboboxOptions("");
      searchInput.focus();
    }
  });

  document.addEventListener("click", (e) => {
    const combobox = document.getElementById("posCombobox");
    if (combobox && !combobox.contains(e.target)) {
      closeCombobox();
    }
  });

  // 3. Reactividad en el selector de producto y cantidad
  productSelect?.addEventListener("change", updateProductPreview);
  qtyInput?.addEventListener("input", updateProductPreview);

  // 3. Botón Agregar al Carrito
  const addBtn = document.getElementById("addToCart");
  addBtn?.addEventListener("click", () => {
    const selectedOption = productSelect?.selectedOptions[0];
    if (!selectedOption || !selectedOption.value) {
      showToast("Atención", "Seleccione un medicamento disponible.", "warning");
      return;
    }

    const inventoryId = selectedOption.value;
    const name = selectedOption.getAttribute("data-name");
    const lot = selectedOption.getAttribute("data-lot");
    const stock = parseInt(selectedOption.getAttribute("data-stock"), 10);
    const salePrice = parseFloat(selectedOption.getAttribute("data-price")) || 0;
    const unitCost = parseFloat(selectedOption.getAttribute("data-cost")) || 0;
    const qty = parseInt(qtyInput?.value || "1", 10);

    if (qty <= 0) {
      showToast("Cantidad inválida", "La cantidad debe ser mayor a cero.", "warning");
      return;
    }

    const existingInCart = cart.find((item) => item.inventoryId === inventoryId);
    const currentQtyInCart = existingInCart ? existingInCart.quantity : 0;

    if (currentQtyInCart + qty > stock) {
      showToast(
        "Stock insuficiente",
        `Solo quedan ${stock} unidades disponibles en este lote (en carrito: ${currentQtyInCart}).`,
        "warning"
      );
      return;
    }

    const branchId = selectedOption.getAttribute("data-branch") || currentActiveBranch;

    if (existingInCart) {
      existingInCart.quantity += qty;
    } else {
      cart.push({
        inventoryId,
        branchId,
        name,
        lot,
        quantity: qty,
        unitPrice: currentSaleType === "sus" ? 0 : salePrice,
        salePrice,
        unitCost,
        stockMax: stock
      });
    }

    if (qtyInput) qtyInput.value = "1";
    updateProductPreview();
    updateCartUI();
    showToast("Agregado a la orden", `${qty}x ${name} (Lote: ${lot})`, "success");
  });

  // 4. Botón Registrar y Procesar Salida
  const completeBtn = document.getElementById("completeSale");
  completeBtn?.addEventListener("click", async () => {
    if (cart.length === 0) {
      showToast("Orden vacía", "Agregue medicamentos a la orden antes de procesar.", "warning");
      return;
    }

    const user = getCurrentUser();
    const branchSelect = document.getElementById("branchSelect");
    const selectedBranchVal = branchSelect?.value || currentActiveBranch;
    const movementBranch =
      user?.role !== "admin" && user?.branch_id !== "all"
        ? user.branch_id
        : selectedBranchVal === "all"
        ? (cart[0]?.branchId || "san-carlos")
        : selectedBranchVal;

    let patientName = "";
    let susCode = "";

    if (currentSaleType === "sus") {
      patientName = document.getElementById("susPatientName")?.value.trim() || "";
      susCode = document.getElementById("susCode")?.value.trim() || "";
      if (!patientName) {
        showToast("Campo requerido", "Ingrese el nombre del paciente beneficiario del SUS.", "warning");
        document.getElementById("susPatientName")?.focus();
        return;
      }
    }

    const notes = document.getElementById("saleNotes")?.value.trim() || "";

    try {
      completeBtn.disabled = true;
      completeBtn.innerHTML = `
        <svg style="animation: spin 1s linear infinite;"><use href="#i-cart"/></svg>
        <span>Procesando salida...</span>
      `;

      const movement = await processSale({
        branchId: movementBranch,
        type: currentSaleType,
        items: cart,
        patientName,
        susCode,
        notes
      });

      // Limpiar formulario y orden
      cart = [];
      const searchInput = document.getElementById("comboboxSearchInput");
      if (searchInput) searchInput.value = "";
      closeCombobox();
      if (document.getElementById("susPatientName")) document.getElementById("susPatientName").value = "";
      if (document.getElementById("susCode")) document.getElementById("susCode").value = "";
      if (document.getElementById("saleNotes")) document.getElementById("saleNotes").value = "";

      updateCartUI();
      await renderPosModule(selectedBranchVal);

      // Mostrar Comprobante Oficial Imprimible
      showReceiptModal(movement);
    } catch (err) {
      showToast("Error al registrar salida", err.message, "error");
    } finally {
      completeBtn.disabled = false;
      completeBtn.innerHTML = `
        <svg width="20" height="20"><use href="#i-check"/></svg>
        <span>Registrar y Emitir Comprobante</span>
      `;
    }
  });
}

/**
 * Actualizar la lista visual del carrito y los totales en el panel de resumen
 */
function updateCartUI() {
  const cartList = document.getElementById("cartList");
  const cartCountLabel = document.getElementById("cartCountLabel");
  const summaryItems = document.getElementById("summaryItems");
  const summarySubtotal = document.getElementById("summarySubtotal");
  const summaryProfit = document.getElementById("summaryProfit");
  const summaryTotal = document.getElementById("summaryTotal");

  if (!cartList) return;

  if (cart.length === 0) {
    cartList.innerHTML = `
      <div class="cart-empty">
        <svg><use href="#i-cart"/></svg>
        <strong>No hay medicamentos en la orden actual</strong>
        <p>Seleccione un medicamento arriba y presione "Agregar a orden" para iniciar la dispensación.</p>
      </div>
    `;
    if (cartCountLabel) cartCountLabel.textContent = "0 ítems agregados";
    if (summaryItems) summaryItems.textContent = "0";
    if (summarySubtotal) summarySubtotal.textContent = "Bs 0,00";
    if (summaryProfit) summaryProfit.textContent = "Bs 0,00";
    if (summaryTotal) summaryTotal.textContent = "Bs 0,00";
    return;
  }

  let totalItems = 0;
  let subtotal = 0;
  let totalProfit = 0;

  cartList.innerHTML = cart
    .map((item, idx) => {
      const price = currentSaleType === "sus" ? 0 : item.salePrice;
      const lineTotal = +(price * item.quantity).toFixed(2);
      const profit =
        currentSaleType === "sus" ? 0 : +(lineTotal - item.unitCost * item.quantity).toFixed(2);

      totalItems += item.quantity;
      subtotal += lineTotal;
      totalProfit += profit;

      return `
        <div class="pos-cart-item">
          <div class="cart-item-info">
            <strong>${item.name}</strong>
            <div class="cart-item-tags">
              <span class="cart-lot-pill">LOTE: ${item.lot}</span>
              <span class="cart-unit-price">${
                currentSaleType === "sus"
                  ? "Cobertura SUS (Bs 0.00)"
                  : `Bs ${item.salePrice.toFixed(2)} c/u`
              }</span>
            </div>
          </div>
          <div class="cart-item-actions">
            <div class="cart-stepper">
              <button type="button" class="btn-stepper btn-stepper-minus" data-idx="${idx}" title="Disminuir cantidad">−</button>
              <span class="stepper-val">${item.quantity}</span>
              <button type="button" class="btn-stepper btn-stepper-plus" data-idx="${idx}" title="Aumentar cantidad">+</button>
            </div>
            <strong class="cart-item-price ${currentSaleType === "sus" ? "sus" : ""}">
              ${currentSaleType === "sus" ? "Bs 0,00" : `Bs ${lineTotal.toFixed(2)}`}
            </strong>
            <button type="button" class="btn-cart-remove" data-idx="${idx}" title="Quitar de la orden">
              <svg width="15" height="15"><use href="#i-close"/></svg>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  if (cartCountLabel) {
    cartCountLabel.textContent = `${cart.length} ítem(s) · ${totalItems} unidad(es)`;
  }
  if (summaryItems) summaryItems.textContent = `${totalItems} uds.`;
  if (summarySubtotal) summarySubtotal.textContent = `Bs ${subtotal.toFixed(2)}`;
  if (summaryProfit) summaryProfit.textContent = `Bs ${totalProfit.toFixed(2)}`;
  if (summaryTotal) {
    summaryTotal.textContent = currentSaleType === "sus" ? "Bs 0,00" : `Bs ${subtotal.toFixed(2)}`;
  }

  // Eventos de stepper (+ / -) y eliminar
  cartList.querySelectorAll(".btn-stepper-minus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      if (cart[idx].quantity > 1) {
        cart[idx].quantity--;
      } else {
        cart.splice(idx, 1);
      }
      updateCartUI();
    });
  });

  cartList.querySelectorAll(".btn-stepper-plus").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      const item = cart[idx];
      if (item.stockMax && item.quantity >= item.stockMax) {
        showToast(
          "Stock límite alcanzado",
          `No hay más de ${item.stockMax} unidades de este lote en inventario.`,
          "warning"
        );
        return;
      }
      item.quantity++;
      updateCartUI();
    });
  });

  cartList.querySelectorAll(".btn-cart-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      cart.splice(idx, 1);
      updateCartUI();
    });
  });
}

/**
 * Mostrar Comprobante / Recibo Oficial
 */
function showReceiptModal(movement) {
  const dialog = document.getElementById("movementDialog");
  const detail = document.getElementById("movementDetail");
  const title = document.getElementById("movementTitle");

  if (!dialog || !detail) return;

  if (title) {
    title.textContent = movement.type === "sus" ? "Comprobante de Entrega SUS" : "Recibo Oficial de Venta";
  }

  const isSus = movement.type === "sus";

  detail.innerHTML = `
    <div class="receipt-box printable" style="padding: 18px 24px;">
      <div class="receipt-header text-center" style="text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 14px; margin-bottom: 16px;">
        <img src="/assets/logo-san-carlos.png" alt="Logo San Carlos" style="height: 52px; margin-bottom: 8px;" />
        <h3 style="font-family: 'Outfit', sans-serif; font-size: 1.15rem; color: #0f172a; font-weight: 800;">GOBIERNO AUTÓNOMO MUNICIPAL DE SAN CARLOS</h3>
        <p style="font-size: 0.8rem; color: #64748b; margin-top: 2px;">Red Municipal de Farmacias Comunitarias</p>
        <div style="display: inline-block; margin-top: 8px; padding: 4px 14px; border-radius: 999px; font-weight: 800; font-size: 0.76rem; letter-spacing: 0.04em; ${
          isSus
            ? "background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;"
            : "background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;"
        }">
          ${isSus ? "DISPENSACIÓN GRATUITA SUS · LEY 1152" : "VENTA COMERCIAL EN MOSTRADOR"}
        </div>
      </div>

      <div class="receipt-info-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.82rem; margin-bottom: 18px; background: #f8fafc; padding: 12px 16px; border-radius: 12px; border: 1px solid #e2e8f0;">
        <div><strong>N.º Movimiento:</strong> <span style="font-family: monospace;">${movement.id}</span></div>
        <div><strong>Fecha / Hora:</strong> ${formatBusinessDateTime(movement.timestamp)}</div>
        <div><strong>Sucursal:</strong> ${movement.branch_id}</div>
        <div><strong>Dispensado por:</strong> ${movement.responsible}</div>
        ${isSus ? `<div><strong>Beneficiario:</strong> ${movement.patient_name || "No especificado"}</div>` : ""}
        ${isSus && movement.sus_code ? `<div><strong>Código SUS / CI:</strong> ${movement.sus_code}</div>` : ""}
        ${movement.notes ? `<div style="grid-column: 1 / -1;"><strong>Obs / Receta:</strong> ${movement.notes}</div>` : ""}
      </div>

      <table class="receipt-table" style="width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-bottom: 16px;">
        <thead>
          <tr style="background: #f1f5f9; border-bottom: 1px solid #cbd5e1;">
            <th style="padding: 8px 10px; text-align: left;">Medicamento</th>
            <th style="padding: 8px 10px; text-align: center;">Lote</th>
            <th style="padding: 8px 10px; text-align: center;">Cant.</th>
            <th style="padding: 8px 10px; text-align: right;">P. Unit</th>
            <th style="padding: 8px 10px; text-align: right;">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${movement.lines
            .map(
              (l) => `
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 8px 10px; font-weight: 600;">${l.name}</td>
              <td style="padding: 8px 10px; text-align: center; font-family: monospace; font-size: 0.75rem;">${l.lot}</td>
              <td style="padding: 8px 10px; text-align: center; font-weight: 700;">${l.quantity}</td>
              <td style="padding: 8px 10px; text-align: right;">Bs ${Number(l.unitPrice || 0).toFixed(2)}</td>
              <td style="padding: 8px 10px; text-align: right; font-weight: 700;">Bs ${Number(l.subtotal || 0).toFixed(2)}</td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>

      <div class="receipt-total-row" style="display: flex; justify-content: space-between; align-items: baseline; padding: 14px 16px; background: #f8fafc; border-radius: 12px; border: 1.5px solid #cbd5e1; margin-bottom: 16px;">
        <span style="font-weight: 800; font-size: 1rem; color: #1e293b;">TOTAL PAGADO:</span>
        <h2 style="font-family: 'Outfit', sans-serif; font-size: 1.6rem; font-weight: 800; color: ${isSus ? "#1d4ed8" : "#047857"};">
          ${isSus ? "Bs 0,00 (Exonerado)" : `Bs ${Number(movement.total).toFixed(2)}`}
        </h2>
      </div>

      <div class="receipt-footer text-center" style="text-align: center; font-size: 0.72rem; color: #94a3b8; border-top: 1px dashed #e2e8f0; padding-top: 12px;">
        <p>Documento de control y dispensación municipal · Gobierno Autónomo Municipal de San Carlos</p>
      </div>
    </div>

    <div class="receipt-actions no-print mt-4" style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
      <button class="button primary" onclick="window.print()" style="height: 44px; padding: 0 20px; font-weight: 700; border-radius: 10px; display: inline-flex; align-items: center; gap: 8px;">
        <svg width="16" height="16"><use href="#i-download"/></svg>
        <span>Imprimir Comprobante Oficial</span>
      </button>
    </div>
  `;

  dialog.showModal();
}
