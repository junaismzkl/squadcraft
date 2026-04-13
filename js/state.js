import { debugLog } from "./debug.js";
import { loadMatches, saveMatches } from "./storage.js";
import { escapeHtml, normalizeStoredRating, toDateTimeLocalValue } from "./utils.js";

export const DATA_VERSION = 3;

export const USER_ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  USER: "user"
};

export const DEFAULT_USERS = [
  { id: "u1", name: "Junais", role: USER_ROLES.SUPER_ADMIN, isActive: true },
  { id: "u2", name: "Admin Test", role: USER_ROLES.ADMIN, isActive: true },
  { id: "u3", name: "User Test", role: USER_ROLES.USER, isActive: true }
];

export const PERMISSIONS = {
  [USER_ROLES.SUPER_ADMIN]: {
    manageUsers: true,
    editAnyPlayer: true,
    deleteAnyPlayer: true,
    approvePlayer: true,
    ratePlayer: true,
    editOwnPlayer: true,
    createMatch: true,
    editAnyMatch: true,
    deleteAnyMatch: true,
    viewAuditLog: true
  },
  [USER_ROLES.ADMIN]: {
    manageUsers: false,
    editAnyPlayer: true,
    deleteAnyPlayer: true,
    approvePlayer: true,
    ratePlayer: true,
    editOwnPlayer: true,
    createMatch: true,
    editAnyMatch: true,
    deleteAnyMatch: true,
    viewAuditLog: true
  },
  [USER_ROLES.USER]: {
    manageUsers: false,
    editAnyPlayer: false,
    deleteAnyPlayer: false,
    approvePlayer: false,
    ratePlayer: false,
    editOwnPlayer: true,
    createMatch: true,
    editAnyMatch: false,
    deleteAnyMatch: false,
    viewAuditLog: false
  }
};

export const DEFAULT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' fill='%23eaf2ff'/%3E%3Ccircle cx='80' cy='62' r='32' fill='%232563eb'/%3E%3Cpath d='M28 144c7-31 27-47 52-47s45 16 52 47' fill='%232563eb'/%3E%3C/svg%3E";

export const formationsBySize = {
  5: ["2-1-1", "1-2-1"],
  6: ["2-2-1", "3-1-1"],
  7: ["3-2-1", "2-3-1", "2-2-2", "3-1-2"],
  8: ["3-1-3", "3-2-2", "3-3-1", "2-3-2", "2-2-3"],
  9: ["3-3-2", "4-3-1", "3-4-1"],
  10: ["4-3-2", "3-4-2"],
  11: ["4-4-2", "4-3-3", "4-2-3-1", "3-5-2", "3-4-3", "4-1-4-1"]
};

export const OWN_GOAL_ID = "OWN_GOAL";

export const roles = ["GK", "CB", "WB", "CM", "WF", "CF"];

export const roleFallbacks = {
  GK: [],
  CB: ["WB", "CM"],
  WB: ["CB"],
  CM: ["WB", "WF"],
  WF: ["CF"],
  CF: ["WF"]
};

export const state = {
  data: {
    players: [],
    matches: [],
    notifications: [],
    users: [],
    currentUserId: DEFAULT_USERS[0].id,
    authProfileId: "",
    activityLog: []
  },
  selectedPlayerIds: new Set(),
  matchGuestPlayers: [],
  currentTeams: null,
  isReady: false
};

export function createDefaultPlayerStats() {
  return {
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    motm: 0,
    cleanSheets: 0
  };
}

export function normalizePositionCode(value) {
  const directValue = String(value || "").trim().toUpperCase();
  if (roles.includes(directValue)) return directValue;

  const legacyMap = {
    GOALKEEPER: "GK",
    DEFENDER: "CB",
    MIDFIELDER: "CM",
    FORWARD: "CF"
  };

  return legacyMap[directValue] || "";
}

export function normalizePlayerPositions(player = {}) {
  const arrayPositions = Array.isArray(player.positions) ? player.positions : [];
  const primary = normalizePositionCode(
    arrayPositions[0] || player.positions?.primary || player.role || player.primaryPosition
  ) || "CM";
  const secondary = normalizePositionCode(
    arrayPositions[1] || player.positions?.secondary || player.position || player.secondaryPosition
  );
  const tertiary = normalizePositionCode(
    arrayPositions[2] || player.positions?.tertiary || player.tertiaryPosition
  );
  const ordered = [primary, secondary, tertiary].filter(Boolean);
  const unique = [...new Set(ordered)];

  return {
    primary: unique[0] || "CM",
    secondary: unique[1] || "",
    tertiary: unique[2] || ""
  };
}

export function getPlayerPositions(player = {}) {
  const positions = normalizePlayerPositions(player);
  return [positions.primary, positions.secondary, positions.tertiary].filter(Boolean);
}

export function getPrimaryPosition(player = {}) {
  return normalizePlayerPositions(player).primary;
}

export function isGoalkeeperPlayer(player = {}) {
  return getPrimaryPosition(player) === "GK" || getPlayerPositions(player).includes("GK");
}

export function setReady(isReady) {
  state.isReady = Boolean(isReady);
  debugLog("state.isReady updated", state.isReady);
}

export function setPlayers(players) {
  const safePlayers = sanitizePermanentPlayers(players);
  state.data = {
    ...state.data,
    players: safePlayers
  };
  debugLog("state.players updated", { count: state.data.players.length });
}

export function addPlayer(player) {
  if (player?.isGuest) {
    debugLog("ignored guest player add to permanent state", { id: player.id, name: player.name });
    return;
  }
  setPlayers([...state.data.players, player]);
}

export function updatePlayer(playerId, updater) {
  setPlayers(
    state.data.players.map((player) => {
      if (player.id !== playerId) return player;
      return updater({ ...player });
    })
  );
}

export function removePlayer(playerId) {
  setPlayers(state.data.players.filter((player) => player.id !== playerId));
}

export function updatePlayers(updater) {
  setPlayers(updater([...state.data.players]));
}

export function setMatches(matches) {
  state.data = {
    ...state.data,
    matches: [...(Array.isArray(matches) ? matches : [])].map(normalizeMatchRecord)
  };
  debugLog("state.matches updated", { count: state.data.matches.length });
}

export function updateMatch(matchId, updater) {
  setMatches(
    state.data.matches.map((match) => {
      if (match.id !== matchId) return match;
      return updater({ ...match });
    })
  );
}

export function removeMatch(matchId) {
  setMatches(state.data.matches.filter((match) => match.id !== matchId));
}

export function setUsers(users) {
  const normalizedUsers = normalizeUsers(users);
  const currentUserId = normalizedUsers.some((user) => user.id === state.data.currentUserId)
    ? state.data.currentUserId
    : normalizedUsers[0]?.id || DEFAULT_USERS[0].id;
  state.data = {
    ...state.data,
    users: normalizedUsers,
    currentUserId
  };
}

export function setCurrentUser(userId) {
  if (state.data.authProfileId) return;
  const nextUser = state.data.users.find((user) => user.id === userId && user.isActive);
  if (!nextUser) return;
  state.data = {
    ...state.data,
    currentUserId: nextUser.id
  };
  persist();
}

export function setAuthenticatedProfile(profile) {
  if (!profile?.id) return;
  const role = Object.values(USER_ROLES).includes(profile.role) ? profile.role : USER_ROLES.USER;
  const authUser = normalizeUser({
    id: profile.id,
    name: profile.name || "Supabase User",
    role,
    isActive: profile.is_active !== false,
    createdAt: profile.created_at || new Date().toISOString()
  });
  const users = normalizeUsers([
    ...state.data.users.filter((user) => user.id !== authUser.id),
    authUser
  ]);

  state.data = {
    ...state.data,
    users,
    currentUserId: authUser.id,
    authProfileId: authUser.id
  };
  persist();
}

export function clearAuthenticatedProfile() {
  if (!state.data.authProfileId) return;
  const fallbackUserId = state.data.users.find((user) => user.id === DEFAULT_USERS[0].id)?.id
    || state.data.users[0]?.id
    || DEFAULT_USERS[0].id;
  state.data = {
    ...state.data,
    authProfileId: "",
    currentUserId: fallbackUserId
  };
  persist();
}

export function getUserById(userId) {
  return state.data.users.find((user) => user.id === userId) || null;
}

export function getUserName(userId) {
  return getUserById(userId)?.name || "Unknown";
}

export function getCurrentUser() {
  return getUserById(state.data.currentUserId) || state.data.users[0] || normalizeUser(DEFAULT_USERS[0]);
}

export function hasPermission(permissionKey, user = getCurrentUser()) {
  if (!permissionKey || !user?.role) return false;
  if (user.isActive === false) return false;
  return Boolean(PERMISSIONS[user.role]?.[permissionKey]);
}

export function canEditPlayer(player, user = getCurrentUser()) {
  if (!player || !user) return false;
  return hasPermission("editAnyPlayer", user) || (hasPermission("editOwnPlayer", user) && player.ownerUserId === user.id);
}

export function canDeletePlayer(player, user = getCurrentUser()) {
  if (!player || !user) return false;
  return hasPermission("deleteAnyPlayer", user) || (hasPermission("editOwnPlayer", user) && player.ownerUserId === user.id && player.approvalStatus !== "approved");
}

export function canApprovePlayer(user = getCurrentUser()) {
  return hasPermission("approvePlayer", user);
}

export function canManagePlayers(user = getCurrentUser()) {
  return hasPermission("editAnyPlayer", user) || hasPermission("approvePlayer", user) || hasPermission("deleteAnyPlayer", user);
}

export function canRatePlayer(player, user = getCurrentUser()) {
  return Boolean(player && hasPermission("ratePlayer", user));
}

export function canEditMatch(match, user = getCurrentUser()) {
  if (!match || !user) return false;
  return hasPermission("editAnyMatch", user) || match.createdBy === user.id;
}

export function canDeleteMatch(match, user = getCurrentUser()) {
  if (!match || !user) return false;
  return hasPermission("deleteAnyMatch", user);
}

export function logActivity(action, entityType, entityId, details = {}) {
  const user = getCurrentUser();
  const entry = {
    id: `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    entityType,
    entityId,
    action,
    by: user?.id || "",
    byName: user?.name || "Unknown",
    at: new Date().toISOString(),
    details
  };
  state.data = {
    ...state.data,
    activityLog: [entry, ...(state.data.activityLog || [])].slice(0, 500)
  };
  return entry;
}

export function setTeams(teams) {
  state.currentTeams = teams ? { ...teams } : null;
  debugLog("state.currentTeams updated", state.currentTeams ? {
    id: state.currentTeams.id,
    status: state.currentTeams.status,
    teamASize: state.currentTeams.teamA?.length || 0,
    teamBSize: state.currentTeams.teamB?.length || 0
  } : null);
}

export function setMatchGuestPlayers(players) {
  state.matchGuestPlayers = [...(Array.isArray(players) ? players : [])].map((player) => normalizePlayerRecord({
    ...player,
    isGuest: true
  }));
  debugLog("state.matchGuestPlayers updated", { count: state.matchGuestPlayers.length });
}

export function addMatchGuestPlayer(player) {
  setMatchGuestPlayers([...state.matchGuestPlayers, player]);
}

export function removeMatchGuestPlayer(playerId) {
  setMatchGuestPlayers(state.matchGuestPlayers.filter((player) => player.id !== playerId));
}

export function clearMatchGuestPlayers() {
  setMatchGuestPlayers([]);
}

export function updateTeams(updater) {
  if (!state.currentTeams) return;
  const nextTeams = updater({
    ...state.currentTeams,
    teamA: [...state.currentTeams.teamA],
    teamB: [...state.currentTeams.teamB],
    scorersA: [...state.currentTeams.scorersA],
    scorersB: [...state.currentTeams.scorersB]
  });
  setTeams(nextTeams);
}

export function clearTeams() {
  setTeams(null);
}

export function setSelectedPlayerIds(playerIds) {
  state.selectedPlayerIds = new Set(playerIds);
  debugLog("state.selectedPlayerIds updated", { count: state.selectedPlayerIds.size });
}

export function addSelectedPlayerId(playerId) {
  setSelectedPlayerIds([...state.selectedPlayerIds, playerId]);
}

export function removeSelectedPlayerId(playerId) {
  setSelectedPlayerIds([...state.selectedPlayerIds].filter((id) => id !== playerId));
}

export function filterSelectedPlayerIds(predicate) {
  setSelectedPlayerIds([...state.selectedPlayerIds].filter(predicate));
}

export function clearSelectedPlayerIds() {
  setSelectedPlayerIds([]);
}

function loadStateData() {
  const fallback = {
    dataVersion: DATA_VERSION,
    players: [],
    matches: [],
    notifications: [],
    users: seedDefaultUsers(),
    currentUserId: DEFAULT_USERS[0].id,
    authProfileId: "",
    activityLog: []
  };
  const saved = loadMatches();
  if (!saved || !Array.isArray(saved.players) || !Array.isArray(saved.matches)) {
    return fallback;
  }

  saved.dataVersion = DATA_VERSION;
  saved.users = normalizeUsers(saved.users);
  saved.currentUserId = saved.users.some((user) => user.id === saved.currentUserId)
    ? saved.currentUserId
    : saved.users[0]?.id || DEFAULT_USERS[0].id;
  saved.authProfileId = "";
  state.data = {
    ...state.data,
    users: saved.users,
    currentUserId: saved.currentUserId,
    authProfileId: ""
  };
  saved.players = sanitizePermanentPlayers(saved.players);

  saved.matches.forEach((match) => {
    normalizeStoredMatch(match);
  });

  saved.notifications = Array.isArray(saved.notifications)
    ? saved.notifications.map(normalizeNotification).filter(Boolean)
    : [];
  saved.activityLog = Array.isArray(saved.activityLog)
    ? saved.activityLog.map(normalizeActivityLogEntry).filter(Boolean)
    : [];

  return saved;
}

export function initState() {
  const data = loadStateData();
  state.data = {
    ...state.data,
    currentUserId: data.currentUserId,
    authProfileId: ""
  };
  setUsers(data.users);
  setPlayers(data.players);
  setMatches(data.matches);
  setNotifications(data.notifications || []);
  setActivityLog(data.activityLog || []);
  clearSelectedPlayerIds();
  clearMatchGuestPlayers();
  clearTeams();
  setReady(true);
  persist();
}

export function persist() {
  saveMatches({
    dataVersion: DATA_VERSION,
    ...state.data,
    players: sanitizePermanentPlayers(state.data.players),
    matches: [...(state.data.matches || [])].map(normalizeMatchRecord),
    notifications: [...(state.data.notifications || [])],
    users: normalizeUsers(state.data.users),
    currentUserId: state.data.currentUserId || DEFAULT_USERS[0].id,
    authProfileId: state.data.authProfileId || "",
    activityLog: [...(state.data.activityLog || [])]
  });
}

export function normalizePlayerRecord(player = {}) {
  const positions = normalizePlayerPositions(player);
  const now = new Date().toISOString();
  const fallbackOwner = player.ownerUserId || player.createdBy || DEFAULT_USERS[0].id;
  const approvalStatus = player.approvalStatus === "pending" ? "pending" : "approved";
  return {
    ...player,
    rating: normalizeStoredRating(player.rating),
    positions,
    role: positions.primary,
    position: positions.secondary || "",
    image: player.image || "",
    isGuest: Boolean(player.isGuest),
    ownerUserId: fallbackOwner,
    createdBy: player.createdBy || fallbackOwner,
    createdAt: player.createdAt || now,
    updatedBy: player.updatedBy || player.createdBy || fallbackOwner,
    updatedAt: player.updatedAt || player.createdAt || now,
    approvedBy: approvalStatus === "approved" ? (player.approvedBy || DEFAULT_USERS[0].id) : "",
    approvedAt: approvalStatus === "approved" ? (player.approvedAt || player.createdAt || now) : "",
    approvalStatus,
    stats: {
      ...createDefaultPlayerStats(),
      ...(player.stats || {})
    }
  };
}

export function normalizeMatchRecord(match = {}) {
  const normalizedMatch = { ...match };
  normalizeStoredMatch(normalizedMatch);
  return normalizedMatch;
}

export function normalizeUser(user = {}) {
  const now = new Date().toISOString();
  const role = Object.values(USER_ROLES).includes(user.role) ? user.role : USER_ROLES.USER;
  return {
    id: String(user.id || `user-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    name: String(user.name || "User").trim() || "User",
    role,
    createdAt: user.createdAt || now,
    isActive: user.isActive !== false
  };
}

function seedDefaultUsers() {
  const now = new Date().toISOString();
  return DEFAULT_USERS.map((user) => ({
    ...user,
    createdAt: user.createdAt || now
  }));
}

export function normalizeUsers(users) {
  const normalized = [...(Array.isArray(users) && users.length ? users : seedDefaultUsers())]
    .map(normalizeUser)
    .filter((user) => user.id);
  const byId = new Map();
  [...seedDefaultUsers(), ...normalized].forEach((user) => byId.set(user.id, normalizeUser(user)));
  return [...byId.values()];
}

export function setActivityLog(activityLog) {
  state.data = {
    ...state.data,
    activityLog: [...(Array.isArray(activityLog) ? activityLog : [])]
      .map(normalizeActivityLogEntry)
      .filter(Boolean)
      .slice(0, 500)
  };
}

export function normalizeActivityLogEntry(entry) {
  if (!entry || !entry.action || !entry.entityType) return null;
  return {
    id: entry.id || `log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    entityType: entry.entityType,
    entityId: entry.entityId || "",
    action: entry.action,
    by: entry.by || DEFAULT_USERS[0].id,
    byName: entry.byName || getUserName(entry.by),
    at: entry.at || new Date().toISOString(),
    details: entry.details || {}
  };
}

export function normalizeStoredMatch(match) {
  const now = new Date().toISOString();
  const fallbackUserId = match.createdBy || DEFAULT_USERS[0].id;
  match.dateTime = match.dateTime || match.date || new Date().toISOString();
  match.startTime = match.startTime || match.dateTime;
  match.endTime = match.endTime || match.dateTime;
  match.teamAPlayers = Array.isArray(match.teamAPlayers) ? match.teamAPlayers : match.teamA || [];
  match.teamBPlayers = Array.isArray(match.teamBPlayers) ? match.teamBPlayers : match.teamB || [];
  match.teamAPlayers = snapshotTeam(match.teamAPlayers);
  match.teamBPlayers = snapshotTeam(match.teamBPlayers);
  match.captainA = match.captainA || match.captainAId || "";
  match.captainB = match.captainB || match.captainBId || "";

  if (!match.result && (Number.isFinite(Number(match.teamAScore)) || Number.isFinite(Number(match.teamBScore)))) {
    match.result = {
      scoreA: Number(match.teamAScore) || 0,
      scoreB: Number(match.teamBScore) || 0,
      scorersA: normalizeScorerEntries(expandLegacyScorers(match, "a")),
      scorersB: normalizeScorerEntries(expandLegacyScorers(match, "b")),
      manOfTheMatch: match.motmId || ""
    };
  }

  if (match.result) {
    match.result = {
      ...match.result,
      scoreA: Number(match.result.scoreA) || 0,
      scoreB: Number(match.result.scoreB) || 0,
      scorersA: normalizeScorerEntries(match.result.scorersA),
      scorersB: normalizeScorerEntries(match.result.scorersB),
      manOfTheMatch: match.result.manOfTheMatch || ""
    };
  }

  match.scorersA = normalizeScorerEntries(match.scorersA || match.result?.scorersA || []);
  match.scorersB = normalizeScorerEntries(match.scorersB || match.result?.scorersB || []);

  match.status = match.result ? "completed" : match.status || "upcoming";
  match.createdBy = match.createdBy || fallbackUserId;
  match.createdByName = match.createdByName || getUserName(match.createdBy);
  match.createdAt = match.createdAt || match.dateTime || now;
  match.updatedBy = match.updatedBy || match.createdBy;
  match.updatedByName = match.updatedByName || getUserName(match.updatedBy);
  match.updatedAt = match.updatedAt || match.createdAt || now;
  match.editHistory = Array.isArray(match.editHistory)
    ? match.editHistory.map(normalizeMatchEditHistoryEntry).filter(Boolean)
    : [];
}

export function normalizeMatchEditHistoryEntry(entry) {
  if (!entry || !entry.action) return null;
  return {
    action: entry.action,
    by: entry.by || DEFAULT_USERS[0].id,
    byName: entry.byName || getUserName(entry.by),
    at: entry.at || new Date().toISOString(),
    details: entry.details || {}
  };
}

export function normalizeNotification(notification) {
  if (!notification || !notification.id || (!notification.matchId && !notification.playerId)) return null;
  return {
    id: notification.id,
    matchId: notification.matchId || "",
    playerId: notification.playerId || "",
    userId: notification.userId || "",
    type: notification.type || "info",
    message: notification.message || "",
    read: Boolean(notification.read),
    createdAt: notification.createdAt || new Date().toISOString()
  };
}

export function expandLegacyScorers(match, teamKey) {
  const team = teamKey === "a" ? match.teamA || [] : match.teamB || [];
  const goalsByPlayer = match.goalsByPlayer || {};
  return team.flatMap((player) => Array.from({ length: Number(goalsByPlayer[player.id]) || 0 }, () => player.id));
}

export function normalizeScorerEntries(scorers) {
  if (!Array.isArray(scorers)) return [];
  return scorers
    .map((entry) => {
      if (typeof entry === "string") {
        return entry ? { playerId: entry, goals: 1 } : null;
      }
      if (!entry || typeof entry !== "object") return null;
      const playerId = String(entry.playerId || entry.id || "").trim();
      const goals = Math.max(1, Math.floor(Number(entry.goals) || 1));
      return { playerId, goals };
    })
    .filter(Boolean);
}

export function scorerGoalTotal(scorers) {
  return normalizeScorerEntries(scorers)
    .filter((entry) => entry.playerId)
    .reduce((total, entry) => total + (Number(entry.goals) || 0), 0);
}

export function matchDateTime(match) {
  return match.dateTime || match.date || new Date().toISOString();
}

export function matchStartTime(match) {
  return match.startTime || matchDateTime(match);
}

export function matchEndTime(match) {
  return match.endTime || matchStartTime(match);
}

export function matchTeamPlayers(match, teamKey) {
  if (teamKey === "a") return match.teamAPlayers || match.teamA || [];
  return match.teamBPlayers || match.teamB || [];
}

export function getMatchResult(match) {
  if (match.result) {
    return {
      scoreA: Number(match.result.scoreA) || 0,
      scoreB: Number(match.result.scoreB) || 0,
      scorersA: normalizeScorerEntries(match.result.scorersA),
      scorersB: normalizeScorerEntries(match.result.scorersB),
      manOfTheMatch: match.result.manOfTheMatch || ""
    };
  }

  if (!Number.isFinite(Number(match.teamAScore)) && !Number.isFinite(Number(match.teamBScore))) return null;
  return {
    scoreA: Number(match.teamAScore) || 0,
    scoreB: Number(match.teamBScore) || 0,
    scorersA: normalizeScorerEntries(expandLegacyScorers(match, "a")),
    scorersB: normalizeScorerEntries(expandLegacyScorers(match, "b")),
    manOfTheMatch: match.motmId || ""
  };
}

export function restoreLatestRelevantMatch() {
  const match = getLiveMatch() || getNearestUpcomingMatch();
  if (!match) return;
  restoreUpcomingMatch(match);
}

export function restoreUpcomingMatch(match) {
  const result = getMatchResult(match);
  setTeams({
    id: match.id,
    status: match.status || "upcoming",
    matchTime: matchDateTime(match) ? toDateTimeLocalValue(matchDateTime(match)) : "",
    startTime: matchStartTime(match),
    endTime: matchEndTime(match),
    teamAName: match.teamAName || "Team A",
    teamBName: match.teamBName || "Team B",
    managerName: match.managerName || "",
    managerTeam: match.managerTeam || "",
    formation: match.formation || match.formationA || "0-0-0",
    formationA: match.formationA || match.formation || "0-0-0",
    formationB: match.formationB || match.formation || "0-0-0",
    teamA: matchTeamPlayers(match, "a"),
    teamB: matchTeamPlayers(match, "b"),
    captainAId: match.captainA || match.captainAId || "",
    captainBId: match.captainB || match.captainBId || "",
    isDraft: false,
    resultOpen: false,
    result,
    scorersA: normalizeScorerEntries(result?.scorersA || match.scorersA || []),
    scorersB: normalizeScorerEntries(result?.scorersB || match.scorersB || []),
    liveMotmId: result?.manOfTheMatch || match.liveMotmId || "",
    lastGoal: match.lastGoal || null,
    createdBy: match.createdBy || "",
    createdByName: match.createdByName || "",
    createdAt: match.createdAt || "",
    updatedBy: match.updatedBy || "",
    updatedByName: match.updatedByName || "",
    updatedAt: match.updatedAt || "",
    editHistory: Array.isArray(match.editHistory) ? [...match.editHistory] : []
  });
  setSelectedPlayerIds([...state.currentTeams.teamA, ...state.currentTeams.teamB].map((player) => player.id));
  clearMatchGuestPlayers();
}

export function getNearestUpcomingMatch() {
  const now = Date.now();
  return state.data.matches
    .filter((match) => isUpcomingMatch(match, now))
    .sort((a, b) => matchStartTimeValue(a) - matchStartTimeValue(b))[0] || null;
}

export function getLiveMatch() {
  const now = Date.now();
  return state.data.matches
    .filter((match) => isLiveMatch(match, now))
    .sort((a, b) => matchStartTimeValue(a) - matchStartTimeValue(b))[0] || null;
}

export function matchTimeValue(match) {
  const time = new Date(matchDateTime(match)).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

export function matchStartTimeValue(match) {
  const time = new Date(matchStartTime(match)).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

export function matchEndTimeValue(match) {
  const time = new Date(matchEndTime(match)).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

export function isUpcomingMatch(match, now = Date.now()) {
  return getMatchStatus(match, now) === "upcoming";
}

export function isLiveMatch(match, now = Date.now()) {
  return getMatchStatus(match, now) === "live";
}

export function isCompletedMatch(match, now = Date.now()) {
  return getMatchStatus(match, now) === "completed";
}

export function isPendingResultMatch(match, now = Date.now()) {
  return getMatchStatus(match, now) === "pending_result";
}

export function getMatchStatus(match, now = Date.now()) {
  if (match.result || match.status === "completed") {
    return "completed";
  }

  if (match.status === "pending_result") {
    return "pending_result";
  }

  const start = matchStartTimeValue(match);
  const end = matchEndTimeValue(match);

  if (start === Number.MAX_SAFE_INTEGER || end === Number.MAX_SAFE_INTEGER) {
    return match.status || "upcoming";
  }

  if (now < start) return "upcoming";
  if (now > end) return "pending_result";
  return "live";
}

export function serializeCurrentMatch(overrides = {}) {
  if (!state.currentTeams) return null;
  const startTime = state.currentTeams.startTime ||
    (state.currentTeams.matchTime ? new Date(state.currentTeams.matchTime).toISOString() : new Date().toISOString());
  const endTime = state.currentTeams.endTime || startTime;
  const persistedTeamA = state.currentTeams.teamA.filter((player) => !player.isGuest);
  const persistedTeamB = state.currentTeams.teamB.filter((player) => !player.isGuest);
  const persistedPlayerIds = new Set([...persistedTeamA, ...persistedTeamB].map((player) => player.id));
  const persistedResult = state.currentTeams.result
    ? {
        ...state.currentTeams.result,
        scorersA: normalizeScorerEntries(state.currentTeams.result.scorersA).filter((entry) => entry.playerId === OWN_GOAL_ID || persistedPlayerIds.has(entry.playerId)),
        scorersB: normalizeScorerEntries(state.currentTeams.result.scorersB).filter((entry) => entry.playerId === OWN_GOAL_ID || persistedPlayerIds.has(entry.playerId)),
        manOfTheMatch: persistedPlayerIds.has(state.currentTeams.result.manOfTheMatch) ? state.currentTeams.result.manOfTheMatch : ""
      }
    : null;
  const match = {
    id: state.currentTeams.id,
    status: state.currentTeams.status || "upcoming",
    dateTime: startTime,
    startTime,
    endTime,
    teamAName: state.currentTeams.teamAName,
    teamBName: state.currentTeams.teamBName,
    formationA: state.currentTeams.formationA,
    formationB: state.currentTeams.formationB,
    formation: state.currentTeams.formation,
    teamAPlayers: snapshotTeam(persistedTeamA),
    teamBPlayers: snapshotTeam(persistedTeamB),
    captainA: persistedPlayerIds.has(state.currentTeams.captainAId) ? state.currentTeams.captainAId : "",
    captainB: persistedPlayerIds.has(state.currentTeams.captainBId) ? state.currentTeams.captainBId : "",
    managerName: state.currentTeams.managerName || "",
    managerTeam: state.currentTeams.managerTeam || "",
    result: persistedResult,
    scorersA: normalizeScorerEntries(state.currentTeams.scorersA).filter((entry) => entry.playerId === OWN_GOAL_ID || persistedPlayerIds.has(entry.playerId)),
    scorersB: normalizeScorerEntries(state.currentTeams.scorersB).filter((entry) => entry.playerId === OWN_GOAL_ID || persistedPlayerIds.has(entry.playerId)),
    liveMotmId: persistedPlayerIds.has(state.currentTeams.liveMotmId) ? state.currentTeams.liveMotmId : "",
    lastGoal: persistedPlayerIds.has(state.currentTeams.lastGoal?.playerId) ? state.currentTeams.lastGoal : null,
    createdBy: state.currentTeams.createdBy || "",
    createdByName: state.currentTeams.createdByName || "",
    createdAt: state.currentTeams.createdAt || "",
    updatedBy: state.currentTeams.updatedBy || "",
    updatedByName: state.currentTeams.updatedByName || "",
    updatedAt: state.currentTeams.updatedAt || "",
    editHistory: Array.isArray(state.currentTeams.editHistory) ? [...state.currentTeams.editHistory] : []
  };
  return { ...match, ...overrides };
}

export function persistCurrentMatch(overrides = {}) {
  const { forceSave = false, auditAction = "", auditDetails = {}, logAction = "", ...matchOverrides } = overrides;
  if (state.currentTeams?.isDraft && !forceSave) return;
  const baseMatch = serializeCurrentMatch(matchOverrides);
  if (!baseMatch) return;
  const existingMatch = state.data.matches.find((item) => item.id === baseMatch.id);
  const user = getCurrentUser();
  const now = new Date().toISOString();
  const match = {
    ...baseMatch,
    createdBy: existingMatch?.createdBy || baseMatch.createdBy || user.id,
    createdByName: existingMatch?.createdByName || baseMatch.createdByName || user.name,
    createdAt: existingMatch?.createdAt || baseMatch.createdAt || now,
    updatedBy: user.id,
    updatedByName: user.name,
    updatedAt: now,
    editHistory: [
      ...(existingMatch?.editHistory || baseMatch.editHistory || []),
      ...(auditAction ? [{
        action: auditAction,
        by: user.id,
        byName: user.name,
        at: now,
        details: auditDetails
      }] : [])
    ]
  };
  if (!match) return;
  const existingIndex = state.data.matches.findIndex((item) => item.id === match.id);
  if (existingIndex >= 0) {
    updateMatch(match.id, () => match);
  } else {
    setMatches([match, ...state.data.matches]);
  }
  if (logAction || auditAction) {
    logActivity(logAction || auditAction, "match", match.id, auditDetails);
  }
  persist();
}

export function setNotifications(notifications) {
  state.data = {
    ...state.data,
    notifications: notifications.map(normalizeNotification).filter(Boolean)
  };
  debugLog("state.notifications updated", { count: state.data.notifications.length });
}

export function addNotification(notification) {
  const nextNotification = normalizeNotification(notification);
  if (!nextNotification) return;
  setNotifications([nextNotification, ...(state.data.notifications || []).filter((item) => item.id !== nextNotification.id)]);
}

export function updateNotification(notificationId, updater) {
  setNotifications(
    (state.data.notifications || []).map((notification) => {
      if (notification.id !== notificationId) return notification;
      return normalizeNotification(updater({ ...notification })) || notification;
    })
  );
}

export function removeNotification(notificationId) {
  setNotifications((state.data.notifications || []).filter((notification) => notification.id !== notificationId));
}

export function getNotifications() {
  const currentUser = getCurrentUser();
  return [...(state.data.notifications || [])]
    .filter((notification) => !notification.userId || notification.userId === currentUser.id)
    .sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function markNotificationsReadForMatch(matchId) {
  setNotifications(
    (state.data.notifications || []).map((notification) =>
      notification.matchId === matchId ? { ...notification, read: true } : notification
    )
  );
}

export function syncNotificationsWithMatches() {
  const matchesById = new Map((state.data.matches || []).map((match) => [match.id, match]));
  const currentNotifications = state.data.notifications || [];
  const nextNotifications = currentNotifications.filter((notification) => {
    if (notification.type !== "pending_result") return true;
    const match = matchesById.get(notification.matchId);
    return Boolean(match && getMatchStatus(match) === "pending_result" && !match.result);
  });

  if (nextNotifications.length === currentNotifications.length) return;
  setNotifications(nextNotifications);
  persist();
}

export function getCurrentMatchPlayers() {
  if (state.currentTeams) return [...state.currentTeams.teamA, ...state.currentTeams.teamB];
  return [...state.data.players.filter((player) => state.selectedPlayerIds.has(player.id)), ...state.matchGuestPlayers];
}

export function matchResultText(match) {
  const teamAName = match.teamAName || "Team A";
  const teamBName = match.teamBName || "Team B";
  const computedStatus = getMatchStatus(match);
  const result = getMatchResult(match);
  if (computedStatus === "upcoming") return `${escapeHtml(teamAName)} vs ${escapeHtml(teamBName)} is upcoming`;
  if (computedStatus === "live") return `${escapeHtml(teamAName)} vs ${escapeHtml(teamBName)} is live`;
  if (computedStatus === "pending_result") return `${escapeHtml(teamAName)} vs ${escapeHtml(teamBName)} is waiting for a result`;
  if (!result) return `${escapeHtml(teamAName)} vs ${escapeHtml(teamBName)} was completed`;
  if (result.scoreA > result.scoreB) return `${escapeHtml(teamAName)} won ${result.scoreA}-${result.scoreB}`;
  if (result.scoreB > result.scoreA) return `${escapeHtml(teamBName)} won ${result.scoreB}-${result.scoreA}`;
  return `${escapeHtml(teamAName)} drew ${result.scoreA}-${result.scoreB} with ${escapeHtml(teamBName)}`;
}

export function scorersText(match) {
  const result = getMatchResult(match);
  const allPlayers = [...matchTeamPlayers(match, "a"), ...matchTeamPlayers(match, "b")];
  const counts = countScorers([...(result?.scorersA || []), ...(result?.scorersB || [])]);
  const scorers = Object.entries(counts).map(([playerId, goals]) => {
    if (playerId === OWN_GOAL_ID) return `Own Goal (${goals})`;
    const player = allPlayers.find((item) => item.id === playerId);
    return `${escapeHtml(player?.name || "Unknown")} (${goals})`;
  });

  return scorers.length ? scorers.join(", ") : "No scorers";
}

export function countScorers(scorers) {
  return normalizeScorerEntries(scorers).filter((entry) => entry.playerId).reduce((counts, entry) => {
    counts[entry.playerId] = (counts[entry.playerId] || 0) + (Number(entry.goals) || 0);
    return counts;
  }, {});
}

export function motmName(match) {
  const result = getMatchResult(match);
  const motmId = result?.manOfTheMatch || match.motmId || "";
  const allPlayers = [...matchTeamPlayers(match, "a"), ...matchTeamPlayers(match, "b")];
  return allPlayers.find((player) => player.id === motmId)?.name || match.motmName || "";
}

export function managerHistoryTeam(match, teamAName, teamBName) {
  if (match.managerTeam === "a") return ` (${escapeHtml(teamAName)})`;
  if (match.managerTeam === "b") return ` (${escapeHtml(teamBName)})`;
  return "";
}

export function snapshotTeam(players) {
  return players.map((player) => {
    const positions = normalizePlayerPositions(player);
    return {
      id: player.id,
      name: player.name,
      rating: normalizeStoredRating(player.rating),
      role: positions.primary,
      position: positions.secondary || "",
      positions,
      image: player.image || "",
      isGuest: player.isGuest,
      ownerUserId: player.ownerUserId || "",
      approvalStatus: player.approvalStatus || "approved",
      assignedPosition: normalizePositionCode(player.assignedPosition),
      assignedSlotIndex: player.assignedSlotIndex !== null && player.assignedSlotIndex !== undefined && player.assignedSlotIndex !== ""
        ? Number(player.assignedSlotIndex)
        : null,
      assignmentType: player.assignmentType || ""
    };
  });
}

function sanitizePermanentPlayers(players) {
  return [...(Array.isArray(players) ? players : [])]
    .filter((player) => player && !player.isGuest)
    .map((player) => normalizePlayerRecord({ ...player, isGuest: false }));
}
