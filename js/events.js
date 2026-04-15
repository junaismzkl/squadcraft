import { els } from "./dom.js?v=match-debug-v5";
import { authState, createAccountWithEmailPassword, saveCurrentProfile, signInWithEmailPassword, signOutCurrentUser } from "./auth.js?v=match-debug-v5";
import { loadSharedMatchesIntoState } from "./matchStore.js?v=match-debug-v5";
import { generateTeams, getMatchSettings, toggleSelectAllPlayers } from "./match.js?v=match-debug-v5";
import { loadSharedPlayersIntoState } from "./playerStore.js?v=match-debug-v5";
import { addScorerRow, openResultPanel, saveMatchResult, updateScoreFromScorers } from "./result.js?v=match-debug-v5";
import {
  addQuickGuest,
  cancelMatchCreation,
  createMatchAndReturnHome,
  goToLineupStep,
  goToMatchLandingStep,
  goToMatchTimeStep,
  goToPlayerSelectionStep,
  getImageUploadDraft,
  handleImageUploadChange,
  handleMatchScheduleChange,
  isImageUploadRemoved,
  clearManualSwapSelection,
  closeNotificationsPanel,
  openUserManagement,
  removeImageUpload,
  render,
  renderHistory,
  renderMatchSection,
  resetPlayerForm,
  savePlayerFromForm,
  setImageUploadValue,
  setActiveStatsTab,
  showPlayerForm,
  startMatchCreation,
  switchTab,
  triggerImageUpload,
  toggleNotificationsPanel,
  toggleGuestForm
} from "./ui.js?v=match-debug-v5";

export function bindEvents() {
  window.addEventListener("auth:changed", handleAuthChanged);
  window.addEventListener("match:sync-error", handleMatchSyncError);
  els.tabs.forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));
  els.notificationsToggle.addEventListener("click", toggleNotificationsPanel);
  els.accountMenuToggle?.addEventListener("click", toggleAccountMenu);
  els.accountSignIn?.addEventListener("click", openSignInModal);
  els.accountCreate?.addEventListener("click", openCreateAccountModal);
  els.accountProfile?.addEventListener("click", openProfileSetupModal);
  els.accountApprovals?.addEventListener("click", handleOpenApprovals);
  els.authModalClose?.addEventListener("click", closeAuthModal);
  els.authModal?.addEventListener("click", handleAuthModalBackdrop);
  els.authSignInForm?.addEventListener("submit", handleAuthLogin);
  els.authCreateForm?.addEventListener("submit", handleCreateAccount);
  els.authProfileForm?.addEventListener("submit", handleProfileSave);
  els.authProfileAvatar?.addEventListener("change", handleProfileAvatarChange);
  els.authProfileAvatarChange?.addEventListener("click", () => triggerImageUpload("profile"));
  els.authProfileAvatarRemove?.addEventListener("click", () => {
    removeImageUpload("profile");
    if (els.authProfileAvatarPreview) els.authProfileAvatarPreview.src = createProfilePlaceholder(els.authProfileName?.value || authState.currentAuthUser?.email || "User");
    setProfileMessage("Profile image will be removed when you save.");
  });
  els.authLogout?.addEventListener("click", handleAuthLogout);
  els.showPlayerForm.addEventListener("click", showPlayerForm);
  els.playerForm.addEventListener("submit", savePlayerFromForm);
  els.cancelEditPlayer.addEventListener("click", resetPlayerForm);
  els.quickGuestForm.addEventListener("submit", addQuickGuest);
  els.playerImage.addEventListener("change", () => handleImageUploadChange("player"));
  els.playerImageChange?.addEventListener("click", () => triggerImageUpload("player"));
  els.playerImageRemove?.addEventListener("click", () => removeImageUpload("player"));
  els.guestImage.addEventListener("change", () => handleImageUploadChange("guest"));
  els.guestImageChange?.addEventListener("click", () => triggerImageUpload("guest"));
  els.guestImageRemove?.addEventListener("click", () => removeImageUpload("guest"));
  setImageUploadValue("player", "");
  setImageUploadValue("guest", "");
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

function handleMatchSyncError(event) {
  const message = event.detail?.message || "Could not sync match to Supabase.";
  if (els.authMessage) els.authMessage.textContent = message;
  console.warn("Match Supabase sync failed.", event.detail);
}

async function handleAuthChanged() {
  if (authState.isAuthenticated) await loadSharedPlayersIntoState();
  await loadSharedMatchesIntoState();
  render();
}

function toggleAccountMenu() {
  const isOpen = els.accountMenu.classList.toggle("hidden");
  els.accountMenuToggle.setAttribute("aria-expanded", isOpen ? "false" : "true");
}

function openSignInModal() {
  openAuthModal("sign_in");
}

function openCreateAccountModal() {
  openAuthModal("create_account");
}

function openProfileSetupModal() {
  openAuthModal("profile");
}

async function handleOpenApprovals() {
  els.accountMenu.classList.add("hidden");
  els.accountMenuToggle.setAttribute("aria-expanded", "false");
  await openUserManagement();
}

function openAuthModal(mode) {
  els.accountMenu.classList.add("hidden");
  els.accountMenuToggle.setAttribute("aria-expanded", "false");
  els.authModal.classList.remove("hidden");
  setAuthModalMessage("");
  els.authSignInForm.classList.toggle("hidden", mode !== "sign_in");
  els.authCreateForm.classList.toggle("hidden", mode !== "create_account");
  els.authProfileForm.classList.toggle("hidden", mode !== "profile");
  els.authModalTitle.textContent = mode === "create_account" ? "Create Account" : mode === "profile" ? "Profile Setup" : "Sign In";
  if (mode === "profile") {
    populateProfileForm();
  }
}

function closeAuthModal() {
  els.authModal.classList.add("hidden");
}

function handleAuthModalBackdrop(event) {
  if (event.target === els.authModal) closeAuthModal();
}

async function handleAuthLogin(event) {
  event.preventDefault();
  const email = els.authEmail.value.trim();
  const password = els.authPassword.value;
  if (!email || !password) return;

  els.authLoginButton.disabled = true;
  const result = await signInWithEmailPassword(email, password);
  els.authLoginButton.disabled = false;

  if (!result.ok) {
    setAuthModalMessage(result.message || "Sign in failed.", true);
    render();
    return;
  }

  els.authPassword.value = "";
  if (authState.currentProfile && authState.currentProfile.approval_status !== "approved") closeAuthModal();
  else if (!authState.currentProfile?.name) openAuthModal("profile");
  else closeAuthModal();
  render();
}

async function handleCreateAccount(event) {
  event.preventDefault();
  const name = els.authCreateName.value.trim();
  const email = els.authCreateEmail.value.trim();
  const password = els.authCreatePassword.value;
  const confirmPassword = els.authCreateConfirm.value;

  if (!email || !password) return;
  if (password !== confirmPassword) {
    setAuthModalMessage("Passwords do not match.", true);
    return;
  }

  els.authCreateButton.disabled = true;
  const result = await createAccountWithEmailPassword({ email, password, name });
  els.authCreateButton.disabled = false;
  els.authMessage.textContent = result.message || "";
  setAuthModalMessage(result.message || "", !result.ok);

  if (!result.ok) {
    render();
    return;
  }

  els.authCreatePassword.value = "";
  els.authCreateConfirm.value = "";
  if (result.needsEmailConfirmation) {
    els.authCreateEmail.value = "";
    els.authCreateName.value = "";
    return;
  }
  closeAuthModal();
  render();
}

function setAuthModalMessage(message, isError = false) {
  if (!els.authModalMessage) return;
  els.authModalMessage.textContent = message || "";
  els.authModalMessage.classList.toggle("hidden", !message);
  els.authModalMessage.classList.toggle("error", Boolean(isError));
}

async function handleProfileSave(event) {
  event.preventDefault();
  const name = els.authProfileName.value.trim();
  if (!name) {
    setProfileMessage("Name is required.", true);
    return;
  }

  els.authProfileSave.disabled = true;
  const profilePayload = {
    name,
    displayName: els.authProfileDisplayName?.value.trim() || "",
    primaryPosition: els.authProfilePrimaryPosition?.value || "",
    secondaryPosition: els.authProfileSecondaryPosition?.value || "",
    thirdPosition: els.authProfileThirdPosition?.value || "",
    dominantFoot: els.authProfileDominantFoot?.value || "",
    jerseyNumber: els.authProfileJerseyNumber?.value || ""
  };
  const profileAvatarDraft = getImageUploadDraft("profile");
  if (isImageUploadRemoved("profile")) {
    profilePayload.avatarUrl = "";
  } else if (profileAvatarDraft) {
    profilePayload.avatarUrl = profileAvatarDraft;
  }
  const result = await saveCurrentProfile(profilePayload);
  els.authProfileSave.disabled = false;

  if (!result.ok) {
    render();
    setProfileMessage(result.message || "Could not save profile.", true);
    return;
  }
  await loadSharedPlayersIntoState();
  render();
  populateProfileForm();
  setProfileMessage(result.message || "Profile saved.");
}

async function handleProfileAvatarChange(event) {
  await handleImageUploadChange("profile");
  const draft = getImageUploadDraft("profile");
  if (draft && els.authProfileAvatarPreview) els.authProfileAvatarPreview.src = draft;
  if (draft) setProfileMessage("Profile image ready to save.");
}

function populateProfileForm() {
  const profile = authState.currentProfile || {};
  const email = authState.currentAuthUser?.email || "";
  const avatar = profile.avatar_url || "";

  if (els.authProfileName) els.authProfileName.value = profile.name || "";
  if (els.authProfileDisplayName) els.authProfileDisplayName.value = profile.display_name || profile.name || "";
  if (els.authProfilePrimaryPosition) els.authProfilePrimaryPosition.value = profile.primary_position || "";
  if (els.authProfileSecondaryPosition) els.authProfileSecondaryPosition.value = profile.secondary_position || "";
  if (els.authProfileThirdPosition) els.authProfileThirdPosition.value = profile.third_position || "";
  if (els.authProfileDominantFoot) els.authProfileDominantFoot.value = profile.dominant_foot || "";
  if (els.authProfileJerseyNumber) els.authProfileJerseyNumber.value = profile.jersey_number ?? "";
  if (els.authProfileEmail) els.authProfileEmail.textContent = email || "Signed in";
  if (els.authProfileRole) els.authProfileRole.textContent = formatRoleLabel(profile.role || "user");
  if (els.authProfileAvatar) els.authProfileAvatar.value = "";
  if (els.authProfileAvatarPreview) {
    els.authProfileAvatarPreview.src = avatar || createProfilePlaceholder(profile.name || email || "User");
  }
  setImageUploadValue("profile", avatar);
  setProfileMessage("Role is controlled by admins. Add a display name and primary position to complete your player profile.");
}

function setProfileMessage(message, isError = false) {
  if (!els.authProfileMessage) return;
  els.authProfileMessage.textContent = message;
  els.authProfileMessage.classList.toggle("error", isError);
}

function formatRoleLabel(role) {
  return String(role || "user")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createProfilePlaceholder(name) {
  const initial = encodeURIComponent(String(name || "U").trim().charAt(0).toUpperCase() || "U");
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='48' fill='%23111827'/%3E%3Ccircle cx='48' cy='48' r='45' fill='none' stroke='%23d6bf74' stroke-width='3'/%3E%3Ctext x='48' y='59' text-anchor='middle' font-size='34' font-family='Arial,sans-serif' font-weight='700' fill='%23d6bf74'%3E${initial}%3C/text%3E%3C/svg%3E`;
}

async function handleAuthLogout() {
  els.authLogout.disabled = true;
  await signOutCurrentUser();
  els.authLogout.disabled = false;
  els.accountMenu.classList.add("hidden");
  render();
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
  if (!els.accountMenu?.classList.contains("hidden")) {
    const isAccountClick = els.accountMenu.contains(event.target) || els.accountMenuToggle.contains(event.target);
    if (!isAccountClick) {
      els.accountMenu.classList.add("hidden");
      els.accountMenuToggle.setAttribute("aria-expanded", "false");
    }
  }
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
