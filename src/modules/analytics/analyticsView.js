/**
 * Módulo de Auditoría, Control y Reportes Municipales
 * Gobierno Autónomo Municipal de San Carlos
 */
import { getMovements } from "../../services/salesService.js";
import { getEntries } from "../../services/entriesService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { exportToCSV } from "../../services/auditService.js";
import { showToast } from "../../services/toastService.js";
import { formatBusinessDateTime, getBusinessDate } from "../../utils/dateTime.js";

let currentAuditTab = "sales";

export async function renderAnalyticsModule(selectedBranchId = "all") {
  const tableHead = document.getElementById("reportTableHead");
  const tableBody = document.getElementById("reportTable");
  const reportRowsLabel = document.getElementById("reportRowsLabel");
  const reportMetrics = document.getElementById("reportMetrics");
  const branchBarChart = document.getElementById("branchBarChart");
  const donutChart = document.getElementById("donutChart");
  const salesAuditCount = document.getElementById("salesAuditCount");
  const entryAuditCount = document.getElementById("entryAuditCount");
  const reportBranch = document.getElementById("reportBranch");
  const reportMonth = document.getElementById("reportMonth");
  const reportType = document.getElementById("reportType");
  const reportSearch = document.getElementById("reportSearch");
  const clearFiltersBtn = document.getElementById("clearReportFilters");

  const [branches, movements, entries] = await Promise.all([
    getBranches(false, true),
    getMovements(),
    getEntries()
  ]);

  // Reconstruir siempre: las nuevas sucursales aparecen sin tener que recargar la página.
  if (reportBranch) {
    const previousBranch = reportBranch.value || selectedBranchId || "all";
    reportBranch.innerHTML = `
      <option value="all">Todas las sucursales (Consolidado)</option>
      ${branches.map((b) => `<option value="${b.id}">${b.name} (${b.code})${b.active === false ? " · Inactiva" : ""}</option>`).join("")}
    `;
    reportBranch.value = branches.some((branch) => branch.id === previousBranch) ? previousBranch : "all";
  }

  if (salesAuditCount) salesAuditCount.textContent = `${movements.length}`;
  if (entryAuditCount) entryAuditCount.textContent = `${entries.length}`;

  function applyFiltersAndDraw() {
    const branchVal = reportBranch?.value || "all";
    const monthVal = reportMonth?.value || "";
    const typeVal = reportType?.value || "all";
    const searchVal = (reportSearch?.value || "").toLowerCase().trim();

    // 1. Filtrar Movimientos (Ventas y SUS)
    const filteredMovements = movements.filter((m) => {
      if (branchVal !== "all" && m.branch_id !== branchVal) return false;
      if (monthVal && !m.date.startsWith(monthVal)) return false;
      if (typeVal !== "all" && m.type !== typeVal) return false;
      if (searchVal) {
        const branchName = getBranchName(m.branch_id, branches).toLowerCase();
        const match =
          m.id.toLowerCase().includes(searchVal) ||
          m.responsible.toLowerCase().includes(searchVal) ||
          (m.patient_name || "").toLowerCase().includes(searchVal) ||
          branchName.includes(searchVal);
        if (!match) return false;
      }
      return true;
    });

    // 2. Filtrar Ingresos de Lotes
    const filteredEntries = entries.filter((e) => {
      if (branchVal !== "all" && e.branch_id !== branchVal) return false;
      if (monthVal && !e.date.startsWith(monthVal)) return false;
      if (searchVal) {
        const branchName = getBranchName(e.branch_id, branches).toLowerCase();
        const match =
          e.id.toLowerCase().includes(searchVal) ||
          e.name.toLowerCase().includes(searchVal) ||
          e.lot.toLowerCase().includes(searchVal) ||
          e.responsible.toLowerCase().includes(searchVal) ||
          branchName.includes(searchVal);
        if (!match) return false;
      }
      return true;
    });

    // 3. Renderizar Tarjetas de Métricas / KPIs Limpias
    if (reportMetrics) {
      const normalSales = filteredMovements.filter((m) => m.type === "normal");
      const susDeliveries = filteredMovements.filter((m) => m.type === "sus");

      const totalRevenue = normalSales.reduce((s, m) => s + Number(m.total || 0), 0);
      const totalProfit = normalSales.reduce((s, m) => s + Number(m.profit || 0), 0);
      const totalSusUnits = susDeliveries.reduce((s, m) => s + Number(m.items || 0), 0);

      reportMetrics.innerHTML = `
        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">VENTAS TOTALES</span>
            <span class="metric-icon-pill green"><svg><use href="#i-chart"/></svg></span>
          </div>
          <strong class="metric-value">Bs ${totalRevenue.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <span class="metric-foot">${normalSales.length} ventas comerciales cobradas</span>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">GANANCIA ESTIMADA</span>
            <span class="metric-icon-pill gold"><svg><use href="#i-grid"/></svg></span>
          </div>
          <strong class="metric-value profit-color">Bs ${totalProfit.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <span class="metric-foot">Margen municipal consolidado</span>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">DISPENSACIÓN SUS</span>
            <span class="metric-icon-pill blue"><svg><use href="#i-cart"/></svg></span>
          </div>
          <strong class="metric-value" style="color: #0284c7;">${totalSusUnits} uds.</strong>
          <span class="metric-foot">${susDeliveries.length} recetas / pacientes gratuitos</span>
        </div>

        <div class="metric-card">
          <div class="metric-header">
            <span class="metric-label">REGISTROS AUDITADOS</span>
            <span class="metric-icon-pill purple"><svg><use href="#i-shield"/></svg></span>
          </div>
          <strong class="metric-value">${filteredMovements.length}</strong>
          <span class="metric-foot">Trazabilidad con firma de responsable</span>
        </div>
      `;
    }

    // 4. Renderizar Gráfico de Comparativo de Sucursales
    if (branchBarChart) {
      const branchTotals = branches.map((b) => {
        const bSales = filteredMovements.filter((m) => m.branch_id === b.id && m.type === "normal");
        const bTotal = bSales.reduce((sum, m) => sum + Number(m.total || 0), 0);
        const bSusCount = filteredMovements.filter((m) => m.branch_id === b.id && m.type === "sus").length;
        return { name: b.name, total: bTotal, salesCount: bSales.length, susCount: bSusCount };
      });

      const maxVal = Math.max(1, ...branchTotals.map((b) => b.total));

      branchBarChart.innerHTML = branchTotals
        .map((b) => {
          const pct = Math.max(4, Math.round((b.total / maxVal) * 100));
          return `
            <div class="branch-bar-row">
              <div class="branch-bar-info">
                <span class="branch-bar-name">${b.name}</span>
                <span class="branch-bar-meta">${b.salesCount} ventas · ${b.susCount} SUS</span>
              </div>
              <div class="branch-bar-track">
                <div class="branch-bar-fill" style="width: ${pct}%;"></div>
              </div>
              <strong class="branch-bar-val">Bs ${b.total.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
          `;
        })
        .join("");
    }

    // 5. Renderizar Gráfico Donut de Distribución (Venta vs SUS)
    if (donutChart) {
      const normalItems = filteredMovements.filter((m) => m.type === "normal").reduce((sum, m) => sum + Number(m.items || 1), 0);
      const susItems = filteredMovements.filter((m) => m.type === "sus").reduce((sum, m) => sum + Number(m.items || 1), 0);
      const totalItems = Math.max(1, normalItems + susItems);
      const normalPct = Math.round((normalItems / totalItems) * 100);
      const susPct = 100 - normalPct;

      donutChart.innerHTML = `
        <div class="donut-graphic" style="background: conic-gradient(#059669 0% ${normalPct}%, #0284c7 ${normalPct}% 100%);">
          <div class="donut-hole">
            <strong>${totalItems}</strong>
            <small>Ítems total</small>
          </div>
        </div>
        <div class="donut-legend-box">
          <div class="donut-legend-item">
            <span class="legend-dot sales"></span>
            <div class="legend-texts">
              <strong>Ventas comerciales</strong>
              <small>${normalItems} unidades (${normalPct}%)</small>
            </div>
          </div>
          <div class="donut-legend-item">
            <span class="legend-dot sus"></span>
            <div class="legend-texts">
              <strong>Dispensación SUS gratuita</strong>
              <small>${susItems} unidades (${susPct}%)</small>
            </div>
          </div>
        </div>
      `;
    }

    // 6. Actualizar Contadores de Tabs
    if (salesAuditCount) salesAuditCount.textContent = `${filteredMovements.length}`;
    if (entryAuditCount) entryAuditCount.textContent = `${filteredEntries.length}`;

    // 7. Renderizar Tabla según Tab Activa
    if (currentAuditTab === "sales") {
      if (reportRowsLabel) reportRowsLabel.textContent = `${filteredMovements.length} movimientos de venta y SUS encontrados`;

      if (tableHead) {
        tableHead.innerHTML = `
          <tr>
            <th>ID</th>
            <th>Fecha y Hora</th>
            <th>Sucursal</th>
            <th>Tipo</th>
            <th>Beneficiario / Paciente</th>
            <th>Ítems</th>
            <th>Total (Bs)</th>
            <th>Ganancia</th>
            <th>Responsable</th>
            <th>Acción</th>
          </tr>
        `;
      }

      if (tableBody) {
        if (filteredMovements.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-6" style="padding: 32px 0; color: #64748b;">No se encontraron ventas o dispensaciones con los filtros seleccionados.</td></tr>`;
        } else {
          tableBody.innerHTML = filteredMovements
            .map((m) => {
              const isSus = m.type === "sus";
              return `
                <tr>
                  <td data-label="ID"><code>${m.id}</code></td>
                  <td data-label="Fecha y hora"><small>${formatBusinessDateTime(m.timestamp || m.date)}</small></td>
                  <td data-label="Sucursal"><span class="branch-tag">${getBranchName(m.branch_id, branches)}</span></td>
                  <td data-label="Tipo"><span class="status-badge ${isSus ? "badge-sus" : "badge-sale"}">${isSus ? "SUS" : "Venta"}</span></td>
                  <td data-label="Beneficiario">${m.patient_name ? `<strong>${m.patient_name}</strong> <small class="text-muted">(${m.sus_code || "SUS"})</small>` : "Mostrador General"}</td>
                  <td data-label="Ítems"><strong>${m.items} uds.</strong></td>
                  <td data-label="Total"><strong>Bs ${Number(m.total).toFixed(2)}</strong></td>
                  <td data-label="Ganancia" class="profit-color">Bs ${Number(m.profit).toFixed(2)}</td>
                  <td data-label="Responsable"><small>${m.responsible}</small></td>
                  <td data-label="Acción">
                    <button class="btn-detail-row" data-detail-id="${m.id}" data-detail-type="sale">
                      Ver detalle
                    </button>
                  </td>
                </tr>
              `;
            })
            .join("");
        }
      }
    } else {
      // TAB ENTRIES (INGRESOS DE LOTES)
      if (reportRowsLabel) reportRowsLabel.textContent = `${filteredEntries.length} ingresos de lotes registrados`;

      if (tableHead) {
        tableHead.innerHTML = `
          <tr>
            <th>ID Ingreso</th>
            <th>Fecha</th>
            <th>Sucursal</th>
            <th>Medicamento</th>
            <th>Lote</th>
            <th>Cantidad</th>
            <th>Costo Unit.</th>
            <th>Vencimiento</th>
            <th>Responsable</th>
            <th>Acción</th>
          </tr>
        `;
      }

      if (tableBody) {
        if (filteredEntries.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="10" class="text-center py-6" style="padding: 32px 0; color: #64748b;">No hay lotes ingresados en este periodo o filtro.</td></tr>`;
        } else {
          tableBody.innerHTML = filteredEntries
            .map((e) => `
              <tr>
                <td data-label="ID ingreso"><code>${e.id}</code></td>
                <td data-label="Fecha"><small>${e.date}</small></td>
                <td data-label="Sucursal"><span class="branch-tag">${getBranchName(e.branch_id, branches)}</span></td>
                <td data-label="Medicamento"><strong>${e.name}</strong></td>
                <td data-label="Lote"><code class="lot-badge">${e.lot}</code></td>
                <td data-label="Cantidad"><strong>${e.quantity} uds.</strong></td>
                <td data-label="Costo unitario">Bs ${Number(e.unit_cost || 0).toFixed(2)}</td>
                <td data-label="Vencimiento"><small>${e.expiry}</small></td>
                <td data-label="Responsable"><small>${e.responsible}</small></td>
                <td data-label="Acción">
                  <button class="btn-detail-row" data-detail-id="${e.id}" data-detail-type="entry">
                    Ver detalle
                  </button>
                </td>
              </tr>
            `)
            .join("");
        }
      }
    }

    // Vincular clics de "Ver detalle"
    tableBody?.querySelectorAll(".btn-detail-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-detail-id");
        const type = btn.getAttribute("data-detail-type");
        openMovementDialog(id, type, movements, entries, branches);
      });
    });
  }

  // Event Listeners para Filtros
  reportBranch?.addEventListener("change", applyFiltersAndDraw);
  reportMonth?.addEventListener("change", applyFiltersAndDraw);
  reportType?.addEventListener("change", applyFiltersAndDraw);
  reportSearch?.addEventListener("input", applyFiltersAndDraw);

  // Botón Limpiar Filtros
  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener("click", () => {
      if (reportMonth) reportMonth.value = "";
      if (reportBranch) reportBranch.value = "all";
      if (reportType) reportType.value = "all";
      if (reportSearch) reportSearch.value = "";
      applyFiltersAndDraw();
      showToast("Filtros restablecidos", "Mostrando todos los registros del sistema.");
    });
  }

  // Tabs de Auditoría
  document.querySelectorAll(".audit-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".audit-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentAuditTab = btn.getAttribute("data-audit-view");

      const auditTitle = document.getElementById("auditTitle");
      if (auditTitle) {
        auditTitle.textContent = currentAuditTab === "sales" ? "Ventas y entregas SUS" : "Ingresos y abastecimiento de lotes";
      }

      applyFiltersAndDraw();
    });
  });

  // Exportar a Excel/CSV con codificación limpia UTF-8
  const exportBtn = document.getElementById("exportReport");
  if (exportBtn) {
    exportBtn.onclick = () => {
      const timestamp = getBusinessDate();
      if (currentAuditTab === "sales") {
        const rows = movements.map((m) => ({
          ID: m.id,
          Fecha: m.date,
          Hora: m.timestamp,
          Sucursal: getBranchName(m.branch_id, branches),
          Tipo: m.type === "sus" ? "SUS Gratuito" : "Venta Comercial",
          Paciente_SUS: m.patient_name || "N/A",
          Codigo_SUS: m.sus_code || "N/A",
          Unidades: m.items,
          Total_Bs: m.total,
          Ganancia_Bs: m.profit,
          Responsable: m.responsible,
          Observaciones: m.notes || ""
        }));
        exportToCSV(`Auditoria_Ventas_SanCarlos_${timestamp}`, rows);
      } else {
        const rows = entries.map((e) => ({
          ID: e.id,
          Fecha: e.date,
          Sucursal: getBranchName(e.branch_id, branches),
          Medicamento: e.name,
          Lote: e.lot,
          Cantidad: e.quantity,
          Costo_Unitario_Bs: e.unit_cost,
          Vencimiento: e.expiry,
          Proveedor: e.supplier || "Almacén Central",
          Responsable: e.responsible
        }));
        exportToCSV(`Auditoria_Ingresos_SanCarlos_${timestamp}`, rows);
      }
    };
  }

  applyFiltersAndDraw();
}

/**
 * Modal Detalle de Movimiento / Trazabilidad
 */
function openMovementDialog(id, type, movements, entries, branches) {
  const dialog = document.getElementById("movementDialog");
  const title = document.getElementById("movementTitle");
  const subtitle = document.getElementById("movementSubtitle");
  const detail = document.getElementById("movementDetail");

  if (!dialog || !detail) return;

  if (type === "sale") {
    const m = movements.find((x) => x.id === id);
    if (!m) return;
    if (title) title.textContent = `Operación ${m.id} (${m.type === "sus" ? "Dispensación SUS" : "Venta Comercial"})`;
    if (subtitle) subtitle.textContent = `Registrado en sucursal ${getBranchName(m.branch_id, branches)} por ${m.responsible}`;

    detail.innerHTML = `
      <div class="movement-detail-grid">
        <div class="movement-detail-card">
          <span>Identificador de Registro</span>
          <strong><code>${m.id}</code></strong>
        </div>
        <div class="movement-detail-card">
          <span>Fecha y Hora</span>
          <strong>${new Date(m.timestamp || m.date).toLocaleString("es-BO")}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Sucursal Operativa</span>
          <strong>${getBranchName(m.branch_id, branches)}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Funcionario Responsable</span>
          <strong>${m.responsible}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Modalidad</span>
          <strong style="color: ${m.type === "sus" ? "#0284c7" : "#059669"};">${m.type === "sus" ? "Gratuito (SUS Municipal)" : "Venta Comercial"}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Beneficiario / Paciente</span>
          <strong>${m.patient_name ? `${m.patient_name} (${m.sus_code || "SUS"})` : "Mostrador General"}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Importe Cobrado</span>
          <strong style="color: #059669; font-size: 1.15rem;">Bs ${Number(m.total).toFixed(2)}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Ganancia / Margen</span>
          <strong class="profit-color">Bs ${Number(m.profit).toFixed(2)}</strong>
        </div>
      </div>

      <div style="margin-top: 10px;">
        <span style="font-size: 0.78rem; font-weight: 700; color: #334155; text-transform: uppercase;">Desglose de Medicamentos y Lotes</span>
        <table class="movement-lines-table">
          <thead>
            <tr>
              <th>Medicamento</th>
              <th>Lote</th>
              <th>Cantidad</th>
              <th>Precio Unit.</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            ${(m.lines && m.lines.length > 0)
              ? m.lines.map((l) => `
                <tr>
                  <td data-label="Medicamento"><strong>${l.name || "Medicamento"}</strong></td>
                  <td data-label="Lote"><code class="lot-badge">${l.lot || "L-SC"}</code></td>
                  <td data-label="Cantidad">${l.quantity || 1} uds.</td>
                  <td data-label="Precio unitario">Bs ${Number(l.unitPrice || 0).toFixed(2)}</td>
                  <td data-label="Subtotal"><strong>Bs ${Number(l.subtotal || 0).toFixed(2)}</strong></td>
                </tr>
              `).join("")
              : `<tr><td colspan="5" class="text-center" style="padding: 12px 0; color: #64748b;">Dispensación consolidada de ${m.items} unidades.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    `;
  } else {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    if (title) title.textContent = `Ingreso de Lote ${e.id}`;
    if (subtitle) subtitle.textContent = `Abastecimiento registrado en ${getBranchName(e.branch_id, branches)} por ${e.responsible}`;

    detail.innerHTML = `
      <div class="movement-detail-grid">
        <div class="movement-detail-card">
          <span>Código de Ingreso</span>
          <strong><code>${e.id}</code></strong>
        </div>
        <div class="movement-detail-card">
          <span>Fecha de Recepción</span>
          <strong>${e.date}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Sucursal Destino</span>
          <strong>${getBranchName(e.branch_id, branches)}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Técnico Responsable</span>
          <strong>${e.responsible}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Medicamento</span>
          <strong>${e.name}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Lote Registrado</span>
          <strong><code class="lot-badge">${e.lot}</code></strong>
        </div>
        <div class="movement-detail-card">
          <span>Cantidad Ingresada</span>
          <strong style="color: #059669; font-size: 1.15rem;">${e.quantity} unidades</strong>
        </div>
        <div class="movement-detail-card">
          <span>Costo Unitario</span>
          <strong>Bs ${Number(e.unit_cost || 0).toFixed(2)}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Fecha de Vencimiento</span>
          <strong>${e.expiry}</strong>
        </div>
        <div class="movement-detail-card">
          <span>Proveedor / Origen</span>
          <strong>${e.supplier || "Almacén Central Municipal"}</strong>
        </div>
      </div>
    `;
  }

  dialog.querySelectorAll("[data-close-movement]").forEach((btn) => {
    btn.onclick = () => dialog.close();
  });

  dialog.showModal();
}
