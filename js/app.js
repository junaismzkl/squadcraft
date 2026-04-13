import { bindEvents } from "./events.js";
import { initState } from "./state.js";
import { initUI } from "./ui.js";

export function init() {
  try {
    initState();
    initUI();
    bindEvents();
  } catch (error) {
    console.error("Failed to initialize app.", error);
  }
}

init();
