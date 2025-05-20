import { expect, test } from "vitest";
import {
  computed,
  read,
  signal,
  stabilize,
  NotReadyError,
  setSignal,
} from "../src";

function sleep<T>(input: T, ms = 100): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(input), ms));
}

test("basic async", async () => {
  const s = signal(1);
  const a = computed(() => {
    return sleep(read(s) + 1);
  });
  stabilize();

  expect(() => read(a)).toThrow(NotReadyError);

  await sleep(100);
  expect(read(a)).toBe(2);
});

test("basic error", async () => {
  const s = signal(1);
  const a = computed(() => {
    if (read(s) % 2) throw new Error();
    return read(s);
  });
  stabilize();

  expect(() => read(a)).toThrow(Error);
  setSignal(s, 2);
  stabilize();
  expect(read(a)).toBe(2);
});

test("async error", async () => {
  const s = signal(1);
  const a = computed(() => {
    return sleep(read(s)).then((v) => {
      if (v % 2) throw new Error();
      return v;
    });
  });
  stabilize();

  expect(() => read(a)).toThrow(NotReadyError);

  await sleep(100);
  expect(() => read(a)).toThrow(Error);

  setSignal(s, 2);
  stabilize();
  expect(() => read(a)).toThrow(NotReadyError);
  await sleep(100);
  expect(read(a)).toBe(2);
});

test("async propogation", async () => {
  console.log("async propogation");
  let aCount = 0;
  let bCount = 0;
  const s = signal(1);
  const a = computed(() => {
    aCount++;
    return sleep(read(s)).then((v) => v + 1);
  });

  const b = computed(() => {
    bCount++;
    return read(a) + 1;
  });

  stabilize();

  expect(() => read(b)).toThrow(NotReadyError);
  expect(aCount).toBe(1);
  expect(bCount).toBe(1);

  await sleep(100);
  expect(read(b)).toBe(3);
  expect(aCount).toBe(1);
  expect(bCount).toBe(2);
});

test("error propogation", async () => {
  let aCount = 0;
  let bCount = 0;
  const s = signal(1);
  const a = computed(() => {
    aCount++;
    return sleep(read(s)).then((v) => {
      if (v % 2) throw new Error();
      return v;
    });
  });
  const b = computed(() => {
    bCount++;
    return read(a) + 1;
  });

  stabilize();

  expect(() => read(b)).toThrow(NotReadyError);
  expect(aCount).toBe(1);
  expect(bCount).toBe(1);

  await sleep(100);
  expect(() => read(b)).toThrow(Error);
  expect(aCount).toBe(1);
  expect(bCount).toBe(1);
});
