import test from "node:test";
import assert from "node:assert/strict";

import { seedSales } from "../src/js/data.js";
import { getBusinessDate, getBusinessMonth } from "../src/utils/dateTime.js";

test("la fecha oficial permanece en Bolivia aunque UTC ya sea el día siguiente", () => {
  const instant = new Date("2026-10-10T02:30:00.000Z");
  assert.equal(getBusinessDate(instant), "2026-10-09");
  assert.equal(getBusinessMonth(instant), "2026-10");
});

test("los movimientos de demostración nunca quedan fechados en el futuro", () => {
  const today = getBusinessDate();
  for (const movement of seedSales) {
    assert.ok(movement.date <= today, `${movement.id} quedó en ${movement.date}`);
    assert.match(movement.timestamp, /-04:00$/);
  }
});
