import { authState, initAuth } from "./auth.js";
import { bindEvents } from "./events.js";
import { loadSharedMatchesIntoState, syncMatchToSupabase } from "./matchStore.js";
import { loadSharedPlayersIntoState } from "./playerStore.js";
import { initState } from "./state.js";
import { initUI } from "./ui.js";

export async function init() {
  try {
    initState();
    await initAuth();
    if (authState.isAuthenticated) await loadSharedPlayersIntoState();
    if (authState.isAuthenticated) await loadSharedMatchesIntoState();
    window.addEventListener("match:local-persisted", (event) => {
      syncMatchToSupabase(event.detail?.match);
    });
    initUI();
    bindEvents();
  } catch (error) {
    console.error("Failed to initialize app.", error);
  }
}

init();
