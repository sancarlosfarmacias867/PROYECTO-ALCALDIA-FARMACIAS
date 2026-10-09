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
  const id = customId || body?.id || `TX-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;

  // Para ediciones repetidas sin conexión conservar siempre la versión más nueva.
  const existingIndex = queue.findIndex((item) => item.id === id);
  if (existingIndex !== -1) {
    if (method === "PATCH" || method === "DELETE") {
      queue[existingIndex] = {
        ...queue[existingIndex],
        action: actionType,
        endpoint,
        method,
        body,
        timestamp: new Date().toISOString()
      };
      savePendingQueue(queue);
    }
    return id;
  }

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

  return id;
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
            savePendingQueue(getPendingQueue().filter((item) => item.id !== task.id));
            continue;
          }
        } catch (_) {}
      }

      // 2. Inventario offline: aplicar deltas sobre el valor actual de la nube.
      if (task.action === "DEDUCT_STOCK") {
        const rows = await supabaseQuery(`${task.endpoint}&select=quantity`);
        if (!rows?.length) throw new Error("El lote pendiente ya no existe en el inventario central.");
        const decrement = Number(task.body?.quantity_decrement || 0);
        const quantity = Math.max(0, Number(rows[0].quantity || 0) - decrement);
        await supabaseQuery(task.endpoint, { method: "PATCH", body: { quantity } });
      } else if (task.action === "RESTOCK_ADD_QTY" && task.body?.quantity_increment) {
        const rows = await supabaseQuery(`${task.endpoint}&select=quantity`);
        if (!rows?.length) throw new Error("El lote pendiente ya no existe en el inventario central.");
        const { quantity_increment, ...fields } = task.body;
        fields.quantity = Number(rows[0].quantity || 0) + Number(quantity_increment || 0);
        await supabaseQuery(task.endpoint, { method: "PATCH", body: fields });
      } else {
        await supabaseQuery(task.endpoint, {
          method: task.method,
          body: task.body,
          prefer: "resolution=merge-duplicates"
        });
      }

      syncedCount++;
      // Confirmar cada tarea individualmente para evitar repetirla si la pestaña se cierra.
      savePendingQueue(getPendingQueue().filter((item) => item.id !== task.id));
    } catch (err) {
      console.warn(`Fallo al sincronizar tarea ${task.id}:`, err);
      const currentQueue = getPendingQueue();
      const queuedTask = currentQueue.find((item) => item.id === task.id);
      if (queuedTask) queuedTask.retries = (queuedTask.retries || 0) + 1;
      savePendingQueue(currentQueue);
    }
  }

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
let lastKnownEntry = null;
let lastKnownUsers = null;

export async function checkRemoteChanges() {
  if (!isOnline) return;

  try {
    // 1. Consultar conteo de movimientos recientes en Supabase
    const movementsData = await supabaseQuery("movements?select=id,timestamp&order=timestamp.desc&limit=1");
    const currentMovCount = movementsData?.length > 0 ? `${movementsData[0].id}-${movementsData[0].timestamp}` : null;

    // 2. Huella completa de inventario: detecta cambios en cualquier lote.
    const inventoryData = await supabaseQuery("inventory?select=id,quantity,expiry,sale_price&order=id.asc");
    const currentInvSample = JSON.stringify(
      (inventoryData || []).map((item) => [item.id, item.quantity, item.expiry, item.sale_price])
    );

    // 3. Detectar ingresos y cambios de usuarios realizados desde otros dispositivos.
    const entriesData = await supabaseQuery("inventory_entries?select=id,timestamp&order=timestamp.desc&limit=1");
    const currentEntry = entriesData?.length > 0 ? `${entriesData[0].id}-${entriesData[0].timestamp}` : null;
    const usersData = await supabaseQuery("app_users?select=id,active,last_access&order=id.asc");
    const currentUsers = JSON.stringify((usersData || []).map((user) => [user.id, user.active, user.last_access]));

    if (lastKnownMovementCount !== null && currentMovCount !== lastKnownMovementCount) {
      // Hubo nuevo movimiento registrado en la nube por otro usuario
      notifyDataChanged("movements", false);
    }

    if (lastKnownInventoryCount !== null && currentInvSample !== lastKnownInventoryCount) {
      // Hubo cambio de inventario registrado en la nube por otro usuario
      notifyDataChanged("inventory", false);
    }

    if (lastKnownEntry !== null && currentEntry !== lastKnownEntry) {
      notifyDataChanged("entries", false);
    }

    if (lastKnownUsers !== null && currentUsers !== lastKnownUsers) {
      notifyDataChanged("users", false);
    }

    lastKnownMovementCount = currentMovCount;
    lastKnownInventoryCount = currentInvSample;
    lastKnownEntry = currentEntry;
    lastKnownUsers = currentUsers;
  } catch (_) {
    // El navegador puede seguir diciendo "online" aunque Supabase no sea alcanzable.
    // Marcar el modo local permite avisar al usuario y activa el sondeo de reconexión.
    isOnline = false;
    updateSyncUI();
  }
}

/**
 * Actualizar indicadores visuales de estado de conexión y sincronización
 */
export function updateSyncUI() {
  if (typeof document === "undefined") return;
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
    if (!isOnline && (typeof navigator === "undefined" || navigator.onLine)) {
      const connection = await checkSupabaseConnection();
      if (connection.ok) {
        isOnline = true;
        updateSyncUI();
        showToast("Conexión restablecida", "Sincronizando registros pendientes con Supabase...", "info");
      }
    }

    if (isOnline) {
      if (getPendingQueue().length > 0) {
        await flushPendingQueue();
      }
      await checkRemoteChanges();
    }
  }, 7000);
}
