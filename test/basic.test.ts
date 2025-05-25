import { expect, test } from "vitest";
import { computed, read, setSignal, signal, stabilize } from "../src";

test("basic", () => {
  let aCount = 0;
  let bCount = 0;
  const s = signal(1);
  const a = computed(() => {
    aCount++;
    return read(s) + 1;
  });
  const b = computed(() => {
    bCount++;
    return read(a) + 1;
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

test("diamond", () => {
  let callCount = 0;
  const s = signal(1);
  const a = computed(() => read(s) + 1);
  const b = computed(() => read(s) + 2);
  const c = computed(() => read(s) + 3);
  const d = computed(() => {
    callCount++;
    return read(a) * read(b) * read(c);
  });

  stabilize();
  expect(callCount).toBe(1);
  expect(d.value).toBe(2 * 3 * 4);
  setSignal(s, 2);
  stabilize();
  expect(callCount).toBe(2);
  expect(d.value).toBe(3 * 4 * 5);
});

test("dynamic sources recalculate correctly", () => {
  const a = signal(false);
  const b = signal(2);
  let count = 0;

  const c = computed(() => {
    count++;
    read(a) || read(b);
  });

  stabilize();

  expect(count).toBe(1);

  setSignal(a, true);
  stabilize();

  expect(count).toBe(2);

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
      const value = read(s);
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
    let a = read(y);
    read(z);
    if (!a) {
      return read(x);
    } else {
      return a;
    }
  });
  const j = computed(() => {
    let a = read(i);
    read(z);
    if (!a) {
      return read(x);
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

test("should not run untracked inner effect", () => {
  const a = signal(3);
  const b = computed(function f0() {
    return read(a) > 0;
  });

  computed(function f1() {
    if (read(b)) {
      computed(function f2() {
        if (read(a) == 0) {
          throw new Error("bad");
        }
      });
    }
  });
  stabilize();

  setSignal(a, 2);
  stabilize();

  setSignal(a, 1);
  stabilize();

  setSignal(a, 0);
  stabilize();
});

test("should not run inner effect3", () => {
  const a = signal(0);
  const b = signal(0);

  const order: string[] = [];
  let iter = 0;
  computed(function f1() {
    order.push('outer')
    read(a);

    let myiter = iter++;
    computed(function f2() {
      order.push('inner')
      read(b);
    });
  });

  stabilize();
  expect(order).toEqual(['outer', 'inner']);

  setSignal(a, 2);
  setSignal(b, 2);
  stabilize();

  expect(order).toEqual(['outer', 'inner', 'outer', 'inner']);
});
