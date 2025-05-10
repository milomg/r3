export const enum ReactiveFlags {
  None = 0,
  Check = 1 << 0,
  Dirty = 1 << 1,
  Pushed = 1 << 2,
}

export interface Link {
  dep: Signal<unknown> | Computed<unknown>;
  sub: Computed<unknown>;
  prevDep: Link | undefined;
  nextDep: Link | undefined;
  prevSub: Link | undefined;
  nextSub: Link | undefined;
}

export interface Signal<T> {
  subs: Link | undefined;
  subsTail: Link | undefined;
  value: T;
}

export interface Computed<T> extends Signal<T> {
  deps: Link | undefined;
  depsTail: Link | undefined;
  flags: ReactiveFlags;
  height: number;
  nextHeap: Computed<unknown>;
  prevHeap: Computed<unknown>;
  fn: () => T;
}

let markedHeap = false;
let context: Computed<unknown> | null = null;

let stabilizeHeight = 0;
let maxHeightInHeap = 0;
const heap: (Computed<unknown> | undefined)[] = new Array(2000);
export function increaseHeapSize(n: number) {
  if (n > heap.length) {
    heap.length = n;
  }
}

function insertIntoHeap(n: Computed<unknown>) {
  if (n.flags & ReactiveFlags.Pushed) return;
  n.flags |= ReactiveFlags.Pushed;
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
    heap[n.height] = undefined;
  } else {
    n.prevHeap.nextHeap = n.nextHeap;
    n.nextHeap.prevHeap = n.prevHeap;
  }
  n.prevHeap = n;
  n.nextHeap = n;
  n.flags &= ~ReactiveFlags.Pushed;
}

export function computed<T>(fn: () => T): Computed<T> {
  const self: Computed<T> = {
    height: 0,
    nextHeap: null as any,
    prevHeap: null as any,
    deps: undefined,
    depsTail: undefined,
    subs: undefined,
    subsTail: undefined,
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
    subs: undefined,
    subsTail: undefined,
  };
  return self;
}

function recompute(el: Computed<unknown>) {
  const oldcontext = context;
  context = el;
  deleteFromHeap(el);
  el.depsTail = undefined;
  el.flags = ReactiveFlags.None;
  const value = el.fn();

  const depsTail = el.depsTail as Link | undefined;
  let toRemove = depsTail !== undefined ? depsTail.nextDep : el.deps;
  while (toRemove !== undefined) {
    toRemove = unlink(toRemove, el);
  }

  context = oldcontext;
  if (value !== el.value) {
    el.value = value;

    for (let s = el.subs; s; s = s.nextSub) {
      const o = s.sub;
      if (o.flags & ReactiveFlags.Check) {
        o.flags |= ReactiveFlags.Dirty;
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
        updateIfNecessary(dep)
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

function unlink(link: Link, sub = link.sub): Link | undefined {
  const dep = link.dep;
  const prevDep = link.prevDep;
  const nextDep = link.nextDep;
  const nextSub = link.nextSub;
  const prevSub = link.prevSub;
  if (nextDep !== undefined) {
    nextDep.prevDep = prevDep;
  } else {
    sub.depsTail = prevDep;
  }
  if (prevDep !== undefined) {
    prevDep.nextDep = nextDep;
  } else {
    sub.deps = nextDep;
  }
  if (nextSub !== undefined) {
    nextSub.prevSub = prevSub;
  } else {
    dep.subsTail = prevSub;
  }
  if (prevSub !== undefined) {
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
  if (prevDep !== undefined && prevDep.dep === dep) {
    return;
  }
  let nextDep: Link | undefined = undefined;
  nextDep = prevDep !== undefined ? prevDep.nextDep : sub.deps;
  if (nextDep !== undefined && nextDep.dep === dep) {
    sub.depsTail = nextDep;
    return;
  }

  const prevSub = dep.subsTail;
  if (
    prevSub !== undefined &&
    prevSub.sub === sub &&
    isValidLink(prevSub, sub)
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
        nextSub: undefined,
      });
  if (nextDep !== undefined) {
    nextDep.prevDep = newLink;
  }
  if (prevDep !== undefined) {
    prevDep.nextDep = newLink;
  } else {
    sub.deps = newLink;
  }
  if (prevSub !== undefined) {
    prevSub.nextSub = newLink;
  } else {
    dep.subs = newLink;
  }
}

function isValidLink(checkLink: Link, sub: Computed<unknown>): boolean {
  const depsTail = sub.depsTail;
  if (depsTail !== undefined) {
    let link = sub.deps!;
    do {
      if (link === checkLink) {
        return true;
      }
      if (link === depsTail) {
        break;
      }
      link = link.nextDep!;
    } while (link !== undefined);
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
        el.height >= stabilizeHeight ||
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
  if ((el.flags & (ReactiveFlags.Check | ReactiveFlags.Dirty)) > newState)
    return;
  el.flags |= newState;

  let link = el.subs;
  while (link) {
    const sub = link.sub;
    if (isValidLink(link, sub)) {
      markNode(sub, ReactiveFlags.Check);
    }
    link = link.nextSub;
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
