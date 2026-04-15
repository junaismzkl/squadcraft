import { authState } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { normalizeMatchMetadata, normalizePlayerRecord, setMatches, snapshotTeam, state, updateTeams } from "./state.js";

const MATCHES_TABLE = "matches";
const MATCH_PLAYERS_TABLE = "match_players";

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

  if (!playerRowsResult.ok) {
    console.warn("Could not load shared match players from Supabase.", playerRowsResult.error);
  }

  const playersByMatch = groupRowsByMatch(playerRowsResult.rows || []);
  const profilesById = await loadMatchAuditProfiles(matchRows || []);
  const matches = (matchRows || []).map((matchRow) => remoteMatchToLocal(
    matchRow,
    playersByMatch.get(matchRow.id) || [],
    profilesById
  ));
  setMatches(matches);
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
  const { data: savedMatch, error: matchError } = await saveMatchRow(localMatch);
  if (matchError) {
    console.error("Could not insert shared match into Supabase.", {
      error: matchError,
      row: localMatchToRemoteMatch(localMatch)
    });
    return { ok: false, message: matchError.message };
  }

  const remoteMatchId = savedMatch.id;
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
  if (playerRows.length) {
    const { error: playerError } = await supabase
      .from(MATCH_PLAYERS_TABLE)
      .insert(playerRows);

    if (playerError) {
      console.error("Could not insert shared match players into Supabase.", {
        error: playerError,
        rows: playerRows
      });
      return { ok: false, message: playerError.message };
    }
  }

  return { ok: true, match: savedMatch };
}

async function saveMatchRow(localMatch) {
  const matchRow = localMatchToRemoteMatch(localMatch);
  const query = isUuid(localMatch.id)
    ? supabase.from(MATCHES_TABLE).upsert({ ...matchRow, id: localMatch.id }).select("*").single()
    : supabase.from(MATCHES_TABLE).insert(matchRow).select("*").single();
  return query;
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

function localMatchToRemoteMatch(match) {
  const now = new Date().toISOString();
  const metadata = normalizeMatchMetadata(match);
  const startTime = match.startTime || match.dateTime || now;
  const endTime = match.endTime || startTime;
  return {
    title: match.title || `${match.teamAName || "Team A"} vs ${match.teamBName || "Team B"}`,
    match_date: startTime,
    location: encodeMatchLocation(match.location || "", { endTime, match }),
    status: match.status || "upcoming",
    created_by: metadata.createdBy || authState.currentProfile.id,
    created_at: metadata.createdAt || now
  };
}

function localMatchPlayersToRemoteRows(match, matchId) {
  const rows = [];
  appendTeamRows(rows, getPersistedTeamPlayers(match, "A"), matchId, "A");
  appendTeamRows(rows, getPersistedTeamPlayers(match, "B"), matchId, "B");
  return rows;
}

function getPersistedTeamPlayers(match, team) {
  const primary = team === "A" ? match.teamAPlayers : match.teamBPlayers;
  const fallback = team === "A" ? match.teamA : match.teamB;
  return Array.isArray(primary) && primary.length ? primary : Array.isArray(fallback) ? fallback : [];
}

function appendTeamRows(rows, players, matchId, team) {
  players.forEach((player) => {
    const isGuest = Boolean(player.isGuest);
    const profileId = isGuest ? null : (player.profileId || player.profile_id || player.ownerUserId || authState.currentProfile?.id || player.id || null);
    rows.push({
      match_id: matchId,
      profile_id: profileId,
      guest_name: isGuest ? player.name || "Guest" : null,
      guest_position: isGuest ? getPlayerRoleLabel(player) : null,
      team
    });
  });
}

function remoteMatchToLocal(matchRow, playerRows, profilesById = new Map()) {
  const { teamAName, teamBName } = splitMatchTitle(matchRow.title);
  const locationData = decodeMatchLocation(matchRow.location);
  const embeddedMatch = locationData.match || {};
  const startTime = matchRow.match_date || matchRow.created_at || new Date().toISOString();
  const endTime = locationData.endTime || matchRow.end_time || matchRow.endTime || addMinutesToDateTime(startTime, 60);
  const embeddedTeamA = snapshotTeam(getPersistedTeamPlayers(embeddedMatch, "A"));
  const embeddedTeamB = snapshotTeam(getPersistedTeamPlayers(embeddedMatch, "B"));
  const teamAPlayers = remoteTeamPlayersToLocal(playerRows, "A", embeddedTeamA);
  const teamBPlayers = remoteTeamPlayersToLocal(playerRows, "B", embeddedTeamB);
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
    formation: embeddedMatch.formation || embeddedMatch.formationA || "0-0-0",
    formationA: embeddedMatch.formationA || embeddedMatch.formation || "0-0-0",
    formationB: embeddedMatch.formationB || embeddedMatch.formation || "0-0-0",
    teamAPlayers,
    teamBPlayers,
    teamA: teamAPlayers,
    teamB: teamBPlayers,
    captainA: embeddedMatch.captainA || embeddedMatch.captainAId || "",
    captainB: embeddedMatch.captainB || embeddedMatch.captainBId || "",
    managerName: embeddedMatch.managerName || "",
    managerTeam: embeddedMatch.managerTeam || "",
    result: embeddedMatch.result || null,
    scorersA: embeddedMatch.scorersA || embeddedMatch.result?.scorersA || [],
    scorersB: embeddedMatch.scorersB || embeddedMatch.result?.scorersB || [],
    liveMotmId: embeddedMatch.liveMotmId || embeddedMatch.result?.manOfTheMatch || "",
    lastGoal: embeddedMatch.lastGoal || null,
    createdBy: metadata.createdBy,
    createdByName: metadata.createdByName,
    createdAt: matchRow.created_at || matchRow.match_date || new Date().toISOString(),
    updatedBy: metadata.updatedBy,
    updatedByName: metadata.updatedByName,
    updatedAt: matchRow.updated_at || "",
    editHistory: []
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

function getProfileName(profile) {
  return profile?.display_name || profile?.name || "";
}

function addMinutesToDateTime(value, minutes) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return value || new Date().toISOString();
  return new Date(date.getTime() + minutes * 60000).toISOString();
}

function encodeMatchLocation(location, timing = {}) {
  return JSON.stringify({
    squadcraft: 1,
    location,
    endTime: timing.endTime || "",
    match: timing.match ? serializeMatchPayload(timing.match) : null
  });
}

function decodeMatchLocation(value) {
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

function serializeMatchPayload(match) {
  return {
    teamAName: match.teamAName || "Team A",
    teamBName: match.teamBName || "Team B",
    formation: match.formation || match.formationA || "",
    formationA: match.formationA || match.formation || "",
    formationB: match.formationB || match.formation || "",
    teamAPlayers: snapshotTeam(getPersistedTeamPlayers(match, "A")),
    teamBPlayers: snapshotTeam(getPersistedTeamPlayers(match, "B")),
    captainA: match.captainA || match.captainAId || "",
    captainB: match.captainB || match.captainBId || "",
    managerName: match.managerName || "",
    managerTeam: match.managerTeam || "",
    result: match.result || null,
    scorersA: match.scorersA || match.result?.scorersA || [],
    scorersB: match.scorersB || match.result?.scorersB || [],
    liveMotmId: match.liveMotmId || match.result?.manOfTheMatch || "",
    lastGoal: match.lastGoal || null
  };
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
