import { seedInventory, seedSales, seedEntries, seedUsers } from "./data.js";

const KEY = "farmacias-san-carlos-demo-v3";
const CLOUD_STATE_URL = "https://mantledb.sh/v2/farmacias-sc-4f8c2a9d7e61/state";
let saveTimer;
let queuedState;

const clone = (value) => JSON.parse(JSON.stringify(value));

export function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.inventory && saved?.sales && saved?.users) {
      let changed = false;
      const migrateBranch = (record) => {
        if (record.branchId === "2-febrero") { record.branchId = "2-agosto"; changed = true; }
      };
      saved.inventory.forEach((item) => {
        migrateBranch(item);
        if (item.lot?.startsWith("2F-")) { item.lot = item.lot.replace(/^2F-/, "2A-"); changed = true; }
        if (item.id?.startsWith("2F-")) { item.id = item.id.replace(/^2F-/, "2A-"); changed = true; }
      });
      saved.sales.forEach(migrateBranch);
      saved.sales.forEach((sale, index) => {
        if (!sale.timestamp) {
          sale.timestamp = `${sale.date}T${String(8 + (index % 9)).padStart(2, "0")}:${String((index * 7) % 60).padStart(2, "0")}:00`;
          changed = true;
        }
        if (!Array.isArray(sale.lines)) {
          const product = saved.inventory.find((x) => x.branchId === sale.branchId) || saved.inventory[0];
          const quantity = sale.items || 1;
          sale.lines = product ? [{ inventoryId: product.id, name: product.name, lot: product.lot, quantity, unitPrice: sale.type === "sus" ? 0 : +(sale.total / quantity).toFixed(2), unitCost: product.unitCost, subtotal: sale.total }] : [];
          changed = true;
        }
        if (/^MOV-\d{4}$/.test(sale.id)) {
          const branchIndex = ["santa-fe","buen-retiro","san-carlos","antofagasta","2-agosto","villa-imperial"].indexOf(sale.branchId);
          const demoSeller = ["Ana Rojas","Luis Pedraza","Carla Méndez","José Vaca","Rosa Suárez","Diego Lima"][branchIndex];
          if (demoSeller && sale.responsible !== demoSeller) { sale.responsible = demoSeller; changed = true; }
        }
      });
      if (!Array.isArray(saved.entries)) {
        saved.entries = saved.inventory.map((item, index) => ({ id:`ING-MIG-${index + 1}`, date:item.entryDate, timestamp:`${item.entryDate}T${String(7 + (index % 10)).padStart(2, "0")}:00:00`, branchId:item.branchId, inventoryId:item.id, name:item.name, lot:item.lot, quantity:item.quantity, unitCost:item.unitCost, expiry:item.expiry, responsible:"Registro inicial" }));
        changed = true;
      }
      saved.entries.forEach((entry) => {
        migrateBranch(entry);
        if (entry.lot?.startsWith("2F-")) { entry.lot = entry.lot.replace(/^2F-/, "2A-"); changed = true; }
      });
      const currentMonth = new Date().toISOString().slice(0, 7);
      if (!saved.entries.some((entry) => entry.date?.startsWith(currentMonth))) {
        saved.entries.unshift(...clone(seedEntries.filter((entry) => entry.date.startsWith(currentMonth))));
        changed = true;
      }
      saved.users.forEach(migrateBranch);
      if (changed) localStorage.setItem(KEY, JSON.stringify(saved));
      return saved;
    }
  } catch (_) { /* use demo seed */ }
  return { inventory: clone(seedInventory), sales: clone(seedSales), entries: clone(seedEntries), users: clone(seedUsers) };
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
  queuedState = JSON.parse(JSON.stringify(state));
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSharedState(queuedState), 300);
}

function syncEvent(status, message) {
  window.dispatchEvent(new CustomEvent("pharmacy-sync", { detail: { status, message } }));
}

export async function saveSharedState(state) {
  try {
    syncEvent("syncing", "Guardando para todos los dispositivos…");
    const shared = { ...state, initialized: true, sharedUpdatedAt: new Date().toISOString() };
    const response = await fetch(CLOUD_STATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(shared),
    });
    if (!response.ok) throw new Error(`Cloud save failed: ${response.status}`);
    state.sharedUpdatedAt = shared.sharedUpdatedAt;
    localStorage.setItem(KEY, JSON.stringify(state));
    syncEvent("shared", "Datos compartidos entre dispositivos");
    return true;
  } catch (_) {
    syncEvent("local", "Sin conexión · cambios guardados localmente");
    return false;
  }
}

export async function loadSharedState(fallback, initialize = true) {
  try {
    syncEvent("syncing", "Consultando datos compartidos…");
    const response = await fetch(`${CLOUD_STATE_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`Cloud read failed: ${response.status}`);
    const shared = await response.json();
    const valid = shared?.initialized && Array.isArray(shared.inventory) && Array.isArray(shared.sales) && Array.isArray(shared.entries) && Array.isArray(shared.users);
    if (!valid && initialize) {
      const created = await saveSharedState(fallback);
      return created ? fallback : null;
    }
    if (!valid) return null;
    localStorage.setItem(KEY, JSON.stringify(shared));
    syncEvent("shared", "Datos compartidos entre dispositivos");
    return shared;
  } catch (_) {
    syncEvent("local", "Sin conexión · cambios guardados localmente");
    return null;
  }
}

export function resetState() {
  localStorage.removeItem(KEY);
  return loadState();
}
