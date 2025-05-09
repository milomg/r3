import { expect, test } from "vitest";
import {
  computed,
  readComputed,
  readSignal,
  setSignal,
  signal,
  stabilize,
} from "../src";

test("basic", () => {
  let aCount = 0;
  let bCount = 0;
  const s = signal(1);
  const a = computed(() => {
    aCount++;
    return readSignal(s) + 1;
  });
  const b = computed(() => {
    bCount++;
    return readComputed(a) + 1;
  });
  stabilize();

  expect(a.value).toBe(2);
  expect(b.value).toBe(3);

  expect(aCount).toBe(1);
  expect(bCount).toBe(1);

  expect(a.height).toBe(0);
  expect(b.height).toBe(1);

  setSignal(s, 2);

  stabilize();
  expect(a.value).toBe(3);
  expect(b.value).toBe(4);
  expect(aCount).toBe(2);
  expect(bCount).toBe(2);
});

test("dynamic sources recalculate correctly", () => {
  const a = signal(false);
  const b = signal(2);
  let count = 0;

  const c = computed(() => {
    count++;
    readSignal(a) || readSignal(b);
  });

  stabilize();

  expect(count).toBe(1);

  setSignal(a, true);
  stabilize();

  expect(count).toBe(2);

  expect(c.sources.length).toBe(1);
  expect(b.observers.length).toBe(0);


  setSignal(b, 4);
  stabilize();

  expect(count).toBe(2);
});

/*
    s
    |
    l
  */
test("dynamic source disappears entirely", () => {
  const s = signal(1);
  let done = false;
  let count = 0;

  const c = computed(() => {
    count++;

    if (done) {
      return 0;
    } else {
      const value = readSignal(s);
      if (value > 2) {
        done = true; // break the link between s and c
      }
      return value;
    }
  });

  stabilize();

  expect(c.value).toBe(1);
  expect(count).toBe(1);

  setSignal(s, 3);
  stabilize();

  expect(c.value).toBe(3);
  expect(count).toBe(2);

  setSignal(s, 1); // we've now locked into 'done' state
  stabilize();

  expect(c.value).toBe(0);
  expect(count).toBe(3);

  // we're still locked into 'done' state, and count no longer advances
  // in fact, c() will never execute again..
  setSignal(s, 0);
  stabilize();

  expect(c.value).toBe(0);
  expect(count).toBe(3);
});

test("small dynamic graph with signal grandparents", () => {
  const z = signal(3);
  const x = signal(0);

  const y = signal(0);
  const i = computed(() => {
    let a = readSignal(y);
    readSignal(z);
    if (!a) {
      return readSignal(x);
    } else {
      return a;
    }
  });
  const j = computed(() => {
    let a = readComputed(i);
    readSignal(z);
    if (!a) {
      return readSignal(x);
    } else {
      return a;
    }
  });

  stabilize();
  setSignal(x, 1);
  stabilize();
  setSignal(y, 1);
  stabilize();
});
