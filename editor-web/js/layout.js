/** Layered BFS layout from start scene. */
export function autoLayout(scenes, startId) {
  const ids = Object.keys(scenes);
  const positions = {};
  const visited = new Set();
  const levels = new Map();
  const queue = [];

  const root = scenes[startId] ? startId : ids[0];
  if (!root) return positions;

  queue.push(root);
  levels.set(root, 0);
  visited.add(root);

  while (queue.length) {
    const id = queue.shift();
    const level = levels.get(id);
    for (const c of scenes[id]?.choices || []) {
      const next = c.next;
      if (!next || !scenes[next] || visited.has(next)) continue;
      visited.add(next);
      levels.set(next, level + 1);
      queue.push(next);
    }
  }

  // orphans
  for (const id of ids) {
    if (!levels.has(id)) levels.set(id, -1);
  }

  const byLevel = new Map();
  for (const [id, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(id);
  }

  const xGap = 220;
  const yGap = 90;
  for (const [level, list] of [...byLevel.entries()].sort((a, b) => a[0] - b[0])) {
    list.sort();
    const x = level < 0 ? -260 : level * xGap;
    list.forEach((id, i) => {
      const y = (i - (list.length - 1) / 2) * yGap;
      positions[id] = { x, y };
    });
  }
  return positions;
}

export function collectInbound(scenes) {
  const inbound = Object.fromEntries(Object.keys(scenes).map((id) => [id, 0]));
  for (const scene of Object.values(scenes)) {
    for (const c of scene.choices || []) {
      if (c.next && inbound[c.next] != null) inbound[c.next]++;
    }
  }
  return inbound;
}
