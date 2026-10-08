/**
 * Servicio de Ingresos y Reabastecimiento de Lotes
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { showToast } from "./toastService.js";
import { getBranchCode } from "./branchesService.js";

export async function getEntries(branchId = "all") {
  try {
    let endpoint = "inventory_entries?select=*&order=timestamp.desc";
    if (branchId && branchId !== "all") {
      endpoint += `&branch_id=eq.${encodeURIComponent(branchId)}`;
    }
    const data = await supabaseQuery(endpoint);
    return data || [];
  } catch (err) {
    console.error("Error al obtener ingresos:", err);
    return [];
  }
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

  // 1. Buscar si ya existe este lote en la sucursal
  const existing = await supabaseQuery(
    `inventory?branch_id=eq.${encodeURIComponent(branchId)}&lot=eq.${encodeURIComponent(cleanLot)}&select=*`
  );

  let inventoryId;
  if (existing && existing.length > 0) {
    const item = existing[0];
    inventoryId = item.id;
    const newQty = item.quantity + qty;

    await supabaseQuery(`inventory?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: {
        quantity: newQty,
        unit_cost: cost,
        sale_price: isTechnician ? item.sale_price : salePrice,
        expiry: expiry || item.expiry,
      }
    });
  } else {
    const code = getBranchCode(branchId);
    inventoryId = `${code}-${Date.now().toString().slice(-4)}`;

    await supabaseQuery("inventory", {
      method: "POST",
      body: {
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
      }
    });
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

  await supabaseQuery("inventory_entries", {
    method: "POST",
    body: entryRecord
  });

  // 3. Auditoría
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

  showToast("Lote ingresado", `${qty} uds. de ${cleanName} (Lote: ${cleanLot}) guardadas en inventario.`);
  return entryRecord;
}
