/**
 * Servicio de Administración de Usuarios y Roles
 */
import { supabaseQuery } from "../config/supabase.js";
import { getCurrentUser } from "./authService.js";
import { showToast } from "./toastService.js";

export async function getUsers() {
  try {
    const data = await supabaseQuery("app_users?select=*&order=name.asc");
    return data || [];
  } catch (err) {
    console.error("Error al obtener usuarios de Supabase:", err);
    return [];
  }
}

export async function createUser({ name, email, pin = "1234", role, branchId }) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden crear nuevos usuarios.");
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();
  const userId = `U-${Date.now().toString().slice(-4)}`;

  const newUser = {
    id: userId,
    name: cleanName,
    email: cleanEmail,
    pin: pin || "1234",
    role,
    branch_id: branchId,
    active: true,
    last_access: new Date().toISOString()
  };

  await supabaseQuery("app_users", {
    method: "POST",
    body: newUser
  });

  // Auditoría
  try {
    await supabaseQuery("audit_logs", {
      method: "POST",
      body: {
        user_name: currentUser.name,
        user_role: currentUser.role,
        branch_id: branchId,
        action: "CREATE_USER",
        entity: "app_users",
        details: { userId, name: cleanName, email: cleanEmail, role, branchId }
      }
    });
  } catch (_) {}

  showToast("Usuario creado", `${cleanName} ha sido registrado como ${role}.`);
  return newUser;
}

export async function updateUser(userId, fields) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden modificar usuarios.");
  }

  await supabaseQuery(`app_users?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: fields
  });

  showToast("Usuario actualizado", "Los datos del usuario han sido actualizados en Supabase.");
  return true;
}

export async function toggleUserActive(userId, currentStatus) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden activar o desactivar usuarios.");
  }

  const newStatus = !currentStatus;
  await supabaseQuery(`app_users?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    body: { active: newStatus }
  });

  showToast(
    newStatus ? "Usuario activado" : "Usuario desactivado",
    `El usuario ahora está ${newStatus ? "Activo" : "Inactivo"}.`
  );
  return newStatus;
}

export async function deleteUser(userId) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin") {
    throw new Error("Solo los administradores pueden eliminar usuarios.");
  }
  if (userId === currentUser.id) {
    throw new Error("No puedes eliminar tu propia cuenta de administrador.");
  }

  await supabaseQuery(`app_users?id=eq.${encodeURIComponent(userId)}`, {
    method: "DELETE"
  });

  showToast("Usuario eliminado", "El usuario ha sido retirado del sistema.");
  return true;
}
