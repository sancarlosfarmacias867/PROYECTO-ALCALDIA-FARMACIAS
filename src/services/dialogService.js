/** Diálogos institucionales que sustituyen confirm/alert del navegador. */
let pendingResolver = null;
let bindingsReady = false;

function getElements() {
  return {
    dialog: document.getElementById("systemConfirmDialog"),
    eyebrow: document.getElementById("systemConfirmEyebrow"),
    title: document.getElementById("systemConfirmTitle"),
    message: document.getElementById("systemConfirmMessage"),
    detail: document.getElementById("systemConfirmDetail"),
    icon: document.getElementById("systemConfirmIconUse"),
    confirm: document.getElementById("systemConfirmAccept"),
    confirmText: document.getElementById("systemConfirmAcceptText"),
    cancel: document.getElementById("systemConfirmCancel")
  };
}

function finish(result) {
  const { dialog } = getElements();
  const resolve = pendingResolver;
  pendingResolver = null;
  if (dialog?.open) dialog.close();
  resolve?.(result);
}

function ensureBindings() {
  if (bindingsReady) return;
  const { dialog, confirm, cancel } = getElements();
  if (!dialog || !confirm || !cancel) return;
  bindingsReady = true;
  confirm.addEventListener("click", () => finish(true));
  cancel.addEventListener("click", () => finish(false));
  dialog.querySelectorAll("[data-close-system-confirm]").forEach((button) => {
    button.addEventListener("click", () => finish(false));
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    finish(false);
  });
}

export function showSystemConfirm({
  eyebrow = "CONFIRMACIÓN DEL SISTEMA",
  title = "¿Desea continuar?",
  message = "Confirme la acción para continuar.",
  detail = "",
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  variant = "warning",
  icon = "i-shield"
} = {}) {
  ensureBindings();
  const elements = getElements();
  if (!elements.dialog) return Promise.resolve(false);

  if (pendingResolver) finish(false);
  elements.dialog.dataset.variant = variant;
  elements.eyebrow.textContent = eyebrow;
  elements.title.textContent = title;
  elements.message.textContent = message;
  elements.detail.textContent = detail;
  elements.detail.hidden = !detail;
  elements.confirmText.textContent = confirmLabel;
  elements.cancel.textContent = cancelLabel;
  elements.icon.setAttribute("href", `#${icon}`);

  return new Promise((resolve) => {
    pendingResolver = resolve;
    elements.dialog.showModal();
    requestAnimationFrame(() => elements.cancel.focus());
  });
}
