// Visual enhancement of the existing selector: its options and permissions remain authoritative.
let disposePicker;
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function renderBranchPicker(select, branches) {
  disposePicker?.();
  document.getElementById("branchPicker")?.remove();
  const host = select.closest(".context");
  host.classList.add("has-branch-picker");
  select.hidden = true;
  const root = document.createElement("div");
  root.id = "branchPicker";
  root.className = "branch-picker";
  root.innerHTML = `
    <button type="button" class="branch-trigger" aria-expanded="false" aria-controls="branchPickerPanel">
      <span class="branch-emblem">${icon("grid")}</span>
      <span class="branch-trigger-copy"><span class="branch-eyebrow">RED MUNICIPAL <span class="branch-signal"></span></span><strong></strong></span>
      <span class="branch-trigger-badge"></span>
      <span class="branch-chevron" aria-hidden="true">⌄</span>
    </button>
    <section id="branchPickerPanel" class="branch-picker-panel" aria-label="Seleccionar sucursal" hidden>
      <header class="branch-panel-header"><div><span class="branch-eyebrow">FARMACIAS · SAN CARLOS</span><h2>Tu red, en un solo lugar.</h2><p>Elige la sucursal que quieres consultar.</p></div><span class="branch-panel-icon">${icon("store")}</span></header>
      <div class="branch-options"></div>
      <footer class="branch-panel-footer">${icon("shield")}<span>Vista según tu sucursal seleccionada</span><kbd>ESC</kbd></footer>
    </section>`;
  host.append(root);
  const trigger = root.querySelector(".branch-trigger");
  const panel = root.querySelector(".branch-picker-panel");
  const options = root.querySelector(".branch-options");
  const listeners = new AbortController();
  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: listeners.signal });
  disposePicker = () => listeners.abort();
  trigger.disabled = select.disabled;

  const close = (restoreFocus = false) => {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  };
  const update = () => {
    const branch = branches.find((item) => item.id === select.value);
    const all = select.value === "all";
    const name = all ? "Todas las sucursales" : branch?.name || select.selectedOptions[0]?.textContent || "Sin sucursales";
    trigger.querySelector("strong").textContent = name;
    trigger.querySelector(".branch-trigger-badge").textContent = all ? String(branches.length).padStart(2, "0") : branch?.code || "—";
    trigger.querySelector(".branch-emblem").innerHTML = icon(select.disabled ? "lock" : all ? "grid" : "store");
    trigger.setAttribute("aria-label", `${select.disabled ? "Sucursal asignada" : "Seleccionar sucursal"}: ${name}`);
    options.querySelectorAll("button").forEach((button) => {
      const active = button.dataset.value === select.value;
      button.classList.toggle("is-selected", active);
      button.setAttribute("aria-pressed", String(active));
    });
  };

  for (const option of select.options) {
    const branch = branches.find((item) => item.id === option.value);
    const all = option.value === "all";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `branch-choice${all ? " branch-choice-all" : ""}`;
    button.dataset.value = option.value;
    button.innerHTML = `<span class="branch-choice-code"></span><span class="branch-choice-copy"><strong></strong><small></small></span><span class="branch-choice-check">${icon("check")}</span>`;
    const badge = button.querySelector(".branch-choice-code");
    if (all) badge.innerHTML = icon("grid");
    else badge.textContent = branch?.code || "FM";
    button.querySelector("strong").textContent = all ? "Vista consolidada" : branch?.name || option.textContent;
    button.querySelector("small").textContent = all ? `Una visión global de las ${branches.length} farmacias` : branch?.address || "Farmacia municipal";
    listen(button, "click", () => {
      if (select.disabled) return;
      const changed = select.value !== option.value;
      select.value = option.value;
      update();
      close(true);
      if (changed) select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    options.append(button);
  }
  update();
  listen(select, "change", update);
  const open = () => {
    if (trigger.disabled) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    (options.querySelector(".is-selected") || options.querySelector("button"))?.focus();
  };
  listen(trigger, "click", () => panel.hidden ? open() : close());
  listen(root, "keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (panel.hidden) return open();
      const buttons = [...options.querySelectorAll("button")];
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  listen(document, "pointerdown", (event) => { if (!root.contains(event.target)) close(); });
  listen(root, "focusout", (event) => { if (!root.contains(event.relatedTarget)) close(); });
}
