/**
 * Servicio de Autenticación y Control de Roles (Supabase)
 */
import { supabaseQuery } from "../config/supabase.js";
import { showToast } from "./toastService.js";

const AUTH_KEY = "farmacias_san_carlos_session";

let currentUser = null;

export const DEFAULT_USERS = [
  { id: "U-ADMIN", name: "Administrador General", email: "admin", pin: "admin123", role: "admin", branch_id: "all", active: true },
  { id: "U-01", name: "María Aguilera", email: "admin@sancarlos.gob.bo", pin: "admin123", role: "admin", branch_id: "all", active: true },
  { id: "U-02", name: "Carlos Rivero", email: "carlos.tecnico@sancarlos.gob.bo", pin: "admin123", role: "tecnico", branch_id: "san-carlos", active: true },
  { id: "U-03", name: "Ana Rojas", email: "ana.santafe@sancarlos.gob.bo", pin: "admin123", role: "vendedor", branch_id: "santa-fe", active: true },
  { id: "U-04", name: "Luis Pedraza", email: "luis.buenretiro@sancarlos.gob.bo", pin: "admin123", role: "vendedor", branch_id: "buen-retiro", active: true },
  { id: "U-05", name: "Carla Méndez", email: "carla.tecnico@sancarlos.gob.bo", pin: "admin123", role: "tecnico", branch_id: "antofagasta", active: true },
  { id: "U-06", name: "José Vaca", email: "jose.sancarlos@sancarlos.gob.bo", pin: "admin123", role: "vendedor", branch_id: "san-carlos", active: true },
  { id: "U-07", name: "Rosa Suárez", email: "rosa.villaimperial@sancarlos.gob.bo", pin: "admin123", role: "vendedor", branch_id: "villa-imperial", active: true },
  { id: "U-08", name: "Diego Lima", email: "diego.2agosto@sancarlos.gob.bo", pin: "admin123", role: "vendedor", branch_id: "2-agosto", active: true },
];

export function initAuth() {
  try {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      currentUser = JSON.parse(saved);
    } else {
      currentUser = null;
    }
  } catch (e) {
    currentUser = null;
  }
  return currentUser;
}

export function getCurrentUser() {
  return currentUser;
}

export async function login(identifier, pin) {
  const cleanId = identifier.trim().toLowerCase();
  const cleanPin = pin.trim();

  try {
    // Buscar por email o id en Supabase
    let query = `app_users?email=eq.${encodeURIComponent(cleanId)}&select=*`;
    let users = await supabaseQuery(query);

    // Si no encuentra por email exacto y buscó "admin", buscar también "admin@sancarlos.gob.bo"
    if ((!users || users.length === 0) && cleanId === "admin") {
      users = await supabaseQuery(`app_users?email=eq.admin@sancarlos.gob.bo&select=*`);
    }

    if (users && users.length > 0) {
      const user = users[0];
      if (!user.active) {
        throw new Error("Este usuario se encuentra desactivado. Comuníquese con administración.");
      }
      if (user.pin && user.pin !== cleanPin) {
        throw new Error("Contraseña o PIN incorrecto. Intente nuevamente.");
      }

      // Actualizar último acceso en Supabase
      try {
        await supabaseQuery(`app_users?id=eq.${user.id}`, {
          method: "PATCH",
          body: { last_access: new Date().toISOString() }
        });
      } catch (_) {}

      currentUser = user;
      localStorage.setItem(AUTH_KEY, JSON.stringify(user));
      window.dispatchEvent(new CustomEvent("pharmacy-auth-change", { detail: { user } }));
      showToast("Bienvenido al Sistema", `${user.name} (${getRoleLabel(user.role)})`);
      return user;
    }
  } catch (err) {
    if (err.message.includes("desactivado") || err.message.includes("Contraseña") || err.message.includes("PIN")) {
      throw err;
    }
    console.warn("Fallo consulta Supabase, verificando respaldo local:", err);
  }

  // Fallback a usuarios locales por defecto
  const fallback = DEFAULT_USERS.find(
    (u) => u.email.toLowerCase() === cleanId || (cleanId === "admin" && u.role === "admin")
  );

  if (fallback) {
    if (fallback.pin !== cleanPin) {
      throw new Error("Contraseña o PIN incorrecto. Intente nuevamente.");
    }
    currentUser = fallback;
    localStorage.setItem(AUTH_KEY, JSON.stringify(fallback));
    window.dispatchEvent(new CustomEvent("pharmacy-auth-change", { detail: { user: fallback } }));
    showToast("Bienvenido al Sistema", `${fallback.name} (${getRoleLabel(fallback.role)})`);
    return fallback;
  }

  throw new Error("Usuario no encontrado en el sistema.");
}

export function switchRole(role, branchId = "all") {
  let user = DEFAULT_USERS.find((u) => u.role === role);
  if (!user) user = { ...DEFAULT_USERS[0], role, branch_id: branchId };
  if (branchId !== "all") user.branch_id = branchId;
  currentUser = user;
  localStorage.setItem(AUTH_KEY, JSON.stringify(user));
  window.dispatchEvent(new CustomEvent("pharmacy-auth-change", { detail: { user } }));
  showToast("Rol cambiado", `Ahora estás en modo ${getRoleLabel(role)}`);
  return user;
}

export function logout() {
  localStorage.removeItem(AUTH_KEY);
  currentUser = null;
  window.dispatchEvent(new CustomEvent("pharmacy-auth-change", { detail: { user: null } }));
  showToast("Sesión cerrada", "Has salido del sistema de farmacias.", "info");
}

export function isAdmin() {
  return getCurrentUser()?.role === "admin";
}

export function isTechnician() {
  return getCurrentUser()?.role === "tecnico";
}

export function isSeller() {
  return getCurrentUser()?.role === "vendedor";
}

export function getRoleLabel(role) {
  switch (role) {
    case "admin": return "Administrador(a)";
    case "tecnico": return "Técnico Farmacéutico";
    case "vendedor": return "Vendedor(a) / SUS";
    default: return role;
  }
}
