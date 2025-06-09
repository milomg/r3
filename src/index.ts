export interface Disposable {
  (): void;
}

export const enum ReactiveFlags {
  None = 0,
  Check = 1 << 0,
  Dirty = 1 << 1,
  RecomputingDeps = 1 << 2,
  InHeap = 1 << 3,
}

export const enum AsyncFlags {
  None = 0,
  Pending = 1 << 0,
  Error = 1 << 1,
  Uninitialized = 1 << 2,
}

export interface Link {
  dep: Signal<any> | Computed<any>;
  sub: Computed<any>;
  nextDep: Link | null;
  prevSub: Link | null;
  nextSub: Link | null;
}

export interface Signal<T> {
  subs: Link | null;
  subsTail: Link | null;
  value: T;
  asyncFlags: AsyncFlags;
  error: Error | null;
  time: number;
}

export interface Computed<T> extends Signal<T> {
  deps: Link | null;
  depsTail: Link | null;
  flags: ReactiveFlags;
  height: number;
  nextHeap: Computed<any> | undefined;
  prevHeap: Computed<any>;
  disposal: Disposable | Disposable[] | null;
  fn: (prev?: T) => T;
}

export class NotReadyError extends Error {}

let markedHeap = false;
let context: Computed<any> | null = null;

let minDirty = 0;
let maxDirty = 0;
const dirtyHeap: (Computed<any> | undefined)[] = new Array(2000);
export function increaseHeapSize(n: number) {
  if (n > dirtyHeap.length) {
    dirtyHeap.length = n;
  }
}

let clock = 0;
let stale = false;
let pendingCheck: { value: boolean };

function insertIntoHeap<T>(n: Computed<T>) {
  const flags = n.flags;
  if (flags & ReactiveFlags.InHeap) return;
  n.flags = flags | ReactiveFlags.InHeap;
  const height = n.height;
  const heapAtHeight = dirtyHeap[height];
  if (heapAtHeight === undefined) {
    dirtyHeap[height] = n;
  } else {
    const tail = heapAtHeight.prevHeap;
    tail.nextHeap = n;
    n.prevHeap = tail;
    heapAtHeight.prevHeap = n;
  }
  if (height > maxDirty) {
    maxDirty = height;
  }
}

function deleteFromHeap<T>(n: Computed<T>) {
  const flags = n.flags;
  if (!(flags & ReactiveFlags.InHeap)) return;
  n.flags = flags & ~ReactiveFlags.InHeap;
  const height = n.height;
  if (n.prevHeap === n) {
    dirtyHeap[height] = undefined;
  } else {
    const next = n.nextHeap;
    const dhh = dirtyHeap[height]!;
    if (n === dhh) {
      dirtyHeap[height] = next;
    }
    const end = next ?? dhh;
    end.prevHeap = n.prevHeap;
    n.prevHeap.nextHeap = next;
  }
  n.prevHeap = n;
  n.nextHeap = undefined;
}

export function computed<T>(fn: (prev?: T) => T): Computed<T>;
export function computed<T>(fn: (prev: T) => T, initialValue: T): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T,
  initialValue?: T
): Computed<T> {
  const self: Computed<T> = {
    disposal: null,
    fn: fn,
    value: initialValue as T,
    height: 0,
    nextHeap: undefined,
    prevHeap: null as any,
    deps: null,
    depsTail: null,
    subs: null,
    subsTail: null,
    flags: ReactiveFlags.None,
    asyncFlags: AsyncFlags.Uninitialized,
    error: null,
    time: clock,
  };
  self.prevHeap = self;
  if (context) {
    if (context.depsTail === null) {
      self.height = context.height;
      recompute(self, false);
    } else {
      self.height = context.height + 1;
      insertIntoHeap(self);
    }
    link(self, context);
  } else {
    recompute(self, false);
  }

  return self;
}

export function asyncComputed<T>(
  asyncFn: (prev?: T) => T | Promise<T> | AsyncIterable<T>
): Computed<T>;
export function asyncComputed<T>(
  asyncFn: (prev: T) => T | Promise<T> | AsyncIterable<T>,
  initialValue: T
): Computed<T>;
export function asyncComputed<T>(
  asyncFn: (prev?: T) => T | Promise<T> | AsyncIterable<T>,
  initialValue?: T
): Computed<T> {
  const fn = (prev?: T) => {
    const result = asyncFn(prev);
    const isPromise = result instanceof Promise;
    // @ts-expect-error
    const iterator = result[Symbol.asyncIterator];
    if (!isPromise && !iterator) {
      return result as T;
    }
    let aborted = false;
    onCleanup(() => (aborted = true));

    if (isPromise) {
      const t = runningTransaction;
      result
        .then((v) => {
          if (aborted) return;
          if (t)
            runTransaction(() => {
              setSignal(self, v);
              stabilize();
            }, t);
          else {
            setSignal(self, v);
            stabilize();
          }
        })
        .catch((e) => {
          if (aborted) return;
          self.asyncFlags = AsyncFlags.Error | AsyncFlags.Uninitialized;
          self.error = e as Error;
          stabilize();
        });
    } else {
      (async () => {
        try {
          for await (let value of result as AsyncIterable<T>) {
            if (aborted) return;
            setSignal(self, value);
            stabilize();
          }
        } catch (error) {
          if (aborted) return;
          self.asyncFlags = AsyncFlags.Error | AsyncFlags.Uninitialized;
          self.error = error as Error;
          stabilize();
        }
      })();
    }
    throw new NotReadyError();
  };
  const self: Computed<T> = {
    disposal: null,
    fn: fn,
    value: initialValue as T,
    height: 0,
    nextHeap: undefined,
    prevHeap: null as any,
    deps: null,
    depsTail: null,
    subs: null,
    subsTail: null,
    flags: ReactiveFlags.None,
    asyncFlags: AsyncFlags.Uninitialized,
    error: null,
    time: clock,
  };
  self.prevHeap = self;
  if (context) {
    if (context.depsTail === null) {
      self.height = context.height;
      recompute(self, false);
    } else {
      self.height = context.height + 1;
      insertIntoHeap(self);
    }
    link(self, context);
  } else {
    recompute(self, false);
  }

  return self;
}

export function signal<T>(v: T): Signal<T> {
  const self: Signal<T> = {
    value: v,
    subs: null,
    subsTail: null,
    asyncFlags: AsyncFlags.None,
    error: null,
    time: clock,
  };
  return self;
}

function recompute<T>(el: Computed<T>, del: boolean) {
  if (del) {
    deleteFromHeap(el);
  } else {
    el.nextHeap = undefined;
    el.prevHeap = el;
  }

  runDisposal(el);
  const oldcontext = context;
  context = el;
  el.depsTail = null;
  el.flags = ReactiveFlags.RecomputingDeps;
  let value = el.value;
  el.time = clock;
  let prevAsyncFlags = el.asyncFlags;
  try {
    value = el.fn(value);
    el.asyncFlags = AsyncFlags.None;
    el.error = null;

    if (runningTransaction) {
      runningTransaction.pending.delete(el);
    }
  } catch (e) {
    if (e instanceof NotReadyError) {
      el.asyncFlags = (prevAsyncFlags & ~AsyncFlags.Error) | AsyncFlags.Pending;
      el.error = null;

      if (runningTransaction) {
        runningTransaction.pending.add(el);
      }
    } else {
      el.asyncFlags = AsyncFlags.Error | AsyncFlags.Uninitialized;
      el.error = e as Error;
    }
  }
  el.flags = ReactiveFlags.None;
  context = oldcontext;

  const depsTail = el.depsTail as Link | null;
  let toRemove = depsTail !== null ? depsTail.nextDep : el.deps;
  if (toRemove !== null) {
    do {
      toRemove = unlinkSubs(toRemove);
    } while (toRemove !== null);
    if (depsTail !== null) {
      depsTail.nextDep = null;
    } else {
      el.deps = null;
    }
  }

  const valueChanged = value !== el.value;
  const asyncFlagsChanged = el.asyncFlags !== prevAsyncFlags;

  if (valueChanged || asyncFlagsChanged) {
    if (runningTransaction) {
      runningTransaction.nodes.set(el, {
        value,
        flags: ReactiveFlags.None,
        asyncFlags: AsyncFlags.None,
        error: null,
        time: clock,
      });
    } else {
      el.value = value;
    }

    for (let s = el.subs; s !== null; s = s.nextSub) {
      const o = s.sub;
      const flags = o.flags;
      if (flags & ReactiveFlags.Check) {
        o.flags = flags | ReactiveFlags.Dirty;
      }
      insertIntoHeap(o);
    }
  }
}

function updateIfNecessary<T>(el: Computed<T>): void {
  if (el.flags & ReactiveFlags.Check) {
    for (let d = el.deps; d; d = d.nextDep) {
      const dep = d.dep;
      if ("fn" in dep) {
        updateIfNecessary(dep);
      }
      if (el.flags & ReactiveFlags.Dirty) {
        break;
      }
    }
  }

  if (el.flags & ReactiveFlags.Dirty) {
    recompute(el, true);
  }

  el.flags = ReactiveFlags.None;
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L100
function unlinkSubs(link: Link): Link | null {
  const dep = link.dep;
  const nextDep = link.nextDep;
  const nextSub = link.nextSub;
  const prevSub = link.prevSub;
  if (nextSub !== null) {
    nextSub.prevSub = prevSub;
  } else {
    dep.subsTail = prevSub;
  }
  if (prevSub !== null) {
    prevSub.nextSub = nextSub;
  } else {
    dep.subs = nextSub;
    if (nextSub === null && "fn" in dep) {
      unwatched(dep);
    }
  }
  return nextDep;
}

function unwatched<T>(el: Computed<T>) {
  deleteFromHeap(el);
  let dep = el.deps;
  while (dep !== null) {
    dep = unlinkSubs(dep);
  }
  el.deps = null;
  runDisposal(el);
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L52
function link<T>(dep: Signal<T> | Computed<T>, sub: Computed<T>) {
  const prevDep = sub.depsTail;
  if (prevDep !== null && prevDep.dep === dep) {
    return;
  }
  let nextDep: Link | null = null;
  const isRecomputing = sub.flags & ReactiveFlags.RecomputingDeps;
  if (isRecomputing) {
    nextDep = prevDep !== null ? prevDep.nextDep : sub.deps;
    if (nextDep !== null && nextDep.dep === dep) {
      sub.depsTail = nextDep;
      return;
    }
  }

  const prevSub = dep.subsTail;
  if (
    prevSub !== null &&
    prevSub.sub === sub &&
    (!isRecomputing || isValidLink(prevSub, sub))
  ) {
    return;
  }
  const newLink =
    (sub.depsTail =
    dep.subsTail =
      {
        dep,
        sub,
        nextDep,
        prevSub,
        nextSub: null,
      });
  if (prevDep !== null) {
    prevDep.nextDep = newLink;
  } else {
    sub.deps = newLink;
  }
  if (prevSub !== null) {
    prevSub.nextSub = newLink;
  } else {
    dep.subs = newLink;
  }
}

// https://github.com/stackblitz/alien-signals/blob/v2.0.3/src/system.ts#L284
function isValidLink<T>(checkLink: Link, sub: Computed<T>): boolean {
  const depsTail = sub.depsTail;
  if (depsTail !== null) {
    let link = sub.deps!;
    do {
      if (link === checkLink) {
        return true;
      }
      if (link === depsTail) {
        break;
      }
      link = link.nextDep!;
    } while (link !== null);
  }
  return false;
}

export function read<T>(el: Signal<T> | Computed<T>): T {
  if (context) {
    link(el, context);

    if ("fn" in el) {
      const height = el.height;
      if (height >= context.height) {
        context.height = height + 1;
      }
      if (
        height >= minDirty ||
        el.flags & (ReactiveFlags.Dirty | ReactiveFlags.Check)
      ) {
        markHeap();
        updateIfNecessary(el);
      }
    }
  }

  if (el.asyncFlags & AsyncFlags.Pending) {
    if (pendingCheck) pendingCheck.value = true;

    if (!stale || el.asyncFlags & AsyncFlags.Uninitialized)
      throw new NotReadyError();
  }
  if (el.asyncFlags & AsyncFlags.Error) {
    if (el.time < clock) {
      recompute(el as Computed<unknown>, false);
      return read(el);
    } else {
      throw el.error;
    }
  }

  if (runningTransaction) {
    if (runningTransaction.nodes.has(el)) {
      return runningTransaction.nodes.get(el)!.value;
    }
  }

  return el.value;
}

export function setSignal<T>(el: Signal<T>, v: T) {
  if (el.value === v && !el.asyncFlags) {
    return;
  }

  if (runningTransaction) {
    runningTransaction.nodes.set(el, {
      value: v,
      flags: ReactiveFlags.None,
      asyncFlags: AsyncFlags.None,
      error: null,
      time: clock,
    });
    runningTransaction.pending.delete(el);
  } else {
    el.value = v;
    el.asyncFlags = AsyncFlags.None;
    el.error = null;
    el.time = clock;
  }

  for (let link = el.subs; link !== null; link = link.nextSub) {
    markedHeap = false;
    insertIntoHeap(link.sub);
  }
}

function markNode<T>(el: Computed<T>, newState = ReactiveFlags.Dirty) {
  const flags = el.flags;
  if ((flags & (ReactiveFlags.Check | ReactiveFlags.Dirty)) >= newState) return;
  el.flags = flags | newState;
  for (let link = el.subs; link !== null; link = link.nextSub) {
    markNode(link.sub, ReactiveFlags.Check);
  }
}

function markHeap() {
  if (markedHeap) return;
  markedHeap = true;
  for (let i = 0; i <= maxDirty; i++) {
    for (let el = dirtyHeap[i]; el !== undefined; el = el.nextHeap) {
      markNode(el);
    }
  }
}

export function stabilize() {
  for (minDirty = 0; minDirty <= maxDirty; minDirty++) {
    let el = dirtyHeap[minDirty];
    dirtyHeap[minDirty] = undefined;
    while (el !== undefined) {
      const next = el.nextHeap;
      recompute(el, false);
      el = next;
    }
  }
  if (runningTransaction) {
    runningTransaction.commit();
  }
  clock++;
}

export function onCleanup(fn: Disposable): Disposable {
  if (!context) return fn;

  const node = context;

  if (!node.disposal) {
    node.disposal = fn;
  } else if (Array.isArray(node.disposal)) {
    node.disposal.push(fn);
  } else {
    node.disposal = [node.disposal, fn];
  }
  return fn;
}

function runDisposal<T>(node: Computed<T>): void {
  if (!node.disposal) return;

  if (Array.isArray(node.disposal)) {
    for (let i = 0; i < node.disposal.length; i++) {
      const callable = node.disposal[i];
      callable.call(callable);
    }
  } else {
    node.disposal.call(node.disposal);
  }

  node.disposal = null;
}

export function latest<T>(fn: () => T, fallback?: T): T {
  const prevStale = stale;
  stale = true;
  let result: T;
  try {
    result = fn();
  } catch (err) {
    if (err instanceof NotReadyError && arguments.length > 1) {
      return fallback as T;
    }
    throw err;
  } finally {
    stale = prevStale;
  }
  return result;
}

export function isPending(fn: () => any, fallback?: boolean): boolean {
  const prevPendingCheck = pendingCheck;
  pendingCheck = { value: false };
  try {
    latest(fn);
    return pendingCheck.value;
  } catch (e) {
    if (!(e instanceof NotReadyError)) return false;
    if (fallback !== undefined) return fallback!;
    throw e;
  } finally {
    pendingCheck = prevPendingCheck;
  }
}

type TransactionNode = {
  value: any;
  flags: ReactiveFlags;
  asyncFlags: AsyncFlags;
  error: Error | null;
  time: number;
};
export type Transaction = {
  pending: Set<Signal<any>>;
  nodes: Map<Signal<any>, TransactionNode>;
  commit: () => void;
};
let runningTransaction: Transaction | undefined;

function runTransaction<T>(fn: () => T, t: Transaction): T {
  const previousTransaction = runningTransaction;
  runningTransaction = t;
  try {
    return fn();
  } finally {
    runningTransaction = previousTransaction;
  }
}

export function createTransaction() {
  const transaction: Transaction = {
    pending: new Set(),
    nodes: new Map(),
    commit,
  };

  function run<T>(fn: () => T): T {
    return runTransaction(fn, transaction);
  }

  function commit() {
    if (!transaction.pending.size) {
      transaction.nodes.forEach((node, signal) => {
        signal.value = node.value;
        signal.asyncFlags = node.asyncFlags;
        signal.error = node.error;
        signal.time = node.time;
      });
    }
  }

  return [run] as const;
}
