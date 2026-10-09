/**
 * Servicio de Ventas y Entregas SUS con Sincronización en la Nube y Soporte Offline
 * Gobierno Autónomo Municipal de San Carlos
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { showToast } from "./toastService.js";
import { getExpiryStatus, getInventory, invalidateInventoryCache } from "./inventoryService.js";
import { enqueueOfflineAction, notifyDataChanged } from "./syncService.js";
import { getBusinessDate, getBusinessTimestamp } from "../utils/dateTime.js";

const MOVEMENTS_CACHE_KEY = "farmacias_movements_cache";
const INVENTORY_CACHE_KEY = "farmacias_inventory_cache";
let movementsCache = null;
let lastMovementsFetchTime = 0;
const CACHE_TTL_MS = 60000; // 60 segundos de caché en memoria

export function invalidateMovementsCache() {
  movementsCache = null;
  lastMovementsFetchTime = 0;
}

export async function getMovements(branchId = "all", month = null, forceRefresh = false) {
  const now = Date.now();

  // 1. Respuesta instantánea en memoria si la caché está vigente
  if (movementsCache && !forceRefresh && (now - lastMovementsFetchTime < CACHE_TTL_MS)) {
    let list = movementsCache;
    if (branchId && branchId !== "all") {
      list = list.filter((m) => m.branch_id === branchId);
    }
    if (month) {
      list = list.filter((m) => m.date && m.date.startsWith(month));
    }
    return list;
  }

  // 2. Consulta remota de todos los movimientos a Supabase
  try {
    const data = await supabaseQuery("movements?select=*&order=timestamp.desc");
    if (data && data.length > 0) {
      movementsCache = data;
      lastMovementsFetchTime = now;
      try {
        localStorage.setItem(MOVEMENTS_CACHE_KEY, JSON.stringify(data));
      } catch (_) {}

      let list = movementsCache;
      if (branchId && branchId !== "all") {
        list = list.filter((m) => m.branch_id === branchId);
      }
      if (month) {
        list = list.filter((m) => m.date && m.date.startsWith(month));
      }
      return list;
    }
  } catch (err) {
    console.warn("Fallo de red al consultar movimientos de Supabase, usando respaldo local:", err);
  }

  // 3. Respaldo local si no hay conexión o falla la red
  if (!movementsCache) {
    try {
      const cached = localStorage.getItem(MOVEMENTS_CACHE_KEY);
      if (cached) {
        movementsCache = JSON.parse(cached);
        lastMovementsFetchTime = now;
      }
    } catch (_) {}
  }

  if (movementsCache) {
    let list = movementsCache;
    if (branchId && branchId !== "all") {
      list = list.filter((m) => m.branch_id === branchId);
    }
    if (month) {
      list = list.filter((m) => m.date && m.date.startsWith(month));
    }
    return list;
  }

  return [];
}

export async function processSale({ branchId, type, items, patientName = "", susCode = "", notes = "" }) {
  const user = getCurrentUser();
  if (!items || items.length === 0) {
    throw new Error("El carrito está vacío. Agregue al menos un medicamento.");
  }

  // 1. Obtener inventario actual (local o remoto) y verificar existencias
  const currentInventory = await getInventory(branchId);
  for (const item of items) {
    const product = currentInventory.find((x) => x.id === item.inventoryId);
    if (!product) {
      throw new Error(`El producto ${item.name} ya no existe en el inventario.`);
    }
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
  const dateStr = getBusinessDate(now);
  const timestampStr = getBusinessTimestamp(now);

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

  // 2. Actualización optimista inmediata del inventario y movimientos en caché local
  try {
    const allInv = JSON.parse(localStorage.getItem(INVENTORY_CACHE_KEY) || "[]");
    for (const line of movementLines) {
      const idx = allInv.findIndex((x) => x.id === line.inventoryId);
      if (idx !== -1) {
        allInv[idx].quantity = Math.max(0, (allInv[idx].quantity || 0) - line.quantity);
      }
    }
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(allInv));

    const allMovs = JSON.parse(localStorage.getItem(MOVEMENTS_CACHE_KEY) || "[]");
    allMovs.unshift(movementData);
    localStorage.setItem(MOVEMENTS_CACHE_KEY, JSON.stringify(allMovs));

    if (movementsCache) {
      movementsCache.unshift(movementData);
    }
    invalidateInventoryCache();
  } catch (_) {}

  // 3. Persistir en Supabase o encolar en Outbox si falla la red
  let savedRemotely = false;
  try {
    // 3.1 Insertar movimiento
    await supabaseQuery("movements", {
      method: "POST",
      body: movementData
    });

    // 3.2 Descontar stock en Supabase
    for (const item of movementLines) {
      try {
        const freshStock = await supabaseQuery(`inventory?id=eq.${encodeURIComponent(item.inventoryId)}&select=quantity`);
        const currentQty = freshStock[0]?.quantity || 0;
        const newQty = Math.max(0, currentQty - item.quantity);
        await supabaseQuery(`inventory?id=eq.${encodeURIComponent(item.inventoryId)}`, {
          method: "PATCH",
          body: { quantity: newQty }
        });
      } catch (stockError) {
        console.warn(`No se pudo descontar en nube el lote ${item.inventoryId}. Se reintentará automáticamente.`, stockError);
        enqueueOfflineAction(
          "DEDUCT_STOCK",
          `inventory?id=eq.${encodeURIComponent(item.inventoryId)}`,
          "PATCH",
          { quantity_decrement: item.quantity },
          `STOCK-${movementId}-${item.inventoryId}`
        );
      }
    }

    // 3.3 Auditoría
    try {
      await supabaseQuery("audit_logs", {
        method: "POST",
        body: {
          user_name: user?.name || "Operador",
          user_role: user?.role || "vendedor",
          branch_id: branchId,
          action: isSus ? "SUS_DELIVERY" : "SALE_COMPLETED",
          entity: "movements",
          details: { movementId, type, total: totalAmount, patientName, itemsCount: totalItemsCount }
        }
      });
    } catch (_) {}

    savedRemotely = true;
    notifyDataChanged("sales");
  } catch (err) {
    console.warn("Fallo de red al registrar venta en Supabase. Encolando para sincronización automática:", err);
    // Encolar movimiento con clave única
    enqueueOfflineAction("PROCESS_SALE", "movements", "POST", movementData, movementId);

    // Encolar descuento de stock
    for (const item of movementLines) {
      enqueueOfflineAction(
        "DEDUCT_STOCK",
        `inventory?id=eq.${encodeURIComponent(item.inventoryId)}`,
        "PATCH",
        { quantity_decrement: item.quantity },
        `STOCK-${movementId}-${item.inventoryId}`
      );
    }
  }

  showToast(
    savedRemotely
      ? (isSus ? "Entrega SUS completada" : "Venta registrada con éxito")
      : "Venta guardada (Modo Fuera de Línea)",
    `${movementId} · ${totalItemsCount} uds. · ${isSus ? "Gratuito (SUS)" : `Bs ${totalAmount.toFixed(2)}`}`
  );

  return movementData;
}
