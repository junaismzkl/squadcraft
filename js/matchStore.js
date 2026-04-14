import { authState } from "./auth.js";
import { supabase } from "./supabaseClient.js";
import { normalizeMatchMetadata, normalizePlayerRecord, setMatches, state, updateTeams } from "./state.js";

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
    return { ok: false, message: "Sign in before saving matches." };
  }

  const { data: savedMatch, error: matchError } = await saveMatchRow(localMatch, true);
  if (matchError) {
    console.warn("Could not save shared match to Supabase.", matchError);
    return { ok: false, message: matchError.message };
  }

  const remoteMatchId = savedMatch.id;
  if (remoteMatchId && remoteMatchId !== localMatch.id) {
    replaceLocalMatchId(localMatch.id, remoteMatchId);
    localMatch = { ...localMatch, id: remoteMatchId };
  }

  const { error: deleteError } = await supabase
    .from(MATCH_PLAYERS_TABLE)
    .delete()
    .eq("match_id", remoteMatchId);

  if (deleteError) {
    console.warn("Could not replace shared match players in Supabase.", deleteError);
    return { ok: false, message: deleteError.message };
  }

  const playerRows = localMatchPlayersToRemoteRows(localMatch, remoteMatchId);
  if (playerRows.length) {
    const { error: playerError } = await supabase
      .from(MATCH_PLAYERS_TABLE)
      .insert(playerRows);

    if (playerError) {
      console.warn("Could not save shared match players to Supabase.", playerError);
      return { ok: false, message: playerError.message };
    }
  }

  return { ok: true, match: savedMatch };
}

async function saveMatchRow(localMatch, includeEditor) {
  const matchRow = localMatchToRemoteMatch(localMatch, { includeEditor });
  const query = isUuid(localMatch.id)
    ? supabase.from(MATCHES_TABLE).upsert({ ...matchRow, id: localMatch.id }).select("*").single()
    : supabase.from(MATCHES_TABLE).insert(matchRow).select("*").single();
  const result = await query;

  if (includeEditor && result.error && isMissingEditorColumnError(result.error)) {
    return saveMatchRow(localMatch, false);
  }

  return result;
}

export async function syncMatchToSupabase(localMatch) {
  const result = await saveSharedMatch(localMatch);
  if (!result.ok) {
    window.dispatchEvent(new CustomEvent("match:sync-error", { detail: result }));
  }
  return result;
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
    .select("*, profiles:profile_id(id, name, avatar_url, role)")
    .in("match_id", matchIds)
    .order("created_at", { ascending: true });

  if (!nestedResult.error) return { ok: true, rows: nestedResult.data || [] };

  const flatResult = await supabase
    .from(MATCH_PLAYERS_TABLE)
    .select("*")
    .in("match_id", matchIds)
    .order("created_at", { ascending: true });

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
  const row = {
    title: match.title || `${match.teamAName || "Team A"} vs ${match.teamBName || "Team B"}`,
    match_date: match.startTime || match.dateTime || now,
    location: match.location || "",
    status: match.status || "upcoming",
    created_by: metadata.createdBy || authState.currentProfile.id,
    created_at: metadata.createdAt || now,
    updated_at: now
  };
  if (options.includeEditor !== false) {
    row.updated_by = authState.currentProfile.id;
  }
  return row;
}

function localMatchPlayersToRemoteRows(match, matchId) {
  const rows = [];
  appendTeamRows(rows, match.teamAPlayers || match.teamA || [], matchId, "A");
  appendTeamRows(rows, match.teamBPlayers || match.teamB || [], matchId, "B");
  return rows;
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
      team,
      role_label: getPlayerRoleLabel(player),
      is_guest: isGuest,
      created_by: authState.currentProfile?.id || "",
      created_at: player.createdAt || new Date().toISOString()
    });
  });
}

function remoteMatchToLocal(matchRow, playerRows, profilesById = new Map()) {
  const { teamAName, teamBName } = splitMatchTitle(matchRow.title);
  const teamAPlayers = playerRows.filter((row) => String(row.team || "").toUpperCase() === "A").map(remoteMatchPlayerToLocal);
  const teamBPlayers = playerRows.filter((row) => String(row.team || "").toUpperCase() === "B").map(remoteMatchPlayerToLocal);
  const createdBy = matchRow.created_by || matchRow.createdBy || "";
  const updatedBy = matchRow.updated_by || matchRow.updatedBy || matchRow.edited_by || matchRow.editedBy || createdBy;
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
    dateTime: matchRow.match_date || matchRow.created_at || new Date().toISOString(),
    startTime: matchRow.match_date || matchRow.created_at || new Date().toISOString(),
    endTime: matchRow.match_date || matchRow.created_at || new Date().toISOString(),
    location: matchRow.location || "",
    status: matchRow.status || "upcoming",
    teamAName,
    teamBName,
    formation: "0-0-0",
    formationA: "0-0-0",
    formationB: "0-0-0",
    teamAPlayers,
    teamBPlayers,
    teamA: teamAPlayers,
    teamB: teamBPlayers,
    createdBy: metadata.createdBy,
    createdByName: metadata.createdByName,
    createdAt: matchRow.created_at || matchRow.match_date || new Date().toISOString(),
    updatedBy: metadata.updatedBy,
    updatedByName: metadata.updatedByName,
    updatedAt: matchRow.updated_at || matchRow.created_at || new Date().toISOString(),
    editHistory: []
  };
}

function getProfileName(profile) {
  return profile?.display_name || profile?.name || "";
}

function remoteMatchPlayerToLocal(row) {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  const isGuest = Boolean(row.is_guest);
  return normalizePlayerRecord({
    id: isGuest ? `guest-${row.id}` : row.profile_id,
    profileId: row.profile_id || "",
    name: isGuest ? row.guest_name || "Guest" : profile?.name || "Registered Player",
    positions: { primary: row.role_label || row.guest_position || "CM" },
    role: row.role_label || row.guest_position || "CM",
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

function isMissingEditorColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("updated_by") && (message.includes("schema cache") || message.includes("column"));
}

function isMissingProfileDisplayNameError(error) {
  const message = String(error?.message || "").toLowerCase();
  return message.includes("display_name") && (message.includes("schema cache") || message.includes("column"));
}
