/**
 * Configuración y Cliente de Supabase
 * Farmacias Municipales de San Carlos
 */

export const SUPABASE_URL = "https://dzyoddrgjhrgxebcoyxp.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR6eW9kZHJnamhyZ3hlYmNveXhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE0NzUxMDYsImV4cCI6MjEwNzA1MTEwNn0.dd96fu7F2m1oEohSmJ61zWLVfVfW9lBcugjUQjSYi3w";

/**
 * Cliente REST ligero para Supabase sin depender de paquetes externos
 */
export async function supabaseQuery(endpoint, options = {}) {
  const url = `${SUPABASE_URL}/rest/v1/${endpoint}`;
  const headers = {
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    "Prefer": options.prefer || "return=representation",
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Error Supabase [${options.method || "GET"} ${endpoint}]:`, errorText);
    throw new Error(`Error en Supabase: ${response.status} ${response.statusText}`);
  }

  // Si no hay contenido (204 No Content), retornar null
  if (response.status === 204) return null;

  return await response.json();
}

/**
 * Verificar conexión activa con Supabase
 */
export async function checkSupabaseConnection() {
  try {
    const res = await supabaseQuery("branches?select=id&limit=1");
    return { ok: true, message: "Servidor Central Conectado" };
  } catch (err) {
    return { ok: false, message: "Modo Local (Sin red)" };
  }
}
