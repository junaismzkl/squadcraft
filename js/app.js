import { authState, initAuth } from "./auth.js";
import { bindEvents } from "./events.js";
import { loadSharedMatchesIntoState, syncMatchToSupabase } from "./matchStore.js";
import { loadSharedPlayersIntoState } from "./playerStore.js";
import { initState } from "./state.js";
import { initUI, render } from "./ui.js";

export async function init() {
  try {
    initState();
    await initAuth();
    if (authState.isAuthenticated) await loadSharedPlayersIntoState();
    if (authState.isAuthenticated) await loadSharedMatchesIntoState();
    window.addEventListener("match:local-persisted", async (event) => {
      const result = await syncMatchToSupabase(event.detail?.match);
      if (!result.ok) return;
      await loadSharedMatchesIntoState();
      render();
    });
    initUI();
    bindEvents();
  } catch (error) {
    console.error("Failed to initialize app.", error);
  }
}

init();
