import { getBusinessDate } from "../utils/dateTime.js";

export const branches = [
  { id: "santa-fe", name: "Santa Fe", code: "SF" },
  { id: "buen-retiro", name: "Buen Retiro", code: "BR" },
  { id: "san-carlos", name: "San Carlos", code: "SC" },
  { id: "antofagasta", name: "Antofagasta", code: "AN" },
  { id: "2-agosto", name: "2 de Agosto", code: "2A" },
  { id: "villa-imperial", name: "Villa Imperial", code: "VI" },
];

const addDays = (days) => {
  const [year, month, day] = getBusinessDate().split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + days));
  return d.toISOString().slice(0, 10);
};

const monthsAgo = (months, day = 12) => {
  const [year, month, today] = getBusinessDate().split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1 - months, day));
  // Los datos de demostración jamás pueden aparecer en el futuro.
  if (months === 0 && day > today) d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 10);
};

const catalog = [
  ["Paracetamol 500 mg", 0.42, 0.55], ["Ibuprofeno 400 mg", 0.75, 0.98],
  ["Amoxicilina 500 mg", 1.25, 1.63], ["Omeprazol 20 mg", 0.66, 0.86],
  ["Losartán 50 mg", 0.58, 0.75], ["Metformina 850 mg", 0.72, 0.94],
  ["Salbutamol inhalador", 18.5, 24.05], ["Cefalexina 500 mg", 1.45, 1.89],
  ["Diclofenaco 50 mg", 0.38, 0.49], ["Loratadina 10 mg", 0.54, 0.70],
];

export const seedInventory = branches.flatMap((branch, bi) =>
  catalog.slice(0, bi % 2 ? 8 : 9).map((item, pi) => ({
    id: `${branch.code}-${pi + 1}`,
    branchId: branch.id,
    name: item[0],
    lot: `${branch.code}-${String(2401 + pi * 7)}`,
    quantity: 34 + ((bi * 37 + pi * 23) % 190),
    unitCost: item[1],
    salePrice: item[2],
    margin: 30,
    priceConfigured: true,
    entryDate: monthsAgo((pi % 4) + 1),
    expiry: addDays([48, 114, 245, 420, 72, 195, 330, 156, 510][(pi + bi) % 9]),
  }))
);

const sellers = ["Ana Rojas", "Luis Pedraza", "Carla Méndez", "José Vaca", "Rosa Suárez", "Diego Lima"];
export const seedSales = Array.from({ length: 54 }, (_, i) => {
  const branch = branches[(i * 5 + Math.floor(i / 6)) % branches.length];
  const type = i % 4 === 0 ? "sus" : "normal";
  const items = 1 + (i % 5);
  const date = monthsAgo(i % 6, 2 + (i * 3) % 25);
  const branchStock = seedInventory.filter((x) => x.branchId === branch.id);
  const product = branchStock[i % branchStock.length];
  const total = type === "sus" ? 0 : +(18 + ((i * 31) % 180) + (i % 4) * 0.5).toFixed(2);
  const unitPrice = type === "sus" ? 0 : +(total / items).toFixed(2);
  return {
    id: `MOV-${1001 + i}`,
    date,
    timestamp: `${date}T${String(8 + (i % 9)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00-04:00`,
    branchId: branch.id,
    type,
    items,
    total,
    profit: type === "sus" ? 0 : +(4 + ((i * 7) % 42)).toFixed(2),
    responsible: sellers[branches.findIndex((item) => item.id === branch.id)],
    notes: "",
    lines: [{
      inventoryId: product.id,
      name: product.name,
      lot: product.lot,
      quantity: items,
      unitPrice,
      unitCost: product.unitCost,
      subtotal: total,
    }],
  };
});

const historicalEntries = seedInventory.map((item, i) => ({
  id: `ING-${1001 + i}`,
  date: item.entryDate,
  timestamp: `${item.entryDate}T${String(7 + (i % 10)).padStart(2, "0")}:${String((i * 11) % 60).padStart(2, "0")}:00-04:00`,
  branchId: item.branchId,
  inventoryId: item.id,
  name: item.name,
  lot: item.lot,
  quantity: item.quantity,
  unitCost: item.unitCost,
  expiry: item.expiry,
  responsible: i % 2 ? "Carlos Rivero" : "Carla Méndez",
}));

const recentEntries = branches.map((branch, i) => {
  const product = seedInventory.find((item) => item.branchId === branch.id);
  const date = monthsAgo(0, 3 + i * 3);
  return {
    id: `ING-REC-${1001 + i}`,
    date,
    timestamp: `${date}T${String(8 + i).padStart(2, "0")}:${String(10 + i * 6).padStart(2, "0")}:00-04:00`,
    branchId: branch.id,
    inventoryId: product.id,
    name: product.name,
    lot: `${branch.code}-230${i + 1}`,
    quantity: 40 + i * 12,
    unitCost: product.unitCost,
    expiry: addDays(280 + i * 25),
    responsible: i % 2 ? "Carlos Rivero" : "Carla Méndez",
  };
});

export const seedEntries = [...recentEntries, ...historicalEntries];

export const seedUsers = [
  { id: "U-01", name: "María Aguilera", email: "m.aguilera@sancarlos.gob.bo", role: "admin", branchId: "all", active: true, lastAccess: "Hoy, 09:42" },
  { id: "U-02", name: "Carlos Rivero", email: "c.rivero@sancarlos.gob.bo", role: "tecnico", branchId: "san-carlos", active: true, lastAccess: "Hoy, 08:15" },
  { id: "U-03", name: "Ana Rojas", email: "a.rojas@sancarlos.gob.bo", role: "vendedor", branchId: "santa-fe", active: true, lastAccess: "Hoy, 10:03" },
  { id: "U-04", name: "Luis Pedraza", email: "l.pedraza@sancarlos.gob.bo", role: "vendedor", branchId: "buen-retiro", active: true, lastAccess: "Ayer, 17:46" },
  { id: "U-05", name: "Carla Méndez", email: "c.mendez@sancarlos.gob.bo", role: "tecnico", branchId: "antofagasta", active: true, lastAccess: "Ayer, 16:20" },
  { id: "U-06", name: "Rosa Suárez", email: "r.suarez@sancarlos.gob.bo", role: "vendedor", branchId: "villa-imperial", active: false, lastAccess: "24 sep., 11:08" },
];
