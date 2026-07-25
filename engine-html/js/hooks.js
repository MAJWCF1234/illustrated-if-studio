/** Named hooks referenced from story/scripts.json — no inline functions in JSON. */
export function createHookTable(ui) {
  return {
    look_around_rename_speaker() {
      clearTimeout(createHookTable._lookAroundTimer);
      createHookTable._lookAroundTimer = setTimeout(() => {
        if (ui.getCurrentSceneId() === "look_around") {
          ui.setSpeaker("EmmaLee");
        }
      }, 3000);
    },
  };
}
