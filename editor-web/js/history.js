/** Snapshot stack for undo/redo of scenes graph. */
export class HistoryStack {
  constructor(limit = 50) {
    this.limit = limit;
    this.stack = [];
    this.index = -1;
  }

  snapshot(scenes, startId, label = "") {
    const json = JSON.stringify({ scenes, startId });
    if (this.index >= 0 && this.stack[this.index]?.json === json) return;
    this.stack = this.stack.slice(0, this.index + 1);
    this.stack.push({ json, label, at: Date.now() });
    if (this.stack.length > this.limit) this.stack.shift();
    this.index = this.stack.length - 1;
  }

  canUndo() {
    return this.index > 0;
  }

  canRedo() {
    return this.index >= 0 && this.index < this.stack.length - 1;
  }

  undo() {
    if (!this.canUndo()) return null;
    this.index -= 1;
    return JSON.parse(this.stack[this.index].json);
  }

  redo() {
    if (!this.canRedo()) return null;
    this.index += 1;
    return JSON.parse(this.stack[this.index].json);
  }
}
