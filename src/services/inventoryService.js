/**
 * Servicio de Inventario y Lotes
 * Gobierno Autónomo Municipal de San Carlos
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { showToast } from "./toastService.js";
import { enqueueOfflineAction, notifyDataChanged } from "./syncService.js";

const INVENTORY_CACHE_KEY = "farmacias_inventory_cache";
let inventoryCache = null;
let lastInventoryFetchTime = 0;
const CACHE_TTL_MS = 60000; // 60 segundos de caché en memoria para respuesta instantánea

export function invalidateInventoryCache() {
  inventoryCache = null;
  lastInventoryFetchTime = 0;
}

export async function getInventory(branchId = "all", forceRefresh = false) {
  const now = Date.now();

  // 1. Respuesta instantánea en memoria si la caché está vigente y no se forzó recarga
  if (inventoryCache && !forceRefresh && (now - lastInventoryFetchTime < CACHE_TTL_MS)) {
    if (branchId && branchId !== "all") {
      return inventoryCache.filter((x) => x.branch_id === branchId);
    }
    return inventoryCache;
  }

  // 2. Consulta a Supabase (cargamos el inventario completo para alimentar la caché de todas las sucursales)
  try {
    const data = await supabaseQuery("inventory?select=*&order=name.asc,expiry.asc");
    if (data && data.length > 0) {
      inventoryCache = data;
      lastInventoryFetchTime = now;
      try {
        localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(data));
      } catch (_) {}

      if (branchId && branchId !== "all") {
        return inventoryCache.filter((x) => x.branch_id === branchId);
      }
      return inventoryCache;
    }
  } catch (err) {
    console.warn("Fallo de red al obtener inventario de Supabase, usando respaldo local:", err);
  }

  // 3. Respaldo desde memoria o localStorage si falla la red
  if (!inventoryCache) {
    try {
      const saved = localStorage.getItem(INVENTORY_CACHE_KEY);
      if (saved) {
        inventoryCache = JSON.parse(saved);
        lastInventoryFetchTime = now;
      }
    } catch (_) {}
  }

  if (inventoryCache) {
    if (branchId && branchId !== "all") {
      return inventoryCache.filter((x) => x.branch_id === branchId);
    }
    return inventoryCache;
  }
  return [];
}

/**
 * Modificar margen y precio autorizado por administración
 */
export async function updateProductMargin(productId, marginPercent) {
  const user = getCurrentUser();
  if (user?.role !== "admin") {
    throw new Error("Solo los administradores pueden cambiar los márgenes de ganancia.");
  }

  const allInv = await getInventory("all");
  const product = allInv.find((x) => x.id === productId);
  if (!product) throw new Error("Producto no encontrado en inventario.");

  const unitCost = Number(product.unit_cost) || 0;
  const margin = Number(marginPercent) || 0;
  const salePrice = +(unitCost * (1 + margin / 100)).toFixed(2);

  // 1. Actualización optimista local inmediata
  product.margin = margin;
  product.sale_price = salePrice;
  product.price_configured = true;
  if (inventoryCache) {
    const idx = inventoryCache.findIndex((x) => x.id === productId);
    if (idx !== -1) {
      inventoryCache[idx] = { ...inventoryCache[idx], margin, sale_price: salePrice, price_configured: true };
    }
  }
  try {
    localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(allInv));
  } catch (_) {}

  // 2. Persistir en Supabase o encolar si estamos fuera de línea
  try {
    await supabaseQuery(`inventory?id=eq.${encodeURIComponent(productId)}`, {
      method: "PATCH",
      body: {
        margin,
        sale_price: salePrice,
        price_configured: true
      }
    });

    try {
      await supabaseQuery("audit_logs", {
        method: "POST",
        body: {
          user_name: user.name,
          user_role: user.role,
          branch_id: product.branch_id,
          action: "UPDATE_MARGIN",
          entity: "inventory",
          details: { productId, name: product.name, margin, salePrice }
        }
      });
    } catch (_) {}

    notifyDataChanged("inventory");
    showToast("Precio guardado", `Nuevo precio fijado en Bs ${salePrice.toFixed(2)}.`);
  } catch (err) {
    enqueueOfflineAction(
      "UPDATE_PRICE",
      `inventory?id=eq.${encodeURIComponent(productId)}`,
      "PATCH",
      { margin, sale_price: salePrice, price_configured: true },
      `PRICE-${productId}`
    );
  }

  return true;
}

export function getExpiryStatus(expiryDateStr) {
  if (!expiryDateStr) return { status: "green", label: "Vigente", months: 99 };
  const today = new Date();
  const expiry = new Date(expiryDateStr);
  const diffTime = expiry - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  const diffMonths = +(diffDays / 30.4).toFixed(1);

  if (diffDays <= 0) {
    return { status: "expired", label: "Vencido", months: 0, days: diffDays };
  } else if (diffDays <= 90) {
    return { status: "red", label: "Crítico (≤ 3 meses)", months: diffMonths, days: diffDays };
  } else if (diffDays <= 180) {
    return { status: "yellow", label: "Alerta (≤ 6 meses)", months: diffMonths, days: diffDays };
  } else {
    return { status: "green", label: "Óptimo", months: diffMonths, days: diffDays };
  }
}
