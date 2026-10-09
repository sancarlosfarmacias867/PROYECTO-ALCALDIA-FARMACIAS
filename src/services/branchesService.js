/**
 * Servicio de Sucursales Municipales
 */
import { supabaseQuery } from "../config/supabase.js";

export const FALLBACK_BRANCHES = [
  { id: "santa-fe", name: "Santa Fe", code: "SF", address: "Av. Principal Santa Fe #102", phone: "+591 3 934-2101" },
  { id: "buen-retiro", name: "Buen Retiro", code: "BR", address: "Plaza Central Buen Retiro s/n", phone: "+591 3 934-2102" },
  { id: "san-carlos", name: "San Carlos Central", code: "SC", address: "Calle Bolívar esq. Sucre", phone: "+591 3 934-2100" },
  { id: "antofagasta", name: "Antofagasta", code: "AN", address: "Barrio Antofagasta Manzana 4", phone: "+591 3 934-2104" },
  { id: "2-agosto", name: "2 de Agosto", code: "2A", address: "Av. 2 de Agosto #45", phone: "+591 3 934-2105" },
  { id: "villa-imperial", name: "Villa Imperial", code: "VI", address: "Av. Circunvalación Norte #88", phone: "+591 3 934-2106" },
];

let cachedBranches = null;

export async function getBranches(forceRefresh = false) {
  if (cachedBranches && !forceRefresh) return cachedBranches;
  try {
    const data = await supabaseQuery("branches?select=*&order=code.asc");
    if (data && data.length > 0) {
      cachedBranches = data;
      return data;
    }
  } catch (err) {
    console.warn("Usando sucursales de respaldo:", err);
  }
  cachedBranches = FALLBACK_BRANCHES;
  return FALLBACK_BRANCHES;
}

export function getBranchName(branchId, branchesList = cachedBranches || FALLBACK_BRANCHES) {
  if (branchId === "all") return "Consolidado (Todas las 6)";
  const branch = branchesList.find((b) => b.id === branchId);
  return branch ? branch.name : branchId;
}

export function getBranchCode(branchId, branchesList = cachedBranches || FALLBACK_BRANCHES) {
  const branch = branchesList.find((b) => b.id === branchId);
  return branch ? branch.code : "SC";
}
