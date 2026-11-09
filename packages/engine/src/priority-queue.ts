// std::priority_queue<pair<float,int>, vector<...>, greater<>> ordering.
export class PairMinHeap {
  values: [number, number][] = [];
  private less(a: [number, number], b: [number, number]): boolean { return a[0] < b[0] || a[0] === b[0] && a[1] < b[1]; }
  push(entry: [number, number]): void { let at = this.values.length; this.values.push(entry); while (at > 0) { const parent = Math.floor((at - 1) / 2); if (!this.less(entry, this.values[parent])) break; this.values[at] = this.values[parent]; at = parent; } this.values[at] = entry; }
  pop(): [number, number] { const first = this.values[0], tail = this.values.pop()!; if (this.values.length) { let at = 0; while (at * 2 + 1 < this.values.length) { let child = at * 2 + 1; if (child + 1 < this.values.length && this.less(this.values[child + 1], this.values[child])) ++child; if (!this.less(this.values[child], tail)) break; this.values[at] = this.values[child]; at = child; } this.values[at] = tail; } return first; }
  empty(): boolean { return !this.values.length; }
  clear(): void { this.values.length = 0; }
}
