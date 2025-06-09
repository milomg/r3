import { expect, it, describe } from "vitest";
import {
  asyncComputed,
  computed,
  createTransaction,
  isPending,
  read,
  setSignal,
  signal,
  stabilize,
} from "../src";

function sleep<T>(v?: T, ms = 5) {
  return new Promise((resolve) => setTimeout(() => resolve(v), ms));
}

describe("createTransaction", () => {
  it("should set state into a fork", async () => {
    const [run] = createTransaction();

    const x = signal(0);
    const dx = computed(() => {
      return read(x) * 2;
    });
    const y = asyncComputed(() => {
      return sleep(read(x));
    });
    const yp = computed(() => {
      return isPending(() => {
        return read(y);
      });
    });
    stabilize();

    expect(read(dx)).toBe(0);
    expect(() => read(y)).toThrow();
    expect(() => read(yp)).toThrow();

    await sleep();
    expect(read(dx)).toBe(0);
    expect(read(y)).toBe(0);
    expect(read(yp)).toBe(false);

    run(() => {
      setSignal(x, 1);
      stabilize();
      expect(read(x)).toBe(1);
      expect(read(dx)).toBe(2);
      expect(() => read(y)).toThrow();
      expect(read(yp)).toBe(true);
    });
    expect(read(x)).toBe(0);
    expect(read(dx)).toBe(0);
    expect(read(y)).toBe(0);
    expect(read(yp)).toBe(false);
    await sleep();
    expect(read(x)).toBe(1);
    expect(read(dx)).toBe(2);
  });

  it("resolves immediately if no async", async () => {
    const [run] = createTransaction();

    const x = signal(0);
    const dx = computed(() => read(x) * 2);
    stabilize();

    expect(read(dx)).toBe(0);

    run(() => {
      setSignal(x, 1);
      stabilize();
      expect(read(x)).toBe(1);
      expect(read(dx)).toBe(2);
    });
    expect(read(x)).toBe(1);
    expect(read(dx)).toBe(2);
  });

  it("should run multiple transactions concurrently", async () => {
    const [run1] = createTransaction();
    const [run2] = createTransaction();

    const x1 = signal(0);
    const dx1 = computed(() => read(x1) * 2);
    const y1 = asyncComputed(() => sleep(read(x1), 10));

    const x2 = signal(0);
    const dx2 = computed(() => read(x2) * 2);
    const y2 = asyncComputed(() => sleep(read(x2), 20));

    stabilize();

    run1(() => {
      setSignal(x1, 1);
      stabilize();
      expect(read(x1)).toBe(1);
    });

    run2(() => {
      setSignal(x2, 2);
      stabilize();
      expect(read(x2)).toBe(2);
    });

    expect(read(x1)).toBe(0);
    expect(read(x2)).toBe(0);
    expect(read(dx1)).toBe(0);
    expect(read(dx2)).toBe(0);

    await sleep(0, 15);

    expect(read(x1)).toBe(1);
    expect(read(x2)).toBe(0);
    expect(read(dx1)).toBe(2);
    expect(read(dx2)).toBe(0);
    expect(read(y1)).toBe(1);
    expect(() => read(y2)).toThrow();

    await sleep(0, 6);

    expect(read(x1)).toBe(1);
    expect(read(x2)).toBe(2);
    expect(read(dx1)).toBe(2);
    expect(read(dx2)).toBe(4);
    expect(read(y1)).toBe(1);
  });

  it("concurrent transactions can read the same data", async () => {
    const [run1] = createTransaction();
    const [run2] = createTransaction();

    const x1 = signal(0);
    const y1 = asyncComputed(() => sleep(read(x1), 5));
    const x2 = signal(0);
    const y2 = asyncComputed(() => sleep(read(x2), 10));
    const z = signal(1);

    stabilize();

    await sleep(0, 10);

    run1(() => {
      setSignal(x1, read(z) + 1);
      stabilize();
      expect(read(x1)).toBe(2);
      expect(() => read(y1)).toThrow();
    });

    run2(() => {
      setSignal(x2, read(z) + 2);
      stabilize();
      expect(read(x2)).toBe(3);
      expect(() => read(y2)).toThrow();
    });

    expect(read(x1)).toBe(0);
    expect(read(x2)).toBe(0);
    expect(read(y1)).toBe(0);
    expect(read(y2)).toBe(0);

    await sleep(0, 6);

    expect(read(x1)).toBe(2);
    expect(read(x2)).toBe(0);
    expect(read(y1)).toBe(2);
    expect(read(y2)).toBe(0);

    await sleep(0, 6);

    expect(read(x1)).toBe(2);
    expect(read(x2)).toBe(3);
    expect(read(y1)).toBe(2);
    expect(read(y2)).toBe(3);
  });

  it("concurrent transactions can't overwrite each other", async () => {
    const [run1] = createTransaction();
    const [run2] = createTransaction();

    const x = signal(0);
    const y = asyncComputed(() => sleep(read(x)));

    stabilize();

    await sleep(0);

    run1(() => {
      setSignal(x, 1);
      stabilize();
      expect(read(x)).toBe(1);
    });

    run2(() => {
      setSignal(x, 2);
      stabilize();
      expect(read(x)).toBe(2);
    });

    expect(read(x)).toBe(0);

    await sleep(0);

    expect(read(x)).toBe(1);
  });
});
