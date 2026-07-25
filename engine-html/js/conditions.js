/** Evaluate choice/scene conditions against runtime state. */
export function evalWhen(when, state) {
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
