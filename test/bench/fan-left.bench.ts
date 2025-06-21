import { bench } from "vitest";
import { signal, computed, stabilize, read, Computed, setSignal, Signal } from "../../src";

const FAN_DOWN_SIZE = 200;

bench("fan left", () => {
  const isHigh = signal(false);
  const s = signal(0);
  const aItems: Computed<number>[] = [];
  for (let i = 0; i < FAN_DOWN_SIZE; i++) {
    aItems.push(computed(() => read(s) + i));
  }
  const bItems: Computed<number>[] = [];
  for (let i = 0; i < FAN_DOWN_SIZE; i++) {
    bItems.push(computed(() => read(s) + read(aItems[i]) * 2));
  }
  let xOut!: Signal<number>;
  const xProjector = computed(function(this: Computed<void>)  {
    const out = (read(isHigh) ? aItems : bItems).reduce((acc, c) => (acc + read(c)), 0);
    if (xOut === undefined) {
      xOut = signal(out, this);
    } else {
      setSignal(xOut, out);
    }
  });

  setSignal(s, 1);
  setSignal(isHigh, true);
  stabilize();
});
