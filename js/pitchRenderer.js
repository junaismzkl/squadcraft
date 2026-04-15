import { generateLineupPositions, getFormationOptions, getPitchSlots, shortRole } from "./formation.js?v=match-debug-v5";
import { DEFAULT_AVATAR, motmName, scorersText, serializeCurrentMatch } from "./state.js?v=match-debug-v5";
import { teamRating } from "./teamGenerator.js?v=match-debug-v5";
import { escapeHtml } from "./utils.js?v=match-debug-v5";

export function renderCompletedMatchSummary(teams) {
  const card = document.createElement("article");
  const result = teams.result || { scoreA: 0, scoreB: 0, scorersA: [], scorersB: [], manOfTheMatch: "" };
  const match = serializeCurrentMatch({ result, status: "completed" });
  card.className = "card match-summary-card";
  card.innerHTML = `
    <div class="inline-heading">
      <h3>Match Summary</h3>
      <span class="pill">Completed</span>
    </div>
    <div class="scoreline">${escapeHtml(teams.teamAName)} ${result.scoreA} - ${result.scoreB} ${escapeHtml(teams.teamBName)}</div>
    <p><strong>Scorers:</strong> ${scorersText(match)}</p>
    <p><strong>Man of the Match:</strong> ${motmName(match) ? escapeHtml(motmName(match)) : "Not selected"}</p>
  `;
  return card;
}

export function createPitchCard() {
  const card = document.createElement("article");
  card.className = "card pitch-card";
  return card;
}

export function renderTeamHeaders(teams, options = {}) {
  const captainAName = getCaptainName(teams.teamA, teams.captainAId);
  const captainBName = getCaptainName(teams.teamB, teams.captainBId);
  const container = document.createElement("div");
  container.className = "football-pitch-meta";
  container.innerHTML = `
    <div class="team-summary team-summary-a">
      <div class="team-summary-title">
        <label class="team-name-field ${options.readOnly ? "read-only" : ""}">
          <span class="team-name-label">Team A</span>
          ${options.readOnly ? `
            <strong title="${escapeHtml(teams.teamAName)}">${escapeHtml(teams.teamAName)}</strong>
          ` : `
            <input
              type="text"
              value="${escapeHtml(teams.teamAName || "Team A")}"
              data-team-name="a"
              maxlength="24"
              aria-label="Edit Team A name"
            >
          `}
        </label>
      </div>
      <div class="team-summary-facts">
        <span>${teams.teamA.length} players</span>
        <span>Rating ${teamRating(teams.teamA)}</span>
        <span class="captain-pill ${teams.captainAId ? "is-set" : ""}" title="${escapeHtml(captainAName)}">
          <strong>C</strong>
          ${escapeHtml(captainAName)}
        </span>
      </div>
    </div>
    <div class="team-summary team-summary-b">
      <div class="team-summary-title">
        <label class="team-name-field ${options.readOnly ? "read-only" : ""}">
          <span class="team-name-label">Team B</span>
          ${options.readOnly ? `
            <strong title="${escapeHtml(teams.teamBName)}">${escapeHtml(teams.teamBName)}</strong>
          ` : `
            <input
              type="text"
              value="${escapeHtml(teams.teamBName || "Team B")}"
              data-team-name="b"
              maxlength="24"
              aria-label="Edit Team B name"
            >
          `}
        </label>
      </div>
      <div class="team-summary-facts">
        <span>${teams.teamB.length} players</span>
        <span>Rating ${teamRating(teams.teamB)}</span>
        <span class="captain-pill ${teams.captainBId ? "is-set" : ""}" title="${escapeHtml(captainBName)}">
          <strong>C</strong>
          ${escapeHtml(captainBName)}
        </span>
      </div>
    </div>
  `;
  bindTeamNameInputs(container, options.onTeamNameChange);
  return container;
}

export function renderFormationSelectors(teams, options = {}) {
  if (options.readOnly) return null;

  const formationA = teams.formationA || teams.formation;
  const formationB = teams.formationB || teams.formation;
  const container = document.createElement("div");
  container.className = "pitch-formation-row";
  container.innerHTML = `
    <label class="team-formation-control team-formation-a">
      <span>Team A</span>
      <select data-team-formation="a" aria-label="Team A formation">
        ${formationOptionsMarkup(teams.teamA.length, formationA)}
      </select>
    </label>
    <label class="team-formation-control team-formation-b">
      <span>Team B</span>
      <select data-team-formation="b" aria-label="Team B formation">
        ${formationOptionsMarkup(teams.teamB.length, formationB)}
      </select>
    </label>
  `;
  bindFormationSelectors(container, options.onFormationChange);
  return container;
}

export function renderPitchSurface(teams = {}) {
  const pitch = document.createElement("div");
  pitch.className = "football-pitch";
  pitch.innerHTML = `
    <div class="pitch-team-label pitch-team-label-a">${escapeHtml(teams.teamAName || "Team A")}</div>
    <div class="pitch-team-label pitch-team-label-b">${escapeHtml(teams.teamBName || "Team B")}</div>
    <div class="pitch-outline"></div>
    <div class="pitch-center-line"></div>
    <div class="pitch-center-circle"></div>
    <div class="pitch-penalty-box penalty-box-top"></div>
    <div class="pitch-penalty-box penalty-box-bottom"></div>
    <div class="goal-post goal-top"></div>
    <div class="goal-post goal-bottom"></div>
  `;
  return pitch;
}

export function appendPitchPlayers(pitch, teams, options = {}) {
  const formationA = teams.formationA || teams.formation;
  const formationB = teams.formationB || teams.formation;
  if (!options.readOnly) {
    renderPitchSlots(pitch, teams.teamA.length, formationA, "A");
    renderPitchSlots(pitch, teams.teamB.length, formationB, "B");
  }
  placePlayers(pitch, teams.teamA, "a", formationA, teams, options, "A");
  placePlayers(pitch, teams.teamB, "b", formationB, teams, options, "B");
}

export function renderPitch(teams, options = {}) {
  const card = createPitchCard();
  const headers = renderTeamHeaders(teams, options);
  const selectors = renderFormationSelectors(teams, options);
  const pitch = renderPitchSurface(teams);

  if (selectors) pitch.appendChild(selectors);
  card.append(headers, pitch);
  appendPitchPlayers(pitch, teams, options);
  return card;
}

export function placePlayers(pitch, players, teamKey, formationStr, teams, options = {}, teamSide = "A") {
  generateLineupPositions(players, formationStr, teamSide, teams).forEach(({ player, left, top, isCaptain, assignedPosition, slotIndex }) => {
    const marker = document.createElement("div");
    const isSwapSelected = options.activeSwap?.teamKey === teamKey && options.activeSwap?.slotIndex === slotIndex;
    marker.className = `player-marker team-${teamKey} ${isCaptain ? "captain-marker" : ""} ${options.isManualSwapMode ? "swap-enabled" : ""} ${isSwapSelected ? "swap-selected" : ""}`;
    marker.style.left = `${left}%`;
    marker.style.top = `${top}%`;
    marker.dataset.swapTeam = teamKey;
    marker.dataset.swapSlot = String(slotIndex);
      marker.innerHTML = `
      <span class="marker-avatar-wrap">
        <img class="marker-avatar" src="${player.image || DEFAULT_AVATAR}" alt="${escapeHtml(player.name)}">
        <span class="marker-role-badge">${shortRole(assignedPosition || player.assignedPosition || player.role)}</span>
        ${isCaptain ? '<span class="marker-captain-badge">C</span>' : ""}
        ${!options.readOnly ? `
          <button
            class="marker-captain-toggle ${isCaptain ? "active" : ""}"
            type="button"
            data-captain-player="${escapeHtml(player.id)}"
            data-captain-team="${teamKey}"
            aria-pressed="${isCaptain ? "true" : "false"}"
            aria-label="${isCaptain ? `Captain: ${escapeHtml(player.name)}` : `Set ${escapeHtml(player.name)} as captain`}"
          >
            C
          </button>
        ` : ""}
      </span>
      <span class="marker-name">${escapeHtml(player.name)}</span>
    `;
    bindCaptainButton(marker, options.onCaptainChange);
    bindManualSwap(marker, options.onManualSwap, {
      teamKey,
      slotIndex,
      playerId: player.id,
      assignedPosition
    });
    pitch.appendChild(marker);
  });
}

export function appendPitchTeamMarkers(pitch, players, teamKey, formationStr, teams) {
  placePlayers(pitch, players, teamKey, formationStr, teams, {}, teamKey === "b" ? "B" : "A");
}

function getCaptainName(players, captainId) {
  if (!captainId) return "Captain Not set";
  return players.find((player) => player.id === captainId)?.name || "Captain Not set";
}

function formationOptionsMarkup(teamSize, selectedFormation) {
  return getFormationOptions(teamSize)
    .map((formation) => `<option value="${escapeHtml(formation)}" ${formation === selectedFormation ? "selected" : ""}>${escapeHtml(formation)}</option>`)
    .join("");
}

function bindFormationSelectors(container, onFormationChange) {
  if (typeof onFormationChange !== "function") return;
  container.querySelectorAll("[data-team-formation]").forEach((select) => {
    select.addEventListener("change", (event) => {
      onFormationChange(event.currentTarget.dataset.teamFormation, event.currentTarget.value);
    });
  });
}

function bindTeamNameInputs(container, onTeamNameChange) {
  if (typeof onTeamNameChange !== "function") return;
  container.querySelectorAll("[data-team-name]").forEach((input) => {
    const commit = () => onTeamNameChange(input.dataset.teamName, input.value);
    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      input.blur();
    });
  });
}

function bindCaptainButton(marker, onCaptainChange) {
  if (typeof onCaptainChange !== "function") return;
  const button = marker.querySelector("[data-captain-player]");
  if (!button) return;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onCaptainChange(
      event.currentTarget.dataset.captainTeam,
      event.currentTarget.dataset.captainPlayer
    );
  });
}

function bindManualSwap(marker, onManualSwap, swapDetails) {
  if (typeof onManualSwap !== "function") return;
  marker.setAttribute("role", "button");
  marker.tabIndex = 0;
  marker.title = "Select this player for the active edit tool";
  marker.addEventListener("click", () => onManualSwap(swapDetails));
  marker.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onManualSwap(swapDetails);
  });
}

function renderPitchSlots(pitch, teamSize, formationStr, teamKey) {
  getPitchSlots(teamSize, formationStr, teamKey).forEach((slot) => {
    const marker = document.createElement("div");
    marker.className = `pitch-slot-marker team-${teamKey}`;
    marker.style.left = `${slot.left}%`;
    marker.style.top = `${slot.top}%`;
    marker.innerHTML = `<span>${escapeHtml(shortRole(slot.code))}</span>`;
    pitch.appendChild(marker);
  });
}
