import { authState } from "./auth.js?v=match-debug-v5";
import { supabase } from "./supabaseClient.js?v=match-debug-v5";
import { normalizeMatchMetadata, normalizePlayerRecord, setMatches, snapshotTeam, state, updateTeams } from "./state.js?v=match-debug-v5";

const MATCHES_TABLE = "matches";
const MATCH_PLAYERS_TABLE = "match_players";
const MATCH_DEBUG_VERSION = "match-debug-v5";

export async function loadSharedMatchesIntoState() {
  if (!authState.isAuthenticated) {
    setMatches([]);
    return { ok: true, matches: [] };
  }

  const { data: matchRows, error: matchError } = await supabase
    .from(MATCHES_TABLE)
    .select("*")
    .order("match_date", { ascending: true });

  if (matchError) {
    console.warn("Could not load shared matches from Supabase.", matchError);
    return { ok: false, message: matchError.message };
  }

  const matchIds = (matchRows || []).map((match) => match.id).filter(Boolean);
  const playerRowsResult = matchIds.length
    ? await loadMatchPlayerRows(matchIds)
    : { ok: true, rows: [] };

  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] loadSharedMatchesIntoState fetched`, {
    matchRows: (matchRows || []).length,
    matchPlayerRows: (playerRowsResult.rows || []).length,
    matchIds
  });

  if (!playerRowsResult.ok) {
    console.warn("Could not load shared match players from Supabase.", playerRowsResult.error);
  }

  const playersByMatch = groupRowsByMatch(playerRowsResult.rows || []);
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] match_players grouped`, [...playersByMatch.entries()].map(([matchId, rows]) => ({
    matchId,
    rows: rows.length,
    teamA: rows.filter((row) => String(row.team || "").toUpperCase() === "A").length,
    teamB: rows.filter((row) => String(row.team || "").toUpperCase() === "B").length
  })));
  const profilesById = await loadMatchAuditProfiles(matchRows || []);
  const matches = (matchRows || []).map((matchRow) => remoteMatchToLocal(
    matchRow,
    playersByMatch.get(matchRow.id) || [],
    profilesById
  ));
  setMatches(mergeRemoteMatchesWithLocalFallback(matches));
  return { ok: true, matches: state.data.matches };
}

export async function saveSharedMatch(localMatch) {
  if (!authState.isAuthenticated || !authState.currentProfile?.id || !localMatch?.id) {
    console.warn("Skipping Supabase match save because auth or local match data is missing.", {
      isAuthenticated: authState.isAuthenticated,
      profileId: authState.currentProfile?.id || "",
      matchId: localMatch?.id || ""
    });
    return { ok: false, message: "Sign in before saving matches." };
  }

  const isExistingRemoteMatch = isUuid(localMatch.id);
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] saveSharedMatch input`, {
    matchId: localMatch.id,
    isExistingRemoteMatch,
    createdBy: localMatch.createdBy || localMatch.created_by || "",
    signedInProfileId: authState.currentProfile?.id || "",
    location: localMatch.location || "",
    result: extractMatchResultPayload(localMatch),
    teamAPlayers: getPersistedTeamPlayers(localMatch, "A").length,
    teamBPlayers: getPersistedTeamPlayers(localMatch, "B").length
  });
  const { data: savedMatch, error: matchError } = await saveMatchRow(localMatch);
  if (matchError) {
    console.error("Could not insert shared match into Supabase.", {
      error: matchError,
      row: localMatchToRemoteMatch(localMatch)
    });
    return { ok: false, message: matchError.message };
  }

  const remoteMatchId = savedMatch.id;
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] public.matches saved`, {
    localMatchId: localMatch.id,
    remoteMatchId,
    location: savedMatch.location || "",
    status: savedMatch.status || ""
  });
  if (remoteMatchId && remoteMatchId !== localMatch.id) {
    replaceLocalMatchId(localMatch.id, remoteMatchId);
    localMatch = { ...localMatch, id: remoteMatchId };
  }

  if (isExistingRemoteMatch) {
    const { error: deleteError } = await supabase
      .from(MATCH_PLAYERS_TABLE)
      .delete()
      .eq("match_id", remoteMatchId);

    if (deleteError) {
      console.warn("Could not replace shared match players in Supabase.", deleteError);
      return { ok: false, message: deleteError.message };
    }
  }

  const playerRows = localMatchPlayersToRemoteRows(localMatch, remoteMatchId);
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] public.match_players insert payload`, {
    matchId: remoteMatchId,
    rows: playerRows.length,
    teamA: playerRows.filter((row) => row.team === "A").length,
    teamB: playerRows.filter((row) => row.team === "B").length,
    sample: playerRows.slice(0, 3)
  });
  if (!playerRows.length) {
    if (!isExistingRemoteMatch) await rollbackInsertedMatch(remoteMatchId);
    return { ok: false, message: "Cannot save match without team players." };
  }

  const { data: savedPlayerRows, error: playerError } = await supabase
    .from(MATCH_PLAYERS_TABLE)
    .insert(playerRows)
    .select("id, match_id, team");

  if (playerError) {
    if (!isExistingRemoteMatch) await rollbackInsertedMatch(remoteMatchId);
    console.error("Could not insert shared match players into Supabase.", {
      error: playerError,
      rows: playerRows
    });
    return { ok: false, message: playerError.message };
  }

  if ((savedPlayerRows || []).length !== playerRows.length) {
    if (!isExistingRemoteMatch) await rollbackInsertedMatch(remoteMatchId);
    console.error("Shared match player insert returned an unexpected row count.", {
      expected: playerRows.length,
      actual: (savedPlayerRows || []).length,
      rows: playerRows,
      savedRows: savedPlayerRows || []
    });
    return { ok: false, message: "Could not save all match players." };
  }

  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] public.match_players inserted`, {
    matchId: remoteMatchId,
    expectedRows: playerRows.length,
    insertedRows: (savedPlayerRows || []).length,
    insertedTeamA: (savedPlayerRows || []).filter((row) => row.team === "A").length,
    insertedTeamB: (savedPlayerRows || []).filter((row) => row.team === "B").length
  });

  return { ok: true, match: savedMatch };
}

async function rollbackInsertedMatch(matchId) {
  if (!matchId) return;

  const { error: playerDeleteError } = await supabase
    .from(MATCH_PLAYERS_TABLE)
    .delete()
    .eq("match_id", matchId);
  if (playerDeleteError) {
    console.warn("Could not rollback shared match players after save failure.", playerDeleteError);
  }

  const { error: matchDeleteError } = await supabase
    .from(MATCHES_TABLE)
    .delete()
    .eq("id", matchId);
  if (matchDeleteError) {
    console.warn("Could not rollback shared match after save failure.", matchDeleteError);
  }
}

async function saveMatchRow(localMatch) {
  const matchRow = localMatchToRemoteMatch(localMatch, { includeResultFields: true });
  const isUpsert = isUuid(localMatch.id);
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] public.matches save payload`, {
    matchId: localMatch.id,
    isUpsert,
    createdBy: matchRow.created_by || "",
    signedInProfileId: authState.currentProfile?.id || "",
    location: matchRow.location,
    locationType: typeof matchRow.location,
    result: extractMatchResultPayload(localMatch),
    teamAPlayers: getPersistedTeamPlayers(localMatch, "A").length,
    teamBPlayers: getPersistedTeamPlayers(localMatch, "B").length,
    row: matchRow
  });
  const result = isUpsert
    ? await supabase.from(MATCHES_TABLE).upsert({ ...matchRow, id: localMatch.id }).select("*").single()
    : await supabase.from(MATCHES_TABLE).insert(matchRow).select("*").single();

  if (!result.error || !isMissingMatchResultColumnError(result.error)) return result;

  const fallbackRow = localMatchToRemoteMatch(localMatch, { includeResultFields: false });
  console.warn(`[SquadCraft ${MATCH_DEBUG_VERSION}] public.matches result columns unavailable; retrying base match payload.`, {
    error: result.error,
    fallbackRow
  });
  return isUpsert
    ? supabase.from(MATCHES_TABLE).upsert({ ...fallbackRow, id: localMatch.id }).select("*").single()
    : supabase.from(MATCHES_TABLE).insert(fallbackRow).select("*").single();
}

export async function syncMatchToSupabase(localMatch) {
  try {
    const result = await saveSharedMatch(localMatch);
    if (!result.ok) {
      window.dispatchEvent(new CustomEvent("match:sync-error", { detail: result }));
    }
    return result;
  } catch (error) {
    const result = { ok: false, message: error?.message || "Could not sync match to Supabase." };
    console.error("Unexpected match Supabase sync failure.", error);
    window.dispatchEvent(new CustomEvent("match:sync-error", { detail: result }));
    return result;
  }
}

export async function deleteSharedMatch(matchId) {
  if (!authState.isAuthenticated || !matchId) {
    return { ok: false, message: "Sign in before deleting matches." };
  }

  const { error: playerError } = await supabase
    .from(MATCH_PLAYERS_TABLE)
    .delete()
    .eq("match_id", matchId);

  if (playerError) {
    console.warn("Could not delete shared match players from Supabase.", playerError);
    return { ok: false, message: playerError.message };
  }

  const { error: matchError } = await supabase
    .from(MATCHES_TABLE)
    .delete()
    .eq("id", matchId);

  if (matchError) {
    console.warn("Could not delete shared match from Supabase.", matchError);
    return { ok: false, message: matchError.message };
  }

  return { ok: true };
}

async function loadMatchPlayerRows(matchIds) {
  const nestedResult = await supabase
    .from(MATCH_PLAYERS_TABLE)
    .select("*, profiles:profile_id(id, name, display_name, avatar_url, role, rating, primary_position, secondary_position, third_position)")
    .in("match_id", matchIds);

  if (!nestedResult.error) return { ok: true, rows: nestedResult.data || [] };

  const flatResult = await supabase
    .from(MATCH_PLAYERS_TABLE)
    .select("*")
    .in("match_id", matchIds);

  return flatResult.error
    ? { ok: false, rows: [], error: flatResult.error }
    : { ok: true, rows: flatResult.data || [] };
}

async function loadMatchAuditProfiles(matchRows) {
  const profileIds = [...new Set((matchRows || []).flatMap((match) => [
    match.created_by,
    match.createdBy,
    match.updated_by,
    match.updatedBy,
    match.edited_by,
    match.editedBy
  ]).filter(Boolean))];

  if (!profileIds.length) return new Map();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, name, display_name")
    .in("id", profileIds);

  if (error && isMissingProfileDisplayNameError(error)) {
    const fallbackResult = await supabase
      .from("profiles")
      .select("id, name")
      .in("id", profileIds);

    if (!fallbackResult.error) {
      return new Map((fallbackResult.data || []).map((profile) => [profile.id, profile]));
    }
  }

  if (error) {
    console.warn("Could not load match audit profiles from Supabase.", error);
    return new Map();
  }

  return new Map((data || []).map((profile) => [profile.id, profile]));
}

function localMatchToRemoteMatch(match, options = {}) {
  const now = new Date().toISOString();
  const metadata = normalizeMatchMetadata(match);
  const startTime = match.startTime || match.dateTime || now;
  const matchRow = {
    title: match.title || `${match.teamAName || "Team A"} vs ${match.teamBName || "Team B"}`,
    match_date: startTime,
    location: getPlainLocationText(match.location),
    status: match.status || "upcoming",
    created_by: metadata.createdBy || authState.currentProfile.id,
    created_at: metadata.createdAt || now
  };

  if (!options.includeResultFields) return matchRow;

  const resultPayload = extractMatchResultPayload(match);
  if (!resultPayload) return matchRow;

  return {
    ...matchRow,
    result: resultPayload,
    team_a_score: resultPayload.scoreA,
    team_b_score: resultPayload.scoreB,
    scorers_a: resultPayload.scorersA,
    scorers_b: resultPayload.scorersB,
    man_of_the_match: resultPayload.manOfTheMatch || null,
    updated_by: authState.currentProfile?.id || metadata.updatedBy || metadata.createdBy || null,
    updated_at: new Date().toISOString()
  };
}

function extractMatchResultPayload(match) {
  if (!match?.result) return null;
  return {
    scoreA: Number(match.result.scoreA) || 0,
    scoreB: Number(match.result.scoreB) || 0,
    scorersA: Array.isArray(match.result.scorersA) ? match.result.scorersA : [],
    scorersB: Array.isArray(match.result.scorersB) ? match.result.scorersB : [],
    manOfTheMatch: match.result.manOfTheMatch || ""
  };
}

function localMatchPlayersToRemoteRows(match, matchId) {
  const rows = [];
  const metadata = normalizeMatchMetadata(match);
  const auditFields = {
    created_by: metadata.createdBy || authState.currentProfile?.id || null,
    created_at: metadata.createdAt || new Date().toISOString()
  };
  appendTeamRows(rows, getPersistedTeamPlayers(match, "A"), matchId, "A", auditFields);
  appendTeamRows(rows, getPersistedTeamPlayers(match, "B"), matchId, "B", auditFields);
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] match_players row audit payload sample`, {
    matchId,
    createdBy: auditFields.created_by,
    createdAt: auditFields.created_at,
    sample: rows[0] || null
  });
  return rows;
}

function getPersistedTeamPlayers(match, team) {
  const primary = team === "A" ? match.teamAPlayers : match.teamBPlayers;
  const fallback = team === "A" ? match.teamA : match.teamB;
  return Array.isArray(primary) && primary.length ? primary : Array.isArray(fallback) ? fallback : [];
}

function appendTeamRows(rows, players, matchId, team, auditFields = {}) {
  players.forEach((player) => {
    const isGuest = Boolean(player.isGuest);
    const profileId = isGuest ? null : (player.profileId || player.profile_id || player.ownerUserId || authState.currentProfile?.id || player.id || null);
    rows.push({
      match_id: matchId,
      profile_id: profileId,
      guest_name: isGuest ? player.name || "Guest" : null,
      guest_position: isGuest ? getPlayerRoleLabel(player) : null,
      team,
      created_by: auditFields.created_by || authState.currentProfile?.id || null,
      created_at: auditFields.created_at || new Date().toISOString()
    });
  });
}

function remoteMatchToLocal(matchRow, playerRows, profilesById = new Map()) {
  const { teamAName, teamBName } = splitMatchTitle(matchRow.title);
  const locationData = parseStoredLocation(matchRow.location);
  const legacyMatchPayload = locationData.match || {};
  const resultPayload = remoteMatchResultToLocal(matchRow, legacyMatchPayload);
  const startTime = matchRow.match_date || matchRow.created_at || new Date().toISOString();
  const endTime = locationData.endTime || matchRow.end_time || matchRow.endTime || addMinutesToDateTime(startTime, 60);
  const embeddedTeamA = snapshotTeam(getPersistedTeamPlayers(legacyMatchPayload, "A"));
  const embeddedTeamB = snapshotTeam(getPersistedTeamPlayers(legacyMatchPayload, "B"));
  const teamAPlayers = remoteTeamPlayersToLocal(playerRows, "A", embeddedTeamA);
  const teamBPlayers = remoteTeamPlayersToLocal(playerRows, "B", embeddedTeamB);
  console.info(`[SquadCraft ${MATCH_DEBUG_VERSION}] remoteMatchToLocal`, {
    matchId: matchRow.id,
    rawLocation: matchRow.location,
    parsedLocation: locationData.location,
    playerRows: playerRows.length,
    teamAPlayers: teamAPlayers.length,
    teamBPlayers: teamBPlayers.length,
    legacyEmbeddedTeamA: embeddedTeamA.length,
    legacyEmbeddedTeamB: embeddedTeamB.length
  });
  const createdBy = matchRow.created_by || matchRow.createdBy || "";
  const updatedBy = matchRow.updated_by || matchRow.updatedBy || matchRow.edited_by || matchRow.editedBy || "";
  const createdByProfile = profilesById.get(createdBy);
  const updatedByProfile = profilesById.get(updatedBy);
  const metadata = normalizeMatchMetadata({
    ...matchRow,
    createdBy,
    createdByName: matchRow.created_by_name || getProfileName(createdByProfile),
    updatedBy,
    updatedByName: matchRow.updated_by_name || matchRow.edited_by_name || getProfileName(updatedByProfile)
  });

  return {
    id: matchRow.id,
    title: matchRow.title || "",
    dateTime: startTime,
    startTime,
    endTime,
    location: locationData.location,
    status: matchRow.status || "upcoming",
    teamAName,
    teamBName,
    formation: legacyMatchPayload.formation || legacyMatchPayload.formationA || "0-0-0",
    formationA: legacyMatchPayload.formationA || legacyMatchPayload.formation || "0-0-0",
    formationB: legacyMatchPayload.formationB || legacyMatchPayload.formation || "0-0-0",
    teamAPlayers,
    teamBPlayers,
    teamA: teamAPlayers,
    teamB: teamBPlayers,
    captainA: legacyMatchPayload.captainA || legacyMatchPayload.captainAId || "",
    captainB: legacyMatchPayload.captainB || legacyMatchPayload.captainBId || "",
    managerName: legacyMatchPayload.managerName || "",
    managerTeam: legacyMatchPayload.managerTeam || "",
    result: resultPayload,
    scorersA: legacyMatchPayload.scorersA || resultPayload?.scorersA || [],
    scorersB: legacyMatchPayload.scorersB || resultPayload?.scorersB || [],
    liveMotmId: legacyMatchPayload.liveMotmId || resultPayload?.manOfTheMatch || "",
    lastGoal: legacyMatchPayload.lastGoal || null,
    createdBy: metadata.createdBy,
    createdByName: metadata.createdByName,
    createdAt: matchRow.created_at || matchRow.match_date || new Date().toISOString(),
    updatedBy: metadata.updatedBy,
    updatedByName: metadata.updatedByName,
    updatedAt: matchRow.updated_at || "",
    editHistory: []
  };
}

function remoteMatchResultToLocal(matchRow, legacyMatchPayload = {}) {
  const rawResult = matchRow.result || legacyMatchPayload.result || null;
  if (rawResult && typeof rawResult === "object") {
    return {
      scoreA: Number(rawResult.scoreA ?? rawResult.score_a ?? rawResult.teamAScore ?? rawResult.team_a_score) || 0,
      scoreB: Number(rawResult.scoreB ?? rawResult.score_b ?? rawResult.teamBScore ?? rawResult.team_b_score) || 0,
      scorersA: Array.isArray(rawResult.scorersA) ? rawResult.scorersA : Array.isArray(rawResult.scorers_a) ? rawResult.scorers_a : [],
      scorersB: Array.isArray(rawResult.scorersB) ? rawResult.scorersB : Array.isArray(rawResult.scorers_b) ? rawResult.scorers_b : [],
      manOfTheMatch: rawResult.manOfTheMatch || rawResult.man_of_the_match || ""
    };
  }

  const hasScore = Number.isFinite(Number(matchRow.team_a_score ?? matchRow.teamAScore))
    || Number.isFinite(Number(matchRow.team_b_score ?? matchRow.teamBScore));
  if (!hasScore) return null;

  return {
    scoreA: Number(matchRow.team_a_score ?? matchRow.teamAScore) || 0,
    scoreB: Number(matchRow.team_b_score ?? matchRow.teamBScore) || 0,
    scorersA: Array.isArray(matchRow.scorers_a) ? matchRow.scorers_a : Array.isArray(matchRow.scorersA) ? matchRow.scorersA : [],
    scorersB: Array.isArray(matchRow.scorers_b) ? matchRow.scorers_b : Array.isArray(matchRow.scorersB) ? matchRow.scorersB : [],
    manOfTheMatch: matchRow.man_of_the_match || matchRow.manOfTheMatch || ""
  };
}

function remoteTeamPlayersToLocal(playerRows, team, embeddedTeam) {
  const remotePlayers = playerRows
    .filter((row) => String(row.team || "").toUpperCase() === team)
    .map(remoteMatchPlayerToLocal);

  if (!remotePlayers.length) return embeddedTeam;

  const embeddedById = new Map(embeddedTeam.map((player) => [player.id, player]));
  const usedEmbeddedIds = new Set();
  return remotePlayers.map((player) => {
    const embeddedPlayer = embeddedById.get(player.id);
    if (embeddedPlayer) {
      usedEmbeddedIds.add(embeddedPlayer.id);
      return normalizePlayerRecord({
        ...player,
        ...embeddedPlayer,
        id: player.id,
        profileId: player.profileId || embeddedPlayer.profileId || "",
        ownerUserId: player.ownerUserId || embeddedPlayer.ownerUserId || "",
        isGuest: player.isGuest || embeddedPlayer.isGuest
      });
    }
    const guestMatch = player.isGuest
      ? embeddedTeam.find((candidate) => candidate.isGuest && candidate.name === player.name && !usedEmbeddedIds.has(candidate.id))
      : null;
    if (guestMatch) {
      usedEmbeddedIds.add(guestMatch.id);
      return normalizePlayerRecord({ ...player, ...guestMatch, isGuest: true });
    }
    return player;
  });
}

function mergeRemoteMatchesWithLocalFallback(remoteMatches) {
  const localMatchesById = new Map((state.data.matches || []).map((match) => [match.id, match]));

  return remoteMatches.map((remoteMatch) => {
    const localMatch = localMatchesById.get(remoteMatch.id);
    if (!localMatch || hasPersistedTeams(remoteMatch) || !hasPersistedTeams(localMatch)) {
      return remoteMatch;
    }

    return {
      ...remoteMatch,
      formation: localMatch.formation || localMatch.formationA || remoteMatch.formation,
      formationA: localMatch.formationA || localMatch.formation || remoteMatch.formationA,
      formationB: localMatch.formationB || localMatch.formation || remoteMatch.formationB,
      teamAPlayers: snapshotTeam(getPersistedTeamPlayers(localMatch, "A")),
      teamBPlayers: snapshotTeam(getPersistedTeamPlayers(localMatch, "B")),
      teamA: snapshotTeam(getPersistedTeamPlayers(localMatch, "A")),
      teamB: snapshotTeam(getPersistedTeamPlayers(localMatch, "B")),
      captainA: localMatch.captainA || localMatch.captainAId || remoteMatch.captainA || "",
      captainB: localMatch.captainB || localMatch.captainBId || remoteMatch.captainB || "",
      managerName: localMatch.managerName || remoteMatch.managerName || "",
      managerTeam: localMatch.managerTeam || remoteMatch.managerTeam || "",
      result: localMatch.result || remoteMatch.result || null,
      scorersA: localMatch.scorersA || remoteMatch.scorersA || [],
      scorersB: localMatch.scorersB || remoteMatch.scorersB || [],
      liveMotmId: localMatch.liveMotmId || remoteMatch.liveMotmId || "",
      lastGoal: localMatch.lastGoal || remoteMatch.lastGoal || null
    };
  });
}

function hasPersistedTeams(match) {
  return getPersistedTeamPlayers(match, "A").length > 0 || getPersistedTeamPlayers(match, "B").length > 0;
}

function getProfileName(profile) {
  return profile?.display_name || profile?.name || "";
}

function addMinutesToDateTime(value, minutes) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return value || new Date().toISOString();
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

function getPlainLocationText(value) {
  const parsed = parseStoredLocation(value);
  return parsed.location;
}

function parseStoredLocation(value) {
  if (value && typeof value === "object") {
    return {
      location: String(value.location || ""),
      endTime: value.endTime || "",
      match: value.match && typeof value.match === "object" ? value.match : null
    };
  }

  const rawValue = String(value || "");
  try {
    const parsed = JSON.parse(rawValue);
    if (parsed?.squadcraft === 1) {
      return {
        location: parsed.location || "",
        endTime: parsed.endTime || "",
        match: parsed.match && typeof parsed.match === "object" ? parsed.match : null
      };
    }
  } catch {
    // Older rows stored plain location text here.
  }

  return {
    location: rawValue,
    endTime: "",
    match: null
  };
}

function remoteMatchPlayerToLocal(row) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const isGuest = Boolean(row.is_guest) || (!row.profile_id && Boolean(row.guest_name));
  const roleLabel = row.role_label || row.guest_position || profile?.primary_position || profile?.role || "CM";
  return normalizePlayerRecord({
    id: isGuest ? `guest-${row.id}` : row.profile_id,
    profileId: row.profile_id || "",
    name: isGuest ? row.guest_name || "Guest" : profile?.display_name || profile?.name || "Registered Player",
    rating: profile?.rating,
    positions: {
      primary: roleLabel,
      secondary: profile?.secondary_position || "",
      tertiary: profile?.third_position || ""
    },
    role: roleLabel,
    image: profile?.avatar_url || "",
    isGuest,
    ownerUserId: row.profile_id || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    approvalStatus: "approved"
  });
}

function groupRowsByMatch(rows) {
  return rows.reduce((map, row) => {
    const list = map.get(row.match_id) || [];
    list.push(row);
    map.set(row.match_id, list);
    return map;
  }, new Map());
}

function splitMatchTitle(title = "") {
  const parts = String(title || "").split(" vs ");
  return {
    teamAName: parts[0] || "Team A",
    teamBName: parts[1] || "Team B"
  };
}

function getPlayerRoleLabel(player) {
  return player.assignedPosition || player.positions?.primary || player.role || player.guest_position || "CM";
}

function replaceLocalMatchId(oldId, newId) {
  setMatches(state.data.matches.map((match) => (match.id === oldId ? { ...match, id: newId } : match)));
  if (state.currentTeams?.id === oldId) {
    updateTeams((teams) => ({ ...teams, id: newId }));
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function isMissingProfileDisplayNameError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("display_name") && (message.includes("schema cache") || message.includes("column"));
}

function isMissingMatchResultColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (message.includes("schema cache") || message.includes("column"))
    && (
      message.includes("result")
      || message.includes("team_a_score")
      || message.includes("team_b_score")
      || message.includes("scorers_a")
      || message.includes("scorers_b")
      || message.includes("man_of_the_match")
      || message.includes("updated_by")
      || message.includes("updated_at")
    );
}
