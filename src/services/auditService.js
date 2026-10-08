/**
 * Servicio de Auditoría y Reportes Exportables
 */
import { supabaseQuery } from "../config/supabase.js";
import { showToast } from "./toastService.js";
import { getBranchName } from "./branchesService.js";

export async function getAuditLogs(limit = 100) {
  try {
    const data = await supabaseQuery(`audit_logs?select=*&order=timestamp.desc&limit=${limit}`);
    return data || [];
  } catch (err) {
    console.error("Error al obtener logs de auditoría:", err);
    return [];
  }
}

export function exportToCSV(filename, rows) {
  if (!rows || rows.length === 0) {
    showToast("Sin datos", "No hay registros para exportar en este periodo.", "warning");
    return;
  }

  const headers = Object.keys(rows[0]);
  const csvRows = [];
  
  // Encabezados
  csvRows.push(headers.map((h) => `"${h}"`).join(";"));

  // Filas
  for (const row of rows) {
    const values = headers.map((header) => {
      let val = row[header];
      if (val === null || val === undefined) val = "";
      if (typeof val === "object") val = JSON.stringify(val);
      const escaped = String(val).replace(/"/g, '""');
      return `"${escaped}"`;
    });
    csvRows.push(values.join(";"));
  }

  const csvContent = "\uFEFF" + csvRows.join("\r\n"); // UTF-8 BOM para Excel
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast("Exportación completada", `Se descargó el archivo ${filename}.csv`);
}
