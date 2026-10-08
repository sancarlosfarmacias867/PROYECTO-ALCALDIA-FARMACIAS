/**
 * Módulo de Auditoría, Reportes y Exportación
 */
import { getMovements } from "../../services/salesService.js";
import { getEntries } from "../../services/entriesService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { exportToCSV } from "../../services/auditService.js";
import { showToast } from "../../services/toastService.js";

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

  const branches = await getBranches();
  const movements = await getMovements();
  const entries = await getEntries();

  if (reportBranch && reportBranch.options.length === 0) {
    reportBranch.innerHTML = `
      <option value="all">Todas las sucursales</option>
      ${branches.map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}
    `;
    if (selectedBranchId) reportBranch.value = selectedBranchId;
  }

  if (salesAuditCount) salesAuditCount.textContent = `${movements.length}`;
  if (entryAuditCount) entryAuditCount.textContent = `${entries.length}`;

  function applyFiltersAndDraw() {
    const branchVal = reportBranch?.value || "all";
    const monthVal = reportMonth?.value || "";
    const typeVal = reportType?.value || "all";
    const searchVal = (reportSearch?.value || "").toLowerCase();

    if (currentAuditTab === "sales") {
      let filtered = movements.filter((m) => {
        if (branchVal !== "all" && m.branch_id !== branchVal) return false;
        if (monthVal && !m.date.startsWith(monthVal)) return false;
        if (typeVal !== "all" && m.type !== typeVal) return false;
        if (searchVal) {
          const match =
            m.id.toLowerCase().includes(searchVal) ||
            m.responsible.toLowerCase().includes(searchVal) ||
            (m.patient_name || "").toLowerCase().includes(searchVal) ||
            getBranchName(m.branch_id, branches).toLowerCase().includes(searchVal);
          if (!match) return false;
        }
        return true;
      });

      // Render KPIs
      if (reportMetrics) {
        const totalSalesVal = filtered.filter((m) => m.type === "normal").reduce((s, m) => s + Number(m.total), 0);
        const totalProfitVal = filtered.filter((m) => m.type === "normal").reduce((s, m) => s + Number(m.profit), 0);
        const totalSusVal = filtered.filter((m) => m.type === "sus").reduce((s, m) => s + Number(m.items), 0);

        reportMetrics.innerHTML = `
          <div class="metric-card"><span>Total Ventas</span><strong>Bs ${totalSalesVal.toFixed(2)}</strong></div>
          <div class="metric-card"><span>Ganancia Bruta</span><strong class="profit-color">Bs ${totalProfitVal.toFixed(2)}</strong></div>
          <div class="metric-card"><span>Entregas SUS</span><strong>${totalSusVal} unidades</strong></div>
          <div class="metric-card"><span>Registros</span><strong>${filtered.length}</strong></div>
        `;
      }

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
          </tr>
        `;
      }

      if (reportRowsLabel) reportRowsLabel.textContent = `${filtered.length} movimientos encontrados`;

      if (tableBody) {
        if (filtered.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-6">No hay movimientos en este periodo o filtro.</td></tr>`;
        } else {
          tableBody.innerHTML = filtered
            .map((m) => {
              const isSus = m.type === "sus";
              return `
                <tr>
                  <td><code>${m.id}</code></td>
                  <td><small>${new Date(m.timestamp || m.date).toLocaleString("es-BO")}</small></td>
                  <td><span class="branch-tag">${getBranchName(m.branch_id, branches)}</span></td>
                  <td><span class="status-badge ${isSus ? "badge-sus" : "badge-sale"}">${isSus ? "SUS" : "Venta"}</span></td>
                  <td>${m.patient_name ? `<strong>${m.patient_name}</strong> <small class="text-muted">(${m.sus_code || "SUS"})</small>` : "Mostrador"}</td>
                  <td>${m.items} uds.</td>
                  <td><strong>Bs ${Number(m.total).toFixed(2)}</strong></td>
                  <td class="profit-color">Bs ${Number(m.profit).toFixed(2)}</td>
                  <td><small>${m.responsible}</small></td>
                </tr>
              `;
            })
            .join("");
        }
      }
    } else {
      // TAB ENTRIES (INGRESOS DE LOTES)
      let filtered = entries.filter((e) => {
        if (branchVal !== "all" && e.branch_id !== branchVal) return false;
        if (monthVal && !e.date.startsWith(monthVal)) return false;
        if (searchVal) {
          const match =
            e.id.toLowerCase().includes(searchVal) ||
            e.name.toLowerCase().includes(searchVal) ||
            e.lot.toLowerCase().includes(searchVal) ||
            e.responsible.toLowerCase().includes(searchVal);
          if (!match) return false;
        }
        return true;
      });

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
          </tr>
        `;
      }

      if (reportRowsLabel) reportRowsLabel.textContent = `${filtered.length} ingresos registrados`;

      if (tableBody) {
        if (filtered.length === 0) {
          tableBody.innerHTML = `<tr><td colspan="9" class="text-center py-6">No hay registros de ingreso en este periodo.</td></tr>`;
        } else {
          tableBody.innerHTML = filtered
            .map((e) => `
              <tr>
                <td><code>${e.id}</code></td>
                <td><small>${e.date}</small></td>
                <td><span class="branch-tag">${getBranchName(e.branch_id, branches)}</span></td>
                <td><strong>${e.name}</strong></td>
                <td><code class="lot-badge">${e.lot}</code></td>
                <td><strong>${e.quantity} uds.</strong></td>
                <td>Bs ${Number(e.unit_cost || 0).toFixed(2)}</td>
                <td>${e.expiry}</td>
                <td><small>${e.responsible}</small></td>
              </tr>
            `)
            .join("");
        }
      }
    }
  }

  // Event Listeners para Filtros
  reportBranch?.addEventListener("change", applyFiltersAndDraw);
  reportMonth?.addEventListener("change", applyFiltersAndDraw);
  reportType?.addEventListener("change", applyFiltersAndDraw);
  reportSearch?.addEventListener("input", applyFiltersAndDraw);

  // Tabs de Auditoría
  document.querySelectorAll(".audit-tabs button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".audit-tabs button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentAuditTab = btn.getAttribute("data-audit-view");
      
      const auditTitle = document.getElementById("auditTitle");
      if (auditTitle) {
        auditTitle.textContent = currentAuditTab === "sales" ? "Ventas y entregas SUS" : "Ingresos y abastecimiento de lotes";
      }

      applyFiltersAndDraw();
    });
  });

  // Exportar a Excel/CSV
  const exportBtn = document.getElementById("exportReport");
  exportBtn?.addEventListener("click", () => {
    const timestamp = new Date().toISOString().slice(0, 10);
    if (currentAuditTab === "sales") {
      const rows = movements.map((m) => ({
        ID: m.id,
        Fecha: m.date,
        Hora: m.timestamp,
        Sucursal: getBranchName(m.branch_id, branches),
        Tipo: m.type === "sus" ? "SUS Gratuito" : "Venta Normal",
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
        Proveedor: e.supplier || "Central",
        Responsable: e.responsible
      }));
      exportToCSV(`Auditoria_Ingresos_SanCarlos_${timestamp}`, rows);
    }
  });

  applyFiltersAndDraw();
}
