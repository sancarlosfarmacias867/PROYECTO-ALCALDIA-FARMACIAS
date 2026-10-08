/**
 * Servicio de Notificaciones Toast
 */

export function showToast(title, message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;

  const titleEl = document.getElementById("toastTitle");
  const msgEl = document.getElementById("toastMessage");
  
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;

  // Clases por tipo
  toast.className = `toast visible toast-${type}`;

  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
  }, 4000);
}
