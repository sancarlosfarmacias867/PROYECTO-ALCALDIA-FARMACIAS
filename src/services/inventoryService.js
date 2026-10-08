/**
 * Servicio de Inventario y Lotes
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { showToast } from "./toastService.js";

let inventoryCache = null;

export async function getInventory(branchId = "all", forceRefresh = false) {
  if (inventoryCache && !forceRefresh && branchId === "all") {
    return inventoryCache;
  }
  try {
    let endpoint = "inventory?select=*&order=name.asc,expiry.asc";
    if (branchId && branchId !== "all") {
      endpoint += `&branch_id=eq.${encodeURIComponent(branchId)}`;
    }
    const data = await supabaseQuery(endpoint);
    if (branchId === "all") inventoryCache = data;
    return data || [];
  } catch (err) {
    console.error("Error al obtener inventario de Supabase:", err);
    return inventoryCache || [];
  }
}

export async function updateProductMargin(productId, marginPercent) {
  const user = getCurrentUser();
  if (user?.role !== "admin") {
    throw new Error("Solo los administradores pueden cambiar los márgenes de ganancia.");
  }

  // Obtener producto actual
  const items = await supabaseQuery(`inventory?id=eq.${encodeURIComponent(productId)}&select=*`);
  if (!items || items.length === 0) throw new Error("Producto no encontrado.");
  
  const product = items[0];
  const unitCost = Number(product.unit_cost) || 0;
  const margin = Number(marginPercent) || 0;
  const salePrice = +(unitCost * (1 + margin / 100)).toFixed(2);

  await supabaseQuery(`inventory?id=eq.${encodeURIComponent(productId)}`, {
    method: "PATCH",
    body: {
      margin,
      sale_price: salePrice,
      price_configured: true
    }
  });

  // Registrar auditoría
  try {
    await supabaseQuery("audit_logs", {
      method: "POST",
      body: {
        user_name: user.name,
        user_role: user.role,
        branch_id: product.branch_id,
        action: "UPDATE_MARGIN",
        entity: "inventory",
        details: {
          productId,
          productName: product.name,
          oldMargin: product.margin,
          newMargin: margin,
          oldPrice: product.sale_price,
          newPrice: salePrice
        }
      }
    });
  } catch (_) {}

  showToast("Precio actualizado", `${product.name}: nuevo precio Bs ${salePrice.toFixed(2)} (${margin}% margen)`);
  return { ...product, margin, sale_price: salePrice, price_configured: true };
}

export function getExpiryStatus(expiryDate) {
  if (!expiryDate) return { status: "green", days: 999, label: "Vigente" };
  const today = new Date();
  const exp = new Date(expiryDate);
  const diffDays = Math.ceil((exp - today) / (1000 * 60 * 60 * 24));

  if (diffDays <= 90) {
    return { status: "red", days: diffDays, label: diffDays <= 0 ? "Vencido" : `Vence en ${diffDays} días` };
  }
  if (diffDays <= 180) {
    return { status: "yellow", days: diffDays, label: `Vence en ${Math.ceil(diffDays / 30)} meses` };
  }
  return { status: "green", days: diffDays, label: "Vigente" };
}
