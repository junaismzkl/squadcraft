import { supabase } from "./supabaseClient.js?v=match-debug-v5";
import { normalizePlayerRecord, setPlayers, state } from "./state.js?v=match-debug-v5";

const PROFILE_PLAYER_FIELDS = "id,name,display_name,avatar_url,role,is_active,approval_status,approved_by,approved_at,created_at,updated_at,primary_position,secondary_position,third_position,player_profile_completed,rating,dominant_foot,jersey_number,created_by,claim_status,claim_code,claimed_at,auth_user_id,login_username";

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

export async function createClaimableProfile(details = {}, currentProfile = null) {
  const creatorId = String(currentProfile?.id || "").trim();
  if (!creatorId) return { ok: false, message: "Only admins can create claimable player profiles." };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const claimCode = generateClaimCode();
    const username = await generateUniqueUsername(details.name || details.displayName || "player");
    const patch = {
      id: crypto.randomUUID(),
      created_by: creatorId,
      claim_code: claimCode,
      claim_status: "pending",
      claimed_at: null,
      auth_user_id: null,
      login_username: username,
      login_email: null,
      approval_status: "approved",
      is_active: true,
      role: "user",
      approved_by: creatorId,
      approved_at: new Date().toISOString(),
      ...profileDetailsToPatch(details)
    };

    const { data, error } = await supabase
      .from("profiles")
      .insert(patch)
      .select("*")
      .single();

    if (error) {
      if (isClaimIdentityConflict(error)) continue;
      console.warn("Could not create claimable profile.", error);
      return { ok: false, message: error.message };
    }

    await loadSharedPlayersIntoState();
    return {
      ok: true,
      profile: data,
      username,
      claimCode,
      claimLink: `${window.location.origin}${window.location.pathname}?claim=${encodeURIComponent(claimCode)}`
    };
  }

  return { ok: false, message: "Could not generate a unique claim identity. Please try again." };
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

export async function regenerateProfileClaimLink(profileId) {
  if (!profileId) return { ok: false, message: "Player profile id is missing." };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const claimCode = generateClaimCode();
    const { data, error } = await supabase
      .from("profiles")
      .update({
        claim_code: claimCode,
        claim_status: "pending",
        claimed_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", profileId)
      .select("*")
      .single();

    if (error) {
      if (isClaimIdentityConflict(error)) continue;
      console.warn("Could not regenerate claim link.", error);
      return { ok: false, message: error.message };
    }

    await loadSharedPlayersIntoState();
    return {
      ok: true,
      profile: data,
      claimCode,
      claimLink: `${window.location.origin}${window.location.pathname}?claim=${encodeURIComponent(claimCode)}`
    };
  }

  return { ok: false, message: "Could not generate a new claim link. Please try again." };
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
      authUserId: profile.auth_user_id || "",
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
    profileRole: profile.role || "user",
    claimStatus: profile.claim_status || "claimed",
    claimCode: profile.claim_code || "",
    loginUsername: profile.login_username || ""
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

function generateClaimCode() {
  const raw = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function generateUniqueUsername(name) {
  const base = normalizeUsernameBase(name);
  let candidate = base;
  let suffix = 0;

  while (suffix < 50) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("login_username", candidate)
      .maybeSingle();

    if (error) {
      console.warn("Could not verify claim username uniqueness.", error);
      return candidate;
    }

    if (!data) return candidate;
    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  return `${base}${Date.now().toString().slice(-4)}`;
}

function normalizeUsernameBase(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return (normalized || "player").slice(0, 18);
}

function isClaimIdentityConflict(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "23505"
    || message.includes("login_username")
    || message.includes("claim_code");
}
