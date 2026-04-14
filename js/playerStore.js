import { supabase } from "./supabaseClient.js";
import { normalizePlayerRecord, setPlayers, state } from "./state.js";

export async function loadSharedPlayersIntoState() {
  const baseQuery = supabase
    .from("profiles")
    .select("*")
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

function profileToPlayer(profile) {
  const name = profile.display_name || profile.name || "Approved Player";
  return normalizePlayerRecord({
    id: profile.id,
    profileId: profile.id,
    name,
    rating: 50,
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
    profileBacked: true
  });
}
