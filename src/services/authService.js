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

export function sanitizeUserName(name) {
  if (!name) return "";
  return name
    .replace(/\ufffd/g, "")
    .replace(/Carla M\?*ndez|Carla Mndez/gi, "Carla Méndez")
    .replace(/Jos\?* Vaca|Jos Vaca/gi, "José Vaca")
    .replace(/Mar\?*a Aguilera|Mara Aguilera/gi, "María Aguilera")
    .replace(/Rosa Su\?*rez|Rosa Surez/gi, "Rosa Suárez");
}

export function initAuth() {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(AUTH_KEY);
      if (saved) {
        currentUser = JSON.parse(saved);
        if (currentUser && currentUser.name) {
          currentUser.name = sanitizeUserName(currentUser.name);
        }
      } else {
        currentUser = null;
      }
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
  const cleanId = (identifier || "").trim().toLowerCase();
  const cleanPin = (pin || "").trim();

  if (!cleanId || !cleanPin) {
    throw new Error("Debe ingresar su usuario institucional y contraseña.");
  }

  try {
    // 1. Consultar usuarios en Supabase
    let users = await supabaseQuery("app_users?select=*");

    if (users && users.length > 0) {
      // Guardar respaldo en caché
      try {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("farmacias_custom_users", JSON.stringify(users));
        }
      } catch (_) {}

      // Búsqueda inteligente (email, usuario sin dominio, nombre o admin)
      const matched = users.find((u) => {
        const uEmail = (u.email || "").toLowerCase();
        const uName = (u.name || "").toLowerCase();
        if (uEmail === cleanId) return true;
        if (uEmail.split("@")[0] === cleanId) return true;
        if (cleanId === "admin" && (uEmail === "admin" || u.role === "admin")) return true;
        if (uName === cleanId) return true;
        return false;
      });

      if (matched) {
        if (!matched.active) {
          throw new Error("Este usuario se encuentra desactivado. Comuníquese con la administración municipal.");
        }
        if (matched.pin && matched.pin !== cleanPin) {
          throw new Error("Contraseña incorrecta. Verifique sus credenciales.");
        }

        // Actualizar último acceso en Supabase
        try {
          await supabaseQuery(`app_users?id=eq.${encodeURIComponent(matched.id)}`, {
            method: "PATCH",
            body: { last_access: new Date().toISOString() }
          });
        } catch (_) {}

        matched.name = sanitizeUserName(matched.name);
        currentUser = matched;
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(AUTH_KEY, JSON.stringify(matched));
        }
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("pharmacy-auth-change", { detail: { user: matched } }));
        }
        showToast("Bienvenido al Sistema", `${matched.name} (${getRoleLabel(matched.role)})`);
        return matched;
      }
    }
  } catch (err) {
    if (
      err.message.includes("desactivado") ||
      err.message.includes("Contraseña") ||
      err.message.includes("PIN") ||
      err.message.includes("credenciales")
    ) {
      throw err;
    }
    console.warn("Fallo temporal Supabase, verificando respaldo local:", err);
  }

  // 2. Fallback de respaldo (Caché local sincronizada + DEFAULT_USERS)
  let allLocalUsers = [...DEFAULT_USERS];
  try {
    if (typeof localStorage !== "undefined") {
      const cached = JSON.parse(localStorage.getItem("farmacias_custom_users") || "[]");
      if (cached.length > 0) {
        allLocalUsers = cached;
      }
    }
  } catch (_) {}

  const fallback = allLocalUsers.find((u) => {
    const uEmail = (u.email || "").toLowerCase();
    const uName = (u.name || "").toLowerCase();
    return (
      uEmail === cleanId ||
      uEmail.split("@")[0] === cleanId ||
      uName === cleanId ||
      (cleanId === "admin" && u.role === "admin")
    );
  });

  if (fallback) {
    if (!fallback.active) {
      throw new Error("Este usuario se encuentra desactivado. Comuníquese con la administración municipal.");
    }
    if (fallback.pin !== cleanPin) {
      throw new Error("Contraseña incorrecta. Verifique sus credenciales.");
    }
    currentUser = fallback;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(AUTH_KEY, JSON.stringify(fallback));
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pharmacy-auth-change", { detail: { user: fallback } }));
    }
    showToast("Bienvenido al Sistema", `${fallback.name} (${getRoleLabel(fallback.role)})`);
    return fallback;
  }

  throw new Error("Usuario no encontrado en la base de datos municipal.");
}

export function logout() {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(AUTH_KEY);
  }
  currentUser = null;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("pharmacy-auth-change", { detail: { user: null } }));
  }
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
