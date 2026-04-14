import { supabase } from "./supabaseClient.js";
import { normalizePlayerRecord, setPlayers, state } from "./state.js";

const PROFILE_PLAYER_FIELDS = "id,name,display_name,avatar_url,role,is_active,approval_status,approved_by,approved_at,created_at,updated_at,primary_position,secondary_position,third_position,player_profile_completed,rating,dominant_foot,jersey_number";

export async function loadSharedPlayersIntoState() {
  const baseQuery = supabase
    .from("profiles")
    .select(PROFILE_PLAYER_FIELDS)
    .eq("is_active", true)
    .eq("approval_status", "approved");

  const { data, error } = await baseQuery
    .order("player_profile_completed", { ascending: false })
    .order("display_name", { ascending: true });

  if (error) {
    const fallback = await supabase
      .from("profiles")
      .select("*")
      .eq("is_active", true)
      .eq("approval_status", "approved")
      .order("name", { ascending: true });

    if (fallback.error) {
      console.warn("Could not load approved profile players from Supabase.", fallback.error);
      return { ok: false, message: fallback.error.message };
    }

    setPlayers((fallback.data || []).map(profileToPlayer));
    return { ok: true, players: state.data.players };
  }

  setPlayers((data || []).map(profileToPlayer));
  return { ok: true, players: state.data.players };
}

export async function saveSharedPlayer(player) {
  return { ok: true, player };
}

export async function approveSharedPlayer(playerId, approvalPatch) {
  return { ok: true, playerId, approvalPatch };
}

export async function rejectSharedPlayer(playerId, rejectionPatch) {
  return { ok: true, playerId, rejectionPatch };
}

export async function updateProfilePlayerDetails(profileId, details = {}) {
  if (!profileId) return { ok: false, message: "Player profile id is missing." };
  const patch = profileDetailsToPatch(details);
  const { data, error } = await supabase
    .from("profiles")
    .update(patch)
    .eq("id", profileId)
    .select("*")
    .single();

  if (error) {
    console.warn("Could not update profile-backed player details.", error);
    return { ok: false, message: error.message };
  }

  await loadSharedPlayersIntoState();
  return { ok: true, profile: data };
}

export async function updateProfilePlayerRole(profileId, role) {
  if (!profileId) return { ok: false, message: "Player profile id is missing." };
  if (!["user", "admin"].includes(role)) return { ok: false, message: "Role must be user or admin." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", profileId)
    .neq("role", "super_admin")
    .select("*")
    .single();

  if (error) {
    console.warn("Could not update profile role.", error);
    return { ok: false, message: error.message };
  }

  await loadSharedPlayersIntoState();
  return { ok: true, profile: data };
}

export async function deactivateProfilePlayer(profileId) {
  if (!profileId) return { ok: false, message: "Player profile id is missing." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: false })
    .eq("id", profileId)
    .select("*")
    .single();

  if (error) {
    console.warn("Could not deactivate profile-backed player.", error);
    return { ok: false, message: error.message };
  }

  await loadSharedPlayersIntoState();
  return { ok: true, profile: data };
}

function profileToPlayer(profile) {
  const name = profile.display_name || profile.name || "Approved Player";
  return normalizePlayerRecord({
    id: profile.id,
    profileId: profile.id,
    name,
    rating: profile.rating ?? 50,
    positions: {
      primary: profile.primary_position || "CM",
      secondary: profile.secondary_position || "",
      tertiary: profile.third_position || ""
    },
    role: profile.primary_position || "CM",
    position: profile.secondary_position || "",
    image: profile.avatar_url || "",
    isGuest: false,
    ownerUserId: profile.id,
    createdBy: profile.id,
    createdAt: profile.created_at,
    updatedBy: profile.id,
    updatedAt: profile.updated_at || profile.created_at,
    approvedBy: profile.approved_by || "",
    approvedAt: profile.approved_at || profile.created_at,
    approvalStatus: "approved",
    jerseyNumber: profile.jersey_number ?? "",
    dominantFoot: profile.dominant_foot || "",
    playerProfileCompleted: Boolean(profile.player_profile_completed),
    profileBacked: true,
    profileRole: profile.role || "user"
  });
}

function profileDetailsToPatch(details = {}) {
  const displayName = String(details.displayName || "").trim();
  const fallbackName = String(details.name || "").trim();
  const primaryPosition = normalizePosition(details.primaryPosition);
  return {
    display_name: displayName,
    name: fallbackName || displayName || "Approved Player",
    rating: normalizeRating(details.rating),
    primary_position: primaryPosition,
    secondary_position: normalizePosition(details.secondaryPosition),
    third_position: normalizePosition(details.thirdPosition),
    dominant_foot: normalizeDominantFoot(details.dominantFoot),
    jersey_number: normalizeJerseyNumber(details.jerseyNumber),
    avatar_url: details.avatarUrl || "",
    player_profile_completed: Boolean((displayName || fallbackName) && primaryPosition),
    updated_at: new Date().toISOString()
  };
}

function normalizePosition(value) {
  const position = String(value || "").trim().toUpperCase();
  return ["GK", "CB", "WB", "CM", "WF", "CF"].includes(position) ? position : "";
}

function normalizeDominantFoot(value) {
  const foot = String(value || "").trim();
  return ["Right", "Left", "Both"].includes(foot) ? foot : "";
}

function normalizeJerseyNumber(value) {
  const number = String(value || "").trim();
  return number ? number.slice(0, 2) : "";
}

function normalizeRating(value) {
  return Math.max(50, Math.min(100, Math.round(Number(value) || 50)));
}
