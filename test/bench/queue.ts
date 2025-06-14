const equalFn = (a: any, b: any): boolean => a === b;
const signalOptions: { equals: (a: any, b: any) => boolean } = {
  equals: equalFn,
};
let ERROR: Error | null = null;
let runEffects: (queue: Computation<any>[]) => void = runQueue;
const STALE: number = 1;
const PENDING: number = 2;

interface OwnerNode {
  owned: Computation<any>[] | null;
  cleanups: (() => void)[] | null;
  context: any | null;
  owner: OwnerNode | null;
  state?: number;
}

const UNOWNED: OwnerNode = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null,
};
var Owner: OwnerNode | null = null;
let Listener: Computation<any> | null = null;
let Updates: Computation<any>[] | null = null;
let Effects: Computation<any>[] | null = null;
let ExecCount: number = 0;

export interface Signal<T> {
  value: T;
  observers: Computation<T>[];
  observerSlots: number[];
  comparator?: (a: T, b: T) => boolean;
  state?: number;
  sources?: (Signal<any> | Computation<any>)[];
}

export interface Computation<T> extends OwnerNode {
  fn: (value?: T) => T;
  state: number;
  updatedAt: number | null;
  owned: Computation<any>[] | null;
  sources: (Computation<any> | Signal<any>)[];
  sourceSlots: number[];
  cleanups: (() => void)[] | null;
  value: T;
  owner: OwnerNode | null;
  context: any | null;
  pure: boolean;
  observers: Computation<T>[];
  observerSlots: number[];
  comparator?: (a: T, b: T) => boolean;
}

function createRoot<T>(
  fn: (dispose: () => void) => T,
  detachedOwner?: OwnerNode,
): T {
  detachedOwner && (Owner = detachedOwner);
  const listener = Listener,
    owner = Owner,
    root: OwnerNode =
      fn.length === 0
        ? UNOWNED
        : {
            owned: null,
            cleanups: null,
            context: null,
            owner,
          };
  Owner = root;
  Listener = null;
  let result!: T;
  try {
    runUpdates(() => (result = fn(() => cleanNode(root))), true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  return result;
}

function createSignal<T>(
  value: T,
  options?: { equals?: (a: T, b: T) => boolean },
): [() => T, (value: T | ((prev: T) => T)) => T] {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s: Signal<T> = {
    value,
    observers: [],
    observerSlots: [],
    comparator: options.equals || undefined,
  };
  return [
    readSignal.bind(s as any) as () => T,
    (v: T | ((prev: T) => T)): T => {
      if (typeof v === "function") {
        v = (v as (prev: T) => T)(s.value);
      }
      return writeSignal(s, v as T);
    },
  ];
}

function createComputed<T>(fn: (value?: T) => T, value?: T): void {
  updateComputation(createComputation(fn, value, true, STALE));
}

function createMemo<T>(
  fn: (value?: T) => T,
  value?: T,
  options?: { equals?: (a: T, b: T) => boolean },
): () => T {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c: Computation<T> = createComputation(fn, value, true, 0);
  c.observers = [];
  c.observerSlots = [];
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return readSignal.bind(c as any) as () => T;
}

function batch<T>(fn: () => T): T {
  return runUpdates(fn, false);
}

function untrack<T>(fn: () => T): T {
  let result: T,
    listener = Listener;
  Listener = null;
  result = fn();
  Listener = listener;
  return result;
}

function readSignal<T>(this: Signal<T> | Computation<T>): T {
  if (this.state && this.sources) {
    const updates = Updates;
    Updates = null;
    this.state === STALE
      ? updateComputation(this as Computation<T>)
      : lookUpstream(this as Computation<T>);
    Updates = updates;
  }
  if (Listener) {
    const sSlot = this.observers ? this.observers.length : 0;

    Listener.sources.push(this);
    Listener.sourceSlots.push(sSlot);

    this.observers.push(Listener);
    this.observerSlots.push(Listener.sources.length - 1);
  }
  return this.value;
}

function writeSignal<T>(
  node: Signal<T> | Computation<T>,
  value: T,
  isComp?: boolean,
): T {
  if (node.comparator) {
    if (node.comparator(node.value, value)) return value;
  }
  node.value = value;
  if (node.observers && node.observers.length) {
    runUpdates(() => {
      for (let i = 0; i < node.observers!.length; i += 1) {
        const o = node.observers![i];
        if (!o.state) {
          if (o.pure) Updates!.push(o);
          else Effects!.push(o);
          if (o.observers) markDownstream(o);
        }
        o.state = STALE;
      }
      if (Updates!.length > 10e5) {
        Updates = [];
        ERROR = new Error("Maximum update depth exceeded");
        throw ERROR;
      }
    }, false);
  }
  return value;
}

function updateComputation<T>(node: Computation<T>): void {
  if (!node.fn) return;
  cleanNode(node);
  const owner = Owner,
    listener = Listener,
    time = ExecCount;
  Listener = Owner = node;
  runComputation(node, node.value, time);
  Listener = listener;
  Owner = owner;
}

function runComputation<T>(node: Computation<T>, value: T, time: number): void {
  let nextValue: T;
  nextValue = node.fn(value);
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue, true);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}

function createComputation<T>(
  fn: (value?: T) => T,
  init: T | undefined,
  pure: boolean,
  state: number = STALE,
): Computation<T> {
  const c: Computation<T> = {
    fn,
    state: state,
    updatedAt: null,
    owned: null,
    sources: [],
    sourceSlots: [],
    cleanups: null,
    value: init as T,
    owner: Owner,
    context: null,
    pure,
    observers: [],
    observerSlots: [],
  };
  if (Owner === null) {
  } // No-op, original code had a semicolon here
  else if (Owner !== UNOWNED) {
    if (!Owner.owned) Owner.owned = [c];
    else Owner.owned.push(c);
  }
  return c;
}

function runTop(node: Computation<any>): void {
  if (node.state === 0) return;
  if (node.state === PENDING) return lookUpstream(node);
  const ancestors: Computation<any>[] = [node];
  let currentNode: OwnerNode | null = node; // Use a new variable for traversal
  while (
    (currentNode = currentNode!.owner) &&
    (!(currentNode as Computation<any>)!.updatedAt ||
      (currentNode as Computation<any>)!.updatedAt! < ExecCount)
  ) {
    if (currentNode!.state) ancestors.push(currentNode as Computation<any>); // Type assertion
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestorNode = ancestors[i]; // Use a new variable for clarity
    if (ancestorNode.state === STALE) {
      updateComputation(ancestorNode);
    } else if (ancestorNode.state === PENDING) {
      const updates = Updates;
      Updates = null;
      lookUpstream(ancestorNode);
      Updates = updates;
    }
  }
}

function runUpdates<T>(fn: () => T, init: boolean): T {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;
  else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!ERROR) ERROR = err as Error;
    throw err;
  } finally {
    Updates = null;
    if (!wait && !ERROR)
      Effects = null; // Don't clear effects if an error occurred and we are init
    else if (!wait && ERROR && init) Effects = null; // Clear effects if an error occurred during init
  }
}

function completeUpdates(wait: boolean): void {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  const e = Effects;
  Effects = null;
  if (e && e.length) runUpdates(() => runEffects(e), false);
}

function runQueue(queue: Computation<any>[]): void {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}

function lookUpstream(node: Computation<any>): void {
  node.state = 0;
  if (!node.sources) return; // Add a check for sources
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i] as Signal<any> | Computation<any>; // Type assertion
    if (source.sources) {
      // Check if source is a Computation
      if (source.state === STALE) runTop(source as Computation<any>);
      else if (source.state === PENDING)
        lookUpstream(source as Computation<any>);
    }
  }
}

function markDownstream(node: Computation<any>): void {
  if (!node.observers) return; // Add a check for observers
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (!o.state) {
      o.state = PENDING;
      if (o.pure) Updates!.push(o);
      else Effects!.push(o);
      if (o.observers) markDownstream(o); // Check if o.observers exists
    }
  }
}

function cleanNode(node: OwnerNode): void {
  let i: number;
  if ((node as Computation<unknown>).sources) {
    const n2 = node as Computation<unknown>;
    while (n2.sources!.length) {
      const source = n2.sources!.pop() as Signal<any> | Computation<any>, // Type assertion
        index = n2.sourceSlots!.pop() as number, // Type assertion and non-null assertion
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop() as Computation<any>, // Type assertion
          s = source.observerSlots!.pop() as number; // Type assertion and non-null assertion
        if (index < obs.length) {
          n.sourceSlots![s] = index; // Non-null assertion
          obs[index] = n;
          source.observerSlots![index] = s; // Non-null assertion
        }
      }
    }
  }
  if (node.owned) {
    for (i = 0; i < node.owned.length; i++) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = 0; i < node.cleanups.length; i++) node.cleanups[i]();
    node.cleanups = null;
  }
  node.state = 0;
  node.context = null;
}
export { createComputed, createMemo, createRoot, createSignal, batch, untrack }; // Added untrack
