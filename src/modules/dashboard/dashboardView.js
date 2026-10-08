/**
 * Módulo de Dashboard y Resumen General Consolidado
 */
import { getInventory, getExpiryStatus } from "../../services/inventoryService.js";
import { getMovements } from "../../services/salesService.js";
import { getBranches, getBranchName } from "../../services/branchesService.js";
import { getCurrentUser, isAdmin, isSeller } from "../../services/authService.js";

export async function renderDashboardModule(selectedBranchId = "all") {
  const metricGrid = document.getElementById("metricGrid");
  const salesChart = document.getElementById("salesChart");
  const expiryList = document.getElementById("expiryList");
  const branchCards = document.getElementById("branchCards");
  const greetingName = document.getElementById("greetingName");
  const dashboardSubtitle = document.getElementById("dashboardSubtitle");

  const user = getCurrentUser();
  const branches = await getBranches();
  const inventory = await getInventory(selectedBranchId, true);
  const movements = await getMovements(selectedBranchId);

  if (greetingName && user) {
    greetingName.textContent = user.name.split(" ")[0];
  }

  if (dashboardSubtitle) {
    dashboardSubtitle.textContent = selectedBranchId === "all"
      ? "Este es el movimiento consolidado de las seis farmacias municipales de San Carlos."
      : `Panel de control y operaciones de la sucursal ${getBranchName(selectedBranchId, branches)}.`;
  }

  // 1. Calcular Métricas
  const totalStockUnits = inventory.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const normalSales = movements.filter((m) => m.type === "normal");
  const susDispensations = movements.filter((m) => m.type === "sus");

  const totalRevenue = normalSales.reduce((sum, m) => sum + (Number(m.total) || 0), 0);
  const totalProfit = normalSales.reduce((sum, m) => sum + (Number(m.profit) || 0), 0);
  const totalSusItems = susDispensations.reduce((sum, m) => sum + (Number(m.items) || 0), 0);

  const criticalBatches = inventory.filter((item) => {
    const exp = getExpiryStatus(item.expiry);
    return exp.status === "red" || exp.status === "yellow";
  });

  const admin = isAdmin();

  if (metricGrid) {
    metricGrid.innerHTML = `
      <div class="metric-card">
        <span class="metric-label">Ingresos por Ventas</span>
        <strong class="metric-value">Bs ${totalRevenue.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <span class="metric-foot">${normalSales.length} transacciones registradas</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Entregas SUS Gratuitas</span>
        <strong class="metric-value">${totalSusItems} uds.</strong>
        <span class="metric-foot">${susDispensations.length} pacientes atendidos</span>
      </div>
      <div class="metric-card ${admin ? "" : "hidden"}">
        <span class="metric-label">Ganancia Bruta Estimada</span>
        <strong class="metric-value profit-color">Bs ${totalProfit.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
        <span class="metric-foot">Márgenes administrados</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Lotes en Alerta (≤ 6 meses)</span>
        <strong class="metric-value ${criticalBatches.length > 0 ? "text-danger" : "text-success"}">${criticalBatches.length}</strong>
        <span class="metric-foot">Control FEFO prioritario</span>
      </div>
      <div class="metric-card">
        <span class="metric-label">Existencias Totales</span>
        <strong class="metric-value">${totalStockUnits.toLocaleString("es-BO")} uds.</strong>
        <span class="metric-foot">${inventory.length} lotes en inventario</span>
      </div>
    `;
  }

  // 2. Gráfico Visual de Movimientos
  if (salesChart) {
    const totalMovements = Math.max(1, movements.length);
    const normalPct = Math.round((normalSales.length / totalMovements) * 100);
    const susPct = 100 - normalPct;

    salesChart.innerHTML = `
      <div class="chart-bars-wrap">
        <div class="chart-bar-group">
          <div class="chart-bar-label">Ventas Normales (${normalSales.length})</div>
          <div class="chart-bar-track">
            <div class="chart-bar-fill fill-sales" style="width: ${Math.max(5, normalPct)}%;"></div>
          </div>
          <span class="chart-bar-val">Bs ${totalRevenue.toFixed(2)}</span>
        </div>
        <div class="chart-bar-group">
          <div class="chart-bar-label">Entregas SUS (${susDispensations.length})</div>
          <div class="chart-bar-track">
            <div class="chart-bar-fill fill-sus" style="width: ${Math.max(5, susPct)}%;"></div>
          </div>
          <span class="chart-bar-val">${totalSusItems} uds. entregadas</span>
        </div>
      </div>
    `;
  }

  // 3. Lista de Vencimientos Próximos
  if (expiryList) {
    const sortedExpiring = [...inventory].sort((a, b) => new Date(a.expiry) - new Date(b.expiry)).slice(0, 5);
    if (sortedExpiring.length === 0) {
      expiryList.innerHTML = `<p class="text-muted p-3">No hay lotes registrados.</p>`;
    } else {
      expiryList.innerHTML = sortedExpiring
        .map((item) => {
          const exp = getExpiryStatus(item.expiry);
          const badgeClass = exp.status === "red" ? "badge-danger" : exp.status === "yellow" ? "badge-warning" : "badge-success";
          return `
            <div class="expiry-item">
              <div>
                <strong>${item.name}</strong>
                <small>Lote: ${item.lot} · ${getBranchName(item.branch_id, branches)} · ${item.quantity} uds.</small>
              </div>
              <span class="status-badge ${badgeClass}">${exp.label}</span>
            </div>
          `;
        })
        .join("");
    }
  }

  // 4. Tarjetas por Sucursal
  if (branchCards) {
    branchCards.innerHTML = branches
      .map((b) => {
        const branchStock = inventory.filter((i) => i.branch_id === b.id);
        const stockUnits = branchStock.reduce((s, i) => s + i.quantity, 0);
        const branchMovs = movements.filter((m) => m.branch_id === b.id);
        const branchSales = branchMovs.filter((m) => m.type === "normal").reduce((s, m) => s + Number(m.total), 0);

        return `
          <div class="branch-card ${selectedBranchId === b.id ? "active-branch-card" : ""}">
            <div class="branch-card-header">
              <span class="branch-code-badge">${b.code}</span>
              <div>
                <strong>${b.name}</strong>
                <small>${b.phone || "Red Municipal"}</small>
              </div>
            </div>
            <div class="branch-card-stats">
              <div><span>Stock</span><b>${stockUnits} uds.</b></div>
              <div><span>Ventas</span><b>Bs ${branchSales.toFixed(2)}</b></div>
            </div>
          </div>
        `;
      })
      .join("");
  }
}
