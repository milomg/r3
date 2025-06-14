import { bench } from "vitest";
import {
  signal,
  computed,
  stabilize,
  read,
  Computed,
  setSignal,
} from "../../src";
import { batch, createMemo, createSignal } from "./queue";

bench("cellx", () => {
  const start = {
    prop1: signal(1),
    prop2: signal(2),
    prop3: signal(3),
    prop4: signal(4),
  };

  let layer: {
    prop1: Computed<number>;
    prop2: Computed<number>;
    prop3: Computed<number>;
    prop4: Computed<number>;
  } = start as any;

  for (let i = 2000; i > 0; i--) {
    const m = layer;
    const s = {
      prop1: computed(() => read(m.prop2)),
      prop2: computed(() => read(m.prop1) - read(m.prop3)),
      prop3: computed(() => read(m.prop2) + read(m.prop4)),
      prop4: computed(() => read(m.prop3)),
    };
    layer = s;
  }

  const end = layer;

  stabilize();

  const before = [
    end.prop1.value,
    end.prop2.value,
    end.prop3.value,
    end.prop4.value,
  ] as const;

  setSignal(start.prop1, 4);
  stabilize();
  setSignal(start.prop2, 3);
  stabilize();
  setSignal(start.prop3, 2);
  stabilize();
  setSignal(start.prop4, 1);
  stabilize();

  const after = [
    end.prop1.value,
    end.prop2.value,
    end.prop3.value,
    end.prop4.value,
  ] as const;
});

bench("cellx-solid", () => {
  const start = {
    prop1: createSignal(1),
    prop2: createSignal(2),
    prop3: createSignal(3),
    prop4: createSignal(4),
  };
  let layer: {
    prop1: () => number;
    prop2: () => number;
    prop3: () => number;
    prop4: () => number;
  } = {
    prop1: start.prop1[0],
    prop2: start.prop2[0],
    prop3: start.prop3[0],
    prop4: start.prop4[0],
  };
  for (let i = 2000; i > 0; i--) {
    const m = layer;
    const s = {
      prop1: createMemo(() => m.prop2()),
      prop2: createMemo(() => m.prop1() - m.prop3()),
      prop3: createMemo(() => m.prop2() + m.prop4()),
      prop4: createMemo(() => m.prop3()),
    };
    layer = s;
  }
  const end = layer;

  const before = [end.prop1(), end.prop2(), end.prop3(), end.prop4()] as const;
  start.prop1[1](4);
  start.prop2[1](3);
  start.prop3[1](2);
  start.prop4[1](1);
  const after = [end.prop1(), end.prop2(), end.prop3(), end.prop4()] as const;
});
