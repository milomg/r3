import { expect, test } from "vitest";
import { Computed, computed, read, setSignal, Signal, signal, stabilize } from "../src";

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

test("firewall signals", () => {
  const map = new Map<string, Signal<boolean>>();
  const selected = signal("a");
  let prev: string | null = null;
  const selector = computed(() => {
    if (prev) {
      const s = map.get(prev);
      if (s) {
        setSignal(s, false);
      }
    }
    prev = read(selected);
    const s = map.get(prev);
    if (s) setSignal(s, true);
  });

  const a = signal(true, selector);
  map.set("a", a);
  const b = signal(false, selector);
  map.set("b", b);
  const c = signal(false, selector);
  map.set("c", c);

  expect(a.value).toBe(true);

  setSignal(selected, "b");
  stabilize();

  expect(a.value).toBe(false);
  expect(b.value).toBe(true);
});

test("firewall signals height jump (init signal - 0 height start)", () => {
  const isHigh = signal(false);
  const s = signal(0);
  let a = 1;
  let isInit = signal(false);
  let projectionRuns = 0;
  const aProjector = computed(() => {
    projectionRuns++;
    if (read(isInit)) {
      setSignal(aOut, read(s) + ++a);
    }
  });
  const aOut = signal(a, aProjector);
  let b = 2;
  const bProjector = computed(() => {
    projectionRuns++;
    if (read(isInit)) {
      setSignal(bOut, read(aOut) + ++b);
    }
  });
  const bOut = signal(b, bProjector);
  let c = 3;
  const cProjector = computed(() => {
    projectionRuns++;
    if (read(isInit)) {
      setSignal(cOut, read(bOut) + ++c);
    }
  });
  const cOut = signal(c, cProjector);
  const xProjector = computed(() => {
    projectionRuns++;
    if (read(isInit)) {
      if (read(isHigh)) {
        setSignal(xOut, read(cOut));
      } else {
        setSignal(xOut, read(aOut));
      }
    }
  });
  const xOut = signal(aOut.value, xProjector);
  const nProjector = computed(() => {
    projectionRuns++;
    if (read(isInit)) {
      if (read(isHigh)) {
        setSignal(nOut, read(xOut));
      } else {
        setSignal(nOut, read(bOut));
      }
    }
  });
  const nOut = signal(bOut.value, nProjector);

  expect(projectionRuns).toBe(5);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(2);
  expect(cOut.value).toBe(3);
  expect(xOut.value).toBe(1);
  expect(nOut.value).toBe(2);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(0);
  expect(cProjector.height).toBe(0);
  expect(xProjector.height).toBe(0);
  expect(nProjector.height).toBe(0);

  setSignal(isInit, true);
  stabilize();
  
  expect(projectionRuns).toBe(10);
  expect(aOut.value).toBe(2);
  expect(bOut.value).toBe(5);
  expect(cOut.value).toBe(9);
  expect(xOut.value).toBe(2);
  expect(nOut.value).toBe(5);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(1);
  expect(cProjector.height).toBe(2);
  expect(xProjector.height).toBe(1);
  expect(nProjector.height).toBe(2);

  setSignal(isHigh, true);
  setSignal(s, 1);
  stabilize();
  
  expect(projectionRuns).toBe(15);
  expect(aOut.value).toBe(4);
  expect(bOut.value).toBe(8);
  expect(cOut.value).toBe(13);
  expect(xOut.value).toBe(13);
  expect(nOut.value).toBe(13);
  expect(xProjector.height).toBe(3);
  expect(nProjector.height).toBe(4);

  setSignal(isHigh, false);
  stabilize();

  expect(projectionRuns).toBe(17);
  expect(xOut.value).toBe(4);
  expect(nOut.value).toBe(8);
  // expect(xProjector.height).toBe(1);
  // expect(nProjector.height).toBe(2);
});

test("firewall signals height jump (init raw - 0 height start)", () => {
  const isHigh = signal(false);
  const s = signal(0);
  let a = 1;
  let isInit = false;
  let projectionRuns = 0;
  const aProjector = computed(() => {
    projectionRuns++;
    const v = read(s);
    if (isInit) {
      setSignal(aOut, v + ++a);
    }
  });
  const aOut = signal(a, aProjector);
  let b = 2;
  const bProjector = computed(() => {
    projectionRuns++;
    const v = read(aOut);
    if (isInit) {
      setSignal(bOut, v + ++b);
    }
  });
  const bOut = signal(b, bProjector);
  let c = 3;
  const cProjector = computed(() => {
    projectionRuns++;
    const v = read(bOut);
    if (isInit) {
      setSignal(cOut, v + ++c);
    }
  });
  const cOut = signal(c, cProjector);
  const xProjector = computed(() => {
    projectionRuns++;
    const h = read(isHigh);
    if (isInit) {
      if (h) {
        setSignal(xOut, read(cOut));
      } else {
        setSignal(xOut, read(aOut));
      }
    }
  });
  const xOut = signal(aOut.value, xProjector);
  const nProjector = computed(() => {
    projectionRuns++;
    const h = read(isHigh);
    if (isInit) {
      if (h) {
        setSignal(nOut, read(xOut));
      } else {
        setSignal(nOut, read(bOut));
      }
    }
  });
  const nOut = signal(bOut.value, nProjector);
  isInit = true;

  expect(projectionRuns).toBe(5);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(2);
  expect(cOut.value).toBe(3);
  expect(xOut.value).toBe(1);
  expect(nOut.value).toBe(2);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(1);
  expect(cProjector.height).toBe(2);
  expect(xProjector.height).toBe(0);
  expect(nProjector.height).toBe(0);

  setSignal(s, 1);
  setSignal(isHigh, true);
  stabilize();

  expect(projectionRuns).toBe(10);
  expect(aOut.value).toBe(3);
  expect(bOut.value).toBe(6);
  expect(cOut.value).toBe(10);
  expect(xOut.value).toBe(10);
  expect(nOut.value).toBe(10);
  expect(xProjector.height).toBe(3);
  expect(nProjector.height).toBe(4);

  setSignal(isHigh, false);
  stabilize();
  
  expect(projectionRuns).toBe(12);
  expect(xOut.value).toBe(4);
  expect(nOut.value).toBe(8);
  // expect(xProjector.height).toBe(1);
  // expect(nProjector.height).toBe(2);
});

test("firewall signals height jump (init internal - normal height start)", () => {
  const isHigh = signal(false);
  const s = signal(0);
  let projectionRuns = 0;
  let a = 1;
  let aOut!: Signal<number>;
  const aProjector = computed(function(this: Computed<void>) {
    projectionRuns++;
    const v = read(s) + ++a;
    if (aOut === undefined) {
      aOut = signal(v, this);
    } else {
      setSignal(aOut, v);
    }
  });
  let b = 2;
  let bOut!: Signal<number>;
  const bProjector = computed(function(this: Computed<void>)  {
    projectionRuns++;
    const v = read(aOut) + ++b;
    if (bOut === undefined) {
      bOut = signal(v, this);
    } else {
      setSignal(bOut, v);
    }
  });
  let c = 3;
  let cOut!: Signal<number>;
  const cProjector = computed(function(this: Computed<void>)  {
    projectionRuns++;
    const v = read(bOut) + ++c;
    if (cOut === undefined) {
      cOut = signal(v, this);
    } else {
      setSignal(cOut, v);
    }
  });
  let xOut!: Signal<number>;
  const xProjector = computed(function(this: Computed<void>)  {
    projectionRuns++;
    const v = read(isHigh) ? read(cOut) : read(aOut);
    if (xOut === undefined) {
      xOut = signal(v, this);
    } else {
      setSignal(xOut, v);
    }
  });
  let nOut!: Signal<number>;
  const nProjector = computed(function(this: Computed<void>)  {
    projectionRuns++;
    const v = read(isHigh) ? read(xOut) : read(bOut);
    if (nOut === undefined) {
      nOut = signal(v, this);
    } else {
      setSignal(nOut, v);
    }
  });

  expect(projectionRuns).toBe(5);
  expect(aOut.value).toBe(2);
  expect(bOut.value).toBe(5);
  expect(cOut.value).toBe(9);
  expect(xOut.value).toBe(2);
  expect(nOut.value).toBe(5);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(1);
  expect(cProjector.height).toBe(2);
  expect(xProjector.height).toBe(1);
  expect(nProjector.height).toBe(2);


  setSignal(isHigh, true);
  setSignal(s, 1);
  stabilize();
  
  expect(projectionRuns).toBe(10);
  expect(aOut.value).toBe(4);
  expect(bOut.value).toBe(8);
  expect(cOut.value).toBe(13);
  expect(xOut.value).toBe(13);
  expect(nOut.value).toBe(13);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(1);
  expect(cProjector.height).toBe(2);
  expect(xProjector.height).toBe(3);
  expect(nProjector.height).toBe(4);

  setSignal(isHigh, false);
  stabilize();
  
  expect(projectionRuns).toBe(12);
  expect(xOut.value).toBe(4);
  expect(nOut.value).toBe(8);
  // expect(xProjector.height).toBe(1);
  // expect(nProjector.height).toBe(2);
});

test("firewall signals height swap (init signal - 0 height start)", () => {
  const isAHigh = signal(false);
  let isInit = signal(false);
  let projectionRuns = 0;
  const aProjector = computed(function() {
    projectionRuns++;
    if (read(isInit)) {
      setSignal(aOut, read(isAHigh) ? read(bOut) : 1);
    }
  });
  const aOut = signal(1, aProjector);
  const bProjector = computed(() => {
    projectionRuns++;
    if (read(isInit)) {
      setSignal(bOut, read(isAHigh) ? 2 : read(aOut));
    }
  });
  const bOut = signal(1, bProjector);

  expect(projectionRuns).toBe(2);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(1);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(0);

  setSignal(isInit, true);
  stabilize();

  expect(projectionRuns).toBe(4);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(1);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(1);

  setSignal(isAHigh, true);
  stabilize();

  expect(projectionRuns).toBe(6);
  expect(aOut.value).toBe(2);
  expect(bOut.value).toBe(2);
  // expect(aProjector.height).toBe(1);
  // expect(bProjector.height).toBe(0);

  setSignal(isAHigh, false);
  stabilize();

  expect(projectionRuns).toBe(8);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(1);
  // expect(aProjector.height).toBe(0);
  // expect(bProjector.height).toBe(1);
});

test("firewall signals height swap (init raw - 0 height start)", () => {
  const isAHigh = signal(false);
  let isInit = false;
  let projectionRuns = 0;
  const aProjector = computed(function() {
    projectionRuns++;
    const aH = read(isAHigh);
    if (isInit) {
      setSignal(aOut, aH ? read(bOut) : 1);
    }
  });
  const aOut = signal(1, aProjector);
  const bProjector = computed(() => {
    projectionRuns++;
    const aH = read(isAHigh);
    if (isInit) {
      setSignal(bOut, aH ? 2 : read(aOut));
    }
  });
  const bOut = signal(1, bProjector);
  isInit = true;

  expect(projectionRuns).toBe(2);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(1);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(0);

  setSignal(isAHigh, true);
  stabilize();

  expect(projectionRuns).toBe(4);
  expect(aOut.value).toBe(2);
  expect(bOut.value).toBe(2);
  expect(aProjector.height).toBe(1);
  expect(bProjector.height).toBe(0);

  setSignal(isAHigh, false);
  stabilize();

  expect(projectionRuns).toBe(6);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(1);
  // expect(aProjector.height).toBe(0);
  // expect(bProjector.height).toBe(1);
});

test("firewall signals height swap (init internal - normal height start)", () => {
  const isAHigh = signal(false);
  let projectionRuns = 0;
  let aOut!: Signal<number>;
  const aProjector = computed(function(this: Computed<void>) {
    projectionRuns++;
    const v = read(isAHigh) ? read(bOut) : 1;
    if (aOut === undefined) {
      aOut = signal(v, this);
    } else {
      setSignal(aOut, v);
    }
  });
  let bOut!: Signal<number>;
  const bProjector = computed(() => {
    projectionRuns++;
    const v = read(isAHigh) ? 2 : read(aOut);
    if (bOut === undefined) {
      bOut = signal(v, this);
    } else {
      setSignal(bOut, v);
    }
  });

  expect(projectionRuns).toBe(2);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(1);
  expect(aProjector.height).toBe(0);
  expect(bProjector.height).toBe(1);

  setSignal(isAHigh, true);
  stabilize();

  expect(projectionRuns).toBe(4);
  expect(aOut.value).toBe(2);
  expect(bOut.value).toBe(2);
  // expect(aProjector.height).toBe(1);
  // expect(bProjector.height).toBe(0);

  setSignal(isAHigh, false);
  stabilize();

  expect(projectionRuns).toBe(6);
  expect(aOut.value).toBe(1);
  expect(bOut.value).toBe(1);
  // expect(aProjector.height).toBe(0);
  // expect(bProjector.height).toBe(1);
});