// Match comparator-equivalent ordering in the captured GCC/libstdc++ std::sort.
// JS Array.sort is stable; native candidate ordering uses median-pivot introsort.
// This independent TypeScript implementation is checked against a compiled native oracle.
export function nativeSort<T>(values: T[], less: (a: T, b: T) => boolean): void {
  const swap = (a: number, b: number) => {
    const held = values[a];
    values[a] = values[b];
    values[b] = held;
  };
  const insert = (at: number) => {
    const held = values[at];
    let cursor = at;
    while (less(held, values[cursor - 1])) {
      values[cursor] = values[cursor - 1];
      --cursor;
    }
    values[cursor] = held;
  };
  const insertion = (from: number, to: number) => {
    for (let at = from + 1; at < to; ++at) {
      if (less(values[at], values[from])) {
        const held = values[at];
        for (let cursor = at; cursor > from; --cursor) values[cursor] = values[cursor - 1];
        values[from] = held;
      } else insert(at);
    }
  };
  const adjust = (from: number, hole: number, length: number, held: T) => {
    const top = hole;
    let child = hole;
    while (child < Math.trunc((length - 1) / 2)) {
      child = 2 * (child + 1);
      if (less(values[from + child], values[from + child - 1])) --child;
      values[from + hole] = values[from + child];
      hole = child;
    }
    if (length % 2 === 0 && child === Math.trunc((length - 2) / 2)) {
      child = 2 * (child + 1);
      values[from + hole] = values[from + child - 1];
      hole = child - 1;
    }
    let parent = Math.trunc((hole - 1) / 2);
    while (hole > top && less(values[from + parent], held)) {
      values[from + hole] = values[from + parent];
      hole = parent;
      parent = Math.trunc((hole - 1) / 2);
    }
    values[from + hole] = held;
  };
  const heap = (from: number, to: number) => {
    let length = to - from;
    if (length < 2) return;
    for (let parent = Math.trunc((length - 2) / 2); parent >= 0; --parent)
      adjust(from, parent, length, values[from + parent]);
    while (length > 1) {
      --length;
      const held = values[from + length];
      values[from + length] = values[from];
      adjust(from, 0, length, held);
    }
  };
  const loop = (from: number, to: number, depth: number) => {
    while (to - from > 16) {
      if (depth === 0) {
        heap(from, to);
        return;
      }
      --depth;
      const a = from + 1,
        b = from + Math.trunc((to - from) / 2),
        c = to - 1;
      const median = less(values[a], values[b])
        ? less(values[b], values[c])
          ? b
          : less(values[a], values[c])
            ? c
            : a
        : less(values[a], values[c])
          ? a
          : less(values[b], values[c])
            ? c
            : b;
      swap(from, median);
      let left = from + 1,
        right = to;
      while (true) {
        while (less(values[left], values[from])) ++left;
        --right;
        while (less(values[from], values[right])) --right;
        if (left >= right) break;
        swap(left, right);
        ++left;
      }
      loop(left, to, depth);
      to = left;
    }
  };
  if (!values.length) return;
  loop(0, values.length, Math.floor(Math.log2(values.length)) * 2);
  const first = Math.min(values.length, 16);
  insertion(0, first);
  for (let at = first; at < values.length; ++at) insert(at);
}
