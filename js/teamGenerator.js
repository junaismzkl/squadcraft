import { getFormationOptions, getFormationRoleSlots } from "./formation.js";
import { getPlayerPositions, isGoalkeeperPlayer } from "./state.js";
import { normalizeStoredRating } from "./utils.js";

export const EIGHT_V_EIGHT_SLOTS = ["GK", "WB", "CB", "WB", "CM", "WF", "CF", "WF"];
export const MAX_TEAM_RATING_DIFF = 8;

const SUPPORTED_TEAM_SIZES = new Set([5, 6, 7, 8, 9, 10, 11]);
const ROLE_DRAFT_ORDER = ["GK", "CB", "WB", "CM", "WF", "CF"];
const ROLE_ANCHOR_TEAM = {
  GK: "A",
  CB: "B",
  WB: "A",
  CM: "A",
  WF: "B",
  CF: "B"
};
const EXTREME_DRAFT_ROLES = new Set(["WB", "WF"]);
const FALLBACK_ROLE_MAP = {
  GK: [],
  CB: ["WB", "CM"],
  WB: ["CB", "CM"],
  CM: ["WB", "WF", "CB"],
  WF: ["CF", "CM", "WB"],
  CF: ["WF", "CM"]
};
const FALLBACK_FIT_SCORES = [70, 55, 40];

export function generateBalancedTeams(players, formationStr = "", options = {}) {
  const teamSize = players.length / 2;

  if (Number.isInteger(teamSize) && SUPPORTED_TEAM_SIZES.has(teamSize)) {
    const formationOptions = getFormationOptions(teamSize);
    if (options.forceFallback) {
      return generateFallbackTeams(players, formationStr, teamSize, formationOptions);
    }

    return buildFirstValidTeamsForFormation(players, teamSize, formationStr, formationOptions);
  }

  return {
    ok: false,
    message: "Select enough players for a supported 5v5 to 11v11 match."
  };
}

function buildFirstValidTeamsForFormation(players, teamSize, preferredFormation, formationOptions) {
  const candidates = getOrderedFormationOptions(preferredFormation, formationOptions);
  let lastFailure = null;

  for (const formation of candidates) {
    const slotArray = getFormationRoleSlots(formation, teamSize);
    if (!canSatisfyFormation(players, slotArray)) continue;

    const teams = buildTeamsForFormation(players, formation, teamSize);
    if (teams.ok) return teams;
    lastFailure = teams;
  }

  return lastFailure ? { ...lastFailure, canForceFallback: true } : {
    ok: false,
    canForceFallback: true,
    message: `No supported ${teamSize}v${teamSize} formation can be filled with the selected players using exact primary or secondary positions.`
  };
}

export function makeBalancedTeams(players, formationStr, options = {}) {
  const teams = generateBalancedTeams(players, formationStr, options);
  if (!teams.ok) return teams;

  return {
    ...teams,
    formation: teams.formation || formationStr
  };
}

export function generateFallbackTeams(players, preferredFormation, teamSize, formationOptions = getFormationOptions(teamSize)) {
  const candidates = getOrderedFormationOptions(preferredFormation, formationOptions);
  const fallbackResults = candidates
    .map((formation, order) => {
      const slotArray = getFormationRoleSlots(formation, teamSize);
      const lineups = assignBestPossibleLineups(players, slotArray);
      return {
        formation,
        order,
        slotArray,
        ...lineups
      };
    })
    .filter((result) => result.ok)
    .sort(compareFallbackResults);

  const bestResult = fallbackResults[0];

  if (!bestResult) {
    return {
      ok: false,
      message: `Could not create ${teamSize}v${teamSize} teams because goalkeeper slots could not be filled.`
    };
  }

  const finalized = finalizeFallbackResult(bestResult, players, teamSize);

  if (!finalized.ok) {
    return {
      ok: false,
      message: `Could not create complete ${teamSize}v${teamSize} teams after fallback slot assignment.`
    };
  }

  balanceTeamsAfterFallback(finalized.lineupA, finalized.lineupB);

  if (!validateCompleteLineup(finalized.lineupA, bestResult.slotArray).ok || !validateCompleteLineup(finalized.lineupB, bestResult.slotArray).ok) {
    return {
      ok: false,
      message: `Could not create complete ${teamSize}v${teamSize} teams without leaving empty slots.`
    };
  }

  return {
    ok: true,
    fallbackUsed: true,
    formation: bestResult.formation,
    teamA: finalized.lineupA.map((slot) => slot.player),
    teamB: finalized.lineupB.map((slot) => slot.player),
    lineupA: finalized.lineupA,
    lineupB: finalized.lineupB
  };
}

export function teamRating(players) {
  return players.reduce((sum, player) => sum + getRating(player), 0);
}

export function balanceLabel(difference) {
  if (difference <= 2) return "Balanced";
  if (difference <= 5) return "Close";
  return "Needs balance";
}

export function goalkeeperNote(teams) {
  const aHasKeeper = teams.teamA.some((player) => isGoalkeeperPlayer(player));
  const bHasKeeper = teams.teamB.some((player) => isGoalkeeperPlayer(player));
  if (aHasKeeper && bHasKeeper) return "Each team has a goalkeeper.";
  if (aHasKeeper || bHasKeeper) return "Only one goalkeeper was selected.";
  return "No goalkeepers selected.";
}

export function build8v8TeamsCustom(players) {
  return buildTeamsForFormation(players, "3-1-3", 8);
}

export function buildTeamsForFormation(players, formationStr, teamSize) {
  const slotArray = getFormationRoleSlots(formationStr, teamSize);

  if (slotArray.length !== teamSize) {
    return {
      ok: false,
      message: `Could not resolve valid ${teamSize}v${teamSize} slots for formation ${formationStr}.`
    };
  }

  const availablePlayers = [...players].sort(comparePlayersByRating);
  const roleCounts = getRoleCounts(slotArray);
  const pickedA = createRolePickMap(slotArray);
  const pickedB = createRolePickMap(slotArray);

  for (const role of getScarcitySortedRoles(roleCounts, availablePlayers)) {
    const countA = roleCounts[role] || 0;
    const countB = roleCounts[role] || 0;
    if (!countA && !countB) continue;

    const candidates = getRoleCandidates(availablePlayers, role, countA + countB);
    if (candidates.length < countA + countB) {
      return {
        ok: false,
        message: `Not enough valid ${role} players for the ${teamSize}v${teamSize} ${formationStr} lineup. Add players with ${role} as a primary or secondary position.`
      };
    }

    const distribution = distributeRoleAcrossTeams(role, candidates, countA, countB);
    pickedA[role].push(...distribution.teamA);
    pickedB[role].push(...distribution.teamB);
    [...distribution.teamA, ...distribution.teamB].forEach((player) => removeAssignedPlayer(availablePlayers, player.id));
  }

  const lineupA = assignSlotsFromRolePicks(slotArray, pickedA);
  const lineupB = assignSlotsFromRolePicks(slotArray, pickedB);

  if (!lineupA.every((slot) => slot.player) || !lineupB.every((slot) => slot.player)) {
    return {
      ok: false,
      message: `Could not build complete ${teamSize}v${teamSize} teams without using invalid positions.`
    };
  }

  balanceTeamsByExactRoleSwap(lineupA, lineupB);

  return {
    ok: true,
    formation: formationStr,
    teamA: lineupA.map((slot) => slot.player),
    teamB: lineupB.map((slot) => slot.player),
    lineupA,
    lineupB
  };
}

export function findFirstValidFormation(players, teamSize, preferredFormation, formationOptions = getFormationOptions(teamSize)) {
  const candidates = getOrderedFormationOptions(preferredFormation, formationOptions);

  return candidates.find((formation) => {
    const slotArray = getFormationRoleSlots(formation, teamSize);
    return canSatisfyFormation(players, slotArray);
  }) || "";
}

export function canSatisfyFormation(players, slotArray) {
  if (!Array.isArray(slotArray) || !slotArray.length) return false;

  const roleNeeds = multiplyRoleNeeds(countFormationNeeds(slotArray), 2);
  const availablePlayers = [...players].sort(comparePlayersByRating);

  return getScarcitySortedRoles(roleNeeds, availablePlayers).every((role) => {
    const needed = roleNeeds[role] || 0;
    if (!needed) return true;

    const candidates = getExactRoleCandidates(availablePlayers, role);
    if (candidates.length < needed) return false;

    candidates.slice(0, needed).forEach((candidate) => removeAssignedPlayer(availablePlayers, candidate.player.id));
    return true;
  });
}

export function getExactRoleCandidates(players, role) {
  return getRoleCandidates(players, role, Number.MAX_SAFE_INTEGER);
}

export function countFormationNeeds(slotArray) {
  return slotArray.reduce((counts, role) => {
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}

export function getRoleCandidates(players, role, needed = 1) {
  const primaryMatches = [];
  const secondaryMatches = [];

  players.forEach((player) => {
    const positions = getNormalizedPlayerPositions(player);
    if (positions[0] === role) {
      primaryMatches.push({ player, role, matchType: "primary" });
      return;
    }

    if (positions.slice(1).includes(role)) {
      secondaryMatches.push({ player, role, matchType: "secondary" });
    }
  });

  const candidates = primaryMatches.length >= needed ? primaryMatches : [...primaryMatches, ...secondaryMatches];
  return sortCandidatesDeterministic(candidates, role, "desc");
}

export function sortCandidatesDeterministic(candidates, role, direction = "desc") {
  const ratingDirection = direction === "asc" ? 1 : -1;
  return [...candidates]
    .filter((candidate) => candidate.role === role)
    .sort((a, b) => (
      getMatchRank(a) - getMatchRank(b)
      || ratingDirection * (getRating(a.player) - getRating(b.player))
      || getPlayerName(a.player).localeCompare(getPlayerName(b.player))
      || getPlayerId(a.player).localeCompare(getPlayerId(b.player))
    ));
}

export function sortRoleCandidates(candidates, role, direction = "desc") {
  return sortCandidatesDeterministic(candidates, role, direction);
}

export function pickStrongest(candidates) {
  return sortCandidatesDeterministic(candidates, candidates[0]?.role, "desc")[0]?.player || null;
}

export function pickWeakest(candidates) {
  return sortCandidatesDeterministic(candidates, candidates[0]?.role, "asc")[0]?.player || null;
}

export function pickHighest(candidates) {
  const player = pickStrongest(candidates);
  return player ? candidates.find((candidate) => candidate.player.id === player.id) : null;
}

export function pickLowest(candidates) {
  const player = pickWeakest(candidates);
  return player ? candidates.find((candidate) => candidate.player.id === player.id) : null;
}

export function pickMedianSet(candidates, count) {
  const sorted = sortCandidatesDeterministic(candidates, candidates[0]?.role, "asc");
  if (count <= 0) return [];
  if (sorted.length <= count) return sorted.map((candidate) => candidate.player);

  const start = Math.max(0, Math.ceil((sorted.length - count) / 2));
  return sorted.slice(start, start + count).map((candidate) => candidate.player);
}

export function pickMedianPair(candidates) {
  return pickMedianSet(candidates, 2)
    .map((player) => candidates.find((candidate) => candidate.player.id === player.id))
    .filter(Boolean);
}

export function pickAlternatingHighLow(candidates, count) {
  const sorted = sortCandidatesDeterministic(candidates, candidates[0]?.role, "asc");
  const selected = [];
  let low = 0;
  let high = sorted.length - 1;

  while (selected.length < count && low <= high) {
    selected.push(sorted[high--].player);
    if (selected.length < count && low <= high) {
      selected.push(sorted[low++].player);
    }
  }

  return selected;
}

function pickAnchorSet(candidates, role, count) {
  if (count <= 0) return [];
  if (count === 1) return [pickStrongest(candidates)].filter(Boolean);
  if (EXTREME_DRAFT_ROLES.has(role)) return pickAlternatingHighLow(candidates, count);

  const strongest = pickStrongest(candidates);
  const remaining = withoutPlayers(candidates, [strongest]);
  return [
    strongest,
    ...pickAlternatingHighLow(remaining, count - 1)
  ].filter(Boolean);
}

function pickBalancedSupportSet(candidates, count) {
  if (count <= 0) return [];
  if (count === 1) return [pickStrongest(candidates)].filter(Boolean);
  return pickMedianSet(candidates, count);
}

export function distributeRoleAcrossTeams(role, candidates, countA, countB) {
  const anchorTeam = ROLE_ANCHOR_TEAM[role] || "A";
  const anchorCount = anchorTeam === "A" ? countA : countB;
  const supportCount = anchorTeam === "A" ? countB : countA;
  const anchorPlayers = takePlayers(
    candidates,
    pickAnchorSet(candidates, role, anchorCount),
    anchorCount
  );
  const remaining = withoutPlayers(candidates, anchorPlayers);
  const supportPlayers = takePlayers(
    remaining,
    pickBalancedSupportSet(remaining, supportCount),
    supportCount
  );

  return anchorTeam === "A"
    ? { teamA: anchorPlayers, teamB: supportPlayers }
    : { teamA: supportPlayers, teamB: anchorPlayers };
}

export function assignSlotsFromRolePicks(slotArray, pickedPlayersByRole) {
  const remainingByRole = Object.fromEntries(
    Object.entries(pickedPlayersByRole).map(([role, players]) => [role, [...players]])
  );

  return slotArray.map((position) => {
    const player = remainingByRole[position]?.shift() || null;
    return {
      position,
      player: player ? withAssignedPosition(player, position) : null
    };
  });
}

export function assignPlayerToSlot(slot, player) {
  slot.player = withAssignedPosition(player, slot.position);
}

export function assignBestPossibleLineup(players, slotArray) {
  return assignBestPossibleLineups(players, slotArray);
}

export function clearAssignedPosition(player) {
  const { assignedPosition, assignedSlotIndex, assignmentType, ...rest } = player || {};
  return rest;
}

export function regenerateTeamLineup(teamPlayers, formationStr) {
  const freshPlayers = [...(Array.isArray(teamPlayers) ? teamPlayers : [])].map(clearAssignedPosition);
  const slotArray = getFormationRoleSlots(formationStr, freshPlayers.length);

  if (slotArray.length !== freshPlayers.length) {
    return {
      ok: false,
      message: "Formation slot count does not match team player count.",
      players: teamPlayers
    };
  }

  const strictLineup = tryAssignExactLineup(freshPlayers, slotArray);
  const strictValidation = validateCompleteLineupForPlayers(strictLineup, slotArray, freshPlayers);
  if (strictValidation.ok) {
    return {
      ok: true,
      players: strictLineup.map((slot) => slot.player),
      lineup: strictLineup,
      fallbackUsed: false
    };
  }

  const fallbackLineup = ensureNoEmptySlots(strictLineup, freshPlayers, slotArray, "fallback");
  const fallbackValidation = validateCompleteLineupForPlayers(fallbackLineup, slotArray, freshPlayers);
  if (!fallbackValidation.ok) {
    return {
      ok: false,
      message: fallbackValidation.message,
      players: teamPlayers
    };
  }

  return {
    ok: true,
    players: fallbackLineup.map((slot) => slot.player),
    lineup: fallbackLineup,
    fallbackUsed: true
  };
}

export function finalizeCompleteLineup(teamPlayers, slotArray, mode = "fallback") {
  const lineup = slotArray.map((position, index) => ({
    position,
    player: teamPlayers[index] ? withAssignedPosition(teamPlayers[index], position) : null
  }));
  return ensureNoEmptySlots(lineup, teamPlayers, slotArray, mode);
}

export function fillEmptySlots(lineup, remainingPlayers) {
  const assignedIds = new Set(lineup.filter((slot) => slot.player).map((slot) => slot.player.id));

  lineup.forEach((slot) => {
    if (slot.player) return;
    const player = getBestFallbackPlayerForSlot(
      remainingPlayers.filter((candidate) => !assignedIds.has(candidate.id)),
      slot.position
    );
    if (!player) return;

    slot.player = withAssignedPosition(player, slot.position, getAssignmentTypeForSlot(player, slot.position));
    assignedIds.add(player.id);
    removeAssignedPlayer(remainingPlayers, player.id);
  });

  return lineup;
}

export function getBestFallbackPlayerForSlot(players, slotRole) {
  return getFallbackCandidates(players, slotRole)[0]?.player || null;
}

export function ensureNoEmptySlots(lineup, teamPlayers, slotArray, mode = "fallback") {
  const usedIds = new Set();
  const sanitizedLineup = lineup.map((slot) => {
    if (!slot.player || usedIds.has(slot.player.id)) {
      return { ...slot, player: null };
    }

    usedIds.add(slot.player.id);
    return slot;
  });
  const remainingPlayers = teamPlayers
    .filter((player) => !usedIds.has(player.id))
    .sort(comparePlayersByRating);
  const normalizedLineup = slotArray.map((position, index) => ({
    position,
    player: sanitizedLineup[index]?.player ? withAssignedPosition(sanitizedLineup[index].player, position, sanitizedLineup[index].player.assignmentType) : null
  }));

  if (mode === "fallback") {
    fillEmptySlots(normalizedLineup, remainingPlayers);
  }

  return normalizedLineup;
}

export function validateCompleteLineup(lineup, slotArray) {
  if (!Array.isArray(lineup) || lineup.length !== slotArray.length) {
    return { ok: false, message: "Lineup length does not match formation slots." };
  }

  const playerIds = new Set();

  for (let index = 0; index < slotArray.length; index += 1) {
    const slot = lineup[index];
    if (slot?.position !== slotArray[index] || !slot.player) {
      return { ok: false, message: "Lineup has an empty or mismatched slot." };
    }

    if (playerIds.has(slot.player.id)) {
      return { ok: false, message: "Lineup contains duplicate players." };
    }

    playerIds.add(slot.player.id);
  }

  return { ok: true };
}

export function validateCompleteLineupForPlayers(lineup, slotArray, teamPlayers) {
  const lineupValidation = validateCompleteLineup(lineup, slotArray);
  if (!lineupValidation.ok) return lineupValidation;

  const lineupPlayerIds = lineup.map((slot) => slot.player.id).sort();
  const teamPlayerIds = teamPlayers.map((player) => player.id).sort();
  if (lineupPlayerIds.length !== teamPlayerIds.length) {
    return { ok: false, message: "Lineup player count does not match team player count." };
  }

  const lostPlayerId = teamPlayerIds.find((id, index) => id !== lineupPlayerIds[index]);
  if (lostPlayerId) {
    return { ok: false, message: "Lineup rebuild would drop a team player." };
  }

  return { ok: true };
}

export function getFallbackCandidates(players, slotRole) {
  return [...players]
    .map((player) => ({
      player,
      role: slotRole,
      score: scorePlayerForSlot(player, slotRole),
      assignmentType: getAssignmentTypeForSlot(player, slotRole)
    }))
    .filter((candidate) => candidate.score > Number.NEGATIVE_INFINITY)
    .sort((a, b) => (
      b.score - a.score
      || getPlayerName(a.player).localeCompare(getPlayerName(b.player))
      || getPlayerId(a.player).localeCompare(getPlayerId(b.player))
    ));
}

export function scorePlayerForSlot(player, slotRole) {
  const fitScore = getFitScoreForSlot(player, slotRole);
  if (fitScore === Number.NEGATIVE_INFINITY) return fitScore;
  return fitScore * 1000 + getRating(player);
}

export function balanceTeamsAfterFallback(lineupA, lineupB, threshold = MAX_TEAM_RATING_DIFF) {
  let bestSwap = findBestFallbackSwap(lineupA, lineupB);

  while (bestSwap && bestSwap.currentDifference > threshold && bestSwap.nextDifference < bestSwap.currentDifference) {
    swapLineupPlayers(bestSwap.slotA, bestSwap.slotB);
    bestSwap = findBestFallbackSwap(lineupA, lineupB);
  }
}

export function removeAssignedPlayer(players, playerId) {
  const index = players.findIndex((player) => player.id === playerId);
  if (index >= 0) players.splice(index, 1);
}

export function balanceTeamsByExactRoleSwap(lineupA, lineupB, threshold = MAX_TEAM_RATING_DIFF) {
  let bestSwap = findBestExactRoleSwap(lineupA, lineupB);

  while (bestSwap && bestSwap.currentDifference > threshold && bestSwap.nextDifference < bestSwap.currentDifference) {
    swapLineupPlayers(bestSwap.slotA, bestSwap.slotB);
    bestSwap = findBestExactRoleSwap(lineupA, lineupB);
  }
}

export function balanceTeamsBySamePositionSwap(lineupA, lineupB, threshold = MAX_TEAM_RATING_DIFF) {
  balanceTeamsByExactRoleSwap(lineupA, lineupB, threshold);
}

function getRoleCounts(slotArray) {
  return slotArray.reduce((counts, role) => {
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
}

function getOrderedFormationOptions(preferredFormation, formationOptions) {
  const preferred = String(preferredFormation || "").trim();
  return [
    preferred,
    ...(formationOptions || [])
  ].filter((formation, index, formations) => formation && formations.indexOf(formation) === index);
}

function multiplyRoleNeeds(roleNeeds, multiplier) {
  return Object.fromEntries(
    Object.entries(roleNeeds).map(([role, count]) => [role, count * multiplier])
  );
}

function getScarcitySortedRoles(roleNeeds, players) {
  return ROLE_DRAFT_ORDER
    .filter((role) => roleNeeds[role] > 0)
    .sort((a, b) => (
      getExactRoleCandidates(players, a).length - getExactRoleCandidates(players, b).length
      || (roleNeeds[b] || 0) - (roleNeeds[a] || 0)
      || ROLE_DRAFT_ORDER.indexOf(a) - ROLE_DRAFT_ORDER.indexOf(b)
    ));
}

function createRolePickMap(slotArray) {
  return [...new Set(slotArray)].reduce((map, role) => {
    map[role] = [];
    return map;
  }, {});
}

function finalizeFallbackResult(result, players, teamSize) {
  const teamA = result.lineupA.map((slot) => slot.player).filter(Boolean);
  const teamB = result.lineupB.map((slot) => slot.player).filter(Boolean);
  const assignedIds = new Set([...teamA, ...teamB].map((player) => player.id));
  const remainingPlayers = players
    .filter((player) => !assignedIds.has(player.id))
    .sort(comparePlayersByRating);

  while (teamA.length < teamSize && remainingPlayers.length) {
    teamA.push(remainingPlayers.shift());
  }

  while (teamB.length < teamSize && remainingPlayers.length) {
    teamB.push(remainingPlayers.shift());
  }

  const lineupA = ensureNoEmptySlots(result.lineupA, teamA, result.slotArray, "fallback");
  const lineupB = ensureNoEmptySlots(result.lineupB, teamB, result.slotArray, "fallback");
  const validationA = validateCompleteLineup(lineupA, result.slotArray);
  const validationB = validateCompleteLineup(lineupB, result.slotArray);

  return {
    ok: teamA.length === teamSize && teamB.length === teamSize && validationA.ok && validationB.ok,
    lineupA,
    lineupB
  };
}

function assignBestPossibleLineups(players, slotArray) {
  if (!Array.isArray(slotArray) || !slotArray.length) {
    return { ok: false, score: 0, lineupA: [], lineupB: [] };
  }

  const availablePlayers = [...players].sort(comparePlayersByRating);
  const combinedSlots = [
    ...slotArray.map((position, index) => ({ team: "A", index, position, player: null })),
    ...slotArray.map((position, index) => ({ team: "B", index, position, player: null }))
  ];
  const assignmentOrder = getFallbackSlotAssignmentOrder(combinedSlots, availablePlayers);
  let score = 0;

  for (const slot of assignmentOrder) {
    const candidates = getFallbackCandidates(availablePlayers, slot.position);
    const candidate = candidates[0];

    if (!candidate) {
      return { ok: false, score: 0, lineupA: [], lineupB: [] };
    }

    slot.player = withAssignedPosition(candidate.player, slot.position, candidate.assignmentType);
    score += candidate.score;
    removeAssignedPlayer(availablePlayers, candidate.player.id);
  }

  return {
    ok: combinedSlots.every((slot) => slot.player),
    score,
    lineupA: combinedSlots
      .filter((slot) => slot.team === "A")
      .sort((a, b) => a.index - b.index)
      .map(({ position, player }) => ({ position, player })),
    lineupB: combinedSlots
      .filter((slot) => slot.team === "B")
      .sort((a, b) => a.index - b.index)
      .map(({ position, player }) => ({ position, player }))
  };
}

function tryAssignExactLineup(players, slotArray) {
  const lineup = slotArray.map((position) => ({ position, player: null }));
  const availablePlayers = [...players].sort(comparePlayersByRating);
  const roleNeeds = countFormationNeeds(slotArray);
  const rolesByScarcity = Object.keys(roleNeeds)
    .sort((a, b) => (
      getExactRoleCandidates(availablePlayers, a).length - getExactRoleCandidates(availablePlayers, b).length
      || (roleNeeds[b] || 0) - (roleNeeds[a] || 0)
      || ROLE_DRAFT_ORDER.indexOf(a) - ROLE_DRAFT_ORDER.indexOf(b)
    ));

  rolesByScarcity.forEach((role) => {
    const slotIndexes = slotArray
      .map((position, index) => ({ position, index }))
      .filter((slot) => slot.position === role)
      .map((slot) => slot.index);
    const candidates = getRoleCandidates(availablePlayers, role, slotIndexes.length);

    candidates.slice(0, slotIndexes.length).forEach((candidate, index) => {
      const slotIndex = slotIndexes[index];
      lineup[slotIndex].player = withAssignedPosition(candidate.player, role);
      removeAssignedPlayer(availablePlayers, candidate.player.id);
    });
  });

  return lineup;
}

function getFallbackSlotAssignmentOrder(slots, players) {
  return [...slots].sort((a, b) => (
    getFallbackCandidates(players, a.position).length - getFallbackCandidates(players, b.position).length
    || ROLE_DRAFT_ORDER.indexOf(a.position) - ROLE_DRAFT_ORDER.indexOf(b.position)
    || a.team.localeCompare(b.team)
    || a.index - b.index
  ));
}

function compareFallbackResults(a, b) {
  return b.score - a.score
    || a.order - b.order
    || String(a.formation).localeCompare(String(b.formation));
}

function findBestFallbackSwap(lineupA, lineupB) {
  const totalA = teamRating(lineupA.map((slot) => slot.player).filter(Boolean));
  const totalB = teamRating(lineupB.map((slot) => slot.player).filter(Boolean));
  const currentDifference = Math.abs(totalA - totalB);
  let bestSwap = null;

  lineupA.forEach((slotA) => {
    if (!slotA.player) return;

    lineupB.forEach((slotB) => {
      if (!slotB.player || slotA.position !== slotB.position) return;

      const currentFit = scorePlayerForSlot(slotA.player, slotA.position) + scorePlayerForSlot(slotB.player, slotB.position);
      const nextFit = scorePlayerForSlot(slotB.player, slotA.position) + scorePlayerForSlot(slotA.player, slotB.position);
      if (nextFit < currentFit) return;

      const nextTotalA = totalA - getRating(slotA.player) + getRating(slotB.player);
      const nextTotalB = totalB - getRating(slotB.player) + getRating(slotA.player);
      const nextDifference = Math.abs(nextTotalA - nextTotalB);

      if (
        nextDifference < currentDifference
        && (
          !bestSwap
          || nextDifference < bestSwap.nextDifference
          || (nextDifference === bestSwap.nextDifference && compareSwapTie(slotA, slotB, bestSwap) < 0)
        )
      ) {
        bestSwap = {
          slotA,
          slotB,
          currentDifference,
          nextDifference
        };
      }
    });
  });

  return bestSwap;
}

function getFitScoreForSlot(player, slotRole) {
  const positions = getNormalizedPlayerPositions(player);
  const primary = positions[0] || "";
  const secondary = positions.slice(1);

  if (primary === slotRole) return 100;
  if (secondary.includes(slotRole)) return 90;
  if (slotRole === "GK") return Number.NEGATIVE_INFINITY;

  const fallbackIndex = (FALLBACK_ROLE_MAP[slotRole] || []).findIndex((role) => positions.includes(role));
  if (fallbackIndex >= 0) return FALLBACK_FIT_SCORES[fallbackIndex] || FALLBACK_FIT_SCORES[FALLBACK_FIT_SCORES.length - 1];
  if (primary === "GK") return 1;
  return 20;
}

function getAssignmentTypeForSlot(player, slotRole) {
  const positions = getNormalizedPlayerPositions(player);
  const primary = positions[0] || "";

  if (primary === slotRole) return "exact_primary";
  if (positions.slice(1).includes(slotRole)) return "exact_secondary";
  if ((FALLBACK_ROLE_MAP[slotRole] || []).some((role) => positions.includes(role))) return "fallback_near_fit";
  if (primary === "GK" && slotRole !== "GK") return "forced_goalkeeper_outfield";
  return "out_of_position";
}

function takePlayers(candidates, players, count) {
  const candidateIds = new Set(candidates.map((candidate) => candidate.player.id));
  return players
    .filter((player) => player && candidateIds.has(player.id))
    .slice(0, count);
}

function withoutPlayers(candidates, players) {
  const playerIds = new Set(players.filter(Boolean).map((player) => player.id));
  return candidates.filter((candidate) => !playerIds.has(candidate.player.id));
}

function findBestExactRoleSwap(lineupA, lineupB) {
  const totalA = teamRating(lineupA.map((slot) => slot.player).filter(Boolean));
  const totalB = teamRating(lineupB.map((slot) => slot.player).filter(Boolean));
  const currentDifference = Math.abs(totalA - totalB);
  let bestSwap = null;

  lineupA.forEach((slotA) => {
    if (!slotA.player) return;

    lineupB.forEach((slotB) => {
      if (!slotB.player || slotA.position !== slotB.position) return;

      const nextTotalA = totalA - getRating(slotA.player) + getRating(slotB.player);
      const nextTotalB = totalB - getRating(slotB.player) + getRating(slotA.player);
      const nextDifference = Math.abs(nextTotalA - nextTotalB);

      if (
        nextDifference < currentDifference
        && (
          !bestSwap
          || nextDifference < bestSwap.nextDifference
          || (nextDifference === bestSwap.nextDifference && compareSwapTie(slotA, slotB, bestSwap) < 0)
        )
      ) {
        bestSwap = {
          slotA,
          slotB,
          currentDifference,
          nextDifference
        };
      }
    });
  });

  return bestSwap;
}

function compareSwapTie(slotA, slotB, swap) {
  return slotA.position.localeCompare(swap.slotA.position)
    || getPlayerName(slotA.player).localeCompare(getPlayerName(swap.slotA.player))
    || getPlayerName(slotB.player).localeCompare(getPlayerName(swap.slotB.player))
    || getPlayerId(slotA.player).localeCompare(getPlayerId(swap.slotA.player))
    || getPlayerId(slotB.player).localeCompare(getPlayerId(swap.slotB.player));
}

function swapLineupPlayers(slotA, slotB) {
  const playerA = slotA.player;
  const playerB = slotB.player;
  assignPlayerToSlot(slotA, playerB);
  assignPlayerToSlot(slotB, playerA);
}

function withAssignedPosition(player, position, assignmentType = null) {
  return {
    ...player,
    assignedPosition: position,
    assignmentType: assignmentType || getAssignmentTypeForSlot(player, position)
  };
}

function getNormalizedPlayerPositions(player) {
  if (Array.isArray(player?.positions)) {
    return [...new Set(player.positions.map(normalizeRole).filter(Boolean))];
  }

  return getPlayerPositions(player);
}

function normalizeRole(value) {
  const role = String(value || "").trim().toUpperCase();
  return ["GK", "CB", "WB", "CM", "WF", "CF"].includes(role) ? role : "";
}

function comparePlayersByRating(a, b) {
  return getRating(b) - getRating(a)
    || getPlayerName(a).localeCompare(getPlayerName(b))
    || getPlayerId(a).localeCompare(getPlayerId(b));
}

function getRating(player) {
  return normalizeStoredRating(player?.rating);
}

function getPlayerName(player) {
  return String(player?.name || "");
}

function getPlayerId(player) {
  return String(player?.id || "");
}

function getMatchRank(candidate) {
  return candidate?.matchType === "primary" ? 0 : 1;
}
