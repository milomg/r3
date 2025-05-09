import { bench } from "vitest";
import { computed, read, setSignal, signal, stabilize } from "../../src";
import { batch, createMemo, createSignal } from "./queue";

bench("updateComputations1to4", () => {
  const a = signal(1);
  for (let i = 0; i < 4; i++) {
    computed(function () {
      const v = read(a);
    });
  }
  stabilize();

  for (let i = 0; i < 10000; i++) {
    setSignal(a,i);
    stabilize();
  }
});

bench("updateComputations1to4-solid", () => {
  const [a, setA] = createSignal(1);
  for (let i = 0; i < 4; i++) {
    createMemo(function () {
      const v = a();
    });
  }
  batch(() => {});

  for (let i = 0; i < 10000; i++) {
    batch(() => {
      setA(i);
    });
  }
});
