import { autoLayout, collectInbound } from "./layout.js";

const NODE_W = 150;
const NODE_H = 52;

export class GraphView {
  constructor(svg, { onSelect, onConnect }) {
    this.svg = svg;
    this.world = svg.querySelector("#graph-world");
    this.onSelect = onSelect;
    this.onConnect = onConnect;
    this.positions = {};
    this.scale = 1;
    this.panX = 80;
    this.panY = 200;
    this.selected = null;
    this._drag = null;
    this._pan = null;
    this._link = null;
    this._scenes = {};
    this._startId = "start";
    this.bind();
  }

  bind() {
    this.svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.scale = Math.min(2.5, Math.max(0.25, this.scale * delta));
      this.applyTransform();
    }, { passive: false });

    this.svg.addEventListener("mousedown", (e) => {
      if (e.target.closest(".node") || e.target.closest(".port")) return;
      this._pan = { x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
      this.svg.classList.add("dragging");
    });

    window.addEventListener("mousemove", (e) => {
      if (this._pan) {
        this.panX = this._pan.panX + (e.clientX - this._pan.x);
        this.panY = this._pan.panY + (e.clientY - this._pan.y);
        this.applyTransform();
      }
      if (this._drag) {
        const pt = this.clientToWorld(e.clientX, e.clientY);
        this.positions[this._drag.id] = {
          x: pt.x - this._drag.ox,
          y: pt.y - this._drag.oy,
        };
        this.draw(this._scenes, this._startId);
      }
      if (this._link) {
        const pt = this.clientToWorld(e.clientX, e.clientY);
        this._link.x2 = pt.x;
        this._link.y2 = pt.y;
        this.draw(this._scenes, this._startId);
      }
    });

    window.addEventListener("mouseup", (e) => {
      if (this._link) {
        const target = e.target.closest?.(".node");
        const toId = target?.dataset?.id || this.hitTestNode(e.clientX, e.clientY);
        const fromId = this._link.fromId;
        this._link = null;
        this.draw(this._scenes, this._startId);
        if (toId && toId !== fromId) this.onConnect?.(fromId, toId);
      }
      this._pan = null;
      this._drag = null;
      this.svg.classList.remove("dragging");
    });
  }

  hitTestNode(cx, cy) {
    const pt = this.clientToWorld(cx, cy);
    for (const [id, pos] of Object.entries(this.positions)) {
      if (pt.x >= pos.x && pt.x <= pos.x + NODE_W && pt.y >= pos.y && pt.y <= pos.y + NODE_H) {
        return id;
      }
    }
    return null;
  }

  clientToWorld(cx, cy) {
    const rect = this.svg.getBoundingClientRect();
    return {
      x: (cx - rect.left - this.panX) / this.scale,
      y: (cy - rect.top - this.panY) / this.scale,
    };
  }

  applyTransform() {
    this.world.setAttribute("transform", `translate(${this.panX} ${this.panY}) scale(${this.scale})`);
  }

  ensurePositions(scenes, startId) {
    const missing = Object.keys(scenes).some((id) => !this.positions[id]);
    if (missing || !Object.keys(this.positions).length) {
      this.positions = autoLayout(scenes, startId);
    }
    for (const id of Object.keys(this.positions)) {
      if (!scenes[id]) delete this.positions[id];
    }
  }

  layout(scenes, startId) {
    this.positions = autoLayout(scenes, startId);
    this.draw(scenes, startId);
    this.fit();
  }

  fit() {
    const vals = Object.values(this.positions);
    if (!vals.length) return;
    const xs = vals.map((p) => p.x);
    const ys = vals.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs) + NODE_W;
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys) + NODE_H;
    const rect = this.svg.getBoundingClientRect();
    const pad = 60;
    const sx = (rect.width - pad * 2) / Math.max(1, maxX - minX);
    const sy = (rect.height - pad * 2) / Math.max(1, maxY - minY);
    this.scale = Math.min(1.2, Math.max(0.3, Math.min(sx, sy)));
    this.panX = pad - minX * this.scale + (rect.width - pad * 2 - (maxX - minX) * this.scale) / 2;
    this.panY = pad - minY * this.scale + (rect.height - pad * 2 - (maxY - minY) * this.scale) / 2;
    this.applyTransform();
  }

  select(id) {
    this.selected = id;
  }

  draw(scenes, startId) {
    this._scenes = scenes;
    this._startId = startId;
    this.ensurePositions(scenes, startId);
    const inbound = collectInbound(scenes);
    const frag = document.createDocumentFragment();

    for (const [id, scene] of Object.entries(scenes)) {
      const from = this.positions[id];
      if (!from) continue;
      for (const c of scene.choices || []) {
        const broken = !c.next || !scenes[c.next];
        const to = c.next && this.positions[c.next];
        if (!to && !broken) continue;
        const x1 = from.x + NODE_W;
        const y1 = from.y + NODE_H / 2;
        const x2 = to ? to.x : x1 + 80;
        const y2 = to ? to.y + NODE_H / 2 : y1;
        const mx = (x1 + x2) / 2;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
        path.setAttribute("class", `edge${c.when ? " gated" : ""}${broken ? " broken" : ""}`);
        frag.appendChild(path);

        if (c.text) {
          const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          label.setAttribute("class", "edge-label");
          label.setAttribute("x", mx);
          label.setAttribute("y", (y1 + y2) / 2 - 4);
          label.setAttribute("text-anchor", "middle");
          label.textContent = c.text.length > 22 ? c.text.slice(0, 20) + "…" : c.text;
          frag.appendChild(label);
        }
      }
    }

    if (this._link) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const { x1, y1, x2, y2 } = this._link;
      const mx = (x1 + x2) / 2;
      path.setAttribute("d", `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
      path.setAttribute("class", "edge linking");
      frag.appendChild(path);
    }

    for (const [id, scene] of Object.entries(scenes)) {
      const pos = this.positions[id] || { x: 0, y: 0 };
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      const isDead = !(scene.choices || []).length;
      const isStart = id === startId;
      g.setAttribute(
        "class",
        `node${isStart ? " start" : ""}${isDead ? " dead" : ""}${this.selected === id ? " selected" : ""}`
      );
      g.setAttribute("transform", `translate(${pos.x} ${pos.y})`);
      g.dataset.id = id;

      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", NODE_W);
      rect.setAttribute("height", NODE_H);
      g.appendChild(rect);

      const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
      title.setAttribute("x", 10);
      title.setAttribute("y", 20);
      title.textContent = id.length > 16 ? id.slice(0, 14) + "…" : id;
      g.appendChild(title);

      const sub = document.createElementNS("http://www.w3.org/2000/svg", "text");
      sub.setAttribute("class", "sub");
      sub.setAttribute("x", 10);
      sub.setAttribute("y", 38);
      const bits = [];
      if (scene.speaker) bits.push(scene.speaker);
      bits.push(`${(scene.choices || []).length} choices`);
      if (inbound[id] === 0 && !isStart) bits.push("orphan");
      sub.textContent = bits.join(" · ").slice(0, 28);
      g.appendChild(sub);

      // outbound connect port
      const port = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      port.setAttribute("class", "port");
      port.setAttribute("cx", NODE_W);
      port.setAttribute("cy", NODE_H / 2);
      port.setAttribute("r", 6);
      port.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        this._link = {
          fromId: id,
          x1: pos.x + NODE_W,
          y1: pos.y + NODE_H / 2,
          x2: pos.x + NODE_W + 20,
          y2: pos.y + NODE_H / 2,
        };
        this.selected = id;
        this.onSelect?.(id);
      });
      g.appendChild(port);

      g.addEventListener("mousedown", (e) => {
        if (e.target.classList?.contains("port")) return;
        e.stopPropagation();
        const pt = this.clientToWorld(e.clientX, e.clientY);
        this._drag = {
          id,
          ox: pt.x - pos.x,
          oy: pt.y - pos.y,
        };
        this.selected = id;
        this.onSelect?.(id);
        this.draw(scenes, startId);
      });

      frag.appendChild(g);
    }

    this.world.replaceChildren(frag);
    this.applyTransform();
  }
}
