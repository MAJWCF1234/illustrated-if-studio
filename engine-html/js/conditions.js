/** Evaluate choice/scene conditions against runtime state. */
export function evalWhen(when, state) {
  if (!when || typeof when !== "object") return true;
  if (when.hasAbility) {
    return Array.isArray(state.abilities) && state.abilities.includes(when.hasAbility);
  }
  if (when.var != null) {
    const left = state.vars?.[when.var];
    if (Object.prototype.hasOwnProperty.call(when, "eq")) return left === when.eq;
    if (Object.prototype.hasOwnProperty.call(when, "gte")) return Number(left) >= Number(when.gte);
    if (Object.prototype.hasOwnProperty.call(when, "lte")) return Number(left) <= Number(when.lte);
    if (Object.prototype.hasOwnProperty.call(when, "truthy")) return Boolean(left) === Boolean(when.truthy);
    return left != null;
  }
  if (when.not) return !evalWhen(when.not, state);
  // Malformed all/any must not throw mid-scene (matches C++: bad all → true, bad any → false).
  if (Object.prototype.hasOwnProperty.call(when, "all")) {
    return Array.isArray(when.all) ? when.all.every((w) => evalWhen(w, state)) : true;
  }
  if (Object.prototype.hasOwnProperty.call(when, "any")) {
    return Array.isArray(when.any) ? when.any.some((w) => evalWhen(w, state)) : false;
  }
  return true;
}
