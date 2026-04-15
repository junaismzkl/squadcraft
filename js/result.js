import { debugLog } from "./debug.js?v=match-debug-v5";
import {
  addNotification,
  canEditMatch,
  countScorers,
  createDefaultPlayerStats,
  getCurrentMatchPlayers,
  getMatchStatus,
  logActivity,
  OWN_GOAL_ID,
  isGoalkeeperPlayer,
  markNotificationsReadForMatch,
  normalizeScorerEntries,
  normalizeStoredMatch,
  persist,
  persistCurrentMatch,
  removeNotification,
  scorerGoalTotal,
  setMatches,
  setPlayers,
  state,
  updateTeams
} from "./state.js?v=match-debug-v5";
import { escapeHtml } from "./utils.js?v=match-debug-v5";

const MATCH_DEBUG_VERSION = "match-debug-v5";

export function renderMotmOptions(els) {
  els.motmSelect.innerHTML = "";
  getCurrentMatchPlayers().forEach((player) => {
    const option = document.createElement("option");
    option.value = player.id;
    option.textContent = player.name;
    els.motmSelect.appendChild(option);
  });
}

export function openResultPanel() {
  if (!state.currentTeams) return false;
  if (!canEditMatch(state.currentTeams)) {
    alert("You do not have permission to edit this match.");
    return false;
  }
  const status = getMatchStatus(state.currentTeams);
  if (status !== "pending_result" && status !== "completed") return false;
  updateTeams((teams) => ({
    ...teams,
    resultOpen: true,
    scorersA: normalizeScorerEntries(teams.scorersA.length ? teams.scorersA : teams.result?.scorersA?.length ? teams.result.scorersA : []),
    scorersB: normalizeScorerEntries(teams.scorersB.length ? teams.scorersB : teams.result?.scorersB?.length ? teams.result.scorersB : [])
  }));
  markNotificationsReadForMatch(state.currentTeams.id);
  persist();
  return true;
}

export function renderResultSection(els) {
  if (!state.currentTeams || !state.currentTeams.resultOpen) return;
  const result = state.currentTeams.result;
  if (!result) {
    els.autoScore.checked = true;
  }
  if (result) {
    els.teamAScore.value = String(Number(result.scoreA) || 0);
    els.teamBScore.value = String(Number(result.scoreB) || 0);
  }
  if (result?.manOfTheMatch) {
    els.motmSelect.value = result.manOfTheMatch;
  } else if (state.currentTeams.liveMotmId) {
    els.motmSelect.value = state.currentTeams.liveMotmId;
  }
  renderScorerRows(els, "a");
  renderScorerRows(els, "b");
  if (!result) updateScoreFromScorers(els);
  else syncScorerControls(els);
}

export function renderScorerRows(els, teamKey) {
  const list = teamKey === "a" ? els.teamAScorers : els.teamBScorers;
  const scorers = getScorerEntries(teamKey);
  list.innerHTML = "";

  if (!scorers.length) {
    list.appendChild(createEmptyScorerState());
    updateRemainingGoalsLabel(els, teamKey);
    return;
  }

  scorers.forEach((entry, index) => {
    const row = document.createElement("div");
    row.className = "scorer-row";
    row.innerHTML = `
      <select aria-label="${teamKey === "a" ? "Team A" : "Team B"} scorer ${index + 1}">
        <option value="">Select scorer</option>
        <option value="${OWN_GOAL_ID}" ${entry.playerId === OWN_GOAL_ID ? "selected" : ""}>Own Goal</option>
        ${scorerOptionPlayers(teamKey)
          .map((player) => `<option value="${player.id}" ${player.id === entry.playerId ? "selected" : ""}>${escapeHtml(player.name)}</option>`)
          .join("")}
      </select>
      <div class="scorer-stepper" aria-label="${teamKey === "a" ? "Team A" : "Team B"} scorer ${index + 1} goal count">
        <button class="secondary compact-button scorer-stepper-button" type="button" data-stepper-action="decrease">-</button>
        <span class="scorer-stepper-value">${Math.max(1, Number(entry.goals) || 1)}</span>
        <button class="secondary compact-button scorer-stepper-button" type="button" data-stepper-action="increase">+</button>
      </div>
      <button class="ghost danger compact-button scorer-remove-button" type="button">Remove</button>
    `;
    row.querySelector("select").addEventListener("change", (event) => {
      updateScorerEntry(teamKey, index, { playerId: event.target.value || "", goals: entry.goals || 1 });
      syncScorerControls(els);
    });
    row.querySelector('[data-stepper-action="decrease"]').addEventListener("click", () => {
      const currentEntry = getScorerEntries(teamKey)[index];
      const nextGoals = Math.max(1, clampGoals(currentEntry?.goals) - 1);
      updateScorerEntry(teamKey, index, { playerId: currentEntry?.playerId || "", goals: nextGoals });
      renderScorerRows(els, teamKey);
      syncScorerControls(els);
    });
    row.querySelector('[data-stepper-action="increase"]').addEventListener("click", () => {
      if (!canIncreaseGoals(teamKey, index, els)) {
        syncScorerControls(els);
        return;
      }
      const currentEntry = getScorerEntries(teamKey)[index];
      const nextGoals = clampGoals(currentEntry?.goals) + 1;
      updateScorerEntry(teamKey, index, { playerId: currentEntry?.playerId || "", goals: nextGoals });
      renderScorerRows(els, teamKey);
      syncScorerControls(els);
    });
    row.querySelector(".scorer-remove-button").addEventListener("click", () => {
      updateTeams((teams) => {
        const key = teamKey === "a" ? "scorersA" : "scorersB";
        const nextScorers = normalizeScorerEntries(teams[key]);
        nextScorers.splice(index, 1);
        return { ...teams, [key]: nextScorers };
      });
      renderScorerRows(els, teamKey);
      syncScorerControls(els);
    });
    list.appendChild(row);
  });

  updateRemainingGoalsLabel(els, teamKey);
}

function createEmptyScorerState() {
  const container = document.createElement("div");
  container.className = "empty-state";
  container.innerHTML = `
    <strong>No scorers yet</strong>
    <p>Use + Add scorer for each goal.</p>
  `;
  return container;
}

export function addScorerRow(els, teamKey) {
  if (!state.currentTeams) return;
  if (!canAddScorer(teamKey, els)) {
    syncScorerControls(els);
    return;
  }
  updateTeams((teams) => ({
    ...teams,
    [teamKey === "a" ? "scorersA" : "scorersB"]: [...normalizeScorerEntries(teamKey === "a" ? teams.scorersA : teams.scorersB), { playerId: "", goals: 1 }]
  }));
  renderScorerRows(els, teamKey);
  syncScorerControls(els);
}

export function teamPlayers(teamKey) {
  if (!state.currentTeams) return [];
  return teamKey === "a" ? state.currentTeams.teamA : state.currentTeams.teamB;
}

function scorerOptionPlayers(teamKey) {
  const team = teamKey === "a" ? state.currentTeams?.teamA : state.currentTeams?.teamB;
  const seenPlayerIds = new Set();
  return [...(Array.isArray(team) ? team : [])].filter((player) => {
    const playerId = String(player?.id || "").trim();
    if (!playerId || playerId === OWN_GOAL_ID || seenPlayerIds.has(playerId)) return false;
    seenPlayerIds.add(playerId);
    return true;
  });
}

export function selectedScorers(teamKey) {
  return getScorerEntries(teamKey).filter((entry) => entry.playerId);
}

export function updateScoreFromScorers(els) {
  if (!state.currentTeams) return;
  els.teamAScore.value = String(calculateTeamScore("a"));
  els.teamBScore.value = String(calculateTeamScore("b"));
  syncScorerControls(els);
}

export function updateTotalGoalLabel(els) {
  const totalGoals = getScore(els, "a") + getScore(els, "b");
  els.scoreTotalLabel.textContent = `${totalGoals} total ${totalGoals === 1 ? "goal" : "goals"}`;
}

export function saveMatchResult(event, els) {
  event.preventDefault();
  if (!state.currentTeams) return false;
  const status = getMatchStatus(state.currentTeams);
  if (status !== "pending_result" && status !== "completed") return false;

  const teamAScore = getScore(els, "a");
  const teamBScore = getScore(els, "b");
  const teamAGoals = calculateTeamScore("a");
  const teamBGoals = calculateTeamScore("b");

  if (!validateScorersAgainstScore("a", teamAScore).ok || !validateScorersAgainstScore("b", teamBScore).ok || hasIncompleteEntries("a") || hasIncompleteEntries("b")) {
    alert("Scorer entries must match the final score before saving.");
    return false;
  }

  if (teamAGoals !== teamAScore || teamBGoals !== teamBScore) {
    alert("Scorer entries must match the final score before saving.");
    return false;
  }

  const motmId = els.motmSelect.value || "";
  if (!motmId) {
    alert("Select Man of the Match before saving.");
    return false;
  }

  const matchPlayers = getCurrentMatchPlayers();
  const persistedMatchPlayers = matchPlayers.filter((player) => !player.isGuest);
  const persistedPlayerIds = new Set(persistedMatchPlayers.map((player) => player.id));
  const result = {
    scoreA: teamAScore,
    scoreB: teamBScore,
    scorersA: selectedScorers("a").filter((entry) => entry.playerId === OWN_GOAL_ID || persistedPlayerIds.has(entry.playerId)),
    scorersB: selectedScorers("b").filter((entry) => entry.playerId === OWN_GOAL_ID || persistedPlayerIds.has(entry.playerId)),
    manOfTheMatch: persistedPlayerIds.has(motmId) ? motmId : ""
  };

  updateTeams((teams) => ({
    ...teams,
    teamA: teams.teamA,
    teamB: teams.teamB,
    captainAId: persistedPlayerIds.has(teams.captainAId) ? teams.captainAId : "",
    captainBId: persistedPlayerIds.has(teams.captainBId) ? teams.captainBId : "",
    status: "completed",
    result,
    scorersA: result.scorersA,
    scorersB: result.scorersB,
    resultOpen: false,
    liveMotmId: result.manOfTheMatch
  }));

  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] saveMatchResult payload`, {
    matchId: state.currentTeams.id,
    originalEditingMatchId: state.currentTeams.originalEditingMatchId || "",
    createdBy: state.currentTeams.createdBy || "",
    signedInProfileId: state.data.authProfileId || state.data.currentUserId || "",
    isUpdate: isUuid(state.currentTeams.id),
    status: "completed",
    scorerIdsA: result.scorersA.map((entry) => entry.playerId),
    scorerIdsB: result.scorersB.map((entry) => entry.playerId),
    motmId: result.manOfTheMatch,
    result
  });

  persistCurrentMatch({
    status: "completed",
    saveReason: "result",
    auditAction: "result_saved",
    logAction: "result_saved",
    auditDetails: {
      scoreA: result.scoreA,
      scoreB: result.scoreB,
      manOfTheMatch: result.manOfTheMatch
    }
  });
  syncCurrentMatchIntoState();
  rebuildPlayerStatsFromCompletedMatches();
  refreshResultNotifications(state.currentTeams);
  persist();

  debugLog("match result saved", {
    matchId: state.currentTeams?.id,
    scoreA: result.scoreA,
    scoreB: result.scoreB,
    manOfTheMatch: result.manOfTheMatch || null
  });
  return true;
}

export function addLiveGoal(teamKey, playerId) {
  if (!state.currentTeams || !playerId) return false;
  const timestamp = Date.now();
  updateTeams((teams) => ({
    ...teams,
    [teamKey === "a" ? "scorersA" : "scorersB"]: [...normalizeScorerEntries(teamKey === "a" ? teams.scorersA : teams.scorersB), { playerId, goals: 1 }],
    lastGoal: { teamKey, playerId, timestamp }
  }));
  persistCurrentMatch();
  logActivity("live_goal_added", "match", state.currentTeams.id, { teamKey, playerId });
  persist();
  debugLog("live goal added", {
    matchId: state.currentTeams?.id,
    team: teamKey,
    playerId
  });
  return true;
}

export function setLiveMotm(playerId) {
  if (!state.currentTeams) return;
  updateTeams((teams) => ({
    ...teams,
    liveMotmId: playerId || ""
  }));
  persistCurrentMatch();
  logActivity("live_motm_changed", "match", state.currentTeams.id, { playerId });
  persist();
}

export function completeLiveMatch(motmId) {
  if (!state.currentTeams) {
    return { ok: false, message: "No live match found." };
  }

  updateTeams((teams) => ({
    ...teams,
    status: "pending_result",
    resultOpen: true,
    liveMotmId: motmId || teams.liveMotmId || "",
    scorersA: normalizeScorerEntries(teams.scorersA).filter((entry) => entry.playerId),
    scorersB: normalizeScorerEntries(teams.scorersB).filter((entry) => entry.playerId),
    lastGoal: null
  }));

  persistCurrentMatch({
    status: "pending_result",
    liveMotmId: motmId || state.currentTeams.liveMotmId || "",
    saveReason: "result",
    auditAction: "match_edited",
    logAction: "match_edited",
    auditDetails: { status: "pending_result" }
  });
  syncCurrentMatchIntoState();
  addPendingResultNotification(state.currentTeams);
  persist();

  debugLog("live match moved to pending result", {
    matchId: state.currentTeams?.id,
    scoreA: scorerGoalTotal(state.currentTeams.scorersA || []),
    scoreB: scorerGoalTotal(state.currentTeams.scorersB || [])
  });
  return { ok: true };
}

export function markCurrentMatchPendingResult() {
  if (!state.currentTeams) return false;
  updateTeams((teams) => ({
    ...teams,
    status: "pending_result",
    resultOpen: true
  }));
  persistCurrentMatch({
    status: "pending_result",
    saveReason: "result",
    auditAction: "match_edited",
    logAction: "match_edited",
    auditDetails: { status: "pending_result" }
  });
  syncCurrentMatchIntoState();
  addPendingResultNotification(state.currentTeams);
  persist();
  return true;
}

export function getScore(els, team) {
  const input = team === "a" ? els.teamAScore : els.teamBScore;
  return Math.max(0, Number(input.value) || 0);
}

function rebuildPlayerStatsFromCompletedMatches() {
  const nextStatsByPlayerId = Object.fromEntries(
    state.data.players.map((player) => [player.id, createDefaultPlayerStats()])
  );

  state.data.matches.forEach((match) => {
    normalizeStoredMatch(match);
    if (getMatchStatus(match) !== "completed" || !match.result) return;
    const result = match.result;
    const goalsByPlayer = countScorers([...(result.scorersA || []), ...(result.scorersB || [])]);
    const teamAIds = new Set((match.teamAPlayers || []).map((player) => player.id));
    const teamBIds = new Set((match.teamBPlayers || []).map((player) => player.id));
    const outcome = getMatchOutcome(Number(result.scoreA) || 0, Number(result.scoreB) || 0);
    const allPlayers = [...(match.teamAPlayers || []), ...(match.teamBPlayers || [])];

    allPlayers.forEach((player) => {
      const stats = nextStatsByPlayerId[player.id];
      if (!stats) return;
      const teamKey = teamAIds.has(player.id) ? "a" : teamBIds.has(player.id) ? "b" : "";
      stats.matches += 1;
      stats.wins += outcome === teamKey ? 1 : 0;
      stats.draws += outcome === "draw" ? 1 : 0;
      stats.losses += outcome !== "draw" && outcome !== teamKey ? 1 : 0;
      stats.goals += goalsByPlayer[player.id] || 0;
      stats.motm += player.id === result.manOfTheMatch ? 1 : 0;
      stats.cleanSheets += getCleanSheetIncrement(player, teamKey, result);
    });
  });

  setPlayers(
    state.data.players.map((player) => ({
      ...player,
      stats: nextStatsByPlayerId[player.id] || createDefaultPlayerStats()
    }))
  );
}

function getScorerEntries(teamKey) {
  if (!state.currentTeams) return [];
  return normalizeScorerEntries(teamKey === "a" ? state.currentTeams.scorersA : state.currentTeams.scorersB);
}

function updateScorerEntry(teamKey, index, nextEntry) {
  updateTeams((teams) => {
    const key = teamKey === "a" ? "scorersA" : "scorersB";
    const nextScorers = normalizeScorerEntries(teams[key]);
    nextScorers[index] = {
      playerId: String(nextEntry.playerId || "").trim(),
      goals: clampGoals(nextEntry.goals)
    };
    return { ...teams, [key]: nextScorers };
  });
}

function sumSelectedGoals(teamKey) {
  return selectedScorers(teamKey).reduce((total, entry) => total + clampGoals(entry.goals), 0);
}

function sumOwnGoals(teamKey) {
  return selectedScorers(teamKey)
    .filter((entry) => entry.playerId === OWN_GOAL_ID)
    .reduce((total, entry) => total + clampGoals(entry.goals), 0);
}

function sumDirectGoals(teamKey) {
  return selectedScorers(teamKey)
    .filter((entry) => entry.playerId !== OWN_GOAL_ID)
    .reduce((total, entry) => total + clampGoals(entry.goals), 0);
}

function sumCreditedGoals(teamKey) {
  const oppositeTeamKey = teamKey === "a" ? "b" : "a";
  return sumDirectGoals(teamKey) + sumOwnGoals(oppositeTeamKey);
}

export function calculateTeamScore(teamKey) {
  if (!state.currentTeams) return 0;
  return getScorerEntries(teamKey)
    .filter((entry) => entry.playerId && entry.playerId !== OWN_GOAL_ID)
    .reduce((total, entry) => total + clampGoals(entry.goals), 0)
    + getScorerEntries(teamKey === "a" ? "b" : "a")
      .filter((entry) => entry.playerId === OWN_GOAL_ID)
      .reduce((total, entry) => total + clampGoals(entry.goals), 0);
}

function clampGoals(value) {
  return Math.max(1, Math.floor(Number(value) || 1));
}

function validateScorersAgainstScore(teamKey, scoreOverride) {
  const selected = selectedScorers(teamKey);
  const totalGoals = calculateTeamScore(teamKey);
  const score = typeof scoreOverride === "number" ? scoreOverride : getScoreFromState(teamKey);

  for (const entry of selected) {
    if (!entry.playerId) return { ok: false, totalGoals };
    if (clampGoals(entry.goals) <= 0) return { ok: false, totalGoals };
    if (entry.playerId === OWN_GOAL_ID) continue;
    if (!teamPlayers(teamKey).some((player) => player.id === entry.playerId)) return { ok: false, totalGoals };
  }

  if (totalGoals > score) return { ok: false, totalGoals };
  return { ok: true, totalGoals };
}

function canAddScorer(teamKey, els) {
  if (hasIncompleteEntries(teamKey)) return false;
  if (els.autoScore.checked) return true;
  return getRemainingGoals(teamKey, els) > 0;
}

function getRemainingGoals(teamKey, els) {
  const score = getScore(els, teamKey);
  return Math.max(0, score - calculateTeamScore(teamKey));
}

function getMatchRemainingGoals(els) {
  const matchScoreTotal = getScore(els, "a") + getScore(els, "b");
  return Math.max(0, matchScoreTotal - (sumSelectedGoals("a") + sumSelectedGoals("b")));
}

function getScoreFromState(teamKey) {
  const result = state.currentTeams?.result;
  return teamKey === "a" ? Number(result?.scoreA) || 0 : Number(result?.scoreB) || 0;
}

function updateRemainingGoalsLabel(els, teamKey) {
  const remainingNode = teamKey === "a" ? els.teamAScorersRemaining : els.teamBScorersRemaining;
  if (!remainingNode) return;
  const remaining = getRemainingGoals(teamKey, els);
  remainingNode.textContent = `Remaining goals: ${remaining}`;
}

function syncScorerControls(els) {
  els.teamAScore.disabled = els.autoScore.checked;
  els.teamBScore.disabled = els.autoScore.checked;
  updateTotalGoalLabel(els);
  updateRemainingGoalsLabel(els, "a");
  updateRemainingGoalsLabel(els, "b");

  const teamAValid = validateScorersAgainstScore("a", getScore(els, "a")).ok;
  const teamBValid = validateScorersAgainstScore("b", getScore(els, "b")).ok;
  els.addTeamAScorer.disabled = !canAddScorer("a", els) || (!teamAValid && !els.autoScore.checked && getRemainingGoals("a", els) === 0);
  els.addTeamBScorer.disabled = !canAddScorer("b", els) || (!teamBValid && !els.autoScore.checked && getRemainingGoals("b", els) === 0);
}

function hasIncompleteEntries(teamKey) {
  return getScorerEntries(teamKey).some((entry) => !entry.playerId);
}

function canIncreaseGoals(teamKey, scorerIndex, els) {
  if (els.autoScore.checked) return true;
  const currentEntry = getScorerEntries(teamKey)[scorerIndex];
  const affectedTeamKey = currentEntry?.playerId === OWN_GOAL_ID ? (teamKey === "a" ? "b" : "a") : teamKey;
  const score = getScore(els, affectedTeamKey);
  const currentGoals = clampGoals(currentEntry?.goals);
  const currentTotal = calculateTeamScore(affectedTeamKey);
  return currentTotal - currentGoals + (currentGoals + 1) <= score;
}

function syncCurrentMatchIntoState() {
  if (!state.currentTeams) return;
  const existingMatch = state.data.matches.find((match) => match.id === state.currentTeams?.id);
  if (!existingMatch) return;
  setMatches(state.data.matches.map((match) => (match.id === existingMatch.id ? existingMatch : match)));
}

function getMatchOutcome(scoreA, scoreB) {
  if (scoreA === scoreB) return "draw";
  return scoreA > scoreB ? "a" : "b";
}

function getCleanSheetIncrement(player, teamKey, result) {
  if (!isGoalkeeperPlayer(player)) return 0;
  const conceded = teamKey === "a" ? result.scoreB : result.scoreA;
  return conceded === 0 ? 1 : 0;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(String(value || ""));
}

function addPendingResultNotification(match) {
  if (!match?.id) return;
  addNotification({
    id: `pending-result-${match.id}`,
    matchId: match.id,
    type: "pending_result",
    message: "Match finished - add result",
    read: false,
    createdAt: new Date().toISOString()
  });
}

function addResultAddedNotification(match) {
  if (!match?.id) return;
  addNotification({
    id: `result-added-${match.id}-${Date.now()}`,
    matchId: match.id,
    type: "result_added",
    message: "Result added",
    read: true,
    createdAt: new Date().toISOString()
  });
}

function refreshResultNotifications(match) {
  if (!match?.id) return;
  removeNotification(`pending-result-${match.id}`);
  markNotificationsReadForMatch(match.id);
  addResultAddedNotification(match);
}
