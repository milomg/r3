import { expect, test } from "vitest";
import {
  asyncComputed,
  computed,
  read,
  setSignal,
  signal,
  stabilize,
} from "../src";

function sleep<T>(input: T, ms = 100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(input), ms));
}

test("computed receives previous value", () => {
  const s = signal(1);
  const c = computed((prev) => read(s) + prev + 1, 0);
  stabilize();
  expect(read(c)).toBe(2);

  setSignal(s, 2);
  stabilize();
  expect(read(c)).toBe(5);

  setSignal(s, 3);
  stabilize();
  expect(read(c)).toBe(9);
});

test("async computed receives previous value", async () => {
  const s = signal(1);
  const c = asyncComputed(
    (prev) => sleep(read(s)).then((v) => v + prev + 1),
    0
  );
  stabilize();
  await sleep(100);
  expect(read(c)).toBe(2);
});
