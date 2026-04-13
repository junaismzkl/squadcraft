import { els } from "./dom.js";
import { generateTeams, getMatchSettings, toggleSelectAllPlayers } from "./match.js";
import { addScorerRow, openResultPanel, saveMatchResult, updateScoreFromScorers } from "./result.js";
import {
  addQuickGuest,
  cancelMatchCreation,
  changeCurrentUser,
  createMatchAndReturnHome,
  goToLineupStep,
  goToMatchLandingStep,
  goToMatchTimeStep,
  goToPlayerSelectionStep,
  handleImageUploadChange,
  handleMatchScheduleChange,
  clearManualSwapSelection,
  closeNotificationsPanel,
  render,
  renderHistory,
  renderMatchSection,
  resetPlayerForm,
  savePlayerFromForm,
  setActiveStatsTab,
  showPlayerForm,
  startMatchCreation,
  switchTab,
  toggleNotificationsPanel,
  toggleGuestForm
} from "./ui.js";

export function bindEvents() {
  els.tabs.forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  els.notificationsToggle.addEventListener("click", toggleNotificationsPanel);
  els.currentUserSelect?.addEventListener("change", (event) => changeCurrentUser(event.target.value));
  els.showPlayerForm.addEventListener("click", showPlayerForm);
  els.playerForm.addEventListener("submit", savePlayerFromForm);
  els.cancelEditPlayer.addEventListener("click", resetPlayerForm);
  els.quickGuestForm.addEventListener("submit", addQuickGuest);
  els.playerImage.addEventListener("change", () => handleImageUploadChange("player"));
  els.guestImage.addEventListener("change", () => handleImageUploadChange("guest"));
  els.guestToggle.addEventListener("click", toggleGuestForm);
  els.createNewMatch.addEventListener("click", startMatchCreation);
  els.matchBackToLanding.addEventListener("click", goToMatchLandingStep);
  els.matchNextToPlayers.addEventListener("click", handleMatchStepNext);
  els.matchBackToTime.addEventListener("click", goToMatchTimeStep);
  els.matchBackToSelection.addEventListener("click", goToPlayerSelectionStep);
  els.cancelMatchButtons.forEach((button) => button.addEventListener("click", handleCancelMatch));
  els.createMatch.addEventListener("click", handleCreateMatch);
  els.matchDate.addEventListener("input", handleMatchTimeChange);
  els.matchDate.addEventListener("change", handleMatchTimeChange);
  [els.matchStartHour, els.matchStartMinute, els.matchStartPeriod, els.matchEndHour, els.matchEndMinute, els.matchEndPeriod]
    .forEach((select) => {
      select.addEventListener("input", handleMatchTimeChange);
      select.addEventListener("change", handleMatchTimeChange);
    });
  els.matchEndPlus30.addEventListener("click", () => handleQuickEndTimeAdjust(30));
  els.matchEndPlus60.addEventListener("click", () => handleQuickEndTimeAdjust(60));
  els.selectAllPlayers.addEventListener("click", () => {
    toggleSelectAllPlayers();
    render();
  });
  els.generateTeams.addEventListener("click", () => handleGenerateTeams(false));
  els.reshuffleTeams.addEventListener("click", () => handleGenerateTeams(true));
  els.forcedGenerationContinue.addEventListener("click", handleForcedGenerationContinue);
  els.forcedGenerationCancel.addEventListener("click", closeForcedGenerationPrompt);
  els.enterResult.addEventListener("click", () => {
    if (!openResultPanel()) return;
    renderMatchSection();
    els.resultForm.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.resultForm.addEventListener("submit", (event) => {
    if (!saveMatchResult(event, els)) return;
    render();
    switchTab("match");
  });
  els.autoScore.addEventListener("change", () => updateScoreFromScorers(els));
  els.teamAScore.addEventListener("input", () => updateScoreFromScorers(els));
  els.teamBScore.addEventListener("input", () => updateScoreFromScorers(els));
  els.addTeamAScorer.addEventListener("click", () => addScorerRow(els, "a"));
  els.addTeamBScorer.addEventListener("click", () => addScorerRow(els, "b"));
  els.statsTabs.forEach((button) => {
    button.addEventListener("click", () => setActiveStatsTab(button.dataset.statsTab));
  });
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("live-match:updated", handleLiveMatchUpdate);
}

let pendingForcedGeneration = null;

function handleMatchTimeChange() {
  handleMatchScheduleChange(getMatchScheduleValue());
}

function handleGenerateTeams(reshuffle, options = {}) {
  clearManualSwapSelection();
  const result = generateTeams(getMatchScheduleValue(), reshuffle, options);
  if (!result.ok) {
    if (result.needsFallbackConfirmation) {
      openForcedGenerationPrompt(result, reshuffle);
      return;
    }

    els.teamBalanceNote.textContent = result.message;
    return;
  }

  closeForcedGenerationPrompt();
  els.teamAScore.value = "0";
  els.teamBScore.value = "0";
  els.reshuffleTeams.disabled = false;
  goToLineupStep();
  renderMatchSection();
  renderHistory();
}

function openForcedGenerationPrompt(result, reshuffle) {
  pendingForcedGeneration = { reshuffle };
  els.forcedGenerationMessage.textContent =
    `No supported ${result.teamSize}v${result.teamSize} formation can be filled using only primary or secondary exact positions. You can still create teams using best possible placement. Some players may be assigned out of position.`;
  els.teamBalanceNote.textContent = result.message;
  els.forcedGenerationModal.classList.remove("hidden");
}

function closeForcedGenerationPrompt() {
  pendingForcedGeneration = null;
  els.forcedGenerationModal.classList.add("hidden");
}

function handleForcedGenerationContinue() {
  const pending = pendingForcedGeneration;
  if (!pending) return;
  handleGenerateTeams(pending.reshuffle, { forceFallback: true });
}

function handleLiveMatchUpdate() {
  renderMatchSection();
  renderHistory();
}

function handleDocumentClick(event) {
  if (els.notificationsPanel.classList.contains("hidden")) return;
  if (els.notificationsPanel.contains(event.target) || els.notificationsToggle.contains(event.target)) return;
  closeNotificationsPanel();
}

function getMatchScheduleValue() {
  return [els.matchDate.value, getSelectedTimeValue("start"), getSelectedTimeValue("end")].join("|");
}

function handleMatchStepNext() {
  const settings = getMatchSettings(getMatchScheduleValue());
  if (!settings.ok) {
    els.teamBalanceNote.textContent = settings.message;
    return;
  }
  goToPlayerSelectionStep();
  renderMatchSection();
}

function handleCancelMatch() {
  cancelMatchCreation();
}

function handleCreateMatch() {
  createMatchAndReturnHome();
}

function handleQuickEndTimeAdjust(minutes) {
  const startTime = getSelectedTimeValue("start");
  if (!startTime) return;
  applyOffsetToEndTime(startTime, minutes);
  handleMatchTimeChange();
}

function applyOffsetToEndTime(startTime, minutes) {
  const [hours = "00", mins = "00"] = startTime.split(":");
  const value = new Date(2000, 0, 1, Number(hours) || 0, Number(mins) || 0, 0, 0);
  value.setMinutes(value.getMinutes() + minutes);
  const nextHours = String(value.getHours()).padStart(2, "0");
  const nextMinutes = String(value.getMinutes()).padStart(2, "0");
  const nextTime = to12HourParts(`${nextHours}:${nextMinutes}`);
  els.matchEndHour.value = nextTime.hour12;
  els.matchEndMinute.value = nextTime.minute;
  els.matchEndPeriod.value = nextTime.period;
}

function getSelectedTimeValue(prefix) {
  const hour = prefix === "start" ? els.matchStartHour.value : els.matchEndHour.value;
  const minute = prefix === "start" ? els.matchStartMinute.value : els.matchEndMinute.value;
  const period = prefix === "start" ? els.matchStartPeriod.value : els.matchEndPeriod.value;
  return to24HourTime(hour, minute, period);
}

function to24HourTime(hour, minute, period) {
  const safeHour = Number(hour) || 12;
  const safeMinute = String(minute || "00").padStart(2, "0");
  let hours24 = safeHour % 12;
  if (period === "PM") hours24 += 12;
  return `${String(hours24).padStart(2, "0")}:${safeMinute}`;
}

function to12HourParts(time24) {
  const [hours = "00", minutes = "00"] = String(time24).split(":");
  const hourValue = Number(hours) || 0;
  const period = hourValue >= 12 ? "PM" : "AM";
  const hour12Value = hourValue % 12 || 12;
  return {
    hour12: String(hour12Value).padStart(2, "0"),
    minute: String(minutes).padStart(2, "0"),
    period
  };
}
