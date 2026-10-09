import test from "node:test";
import assert from "node:assert/strict";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
globalThis.BroadcastChannel = undefined;

const { enqueueOfflineAction, getPendingQueue } = await import("../src/services/syncService.js");

test("una edición offline repetida conserva únicamente la versión más reciente", () => {
  enqueueOfflineAction("UPDATE_USER", "app_users?id=eq.usuario-1", "PATCH", { active: true }, "USER-usuario-1");
  enqueueOfflineAction("UPDATE_USER", "app_users?id=eq.usuario-1", "PATCH", { active: false }, "USER-usuario-1");

  const queue = getPendingQueue();
  assert.equal(queue.length, 1);
  assert.deepEqual(queue[0].body, { active: false });
});

test("una eliminación offline sin cuerpo se guarda sin producir errores", () => {
  enqueueOfflineAction("DELETE_USER", "app_users?id=eq.usuario-2", "DELETE", null, "DELETE-usuario-2");
  const task = getPendingQueue().find((item) => item.id === "DELETE-usuario-2");
  assert.equal(task.method, "DELETE");
  assert.equal(task.body, null);
});
