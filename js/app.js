import { initAuth } from "./auth.js";
import { bindEvents } from "./events.js";
import { initState } from "./state.js";
import { initUI } from "./ui.js";

export async function init() {
  try {
    initState();
    await initAuth();
    initUI();
    bindEvents();
  } catch (error) {
    console.error("Failed to initialize app.", error);
  }
}

init();
