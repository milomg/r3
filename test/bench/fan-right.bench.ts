import { bench } from "vitest";
import { signal, computed, stabilize, read, Computed, setSignal, Signal } from "../../src";

const FAN_RIGHT_SIZE = 10_000;

let s!: Signal<number>;
let isHigh!: Signal<boolean>;
let bc = 0;
let sc = 0;

bench("fan right", () => {
  bc++;
  setSignal(s, 1);
  setSignal(isHigh, true);
  stabilize();
}, {
  setup () {
    sc++;
    isHigh = signal(false);
    s = signal(0);
    let a = 1;
    let aOut!: Signal<number>;
    const aProjector = computed(function(this: Computed<void>) {
      const v = read(s) + a;
      if (aOut === undefined) {
        aOut = signal(v, this);
      } else {
        setSignal(aOut, v);
      }
    });
    let b = 2;
    let bOut!: Signal<number>;
    const bProjector = computed(function(this: Computed<void>)  {
      const v = read(aOut) + b;
      if (bOut === undefined) {
        bOut = signal(v, this);
      } else {
        setSignal(bOut, v);
      }
    });
    let xOutputs: Signal<boolean>[] = [];
    let prevXOut: Signal<boolean> | undefined = undefined;
    const xProjector = computed(function(this: Computed<void>)  {
      const i = read(isHigh) ? read(bOut) : read(aOut);
      let xOut = xOutputs[i];
      if (xOut === prevXOut) {
        return;
      }
      if (xOut === undefined) {
        prevXOut = xOut = xOutputs[i] = signal(true, this);
      } else {
        setSignal(xOut, true);
      }
      if (prevXOut) {
        setSignal(prevXOut, false);
      }
    });
    for (let i = 0; i < FAN_RIGHT_SIZE; i++) {
      xOutputs[i] ??= signal(false, xProjector);
    }
  }
});