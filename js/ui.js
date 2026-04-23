import { els } from "./dom.js?v=match-debug-v5";
import { approveUserProfile, authState, canApproveUsers, canManageRoles, isApprovedProfile, loadPendingProfiles, updateUserRole } from "./auth.js?v=match-debug-v5";
import { generateLineupPositions } from "./formation.js?v=match-debug-v5";
import { clearLiveTimer, renderLiveMatch } from "./liveMatch.js?v=match-debug-v5";
import { deleteSharedMatch } from "./matchStore.js?v=match-debug-v5";
import { createClaimableProfile, deactivateProfilePlayer, loadSharedPlayersIntoState, updateProfilePlayerDetails, updateProfilePlayerRole } from "./playerStore.js?v=match-debug-v5";
import {
  getMatchSettings,
  normalizeCaptains,
  normalizeTeamFormations,
  resetAppData,
  setCaptain,
  updateFormationOptions,
  validateSelectedPlayersForMatch
} from "./match.js?v=match-debug-v5";
import {
  appendPitchPlayers,
  createPitchCard,
  renderCompletedMatchSummary,
  renderFormationSelectors,
  renderPitchSurface,
  renderTeamHeaders
} from "./pitchRenderer.js?v=match-debug-v5";
import {
  openResultPanel,
  markCurrentMatchPendingResult,
  renderMotmOptions,
  renderResultSection
} from "./result.js?v=match-debug-v5";
import {
  addPlayer,
  addNotification,
  addSelectedPlayerId,
  addMatchGuestPlayer,
  canApprovePlayer,
  canDeleteMatch,
  canDeletePlayer,
  canEditMatch,
  canEditPlayer,
  canManagePlayers,
  canRatePlayer,
  clearTeams,
  clearMatchGuestPlayers,
  clearSelectedPlayerIds,
  createDefaultPlayerStats,
  DEFAULT_AVATAR,
  filterSelectedPlayerIds,
  getNotifications,
  getPlayerStats,
  getPlayerPositions,
  getPrimaryPosition,
  getMatchStatus,
  getMatchResult,
  getMatchMetadata,
  getLiveMatch,
  getCurrentUser,
  getUserName,
  hasPermission,
  isPendingResultMatch,
  isGoalkeeperPlayer,
  isCompletedMatch,
  isLiveMatch,
  isUpcomingMatch,
  managerHistoryTeam,
  matchDateTime,
  matchEndTime,
  matchStartTimeValue,
  matchStartTime,
  matchResultText,
  motmName,
  markNotificationsReadForMatch,
  persist,
  logActivity,
  removeMatch,
  removeMatchGuestPlayer,
  removeNotification,
  removePlayer,
  removeSelectedPlayerId,
  resetDerivedStats,
  restoreUpcomingMatch,
  roles,
  scorersText,
  serializeCurrentMatch,
  setMatches,
  setPlayers,
  persistCurrentMatch,
  syncNotificationsWithMatches,
  state,
  updateTeams
} from "./state.js?v=match-debug-v5";
import { balanceLabel, goalkeeperNote, regenerateTeamLineup, teamRating } from "./teamGenerator.js?v=match-debug-v5";
import { clampRating, escapeHtml, formatDate, readFileAsDataUrl, resizeImageDataUrl } from "./utils.js?v=match-debug-v5";

let matchStatusRefreshId = null;
let matchWizardStep = 0;
let homeFeedbackMessage = "";
let showAllHomeUpcomingMatches = false;
let isPlayerFormVisible = false;
let isEditingMatch = false;
let isManagePlayersMode = false;
let editActionMode = null;
let activeEditSelection = null;
let editActionMessage = "";
let showLiveMatchScreen = true;
let activeStatsTab = "goals";
let editingMatchSnapshot = null;
let originalEditingMatchId = "";
let hasPendingMatchEdits = false;
let notificationsOpen = false;
const claimResultState = {
  playerName: "",
  username: "",
  claimCode: "",
  claimLink: ""
};
const imageDrafts = {
  profile: "",
  player: "",
  guest: ""
};
const imageRemoved = {
  profile: false,
  player: false,
  guest: false
};
const imagePreviewState = {
  target: "",
  pending: "",
  source: "",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  baseWidth: 0,
  baseHeight: 0,
  naturalWidth: 0,
  naturalHeight: 0,
  frameSize: 0,
  dragPointerId: null,
  dragStartX: 0,
  dragStartY: 0,
  dragOriginX: 0,
  dragOriginY: 0
};

const MATCH_DEBUG_VERSION = "match-debug-v5";

export function render() {
  if (!state.isReady) return;
  try {
    filterSelectedPlayerIds((id) => state.data.players.some((player) => player.id === id && player.approvalStatus === "approved"));
    renderAuthState();
    if (renderPendingApprovalView()) return;
    renderHome();
    renderPlayers();
    renderMatchSection();
    renderStats();
    renderHistory();
    renderNotifications();
  } catch (error) {
    console.error("Failed to render app UI.", error);
  }
}

export function clearManualSwapSelection() {
  clearEditActionMode();
}

export function renderHome() {
  els.homeUpcomingMatch.innerHTML = "";
  renderHomeFeedback();
  const liveMatch = getLiveMatch();
  const upcomingMatches = getHomeUpcomingMatches();

  if (!liveMatch && !upcomingMatches.length) {
    els.homeUpcomingMatch.appendChild(emptyState("No upcoming matches", "Create a match to see it here."));
    return;
  }

  if (liveMatch) {
    const card = document.createElement("article");
    card.className = "home-match-card";
    card.innerHTML = `
      <div>
        <p class="eyebrow">Live now</p>
        <h2>${escapeHtml(liveMatch.teamAName || "Team A")} vs ${escapeHtml(liveMatch.teamBName || "Team B")}</h2>
        <p>${formatReadableMatchWindow(liveMatch)}</p>
      </div>
      <button class="primary" type="button">Open Live Match</button>
    `;
    card.querySelector("button").addEventListener("click", () => {
      restoreUpcomingMatch(liveMatch);
      showLiveMatchScreen = true;
      switchTab("match");
      render();
    });
    els.homeUpcomingMatch.appendChild(card);
  }

  if (!upcomingMatches.length) return;

  const section = document.createElement("section");
  section.className = "match-upcoming-section";
  section.innerHTML = `
    <div class="history-section-header">
      <h3>Upcoming Matches</h3>
      ${upcomingMatches.length > 3 && !showAllHomeUpcomingMatches ? '<button class="secondary compact-button" type="button">View All</button>' : ""}
    </div>
    <div class="match-upcoming-list"></div>
  `;

  if (upcomingMatches.length > 3 && !showAllHomeUpcomingMatches) {
    section.querySelector("button").addEventListener("click", () => {
      showAllHomeUpcomingMatches = true;
      renderHome();
    });
  }

  const list = section.querySelector(".match-upcoming-list");
  const visibleMatches = showAllHomeUpcomingMatches ? upcomingMatches : upcomingMatches.slice(0, 3);
  visibleMatches.forEach((match, index) => {
    const card = createUpcomingMatchCard(match, {
      isNextMatch: index === 0,
      onView: () => {
        openMatchInViewMode(match, { switchTab: true });
      }
    });
    list.appendChild(card);
  });

  els.homeUpcomingMatch.appendChild(section);
}

export function switchTab(tabName) {
  if (tabName === "match" && !state.currentTeams) {
    resetMatchSetupState();
  }
  els.tabs.forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
  els.panels.forEach((panel) => panel.classList.toggle("active", panel.id === `${tabName}-panel`));
}

function renderAuthState() {
  const profile = authState.currentProfile;
  const hasSession = Boolean(authState.isAuthenticated);
  const hasProfile = Boolean(profile);
  const visibleAccountName = profile?.display_name
    || profile?.name
    || profile?.login_username
    || authState.currentAuthUser?.email
    || "Signed in";

  if (els.accountMenuUser) {
    const roleLabel = profile?.role ? ` - ${formatRoleLabel(profile.role)}` : "";
    els.accountMenuUser.textContent = hasSession
      ? `${visibleAccountName}${roleLabel}`
      : "Account";
  }

  els.accountSignIn?.classList.toggle("hidden", hasSession);
  els.accountCreate?.classList.toggle("hidden", hasSession);
  els.accountProfile?.classList.toggle("hidden", !hasSession || !isApprovedProfile());
  els.accountApprovals?.classList.toggle("hidden", !canApproveUsers());
  els.authLogout?.classList.toggle("hidden", !hasSession);

  if (els.authMessage) {
    if (authState.error) {
      els.authMessage.textContent = authState.error;
    } else if (hasSession && !hasProfile) {
      els.authMessage.textContent = "Signed in, but no profile row was found.";
    } else {
      els.authMessage.textContent = "";
    }
  }
}

function renderPendingApprovalView() {
  const shouldGate = authState.isAuthenticated && !isApprovedProfile();
  els.authGate?.classList.toggle("hidden", !shouldGate);
  els.appMain?.classList.toggle("hidden", shouldGate);

  if (!shouldGate) {
    if (els.authGate) els.authGate.innerHTML = "";
    return false;
  }

  const profile = authState.currentProfile;
  const schemaWarning = !authState.approvalSchemaReady
    ? " Approval columns are not available yet, so setup is running in compatibility mode."
    : "";
  els.authGate.innerHTML = `
    <article class="auth-gate-card">
      <p class="eyebrow">Account Pending</p>
      <h2>Your account is waiting for admin approval.</h2>
      <p>${profile ? `You can stay signed in, but protected app actions are locked until an admin approves your account.${schemaWarning}` : "Your account is signed in, but no profile row was found yet."}</p>
      <button class="secondary compact-button" type="button" data-gate-logout>Log Out</button>
    </article>
  `;
  els.authGate.querySelector("[data-gate-logout]").addEventListener("click", () => {
    els.authLogout?.click();
  });
  return true;
}

export async function openUserManagement() {
  if (!canApproveUsers()) return;
  await loadPendingProfiles();
  isManagePlayersMode = true;
  switchTab("players");
  render();
}

export async function savePlayerFromForm(event) {
  event.preventDefault();
  const name = els.playerName.value.trim();
  const isGuestPlayer = Boolean(els.playerGuest.checked);
  const positions = getSelectedFormPositions(
    els.playerRole.value,
    els.playerPosition.value,
    els.playerPositionThird.value
  );
  const editingId = els.editingPlayerId.value;
  if (!name) return;
  const existingPlayer = state.data.players.find((item) => item.id === editingId);
  const image = imageRemoved.player ? "" : imageDrafts.player || existingPlayer?.image || "";
  if (existingPlayer?.profileBacked) {
    if (!canEditProfileBackedPlayer(existingPlayer)) {
      alert("You do not have permission to edit this profile player.");
      return;
    }
    const result = await updateProfilePlayerDetails(existingPlayer.profileId || existingPlayer.id, {
      name,
      displayName: name,
      rating: els.playerRating.value,
      primaryPosition: positions.primary,
      secondaryPosition: positions.secondary,
      thirdPosition: positions.tertiary,
      dominantFoot: els.playerDominantFoot?.value || "",
      jerseyNumber: els.playerJerseyNumber?.value || "",
      avatarUrl: image
    });
    if (!result.ok) {
      alert(result.message || "Could not save player details.");
      return;
    }
    logActivity("profile_player_edited", "profile", existingPlayer.profileId || existingPlayer.id, { name });
    resetPlayerForm();
    render();
    return;
  }

  if (!canManagePlayers()) {
    alert("Permanent players now come from approved user profiles. Use Profile Setup to update your player details.");
    resetPlayerForm();
    return;
  }

  if (isGuestPlayer) {
    alert("Guest players stay temporary per match. Use Add Guest Player during match setup.");
    resetPlayerForm();
    return;
  }

  const result = await createClaimableProfile({
    name,
    displayName: name,
    rating: els.playerRating.value,
    primaryPosition: positions.primary,
    secondaryPosition: positions.secondary,
    thirdPosition: positions.tertiary,
    dominantFoot: els.playerDominantFoot?.value || "",
    jerseyNumber: els.playerJerseyNumber?.value || "",
    avatarUrl: image
  }, authState.currentProfile);

  if (!result.ok) {
    alert(result.message || "Could not create claimable profile.");
    return;
  }

  showClaimResultModal({
    playerName: name,
    username: result.username || result.profile?.login_username || "",
    claimCode: result.claimCode || "",
    claimLink: result.claimLink || ""
  });
  logActivity("claimable_profile_created", "profile", result.profile.id, { name });
  resetPlayerForm();
  render();
}

export function showPlayerForm() {
  if (!canManagePlayers()) {
    alert("Permanent players now come from approved user profiles. Use Profile Setup to update your player details.");
    return;
  }
  isPlayerFormVisible = true;
  resetPlayerForm();
  isPlayerFormVisible = true;
  els.playerForm.querySelector(".primary").textContent = "Add Player";
  syncPlayerFormVisibility();
  switchTab("players");
  els.playerName.focus();
}

export function createPlayer({ name, rating, positions, image = "", isGuest }) {
  const normalizedPositions = getSelectedFormPositions(
    positions?.primary,
    positions?.secondary,
    positions?.tertiary
  );
  const currentUser = getCurrentUser();
  if (!currentUser) throw new Error("Cannot create a player without a signed-in user.");
  const now = new Date().toISOString();
  const canModerate = canApprovePlayer(currentUser);
  const playerId = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: playerId,
    name,
    rating: canModerate || isGuest ? clampRating(rating) : 50,
    positions: normalizedPositions,
    role: normalizedPositions.primary,
    position: normalizedPositions.secondary || "",
    image,
    isGuest,
    ownerUserId: isGuest ? "" : currentUser.id,
    createdBy: currentUser.id,
    createdAt: now,
    updatedBy: currentUser.id,
    updatedAt: now,
    approvedBy: canModerate ? currentUser.id : "",
    approvedAt: canModerate ? now : "",
    approvalStatus: canModerate || isGuest ? "approved" : "pending",
    stats: createDefaultPlayerStats()
  };
}

export function resetPlayerForm() {
  els.editingPlayerId.value = "";
  els.playerForm.querySelector(".primary").textContent = "Add Player";
  els.playerName.value = "";
  els.playerRating.value = "50";
  els.playerRating.disabled = false;
  els.playerRole.value = "CM";
  els.playerPosition.value = "";
  els.playerPositionThird.value = "";
  if (els.playerDominantFoot) els.playerDominantFoot.value = "";
  if (els.playerJerseyNumber) els.playerJerseyNumber.value = "";
  els.playerImage.value = "";
  imageDrafts.player = "";
  imageRemoved.player = false;
  updateImageUploadPreview("player", "");
  els.playerGuest.checked = false;
  els.playerGuest.closest("label")?.classList.remove("hidden");
  isPlayerFormVisible = false;
  syncPlayerFormVisibility();
}

export function editPlayer(id) {
  const player = state.data.players.find((item) => item.id === id);
  if (!player) return;
  if (player.profileBacked && !canEditProfileBackedPlayer(player)) {
    alert("You do not have permission to edit this profile player.");
    return;
  }
  if (!player.profileBacked && !canEditPlayer(player)) {
    alert("You can only edit your own player card.");
    return;
  }
  isPlayerFormVisible = true;
  els.editingPlayerId.value = player.id;
  els.playerName.value = player.name;
  els.playerRating.value = clampRating(player.rating);
  els.playerRating.disabled = player.profileBacked ? false : !canRatePlayer(player);
  els.playerRole.value = getPrimaryPosition(player);
  els.playerPosition.value = player.positions?.secondary || player.position || "";
  els.playerPositionThird.value = player.positions?.tertiary || "";
  if (els.playerDominantFoot) els.playerDominantFoot.value = player.dominantFoot || "";
  if (els.playerJerseyNumber) els.playerJerseyNumber.value = player.jerseyNumber || "";
  els.playerImage.value = "";
  imageDrafts.player = "";
  imageRemoved.player = false;
  updateImageUploadPreview("player", player.image || "");
  els.playerGuest.checked = false;
  els.playerGuest.closest("label")?.classList.toggle("hidden", Boolean(player.profileBacked));
  els.playerForm.querySelector(".primary").textContent = player.profileBacked ? "Save Profile Player" : "Save Player";
  syncPlayerFormVisibility();
  switchTab("players");
  els.playerName.focus();
}

export function openMatchInViewMode(match, options = {}) {
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] openMatchInViewMode`, {
    matchId: match?.id || "",
    location: match?.location || "",
    teamAPlayers: match?.teamAPlayers?.length || match?.teamA?.length || 0,
    teamBPlayers: match?.teamBPlayers?.length || match?.teamB?.length || 0,
    switchTab: Boolean(options.switchTab)
  });
  restoreUpcomingMatch(match);
  isEditingMatch = false;
  editingMatchSnapshot = null;
  originalEditingMatchId = "";
  hasPendingMatchEdits = false;
  showLiveMatchScreen = Boolean(options.openLive);
  matchWizardStep = 3;
  if (options.switchTab) switchTab("match");
  render();
}

export function deletePlayer(id) {
  const player = state.data.players.find((item) => item.id === id);
  if (!player) return;
  if (player.profileBacked) {
    deactivateProfileBackedPlayer(id);
    return;
  }
  if (!canDeletePlayer(player)) {
    alert("You do not have permission to delete this player.");
    return;
  }
  if (!confirm(`Delete ${player.name}? Match history will stay saved, but future stats will not include this player.`)) return;
  removePlayer(id);
  removeSelectedPlayerId(id);
  clearTeams();
  logActivity("player_deleted", "player", id, { name: player.name });
  persist();
  render();
}

async function changeProfileBackedPlayerRole(playerId, role) {
  const player = state.data.players.find((item) => item.id === playerId);
  if (!player?.profileBacked) return;
  if (!canManageRoles()) {
    alert("Only super admins can change roles.");
    renderPlayers();
    return;
  }
  if (!["user", "admin"].includes(role)) {
    alert("Role can only be changed to user or admin here.");
    renderPlayers();
    return;
  }
  if (player.profileRole === "super_admin") {
    alert("Super admin roles cannot be changed from Player Management.");
    renderPlayers();
    return;
  }

  const result = await updateProfilePlayerRole(player.profileId || player.id, role);
  if (!result.ok) {
    alert(result.message || "Could not update role.");
    renderPlayers();
    return;
  }
  logActivity("profile_role_changed", "profile", player.profileId || player.id, { role });
  render();
}

async function deactivateProfileBackedPlayer(playerId) {
  const player = state.data.players.find((item) => item.id === playerId);
  if (!player?.profileBacked) return;
  if (!canManageRoles()) {
    alert("Only super admins can deactivate profile players.");
    return;
  }
  if (!confirm(`Deactivate ${player.name}? This sets the profile to inactive and removes the player from active lists.`)) return;

  const result = await deactivateProfilePlayer(player.profileId || player.id);
  if (!result.ok) {
    alert(result.message || "Could not deactivate player.");
    return;
  }
  removeSelectedPlayerId(player.id);
  logActivity("profile_player_deactivated", "profile", player.profileId || player.id, { name: player.name });
  render();
}

export async function approvePlayer(id) {
  if (!canApprovePlayer()) {
    alert("You do not have permission to approve players.");
    return;
  }
  const player = state.data.players.find((item) => item.id === id);
  if (!player) return;
  const currentUser = getCurrentUser();
  const now = new Date().toISOString();
  const approvalPatch = {
    approvalStatus: "approved",
    approvedBy: currentUser.id,
    approvedAt: now,
    updatedBy: currentUser.id,
    updatedAt: now
  };
  setPlayers(
    state.data.players.map((item) =>
      item.id === id
        ? {
            ...item,
            ...approvalPatch
          }
        : item
    )
  );
  logActivity("player_approved", "player", id, { name: player.name });
  removeNotification(`player-approval-${id}`);
  persist();
  render();
}

export async function rejectPlayer(id) {
  if (!canApprovePlayer()) {
    alert("You do not have permission to reject players.");
    return;
  }
  const player = state.data.players.find((item) => item.id === id);
  if (!player) return;
  const currentUser = getCurrentUser();
  const now = new Date().toISOString();
  const rejectionPatch = {
    approvalStatus: "rejected",
    approvedBy: currentUser.id,
    approvedAt: now,
    updatedBy: currentUser.id,
    updatedAt: now
  };
  setPlayers(
    state.data.players.map((item) =>
      item.id === id
        ? {
            ...item,
            ...rejectionPatch
          }
        : item
    )
  );
  logActivity("player_rejected", "player", id, { name: player.name });
  removeNotification(`player-approval-${id}`);
  persist();
  render();
}

export async function addQuickGuest(event) {
  event.preventDefault();
  if (!hasPermission("createMatch")) {
    alert("Sign in before adding guest players.");
    return;
  }
  const name = els.guestName.value.trim();
  if (!name) return;
  const image = imageDrafts.guest || "";

  const player = createPlayer({
      name,
      rating: clampRating(els.guestRating.value),
      positions: getSelectedFormPositions(
        els.guestRole.value,
        els.guestPosition.value,
        els.guestPositionThird.value
      ),
      image,
      isGuest: true
    });

  addMatchGuestPlayer(player);
  clearTeams();
  els.guestName.value = "";
  els.guestRating.value = "50";
    els.guestRole.value = "CM";
  els.guestPosition.value = "";
  els.guestPositionThird.value = "";
  els.guestImage.value = "";
  imageDrafts.guest = "";
  imageRemoved.guest = false;
  updateImageUploadPreview("guest", "");
  renderMatchSection();
  closeGuestForm();
}

export async function handleImageUploadChange(target) {
  const input = getImageInput(target);
  const file = input?.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Choose an image file.");
    input.value = "";
    return;
  }

  const dataUrl = await readFileAsDataUrl(file);
  const resizedImage = await resizeImageDataUrl(dataUrl);
  if (!resizedImage) {
    alert("That image could not be read. Please try another photo.");
    input.value = "";
    return;
  }

  await openImagePreview(target, resizedImage);
}

export function handleImagePreviewCancel() {
  const input = getImageInput(imagePreviewState.target);
  if (input) input.value = "";
  resetImagePreviewState();
}

export function handleImagePreviewSave() {
  if (!imagePreviewState.target || !imagePreviewState.source) {
    handleImagePreviewCancel();
    return;
  }

  imageDrafts[imagePreviewState.target] = exportPreviewImage();
  imageRemoved[imagePreviewState.target] = false;
  updateImageUploadPreview(imagePreviewState.target);
  resetImagePreviewState(false);
}

export function handleImagePreviewReupload(event) {
  if (event?.type === "click") {
    els.imagePreviewReupload.click();
    return;
  }

  const file = event?.target?.files?.[0];
  if (!file) return;

  readFileAsDataUrl(file)
    .then((dataUrl) => resizeImageDataUrl(dataUrl))
    .then(async (resizedImage) => {
      if (!resizedImage) {
        alert("That image could not be read. Please try another photo.");
        return;
      }
      await openImagePreview(imagePreviewState.target, resizedImage);
    });
}

export function handleImagePreviewZoom() {
  imagePreviewState.zoom = Number(els.imagePreviewZoom.value) || 1;
  clampImagePreviewOffset();
  applyImagePreviewTransform();
}

export function handleImagePreviewPointerDown(event) {
  if (!imagePreviewState.source) return;
  event.preventDefault();
  imagePreviewState.dragPointerId = event.pointerId;
  imagePreviewState.dragStartX = event.clientX;
  imagePreviewState.dragStartY = event.clientY;
  imagePreviewState.dragOriginX = imagePreviewState.offsetX;
  imagePreviewState.dragOriginY = imagePreviewState.offsetY;
  els.imagePreviewFrame.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", handleImagePreviewPointerMove);
  window.addEventListener("pointerup", handleImagePreviewPointerUp);
  window.addEventListener("pointercancel", handleImagePreviewPointerUp);
}

async function openImagePreview(target, resizedImage) {
  const dimensions = await loadImageDimensions(resizedImage);
  if (!dimensions) {
    alert("That image could not be read. Please try another photo.");
    return;
  }

  const frameSize = getImagePreviewFrameSize();
  const coverScale = Math.max(frameSize / dimensions.width, frameSize / dimensions.height);
  imagePreviewState.target = target;
  imagePreviewState.pending = resizedImage;
  imagePreviewState.source = resizedImage;
  imagePreviewState.zoom = 1;
  imagePreviewState.offsetX = 0;
  imagePreviewState.offsetY = 0;
  imagePreviewState.baseWidth = dimensions.width * coverScale;
  imagePreviewState.baseHeight = dimensions.height * coverScale;
  imagePreviewState.naturalWidth = dimensions.width;
  imagePreviewState.naturalHeight = dimensions.height;
  imagePreviewState.frameSize = frameSize;
  bindImagePreviewModalEvents();
  els.imagePreviewZoom.value = "1";
  els.imagePreviewPhoto.src = resizedImage;
  els.imagePreviewModal.classList.remove("hidden");
  imagePreviewState.frameSize = getImagePreviewFrameSize();
  const adjustedCoverScale = Math.max(imagePreviewState.frameSize / dimensions.width, imagePreviewState.frameSize / dimensions.height);
  imagePreviewState.baseWidth = dimensions.width * adjustedCoverScale;
  imagePreviewState.baseHeight = dimensions.height * adjustedCoverScale;
  applyImagePreviewTransform();
}

function bindImagePreviewModalEvents() {
  const modal = document.querySelector("#image-preview-modal");
  const frame = document.querySelector("#image-preview-frame");
  const photo = document.querySelector("#image-preview-photo");
  const zoom = document.querySelector("#image-preview-zoom");
  const change = document.querySelector("#image-preview-change");
  const cancel = document.querySelector("#image-preview-cancel");
  const save = document.querySelector("#image-preview-save");
  const reupload = document.querySelector("#image-preview-reupload");

  if (!modal || !frame || !photo || !zoom || !change || !cancel || !save || !reupload) return;

  els.imagePreviewModal = modal;
  els.imagePreviewFrame = frame;
  els.imagePreviewPhoto = photo;
  els.imagePreviewZoom = zoom;
  els.imagePreviewChange = change;
  els.imagePreviewCancel = cancel;
  els.imagePreviewSave = save;
  els.imagePreviewReupload = reupload;

  zoom.oninput = handleImagePreviewZoom;
  frame.onpointerdown = handleImagePreviewPointerDown;
  change.onclick = handleImagePreviewReupload;
  cancel.onclick = handleImagePreviewCancel;
  save.onclick = handleImagePreviewSave;
  reupload.onchange = handleImagePreviewReupload;
}

function handleImagePreviewPointerMove(event) {
  if (imagePreviewState.dragPointerId !== event.pointerId) return;
  imagePreviewState.offsetX = imagePreviewState.dragOriginX + (event.clientX - imagePreviewState.dragStartX);
  imagePreviewState.offsetY = imagePreviewState.dragOriginY + (event.clientY - imagePreviewState.dragStartY);
  clampImagePreviewOffset();
  applyImagePreviewTransform();
}

function handleImagePreviewPointerUp(event) {
  if (imagePreviewState.dragPointerId !== event.pointerId) return;
  els.imagePreviewFrame.releasePointerCapture?.(event.pointerId);
  imagePreviewState.dragPointerId = null;
  window.removeEventListener("pointermove", handleImagePreviewPointerMove);
  window.removeEventListener("pointerup", handleImagePreviewPointerUp);
  window.removeEventListener("pointercancel", handleImagePreviewPointerUp);
}

function applyImagePreviewTransform() {
  const width = imagePreviewState.baseWidth;
  const height = imagePreviewState.baseHeight;
  const transform = `translate(calc(-50% + ${imagePreviewState.offsetX}px), calc(-50% + ${imagePreviewState.offsetY}px)) scale(${imagePreviewState.zoom})`;
  els.imagePreviewPhoto.style.width = `${width}px`;
  els.imagePreviewPhoto.style.height = `${height}px`;
  els.imagePreviewPhoto.style.transform = transform;
}

function clampImagePreviewOffset() {
  const width = imagePreviewState.baseWidth * imagePreviewState.zoom;
  const height = imagePreviewState.baseHeight * imagePreviewState.zoom;
  const maxOffsetX = Math.max(0, (width - imagePreviewState.frameSize) / 2);
  const maxOffsetY = Math.max(0, (height - imagePreviewState.frameSize) / 2);
  imagePreviewState.offsetX = Math.min(maxOffsetX, Math.max(-maxOffsetX, imagePreviewState.offsetX));
  imagePreviewState.offsetY = Math.min(maxOffsetY, Math.max(-maxOffsetY, imagePreviewState.offsetY));
}

function exportPreviewImage() {
  const outputSize = 320;
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const context = canvas.getContext("2d");
  if (!context || !imagePreviewState.source || !els.imagePreviewPhoto.complete) return imagePreviewState.pending || "";

  const scaleX = outputSize / imagePreviewState.frameSize;
  const drawWidth = imagePreviewState.baseWidth * imagePreviewState.zoom * scaleX;
  const drawHeight = imagePreviewState.baseHeight * imagePreviewState.zoom * scaleX;
  const drawX = (outputSize - drawWidth) / 2 + imagePreviewState.offsetX * scaleX;
  const drawY = (outputSize - drawHeight) / 2 + imagePreviewState.offsetY * scaleX;

  context.drawImage(els.imagePreviewPhoto, drawX, drawY, drawWidth, drawHeight);
  return canvas.toDataURL("image/jpeg", 0.88);
}

function resetImagePreviewState(clearInput = true) {
  if (clearInput) {
    const input = getImageInput(imagePreviewState.target);
    if (input) input.value = "";
  }
  if (imagePreviewState.dragPointerId !== null) {
    window.removeEventListener("pointermove", handleImagePreviewPointerMove);
    window.removeEventListener("pointerup", handleImagePreviewPointerUp);
    window.removeEventListener("pointercancel", handleImagePreviewPointerUp);
  }
  imagePreviewState.target = "";
  imagePreviewState.pending = "";
  imagePreviewState.source = "";
  imagePreviewState.zoom = 1;
  imagePreviewState.offsetX = 0;
  imagePreviewState.offsetY = 0;
  imagePreviewState.baseWidth = 0;
  imagePreviewState.baseHeight = 0;
  imagePreviewState.naturalWidth = 0;
  imagePreviewState.naturalHeight = 0;
  imagePreviewState.frameSize = 0;
  imagePreviewState.dragPointerId = null;
  els.imagePreviewZoom.value = "1";
  els.imagePreviewPhoto.removeAttribute("src");
  els.imagePreviewPhoto.style.width = "";
  els.imagePreviewPhoto.style.height = "";
  els.imagePreviewPhoto.style.transform = "";
  els.imagePreviewReupload.value = "";
  els.imagePreviewModal.classList.add("hidden");
}

function getImagePreviewFrameSize() {
  return els.imagePreviewFrame.clientWidth || 220;
}

export function triggerImageUpload(target) {
  getImageInput(target)?.click();
}

export function removeImageUpload(target) {
  const input = getImageInput(target);
  if (input) input.value = "";
  imageDrafts[target] = "";
  imageRemoved[target] = true;
  updateImageUploadPreview(target, "");
}

export function setImageUploadValue(target, image = "") {
  const input = getImageInput(target);
  if (input) input.value = "";
  imageDrafts[target] = "";
  imageRemoved[target] = false;
  updateImageUploadPreview(target, image);
}

export function getImageUploadDraft(target) {
  return imageDrafts[target] || "";
}

export function isImageUploadRemoved(target) {
  return Boolean(imageRemoved[target]);
}

export function updateImageUploadPreview(target, currentImage = "") {
  const preview = getImagePreview(target);
  if (!preview) return;
  const image = imageRemoved[target] ? "" : imageDrafts[target] || currentImage || "";
  preview.src = image || DEFAULT_AVATAR;
  preview.classList.toggle("is-empty", !image);
  if (target === "profile" && els.authProfileAvatarPreview && image) {
    els.authProfileAvatarPreview.src = image;
  }
  const removeButton = getImageRemoveButton(target);
  if (removeButton) removeButton.disabled = !image;
}

function getImageInput(target) {
  if (target === "profile") return els.authProfileAvatar;
  if (target === "guest") return els.guestImage;
  return els.playerImage;
}

function getImagePreview(target) {
  if (target === "profile") return els.authProfileAvatarUploadPreview;
  if (target === "guest") return els.guestImagePreview;
  return els.playerImagePreview;
}

function getImageRemoveButton(target) {
  if (target === "profile") return els.authProfileAvatarRemove;
  if (target === "guest") return els.guestImageRemove;
  return els.playerImageRemove;
}

function loadImageDimensions(dataUrl) {
  return new Promise((resolve) => {
    const image = new Image();
    image.addEventListener("load", () => {
      resolve({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
    });
    image.addEventListener("error", () => resolve(null));
    image.src = dataUrl;
  });
}

export function toggleGuestForm() {
  const isOpen = els.quickGuestForm.classList.toggle("open");
  els.quickGuestForm.setAttribute("aria-hidden", String(!isOpen));
  els.guestToggle.setAttribute("aria-expanded", String(isOpen));
  els.guestToggle.textContent = isOpen ? "Close" : "Add Guest Player";

  if (isOpen) {
    els.guestName.focus();
  }
}

export function closeGuestForm() {
  els.quickGuestForm.classList.remove("open");
  els.quickGuestForm.setAttribute("aria-hidden", "true");
  els.guestToggle.setAttribute("aria-expanded", "false");
  els.guestToggle.textContent = "Add Guest Player";
}

export function renderPlayers() {
  const visiblePlayers = getVisiblePlayersForCurrentUser();
  const pendingPlayers = getPendingPlayersForAdmin();
  const pendingUsersSection = renderPendingUsersAdminSection();
  els.playerCount.textContent = `${visiblePlayers.length} ${visiblePlayers.length === 1 ? "player" : "players"}`;
  els.playersList.innerHTML = "";
  renderPlayersToolbar();
  renderPendingApprovalNotice();
  if (!visiblePlayers.length && !(isManagePlayersMode && pendingPlayers.length) && !pendingUsersSection) {
    els.playersList.appendChild(emptyState("No players yet", "Add permanent players to start building teams."));
    return;
  }

  visiblePlayers.sort((a, b) => a.name.localeCompare(b.name)).forEach((player) => {
    const card = createPlayerCard(player, { actions: isManagePlayersMode && canManagePlayers() ? "manage" : "" });
    card.querySelector('[data-action="edit"]')?.addEventListener("click", () => editPlayer(player.id));
    card.querySelector('[data-action="delete"]')?.addEventListener("click", () => deletePlayer(player.id));
    card.querySelector('[data-action="deactivate-profile"]')?.addEventListener("click", () => deactivateProfileBackedPlayer(player.id));
    card.querySelector("[data-profile-role]")?.addEventListener("change", (event) => changeProfileBackedPlayerRole(player.id, event.target.value));
    card.querySelector('[data-action="approve"]')?.addEventListener("click", () => approvePlayer(player.id));
    els.playersList.appendChild(card);
  });

  if (isManagePlayersMode && pendingPlayers.length) {
    els.playersList.appendChild(renderPendingApprovalSection(pendingPlayers));
  }

  if (pendingUsersSection) els.playersList.appendChild(pendingUsersSection);
}

function renderPlayersToolbar() {
  if (!els.showPlayerForm?.parentElement) return;
  const canShowAddPlayer = canApproveUsers();
  els.showPlayerForm.classList.toggle("hidden", !canShowAddPlayer);
  els.showPlayerForm.textContent = "+ Add Player";
  let manageButton = document.querySelector("#toggle-manage-players");
  if (!canManagePlayers()) {
    isManagePlayersMode = false;
    manageButton?.remove();
    return;
  }

  if (!manageButton) {
    manageButton = document.createElement("button");
    manageButton.id = "toggle-manage-players";
    manageButton.type = "button";
    manageButton.className = "secondary compact-button";
    els.showPlayerForm.parentElement.appendChild(manageButton);
  }

  manageButton.textContent = isManagePlayersMode ? "Done Managing" : "Manage Players";
  manageButton.classList.toggle("active", isManagePlayersMode);
  manageButton.setAttribute("aria-pressed", isManagePlayersMode ? "true" : "false");
  manageButton.onclick = toggleManagePlayersMode;
}

function toggleManagePlayersMode() {
  if (!canManagePlayers()) return;
  isManagePlayersMode = !isManagePlayersMode;
  renderPlayers();
}

function canEditProfileBackedPlayer(player) {
  if (!player?.profileBacked) return false;
  if (player.profileRole === "super_admin" && !canManageRoles()) return false;
  return canManageRoles() || canManagePlayers();
}

function getVisiblePlayersForCurrentUser() {
  return state.data.players.filter((player) => player.approvalStatus === "approved");
}

function getPendingPlayersForAdmin() {
  return [];
}

function getPendingPlayersForCurrentUser() {
  return [];
}

function renderPendingApprovalNotice() {
  const existingNotice = document.querySelector(".player-pending-notice");
  existingNotice?.remove();
  if (canManagePlayers()) return;

  const pendingPlayers = getPendingPlayersForCurrentUser();
  if (!pendingPlayers.length || !els.playersList.parentElement) return;

  const notice = document.createElement("div");
  notice.className = "player-pending-notice";
  notice.textContent = pendingPlayers.length === 1
    ? "Your player is waiting for admin approval"
    : `${pendingPlayers.length} players are waiting for admin approval`;
  els.playersList.parentElement.insertBefore(notice, els.playersList);
}

function renderPendingApprovalSection(pendingPlayers) {
  const section = document.createElement("section");
  section.className = "pending-approval-section";
  section.innerHTML = `
    <div class="history-section-header">
      <h3>Pending Players</h3>
      <span class="pill">${pendingPlayers.length} pending</span>
    </div>
    <div class="pending-approval-grid"></div>
  `;

  const grid = section.querySelector(".pending-approval-grid");
  pendingPlayers.forEach((player) => {
    const card = createPlayerCard(player, { actions: "manage" });
    card.querySelector('[data-action="edit"]')?.addEventListener("click", () => editPlayer(player.id));
    card.querySelector('[data-action="delete"]')?.addEventListener("click", () => deletePlayer(player.id));
    card.querySelector('[data-action="approve"]')?.addEventListener("click", () => approvePlayer(player.id));
    card.querySelector('[data-action="reject"]')?.addEventListener("click", () => rejectPlayer(player.id));
    grid.appendChild(card);
  });

  return section;
}

function renderPendingUsersAdminSection() {
  if (!canApproveUsers() || !isManagePlayersMode) return null;

  const section = document.createElement("section");
  section.className = "pending-approval-section";
  section.innerHTML = `
    <div class="history-section-header">
      <h3>Pending Users</h3>
      <span class="pill">${authState.pendingProfiles.length} pending</span>
    </div>
    <div class="pending-user-list"></div>
  `;

  const list = section.querySelector(".pending-user-list");
  if (!authState.approvalSchemaReady) {
    list.appendChild(emptyState("Approval setup needed", "Add approval_status, approved_by, and approved_at to profiles, then refresh Supabase schema cache."));
    return section;
  }

  if (!authState.pendingProfiles.length) {
    list.appendChild(emptyState("No pending users", "New account requests will appear here after signup."));
    return section;
  }

  authState.pendingProfiles.forEach((profile) => {
    const profileId = getPendingProfileId(profile);
    const row = document.createElement("article");
    row.className = "pending-user-row";
    row.dataset.profileId = profileId;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(profile.name || "Unnamed user")}</strong>
        <span>${escapeHtml(profile.role || "user")} - ${escapeHtml(profile.approval_status || "pending")}</span>
      </div>
      <div class="row-actions pending-user-actions">
        ${canManageRoles() ? `
          <select data-user-role data-profile-id="${escapeHtml(profileId)}">
            <option value="user" ${profile.role === "user" ? "selected" : ""}>User</option>
            <option value="admin" ${profile.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="super_admin" ${profile.role === "super_admin" ? "selected" : ""}>Super Admin</option>
          </select>
        ` : ""}
        <button class="icon-button" type="button" data-user-approve data-profile-id="${escapeHtml(profileId)}">Approve</button>
      </div>
    `;
    row.querySelector("[data-user-role]")?.setAttribute("data-profile-id", profileId);
    row.querySelector("[data-user-approve]")?.setAttribute("data-profile-id", profileId);

    row.querySelector("[data-user-approve]").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const parentRow = button.closest(".pending-user-row");
      const targetProfileId = String(button.dataset.profileId || parentRow?.dataset.profileId || "").trim();
      const selectedRole = parentRow?.querySelector("[data-user-role]")?.value || profile.role || "user";
      console.log("Pending user approve clicked.", {
        buttonDataset: { ...button.dataset },
        rowDataset: { ...(parentRow?.dataset || {}) },
        resolvedTargetProfileId: targetProfileId,
        selectedRole
      });
      const result = await approveUserProfile(targetProfileId, selectedRole);
      if (!result.ok) alert(result.message);
      await loadSharedPlayersIntoState();
      render();
    });
    row.querySelector("[data-user-role]")?.addEventListener("change", async (event) => {
      const roleSelect = event.currentTarget;
      const parentRow = roleSelect.closest(".pending-user-row");
      const targetProfileId = String(roleSelect.dataset.profileId || parentRow?.dataset.profileId || "").trim();
      const result = await updateUserRole(targetProfileId, event.target.value);
      if (!result.ok) alert(result.message);
      await loadSharedPlayersIntoState();
      render();
    });
    list.appendChild(row);
  });

  return section;
}

function getPendingProfileId(profile) {
  return String(profile?.id || profile?.profile_id || profile?.user_id || "").trim();
}

export function createPlayerCard(player, options = {}) {
    const displayName = formatDisplayedPlayerName(player.name);
    const primaryPosition = getPrimaryPosition(player);
    const positionSummary = formatPlayerPositions(player);
    const rating = clampRating(player.rating);
    const stats = getPlayerStats(player);
    const actionMarkup = cardActionMarkup(player, options);
    const claimStatusMarkup = getClaimStatusMarkup(player);
    const card = document.createElement("article");
  card.className = "player-card";
  card.innerHTML = `
    <div class="player-card-shell">
      <div class="player-card-hero">
        <div class="player-card-rating-block">
          <strong class="player-card-rating">${rating}</strong>
            <span class="player-card-position">${getRoleBadgeLabel(primaryPosition)}</span>
        </div>
          ${player.isGuest ? '<span class="player-card-guest-badge">Guest</span>' : ""}
          <div class="player-card-avatar-wrap">
            <img class="player-photo" src="${player.image || DEFAULT_AVATAR}" alt="${escapeHtml(player.name)} profile photo">
          </div>
            <div class="player-card-identity">
              <strong title="${escapeHtml(player.name)}">${escapeHtml(displayName)}</strong>
              <span class="player-card-position-list">${escapeHtml(positionSummary)}</span>
              ${claimStatusMarkup}
            </div>
          </div>
        <div class="player-card-body">
        <div class="player-card-stats-strip">
          <div class="player-card-stats-row player-card-stats-labels">
            <span>M</span>
            <span>W</span>
            <span>D</span>
            <span>L</span>
              <span>${isGoalkeeperPlayer(player) ? "\uD83E\uDDE4" : "G"}</span>
            <span>\u2B50</span>
          </div>
          <div class="player-card-stats-row player-card-stats-values">
            <strong>${stats.matches}</strong>
            <strong>${stats.wins}</strong>
            <strong>${stats.draws}</strong>
            <strong>${stats.losses}</strong>
            <strong>${isGoalkeeperPlayer(player) ? stats.cleanSheets : stats.goals}</strong>
            <strong>${stats.motm}</strong>
          </div>
        </div>
      </div>
      ${actionMarkup ? `<div class="player-card-footer">${actionMarkup}</div>` : ""}
    </div>
  `;
  return card;
}

function getClaimStatusMarkup(player) {
  if (!player?.profileBacked || player?.isGuest) return "";
  if (player.claimStatus === "pending") {
    return '<span class="player-card-claim-status pending">Pending Claim</span>';
  }
  if (player.claimStatus === "claimed") {
    return '<span class="player-card-claim-status claimed">Claimed</span>';
  }
  return "";
}

export function cardActionMarkup(player, options) {
  if (options.actions === "manage") {
    if (player.profileBacked) {
      const actions = [];
      if (canEditProfileBackedPlayer(player)) {
        actions.push('<button class="icon-button" type="button" data-action="edit">Edit Details</button>');
      }
      if (canManageRoles() && player.profileRole !== "super_admin") {
        actions.push(`
          <select data-profile-role aria-label="Player role">
            <option value="user" ${player.profileRole === "user" ? "selected" : ""}>User</option>
            <option value="admin" ${player.profileRole === "admin" ? "selected" : ""}>Admin</option>
          </select>
        `);
        actions.push('<button class="icon-button delete" type="button" data-action="deactivate-profile">Deactivate</button>');
      }
      if (!actions.length) return "";
      return `
        <div class="row-actions player-card-actions">
          ${actions.join("")}
        </div>
      `;
    }

    const actions = [];
    if (canEditPlayer(player) && player.approvalStatus === "approved") {
      actions.push('<button class="icon-button" type="button" data-action="edit">Edit</button>');
    }
    if (canApprovePlayer() && player.approvalStatus !== "approved") {
      actions.push('<button class="icon-button" type="button" data-action="approve">Approve</button>');
      actions.push('<button class="icon-button delete" type="button" data-action="reject">Reject</button>');
    }
    if (canEditPlayer(player) && player.approvalStatus !== "approved") {
      actions.push('<button class="icon-button" type="button" data-action="edit">Edit</button>');
    }
    if (canDeletePlayer(player)) {
      actions.push('<button class="icon-button delete" type="button" data-action="delete">Delete</button>');
    }
    if (!actions.length) return "";
    return `
      <div class="row-actions player-card-actions">
        ${actions.join("")}
      </div>
    `;
  }

  return "";
}

export function renderMatchSelection() {
  els.matchPlayerList.innerHTML = "";
  const approvedPlayers = getVisiblePlayersForCurrentUser();
  if (!approvedPlayers.length && !state.matchGuestPlayers.length) {
    els.matchPlayerList.appendChild(emptyState("No selectable players", "Add players first, then come back to create a match."));
    return;
  }

  approvedPlayers
    .sort((a, b) => clampRating(b.rating) - clampRating(a.rating) || a.name.localeCompare(b.name))
    .forEach((player) => {
          const rating = clampRating(player.rating);
          const label = document.createElement("label");
          label.className = "select-player";
          label.innerHTML = `
            <input type="checkbox" ${state.selectedPlayerIds.has(player.id) ? "checked" : ""}>
            <span>${escapeHtml(player.name)} - ${escapeHtml(formatPlayerPositions(player))} - ${rating}</span>
          `;
        label.querySelector("input").addEventListener("change", (changeEvent) => {
          if (changeEvent.target.checked) addSelectedPlayerId(player.id);
          else removeSelectedPlayerId(player.id);
  clearTeams();
  updateFormationOptions();
  clearManualSwapSelection();
  renderMatchSection();
        });
        els.matchPlayerList.appendChild(label);
      });

  state.matchGuestPlayers.forEach((player) => {
      const rating = clampRating(player.rating);
      const row = document.createElement("div");
      row.className = "select-player select-player-guest";
      row.innerHTML = `
        <span class="select-player-text">${escapeHtml(player.name)} - ${escapeHtml(formatPlayerPositions(player))} - ${rating}</span>
        <span class="select-player-guest-badge" aria-label="Guest player">Guest</span>
        <button class="icon-button delete compact-button" type="button">Remove</button>
      `;
    row.querySelector("button").addEventListener("click", () => {
      removeMatchGuestPlayer(player.id);
      clearTeams();
      updateFormationOptions();
      renderMatchSection();
    });
    els.matchPlayerList.appendChild(row);
  });

  updateFormationOptions();
}

export function renderTeams() {
  els.teamsArea.innerHTML = "";
  const currentMatchStatus = state.currentTeams ? getMatchStatus(state.currentTeams) : null;
  const isDraftMatch = Boolean(state.currentTeams?.isDraft);
  const isSavedMatch = Boolean(state.currentTeams && !state.currentTeams.isDraft);
  const canFinishEditing = Boolean(isSavedMatch && isEditingMatch && currentMatchStatus === "upcoming");
  const isReadOnlySavedMatch = Boolean(isSavedMatch && !isEditingMatch);
  const finishedAwaitingResult = hasFinishedAwaitingResult(state.currentTeams, currentMatchStatus);
  const canOpenResult = Boolean(
      isSavedMatch && (currentMatchStatus === "pending_result" || currentMatchStatus === "completed")
  );
  els.matchFinishedModal.classList.toggle("hidden", !finishedAwaitingResult || state.currentTeams?.resultOpen);
  els.resultForm.classList.toggle("hidden", !canOpenResult || !state.currentTeams?.resultOpen);
  els.createMatch.classList.toggle("hidden", !(isDraftMatch || canFinishEditing) || currentMatchStatus !== "upcoming");
  els.createMatch.textContent = canFinishEditing ? "Finish Editing" : "Create Match";
  if (!state.currentTeams) {
    clearLiveTimer();
    els.reshuffleTeams.disabled = true;
    els.teamBalanceNote.textContent = "Select at least two players to generate teams.";
    els.matchFinishedModal.classList.add("hidden");
    els.createMatch.classList.add("hidden");
    els.teamsArea.appendChild(emptyState("No teams yet", "Generate teams to see the match setup here."));
    return;
  }

  const scheduleFields = getScheduleFieldValues(state.currentTeams);
  els.matchDate.value = scheduleFields.matchDate;
  setTimeSelectorValues("start", scheduleFields.startTime);
  setTimeSelectorValues("end", scheduleFields.endTime);
  const difference = Math.abs(teamRating(state.currentTeams.teamA) - teamRating(state.currentTeams.teamB));
  const teamsAreBalanced = state.currentTeams.teamA.length === state.currentTeams.teamB.length;
  const fallbackNote = state.currentTeams.fallbackUsed
    ? " Best possible placement used; some players may be out of position."
    : "";
  els.teamBalanceNote.textContent = teamsAreBalanced
    ? `${balanceLabel(difference)} Rating difference: ${difference}. ${goalkeeperNote(state.currentTeams)}${fallbackNote}`
    : "Teams are not balanced. Please make equal players before saving.";
  els.createMatch.disabled = !(state.currentTeams?.isDraft || canFinishEditing) || !teamsAreBalanced;
  normalizeCaptains();
  normalizeTeamFormations();

  if (isLiveMatch(state.currentTeams) && showLiveMatchScreen) {
    els.matchFinishedModal.classList.add("hidden");
    els.resultForm.classList.add("hidden");
    els.teamsArea.appendChild(renderLiveMatch(state.currentTeams, {
      onBack: () => {
        showLiveMatchScreen = false;
        renderMatchSection();
      }
    }));
    return;
  }

  clearLiveTimer();
  if (isReadOnlySavedMatch) {
    els.teamsArea.appendChild(renderMatchDetailHeader(state.currentTeams));
  }
  els.teamsArea.appendChild(renderStandardMatchView(state.currentTeams, currentMatchStatus, {
      editable: !isReadOnlySavedMatch,
      showEditActions: Boolean(isSavedMatch && isEditingMatch)
    }));
  if (isReadOnlySavedMatch) {
    els.teamsArea.appendChild(renderMatchDetailActions(state.currentTeams));
  }
  if (currentMatchStatus === "completed" && state.currentTeams.result) {
    els.teamsArea.appendChild(renderCompletedMatchSummary(state.currentTeams));
  }

  renderMotmOptions(els);
  renderResultSection(els);
}

export function renderMatchSection() {
  renderMatchLanding();
  renderMatchSelection();
  renderTeams();
  renderMatchWizard();
  updateMatchStepActions();
}

export function renderStats() {
  els.leaderboard.innerHTML = "";
  els.statsTabs.forEach((button) => {
    const isActive = button.dataset.statsTab === activeStatsTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  renderStatsResetButton();

  if (!state.data.players.length) {
    els.leaderboard.appendChild(emptyState("No stats available yet", "Saved matches will build your leaderboard."));
    return;
  }

  const config = getStatsTabConfig(activeStatsTab);
  const players = [...state.data.players]
    .map((player) => ({ player, value: Number(getPlayerStats(player)[config.key]) || 0 }))
    .sort((a, b) => b.value - a.value || a.player.name.localeCompare(b.player.name));

  if (!players.some(({ value }) => value > 0)) {
    els.leaderboard.appendChild(emptyState("No stats available yet", "Complete matches to populate this leaderboard."));
    return;
  }

  const header = document.createElement("div");
  header.className = "leaderboard-header";
  header.innerHTML = `
    <span>#</span>
    <span>Player</span>
    <span>${escapeHtml(config.label)}</span>
  `;
  els.leaderboard.appendChild(header);

  players
    .filter(({ value }) => value > 0)
    .forEach(({ player, value }, index) => {
      els.leaderboard.appendChild(createStatsLeaderboardRow(player, value, index, config));
    });
}

function renderStatsResetButton() {
  const existingButton = document.querySelector("#reset-stats-button");
  existingButton?.remove();
  const shouldRenderResetStats = isSignedInSuperAdmin();
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] stats reset visibility`, {
    currentProfileId: authState.currentProfile?.id || "",
    currentUserRole: authState.currentProfile?.role || "",
    shouldRenderResetStats
  });
  if (!shouldRenderResetStats || !els.leaderboard?.parentElement) return;

  const button = document.createElement("button");
  button.id = "reset-stats-button";
  button.type = "button";
  button.className = "secondary compact-button";
  button.textContent = "Reset Stats";
  button.addEventListener("click", handleResetStats);
  els.leaderboard.parentElement.insertBefore(button, els.leaderboard);
}

function handleResetStats() {
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] stats reset clicked`, {
    currentProfileId: authState.currentProfile?.id || "",
    currentUserRole: authState.currentProfile?.role || "",
    playersAffected: state.data.players.length
  });
  if (!isSignedInSuperAdmin()) return;
  const confirmed = confirm("Reset player stats? Match history, players, profiles, approvals, and notifications will stay unchanged.");
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] stats reset confirmation`, {
    currentUserRole: authState.currentProfile?.role || "",
    resetConfirmed: confirmed,
    playersAffected: state.data.players.length,
    before: summarizeVisibleStats()
  });
  if (!confirmed) return;
  resetDerivedStats();
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] stats reset completed`, {
    currentUserRole: authState.currentProfile?.role || "",
    playersAffected: state.data.players.length,
    after: summarizeVisibleStats()
  });
  render();
}

function isSignedInSuperAdmin() {
  return authState.currentProfile?.role === "super_admin";
}

function summarizeVisibleStats() {
  return state.data.players.reduce((summary, player) => {
    const stats = getPlayerStats(player);
    summary.players += 1;
    summary.matches += Number(stats.matches) || 0;
    summary.goals += Number(stats.goals) || 0;
    summary.wins += Number(stats.wins) || 0;
    summary.motm += Number(stats.motm) || 0;
    summary.cleanSheets += Number(stats.cleanSheets) || 0;
    return summary;
  }, {
    players: 0,
    matches: 0,
    goals: 0,
    wins: 0,
    motm: 0,
    cleanSheets: 0
  });
}

export function setActiveStatsTab(tab) {
  const nextTab = getStatsTabConfig(tab).key;
  if (activeStatsTab === nextTab) return;
  activeStatsTab = nextTab;
  renderStats();
}

export function renderHistory() {
  els.historyList.innerHTML = "";
  const now = Date.now();
  const completedMatches = state.data.matches.filter((match) => isCompletedMatch(match, now));
  if (!completedMatches.length && !hasPermission("viewAuditLog")) {
    els.historyList.appendChild(emptyState("No completed matches", "Save a result to build your archive."));
    return;
  }
  if (completedMatches.length) {
    els.historyList.appendChild(createHistorySection("Completed Matches", "Completed", completedMatches));
  }
  if (hasPermission("viewAuditLog")) {
    els.historyList.appendChild(createActivityLogSection());
  }
}

export function clearAllData() {
  if (!confirm("Clear all players, matches, and saved statistics from this device?")) return;
  resetAppData();
  render();
}

export function cancelMatchCreation() {
  const confirmed = confirm("Cancel match creation?");
  if (!confirmed) return;
  resetMatchSetupState();
  switchTab("match");
  render();
}

export function initUI() {
  bindClaimResultModalEvents();
  initTimeSelectors();
  syncMatchWizardStep();
  syncPlayerFormVisibility();
  startMatchStatusRefresh();
  render();
}

function bindClaimResultModalEvents() {
  if (!els.claimResultModal) return;
  els.claimResultClose.onclick = closeClaimResultModal;
  els.claimCopyUsername.onclick = () => copyClaimResultValue(claimResultState.username, "Username copied.");
  els.claimCopyCode.onclick = () => copyClaimResultValue(claimResultState.claimCode, "Claim code copied.");
  els.claimCopyLink.onclick = () => copyClaimResultValue(claimResultState.claimLink, "Claim link copied.");
  els.claimResultModal.onclick = (event) => {
    if (event.target === els.claimResultModal) closeClaimResultModal();
  };
}

function showClaimResultModal({ playerName = "", username = "", claimCode = "", claimLink = "" } = {}) {
  claimResultState.playerName = playerName || "";
  claimResultState.username = username;
  claimResultState.claimCode = claimCode;
  claimResultState.claimLink = claimLink;
  if (els.claimResultPlayerName) els.claimResultPlayerName.textContent = playerName || "-";
  if (els.claimResultUsername) els.claimResultUsername.textContent = username || "-";
  if (els.claimResultCode) els.claimResultCode.textContent = claimCode || "-";
  if (els.claimResultLink) els.claimResultLink.textContent = claimLink || "-";
  if (els.claimResultFeedback) els.claimResultFeedback.textContent = "";
  els.claimResultModal?.classList.remove("hidden");
}

function closeClaimResultModal() {
  els.claimResultModal?.classList.add("hidden");
  if (els.claimResultFeedback) els.claimResultFeedback.textContent = "";
}

async function copyClaimResultValue(value, successMessage) {
  const text = String(value || "").trim();
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      fallbackCopyText(text);
    }
  } catch (error) {
    fallbackCopyText(text);
  }
  if (els.claimResultFeedback) els.claimResultFeedback.textContent = successMessage;
}

function fallbackCopyText(text) {
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "readonly");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

export function startMatchCreation() {
  if (!hasPermission("createMatch")) {
    els.teamBalanceNote.textContent = "Sign in before creating matches.";
    return;
  }
  resetMatchSetupState();
  showAllHomeUpcomingMatches = false;
  matchWizardStep = 1;
  renderMatchSection();
}

export function createMatchAndReturnHome() {
  if (isEditingMatch) {
    console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] createMatch button routed to finishMatchEditing`, {
      matchId: state.currentTeams?.id || "",
      teamAPlayers: state.currentTeams?.teamA?.length || 0,
      teamBPlayers: state.currentTeams?.teamB?.length || 0
    });
    finishMatchEditing();
    return;
  }

  if (!state.currentTeams?.isDraft) return;
  if (state.currentTeams.teamA.length !== state.currentTeams.teamB.length) {
    els.teamBalanceNote.textContent = "Teams must have equal number of players";
    return;
  }
  const savedMatch = persistCurrentMatch({
    forceSave: true,
    status: "upcoming",
    saveReason: "create",
    auditAction: "match_created",
    logAction: "match_created"
  });
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] createMatchAndReturnHome persisted local match`, {
    matchId: savedMatch?.id || "",
    location: savedMatch?.location || "",
    teamAPlayers: savedMatch?.teamAPlayers?.length || 0,
    teamBPlayers: savedMatch?.teamBPlayers?.length || 0
  });
  if (!savedMatch) {
    console.error("Match creation did not produce a saved local match.", { currentTeams: state.currentTeams });
    els.teamBalanceNote.textContent = "Could not create match. Please try again.";
    return;
  }
  addMatchActionNotification(savedMatch, "match_created");
  homeFeedbackMessage = "Match Created Successfully";
  resetMatchSetupState();
  switchTab("home");
  render();
}

export function goToMatchLandingStep() {
  if (state.currentTeams) return;
  matchWizardStep = 0;
  renderMatchWizard();
}

export function goToMatchTimeStep() {
  matchWizardStep = 1;
  renderMatchWizard();
}

export function goToPlayerSelectionStep() {
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] goToPlayerSelectionStep`, {
    matchId: state.currentTeams?.id || "",
    isEditingMatch,
    isDraft: Boolean(state.currentTeams?.isDraft),
    teamAPlayers: state.currentTeams?.teamA?.length || 0,
    teamBPlayers: state.currentTeams?.teamB?.length || 0
  });
  matchWizardStep = 2;
  renderMatchWizard();
}

export function goToLineupStep() {
  matchWizardStep = 3;
  renderMatchWizard();
}

export function getMatchGenerationOptions() {
  const originalMatchId = isEditingMatch
    ? originalEditingMatchId || editingMatchSnapshot?.id || state.currentTeams?.originalEditingMatchId || ""
    : "";
  return {
    originalMatchId,
    editingMatchSnapshot: originalMatchId ? cloneMatchSnapshot(editingMatchSnapshot || state.currentTeams) : null
  };
}

export function startMatchStatusRefresh() {
  stopMatchStatusRefresh();
  matchStatusRefreshId = window.setInterval(() => {
    refreshMatchStatusUI();
  }, 30000);
}

export function stopMatchStatusRefresh() {
  if (!matchStatusRefreshId) return;
  window.clearInterval(matchStatusRefreshId);
  matchStatusRefreshId = null;
}

function emptyState(title, body) {
  const node = els.emptyTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector("strong").textContent = title;
  node.querySelector("p").textContent = body;
  return node;
}

function createHistorySection(title, badge, matches) {
  const section = document.createElement("section");
  section.className = "history-section";
  section.innerHTML = `
    <div class="history-section-header">
      <h3>${title}</h3>
      <span class="pill">${badge}</span>
    </div>
    <div class="history-section-list"></div>
  `;

  const list = section.querySelector(".history-section-list");
  if (!matches.length) {
    list.appendChild(
      emptyState(
        `No ${badge.toLowerCase()} matches`,
        badge === "Upcoming" ? "Create a match to see it here." : "Save a result to build your archive."
      )
    );
    return section;
  }

  matches.forEach((match) => {
    list.appendChild(createHistoryCard(match));
  });

  return section;
}

function createActivityLogSection() {
  const section = document.createElement("section");
  section.className = "history-section";
  const logs = [...(state.data.activityLog || [])].slice(0, 30);
  section.innerHTML = `
    <div class="history-section-header">
      <h3>Activity Log</h3>
      <span class="pill">Audit</span>
    </div>
    <div class="history-section-list"></div>
  `;
  const list = section.querySelector(".history-section-list");
  if (!logs.length) {
    list.appendChild(emptyState("No activity yet", "Player and match changes will appear here."));
    return section;
  }

  logs.forEach((entry) => {
    const card = document.createElement("article");
    card.className = "history-card audit-log-card";
    card.innerHTML = `
      <div class="history-title">
        <div>
          <strong>${escapeHtml(formatAuditAction(entry.action))}</strong>
          <div class="audit-meta">
            <span>${escapeHtml(entry.entityType)} ${escapeHtml(entry.entityId)}</span>
            <span>By ${escapeHtml(entry.byName || getUserName(entry.by))}</span>
            <span>${formatDate(entry.at)}</span>
          </div>
        </div>
      </div>
    `;
    list.appendChild(card);
  });

  return section;
}

function createHistoryCard(match) {
  const card = document.createElement("article");
  card.className = "history-card";
  const teamAName = match.teamAName || "Team A";
  const teamBName = match.teamBName || "Team B";
  const result = getMatchResult(match);
  const computedStatus = getMatchStatus(match);
  const metadata = getMatchMetadata(match);
  const resultLabel = result
    ? result.scoreA > result.scoreB
      ? `${teamAName} won`
      : result.scoreB > result.scoreA
        ? `${teamBName} won`
        : "Draw"
    : capitalizeLabel(computedStatus);
  card.innerHTML = `
    <div class="history-title">
      <div>
        <strong>${formatReadableMatchWindow(match)}</strong>
        <div class="history-meta">
          <span class="pill">${capitalizeLabel(computedStatus)}</span>
        </div>
      </div>
    </div>
    ${computedStatus === "completed" && result ? `
      <div class="match-score-row">
        <span class="team-name left">${escapeHtml(teamAName)}</span>
        <span class="score">
          <span class="score-a">${result.scoreA}</span>
          <span class="divider">:</span>
          <span class="score-b">${result.scoreB}</span>
        </span>
        <span class="team-name right">${escapeHtml(teamBName)}</span>
      </div>
      <div class="match-result">
        ${escapeHtml(resultLabel)}
      </div>
    ` : ""}
    <div class="history-summary">
      <p><strong>${matchResultText(match)}</strong></p>
      ${computedStatus === "completed" ? `<p>${motmName(match) ? `<span class="motm">MOTM ${escapeHtml(motmName(match))}</span>` : "MOTM: Not selected"}</p>` : ""}
      ${computedStatus === "completed" ? `<p>Scorers: ${scorersText(match)}</p>` : ""}
      ${match.managerName ? `<p>Manager: ${escapeHtml(match.managerName)}${managerHistoryTeam(match, teamAName, teamBName)}</p>` : ""}
      <div class="audit-meta">
        <span>Created by ${escapeHtml(metadata.createdByLabel)}</span>
        ${metadata.hasBeenEdited && metadata.updatedByLabel ? `<span>Last edited by ${escapeHtml(metadata.updatedByLabel)}</span>` : ""}
      </div>
    </div>
    <div class="row-actions history-actions">
      <button class="secondary compact-button" type="button" data-history-view>View Match</button>
      ${canEditMatch(match) ? '<button class="primary compact-button" type="button" data-history-edit-result>Edit Result</button>' : ""}
    </div>
  `;
  card.querySelector("[data-history-view]").addEventListener("click", () => openMatchInViewMode(match, { switchTab: true }));
  card.querySelector("[data-history-edit-result]")?.addEventListener("click", () => openResultEditorForMatch(match));
  return card;
}

function isKnownRole(value) {
  return roles.includes(value);
}

function capitalizeLabel(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}

function formatRoleLabel(role) {
  return String(role || "user")
    .split("_")
    .map(capitalizeLabel)
    .join(" ");
}

function formatAuditAction(action) {
  return String(action || "edited")
    .replaceAll("_", " ")
    .split(" ")
    .map(capitalizeLabel)
    .join(" ");
}

function getRoleBadgeLabel(role) {
  return isKnownRole(role) ? role : "N/A";
}

function getSelectedFormPositions(primaryValue, secondaryValue = "", tertiaryValue = "") {
  const ordered = [
    isKnownRole(primaryValue) ? primaryValue : "CM",
    isKnownRole(secondaryValue) ? secondaryValue : "",
    isKnownRole(tertiaryValue) ? tertiaryValue : ""
  ].filter(Boolean);
  const unique = [...new Set(ordered)];
  return {
    primary: unique[0] || "CM",
    secondary: unique[1] || "",
    tertiary: unique[2] || ""
  };
}

function formatPlayerPositions(player) {
  const positions = getPlayerPositions(player);
  return positions.length ? positions.join(" / ") : "CM";
}

function formatDisplayedPlayerName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return `${parts[0]} ${parts[1].charAt(0)}.`;
}

function getStatsTabConfig(tab) {
  const configs = {
    goals: { key: "goals", label: "Goals" },
    wins: { key: "wins", label: "Wins" },
    draws: { key: "draws", label: "Draws" },
    losses: { key: "losses", label: "Losses" },
    motm: { key: "motm", label: "MVP" }
  };
  return configs[tab] || configs.goals;
}

function createStatsLeaderboardRow(player, value, index, config) {
  const row = document.createElement("article");
  const displayName = formatDisplayedPlayerName(player.name);
  row.className = `leaderboard-row${index < 3 ? " top-three" : ""}`;
  row.innerHTML = `
    <span class="leaderboard-rank">${index + 1}</span>
    <div class="leaderboard-player">
      <img class="leaderboard-avatar" src="${player.image || DEFAULT_AVATAR}" alt="${escapeHtml(player.name)} profile photo">
      <div class="leaderboard-player-copy">
        <strong title="${escapeHtml(player.name)}">${escapeHtml(displayName)}</strong>
        <span>${escapeHtml(config.label)}</span>
      </div>
    </div>
    <strong class="leaderboard-value">${value}</strong>
  `;
  return row;
}

function formatReadableMatchWindow(match) {
  const start = new Date(matchStartTime(match));
  const end = new Date(matchEndTime(match));
  if (Number.isNaN(start.getTime())) return "Date not set";
  const dateLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" }).format(start);
  const startLabel = new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: "UTC" }).format(start);
  if (Number.isNaN(end.getTime())) return `${dateLabel} \u2022 ${startLabel}`;
  const endLabel = new Intl.DateTimeFormat(undefined, { timeStyle: "short", timeZone: "UTC" }).format(end);
  return `${dateLabel} \u2022 ${startLabel} \u2013 ${endLabel}`;
}

function getScheduleFieldValues(match) {
  const start = new Date(match.startTime || match.matchTime || matchDateTime(match));
  const end = new Date(match.endTime || match.startTime || match.matchTime || matchDateTime(match));
  const matchDate = Number.isNaN(start.getTime()) ? "" : start.toISOString().slice(0, 10);
  const startTime = Number.isNaN(start.getTime()) ? getDefaultRoundedTime() : toUtcTimeValue(start);
  const endTime = Number.isNaN(end.getTime()) ? addMinutesToTime(startTime, 60) : toUtcTimeValue(end);
  return { matchDate, startTime, endTime };
}

function toUtcTimeValue(date) {
  return date.toISOString().slice(11, 16);
}

function initTimeSelectors() {
  populateTimeSelect(els.matchStartHour, buildHourOptions());
  populateTimeSelect(els.matchEndHour, buildHourOptions());
  populateTimeSelect(els.matchStartMinute, buildMinuteOptions());
  populateTimeSelect(els.matchEndMinute, buildMinuteOptions());
  const defaultStart = getDefaultRoundedTime();
  setTimeSelectorValues("start", defaultStart);
  setTimeSelectorValues("end", addMinutesToTime(defaultStart, 60));
}

function populateTimeSelect(select, values) {
  if (!select || select.options.length) return;
  select.innerHTML = values.map((value) => `<option value="${value}">${value}</option>`).join("");
}

function buildHourOptions() {
  return Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
}

function buildMinuteOptions() {
  return Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
}

function setTimeSelectorValues(prefix, time24) {
  const { hour12, minute, period } = to12HourParts(time24);
  const hourSelect = prefix === "start" ? els.matchStartHour : els.matchEndHour;
  const minuteSelect = prefix === "start" ? els.matchStartMinute : els.matchEndMinute;
  const periodSelect = prefix === "start" ? els.matchStartPeriod : els.matchEndPeriod;
  hourSelect.value = hour12;
  minuteSelect.value = minute;
  periodSelect.value = period;
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

function getDefaultRoundedTime() {
  const now = new Date();
  const rounded = new Date(now);
  rounded.setSeconds(0, 0);
  rounded.setMinutes(Math.round(now.getMinutes() / 5) * 5);
  if (rounded.getMinutes() === 60) {
    rounded.setHours(rounded.getHours() + 1);
    rounded.setMinutes(0);
  }
  return `${String(rounded.getHours()).padStart(2, "0")}:${String(rounded.getMinutes()).padStart(2, "0")}`;
}

function addMinutesToTime(time24, minutesToAdd) {
  const [hours = "00", minutes = "00"] = String(time24).split(":");
  const value = new Date(2000, 0, 1, Number(hours) || 0, Number(minutes) || 0, 0, 0);
  value.setMinutes(value.getMinutes() + minutesToAdd);
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

function renderHomeFeedback() {
  els.homeFeedback.innerHTML = homeFeedbackMessage
    ? `<div class="success-toast">${escapeHtml(homeFeedbackMessage)}</div>`
    : "";
}

function syncPlayerFormVisibility() {
  const editingPlayer = state.data.players.find((player) => player.id === els.editingPlayerId.value);
  const isCreateMode = Boolean(isPlayerFormVisible && !editingPlayer && canManagePlayers());
  const canShowProfileEdit = Boolean(isPlayerFormVisible && editingPlayer?.profileBacked && canEditProfileBackedPlayer(editingPlayer));
  const canShowForm = isCreateMode || canShowProfileEdit;
  if (!canShowForm) isPlayerFormVisible = false;
  els.playerForm.classList.toggle("hidden", !canShowForm);
  const canShowAddPlayer = canApproveUsers();
  els.showPlayerForm.classList.toggle("hidden", !canShowAddPlayer);
  if (canShowAddPlayer) {
    els.showPlayerForm.textContent = isPlayerFormVisible && !editingPlayer ? "Close Add Player" : "+ Add Player";
  } else {
    els.showPlayerForm.classList.add("hidden");
  }
}

function renderMatchLanding() {
  els.createNewMatch.classList.toggle("hidden", !hasPermission("createMatch"));
  els.matchUpcomingList.innerHTML = "";
  const upcomingMatches = state.data.matches
    .filter((match) => isUpcomingMatch(match))
    .sort((a, b) => matchStartTimeValue(a) - matchStartTimeValue(b));

  if (!upcomingMatches.length) {
    els.matchUpcomingList.appendChild(emptyState("No upcoming matches", "Create a match to see it here."));
    return;
  }

  upcomingMatches.forEach((match, index) => {
    const card = createUpcomingMatchCard(match, {
      isNextMatch: index === 0,
      onView: () => {
        openMatchInViewMode(match);
      }
    });
    els.matchUpcomingList.appendChild(card);
  });
}

function renderMatchWizard() {
  syncMatchWizardStep();
  const activeStep = getActiveMatchStep();
  const isReadOnlySavedMatch = Boolean(state.currentTeams && !state.currentTeams.isDraft && !isEditingMatch);
  els.matchStepIndicator.classList.toggle("hidden", activeStep === 0 || isReadOnlySavedMatch);
  els.matchStepPanels.forEach((panel) => {
    const isActive = panel.id === getMatchStepPanelId(activeStep);
    panel.classList.toggle("hidden", !isActive);
    panel.classList.toggle("is-active", isActive);
  });

  els.matchStepIndicator.querySelectorAll("[data-step-indicator]").forEach((node) => {
    const step = Number(node.dataset.stepIndicator);
    node.classList.toggle("active", step === activeStep);
    node.classList.toggle("complete", step < activeStep);
  });

  const canGoBackFromLineup = Boolean(state.currentTeams && getMatchStatus(state.currentTeams) === "upcoming");
  els.matchBackToSelection.classList.toggle("hidden", !canGoBackFromLineup || (!state.currentTeams?.isDraft && !isEditingMatch));
  els.cancelMatch.classList.toggle("hidden", !(activeStep === 3 && state.currentTeams?.isDraft));
}

function syncMatchWizardStep() {
  if (state.currentTeams && !state.currentTeams.isDraft && !isEditingMatch) {
    matchWizardStep = 3;
    return;
  }

  if (state.currentTeams && getMatchStatus(state.currentTeams) !== "upcoming") {
    matchWizardStep = 3;
    return;
  }

  if (state.currentTeams && matchWizardStep === 0) {
    matchWizardStep = 3;
    return;
  }

  if (!state.currentTeams && matchWizardStep === 3) {
    matchWizardStep = hasMatchScheduleValue() ? 2 : 1;
  }
}

function getActiveMatchStep() {
  if (state.currentTeams && getMatchStatus(state.currentTeams) !== "upcoming") return 3;
  if (state.currentTeams && matchWizardStep === 0) return 3;
  return matchWizardStep;
}

function hasMatchScheduleValue() {
  return Boolean(
    els.matchDate.value ||
    els.matchStartHour.value ||
    els.matchStartMinute.value ||
    els.matchStartPeriod.value ||
    els.matchEndHour.value ||
    els.matchEndMinute.value ||
    els.matchEndPeriod.value
  );
}

function updateMatchStepActions() {
  els.matchNextToPlayers.disabled = !hasValidScheduleInputs();
  els.generateTeams.disabled = !hasValidPlayerSelection();
  els.generateTeams.textContent = isEditingMatch ? "Update Lineup" : "Generate Teams";
  els.createMatch.textContent = isEditingMatch ? "Finish Editing" : "Create Match";
  els.createMatch.disabled = !(state.currentTeams?.isDraft || isEditingMatch)
    || (Boolean(state.currentTeams) && state.currentTeams.teamA.length !== state.currentTeams.teamB.length);
}

function hasValidScheduleInputs() {
  return getMatchSettings(getCurrentScheduleValue()).ok;
}

function hasValidPlayerSelection() {
  const selectedPlayers = state.data.players.filter((player) => player.approvalStatus === "approved" && state.selectedPlayerIds.has(player.id));
  return validateSelectedPlayersForMatch([...selectedPlayers, ...state.matchGuestPlayers]).ok;
}

function getCurrentScheduleValue() {
  return [els.matchDate.value, getSelectedTimeValue("start"), getSelectedTimeValue("end")].join("|");
}

function getMatchStepPanelId(step) {
  if (step === 0) return "match-step-landing";
  if (step === 1) return "match-step-time";
  if (step === 2) return "match-step-players";
  return "match-step-lineup";
}

function renderStandardMatchView(teams, matchStatus, options = {}) {
  const card = createPitchCard();
  const isEditable = options.editable !== false;
  const showEditActions = Boolean(options.showEditActions);
  const viewOptions = {
    readOnly: !isEditable,
    onFormationChange: isEditable ? handleFormationChange : null,
    onTeamNameChange: isEditable ? handleTeamNameChange : null,
    onCaptainChange: isEditable ? handleCaptainChange : null,
    onManualSwap: isEditable && editActionMode ? handleManualSwapSelection : null,
    isManualSwapMode: Boolean(editActionMode),
    activeSwap: editActionMode ? activeEditSelection : null
  };
  const headers = renderTeamHeaders(teams, viewOptions);
  const selectors = renderFormationSelectors(teams, viewOptions);
  const pitch = renderPitchSurface(teams);

  if (selectors) pitch.appendChild(selectors);
  card.append(headers, pitch);
  appendPitchPlayers(pitch, teams, viewOptions);
  if (isEditable) card.append(renderManualSwapToolbar());
  if (showEditActions) card.append(renderMatchEditActions());
  return card;
}

function renderMatchDetailHeader(match) {
  const card = document.createElement("article");
  card.className = "card match-detail-header";
  const editHistory = Array.isArray(match.editHistory)
    ? match.editHistory.filter((entry) => entry?.action !== "match_created").slice(-3).reverse()
    : [];
  const metadata = getMatchMetadata(match);
  card.innerHTML = `
    <div class="match-detail-copy">
      <p class="eyebrow">Match View</p>
      <h3>${escapeHtml(match.teamAName || "Team A")} vs ${escapeHtml(match.teamBName || "Team B")}</h3>
      <p>${formatReadableMatchWindow(match)}</p>
      <div class="audit-meta">
        <span>Created by ${escapeHtml(metadata.createdByLabel)}</span>
        ${metadata.hasBeenEdited && metadata.updatedByLabel ? `<span>Last edited by ${escapeHtml(metadata.updatedByLabel)}</span>` : ""}
        ${editHistory.map((entry) => `<span>${escapeHtml(formatAuditAction(entry.action))} by ${escapeHtml(entry.byName || getUserName(entry.by))}</span>`).join("")}
      </div>
    </div>
  `;
  return card;
}

function renderMatchDetailActions(match) {
    const currentStatus = getMatchStatus(match);
    const isUpcomingEditable = currentStatus === "upcoming";
    const canEditResult = currentStatus === "pending_result" || currentStatus === "completed";
    const userCanEditMatch = canEditMatch(match);
    const userCanDeleteMatch = canDeleteMatch(match);
    const card = document.createElement("div");
    card.className = "match-detail-actions";
    card.innerHTML = `
      <button class="secondary match-detail-button" type="button" data-match-back>Back</button>
      <button class="primary match-detail-button" type="button" data-save-lineup>Save Lineup</button>
      ${userCanDeleteMatch ? '<button id="deleteMatchBtn" class="secondary danger match-detail-button" type="button">Delete Match</button>' : ""}
      ${canEditResult && userCanEditMatch ? '<button class="secondary match-detail-button" type="button" data-match-result>Edit Result</button>' : ""}
      ${isUpcomingEditable && userCanEditMatch ? '<button class="primary match-detail-button" type="button" data-match-edit>Edit Match</button>' : ""}
    `;
    const buttonCount = card.querySelectorAll("button").length;
    card.style.gridTemplateColumns = `repeat(${buttonCount}, minmax(0, 1fr))`;
    card.querySelector("[data-match-back]").addEventListener("click", returnToMatchList);
    card.querySelector("[data-save-lineup]").addEventListener("click", () => {
      saveCurrentLineup(match);
    });
    card.querySelector("#deleteMatchBtn")?.addEventListener("click", () => {
      const confirmDelete = confirm("Are you sure you want to delete this match?");
      if (!confirmDelete) return;
      deleteCurrentMatch(match.id);
    });
    card.querySelector("[data-match-result]")?.addEventListener("click", () => openResultEditorForMatch(match));
    card.querySelector("[data-match-edit]")?.addEventListener("click", () => {
    editingMatchSnapshot = cloneMatchSnapshot(match);
    originalEditingMatchId = match.id;
    hasPendingMatchEdits = false;
    isEditingMatch = true;
    updateTeams((teams) => ({
      ...teams,
      id: originalEditingMatchId,
      originalEditingMatchId
    }));
    matchWizardStep = 3;
    renderMatchSection();
  });
  return card;
}

function renderMatchEditActions() {
  const card = document.createElement("div");
  card.className = "match-detail-actions match-edit-actions";
  card.innerHTML = `
    <button class="secondary match-detail-button" type="button" data-edit-cancel>Cancel</button>
    <button class="primary match-detail-button" type="button" data-edit-finish>Finish Editing</button>
  `;
  card.querySelector("[data-edit-cancel]").addEventListener("click", cancelMatchEditing);
  card.querySelector("[data-edit-finish]").addEventListener("click", finishMatchEditing);
  return card;
}

function renderManualSwapToolbar() {
  const card = document.createElement("div");
  card.className = "manual-swap-toolbar";
  card.innerHTML = `
    <button class="secondary compact-button swap-position-button ${editActionMode === "same_team_swap" ? "active" : ""}" type="button" data-edit-action-mode="same_team_swap" aria-pressed="${editActionMode === "same_team_swap" ? "true" : "false"}">
      Swap Position
    </button>
    <button class="secondary compact-button swap-position-button ${editActionMode === "cross_team_swap" ? "active" : ""}" type="button" data-edit-action-mode="cross_team_swap" aria-pressed="${editActionMode === "cross_team_swap" ? "true" : "false"}">
      Team Shift
    </button>
    <span>${escapeHtml(getManualSwapHelperText())}</span>
  `;
  card.querySelectorAll("[data-edit-action-mode]").forEach((button) => {
    button.addEventListener("click", () => startEditActionMode(button.dataset.editActionMode));
  });
  return card;
}

function returnToMatchList() {
  resetMatchSetupState();
  renderMatchSection();
}

async function deleteCurrentMatch(matchId) {
  if (!matchId) return;
  const match = state.data.matches.find((item) => item.id === matchId);
  if (!canDeleteMatch(match)) {
    alert("You do not have permission to delete this match.");
    return;
  }
  removeMatch(matchId);
  const deleteResult = await deleteSharedMatch(matchId);
  if (!deleteResult.ok) alert(deleteResult.message || "Match deleted locally, but Supabase delete failed.");
  logActivity("match_deleted", "match", matchId, {
    label: match ? `${match.teamAName || "Team A"} vs ${match.teamBName || "Team B"}` : ""
  });
  persist();
  resetMatchSetupState();
  switchTab("match");
  render();
}

function saveCurrentLineup(match) {
  const pitch = els.teamsArea.querySelector(".football-pitch");
  const html2canvas = window.html2canvas;

  if (!pitch || typeof html2canvas !== "function") {
    alert("Lineup saved successfully");
    return;
  }

  html2canvas(pitch).then((canvas) => {
    const jpegCanvas = document.createElement("canvas");
    jpegCanvas.width = canvas.width;
    jpegCanvas.height = canvas.height;
    const context = jpegCanvas.getContext("2d");
    context.fillStyle = "#0f1720";
    context.fillRect(0, 0, jpegCanvas.width, jpegCanvas.height);
    context.drawImage(canvas, 0, 0);
    const link = document.createElement("a");
    link.download = "lineup.jpg";
    link.href = jpegCanvas.toDataURL("image/jpeg", 0.92);
    link.click();
    alert("Lineup saved successfully");
  }).catch((error) => {
    console.error("Failed to export lineup image.", error);
    alert("Lineup saved successfully");
  });
}

async function exportLineupImage(match, triggerButton) {
  const html2canvas = window.html2canvas;
  if (typeof html2canvas !== "function") {
    console.warn("html2canvas is unavailable. Skipping lineup export.");
    alert("Lineup export is not available right now. Please refresh and try again.");
    return;
  }

  const sourcePitch = els.teamsArea.querySelector(".football-pitch");
  if (!sourcePitch) {
    alert("No lineup is available to export.");
    return;
  }

  const exportNode = buildLineupExportNode(sourcePitch, match);
  setExportLoadingState(triggerButton, true);
  document.body.appendChild(exportNode);

  try {
    await waitForImagesInElement(exportNode);
    const canvas = await html2canvas(exportNode, {
      backgroundColor: "#0f1720",
      scale: Math.max(2, window.devicePixelRatio || 1),
      useCORS: true,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: exportNode.scrollWidth,
      windowHeight: exportNode.scrollHeight
    });
    downloadCanvasAsPng(canvas, `match-lineup-${Date.now()}.png`);
  } catch (error) {
    console.error("Failed to export lineup image.", error);
    alert("Could not save the lineup image. Please try again.");
  } finally {
    setExportLoadingState(triggerButton, false);
    exportNode.remove();
  }
}

function setExportLoadingState(button, isLoading) {
  if (!button) return;
  if (!button.dataset.defaultLabel) {
    button.dataset.defaultLabel = button.textContent.trim();
  }
  button.disabled = Boolean(isLoading);
  button.textContent = isLoading ? "Preparing export..." : button.dataset.defaultLabel;
  button.setAttribute("aria-busy", isLoading ? "true" : "false");
}

function buildLineupExportNode(sourcePitch, match) {
  const wrapper = document.createElement("div");
  wrapper.className = "lineup-export-shell";
  const width = Math.max(420, Math.round(sourcePitch.getBoundingClientRect().width || sourcePitch.offsetWidth || 420));
  wrapper.style.width = `${width + 40}px`;

  const title = document.createElement("div");
  title.className = "lineup-export-heading";
  title.innerHTML = `
    <strong>${escapeHtml(match.teamAName || "Team A")} vs ${escapeHtml(match.teamBName || "Team B")}</strong>
    <span>${formatReadableMatchWindow(match)}</span>
  `;

  const pitchClone = sourcePitch.cloneNode(true);
  pitchClone.classList.add("lineup-export-pitch");

  wrapper.append(title, pitchClone);
  return wrapper;
}

function waitForImagesInElement(container) {
  const images = [...container.querySelectorAll("img")];
  return Promise.all(images.map((image) => waitForImage(image)));
}

function waitForImage(image) {
  if (image.complete && image.naturalWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  });
}

function downloadCanvasAsPng(canvas, filename) {
  const link = document.createElement("a");
  link.href = canvas.toDataURL("image/png");
  link.download = filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function handleFormationChange(teamKey, formation) {
  if (!state.currentTeams || !formation) return;
  let rebuildError = "";
  activeEditSelection = null;
  editActionMessage = "";

  updateTeams((teams) => {
    const sourceKey = teamKey === "a" ? "teamA" : "teamB";
    const formationKey = teamKey === "a" ? "formationA" : "formationB";
    const rebuiltLineup = regenerateTeamLineup(teams[sourceKey], formation);

    if (!rebuiltLineup.ok) {
      rebuildError = rebuiltLineup.message || "Could not rebuild lineup for that formation.";
      return teams;
    }

    return {
      ...teams,
      [formationKey]: formation,
      [sourceKey]: rebuiltLineup.players,
      fallbackUsed: teams.fallbackUsed || rebuiltLineup.fallbackUsed
    };
  });

  if (rebuildError) {
    console.warn("Formation change skipped.", { teamKey, formation, message: rebuildError });
    alert(rebuildError);
    renderTeams();
    return;
  }

  markPendingMatchEdits();
  logActivity("formation_changed", "match", state.currentTeams.id, { teamKey, formation });
  renderTeams();
}

function startEditActionMode(mode) {
  if (editActionMode === mode) {
    clearEditActionMode();
    renderTeams();
    return;
  }

  editActionMode = mode;
  activeEditSelection = null;
  editActionMessage = mode === "cross_team_swap"
    ? "Choose one player, then one player from the opposite team."
    : "Choose two players from the same team.";
  renderTeams();
}

function clearEditActionMode() {
  editActionMode = null;
  activeEditSelection = null;
  editActionMessage = "";
}

function getManualSwapHelperText() {
  if (editActionMessage) return editActionMessage;
  if (editActionMode === "cross_team_swap") {
    return activeEditSelection ? "Choose a player from the opposite team." : "Choose the first player to change.";
  }
  if (editActionMode === "same_team_swap") {
    return activeEditSelection ? "Choose another player from the same team." : "Choose the first player to swap.";
  }
  return "Swap positions within a team, or shift players between teams.";
}

function handleManualSwapSelection(selection) {
  if (!editActionMode || !state.currentTeams || !selection?.teamKey || !Number.isInteger(Number(selection.slotIndex))) return;
  const nextSelection = {
    teamKey: selection.teamKey,
    slotIndex: Number(selection.slotIndex),
    playerId: selection.playerId,
    assignedPosition: selection.assignedPosition
  };

  if (!activeEditSelection) {
    activeEditSelection = nextSelection;
    editActionMessage = getSecondSelectionPrompt();
    renderTeams();
    return;
  }

  if (activeEditSelection.slotIndex === nextSelection.slotIndex && activeEditSelection.teamKey === nextSelection.teamKey) {
    activeEditSelection = null;
    editActionMessage = "Selection cleared. Choose the first player.";
    renderTeams();
    return;
  }

  if (editActionMode === "same_team_swap") {
    if (!canSwapWithinSameTeam(activeEditSelection, nextSelection)) {
      abortInvalidManualSwap("Swap Position works within the same team only");
      return;
    }

    const swapResult = swapPlayersWithinTeam(activeEditSelection, nextSelection);
    completeManualSwap(swapResult);
    return;
  }

  if (!canSwapAcrossTeams(activeEditSelection, nextSelection)) {
    abortInvalidManualSwap("Team Shift works between opposite teams only");
    return;
  }

  const swapResult = swapPlayersAcrossTeams(activeEditSelection, nextSelection);
  completeManualSwap(swapResult);
}

function getSecondSelectionPrompt() {
  return editActionMode === "cross_team_swap"
    ? "Choose a player from the opposite team."
    : "Choose another player from the same team.";
}

function abortInvalidManualSwap(message) {
  editActionMessage = message;
  renderTeams();
}

function completeManualSwap(swapResult) {
  activeEditSelection = null;
  editActionMessage = swapResult.message;
  if (swapResult.ok) {
    markPendingMatchEdits();
    logActivity(editActionMode === "cross_team_swap" ? "manual_team_shift" : "manual_position_swap", "match", state.currentTeams.id, {});
  }
  renderTeams();
}

function swapPlayersWithinTeam(fromSelection, toSelection) {
  if (!canSwapWithinSameTeam(fromSelection, toSelection)) {
    return { ok: false, message: "Swap Position works within the same team only" };
  }

  let result = { ok: false, message: "Could not swap those positions." };

  updateTeams((teams) => {
    const teamKey = fromSelection.teamKey === "a" ? "teamA" : "teamB";
    const teamPlayers = teams[teamKey] || [];
    const fromPlayer = teamPlayers.find((player) => player.id === fromSelection.playerId);
    const toPlayer = teamPlayers.find((player) => player.id === toSelection.playerId);

    if (!fromPlayer || !toPlayer) {
      result = { ok: false, message: "Both swap positions must be occupied." };
      return teams;
    }

    const nextPlayers = teamPlayers.map((player) => {
      if (player.id === fromPlayer.id) return markManualSwap(player, toSelection);
      if (player.id === toPlayer.id) return markManualSwap(player, fromSelection);
      return player;
    });
    const validation = validateLineupsAfterManualSwap([teamPlayers], [nextPlayers]);
    if (!validation.ok) {
      result = validation;
      return teams;
    }

    result = { ok: true, message: "Positions swapped." };
    return {
      ...teams,
      [teamKey]: nextPlayers
    };
  });

  return result;
}

function swapPlayersAcrossTeams(firstSelection, secondSelection) {
  if (!canSwapAcrossTeams(firstSelection, secondSelection)) {
    return { ok: false, message: "Team Shift works between opposite teams only" };
  }

  let result = { ok: false, message: "Could not shift those players." };

  updateTeams((teams) => {
    const firstTeamKey = firstSelection.teamKey === "a" ? "teamA" : "teamB";
    const secondTeamKey = secondSelection.teamKey === "a" ? "teamA" : "teamB";
    const firstTeamPlayers = teams[firstTeamKey] || [];
    const secondTeamPlayers = teams[secondTeamKey] || [];
    const firstLineup = getRenderedTeamLineup(teams, firstSelection.teamKey);
    const secondLineup = getRenderedTeamLineup(teams, secondSelection.teamKey);
    const firstSlot = firstLineup.find((slot) => slot.slotIndex === firstSelection.slotIndex);
    const secondSlot = secondLineup.find((slot) => slot.slotIndex === secondSelection.slotIndex);

    if (!firstSlot?.player || !secondSlot?.player) {
      result = { ok: false, message: "Both Team Shift slots must be occupied." };
      return teams;
    }

    if (firstSlot.player.id !== firstSelection.playerId || secondSlot.player.id !== secondSelection.playerId) {
      result = { ok: false, message: "Team Shift selection is out of date. Try again." };
      return teams;
    }

    const nextFirstLineup = cloneLineup(firstLineup);
    const nextSecondLineup = cloneLineup(secondLineup);
    const nextFirstSlot = nextFirstLineup.find((slot) => slot.slotIndex === firstSelection.slotIndex);
    const nextSecondSlot = nextSecondLineup.find((slot) => slot.slotIndex === secondSelection.slotIndex);
    const shiftedFirstPlayer = markManualShift(nextSecondSlot.player, nextFirstSlot);
    const shiftedSecondPlayer = markManualShift(nextFirstSlot.player, nextSecondSlot);

    nextFirstSlot.player = shiftedFirstPlayer;
    nextSecondSlot.player = shiftedSecondPlayer;

    const nextFirstTeamPlayers = syncTeamPlayersFromLineup(nextFirstLineup);
    const nextSecondTeamPlayers = syncTeamPlayersFromLineup(nextSecondLineup);
    const validation = validateLineupsAfterManualSwap(
      [firstTeamPlayers, secondTeamPlayers],
      [nextFirstTeamPlayers, nextSecondTeamPlayers]
    );

    if (!validation.ok) {
      result = validation;
      return teams;
    }

    const renderValidation = validateRenderedLineupsAfterManualSwap(
      {
        ...teams,
        [firstTeamKey]: nextFirstTeamPlayers,
        [secondTeamKey]: nextSecondTeamPlayers
      },
      [firstSelection.teamKey, secondSelection.teamKey]
    );

    if (!renderValidation.ok) {
      result = renderValidation;
      return teams;
    }

    result = { ok: true, message: "Players shifted." };
    return {
      ...teams,
      [firstTeamKey]: nextFirstTeamPlayers,
      [secondTeamKey]: nextSecondTeamPlayers
    };
  });

  return result;
}

function getRenderedTeamLineup(teams, teamKey) {
  const players = teamKey === "a" ? teams.teamA : teams.teamB;
  const formation = teamKey === "a" ? teams.formationA || teams.formation : teams.formationB || teams.formation;
  const teamSide = teamKey === "a" ? "A" : "B";

  return generateLineupPositions(players || [], formation, teamSide, teams)
    .map((slot) => ({
      slotIndex: slot.slotIndex,
      position: slot.assignedPosition,
      player: slot.player
    }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

function cloneLineup(lineup) {
  return lineup.map((slot) => ({
    ...slot,
    player: { ...slot.player }
  }));
}

function syncTeamPlayersFromLineup(lineup) {
  return lineup
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((slot) => slot.player);
}

function markManualShift(player, targetSlot) {
  return {
    ...player,
    assignedPosition: targetSlot.position,
    assignedSlotIndex: targetSlot.slotIndex,
    assignmentType: "manual_shift"
  };
}

function canSwapWithinSameTeam(firstSelection, secondSelection) {
  return Boolean(firstSelection?.teamKey && firstSelection.teamKey === secondSelection?.teamKey);
}

function canSwapAcrossTeams(firstSelection, secondSelection) {
  return Boolean(firstSelection?.teamKey && secondSelection?.teamKey && firstSelection.teamKey !== secondSelection.teamKey);
}

function validateLineupsAfterManualSwap(previousLineups, nextLineups) {
  if (previousLineups.length !== nextLineups.length) {
    return { ok: false, message: "Swap rejected to preserve lineup shape." };
  }

  for (let index = 0; index < previousLineups.length; index += 1) {
    if (previousLineups[index].length !== nextLineups[index].length) {
      return { ok: false, message: "Swap rejected to preserve team size." };
    }

    if (nextLineups[index].some((player) => !player?.id)) {
      return { ok: false, message: "Swap rejected to prevent empty slots." };
    }
  }

  const previousIds = previousLineups.flat().map((player) => player.id).sort();
  const nextIds = nextLineups.flat().map((player) => player.id).sort();
  const hasLostPlayer = previousIds.length !== nextIds.length || previousIds.some((id, index) => id !== nextIds[index]);
  if (hasLostPlayer) {
    return { ok: false, message: "Swap rejected to prevent player loss." };
  }

  if (new Set(nextIds).size !== nextIds.length) {
    return { ok: false, message: "Swap rejected to prevent duplicate players." };
  }

  return { ok: true };
}

function validateRenderedLineupsAfterManualSwap(teams, teamKeys) {
  const renderedLineups = teamKeys.map((teamKey) => getRenderedTeamLineup(teams, teamKey));
  const expectedLineups = teamKeys.map((teamKey) => teamKey === "a" ? teams.teamA : teams.teamB);

  for (let index = 0; index < renderedLineups.length; index += 1) {
    if (renderedLineups[index].length !== expectedLineups[index].length) {
      return { ok: false, message: "Team Shift rejected to prevent empty pitch slots." };
    }

    if (renderedLineups[index].some((slot) => !slot.player?.id)) {
      return { ok: false, message: "Team Shift rejected to prevent missing players." };
    }
  }

  const renderedIds = renderedLineups.flat().map((slot) => slot.player.id).sort();
  const expectedIds = expectedLineups.flat().map((player) => player.id).sort();
  const hasMismatch = renderedIds.length !== expectedIds.length || renderedIds.some((id, index) => id !== expectedIds[index]);
  if (hasMismatch) {
    return { ok: false, message: "Team Shift rejected to keep both lineups complete." };
  }

  if (new Set(renderedIds).size !== renderedIds.length) {
    return { ok: false, message: "Team Shift rejected to prevent duplicate players." };
  }

  return { ok: true };
}

function markManualSwap(player, targetSelection) {
  return {
    ...player,
    assignedPosition: targetSelection.assignedPosition,
    assignedSlotIndex: targetSelection.slotIndex,
    assignmentType: "manual_swap"
  };
}

function handleTeamNameChange(teamKey, value) {
  if (!state.currentTeams || !teamKey) return;
  const fallbackName = teamKey === "a" ? "Team A" : "Team B";
  const nextName = String(value || "").trim() || fallbackName;
  const teamKeyName = teamKey === "a" ? "teamAName" : "teamBName";
  if (state.currentTeams[teamKeyName] === nextName) return;
  updateTeams((teams) => ({
    ...teams,
    [teamKeyName]: nextName
  }));
  markPendingMatchEdits();
  renderTeams();
}

function handleCaptainChange(teamKey, playerId) {
  if (!state.currentTeams || !teamKey || !playerId) return;
  const teamPlayers = teamKey === "a" ? state.currentTeams.teamA : state.currentTeams.teamB;
  if (!teamPlayers.some((player) => player.id === playerId)) return;
  setCaptain(teamKey, playerId);
  markPendingMatchEdits();
  renderTeams();
}

export function handleMatchScheduleChange(matchTime) {
  if (!state.currentTeams) {
    renderHistory();
    renderMatchSection();
    return;
  }

  const settings = getMatchSettings(matchTime);
  if (settings.ok) {
    updateTeams((teams) => ({
      ...teams,
      matchTime: settings.matchTime,
      startTime: settings.startTime,
      endTime: settings.endTime
    }));
    markPendingMatchEdits();
  }

  renderHistory();
  renderMatchSection();
}

function formatMatchWindow(match) {
  return formatReadableMatchWindow(match);
}

function getHomeUpcomingMatches() {
  const now = Date.now();
  return state.data.matches
      .filter((match) => getMatchStatus(match, now) === "upcoming")
      .sort((a, b) => matchStartTimeValue(a) - matchStartTimeValue(b));
}

export function renderNotifications() {
  syncNotificationsWithMatches();
  const notifications = getNotifications();
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  els.notificationsCount.textContent = `${unreadCount}`;
  els.notificationsToggle.classList.toggle("has-unread", unreadCount > 0);
  els.notificationsPanel.classList.toggle("hidden", !notificationsOpen);
  els.notificationsList.innerHTML = "";

  if (!notifications.length) {
    els.notificationsList.appendChild(emptyState("No notifications", "Pending results and updates will appear here."));
    return;
  }

  els.notificationsList.appendChild(createClearNotificationsButton(notifications));
  notifications.forEach((notification) => {
    const content = getNotificationDisplayContent(notification);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `notification-row${notification.read ? "" : " unread"}`;
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(content.message)}</strong>
        <p>${escapeHtml(content.detail)}</p>
      </div>
      <span class="pill">${escapeHtml(formatNotificationType(notification.type))}</span>
    `;
    row.addEventListener("click", () => handleNotificationOpen(notification));
    els.notificationsList.appendChild(row);
  });
}

export function toggleNotificationsPanel() {
  notificationsOpen = !notificationsOpen;
  renderNotifications();
}

export function closeNotificationsPanel() {
  notificationsOpen = false;
  renderNotifications();
}

function createClearNotificationsButton(notifications) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary compact-button";
  button.textContent = "Clear notifications";
  button.addEventListener("click", () => {
    notifications.forEach((notification) => removeNotification(notification.id));
    persist();
    renderNotifications();
  });
  return button;
}

function finishMatchEditing() {
  if (!state.currentTeams) return;
  const originalMatchId = originalEditingMatchId || editingMatchSnapshot?.id || "";
  if (!originalMatchId) {
    console.error(`[SquadCraft ${MATCH_DEBUG_VERSION}] finishMatchEditing blocked: missing originalEditingMatchId`, {
      currentMatchId: state.currentTeams.id,
      editingMatchSnapshot
    });
    alert("Could not save edit because the original match id was lost. Reopen the match and try again.");
    return;
  }
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] finishMatchEditing`, {
    currentMatchId: state.currentTeams.id,
    originalEditingMatchId,
    originalMatchId,
    teamAPlayers: state.currentTeams.teamA?.length || 0,
    teamBPlayers: state.currentTeams.teamB?.length || 0
  });
  updateTeams((teams) => ({
    ...teams,
    id: originalMatchId,
    originalEditingMatchId,
    status: "upcoming",
    isDraft: false
  }));
  const savedMatch = persistCurrentMatch({
    forceSave: true,
    originalMatchId,
    status: "upcoming",
    saveReason: "edit",
    auditAction: "match_edited",
    logAction: "match_edited"
  });
  addMatchActionNotification(savedMatch || state.currentTeams, "match_edited");
  editingMatchSnapshot = cloneMatchSnapshot(serializeCurrentMatch());
  originalEditingMatchId = "";
  hasPendingMatchEdits = false;
  isEditingMatch = false;
  clearManualSwapSelection();
  matchWizardStep = 3;
  renderMatchSection();
}

export function openResultEditorForMatch(match) {
  if (!canEditMatch(match)) {
    alert("You do not have permission to edit this match.");
    return;
  }
  editingMatchSnapshot = cloneMatchSnapshot(match);
  originalEditingMatchId = match.id;
  restoreUpcomingMatch(match);
  updateTeams((teams) => ({
    ...teams,
    id: originalEditingMatchId,
    originalEditingMatchId
  }));
  if (getMatchStatus(state.currentTeams) === "upcoming" || getMatchStatus(state.currentTeams) === "live") {
    markCurrentMatchPendingResult();
  }
  if (!renderAndOpenResultPanel()) return;
  switchTab("match");
}

function cancelMatchEditing() {
  if (hasPendingMatchEdits && !confirm("Discard unsaved match edits?")) return;
  if (editingMatchSnapshot) {
    restoreUpcomingMatch(cloneMatchSnapshot(editingMatchSnapshot));
  }
  hasPendingMatchEdits = false;
  isEditingMatch = false;
  originalEditingMatchId = "";
  clearManualSwapSelection();
  matchWizardStep = 3;
  renderMatchSection();
}

function markPendingMatchEdits() {
  if (!isEditingMatch) return;
  hasPendingMatchEdits = true;
}

function cloneMatchSnapshot(match) {
  if (!match) return null;
  if (typeof structuredClone === "function") return structuredClone(match);
  return JSON.parse(JSON.stringify(match));
}

function renderAndOpenResultPanel() {
  const canOpen = openResultPanel();
  if (!canOpen) return false;
  render();
  switchTab("match");
  els.resultForm.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

function promoteElapsedMatchesToPendingResult() {
  const now = Date.now();
  let changed = false;
  const nextMatches = state.data.matches.map((match) => {
    const computedStatus = getMatchStatus(match, now);
    if (computedStatus !== "pending_result" || match.status === "pending_result" || match.result) return match;
    changed = true;
    return { ...match, status: "pending_result" };
  });

  if (!changed) return;
  nextMatches.forEach((match) => {
    if (match.status === "pending_result") {
      addPendingResultNotificationIfMissing(match);
    }
  });
  setMatches(nextMatches);
  persist();
}

function addPendingResultNotificationIfMissing(match) {
  const existing = getNotifications().some((notification) => notification.id === `pending-result-${match.id}`);
  if (existing) return;
  addNotification({
    id: `pending-result-${match.id}`,
    matchId: match.id,
    type: "pending_result",
    message: "Result pending",
    read: false,
    createdAt: new Date().toISOString()
  });
}

function addMatchActionNotification(match, type) {
  if (!match?.id) return;
  const now = Date.now();
  const actorId = getNotificationActorId(match, type);
  const actorName = getNotificationActorName(match, type);
  const message = formatMatchActionMessage(match, type, actorName);
  const recentDuplicate = getNotifications().find((notification) =>
    notification.type === type
    && notification.matchId === match.id
    && now - new Date(notification.createdAt || 0).getTime() < 1000
  );
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] match action notification actor`, {
    type,
    matchId: match.id,
    notificationActorId: actorId,
    notificationActorResolvedName: actorName
  });
  if (recentDuplicate) {
    addNotification({
      ...recentDuplicate,
      message
    });
    persist();
    return;
  }
  addNotification({
    id: `${type}-${match.id}-${now}`,
    matchId: match.id,
    type,
    message,
    read: false,
    createdAt: new Date(now).toISOString()
  });
  persist();
}

function getNotificationDisplayContent(notification) {
  const match = state.data.matches.find((item) => item.id === notification.matchId);
  const message = notification.type === "result_added" && match
    ? formatMatchActionMessage(match, "result_added")
    : notification.message || formatNotificationType(notification.type);
  const detail = [
    match ? formatNotificationMatchTitle(match) : "",
    match ? formatReadableMatchWindow(match) : "",
    formatNotificationTimestamp(notification.createdAt)
  ].filter(Boolean).join(" - ");
  return { message, detail };
}

function formatMatchActionMessage(match, type, resolvedActorName = "") {
  const actorName = resolvedActorName || getNotificationActorName(match, type);
  if (type === "match_created") return `Match created by ${actorName}`;
  if (type === "match_edited") return `Match edited by ${actorName}`;
  if (type === "result_added") return `Result added by ${actorName}`;
  return "Notification";
}

function getNotificationActorId(match, type) {
  if (type === "match_created") {
    return authState.currentProfile?.id || authState.currentAuthUser?.id || match.createdBy || "";
  }
  return authState.currentProfile?.id || authState.currentAuthUser?.id || match.updatedBy || match.createdBy || "";
}

function getNotificationActorName(match, type) {
  const currentUser = getCurrentUser();
  const currentProfileName = resolveCurrentProfileActorName();
  if (type === "match_created") {
    return firstKnownName(currentProfileName, currentUser?.name, match.createdByName, getUserName(match.createdBy)) || "Unknown";
  }
  return firstKnownName(
    currentProfileName,
    currentUser?.name,
    match.updatedByName,
    getUserName(match.updatedBy),
    match.createdByName,
    getUserName(match.createdBy)
  ) || "Unknown";
}

function resolveCurrentProfileActorName() {
  return firstKnownName(
    authState.currentProfile?.display_name,
    authState.currentProfile?.name,
    authState.currentAuthUser?.email
  );
}

function firstKnownName(...values) {
  return values.map(cleanActorName).find(Boolean) || "";
}

function cleanActorName(value) {
  const name = String(value || "").trim();
  return name && name.toLowerCase() !== "unknown" ? name : "";
}

function formatNotificationMatchTitle(match) {
  return match.title || `${match.teamAName || "Team A"} vs ${match.teamBName || "Team B"}`;
}

function handleNotificationOpen(notification) {
  if (notification.type === "player_approval_pending") {
    updateNotificationRead(notification.id);
    notificationsOpen = false;
    switchTab("players");
    render();
    return;
  }
  markNotificationsReadForMatch(notification.matchId);
  const match = state.data.matches.find((item) => item.id === notification.matchId);
  notificationsOpen = false;
  if (!match) {
    renderNotifications();
    return;
  }
  if (notification.type === "pending_result") {
    openResultEditorForMatch(match);
    return;
  }
  openMatchInViewMode(match, { switchTab: true });
}

function updateNotificationRead(notificationId) {
  const notification = state.data.notifications.find((item) => item.id === notificationId);
  if (!notification) return;
  state.data.notifications = state.data.notifications.map((item) =>
    item.id === notificationId ? { ...item, read: true } : item
  );
  persist();
}

function formatNotificationType(type) {
  if (type === "pending_result") return "Pending";
  if (type === "result_added") return "Saved";
  if (type === "match_created") return "Created";
  if (type === "match_edited") return "Edited";
  if (type === "player_approval_pending") return "Approval";
  return "Info";
}

function formatNotificationTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function createUpcomingMatchCard(match, options = {}) {
  const card = document.createElement("article");
  card.className = `card match-upcoming-card${options.isNextMatch ? " next-match-card" : ""}`;
  const metadata = getMatchMetadata(match);
  card.innerHTML = `
    <div class="match-upcoming-copy">
      ${options.isNextMatch ? '<span class="pill">Next Match</span>' : ""}
      <strong>${escapeHtml(match.teamAName || "Team A")} vs ${escapeHtml(match.teamBName || "Team B")}</strong>
      <p>${formatReadableMatchWindow(match)}</p>
      <div class="audit-meta">
        <span>Created by ${escapeHtml(metadata.createdByLabel)}</span>
        ${metadata.hasBeenEdited && metadata.updatedByLabel ? `<span>Edited by ${escapeHtml(metadata.updatedByLabel)}</span>` : ""}
      </div>
    </div>
    <button class="secondary" type="button">View Match</button>
  `;
  card.querySelector("button").addEventListener("click", () => {
    options.onView?.();
  });
  return card;
}

function hasFinishedAwaitingResult(match, status) {
  return Boolean(match && status === "pending_result" && !match.result);
}

function refreshMatchStatusUI() {
  if (!state.isReady) return;
  promoteElapsedMatchesToPendingResult();
  renderHome();
  renderHistory();
  renderNotifications();
  if (state.currentTeams) {
    renderMatchSection();
  }
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

function resetMatchSetupState() {
  isEditingMatch = false;
  editingMatchSnapshot = null;
  originalEditingMatchId = "";
  hasPendingMatchEdits = false;
  clearManualSwapSelection();
  clearMatchGuestPlayers();
  clearTeams();
  clearSelectedPlayerIds();
  matchWizardStep = 0;
  els.matchDate.value = "";
  const defaultStart = getDefaultRoundedTime();
  setTimeSelectorValues("start", defaultStart);
  setTimeSelectorValues("end", addMinutesToTime(defaultStart, 60));
  els.teamAScore.value = "0";
  els.teamBScore.value = "0";
  els.reshuffleTeams.disabled = true;
  els.resultForm.classList.add("hidden");
  els.matchFinishedModal.classList.add("hidden");
  els.createMatch.classList.add("hidden");
  els.createMatch.textContent = "Create Match";
  els.generateTeams.textContent = "Generate Teams";
}
