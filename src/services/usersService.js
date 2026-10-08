/**
 * Servicio de Administración de Usuarios y Roles (Supabase PostgreSQL)
 * Soporte Offline y Sincronización Inmediata
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser, getRoleLabel } from "./authService.js";
import { showToast } from "./toastService.js";
import { enqueueOfflineAction, notifyDataChanged } from "./syncService.js";

const USERS_CACHE_KEY = "farmacias_custom_users";

function sanitizeUser(u) {
  if (!u) return u;
  let name = u.name || "";
  name = name
    .replace(/\ufffd/g, "")
    .replace(/Carla M\?*ndez|Carla Mndez/gi, "Carla Méndez")
    .replace(/Jos\?* Vaca|Jos Vaca/gi, "José Vaca")
    .replace(/Mar\?*a Aguilera|Mara Aguilera/gi, "María Aguilera")
    .replace(/Rosa Su\?*rez|Rosa Surez/gi, "Rosa Suárez");
  return { ...u, name };
}

export async function getUsers() {
  try {
    const data = await supabaseQuery("app_users?select=*&order=name.asc");
    if (data && data.length > 0) {
      const sanitized = data.map(sanitizeUser);
      try {
        localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(sanitized));
      } catch (_) {}
      return sanitized;
    }
  } catch (err) {
    console.warn("Aviso: usando usuarios en caché local por desconexión:", err);
  }

  try {
    const cached = localStorage.getItem(USERS_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      return parsed.map(sanitizeUser);
    }
  } catch (_) {}
  return [];
}

export async function createUser({ name, email, pin, role, branchId }) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden crear nuevos usuarios.");
  }

  const cleanName = (name || "").trim();
  const cleanEmail = (email || "").trim().toLowerCase();
  const cleanPin = (pin || "").trim();

  if (!cleanName) throw new Error("Debe ingresar el nombre completo del funcionario.");
  if (!cleanEmail) throw new Error("Debe ingresar el correo o identificador de acceso.");
  if (!cleanPin || cleanPin.length < 4) throw new Error("La contraseña debe tener al menos 4 caracteres.");

  // Verificar si ya existe en Supabase o en caché local
  try {
    const existing = await supabaseQuery(`app_users?email=eq.${encodeURIComponent(cleanEmail)}&select=id`);
    if (existing && existing.length > 0) {
      throw new Error(`El usuario o correo "${cleanEmail}" ya está registrado en el sistema.`);
    }
  } catch (err) {
    if (err.message.includes("ya está registrado")) throw err;
  }

  const cached = JSON.parse(localStorage.getItem(USERS_CACHE_KEY) || "[]");
  if (cached.some((u) => u.email === cleanEmail)) {
    throw new Error(`El usuario o correo "${cleanEmail}" ya está registrado localmente.`);
  }

  const userId = `U-${Date.now().toString().slice(-6)}`;

  const newUser = {
    id: userId,
    name: cleanName,
    email: cleanEmail,
    pin: cleanPin,
    role: role || "vendedor",
    branch_id: branchId || "san-carlos",
    active: true,
    last_access: null
  };

  // Sincronizar caché local inmediato
  cached.push(newUser);
  try {
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(cached));
  } catch (_) {}

  try {
    await supabaseQuery("app_users", {
      method: "POST",
      body: newUser
    });
  } catch (_) {
    enqueueOfflineAction("CREATE_USER", "app_users", "POST", newUser, userId);
  }

  // Registrar en Auditoría Municipal
  try {
    await supabaseQuery("audit_logs", {
      method: "POST",
      body: {
        user_name: currentUser.name,
        user_role: currentUser.role,
        branch_id: branchId || "all",
        action: "CREATE_USER",
        entity: "app_users",
        details: { userId, name: cleanName, email: cleanEmail, role, branchId }
      }
    });
  } catch (_) {}

  notifyDataChanged("users");
  showToast("Usuario registrado", `${cleanName} fue dado de alta como ${getRoleLabel(role)} con éxito.`);
  return newUser;
}

export async function updateUser(userId, fields) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden modificar usuarios.");
  }

  const payload = {};
  if (fields.name) payload.name = fields.name.trim();
  if (fields.email) payload.email = fields.email.trim().toLowerCase();
  if (fields.role) payload.role = fields.role;
  if (fields.branch_id) payload.branch_id = fields.branch_id;
  if (fields.pin && fields.pin.trim().length >= 4) {
    payload.pin = fields.pin.trim();
  }

  // Actualizar caché local de inmediato
  try {
    const cached = JSON.parse(localStorage.getItem(USERS_CACHE_KEY) || "[]");
    const idx = cached.findIndex((u) => u.id === userId);
    if (idx !== -1) {
      cached[idx] = { ...cached[idx], ...payload };
      localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(cached));
    }
  } catch (_) {}

  // Si el usuario editado es el actual, refrescar sesión activa
  if (currentUser.id === userId) {
    const updatedSelf = { ...currentUser, ...payload };
    localStorage.setItem("farmacias_san_carlos_session", JSON.stringify(updatedSelf));
  }

  try {
    await supabaseQuery(`app_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: payload
    });
  } catch (_) {
    enqueueOfflineAction(
      "UPDATE_USER",
      `app_users?id=eq.${encodeURIComponent(userId)}`,
      "PATCH",
      payload,
      `UPDATE_USER_${userId}`
    );
  }

  notifyDataChanged("users");
  showToast("Usuario actualizado", "Los datos y credenciales han sido guardados correctamente.");
  return true;
}

export async function toggleUserActive(userId, currentStatus) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden activar o desactivar usuarios.");
  }
  if (userId === currentUser.id && currentStatus) {
    throw new Error("No puede desactivar su propia cuenta activa de administrador.");
  }

  const newStatus = !currentStatus;

  // Actualizar caché local
  try {
    const cached = JSON.parse(localStorage.getItem(USERS_CACHE_KEY) || "[]");
    const idx = cached.findIndex((u) => u.id === userId);
    if (idx !== -1) {
      cached[idx].active = newStatus;
      localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(cached));
    }
  } catch (_) {}

  try {
    await supabaseQuery(`app_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: { active: newStatus }
    });
  } catch (_) {
    enqueueOfflineAction(
      "TOGGLE_USER_ACTIVE",
      `app_users?id=eq.${encodeURIComponent(userId)}`,
      "PATCH",
      { active: newStatus },
      `TOGGLE_USER_${userId}`
    );
  }

  notifyDataChanged("users");
  showToast(
    newStatus ? "Usuario activado" : "Usuario desactivado",
    `El funcionario ahora está ${newStatus ? "Activo" : "Inactivo"}.`
  );
  return newStatus;
}

export async function deleteUser(userId) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden eliminar usuarios.");
  }
  if (userId === currentUser.id || userId === "U-ADMIN") {
    throw new Error("No puede eliminar la cuenta de Administrador Principal.");
  }

  // Actualizar caché local
  try {
    const cached = JSON.parse(localStorage.getItem(USERS_CACHE_KEY) || "[]");
    const filtered = cached.filter((u) => u.id !== userId);
    localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(filtered));
  } catch (_) {}

  try {
    await supabaseQuery(`app_users?id=eq.${encodeURIComponent(userId)}`, {
      method: "DELETE"
    });
  } catch (_) {
    enqueueOfflineAction(
      "DELETE_USER",
      `app_users?id=eq.${encodeURIComponent(userId)}`,
      "DELETE",
      null,
      `DELETE_USER_${userId}`
    );
  }

  notifyDataChanged("users");
  showToast("Usuario eliminado", "El usuario ha sido retirado definitivamente del sistema.");
  return true;
}
