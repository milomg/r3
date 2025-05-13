export const enum ReactiveFlags {
  None = 0,
  Check = 1 << 0,
  Dirty = 1 << 1,
  RecomputingDeps = 1 << 2,
  InHeap = 1 << 3,
}

export interface Link {
  dep: Signal<unknown> | Computed<unknown>;
  sub: Computed<unknown>;
  prevDep: Link | null;
  nextDep: Link | null;
  prevSub: Link | null;
  nextSub: Link | null;
}

export interface Signal<T> {
  subs: Link | null;
  subsTail: Link | null;
  value: T;
}

export interface Computed<T> extends Signal<T> {
  deps: Link | null;
  depsTail: Link | null;
  flags: ReactiveFlags;
  height: number;
  nextHeap: Computed<unknown>;
  prevHeap: Computed<unknown>;
  fn: () => T;
}

let markedHeap = false;
let context: Computed<unknown> | null = null;

let minDirty = 0;
let maxDirty = 0;
const dirtyHeap: (Computed<unknown> | undefined)[] = new Array(2000);
export function increaseHeapSize(n: number) {
  if (n > dirtyHeap.length) {
    dirtyHeap.length = n;
  }
}

function insertIntoHeap(n: Computed<unknown>) {
  const flags = n.flags;
  if (flags & ReactiveFlags.InHeap) return;
  n.flags = flags | ReactiveFlags.InHeap;
  const height = n.height;
  const newHStart = dirtyHeap[height];
  if (newHStart == null) {
    dirtyHeap[height] = n;
  } else {
    newHStart.prevHeap.nextHeap = n;
    n.prevHeap = newHStart.prevHeap;
    newHStart.prevHeap = n;
    n.nextHeap = newHStart;
  }
  if (height > maxDirty) {
    maxDirty = height;
  }
}

function deleteFromHeap(n: Computed<unknown>) {
  const flags = n.flags;
  if (!(flags & ReactiveFlags.InHeap)) return;
  n.flags = flags & ~ReactiveFlags.InHeap;
  const height = n.height;
  if (n.prevHeap === n) {
    dirtyHeap[height] = undefined;
  } else {
    if (n === dirtyHeap[height]) {
      dirtyHeap[height] = n.nextHeap;
    }
    n.prevHeap.nextHeap = n.nextHeap;
    n.nextHeap.prevHeap = n.prevHeap;
  }
  n.prevHeap = n;
  n.nextHeap = n;
}

export function computed<T>(fn: () => T): Computed<T> {
  const self: Computed<T> = {
    height: 0,
    nextHeap: null as any,
    prevHeap: null as any,
    deps: null,
    depsTail: null,
    subs: null,
    subsTail: null,
    flags: ReactiveFlags.None,
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
    subs: null,
    subsTail: null,
  };
  return self;
}

function recompute(el: Computed<unknown>) {
  const oldcontext = context;
  context = el;
  deleteFromHeap(el);
  el.depsTail = null;
  el.flags = ReactiveFlags.RecomputingDeps;
  const value = el.fn();
  el.flags = ReactiveFlags.None;

  const depsTail = el.depsTail as Link | null;
  let toRemove = depsTail !== null ? depsTail.nextDep : el.deps;
  while (toRemove !== null) {
    toRemove = unlink(toRemove, el);
  }

  context = oldcontext;
  if (value !== el.value) {
    el.value = value;

    for (let s = el.subs; s; s = s.nextSub) {
      const o = s.sub;
      const flags = o.flags;
      if (flags & ReactiveFlags.Check) {
        o.flags = flags | ReactiveFlags.Dirty;
      }
      insertIntoHeap(o);
    }
  }
}

function updateIfNecessary(el: Computed<unknown>): void {
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
    recompute(el);
  }

  el.flags = ReactiveFlags.None;
}

function unlink(link: Link, sub = link.sub): Link | null {
  const dep = link.dep;
  const prevDep = link.prevDep;
  const nextDep = link.nextDep;
  const nextSub = link.nextSub;
  const prevSub = link.prevSub;
  if (nextDep !== null) {
    nextDep.prevDep = prevDep;
  } else {
    sub.depsTail = prevDep;
  }
  if (prevDep !== null) {
    prevDep.nextDep = nextDep;
  } else {
    sub.deps = nextDep;
  }
  if (nextSub !== null) {
    nextSub.prevSub = prevSub;
  } else {
    dep.subsTail = prevSub;
  }
  if (prevSub !== null) {
    prevSub.nextSub = nextSub;
  } else {
    dep.subs = nextSub;
  }
  return nextDep;
}

function link(
  dep: Signal<unknown> | Computed<unknown>,
  sub: Computed<unknown>
) {
  const prevDep = sub.depsTail;
  if (prevDep !== null && prevDep.dep === dep) {
    return;
  }
  let nextDep: Link | null = null;
  nextDep = prevDep !== null ? prevDep.nextDep : sub.deps;
  if (nextDep !== null && nextDep.dep === dep) {
    sub.depsTail = nextDep;
    return;
  }

  const prevSub = dep.subsTail;
  if (
    prevSub !== null &&
    prevSub.sub === sub &&
    (!(sub.flags & ReactiveFlags.RecomputingDeps) || isValidLink(prevSub, sub))
  ) {
    return;
  }
  const newLink =
    (sub.depsTail =
    dep.subsTail =
      {
        dep,
        sub,
        prevDep,
        nextDep,
        prevSub,
        nextSub: null,
      });
  if (nextDep !== null) {
    nextDep.prevDep = newLink;
  }
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

function isValidLink(checkLink: Link, sub: Computed<unknown>): boolean {
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
      if (el.height >= context.height) {
        context.height = el.height + 1;
      }
      if (
        el.height >= minDirty ||
        el.flags & (ReactiveFlags.Dirty | ReactiveFlags.Check)
      ) {
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
    let link = el.subs;
    while (link) {
      insertIntoHeap(link.sub);
      link = link.nextSub;
    }
  }
}

function markNode(el: Computed<unknown>, newState = ReactiveFlags.Dirty) {
  const flags = el.flags;
  if ((flags & (ReactiveFlags.Check | ReactiveFlags.Dirty)) >= newState) return;
  el.flags = flags | newState;

  let link = el.subs;
  while (link) {
    markNode(link.sub, ReactiveFlags.Check);
    link = link.nextSub;
  }
}

function markHeap() {
  if (markedHeap) return;
  markedHeap = true;
  for (let i = 0; i <= maxDirty; i++) {
    const head = dirtyHeap[i];
    if (head !== undefined) {
      let el = head;
      do {
        markNode(el);
        el = el.nextHeap;
      } while (el !== head);
    }
  }
}

export function stabilize() {
  for (minDirty = 0; minDirty <= maxDirty; minDirty++) {
    for (let el = dirtyHeap[minDirty]; el; el = dirtyHeap[minDirty]) {
      recompute(el);
    }
  }
}
