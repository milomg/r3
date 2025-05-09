export interface Signal<T> {
  value: T;
  observers: Computed<unknown>[];
  observerSlots: number[];
}

export interface Computed<T> extends Signal<T> {
  height: number;
  pushed: boolean;
  nextHeap: Computed<unknown>;
  prevHeap: Computed<unknown>;
  sources: (Computed<unknown> | Signal<unknown>)[];
  sourceSlots: number[];
  state: number;
  fn: () => T;
}

const DIRTY = 2;
const CHECK = 1;
const CLEAN = 0;

let markedHeap = false;
let context: Computed<unknown> | null = null;

let stabilizeHeight = 0;
let maxHeightInHeap = 0;
const heap: (Computed<unknown> | null)[] = [];
for (let i = 0; i < 2010; i++) {
  heap[i] = null;
}
export function increaseHeapSize(n: number) {
  for (let i = heap.length; i < n; i++) {
    heap[i] = null;
  }
}

function insertIntoHeap(n: Computed<unknown>) {
  if (n.pushed) return;
  n.pushed = true;
  const newHStart = heap[n.height];
  if (newHStart == null) {
    heap[n.height] = n;
  } else {
    newHStart.prevHeap.nextHeap = n;
    n.prevHeap = newHStart.prevHeap;
    newHStart.prevHeap = n;
    n.nextHeap = newHStart;
  }
  if (n.height > maxHeightInHeap) {
    maxHeightInHeap = n.height;
  }
}

function deleteFromHeap(n: Computed<unknown>) {
  if (heap[n.height] == n) {
    heap[n.height] = n.nextHeap;
  }
  if (heap[n.height] == n) {
    heap[n.height] = null;
  } else {
    n.prevHeap.nextHeap = n.nextHeap;
    n.nextHeap.prevHeap = n.prevHeap;
  }
  n.prevHeap = n;
  n.nextHeap = n;
  n.pushed = false;
}

export function computed<T>(fn: () => T): Computed<T> {
  const self: Computed<T> = {
    height: 0,
    nextHeap: null as any,
    prevHeap: null as any,
    observers: [],
    observerSlots: [],
    sources: [],
    sourceSlots: [],
    state: 0,
    pushed: false,
    value: undefined as T,
    fn: fn,
  };
  self.nextHeap = self;
  self.prevHeap = self;
  insertIntoHeap(self);

  return self;
}

export function signal<T>(v: T): Signal<T> {
  const self: Signal<T> = {
    value: v,
    observers: [],
    observerSlots: [],
  };
  return self;
}

function recompute(el: Computed<unknown>) {
  const oldcontext = context;
  context = el;
  cleanNode(el);
  deleteFromHeap(el);
  el.state = CLEAN;
  const value = el.fn();
  context = oldcontext;
  if (value !== el.value) {
    el.value = value;
    for (const o of el.observers) {
      o.state = DIRTY;
      insertIntoHeap(o);
    }
  }
}

function cleanNode(el: Computed<unknown>) {
  while (el.sources.length) {
    const source = el.sources.pop()!,
      index = el.sourceSlots.pop()!,
      obs = source.observers;
    if (obs && obs.length) {
      const n = obs.pop()!,
        s = source.observerSlots.pop()!;
      if (index < obs.length) {
        n.sourceSlots[s] = index;
        obs[index] = n;
        source.observerSlots[index] = s;
      }
    }
  }
}

function updateIfNecessary(el: Computed<unknown>): void {
  if (el.state === CHECK) {
    for (const source of el.sources) {
      if ("fn" in source) {
        updateIfNecessary(source);
      }
      if ((el.state as number) === DIRTY) {
        break;
      }
    }
  }

  if (el.state === DIRTY) {
    recompute(el);
  }

  el.state = CLEAN;
}

export function read<T>(el: Signal<T> | Computed<T>): T {
  if (context) {
    context.sources.push(el);
    context.sourceSlots.push(el.observerSlots.length);
    el.observers.push(context);
    el.observerSlots.push(context.sourceSlots.length - 1);
    if ("fn" in el) {
      if (el.height >= context.height) {
        context.height = el.height + 1;
      }
      if (el.height >= stabilizeHeight) {
        markHeap();
        updateIfNecessary(el);
      }
    }
  }
  return el.value;
}

export function setSignal(el: Signal<unknown>, v: unknown) {
  markedHeap = false;
  if (el.value !== v) {
    el.value = v;
    for (const o of el.observers) {
      insertIntoHeap(o);
    }
  }
}

function markNode(el: Computed<unknown>, newState = DIRTY) {
  if (el.state > newState) return;
  el.state = newState;
  for (const s of el.observers) {
    markNode(s, CHECK);
  }
}

function markHeap() {
  if (markedHeap) return;
  markedHeap = true;
  for (let i = 0; i <= maxHeightInHeap; i++) {
    const head = heap[i];
    if (head) {
      let el = head;
      do {
        markNode(el);
        el = el.nextHeap;
      } while (el !== head);
    }
  }
}

export function stabilize() {
  for (
    stabilizeHeight = 0;
    stabilizeHeight <= maxHeightInHeap;
    stabilizeHeight++
  ) {
    for (let el = heap[stabilizeHeight]; el; el = heap[stabilizeHeight]) {
      recompute(el);
    }
  }
}
