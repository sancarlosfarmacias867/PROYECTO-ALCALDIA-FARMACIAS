/**
 * Servicio de Ingresos y Reabastecimiento de Lotes
 * Soporte Offline y Sincronización Inmediata con Supabase
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { showToast } from "./toastService.js";
import { getBranchCode } from "./branchesService.js";
import { enqueueOfflineAction, notifyDataChanged } from "./syncService.js";

const ENTRIES_CACHE_KEY = "farmacias_entries_cache";
const INVENTORY_CACHE_KEY = "farmacias_inventory_cache";

export async function getEntries(branchId = "all") {
  try {
    let endpoint = "inventory_entries?select=*&order=timestamp.desc";
    if (branchId && branchId !== "all") {
      endpoint += `&branch_id=eq.${encodeURIComponent(branchId)}`;
    }
    const data = await supabaseQuery(endpoint);
    if (data && data.length > 0) {
      if (branchId === "all") {
        try {
          localStorage.setItem(ENTRIES_CACHE_KEY, JSON.stringify(data));
        } catch (_) {}
      }
      return data;
    }
  } catch (err) {
    console.warn("Fallo al obtener ingresos desde Supabase, usando respaldo local:", err);
  }

  // Respaldo desde localStorage
  try {
    const raw = localStorage.getItem(ENTRIES_CACHE_KEY);
    if (raw) {
      const list = JSON.parse(raw);
      if (branchId !== "all") {
        return list.filter((x) => x.branch_id === branchId);
      }
      return list;
    }
  } catch (_) {}

  return [];
}

export async function createEntry({
  name,
  lot,
  branchId,
  quantity,
  unitCost,
  margin = 30,
  entryDate,
  expiry,
  supplier = "Distribuidora Municipal Central",
  invoiceNumber = ""
}) {
  const user = getCurrentUser();
  if (user?.role === "vendedor") {
    throw new Error("Los vendedores no tienen permisos para ingresar medicamentos.");
  }

  const cleanName = name.trim();
  const cleanLot = lot.trim();
  const qty = parseInt(quantity, 10);
  const cost = parseFloat(unitCost);
  const marginPct = parseFloat(margin) || 30;
  const salePrice = +(cost * (1 + marginPct / 100)).toFixed(2);
  const isTechnician = user?.role === "tecnico";

  const entryId = `ING-${Date.now().toString().slice(-6)}`;
  const now = new Date();
  const timestamp = `${entryDate || now.toISOString().slice(0, 10)}T${now.toTimeString().slice(0, 8)}`;

  // 1. Buscar si ya existe este lote en la sucursal (Supabase o Cache Local)
  let existing = null;
  try {
    existing = await supabaseQuery(
      `inventory?branch_id=eq.${encodeURIComponent(branchId)}&lot=eq.${encodeURIComponent(cleanLot)}&select=*`
    );
  } catch (_) {}

  let localInv = [];
  try {
    localInv = JSON.parse(localStorage.getItem(INVENTORY_CACHE_KEY) || "[]");
  } catch (_) {}

  if ((!existing || existing.length === 0) && localInv.length > 0) {
    const match = localInv.find(
      (x) => x.branch_id === branchId && (x.lot || "").trim().toLowerCase() === cleanLot.toLowerCase()
    );
    if (match) existing = [match];
  }

  let inventoryId;
  let isExisting = existing && existing.length > 0;

  if (isExisting) {
    const item = existing[0];
    inventoryId = item.id;
    const newQty = item.quantity + qty;

    const patchBody = {
      quantity: newQty,
      unit_cost: cost,
      sale_price: isTechnician ? item.sale_price : salePrice,
      expiry: expiry || item.expiry,
    };

    // Actualización local inmediata de inventario
    const localIdx = localInv.findIndex((x) => x.id === item.id);
    if (localIdx !== -1) {
      localInv[localIdx] = { ...localInv[localIdx], ...patchBody };
      try {
        localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(localInv));
      } catch (_) {}
    }

    try {
      await supabaseQuery(`inventory?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        body: patchBody
      });
    } catch (_) {
      enqueueOfflineAction(
        "RESTOCK_ADD_QTY",
        `inventory?id=eq.${encodeURIComponent(item.id)}`,
        "PATCH",
        patchBody,
        `RESTOCK-${entryId}`
      );
    }
  } else {
    const code = getBranchCode(branchId);
    inventoryId = `${code}-${Date.now().toString().slice(-4)}`;

    const newInvItem = {
      id: inventoryId,
      branch_id: branchId,
      name: cleanName,
      lot: cleanLot,
      quantity: qty,
      unit_cost: cost,
      sale_price: salePrice,
      margin: marginPct,
      price_configured: !isTechnician,
      entry_date: entryDate || now.toISOString().slice(0, 10),
      expiry: expiry
    };

    // Agregar a cache local de inventario
    localInv.push(newInvItem);
    try {
      localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(localInv));
    } catch (_) {}

    try {
      await supabaseQuery("inventory", {
        method: "POST",
        body: newInvItem
      });
    } catch (_) {
      enqueueOfflineAction(
        "RESTOCK_NEW_ITEM",
        "inventory",
        "POST",
        newInvItem,
        `INV-${inventoryId}`
      );
    }
  }

  // 2. Registrar en la tabla de ingresos
  const entryRecord = {
    id: entryId,
    date: entryDate || now.toISOString().slice(0, 10),
    timestamp,
    branch_id: branchId,
    inventory_id: inventoryId,
    name: cleanName,
    lot: cleanLot,
    quantity: qty,
    unit_cost: cost,
    expiry,
    supplier,
    invoice_number: invoiceNumber,
    responsible: user?.name || "Técnico de Turno"
  };

  // Guardar en cache local de ingresos
  try {
    const cachedEntries = JSON.parse(localStorage.getItem(ENTRIES_CACHE_KEY) || "[]");
    cachedEntries.unshift(entryRecord);
    localStorage.setItem(ENTRIES_CACHE_KEY, JSON.stringify(cachedEntries));
  } catch (_) {}

  try {
    await supabaseQuery("inventory_entries", {
      method: "POST",
      body: entryRecord
    });
  } catch (_) {
    enqueueOfflineAction(
      "CREATE_ENTRY",
      "inventory_entries",
      "POST",
      entryRecord,
      entryId
    );
  }

  // 3. Auditoría (no bloqueante)
  try {
    await supabaseQuery("audit_logs", {
      method: "POST",
      body: {
        user_name: user?.name || "Técnico",
        user_role: user?.role || "tecnico",
        branch_id: branchId,
        action: "RESTOCK_ENTRY",
        entity: "inventory_entries",
        details: {
          entryId,
          name: cleanName,
          lot: cleanLot,
          quantity: qty,
          unitCost: cost,
          expiry
        }
      }
    });
  } catch (_) {}

  notifyDataChanged("inventory");
  notifyDataChanged("entries");

  showToast("Lote ingresado", `${qty} uds. de ${cleanName} (Lote: ${cleanLot}) guardadas en inventario.`);
  return entryRecord;
}
