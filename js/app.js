import { authState, initAuth } from "./auth.js?v=match-debug-v5";
import { bindEvents } from "./events.js?v=match-debug-v5";
import { loadSharedMatchesIntoState, syncMatchToSupabase } from "./matchStore.js?v=match-debug-v5";
import { loadSharedPlayersIntoState } from "./playerStore.js?v=match-debug-v5";
import { initState } from "./state.js?v=match-debug-v5";
import { initUI, render } from "./ui.js?v=match-debug-v5";

const MATCH_DEBUG_VERSION = "match-debug-v5";

export async function init() {
  try {
    initState();
    await initAuth();
    if (authState.isAuthenticated) await loadSharedPlayersIntoState();
    if (authState.isAuthenticated) await loadSharedMatchesIntoState();
    window.addEventListener("match:local-persisted", async (event) => {
      const match = event.detail?.match;
      console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] match:local-persisted received`, {
        matchId: match?.id || "",
        location: match?.location || "",
        teamAPlayers: match?.teamAPlayers?.length || match?.teamA?.length || 0,
        teamBPlayers: match?.teamBPlayers?.length || match?.teamB?.length || 0
      });
      const result = await syncMatchToSupabase(event.detail?.match);
      console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] syncMatchToSupabase result`, {
        ok: result.ok,
        message: result.message || "",
        matchId: result.match?.id || match?.id || ""
      });
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
