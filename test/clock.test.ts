import { test, expect } from "vitest";
import { computed, read, setSignal, signal, stabilize } from "../src";

test("clock", () => {
  const a = signal(1);
  const b = computed(() => read(a) + 1);

  stabilize();

  expect(a.time).toBe(0);
  expect(b.time).toBe(0);

  setSignal(a, 2);
  stabilize();

  expect(a.time).toBe(1);
  expect(b.time).toBe(1);
});
