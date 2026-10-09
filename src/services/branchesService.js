/**
 * Servicio de Administración de Sucursales Municipales
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { enqueueOfflineAction, notifyDataChanged } from "./syncService.js";
import { showToast } from "./toastService.js";

const BRANCHES_CACHE_KEY = "farmacias_branches_cache";

export const FALLBACK_BRANCHES = [
  { id: "santa-fe", name: "Santa Fe", code: "SF", address: "Av. Principal Santa Fe #102", phone: "+591 3 934-2101", active: true },
  { id: "buen-retiro", name: "Buen Retiro", code: "BR", address: "Plaza Central Buen Retiro s/n", phone: "+591 3 934-2102", active: true },
  { id: "san-carlos", name: "San Carlos Central", code: "SC", address: "Calle Bolívar esq. Sucre", phone: "+591 3 934-2100", active: true },
  { id: "antofagasta", name: "Antofagasta", code: "AN", address: "Barrio Antofagasta Manzana 4", phone: "+591 3 934-2104", active: true },
  { id: "2-agosto", name: "2 de Agosto", code: "2A", address: "Av. 2 de Agosto #45", phone: "+591 3 934-2105", active: true },
  { id: "villa-imperial", name: "Villa Imperial", code: "VI", address: "Av. Circunvalación Norte #88", phone: "+591 3 934-2106", active: true },
];

let cachedBranches = null;

function saveCache(branches) {
  cachedBranches = [...branches].sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  try { localStorage.setItem(BRANCHES_CACHE_KEY, JSON.stringify(cachedBranches)); } catch (_) {}
}

function readLocalCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BRANCHES_CACHE_KEY) || "[]");
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch (_) { return null; }
}

export function invalidateBranchesCache() {
  cachedBranches = null;
}

export async function getBranches(forceRefresh = false, includeInactive = false) {
  if (!cachedBranches || forceRefresh) {
    try {
      const data = await supabaseQuery("branches?select=*&order=code.asc");
      if (data?.length) saveCache(data);
    } catch (err) {
      console.warn("Usando sucursales en caché local:", err);
      if (!cachedBranches) cachedBranches = readLocalCache() || FALLBACK_BRANCHES;
    }
  }
  if (!cachedBranches) cachedBranches = readLocalCache() || FALLBACK_BRANCHES;
  return includeInactive ? [...cachedBranches] : cachedBranches.filter((branch) => branch.active !== false);
}

export function getBranchName(branchId, branchesList = cachedBranches || FALLBACK_BRANCHES) {
  if (branchId === "all") {
    const count = branchesList.filter((branch) => branch.active !== false).length;
    return `Consolidado (Todas las ${count})`;
  }
  return branchesList.find((item) => item.id === branchId)?.name || branchId;
}

export function getBranchCode(branchId, branchesList = cachedBranches || FALLBACK_BRANCHES) {
  return branchesList.find((item) => item.id === branchId)?.code || "SC";
}

function requireAdmin() {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") throw new Error("Solo Administración puede gestionar sucursales.");
  return currentUser;
}

function normalizeFields(fields) {
  const name = (fields.name || "").trim().replace(/\s+/g, " ");
  const code = (fields.code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const address = (fields.address || "").trim().replace(/\s+/g, " ");
  const phone = (fields.phone || "").trim();
  if (name.length < 3) throw new Error("Ingrese un nombre de sucursal válido.");
  if (code.length < 2 || code.length > 5) throw new Error("El código debe tener entre 2 y 5 letras o números.");
  if (address.length < 5) throw new Error("Ingrese una dirección suficientemente descriptiva.");
  if (phone && phone.length < 7) throw new Error("Ingrese un teléfono válido o deje el campo vacío.");
  return { name, code, address, phone };
}

function slugify(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
}

async function ensureUnique(name, code, editingId = "") {
  const branches = await getBranches(false, true);
  const duplicate = branches.find((branch) => branch.id !== editingId && (
    branch.code?.toUpperCase() === code || branch.name?.toLowerCase() === name.toLowerCase()
  ));
  if (duplicate) throw new Error(`Ya existe una sucursal con ese ${duplicate.code?.toUpperCase() === code ? "código" : "nombre"}.`);
  return branches;
}

async function writeAudit(currentUser, action, branchId, details) {
  try {
    await supabaseQuery("audit_logs", { method: "POST", body: {
      user_name: currentUser.name, user_role: currentUser.role, branch_id: branchId,
      action, entity: "branches", details
    }});
  } catch (_) {}
}

export async function createBranch(fields) {
  const currentUser = requireAdmin();
  const clean = normalizeFields(fields);
  const branches = await ensureUnique(clean.name, clean.code);
  const baseId = slugify(clean.name) || `sucursal-${Date.now()}`;
  const id = branches.some((branch) => branch.id === baseId) ? `${baseId}-${Date.now().toString().slice(-4)}` : baseId;
  const branch = { id, ...clean, active: true };
  saveCache([...branches, branch]);

  try {
    const created = await supabaseQuery("branches", { method: "POST", body: branch });
    if (created?.[0]) branch.created_at = created[0].created_at;
  } catch (_) {
    enqueueOfflineAction("CREATE_BRANCH", "branches", "POST", branch, `CREATE_BRANCH_${id}`);
  }
  await writeAudit(currentUser, "CREATE_BRANCH", id, clean);
  notifyDataChanged("branches");
  showToast("Sucursal creada", `${clean.name} ya está disponible en todos los módulos.`, "success");
  return branch;
}

export async function updateBranch(branchId, fields) {
  const currentUser = requireAdmin();
  const clean = normalizeFields(fields);
  const branches = await ensureUnique(clean.name, clean.code, branchId);
  if (!branches.some((branch) => branch.id === branchId)) throw new Error("La sucursal seleccionada ya no existe.");
  saveCache(branches.map((branch) => branch.id === branchId ? { ...branch, ...clean } : branch));

  try {
    await supabaseQuery(`branches?id=eq.${encodeURIComponent(branchId)}`, { method: "PATCH", body: clean });
  } catch (_) {
    enqueueOfflineAction("UPDATE_BRANCH", `branches?id=eq.${encodeURIComponent(branchId)}`, "PATCH", clean, `UPDATE_BRANCH_${branchId}`);
  }
  await writeAudit(currentUser, "UPDATE_BRANCH", branchId, clean);
  notifyDataChanged("branches");
  showToast("Sucursal actualizada", "Los datos se reflejarán en todo el sistema.", "success");
  return true;
}

export async function toggleBranchActive(branchId, currentStatus) {
  const currentUser = requireAdmin();
  const branches = await getBranches(false, true);
  const branch = branches.find((item) => item.id === branchId);
  if (!branch) throw new Error("La sucursal seleccionada ya no existe.");
  const nextStatus = !currentStatus;

  if (!nextStatus) {
    if (branches.filter((item) => item.active !== false).length <= 1) throw new Error("Debe permanecer al menos una sucursal activa.");
    try {
      const localUsers = JSON.parse(localStorage.getItem("farmacias_custom_users") || "[]");
      if (localUsers.some((user) => user.branch_id === branchId && user.active !== false)) {
        throw new Error("No puede desactivarla mientras tenga funcionarios activos asignados. Reasígnelos primero.");
      }
    } catch (err) {
      if (err.message.includes("funcionarios activos")) throw err;
    }
    try {
      const assigned = await supabaseQuery(`app_users?branch_id=eq.${encodeURIComponent(branchId)}&active=eq.true&select=id&limit=1`);
      if (assigned?.length) throw new Error("No puede desactivarla mientras tenga funcionarios activos asignados. Reasígnelos primero.");
    } catch (err) {
      if (err.message.includes("funcionarios activos")) throw err;
    }
  }

  saveCache(branches.map((item) => item.id === branchId ? { ...item, active: nextStatus } : item));
  try {
    await supabaseQuery(`branches?id=eq.${encodeURIComponent(branchId)}`, { method: "PATCH", body: { active: nextStatus } });
  } catch (_) {
    enqueueOfflineAction("TOGGLE_BRANCH", `branches?id=eq.${encodeURIComponent(branchId)}`, "PATCH", { active: nextStatus }, `TOGGLE_BRANCH_${branchId}`);
  }
  await writeAudit(currentUser, nextStatus ? "ACTIVATE_BRANCH" : "DEACTIVATE_BRANCH", branchId, { name: branch.name });
  notifyDataChanged("branches");
  showToast(nextStatus ? "Sucursal activada" : "Sucursal desactivada", nextStatus
    ? `${branch.name} vuelve a estar disponible para operaciones.`
    : `${branch.name} conserva su historial, pero no admite operaciones nuevas.`, "success");
  return nextStatus;
}

/**
 * Elimina únicamente sucursales completamente vacías. Los registros históricos
 * nunca se eliminan en cascada: en esos casos debe usarse "Desactivar".
 */
export async function deleteBranch(branchId) {
  const currentUser = requireAdmin();
  const branches = await getBranches(false, true);
  const branch = branches.find((item) => item.id === branchId);
  if (!branch) throw new Error("La sucursal seleccionada ya no existe.");
  if (branches.filter((item) => item.active !== false).length <= 1 && branch.active !== false) {
    throw new Error("No puede eliminar la única sucursal activa de la red municipal.");
  }

  const relations = [
    { endpoint: "inventory", label: "lotes de inventario" },
    { endpoint: "movements", label: "ventas o entregas SUS" },
    { endpoint: "inventory_entries", label: "ingresos de medicamentos" },
    { endpoint: "app_users", label: "funcionarios asignados" }
  ];

  try {
    for (const relation of relations) {
      const rows = await supabaseQuery(`${relation.endpoint}?branch_id=eq.${encodeURIComponent(branchId)}&select=id&limit=1`);
      if (rows?.length) {
        throw new Error(`No se puede eliminar porque tiene ${relation.label}. Desactívela para conservar su historial.`);
      }
    }
  } catch (error) {
    if (error.message.includes("No se puede eliminar")) throw error;
    throw new Error("Para eliminar una sucursal se necesita conexión al servidor y verificar que no tenga registros asociados.");
  }

  try {
    await supabaseQuery(`branches?id=eq.${encodeURIComponent(branchId)}`, { method: "DELETE" });
  } catch (_) {
    throw new Error("No fue posible eliminar la sucursal del servidor. Compruebe la conexión e inténtelo nuevamente.");
  }

  await writeAudit(currentUser, "DELETE_BRANCH", "all", { branchId, name: branch.name, code: branch.code });
  saveCache(branches.filter((item) => item.id !== branchId));
  notifyDataChanged("branches");
  showToast("Sucursal eliminada", `${branch.name} fue retirada definitivamente de la red.`, "success");
  return true;
}
