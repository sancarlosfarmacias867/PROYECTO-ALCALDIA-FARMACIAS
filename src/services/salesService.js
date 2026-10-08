/**
 * Servicio de Ventas y Entregas SUS
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { showToast } from "./toastService.js";
import { getExpiryStatus } from "./inventoryService.js";

export async function getMovements(branchId = "all", month = null) {
  try {
    let endpoint = "movements?select=*&order=timestamp.desc";
    const filters = [];
    if (branchId && branchId !== "all") {
      filters.push(`branch_id=eq.${encodeURIComponent(branchId)}`);
    }
    if (month) {
      filters.push(`date=gte.${month}-01&date=lte.${month}-31`);
    }
    if (filters.length > 0) {
      endpoint += `&${filters.join("&")}`;
    }
    const data = await supabaseQuery(endpoint);
    return data || [];
  } catch (err) {
    console.error("Error al obtener movimientos:", err);
    return [];
  }
}

export async function processSale({ branchId, type, items, patientName = "", susCode = "", notes = "" }) {
  const user = getCurrentUser();
  if (!items || items.length === 0) {
    throw new Error("El carrito está vacío. Agregue al menos un medicamento.");
  }

  // Verificar stock actual y vencimiento de cada lote
  for (const item of items) {
    const freshStock = await supabaseQuery(`inventory?id=eq.${encodeURIComponent(item.inventoryId)}&select=*`);
    if (!freshStock || freshStock.length === 0) {
      throw new Error(`El producto ${item.name} ya no existe en el inventario.`);
    }
    const product = freshStock[0];
    if (product.quantity < item.quantity) {
      throw new Error(`Stock insuficiente para ${product.name} (Lote: ${product.lot}). Disponible: ${product.quantity}, solicitado: ${item.quantity}.`);
    }
    const expiryInfo = getExpiryStatus(product.expiry);
    if (expiryInfo.days <= 0) {
      throw new Error(`El lote ${product.lot} de ${product.name} está vencido. No se puede vender ni dispensar.`);
    }
  }

  const isSus = type === "sus";
  let totalAmount = 0;
  let totalProfit = 0;
  let totalItemsCount = 0;

  const movementLines = items.map((item) => {
    const qty = Number(item.quantity);
    const unitPrice = isSus ? 0 : Number(item.unitPrice || item.salePrice);
    const unitCost = Number(item.unitCost) || 0;
    const lineSubtotal = isSus ? 0 : +(unitPrice * qty).toFixed(2);
    const lineProfit = isSus ? 0 : +(lineSubtotal - (unitCost * qty)).toFixed(2);

    totalAmount += lineSubtotal;
    totalProfit += lineProfit;
    totalItemsCount += qty;

    return {
      inventoryId: item.inventoryId,
      name: item.name,
      lot: item.lot,
      quantity: qty,
      unitPrice,
      unitCost,
      subtotal: lineSubtotal,
      profit: lineProfit
    };
  });

  const movementId = `MOV-${Date.now().toString().slice(-6)}`;
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timestampStr = now.toISOString();

  const movementData = {
    id: movementId,
    date: dateStr,
    timestamp: timestampStr,
    branch_id: branchId,
    type,
    items: totalItemsCount,
    total: +totalAmount.toFixed(2),
    profit: +totalProfit.toFixed(2),
    responsible: user ? user.name : "Operador",
    patient_name: patientName,
    sus_code: susCode,
    notes,
    lines: movementLines
  };

  // 1. Guardar movimiento en Supabase
  await supabaseQuery("movements", {
    method: "POST",
    body: movementData
  });

  // 2. Descontar stock de cada lote
  for (const item of movementLines) {
    const freshStock = await supabaseQuery(`inventory?id=eq.${encodeURIComponent(item.inventoryId)}&select=quantity`);
    const currentQty = freshStock[0]?.quantity || 0;
    const newQty = Math.max(0, currentQty - item.quantity);

    await supabaseQuery(`inventory?id=eq.${encodeURIComponent(item.inventoryId)}`, {
      method: "PATCH",
      body: { quantity: newQty }
    });
  }

  // 3. Registrar auditoría
  try {
    await supabaseQuery("audit_logs", {
      method: "POST",
      body: {
        user_name: user?.name || "Operador",
        user_role: user?.role || "vendedor",
        branch_id: branchId,
        action: isSus ? "SUS_DELIVERY" : "SALE_COMPLETED",
        entity: "movements",
        details: {
          movementId,
          type,
          total: totalAmount,
          patientName,
          itemsCount: totalItemsCount
        }
      }
    });
  } catch (_) {}

  showToast(
    isSus ? "Entrega SUS completada" : "Venta registrada con éxito",
    `${movementId} · ${totalItemsCount} unidades · ${isSus ? "Gratuito (SUS)" : `Bs ${totalAmount.toFixed(2)}`}`
  );

  return movementData;
}
