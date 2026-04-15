import { debugLog } from "./debug.js?v=match-debug-v5";
import { formationsBySize, getPlayerPositions, roleFallbacks, roles } from "./state.js?v=match-debug-v5";
import { normalizeStoredRating } from "./utils.js?v=match-debug-v5";

const STRICT_FALLBACK = {
  CB: ["WB"],
  WB: ["CB"],
  CM: ["WB"],
  WF: ["CF"],
  CF: ["WF"]
};

const ROLE_PRIORITY = {
  GK: 0,
  CF: 1,
  CM: 2,
  CB: 3,
  WB: 4,
  WF: 5
};

const ROLE_Y_LEVELS = {
  GK: 92,
  CB: 80,
  WB: 68,
  CM: 55,
  WF: 38,
  CF: 25
};

const TEAM_A_Y = {
  GK: 8,
  CB: 18,
  WB: 20,
  CM: 28,
  WF: 40,
  CF: 58
};

const TEAM_B_Y = {
  GK: 92,
  CB: 82,
  WB: 82,
  CM: 68,
  WF: 56,
  CF: 42
};

const FORMATION_ROLE_SLOTS = {
  "2-2": ["GK", "CB", "WB", "WF", "CF"],
  "2-1-1": ["GK", "CB", "WB", "CM", "CF"],
  "1-2-1": ["GK", "CB", "CM", "CM", "CF"],
  "2-2-1": ["GK", "CB", "WB", "CM", "CM", "CF"],
  "3-1-1": ["GK", "WB", "CB", "WB", "CM", "CF"],
  "3-2-1": ["GK", "WB", "CB", "WB", "CM", "CM", "CF"],
  "2-3-1": ["GK", "CB", "WB", "CM", "CM", "WF", "CF"],
  "2-2-2": ["GK", "CB", "WB", "CM", "CM", "WF", "CF"],
  "3-1-2": ["GK", "WB", "CB", "WB", "CM", "WF", "CF"],
  "3-1-3": ["GK", "WB", "CB", "WB", "CM", "WF", "CF", "WF"],
  "3-2-2": ["GK", "WB", "CB", "WB", "CM", "CM", "WF", "CF"],
  "3-3-1": ["GK", "WB", "CB", "WB", "CM", "CM", "WF", "CF"],
  "2-3-2": ["GK", "CB", "WB", "CM", "CM", "WF", "WF", "CF"],
  "2-2-3": ["GK", "CB", "WB", "CM", "CM", "WF", "CF", "WF"],
  "3-2-3": ["GK", "WB", "CB", "WB", "CM", "CM", "WF", "CF", "WF"],
  "3-3-2": ["GK", "WB", "CB", "WB", "CM", "CM", "CM", "WF", "CF"],
  "4-3-1": ["GK", "WB", "CB", "CB", "WB", "CM", "CM", "CM", "CF"],
  "3-4-1": ["GK", "WB", "CB", "WB", "CM", "CM", "WF", "WF", "CF"],
  "4-2-3": ["GK", "WB", "CB", "CB", "WB", "CM", "CM", "WF", "CF", "WF"],
  "4-3-2": ["GK", "WB", "CB", "CB", "WB", "CM", "CM", "CM", "WF", "CF"],
  "3-4-2": ["GK", "WB", "CB", "WB", "CM", "CM", "WF", "WF", "CF", "CF"],
  "4-4-2": ["GK", "WB", "CB", "CB", "WB", "CM", "CM", "WF", "WF", "CF", "CF"],
  "4-3-3": ["GK", "WB", "CB", "CB", "WB", "CM", "CM", "CM", "WF", "CF", "WF"],
  "4-2-3-1": ["GK", "WB", "CB", "CB", "WB", "CM", "CM", "WF", "CM", "WF", "CF"],
  "3-5-2": ["GK", "WB", "CB", "WB", "CM", "CM", "CM", "WF", "WF", "CF", "CF"],
  "3-4-3": ["GK", "WB", "CB", "WB", "CM", "CM", "WF", "WF", "WF", "CF", "CF"],
  "4-1-4-1": ["GK", "WB", "CB", "CB", "WB", "CM", "CM", "WF", "CM", "WF", "CF"]
};

const REQUIRED_FORMATIONS_BY_SIZE = {
  5: ["2-2"],
  6: ["2-2-1"],
  7: ["3-1-2"],
  8: ["3-1-3"],
  9: ["3-2-3"],
  10: ["4-2-3"],
  11: ["4-3-3"]
};

export function parseFormation(formationStr) {
  const parts = String(formationStr || "0-0-0")
    .split("-")
    .map((part) => Number(part))
    .filter((value) => Number.isFinite(value) && value >= 0);
  return {
    parts,
    def: Math.max(0, parts[0] || 0),
    mid: Math.max(0, parts.slice(1, -1).reduce((sum, value) => sum + value, parts.length > 2 ? 0 : Number(parts[1] || 0))),
    fwd: Math.max(0, parts.length > 2 ? parts[parts.length - 1] || 0 : parts[2] || 0)
  };
}

export function getFormationOptions(teamSize) {
  const preferred = [
    ...(REQUIRED_FORMATIONS_BY_SIZE[teamSize] || []),
    ...(formationsBySize[teamSize] || [])
  ].filter((formation, index, formations) => formations.indexOf(formation) === index && isValidFormationString(formation, teamSize));
  if (preferred.length) return preferred;
  return teamSize > 1 ? ["1-1-1"] : ["0-0-0"];
}

export function validateFormationString(formationStr, teamSize) {
  const normalizedFormation = String(formationStr || "").trim();
  const fallbackFormation = getFormationOptions(teamSize)[0] || (teamSize > 1 ? "1-1-1" : "0-0-0");

  if (!normalizedFormation) {
    return {
      ok: false,
      message: `Missing formation for team size ${teamSize}.`,
      fallbackFormation
    };
  }

  if (isValidFormationString(normalizedFormation, teamSize)) {
    return {
      ok: true,
      formation: normalizedFormation,
      fallbackFormation
    };
  }

  return {
    ok: false,
    message: `Invalid formation "${normalizedFormation}" for team size ${teamSize}.`,
    fallbackFormation
  };
}

export function roleOrder(role) {
  const index = roles.indexOf(role);
  return index >= 0 ? index : roles.length;
}

export function pitchRole(role) {
  return roles.includes(role) || ["DEF", "MID", "ATT"].includes(role) ? role : "CM";
}

export function buildPositionSlots(teamSize, formationStr) {
  const resolvedFormation = getValidatedFormationString(formationStr, teamSize, "buildPositionSlots");
  const parsedFormation = parseFormation(resolvedFormation);
  const bands = buildFormationBands(parsedFormation.parts, teamSize);
  const slots = [];
  const roleSlots = getFormationRoleSlots(resolvedFormation, teamSize);
  let roleIndex = 0;

  if (teamSize > 0) {
    slots.push(...createGoalkeeperSlots().map((slot) => applySlotRole(slot, roleSlots[roleIndex++] || slot.code)));
  }

  bands.forEach((band, bandIndex) => {
    slots.push(...createBandSlots(band, bandIndex).map((slot) => applySlotRole(slot, roleSlots[roleIndex++] || slot.code)));
  });

  return slots;
}

export function getFormationRoleSlots(formationStr, teamSize) {
  const normalizedFormation = String(formationStr || "").trim();
  const mappedSlots = FORMATION_ROLE_SLOTS[normalizedFormation];

  if (mappedSlots?.length === Number(teamSize)) {
    return [...mappedSlots];
  }

  return buildFallbackRoleSlots(teamSize, normalizedFormation);
}

export function generateLineupPositions(players, formationStr, teamSide, captains = {}) {
  const slots = getPitchSlots(players.length, formationStr, teamSide).map((slot, index) => ({
    ...slot,
    slotIndex: index
  }));
  const assignedPlayers = distributeAssignedPlayersByRole(assignPlayersToPitchSlots(players, slots));
  const normalizedTeamSide = normalizeTeamSide(teamSide);

  debugLog("formation render mapping", {
    teamSide: normalizedTeamSide,
    formation: formationStr,
    players: players.length,
    slots: slots.map((slot) => slot.id)
  });

  return assignedPlayers.map(({ player, slot }) => {
    const isCaptain = normalizedTeamSide === "A" ? captains.captainAId === player.id : captains.captainBId === player.id;
    return {
      player,
      left: slot.left,
      top: slot.top,
      isCaptain,
      assignedPosition: slot.code,
      slotIndex: slot.slotIndex
    };
  });
}

export function getPitchPlayerPositions(players, teamKey, formationStr, captains = {}) {
  return generateLineupPositions(players, formationStr, teamKey, captains);
}

export function getPitchSlots(teamSize, formationStr, teamSide) {
  return attachPitchCoordinates(teamSide, buildPositionSlots(teamSize, formationStr));
}

export function generatePositionsForFormation(teamKey, rowsOrDef, mid, fwd) {
  const rowCounts = typeof rowsOrDef === "object"
    ? normalizeFormationRowCounts(
        {
          def: rowsOrDef.Defender ?? rowsOrDef.def,
          mid: rowsOrDef.Midfielder ?? rowsOrDef.mid,
          fwd: rowsOrDef.Forward ?? rowsOrDef.fwd
        },
        totalRowCount(rowsOrDef)
      )
    : normalizeFormationRowCounts({ def: rowsOrDef, mid, fwd }, 1 + Number(rowsOrDef || 0) + Number(mid || 0) + Number(fwd || 0));
  return attachPitchCoordinates(teamKey, buildPositionSlots(totalRowCount(rowCounts), `${rowCounts.Defender}-${rowCounts.Midfielder}-${rowCounts.Forward}`));
}

export function shortRole(role) {
  return pitchRole(role);
}

function normalizeFormationRowCounts(rows, playerCount) {
  const safePlayerCount = Math.max(0, Number(playerCount) || 0);
  if (safePlayerCount === 0) {
    return { Goalkeeper: 0, Defender: 0, Midfielder: 0, Forward: 0 };
  }

  const counts = {
    Goalkeeper: 1,
    Defender: Math.max(0, Number(rows.def) || 0),
    Midfielder: Math.max(0, Number(rows.mid) || 0),
    Forward: Math.max(0, Number(rows.fwd) || 0)
  };

  while (totalRowCount(counts) > safePlayerCount) {
    if (counts.Forward > 1) counts.Forward -= 1;
    else if (counts.Midfielder > 0) counts.Midfielder -= 1;
    else if (counts.Forward > 0) counts.Forward -= 1;
    else if (counts.Defender > 1) counts.Defender -= 1;
    else break;
  }

  while (totalRowCount(counts) < safePlayerCount) {
    if (counts.Midfielder <= counts.Forward) counts.Midfielder += 1;
    else counts.Forward += 1;
  }

  if (safePlayerCount >= 2 && counts.Defender === 0) {
    if (counts.Midfielder > 0) counts.Midfielder -= 1;
    else if (counts.Forward > 0) counts.Forward -= 1;
    counts.Defender = 1;
  }

  return counts;
}

function isValidFormationString(formationStr, teamSize) {
  const parsed = parseFormation(formationStr);
  const outfield = Math.max(0, teamSize - 1);
  const total = parsed.parts.reduce((sum, value) => sum + value, 0);
  if (outfield === 0) return total === 0;
  if (parsed.parts.length < 2) return false;
  return total === outfield
    && parsed.parts[0] >= 1
    && parsed.parts[parsed.parts.length - 1] >= 1
    && parsed.parts.slice(1, -1).every((value) => value >= 1)
    && parsed.parts[parsed.parts.length - 1] <= 3;
}

function getValidatedFormationString(formationStr, teamSize, context = "formation") {
  const validation = validateFormationString(formationStr, teamSize);
  if (validation.ok) return validation.formation;

  console.warn(
    `${context}: ${validation.message} Falling back to "${validation.fallbackFormation}".`,
    { formation: formationStr, teamSize }
  );
  return validation.fallbackFormation;
}

function totalRowCount(counts) {
  return (counts.Goalkeeper || 0) + (counts.Defender || 0) + (counts.Midfielder || 0) + (counts.Forward || 0);
}

function attachPitchCoordinates(teamSide, slots) {
  const normalizedTeamSide = normalizeTeamSide(teamSide);
  const lineOrder = ["Goalkeeper", "Defender", "Midfielder", "AttackingMidfield", "Forward"];
  const usedLines = ["Goalkeeper", "Defender", "Midfielder", "Forward"]
    .filter((line) => slots.some((slot) => slot.lineType === line));

  function getLineY(lineIndex, totalLines, teamSide) {
    const halfSize = 50;
    const spacing = halfSize / (totalLines + 1);

    if (teamSide === "A") {
      return spacing * (lineIndex + 1);
    }

    return 100 - (spacing * (lineIndex + 1));
  }

  return slots.map((slot) => {
    const lineKey = slot?.lineType === "Goalkeeper"
      ? "Goalkeeper"
      : slot?.lineType === "Defender"
        ? "Defender"
        : slot?.lineType === "Forward"
          ? "Forward"
          : slot?.lineType === "AttackingMidfield"
            ? "AttackingMidfield"
            : "Midfielder";
    const lineIndex = Math.max(0, usedLines.indexOf(lineKey));
    const y = getLineY(lineIndex, usedLines.length, normalizedTeamSide);
    const point = {
      x: slot.baseX ?? 50,
      y: clampPercent(y, 0, 100)
    };
    return {
      ...slot,
      left: point.x,
      top: point.y
    };
  });
}

function clampPercent(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTeamSide(teamSide) {
  return String(teamSide || "A").trim().toUpperCase() === "B" ? "B" : "A";
}

function getRoleBaseY(slot) {
  const role = slot?.code;
  if (role && Object.hasOwn(ROLE_Y_LEVELS, role)) {
    return ROLE_Y_LEVELS[role];
  }

  if (slot?.lineType === "Goalkeeper") return ROLE_Y_LEVELS.GK;
  if (slot?.lineType === "Defender") return ROLE_Y_LEVELS.CB;
  if (slot?.lineType === "Forward") return ROLE_Y_LEVELS.CF;
  return ROLE_Y_LEVELS.CM;
}

function assignPlayersToPitchSlots(players, slots) {
  const assigned = [];
  const usedPlayerIds = new Set();
  const usedSlotIds = new Set();

  players.forEach((player) => {
    const slot = slots.find((candidate) =>
      !usedSlotIds.has(candidate.id)
      && ["manual_swap", "manual_shift"].includes(player.assignmentType)
      && Number(player.assignedSlotIndex) === candidate.slotIndex
    );

    if (!slot || usedPlayerIds.has(player.id)) return;

    usedPlayerIds.add(player.id);
    usedSlotIds.add(slot.id);
    assigned.push({
      player: { ...player, assignedPosition: slot.code },
      slot
    });
  });

  slots.forEach((slot) => {
    if (usedSlotIds.has(slot.id)) return;

    const player = players.find((candidate) =>
      !usedPlayerIds.has(candidate.id)
      && candidate.assignedPosition === slot.code
      && canUseAssignedPosition(candidate, slot.code)
    );

    if (!player) return;

    usedPlayerIds.add(player.id);
    usedSlotIds.add(slot.id);
    assigned.push({
      player: { ...player, assignedPosition: slot.code },
      slot
    });
  });

  if (assigned.length >= Math.min(players.length, slots.length)) {
    return assigned;
  }

  const remainingPitchSlots = slots.filter((slot) => !usedSlotIds.has(slot.id));
  let prioritizedSlots = [...remainingPitchSlots].sort((a, b) => (
    (ROLE_PRIORITY[a.code] ?? Number.MAX_SAFE_INTEGER) - (ROLE_PRIORITY[b.code] ?? Number.MAX_SAFE_INTEGER)
    || a.id.localeCompare(b.id)
  ));
  const availablePlayers = players
    .filter((player) => !usedPlayerIds.has(player.id))
    .sort(comparePlayersForSlotting);
  const gkIndex = availablePlayers.findIndex((player) => getPrimaryPositionCode(player) === "GK");

  if (gkIndex >= 0) {
    const gkSlot = prioritizedSlots.find((slot) => slot.code === "GK");
    if (gkSlot) {
      const goalkeeper = availablePlayers.splice(gkIndex, 1)[0];
      assigned.push({
        player: { ...goalkeeper, assignedPosition: "GK" },
        slot: gkSlot
      });
      prioritizedSlots = prioritizedSlots.filter((slot) => slot.code !== "GK");
    }
  }

  const cfSlot = prioritizedSlots.find((slot) => slot.code === "CF");
  if (cfSlot) {
    const cfIndex = availablePlayers.findIndex((player) => getPrimaryPositionCode(player) === "CF");

    if (cfIndex >= 0) {
      const centerForward = availablePlayers.splice(cfIndex, 1)[0];
      assigned.push({
        player: { ...centerForward, assignedPosition: "CF" },
        slot: cfSlot
      });
      prioritizedSlots = prioritizedSlots.filter((slot) => slot !== cfSlot);
    }
  }

  const remainingSlots = [];

  prioritizedSlots.forEach((slot) => {
    const index = availablePlayers.findIndex((player) =>
      getPrimaryPositionCode(player) === slot.code
    );

    if (index === -1) {
      remainingSlots.push(slot);
      return;
    }

    const player = availablePlayers.splice(index, 1)[0];
    assigned.push({
      player: {
        ...player,
        assignedPosition: slot.code
      },
      slot
    });
  });

  remainingSlots.forEach((slot) => {
    const index = availablePlayers.findIndex((player) =>
      getPlayerPositions(player).slice(1).includes(slot.code)
    );

    if (index === -1) return;

    const player = availablePlayers.splice(index, 1)[0];
    assigned.push({
      player: {
        ...player,
        assignedPosition: slot.code
      },
      slot
    });
  });

  return assigned;
}

function distributeAssignedPlayersByRole(assignedPlayers) {
  const grouped = assignedPlayers.reduce((groups, item) => {
    const key = item.slot.line;
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});

  return Object.values(grouped).flatMap((group) => {
    return group
      .sort((a, b) => a.slot.left - b.slot.left || a.player.name.localeCompare(b.player.name))
      .map((item) => ({
        ...item,
        slot: {
          ...item.slot,
          left: item.slot.left,
          top: item.slot.top
        }
      }));
  });
}

function comparePlayersForSlotting(a, b) {
  return roleOrder(getPrimaryPositionCode(a)) - roleOrder(getPrimaryPositionCode(b))
    || normalizeStoredRating(b.rating) - normalizeStoredRating(a.rating)
    || a.name.localeCompare(b.name);
}

function getPrimaryPositionCode(player) {
  return getPlayerPositions(player)[0] || "CM";
}

function getRoleGroup(role) {
  if (role === "GK") return "GK";
  if (role === "CB" || role === "WB") return "DEF";
  if (role === "CM") return "MID";
  if (role === "WF" || role === "CF" || role === "ATT") return "ATT";
  if (role === "DEF" || role === "MID") return role;
  return "MID";
}

function canUseAssignedPosition(player, slotRole) {
  if (getPlayerPositions(player).includes(slotRole)) return true;
  return [
    "fallback_near_fit",
    "out_of_position",
    "forced_goalkeeper_outfield",
    "manual_swap",
    "manual_shift"
  ].includes(player.assignmentType);
}

function getSlotPriority(slot) {
  const group = getRoleGroup(slot?.code);
  if (group === "GK") return 0;
  if (group === "DEF") return 1;
  if (group === "MID") return 2;
  return 3;
}

function applySlotRole(slot, role) {
  return {
    ...slot,
    code: role,
    fallbackRoles: [role],
    baseY: getRoleBaseY({ code: role, lineType: slot.lineType })
  };
}

function buildFallbackRoleSlots(teamSize, formationStr) {
  const parsed = parseFormation(formationStr);
  const roles = ["GK"];

  parsed.parts.forEach((count, index) => {
    const isDefenderLine = index === 0;
    const isForwardLine = index === parsed.parts.length - 1;

    if (isDefenderLine) {
      roles.push(...getDefenderRoleSlots(count));
      return;
    }

    if (isForwardLine) {
      roles.push(...getForwardRoleSlots(count));
      return;
    }

    roles.push(...getMidfieldRoleSlots(count));
  });

  return roles.slice(0, Math.max(0, Number(teamSize) || 0));
}

function getDefenderRoleSlots(count) {
  if (count <= 0) return [];
  if (count === 1) return ["CB"];
  if (count === 2) return ["CB", "WB"];
  if (count === 3) return ["WB", "CB", "WB"];
  return ["WB", ...Array.from({ length: count - 2 }, () => "CB"), "WB"];
}

function getMidfieldRoleSlots(count) {
  if (count <= 0) return [];
  if (count <= 2) return Array.from({ length: count }, () => "CM");
  return [
    ...Array.from({ length: Math.ceil(count / 2) }, () => "CM"),
    ...Array.from({ length: Math.floor(count / 2) }, () => "WF")
  ];
}

function getForwardRoleSlots(count) {
  if (count <= 0) return [];
  if (count === 1) return ["CF"];
  if (count === 2) return ["WF", "CF"];
  return ["WF", "CF", ...Array.from({ length: count - 2 }, () => "WF")];
}

function makeSlot(id, code, line, x, fallbackRoles = buildSlotFallbackRoles(code, line), baseY = null, lineType = line) {
  return {
    id,
    code,
    line,
    lineType,
    baseX: x,
    baseY: baseY ?? getRoleBaseY({ code, lineType }),
    fallbackRoles: [...(fallbackRoles || [code])]
  };
}

function createGoalkeeperSlots() {
  return [makeSlot("GK-1", "GK", "Goalkeeper", 50)];
}

function createDefenderSlots(count, line = "Defender", baseY = ROLE_Y_LEVELS.CB) {
  if (count <= 0) return [];
  return getDistributedXs(count).map((x, index) => (
    makeSlot(`DEF-${index + 1}`, getLineRoleForIndex("Defender", count, index), line, x, undefined, baseY, "Defender")
  ));
}

function createMidfieldSlots(
  count,
  line = "Midfielder",
  baseY = ROLE_Y_LEVELS.CM,
  fallbackRoles = null,
  roleLine = "Midfielder"
) {
  return getDistributedXs(count).map((x, index) => {
    const roleCode = getLineRoleForIndex(roleLine, count, index);
    return makeSlot(
      `MID-${index + 1}`,
      roleCode,
      line,
      x,
      fallbackRoles || buildSlotFallbackRoles(roleCode),
      baseY,
      roleLine
    );
  });
}

function createForwardSlots(count, line = "Forward", baseY = ROLE_Y_LEVELS.CF) {
  if (count <= 0) return [];
  return getDistributedXs(count).map((x, index) => (
    makeSlot(`ATT-${index + 1}`, getLineRoleForIndex("Forward", count, index), line, x, undefined, baseY, "Forward")
  ));
}

function getDistributedXs(count) {
  if (count <= 0) return [];
  if (count === 1) return [50];
  if (count === 2) return [20, 80];
  if (count === 3) return [10, 50, 90];
  if (count === 4) return [10, 30, 70, 90];
  return getRangeDistributedXs(count, 15, 85);
}

function getRangeDistributedXs(count, minX = 20, maxX = 80) {
  if (count <= 0) return [];
  if (count === 1) return [50];
  const step = (maxX - minX) / (count - 1);
  return Array.from({ length: count }, (_, index) => clampPercent(minX + step * index, 12, 88));
}

function buildSlotFallbackRoles(code) {
  if (!code) return ["CM"];
  return [code, ...(roleFallbacks[code] || []).filter((role) => role !== code)];
}

function buildFormationBands(parts, teamSize) {
  const safeTeamSize = Math.max(0, Number(teamSize) || 0);
  const outfieldCount = Math.max(0, safeTeamSize - 1);
  const safeParts = parts
    .map((value) => Math.max(0, Number(value) || 0))
    .filter((value) => value > 0);

  if (outfieldCount === 0 || !safeParts.length) return [];

  const total = safeParts.reduce((sum, value) => sum + value, 0);
  if (total !== outfieldCount) {
    return [
      { count: Math.max(1, safeParts[0] || 0), line: "Defender", lineType: "Defender", baseY: ROLE_Y_LEVELS.CB },
      { count: Math.max(1, outfieldCount - Math.max(1, safeParts[0] || 0)), line: "Midfielder", lineType: "Midfielder", baseY: ROLE_Y_LEVELS.CM }
    ].filter((band) => band.count > 0);
  }

  const firstBaseY = ROLE_Y_LEVELS.CB;
  const lastBaseY = ROLE_Y_LEVELS.CF;
  const step = safeParts.length <= 1 ? 0 : (firstBaseY - lastBaseY) / (safeParts.length - 1);

  return safeParts.map((count, index) => {
    const lineType = getFormationBandLineType(index, safeParts.length);
    return {
      count,
      line: safeParts.length > 3 ? `${lineType}-${index + 1}` : lineType,
      lineType,
      baseY: Math.round(firstBaseY - (step * index))
    };
  });
}

function createBandSlots(band, bandIndex) {
  const slotPrefix = getBandSlotPrefix(band.lineType);
  if (band.lineType === "Defender") {
    return createDefenderSlots(band.count, band.line, band.baseY).map((slot, index) => ({
      ...slot,
      id: `${slotPrefix}-${bandIndex + 1}-${index + 1}`
    }));
  }

  if (band.lineType === "Forward") {
    return createForwardSlots(band.count, band.line, band.baseY).map((slot, index) => ({
      ...slot,
      id: `${slotPrefix}-${bandIndex + 1}-${index + 1}`
    }));
  }

  const roleLine = band.lineType === "AttackingMidfield" ? "AttackingMidfield" : "Midfielder";
  return createMidfieldSlots(
    band.count,
    band.line,
    band.baseY,
    null,
    roleLine
  ).map((slot, index) => ({
    ...slot,
    id: `${slotPrefix}-${bandIndex + 1}-${index + 1}`
  }));
}

function getBandSlotPrefix(lineType) {
  if (lineType === "Defender") return "DEF";
  if (lineType === "Forward") return "ATT";
  if (lineType === "AttackingMidfield") return "AM";
  return "MID";
}

function getFormationBandLineType(index, totalBands) {
  if (index === 0) return "Defender";
  if (index === totalBands - 1) return "Forward";
  if (totalBands > 3 && index === totalBands - 2) return "AttackingMidfield";
  return "Midfielder";
}

function getLineRoleForIndex(line, count, index) {
  if (line === "Defender") {
    if (isSidePosition(count, index)) return "WB";
    return "CB";
  }

  if (line === "Forward") {
    if (isSidePosition(count, index)) return "WF";
    return "CF";
  }

  if (line === "AttackingMidfield") {
    if (count === 1) return "CM";
    if (isSidePosition(count, index)) return "WF";
    return "CM";
  }

  return "CM";
}

function isSidePosition(count, index) {
  if (count <= 1) return false;
  return index === 0 || index === count - 1;
}

function getRowYOffset(index) {
  return index * 3;
}
