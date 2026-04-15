import { debugLog } from "./debug.js?v=match-debug-v5";
import { getFormationOptions, validateFormationString } from "./formation.js?v=match-debug-v5";
import {
  clearMatchGuestPlayers,
  clearSelectedPlayerIds,
  clearTeams,
  getCurrentUser,
  hasPermission,
  isGoalkeeperPlayer,
  normalizeScorerEntries,
  OWN_GOAL_ID,
  persist,
  setActivityLog,
  setMatches,
  setPlayers,
  setSelectedPlayerIds,
  setTeams,
  state,
  updateTeams
} from "./state.js?v=match-debug-v5";
import { makeBalancedTeams } from "./teamGenerator.js?v=match-debug-v5";
import { normalizeStoredRating } from "./utils.js?v=match-debug-v5";

const MATCH_DEBUG_VERSION = "match-debug-v5";

export function updateFormationOptions() {
  if (state.currentTeams) normalizeTeamFormations();
}

export function toggleSelectAllPlayers() {
  const selectablePlayers = state.data.players.filter((player) => player.approvalStatus === "approved");
  const allSelected =
    selectablePlayers.length > 0 && selectablePlayers.every((player) => state.selectedPlayerIds.has(player.id));
  setSelectedPlayerIds(allSelected ? [] : selectablePlayers.map((player) => player.id));
  clearTeams();
  updateFormationOptions();
}

export function getMatchSettings(matchTime = "", playerCount = null) {
  const schedule = buildMatchSchedule(matchTime);
  if (!schedule.ok) {
    return schedule;
  }
  const safePlayerCount = Number.isFinite(Number(playerCount))
    ? Number(playerCount)
    : getSelectedMatchPlayers().length;
  const teamSize = Math.ceil(safePlayerCount / 2);
  return {
    ok: true,
    matchTime: schedule.startTime,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    teamAName: "Team A",
    teamBName: "Team B",
    managerName: "",
    managerTeam: "",
    formation: getFormationOptions(teamSize)[0] || "0-0-0"
  };
}

export function syncMatchSettings(matchTime = "") {
  if (!state.currentTeams) return;
  const settings = getMatchSettings(matchTime);
  if (!settings.ok) return;
  updateTeams((teams) => ({
    ...teams,
    matchTime: settings.matchTime,
    startTime: settings.startTime,
    endTime: settings.endTime
  }));
}

export function generateTeams(matchTime = "", reshuffle = false, options = {}) {
  try {
    if (!hasPermission("createMatch")) {
      return { ok: false, message: "You do not have permission to create matches." };
    }
    const matchPlayers = getSelectedMatchPlayers();
    const playerValidation = validateSelectedPlayersForMatch(matchPlayers);
    if (!playerValidation.ok) return playerValidation;

    const settings = getMatchSettings(matchTime, matchPlayers.length);
    if (!settings.ok) {
      return settings;
    }

    const pool = [...matchPlayers].sort((a, b) => (
      normalizeStoredRating(b.rating) - normalizeStoredRating(a.rating)
      || String(a.name || "").localeCompare(String(b.name || ""))
      || String(a.id || "").localeCompare(String(b.id || ""))
    ));
    const generatedTeams = makeBalancedTeams(pool, settings.formation, {
      forceFallback: options.forceFallback,
      forcePreferredFormation: true
    });
    if (!generatedTeams.ok) {
      if (!options.forceFallback && generatedTeams.canForceFallback) {
        const teamSize = matchPlayers.length / 2;
        return {
          ok: false,
          needsFallbackConfirmation: true,
          teamSize,
          message: `No supported ${teamSize}v${teamSize} formation can be filled with the selected players using exact primary or secondary positions. Still want to create teams using best possible placement?`
        };
      }

      return {
        ok: false,
        message: generatedTeams.message || "Could not generate valid teams for the selected formation."
      };
    }

    const previousMatchId = state.currentTeams?.id || "";
    const originalMatchId = String(options.originalMatchId || "").trim();
    const editingSnapshot = options.editingMatchSnapshot || null;
    const isEditingSavedMatch = Boolean(
      originalMatchId
      || (state.currentTeams && !state.currentTeams.isDraft && state.currentTeams.status === "upcoming")
    );
    const existingMatchId = originalMatchId || ((reshuffle || isEditingSavedMatch) && state.currentTeams?.status === "upcoming"
      ? state.currentTeams.id
      : "");
    const currentUser = getCurrentUser();
    if (!currentUser) {
      return { ok: false, message: "Sign in before creating matches." };
    }
    setTeams({
      id: existingMatchId || `match-${Date.now()}`,
      originalEditingMatchId: originalMatchId,
      status: "upcoming",
      isDraft: !isEditingSavedMatch,
      createdBy: state.currentTeams?.createdBy || editingSnapshot?.createdBy || currentUser.id,
      createdByName: state.currentTeams?.createdByName || editingSnapshot?.createdByName || currentUser.name,
      createdAt: state.currentTeams?.createdAt || editingSnapshot?.createdAt || new Date().toISOString(),
      updatedBy: currentUser.id,
      updatedByName: currentUser.name,
      updatedAt: new Date().toISOString(),
      editHistory: state.currentTeams?.editHistory || editingSnapshot?.editHistory || [],
      ...settings,
      ...generatedTeams,
      formationA: generatedTeams.formation,
      formationB: generatedTeams.formation,
      captainAId: "",
      captainBId: "",
      guestPlayers: [...state.matchGuestPlayers],
      resultOpen: false,
      scorersA: [],
      scorersB: [],
      fallbackUsed: Boolean(generatedTeams.fallbackUsed)
    });

    console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] generateTeams result`, {
      previousMatchId,
      originalMatchId,
      existingMatchId,
      isEditingSavedMatch,
      reshuffle,
      isDraft: state.currentTeams?.isDraft,
      teamAPlayers: state.currentTeams?.teamA?.length || 0,
      teamBPlayers: state.currentTeams?.teamB?.length || 0
    });

    debugLog("match created", {
      id: state.currentTeams?.id,
      reshuffle,
      selectedPlayers: matchPlayers.length,
      teamASize: state.currentTeams?.teamA.length || 0,
      teamBSize: state.currentTeams?.teamB.length || 0
    });
    return { ok: true };
  } catch (error) {
    console.error("Failed to generate match teams.", error);
    return { ok: false, message: "Could not generate teams. Please try again." };
  }
}

export function validateSelectedPlayersForMatch(selectedPlayers) {
  if (selectedPlayers.length < 2) {
    return { ok: false, message: "Select at least two players to create a match." };
  }

  if (selectedPlayers.length % 2 !== 0) {
    return { ok: false, message: "Select an even number of players so both teams stay equal." };
  }

  const goalkeeperCount = selectedPlayers.filter(isGoalkeeper).length;
  if (goalkeeperCount < 2) {
    return { ok: false, message: "Select at least two goalkeepers so each team has one." };
  }

  return { ok: true };
}

function getSelectedMatchPlayers() {
  const selectedPlayers = state.data.players.filter((player) =>
    player.approvalStatus === "approved" && state.selectedPlayerIds.has(player.id)
  );
  return [...selectedPlayers, ...state.matchGuestPlayers];
}

function buildMatchSchedule(matchTime) {
  const [matchDate = "", startClock = "", endClock = ""] = String(matchTime).split("|");
  if (!matchDate && !startClock && !endClock) {
    return { ok: true, startTime: "", endTime: "" };
  }

  if (!matchDate || !startClock || !endClock) {
    return { ok: false, message: "Add a match date, start time, and end time." };
  }

  const startTime = toFloatingDateTime(matchDate, startClock);
  const endTime = toFloatingDateTime(matchDate, endClock);
  const startValue = new Date(startTime).getTime();
  const endValue = new Date(endTime).getTime();

  if (Number.isNaN(startValue) || Number.isNaN(endValue)) {
    return { ok: false, message: "Enter a valid match schedule." };
  }

  if (endValue <= startValue) {
    return { ok: false, message: "End time must be after start time." };
  }

  return { ok: true, startTime, endTime };
}

function toFloatingDateTime(matchDate, clock) {
  return `${matchDate}T${clock}:00Z`;
}

function isGoalkeeper(player) {
  return isGoalkeeperPlayer(player);
}
export function normalizeCaptains() {
  if (!state.currentTeams) return;
  updateTeams((teams) => ({
    ...teams,
    captainAId: teams.teamA.some((player) => player.id === teams.captainAId) ? teams.captainAId : "",
    captainBId: teams.teamB.some((player) => player.id === teams.captainBId) ? teams.captainBId : "",
    scorersA: normalizeScorerEntries(teams.scorersA).filter((entry) => !entry.playerId || entry.playerId === OWN_GOAL_ID || teams.teamA.some((player) => player.id === entry.playerId)),
    scorersB: normalizeScorerEntries(teams.scorersB).filter((entry) => !entry.playerId || entry.playerId === OWN_GOAL_ID || teams.teamB.some((player) => player.id === entry.playerId))
  }));
}

export function normalizeTeamFormations() {
  if (!state.currentTeams) return;
  const teamAOptions = getFormationOptions(state.currentTeams.teamA.length);
  const teamBOptions = getFormationOptions(state.currentTeams.teamB.length);
  const teamAValidation = validateFormationString(state.currentTeams.formationA, state.currentTeams.teamA.length);
  const teamBValidation = validateFormationString(state.currentTeams.formationB, state.currentTeams.teamB.length);

  if (!teamAValidation.ok) {
    console.warn(
      `normalizeTeamFormations: ${teamAValidation.message} Falling back to "${teamAValidation.fallbackFormation}" for Team A.`,
      { formation: state.currentTeams.formationA, teamSize: state.currentTeams.teamA.length, team: "A" }
    );
  }

  if (!teamBValidation.ok) {
    console.warn(
      `normalizeTeamFormations: ${teamBValidation.message} Falling back to "${teamBValidation.fallbackFormation}" for Team B.`,
      { formation: state.currentTeams.formationB, teamSize: state.currentTeams.teamB.length, team: "B" }
    );
  }

  updateTeams((teams) => ({
    ...teams,
    formationA: teamAValidation.ok
      ? teams.formationA
      : teamAValidation.fallbackFormation || teamAOptions[0],
    formationB: teamBValidation.ok
      ? teams.formationB
      : teamBValidation.fallbackFormation || teamBOptions[0]
  }));
}

export function setCaptain(teamKey, playerId) {
  if (!state.currentTeams) return;
  updateTeams((teams) => ({
    ...teams,
    captainAId: teamKey === "a" ? playerId : teams.captainAId,
    captainBId: teamKey === "b" ? playerId : teams.captainBId
  }));
}

export function resetAppData() {
  setPlayers([]);
  setMatches([]);
  setActivityLog([]);
  clearMatchGuestPlayers();
  clearTeams();
  clearSelectedPlayerIds();
  persist();
}
