/**
 * The awkward condition cases every engine must agree on.
 *
 * Shared by scripts/conditions-parity-smoke.mjs (JS vs Python) and
 * scripts/cpp-parity-smoke.mjs (JS vs the compiled C++ header), so a fix in one
 * engine cannot quietly skip the others.
 *
 * The JS engine is the reference: an unset or misspelled variable leaves a
 * condition unmet, and a type mismatch never ends the game.
 */
export const state = {
  playerName: "Parity",
  abilities: ["fly"],
  vars: {
    coins: 5,
    coinsText: "5",
    name: "bob",
    flag: true,
    off: false,
    zero: 0,
    blank: "",
    partial: "5abc",
    padded: " 7 ",
    nullVar: null,
  },
  history: [],
};

export const cases = [
  ["unset var + gte", { var: "gold", gte: 3 }],
  ["unset var + lte", { var: "gold", lte: 3 }],
  ["number var + gte met", { var: "coins", gte: 3 }],
  ["number var + gte unmet", { var: "coins", gte: 9 }],
  ["numeric string + gte", { var: "coinsText", gte: 3 }],
  ["non-numeric string + gte", { var: "name", gte: 3 }],
  ["blank string + gte", { var: "blank", gte: 0 }],
  ["partly numeric string + gte", { var: "partial", gte: 3 }],
  ["padded numeric string + gte", { var: "padded", gte: 7 }],
  ["bool var + gte", { var: "flag", gte: 1 }],
  ["zero + lte zero", { var: "zero", lte: 0 }],
  ["truthy false on zero", { var: "zero", truthy: false }],
  ["truthy true on flag", { var: "flag", truthy: true }],
  // An unset flag reads as "not true", which is how a story asks "have they
  // NOT done this yet?" before the variable exists.
  ["truthy false on unset var", { var: "gold", truthy: false }],
  ["truthy true on unset var", { var: "gold", truthy: true }],
  ["truthy true on number var", { var: "coins", truthy: true }],
  ["truthy false on false var", { var: "off", truthy: false }],
  ["truthy true on text var", { var: "name", truthy: true }],
  ["truthy false on blank string", { var: "blank", truthy: false }],
  ["eq string", { var: "name", eq: "bob" }],
  ["eq mismatch", { var: "name", eq: "bill" }],
  ["eq on unset var", { var: "gold", eq: 1 }],
  ["eq number vs numeric string", { var: "coinsText", eq: 5 }],
  ["bare var set", { var: "coins" }],
  ["bare var unset", { var: "gold" }],
  ["bare var on false", { var: "off" }],
  ["hasAbility met", { hasAbility: "fly" }],
  ["hasAbility unmet", { hasAbility: "swim" }],
  ["not over unset var", { not: { var: "gold", gte: 3 } }],
  ["all with unset var", { all: [{ hasAbility: "fly" }, { var: "gold", gte: 1 }] }],
  ["any with unset var", { any: [{ var: "gold", gte: 1 }, { hasAbility: "fly" }] }],
  ["nested not over truthy", { not: { var: "flag", truthy: false } }],
  // Explicit JSON null is Number(null)→0 in JS/C++; absent vars stay unmet.
  ["null var + gte 0", { var: "nullVar", gte: 0 }],
  ["null var + lte 0", { var: "nullVar", lte: 0 }],
  // Malformed all/any must not throw (C++: bad all→true, bad any→false).
  ["malformed all string", { all: "broken" }],
  ["malformed any string", { any: "broken" }],
  ["malformed all object", { all: { hasAbility: "fly" } }],
  ["empty all", { all: [] }],
  ["empty any", { any: [] }],
];
