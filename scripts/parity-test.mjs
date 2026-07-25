#!/usr/bin/env node
/**
 * Headless parity runner — walks a choice script and asserts scene/ability state.
 * Usage:
 *   node illustrated-if-studio/scripts/parity-test.mjs
 *   node illustrated-if-studio/scripts/parity-test.mjs path/to/fixture.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const studioRoot = path.resolve(__dirname, "..");

// Inline condition eval (keep in sync with engine-html/js/conditions.js)
function evalWhen(when, state) {
  if (!when) return true;
  if (when.hasAbility) return state.abilities.includes(when.hasAbility);
  if (when.var != null) {
    const left = state.vars[when.var];
    if (Object.prototype.hasOwnProperty.call(when, "eq")) return left === when.eq;
    if (Object.prototype.hasOwnProperty.call(when, "gte")) return Number(left) >= Number(when.gte);
    if (Object.prototype.hasOwnProperty.call(when, "lte")) return Number(left) <= Number(when.lte);
    if (Object.prototype.hasOwnProperty.call(when, "truthy")) return Boolean(left) === Boolean(when.truthy);
    return left != null;
  }
  if (when.not) return !evalWhen(when.not, state);
  if (when.all) return when.all.every((w) => evalWhen(w, state));
  if (when.any) return when.any.some((w) => evalWhen(w, state));
  return true;
}

function loadProject(projectDir) {
  const project = JSON.parse(fs.readFileSync(path.join(projectDir, "project.json"), "utf8"));
  const scenesDoc = JSON.parse(fs.readFileSync(path.join(projectDir, project.story.scenes), "utf8"));
  return { project, scenes: scenesDoc.scenes || scenesDoc };
}

function runScript({ project, scenes }, steps, expect) {
  const state = {
    playerName: "Parity",
    abilities: [],
    vars: {},
    history: [],
    currentScene: project.start,
  };

  const visit = (id, choiceText = null) => {
    const scene = scenes[id];
    if (!scene) throw new Error(`Missing scene: ${id}`);
    state.currentScene = id;
    state.history.push({ id, choice: choiceText });
    if (scene.unlockAbility && !state.abilities.includes(scene.unlockAbility)) {
      state.abilities.push(scene.unlockAbility);
    }
    if (scene.set) Object.assign(state.vars, scene.set);
    return scene;
  };

  visit(project.start);

  for (const step of steps) {
    const scene = scenes[state.currentScene];
    const visible = (scene.choices || []).filter((c) => evalWhen(c.when, state));
    let choice;
    if (typeof step === "number") {
      choice = visible[step];
      if (!choice) throw new Error(`No visible choice index ${step} at ${state.currentScene}`);
    } else if (typeof step === "string") {
      choice = visible.find((c) => c.text === step || c.next === step);
      if (!choice) {
        throw new Error(
          `No visible choice "${step}" at ${state.currentScene}. Visible: ${visible.map((c) => c.text).join(" | ")}`
        );
      }
    } else {
      throw new Error(`Bad step: ${JSON.stringify(step)}`);
    }
    if (choice.set) Object.assign(state.vars, choice.set);
    visit(choice.next, choice.text);
  }

  if (expect?.scene && state.currentScene !== expect.scene) {
    throw new Error(`Expected scene ${expect.scene}, got ${state.currentScene}`);
  }
  if (expect?.abilities) {
    for (const a of expect.abilities) {
      if (!state.abilities.includes(a)) throw new Error(`Missing ability: ${a}`);
    }
  }
  if (expect?.historyLength != null && state.history.length !== expect.historyLength) {
    throw new Error(`Expected history length ${expect.historyLength}, got ${state.history.length}`);
  }
  return state;
}

const defaultFixture = {
  name: "sample-curiosity-gate",
  project: path.join(studioRoot, "projects", "sample-project"),
  steps: [
    "Step into the workshop",
    "Take the key and return",
    "Follow the garden path",
    "Open the gate with your curiosity",
  ],
  expect: {
    scene: "ending",
    abilities: ["curiosity"],
  },
};

const secondFixture = {
  name: "sample-look-around",
  project: path.join(studioRoot, "projects", "sample-project"),
  steps: ["Look around"],
  expect: { scene: "look_around" },
};

async function main() {
  const fixturePath = process.argv[2];
  const fixtures = fixturePath
    ? [JSON.parse(fs.readFileSync(fixturePath, "utf8"))]
    : [defaultFixture, secondFixture];

  let failed = 0;
  for (const fix of fixtures) {
    const projectDir = path.isAbsolute(fix.project)
      ? fix.project
      : path.resolve(fixturePath ? path.dirname(path.resolve(fixturePath)) : studioRoot, fix.project);
    try {
      const loaded = loadProject(projectDir);
      const state = runScript(loaded, fix.steps, fix.expect);
      console.log(`PASS ${fix.name} → ${state.currentScene} abilities=[${state.abilities.join(", ")}]`);
    } catch (err) {
      failed++;
      console.error(`FAIL ${fix.name}: ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

main();
