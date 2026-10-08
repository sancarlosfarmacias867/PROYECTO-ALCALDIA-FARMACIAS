/**
 * Módulo de Punto de Venta (Ventas Normales y Entregas SUS)
 */
import { getInventory, getExpiryStatus } from "../../services/inventoryService.js";
import { processSale } from "../../services/salesService.js";
import { getCurrentUser, isAdmin } from "../../services/authService.js";
import { getBranchName, getBranches } from "../../services/branchesService.js";
import { showToast } from "../../services/toastService.js";

let currentSaleType = "normal";
let cart = [];

export async function renderPosModule(selectedBranchId = "all") {
  const user = getCurrentUser();
  const branches = await getBranches();
  
  // Si el usuario es vendedor, forzar a su sucursal asignada
  const activeBranch = (user?.role === "vendedor" && user.branch_id !== "all") 
    ? user.branch_id 
    : (selectedBranchId === "all" ? branches[0].id : selectedBranchId);

  const saleBranchLabel = document.getElementById("saleBranchLabel");
  if (saleBranchLabel) {
    saleBranchLabel.textContent = getBranchName(activeBranch, branches);
  }

  // Cargar inventario disponible de la sucursal
  const inventory = await getInventory(activeBranch, true);
  const availableStock = inventory.filter((item) => item.quantity > 0);

  // Ordenar por FEFO (First Expired, First Out)
  availableStock.sort((a, b) => new Date(a.expiry) - new Date(b.expiry));

  const productSelect = document.getElementById("saleProduct");
  if (productSelect) {
    if (availableStock.length === 0) {
      productSelect.innerHTML = `<option value="">Sin medicamentos disponibles en esta sucursal</option>`;
    } else {
      productSelect.innerHTML = availableStock
        .map((item) => {
          const exp = getExpiryStatus(item.expiry);
          const priceStr = currentSaleType === "sus" ? "SUS (Gratuito)" : `Bs ${Number(item.sale_price).toFixed(2)}`;
          return `
            <option value="${item.id}" data-price="${item.sale_price}" data-cost="${item.unit_cost}" data-stock="${item.quantity}" data-lot="${item.lot}" data-name="${item.name}">
              ${item.name} · Lote: ${item.lot} (Stock: ${item.quantity} | ${priceStr}) [${exp.label}]
            </option>
          `;
        })
        .join("");
    }
  }

  // Renderizar campos especiales SUS si no existen
  ensureSusFields();
  updateCartUI();
}

function ensureSusFields() {
  const formSection = document.querySelector(".sale-builder .form-section");
  if (!formSection) return;

  let susContainer = document.getElementById("susExtraFields");
  if (!susContainer) {
    susContainer = document.createElement("div");
    susContainer.id = "susExtraFields";
    susContainer.className = "sus-extra-fields hidden";
    susContainer.innerHTML = `
      <div class="sus-notice">
        <span class="sus-badge">Programa SUS Bolivia</span>
        <p>Dispensación de medicamentos gratuitos para pacientes registrados en el Sistema Único de Salud.</p>
      </div>
      <div class="form-grid">
        <label>
          <span>Nombre del Paciente *</span>
          <input type="text" id="susPatientName" placeholder="Nombre completo del beneficiario" />
        </label>
        <label>
          <span>Código SUS / Cédula *</span>
          <input type="text" id="susCode" placeholder="Ej.: 8934120 SC" />
        </label>
      </div>
    `;
    formSection.insertBefore(susContainer, formSection.firstChild);
  }

  if (currentSaleType === "sus") {
    susContainer.classList.remove("hidden");
  } else {
    susContainer.classList.add("hidden");
  }
}

export function initPosEvents() {
  // Switch Tipo de Salida (Normal vs SUS)
  const typeButtons = document.querySelectorAll("[data-sale-type]");
  typeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      typeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentSaleType = btn.getAttribute("data-sale-type");
      
      const summaryTitle = document.getElementById("summaryTitle");
      if (summaryTitle) {
        summaryTitle.textContent = currentSaleType === "sus" ? "Entrega Gratuita SUS" : "Venta Normal";
      }

      ensureSusFields();
      renderPosModule();
    });
  });

  // Botón Agregar al Carrito
  const addBtn = document.getElementById("addToCart");
  const productSelect = document.getElementById("saleProduct");
  const qtyInput = document.getElementById("saleQuantity");

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
      showToast("Stock insuficiente", `Solo quedan ${stock} unidades disponibles en este lote.`, "warning");
      return;
    }

    if (existingInCart) {
      existingInCart.quantity += qty;
    } else {
      cart.push({
        inventoryId,
        name,
        lot,
        quantity: qty,
        unitPrice: currentSaleType === "sus" ? 0 : salePrice,
        salePrice,
        unitCost
      });
    }

    if (qtyInput) qtyInput.value = "1";
    updateCartUI();
    showToast("Agregado al carrito", `${qty}x ${name} (Lote: ${lot})`);
  });

  // Botón Registrar Movimiento
  const completeBtn = document.getElementById("completeSale");
  completeBtn?.addEventListener("click", async () => {
    if (cart.length === 0) {
      showToast("Carrito vacío", "Agregue medicamentos antes de registrar la salida.", "warning");
      return;
    }

    const user = getCurrentUser();
    const branchSelect = document.getElementById("branchSelect");
    const activeBranch = (user?.role === "vendedor" && user.branch_id !== "all") 
      ? user.branch_id 
      : (branchSelect?.value === "all" ? "san-carlos" : branchSelect?.value || "san-carlos");

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
      completeBtn.textContent = "Procesando...";

      const movement = await processSale({
        branchId: activeBranch,
        type: currentSaleType,
        items: cart,
        patientName,
        susCode,
        notes
      });

      // Limpiar formulario y carrito
      cart = [];
      if (document.getElementById("susPatientName")) document.getElementById("susPatientName").value = "";
      if (document.getElementById("susCode")) document.getElementById("susCode").value = "";
      if (document.getElementById("saleNotes")) document.getElementById("saleNotes").value = "";
      
      updateCartUI();
      await renderPosModule(activeBranch);

      // Mostrar Comprobante / Recibo
      showReceiptModal(movement);
    } catch (err) {
      showToast("Error al registrar", err.message, "error");
    } finally {
      completeBtn.disabled = false;
      completeBtn.innerHTML = `<svg><use href="#i-check"/></svg>Registrar movimiento`;
    }
  });
}

function updateCartUI() {
  const cartList = document.getElementById("cartList");
  const summaryItems = document.getElementById("summaryItems");
  const summarySubtotal = document.getElementById("summarySubtotal");
  const summaryProfit = document.getElementById("summaryProfit");
  const summaryTotal = document.getElementById("summaryTotal");

  if (!cartList) return;

  if (cart.length === 0) {
    cartList.innerHTML = `<div class="cart-empty"><p>No hay medicamentos en la orden actual.</p></div>`;
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
      const profit = currentSaleType === "sus" ? 0 : +(lineTotal - (item.unitCost * item.quantity)).toFixed(2);

      totalItems += item.quantity;
      subtotal += lineTotal;
      totalProfit += profit;

      return `
        <div class="cart-item">
          <div class="cart-item-info">
            <strong>${item.name}</strong>
            <small>Lote: ${item.lot} · ${item.quantity} uds. × ${currentSaleType === "sus" ? "Gratis (SUS)" : `Bs ${item.salePrice.toFixed(2)}`}</small>
          </div>
          <div class="cart-item-actions">
            <strong class="cart-item-price">${currentSaleType === "sus" ? "Bs 0,00" : `Bs ${lineTotal.toFixed(2)}`}</strong>
            <button type="button" class="icon-button danger btn-remove-item" data-idx="${idx}" title="Quitar">
              <svg width="14" height="14"><use href="#i-close"/></svg>
            </button>
          </div>
        </div>
      `;
    })
    .join("");

  if (summaryItems) summaryItems.textContent = `${totalItems}`;
  if (summarySubtotal) summarySubtotal.textContent = `Bs ${subtotal.toFixed(2)}`;
  if (summaryProfit) summaryProfit.textContent = `Bs ${totalProfit.toFixed(2)}`;
  if (summaryTotal) summaryTotal.textContent = currentSaleType === "sus" ? "Bs 0,00 (SUS)" : `Bs ${subtotal.toFixed(2)}`;

  cartList.querySelectorAll(".btn-remove-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-idx"), 10);
      cart.splice(idx, 1);
      updateCartUI();
    });
  });
}

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
    <div class="receipt-box printable">
      <div class="receipt-header text-center">
        <img src="/assets/logo-san-carlos.png" alt="Logo San Carlos" style="height: 48px; margin-bottom: 8px;" />
        <h3>GOBIERNO AUTÓNOMO MUNICIPAL DE SAN CARLOS</h3>
        <p>Red Municipal de Farmacias de Salud</p>
        <div class="receipt-type-badge ${isSus ? "sus" : "sale"}">${isSus ? "DISPENSACIÓN GRATUITA SUS" : "VENTA EN MOSTRADOR"}</div>
      </div>

      <div class="receipt-info-grid">
        <div><strong>Comprobante:</strong> ${movement.id}</div>
        <div><strong>Fecha:</strong> ${new Date(movement.timestamp).toLocaleString("es-BO")}</div>
        <div><strong>Sucursal:</strong> ${movement.branch_id}</div>
        <div><strong>Atendido por:</strong> ${movement.responsible}</div>
        ${isSus ? `<div><strong>Paciente SUS:</strong> ${movement.patient_name || "No especificado"}</div>` : ""}
        ${isSus && movement.sus_code ? `<div><strong>Código SUS / CI:</strong> ${movement.sus_code}</div>` : ""}
        ${movement.notes ? `<div class="full-w"><strong>Obs / Receta:</strong> ${movement.notes}</div>` : ""}
      </div>

      <table class="receipt-table">
        <thead>
          <tr>
            <th>Medicamento</th>
            <th>Lote</th>
            <th>Cant.</th>
            <th>P. Unit</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${movement.lines.map((l) => `
            <tr>
              <td>${l.name}</td>
              <td><small>${l.lot}</small></td>
              <td>${l.quantity}</td>
              <td>Bs ${Number(l.unitPrice || 0).toFixed(2)}</td>
              <td><strong>Bs ${Number(l.subtotal || 0).toFixed(2)}</strong></td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div class="receipt-total-row">
        <span>TOTAL:</span>
        <h2>Bs ${Number(movement.total).toFixed(2)}</h2>
      </div>

      <div class="receipt-footer text-center">
        <small>Validez fiscal según normativa del Ministerio de Salud y Deportes · San Carlos, Santa Cruz</small>
      </div>
    </div>

    <div class="receipt-actions no-print mt-4">
      <button class="button primary" onclick="window.print()"><svg width="16" height="16"><use href="#i-download"/></svg> Imprimir / Guardar Ticket</button>
    </div>
  `;

  dialog.showModal();
}
