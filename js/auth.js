import { setAuthenticatedProfile, clearAuthenticatedProfile } from "./state.js?v=match-debug-v5";
import { supabase } from "./supabaseClient.js?v=match-debug-v5";

export const authState = {
  currentSession: null,
  currentAuthUser: null,
  currentProfile: null,
  pendingProfiles: [],
  approvalSchemaReady: true,
  claimProfilePreview: null,
  claimFlowActive: false,
  isAuthenticated: false,
  isLoading: false,
  error: ""
};

export function isApprovedProfile(profile = authState.currentProfile) {
  if (!profile) return false;
  if (profile.role === "super_admin" && profile.is_active === true) return true;
  if (isClaimedAdminCreatedProfile(profile)) return true;
  if (!authState.approvalSchemaReady || profile.approval_status === undefined) {
    return profile.is_active === true;
  }
  return profile.is_active === true && profile.approval_status === "approved";
}

export function canApproveUsers(profile = authState.currentProfile) {
  return isApprovedProfile(profile) && ["admin", "super_admin"].includes(profile.role);
}

export function canManageRoles(profile = authState.currentProfile) {
  return isApprovedProfile(profile) && profile.role === "super_admin";
}

const MANAGEABLE_PROFILE_ROLES = ["user", "admin", "super_admin"];

function isClaimedAdminCreatedProfile(profile) {
  return profile?.is_active === true
    && profile?.claim_status === "claimed"
    && Boolean(String(profile?.created_by || "").trim());
}

function resolveApprovalRole(selectedRole) {
  if (!canManageRoles()) return "user";
  return MANAGEABLE_PROFILE_ROLES.includes(selectedRole) ? selectedRole : "user";
}

export async function initAuth() {
  authState.isLoading = true;
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    applySignedOutState(error.message);
  } else {
    await applySession(data.session);
  }

  authState.isLoading = false;

  supabase.auth.onAuthStateChange((_event, session) => {
    applySession(session).then(() => {
      window.dispatchEvent(new CustomEvent("auth:changed"));
    });
  });

  return authState;
}

export async function signInWithEmailPassword(identifier, password) {
  authState.isLoading = true;
  authState.error = "";

  const email = await resolveSignInEmail(identifier);
  if (!email) {
    authState.isLoading = false;
    authState.error = "No claimed profile was found for that email or username.";
    return { ok: false, message: authState.error };
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    authState.isLoading = false;
    authState.error = isUnconfirmedEmailError(error)
      ? "Your email is not confirmed yet. Please check your email and confirm your account."
      : error.message || "Sign in failed.";
    return { ok: false, message: authState.error };
  }

  await applySession(data.session);
  authState.isLoading = false;
  return { ok: true };
}

export async function createAccountWithEmailPassword({ claimCode, username, password }) {
  authState.isLoading = true;
  authState.error = "";

  const safeClaimCode = normalizeClaimCode(claimCode);
  if (!safeClaimCode) {
    authState.isLoading = false;
    return { ok: false, message: "Claim code is required." };
  }

  const previewResult = await loadClaimableProfile(safeClaimCode);
  if (!previewResult.ok) {
    authState.isLoading = false;
    authState.error = previewResult.message || "Claim code is invalid.";
    return { ok: false, message: authState.error };
  }

  const safeUsername = normalizeUsername(previewResult.profile?.login_username || username);
  if (!safeUsername) {
    authState.isLoading = false;
    return { ok: false, message: "A valid claim username was not found for this profile." };
  }

  authState.claimFlowActive = true;
  const email = buildClaimEmail(safeUsername);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: safeUsername, claim_code: safeClaimCode }
    }
  });

  if (error) {
    authState.claimFlowActive = false;
    authState.isLoading = false;
    authState.error = error.message || "Account creation failed.";
    return { ok: false, message: authState.error };
  }

  if (!data.user) {
    authState.claimFlowActive = false;
    authState.isLoading = false;
    authState.error = "Auth account was not created.";
    return { ok: false, message: authState.error };
  }

  if (!data.session) {
    authState.claimFlowActive = false;
    authState.isLoading = false;
    return {
      ok: false,
      message: "Supabase email confirmation is still enabled. Turn it off for this project before using no-email profile claims."
    };
  }

  const claimResult = await finalizeProfileClaim({
    profileId: previewResult.profile.id,
    claimCode: safeClaimCode,
    authUserId: data.user.id,
    username: safeUsername,
    email
  });

  if (!claimResult.ok) {
    authState.claimFlowActive = false;
    authState.isLoading = false;
    authState.error = claimResult.message || "Could not claim profile.";
    return { ok: false, message: authState.error };
  }

  await applySession(data.session);

  authState.claimFlowActive = false;
  authState.isLoading = false;
  return {
    ok: true,
    message: "Profile claimed. You can now sign in with your username and password."
  };
}

export async function createPendingProfile(authUser, formData = {}) {
  if (!authUser?.id) return { ok: false, message: "Auth user was not created." };

  const pendingProfile = {
    id: authUser.id,
    name: String(formData.name || authUser.email || "User").trim(),
    role: "user",
    is_active: false,
    approval_status: "pending"
  };
  const { data, error } = await supabase
    .from("profiles")
    .insert(pendingProfile)
    .select("*")
    .single();

  if (error) {
    if (isDuplicateProfileError(error)) {
      const existing = await loadCurrentProfile(authUser.id);
      if (existing.profile) return { ok: true, profile: existing.profile };
    }
    if (isMissingApprovalSchemaError(error)) {
      authState.approvalSchemaReady = false;
      console.warn("Supabase profiles approval columns are missing. Create approval_status, approved_by, and approved_at to enable signup approval gating.");
      return createLegacyInactiveProfile(authUser, formData);
    }
    authState.error = error.message || "Could not create pending profile.";
    console.error("Failed to create pending Supabase profile. Check profiles INSERT RLS policy for authenticated users.", error);
    return { ok: false, message: authState.error };
  }

  return { ok: true, profile: data };
}

export async function signOutCurrentUser() {
  authState.isLoading = true;
  authState.error = "";

  const { error } = await supabase.auth.signOut();
  if (error) {
    authState.isLoading = false;
    authState.error = error.message || "Sign out failed.";
    return { ok: false, message: authState.error };
  }

  applySignedOutState();
  authState.isLoading = false;
  return { ok: true };
}

export async function saveCurrentProfile({
  name,
  displayName,
  primaryPosition,
  secondaryPosition,
  thirdPosition,
  dominantFoot,
  jerseyNumber,
  avatarUrl
} = {}) {
  const user = authState.currentAuthUser;
  if (!user?.id) return { ok: false, message: "Sign in before saving a profile." };

  authState.error = "";
  const safeName = String(name || "").trim() || user.email || "User";
  const safeDisplayName = String(displayName || "").trim();
  const safePrimaryPosition = normalizePlayerPosition(primaryPosition);
  const playerProfileCompleted = Boolean((safeDisplayName || safeName) && safePrimaryPosition);
  const profilePatch = {
    id: authState.currentProfile?.id || user.id,
    auth_user_id: authState.currentProfile?.auth_user_id || user.id,
    name: safeName,
    display_name: safeDisplayName,
    primary_position: safePrimaryPosition,
    secondary_position: normalizePlayerPosition(secondaryPosition),
    third_position: normalizePlayerPosition(thirdPosition),
    dominant_foot: normalizeDominantFoot(dominantFoot),
    jersey_number: normalizeJerseyNumber(jerseyNumber),
    player_profile_completed: playerProfileCompleted,
    role: authState.currentProfile?.role || "user",
    is_active: authState.currentProfile?.is_active ?? false,
    approval_status: authState.currentProfile?.approval_status || "pending",
    claim_status: authState.currentProfile?.claim_status || "claimed",
    claimed_at: authState.currentProfile?.claimed_at || null,
    login_username: authState.currentProfile?.login_username || null,
    created_by: authState.currentProfile?.created_by || null
  };

  if (avatarUrl !== undefined) {
    profilePatch.avatar_url = avatarUrl || "";
  } else if (authState.currentProfile?.avatar_url) {
    profilePatch.avatar_url = authState.currentProfile.avatar_url;
  }

  const existingProfileId = String(authState.currentProfile?.id || "").trim();
  const isClaimedProfile = Boolean(existingProfileId && authState.currentProfile?.auth_user_id === user.id);
  const profileQuery = isClaimedProfile
    ? supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", existingProfileId)
        .eq("auth_user_id", user.id)
    : supabase
        .from("profiles")
        .upsert(profilePatch);

  const { data, error } = await profileQuery
    .select("*")
    .single();

  if (error) {
    if (isMissingAvatarSchemaError(error)) {
      console.warn("Supabase profiles avatar_url column is missing. Saving profile name without image until avatar_url is added.");
      return saveCurrentProfileWithoutAvatar(profilePatch);
    }
    if (isMissingPlayerProfileSchemaError(error)) {
      console.warn("Supabase player profile columns are missing. Saving account fields only until profile player columns are added.");
      return saveCurrentProfileWithoutPlayerFields(profilePatch);
    }
    if (isMissingApprovalSchemaError(error)) {
      authState.approvalSchemaReady = false;
      console.warn("Supabase profiles approval columns are missing. Saving profile with legacy columns only.");
      return saveLegacyProfile({ name, avatarUrl });
    }
    authState.error = error.message || "Could not save profile.";
    console.error("Failed to save Supabase profile.", error);
    return { ok: false, message: authState.error };
  }

  authState.currentProfile = data;
  setAuthenticatedProfile(data);
  return { ok: true, profile: data };
}

function normalizePlayerPosition(value) {
  const position = String(value || "").trim().toUpperCase();
  return ["GK", "CB", "WB", "CM", "WF", "CF"].includes(position) ? position : "";
}

function normalizeDominantFoot(value) {
  const foot = String(value || "").trim();
  return ["Right", "Left", "Both"].includes(foot) ? foot : "";
}

function normalizeJerseyNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  return String(value || "").trim().slice(0, 2) || null;
}

export async function loadPendingProfiles() {
  if (!canApproveUsers() || !authState.approvalSchemaReady) {
    authState.pendingProfiles = [];
    return [];
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("approval_status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    if (isMissingApprovalSchemaError(error)) {
      authState.approvalSchemaReady = false;
      console.warn("Supabase profiles approval columns are missing. Pending user review is disabled until the schema is updated.");
      authState.pendingProfiles = [];
      return [];
    }
    console.error("Failed to load pending profiles.", error);
    authState.pendingProfiles = [];
    return [];
  }

  authState.pendingProfiles = data || [];
  return authState.pendingProfiles;
}

export async function approveUserProfile(profileId, selectedRole = "user") {
  if (!canApproveUsers()) return { ok: false, message: "You do not have permission to approve users." };
  if (!authState.approvalSchemaReady) return { ok: false, message: "Approval columns are not available in Supabase yet." };
  const targetProfileId = String(profileId || "").trim();
  if (!targetProfileId) return { ok: false, message: "Approval target id is missing." };

  console.log("Approving pending profile.", { clickedProfileId: targetProfileId, selectedRole });

  const now = new Date().toISOString();
  const approvalPatch = {
    approval_status: "approved",
    is_active: true,
    approved_by: authState.currentProfile.id,
    approved_at: now,
    role: resolveApprovalRole(selectedRole)
  };

  const updateResult = await supabase
    .from("profiles")
    .update(approvalPatch)
    .eq("id", targetProfileId)
    .eq("approval_status", "pending");
  console.log("Pending profile approval update result.", {
    clickedProfileId: targetProfileId,
    selectedRole,
    data: updateResult.data,
    error: updateResult.error,
    status: updateResult.status
  });

  const approvalSucceeded = !updateResult.error;
  if (!approvalSucceeded) {
    console.error("Failed to approve pending profile.", updateResult.error);
    return { ok: false, message: updateResult.error.message || "Could not approve user." };
  }

  await loadPendingProfiles();
  return {
    ok: true,
    message: "User approved.",
    profileId: targetProfileId,
    status: updateResult.status
  };
}

export async function updateUserRole(profileId, newRole) {
  if (!canManageRoles()) return { ok: false, message: "Only super admins can change roles." };
  if (!profileId) return { ok: false, message: "Approval target id is missing." };
  if (!MANAGEABLE_PROFILE_ROLES.includes(newRole)) return { ok: false, message: "Invalid role." };

  const { data, error } = await supabase
    .from("profiles")
    .update({ role: newRole })
    .eq("id", profileId)
    .eq("approval_status", "pending")
    .select("*");

  if (error) {
    console.error("Failed to update pending profile role.", error);
    return { ok: false, message: approvalQueryErrorMessage(error, "Could not update role.") };
  }

  const updatedProfiles = data || [];
  if (updatedProfiles.length === 0) return { ok: false, message: "No matching profile found." };
  if (updatedProfiles.length > 1) return { ok: false, message: "More than one row matched approval query." };

  await loadPendingProfiles();
  return { ok: true, profile: updatedProfiles[0] };
}

async function createLegacyInactiveProfile(authUser, formData = {}) {
  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: authUser.id,
      name: String(formData.name || authUser.email || "User").trim(),
      role: "user",
      is_active: false
    })
    .select("*")
    .single();

  if (error) {
    if (isDuplicateProfileError(error)) {
      const existing = await loadLegacyCurrentProfile(authUser.id);
      if (existing.profile) return { ok: true, profile: existing.profile };
    }
    authState.error = error.message || "Could not create profile.";
    console.error("Failed to create legacy Supabase profile.", error);
    return { ok: false, message: authState.error };
  }

  return { ok: true, profile: data };
}

async function saveCurrentProfileWithoutAvatar(profilePatch) {
  const { avatar_url, ...safePatch } = profilePatch;
  const { data, error } = await supabase
    .from("profiles")
    .upsert(safePatch)
    .select("*")
    .single();

  if (error) {
    if (isMissingPlayerProfileSchemaError(error)) {
      return saveCurrentProfileWithoutPlayerFields(safePatch);
    }
    if (isMissingApprovalSchemaError(error)) {
      authState.approvalSchemaReady = false;
      return saveLegacyProfile({ name: safePatch.name });
    }
    authState.error = error.message || "Could not save profile.";
    console.error("Failed to save Supabase profile without avatar_url.", error);
    return { ok: false, message: authState.error };
  }

  authState.currentProfile = data;
  setAuthenticatedProfile(data);
  return {
    ok: true,
    profile: data,
    message: "Profile saved. Add an avatar_url column to keep profile images online."
  };
}

async function saveCurrentProfileWithoutPlayerFields(profilePatch) {
  const {
    display_name,
    primary_position,
    secondary_position,
    third_position,
    dominant_foot,
    jersey_number,
    player_profile_completed,
    ...safePatch
  } = profilePatch;

  const { data, error } = await supabase
    .from("profiles")
    .upsert(safePatch)
    .select("*")
    .single();

  if (error) {
    if (isMissingAvatarSchemaError(error)) return saveCurrentProfileWithoutAvatar(safePatch);
    authState.error = error.message || "Could not save profile.";
    console.error("Failed to save Supabase profile without player fields.", error);
    return { ok: false, message: authState.error };
  }

  authState.currentProfile = data;
  setAuthenticatedProfile(data);
  return {
    ok: true,
    profile: data,
    message: "Profile saved. Add player profile columns to keep position details online."
  };
}

async function saveLegacyProfile({ name, avatarUrl } = {}) {
  const user = authState.currentAuthUser;
  const legacyPatch = {
    id: user.id,
    name: String(name || "").trim() || user.email || "User",
    role: authState.currentProfile?.role || "user",
    is_active: authState.currentProfile?.is_active ?? false
  };

  if (avatarUrl !== undefined) legacyPatch.avatar_url = avatarUrl || "";

  const { data, error } = await supabase
    .from("profiles")
    .upsert(legacyPatch)
    .select("*")
    .single();

  if (error) {
    if (isMissingAvatarSchemaError(error)) {
      return saveLegacyProfileWithoutAvatar(legacyPatch);
    }
    authState.error = error.message || "Could not save profile.";
    console.error("Failed to save legacy Supabase profile.", error);
    return { ok: false, message: authState.error };
  }

  authState.currentProfile = data;
  setAuthenticatedProfile(data);
  return { ok: true, profile: data };
}

async function saveLegacyProfileWithoutAvatar(legacyPatch) {
  const { avatar_url, ...safePatch } = legacyPatch;
  const { data, error } = await supabase
    .from("profiles")
    .upsert(safePatch)
    .select("*")
    .single();

  if (error) {
    authState.error = error.message || "Could not save profile.";
    console.error("Failed to save legacy Supabase profile without avatar_url.", error);
    return { ok: false, message: authState.error };
  }

  authState.currentProfile = data;
  setAuthenticatedProfile(data);
  return {
    ok: true,
    profile: data,
    message: "Profile saved. Add an avatar_url column to keep profile images online."
  };
}

async function loadLegacyCurrentProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load legacy Supabase profile.", error);
    return { profile: null, error: error.message };
  }

  if (!data) {
    console.warn("No Supabase profile row found for authenticated user.", { userId });
    return { profile: null, error: "No profile row found." };
  }

  return { profile: data, error: "" };
}

function isMissingApprovalSchemaError(error) {
  const message = String(error?.message || "");
  return message.includes("approval_status")
    || message.includes("approved_by")
    || message.includes("approved_at")
    || message.includes("schema cache");
}

function isMissingAvatarSchemaError(error) {
  const message = String(error?.message || "");
  return message.includes("avatar_url");
}

function isMissingPlayerProfileSchemaError(error) {
  const message = String(error?.message || "");
  return message.includes("display_name")
    || message.includes("primary_position")
    || message.includes("secondary_position")
    || message.includes("third_position")
    || message.includes("dominant_foot")
    || message.includes("jersey_number")
    || message.includes("player_profile_completed");
}

function isDuplicateProfileError(error) {
  const message = String(error?.message || "").toLowerCase();
  return error?.code === "23505" || message.includes("duplicate") || message.includes("already exists");
}

function isUnconfirmedEmailError(error) {
  const message = String(error?.message || "").toLowerCase();
  const code = String(error?.code || "").toLowerCase();
  return code.includes("email_not_confirmed")
    || message.includes("email not confirmed")
    || message.includes("not confirmed")
    || message.includes("confirm your email");
}

function approvalQueryErrorMessage(error, fallback) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("multiple") || message.includes("more than one row")) {
    return "More than one row matched approval query.";
  }
  if (message.includes("0 rows") || message.includes("no rows") || message.includes("single json object")) {
    return "No matching profile found.";
  }
  return fallback;
}

export async function loadCurrentProfile(userId = authState.currentAuthUser?.id) {
  if (!userId) return { profile: null, error: "No authenticated user." };

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("auth_user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error, "auth_user_id")) {
      return loadLegacyCurrentProfile(userId);
    }
    if (isMissingApprovalSchemaError(error)) {
      authState.approvalSchemaReady = false;
      console.warn("Supabase profiles approval columns are missing. Using legacy profile fields until the schema is updated.");
      return loadLegacyCurrentProfile(userId);
    }
    console.error("Failed to load Supabase profile.", error);
    return { profile: null, error: error.message };
  }

  if (!data) {
    const legacyProfile = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (legacyProfile.error) {
      if (isMissingApprovalSchemaError(legacyProfile.error)) {
        authState.approvalSchemaReady = false;
        console.warn("Supabase profiles approval columns are missing. Using legacy profile fields until the schema is updated.");
        return loadLegacyCurrentProfile(userId);
      }
      console.error("Failed to load legacy-mapped Supabase profile.", legacyProfile.error);
      return { profile: null, error: legacyProfile.error.message };
    }

    if (!legacyProfile.data) {
      console.warn("No Supabase profile row found for authenticated user.", { userId });
      return { profile: null, error: "No profile row found." };
    }

    authState.approvalSchemaReady = Boolean(legacyProfile.data && Object.prototype.hasOwnProperty.call(legacyProfile.data, "approval_status"));
    return { profile: legacyProfile.data, error: "" };
  }

  authState.approvalSchemaReady = Boolean(data && Object.prototype.hasOwnProperty.call(data, "approval_status"));
  return { profile: data, error: "" };
}

export async function loadClaimableProfile(claimCode) {
  const safeClaimCode = normalizeClaimCode(claimCode);
  if (!safeClaimCode) return { ok: false, message: "Claim code is required." };

  const { data, error } = await supabase.rpc("preview_profile_claim", {
    p_claim_code: safeClaimCode
  });

  if (error) {
    authState.error = error.message || "Could not verify claim code.";
    return { ok: false, message: authState.error };
  }

  const preview = Array.isArray(data) ? data[0] : data;
  if (!preview) return { ok: false, message: "Claim code is invalid or already used." };

  authState.claimProfilePreview = preview;
  return { ok: true, profile: preview };
}

async function finalizeProfileClaim({ profileId, claimCode, authUserId, username, email }) {
  const { data, error } = await supabase.rpc("claim_player_profile", {
    p_profile_id: profileId,
    p_claim_code: claimCode,
    p_auth_user_id: authUserId,
    p_login_username: username,
    p_login_email: email
  });

  if (error) {
    console.error("Failed to finalize claimed profile.", error);
    return { ok: false, message: error.message || "Could not claim profile." };
  }

  const profile = Array.isArray(data) ? data[0] : data;
  if (!profile) return { ok: false, message: "Claim code is invalid or already used." };

  authState.currentProfile = profile;
  setAuthenticatedProfile(profile);
  return { ok: true, profile };
}

async function resolveSignInEmail(identifier) {
  const value = String(identifier || "").trim();
  if (!value) return "";
  if (value.includes("@")) return value;

  const username = normalizeUsername(value);
  if (!username) return "";

  const { data, error } = await supabase.rpc("resolve_profile_login_email", {
    p_login_username: username
  });

  if (error) {
    console.error("Failed to resolve username sign-in.", error);
    return "";
  }

  const row = Array.isArray(data) ? data[0] : data;
  return String(row?.login_email || "").trim();
}

function buildClaimEmail(username) {
  return `${username}@player.squadcraft.local`;
}

function normalizeUsername(value) {
  const username = String(value || "").trim().toLowerCase();
  return /^[a-z0-9_]{3,24}$/.test(username) ? username : "";
}

function normalizeClaimCode(value) {
  return String(value || "").trim().toUpperCase();
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || "");
  return message.includes(columnName);
}

async function applySession(session) {
  if (!session?.user) {
    applySignedOutState();
    return;
  }

  authState.currentSession = session;
  authState.currentAuthUser = session.user;
  authState.isAuthenticated = true;
  authState.error = "";

  const { profile, error } = await loadCurrentProfile(session.user.id);
  let nextProfile = profile;

  if (!nextProfile) {
    if (authState.claimFlowActive) {
      clearAuthenticatedProfile();
      authState.currentProfile = null;
      return;
    }
    console.warn("Authenticated user has no profile row. Creating pending profile.", { userId: session.user.id });
    const createdProfile = await createPendingProfile(session.user, {
      name: session.user.user_metadata?.name || session.user.email || "User"
    });
    if (!createdProfile.ok) {
      clearAuthenticatedProfile();
      authState.currentProfile = null;
      authState.error = createdProfile.message || error || "Profile missing.";
      return;
    }
    nextProfile = createdProfile.profile;
  }

  authState.currentProfile = nextProfile;
  setAuthenticatedProfile(nextProfile);
  await loadPendingProfiles();
}

function applySignedOutState(error = "") {
  authState.currentSession = null;
  authState.currentAuthUser = null;
  authState.currentProfile = null;
  authState.pendingProfiles = [];
  authState.isAuthenticated = false;
  authState.error = error;
  clearAuthenticatedProfile();
}
