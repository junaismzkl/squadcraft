import { supabase } from "./supabaseClient.js";
import { normalizePlayerRecord, setPlayers, state } from "./state.js";

const PLAYERS_TABLE = "players";

export async function loadSharedPlayersIntoState() {
  const { data, error } = await supabase
    .from(PLAYERS_TABLE)
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.warn("Supabase players table is not available. Player approval remains local-only until the players table and RLS policies are added.", error);
    return { ok: false, message: error.message };
  }

  setPlayers((data || []).map(remotePlayerToLocal));
  return { ok: true, players: state.data.players };
}

export async function saveSharedPlayer(player) {
  const { error } = await supabase
    .from(PLAYERS_TABLE)
    .upsert(localPlayerToRemote(player));

  if (error) {
    console.warn("Could not save player to Supabase. This player is only saved in this browser.", error);
    return { ok: false, message: error.message };
  }

  return { ok: true };
}

export async function approveSharedPlayer(playerId, approvalPatch) {
  const { error } = await supabase
    .from(PLAYERS_TABLE)
    .update(localPlayerToRemoteApprovalPatch(approvalPatch))
    .eq("id", playerId)
    .eq("approval_status", "pending");

  if (error) {
    console.warn("Could not approve player in Supabase.", error);
    return { ok: false, message: error.message };
  }

  return { ok: true };
}

export async function rejectSharedPlayer(playerId, rejectionPatch) {
  const { error } = await supabase
    .from(PLAYERS_TABLE)
    .update(localPlayerToRemoteApprovalPatch(rejectionPatch))
    .eq("id", playerId)
    .eq("approval_status", "pending");

  if (error) {
    console.warn("Could not reject player in Supabase.", error);
    return { ok: false, message: error.message };
  }

  return { ok: true };
}

function localPlayerToRemote(player) {
  return {
    id: player.id,
    name: player.name,
    rating: player.rating,
    positions: player.positions || {},
    role: player.role || player.positions?.primary || "",
    position: player.position || player.positions?.secondary || "",
    image: player.image || "",
    is_guest: Boolean(player.isGuest),
    owner_user_id: player.ownerUserId || "",
    created_by: player.createdBy || "",
    created_at: player.createdAt,
    updated_by: player.updatedBy || "",
    updated_at: player.updatedAt,
    approved_by: player.approvedBy || "",
    approved_at: player.approvedAt || null,
    approval_status: player.approvalStatus || "approved",
    stats: player.stats || {}
  };
}

function localPlayerToRemoteApprovalPatch(patch) {
  return {
    approval_status: patch.approvalStatus,
    approved_by: patch.approvedBy || "",
    approved_at: patch.approvedAt || null,
    updated_by: patch.updatedBy || "",
    updated_at: patch.updatedAt || new Date().toISOString()
  };
}

function remotePlayerToLocal(row) {
  return normalizePlayerRecord({
    id: row.id,
    name: row.name,
    rating: row.rating,
    positions: row.positions || {},
    role: row.role,
    position: row.position,
    image: row.image || "",
    isGuest: row.is_guest,
    ownerUserId: row.owner_user_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    approvalStatus: row.approval_status,
    stats: row.stats || {}
  });
}
