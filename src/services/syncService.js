/**
 * Motor de Sincronización en Tiempo Real y Soporte Offline (Outbox Queue & Idempotency)
 * Gobierno Autónomo Municipal de San Carlos
 */
import { supabaseQuery, checkSupabaseConnection } from "../config/supabase.js";
import { showToast } from "./toastService.js";

const QUEUE_KEY = "farmacias_offline_queue";
const BROADCAST_CHANNEL = "farmacias_san_carlos_sync_bus";
const LAST_SYNC_KEY = "farmacias_last_sync_timestamp";

let isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
let isSyncing = false;
let syncInterval = null;
let broadcast = null;

// Inicializar BroadcastChannel para sincronización instantánea entre pestañas
try {
  if (typeof BroadcastChannel !== "undefined") {
    broadcast = new BroadcastChannel(BROADCAST_CHANNEL);
    broadcast.onmessage = (event) => {
      if (event.data?.type === "REMOTE_CHANGE") {
        notifyDataChanged(event.data.entity, false);
      }
    };
  }
} catch (_) {}

/**
 * Obtener la cola de operaciones pendientes fuera de línea
 */
export function getPendingQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (_) {
    return [];
  }
}

/**
 * Guardar la cola de operaciones
 */
function savePendingQueue(queue) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    updateSyncUI();
  } catch (_) {}
}

/**
 * Encolar una operación fuera de línea con clave única de idempotencia
 */
export function enqueueOfflineAction(actionType, endpoint, method, body, customId = null) {
  const queue = getPendingQueue();
  const id = customId || body.id || `TX-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  // Evitar duplicados exactos en la cola
  const exists = queue.some((item) => item.id === id);
  if (exists) return;

  const task = {
    id,
    action: actionType,
    endpoint,
    method,
    body,
    timestamp: new Date().toISOString(),
    retries: 0
  };

  queue.push(task);
  savePendingQueue(queue);

  // Notificar al usuario que la acción se guardó localmente
  showToast(
    "Guardado localmente",
    "Sin conexión a internet. La operación se enviará a Supabase automáticamente al restablecerse la red.",
    "warning"
  );

  // Intentar sincronizar si volvemos a tener red
  if (isOnline) {
    flushPendingQueue();
  }
}

/**
 * Despachar notificación de cambio de datos para que las vistas se actualicen solas
 */
export function notifyDataChanged(entity = "all", broadcastToOthers = true) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("pharmacy-data-change", { detail: { entity } }));
  }
  if (broadcastToOthers && broadcast) {
    try {
      broadcast.postMessage({ type: "REMOTE_CHANGE", entity });
    } catch (_) {}
  }
}

/**
 * Vaciar la cola de operaciones pendientes hacia Supabase de forma secuencial e idempotente
 */
export async function flushPendingQueue() {
  if (isSyncing) return;
  const queue = getPendingQueue();
  if (queue.length === 0) {
    updateSyncUI();
    return;
  }

  isSyncing = true;
  updateSyncUI();

  const remaining = [];
  let syncedCount = 0;

  for (const task of queue) {
    try {
      // 1. Verificación de Idempotencia: Verificar si el registro ya existe en Supabase antes de duplicarlo
      if (task.method === "POST" && task.body?.id) {
        try {
          const tableName = task.endpoint.split("?")[0];
          const checkRes = await supabaseQuery(`${tableName}?id=eq.${encodeURIComponent(task.body.id)}&select=id`);
          if (checkRes && checkRes.length > 0) {
            // Ya existe en la base de datos central, omitir para no duplicar
            syncedCount++;
            continue;
          }
        } catch (_) {}
      }

      // 2. Ejecutar la petición en Supabase
      await supabaseQuery(task.endpoint, {
        method: task.method,
        body: task.body,
        prefer: "resolution=merge-duplicates"
      });

      syncedCount++;
    } catch (err) {
      console.warn(`Fallo al sincronizar tarea ${task.id}:`, err);
      task.retries = (task.retries || 0) + 1;
      // Si falló por red, conservarla para el próximo reintento
      remaining.push(task);
    }
  }

  savePendingQueue(remaining);
  isSyncing = false;
  updateSyncUI();

  if (syncedCount > 0) {
    showToast(
      "Nube Sincronizada",
      `Se subieron ${syncedCount} operación(es) pendiente(s) a Supabase con éxito.`,
      "success"
    );
    notifyDataChanged("all", true);
  }
}

/**
 * Escucha periódica de cambios en la nube realizados por otros usuarios o sucursales
 */
let lastKnownMovementCount = null;
let lastKnownInventoryCount = null;

export async function checkRemoteChanges() {
  if (!isOnline) return;

  try {
    // 1. Consultar conteo de movimientos recientes en Supabase
    const movementsData = await supabaseQuery("movements?select=id&order=timestamp.desc&limit=1");
    const currentMovCount = movementsData?.length > 0 ? movementsData[0].id : null;

    // 2. Consultar último cambio en inventario
    const inventoryData = await supabaseQuery("inventory?select=id,quantity&limit=1");
    const currentInvSample = inventoryData?.length > 0 ? `${inventoryData[0].id}-${inventoryData[0].quantity}` : null;

    if (lastKnownMovementCount !== null && currentMovCount !== lastKnownMovementCount) {
      // Hubo nuevo movimiento registrado en la nube por otro usuario
      notifyDataChanged("movements", false);
    }

    if (lastKnownInventoryCount !== null && currentInvSample !== lastKnownInventoryCount) {
      // Hubo cambio de inventario registrado en la nube por otro usuario
      notifyDataChanged("inventory", false);
    }

    lastKnownMovementCount = currentMovCount;
    lastKnownInventoryCount = currentInvSample;
  } catch (_) {
    // Fallo temporal de red
  }
}

/**
 * Actualizar indicadores visuales de estado de conexión y sincronización
 */
export function updateSyncUI() {
  const syncStatus = document.getElementById("syncStatus");
  const systemDot = document.querySelector(".system-dot");
  const pendingCount = getPendingQueue().length;

  if (!syncStatus) return;

  if (!isOnline) {
    syncStatus.textContent = pendingCount > 0
      ? `Fuera de línea · ${pendingCount} cambio(s) guardados localmente`
      : "Sin conexión a internet · Modo local";
    if (systemDot) {
      systemDot.style.background = "#f59e0b"; // Naranja advertencia
      systemDot.style.boxShadow = "0 0 10px rgba(245, 158, 11, 0.4)";
    }
    return;
  }

  if (isSyncing) {
    syncStatus.textContent = `Sincronizando ${pendingCount} cambio(s) con Supabase…`;
    if (systemDot) {
      systemDot.style.background = "#0284c7"; // Azul proceso
      systemDot.style.boxShadow = "0 0 10px rgba(2, 132, 199, 0.5)";
    }
    return;
  }

  if (pendingCount > 0) {
    syncStatus.textContent = `Pendientes por subir: ${pendingCount} registros`;
    if (systemDot) {
      systemDot.style.background = "#f59e0b";
      systemDot.style.boxShadow = "0 0 10px rgba(245, 158, 11, 0.4)";
    }
    return;
  }

  syncStatus.textContent = "Servidor Central Activo · Sincronizado en tiempo real";
  if (systemDot) {
    systemDot.style.background = "#10b981"; // Verde esmeralda óptimo
    systemDot.style.boxShadow = "0 0 10px rgba(16, 185, 129, 0.4)";
  }
}

/**
 * Inicializador principal del motor de sincronización
 */
export function initSyncEngine() {
  // 1. Escuchar eventos de conectividad del navegador
  if (typeof window !== "undefined") {
    window.addEventListener("online", async () => {
      isOnline = true;
      updateSyncUI();
      showToast("Conexión restablecida", "Sincronizando registros con Supabase...", "info");
      await flushPendingQueue();
      await checkRemoteChanges();
    });

    window.addEventListener("offline", () => {
      isOnline = false;
      updateSyncUI();
      showToast("Sin conexión", "El sistema continuará funcionando en modo fuera de línea.", "warning");
    });

    // Al regresar a la pestaña, verificar si hubo cambios en la nube
    window.addEventListener("focus", async () => {
      if (isOnline) {
        await flushPendingQueue();
        await checkRemoteChanges();
      }
    });
  }

  // 2. Verificar estado inicial
  checkSupabaseConnection().then((res) => {
    isOnline = res.ok;
    updateSyncUI();
    if (res.ok) {
      flushPendingQueue();
    }
  });

  // 3. Polling periódico de cambios remotos cada 7 segundos
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = setInterval(async () => {
    if (isOnline) {
      if (getPendingQueue().length > 0) {
        await flushPendingQueue();
      } else {
        await checkRemoteChanges();
      }
    }
  }, 7000);
}
