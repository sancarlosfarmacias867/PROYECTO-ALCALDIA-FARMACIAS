/**
 * Fecha oficial del sistema municipal.
 * Toda fecha operativa se calcula en la zona horaria de Bolivia, aunque el
 * dispositivo tenga otra configuración regional.
 */
export const BUSINESS_TIME_ZONE = "America/La_Paz";

const datePartsFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

const dateTimeFormatter = new Intl.DateTimeFormat("es-BO", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: true
});

export function getBusinessDate(value = new Date()) {
  const parts = datePartsFormatter.formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getBusinessTimestamp(value = new Date()) {
  return value.toISOString();
}

export function formatBusinessDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).replace("T", " ").slice(0, 19);
  return dateTimeFormatter.format(parsed);
}

export function getBusinessMonth(value = new Date()) {
  return getBusinessDate(value).slice(0, 7);
}
