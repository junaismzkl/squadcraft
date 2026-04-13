export const STORAGE_KEY = "localFootballManager.v1";

export function loadMatches() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    console.error("Failed to load matches from localStorage.", error);
    return null;
  }
}

export function saveMatches(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error("Failed to save matches to localStorage.", error);
  }
}
