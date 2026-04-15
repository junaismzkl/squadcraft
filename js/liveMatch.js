import { els } from "./dom.js?v=match-debug-v5";
import { addLiveGoal, completeLiveMatch, setLiveMotm } from "./result.js?v=match-debug-v5";
import { countScorers, getCurrentMatchPlayers, matchNowTimeValue, matchStartTime, OWN_GOAL_ID, scorerGoalTotal } from "./state.js?v=match-debug-v5";
import { escapeHtml } from "./utils.js?v=match-debug-v5";

let liveTimerId = null;
let highlightTimeoutId = null;

export function renderLiveMatch(teams, options = {}) {
  const card = document.createElement("section");
  card.className = "card live-match-screen";
  const highlightActive = Boolean(teams.lastGoal && Date.now() - Number(teams.lastGoal.timestamp || 0) < 2200);

  const livePlayers = getCurrentMatchPlayers();
  const teamAScore = scorerGoalTotal(teams.scorersA || []);
  const teamBScore = scorerGoalTotal(teams.scorersB || []);

  card.innerHTML = `
    <div class="live-match-nav">
      <button class="secondary compact-button live-back-button" type="button" data-live-back>Back to Match</button>
    </div>
    <div class="live-match-header">
      <div>
        <p class="live-label"><span class="live-dot"></span>LIVE MATCH</p>
        <h3>${escapeHtml(teams.teamAName)} vs ${escapeHtml(teams.teamBName)}</h3>
      </div>
      <p class="live-timer" data-live-timer>${formatElapsedTime(matchStartTime(teams))}</p>
    </div>
    <div class="live-scoreboard ${highlightActive ? "live-scoreboard-updated" : ""}">
      <div class="live-team-score ${isHighlightedTeam(teams, "a", highlightActive) ? "live-team-score-updated" : ""}">
        <span>${escapeHtml(teams.teamAName)}</span>
        <strong>${teamAScore}</strong>
      </div>
      <div class="live-score-divider">-</div>
      <div class="live-team-score ${isHighlightedTeam(teams, "b", highlightActive) ? "live-team-score-updated" : ""}">
        <span>${escapeHtml(teams.teamBName)}</span>
        <strong>${teamBScore}</strong>
      </div>
    </div>
    <div class="live-actions">
      <div class="live-goal-box" data-team="a">
        <button class="primary live-goal-button" type="button">+ Goal</button>
        <label class="live-goal-picker hidden">
          <span>${escapeHtml(teams.teamAName)} scorer</span>
          <select>
            <option value="">Select player</option>
            ${teams.teamA.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="live-goal-box" data-team="b">
        <button class="primary live-goal-button" type="button">+ Goal</button>
        <label class="live-goal-picker hidden">
          <span>${escapeHtml(teams.teamBName)} scorer</span>
          <select>
            <option value="">Select player</option>
            ${teams.teamB.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("")}
          </select>
        </label>
      </div>
    </div>
    <div class="live-scorers-grid">
      <section class="live-summary-card">
        <h4>${escapeHtml(teams.teamAName)}</h4>
        <div class="live-scorer-list" data-scorers="a">${renderScorerSummary(teams.scorersA, teams.teamA, teams.lastGoal, highlightActive, "a")}</div>
      </section>
      <section class="live-summary-card">
        <h4>${escapeHtml(teams.teamBName)}</h4>
        <div class="live-scorer-list" data-scorers="b">${renderScorerSummary(teams.scorersB, teams.teamB, teams.lastGoal, highlightActive, "b")}</div>
      </section>
    </div>
    <label class="motm-field live-motm-field">
      Man of the Match
      <select data-live-motm>
        <option value="">Select player</option>
        ${livePlayers.map((player) => `<option value="${player.id}" ${player.id === (teams.liveMotmId || "") ? "selected" : ""}>${escapeHtml(player.name)}</option>`).join("")}
      </select>
    </label>
    <button class="secondary full-width live-end-button" type="button">End Match</button>
  `;

  card.querySelector("[data-live-back]")?.addEventListener("click", () => {
    options.onBack?.();
  });
  bindLiveEvents(card);
  bindLiveTimer(card.querySelector("[data-live-timer]"), matchStartTime(teams));
  scheduleHighlightRefresh(teams.lastGoal);
  return card;
}

export function clearLiveTimer() {
  if (liveTimerId) {
    clearInterval(liveTimerId);
    liveTimerId = null;
  }
  if (highlightTimeoutId) {
    clearTimeout(highlightTimeoutId);
    highlightTimeoutId = null;
  }
}

function bindLiveEvents(card) {
  card.querySelectorAll(".live-goal-box").forEach((box) => {
    const picker = box.querySelector(".live-goal-picker");
    const select = picker.querySelector("select");
    const teamKey = box.dataset.team;

    box.querySelector(".live-goal-button").addEventListener("click", () => {
      card.querySelectorAll(".live-goal-picker").forEach((node) => node.classList.add("hidden"));
      picker.classList.toggle("hidden");
      if (!picker.classList.contains("hidden")) {
        select.focus();
      }
    });

    select.addEventListener("change", () => {
      if (!select.value) return;
      const added = addLiveGoal(teamKey, select.value);
      if (added && navigator.vibrate) {
        navigator.vibrate(18);
      }
      select.value = "";
      picker.classList.add("hidden");
      els.teamBalanceNote.textContent = "Live match updated.";
      dispatchLiveRefresh();
    });
  });

  card.querySelector("[data-live-motm]").addEventListener("change", (event) => {
    setLiveMotm(event.target.value);
  });

  card.querySelector(".live-end-button").addEventListener("click", () => {
    const motmId = card.querySelector("[data-live-motm]").value;
    if (!confirm("End this live match now?")) return;
    const result = completeLiveMatch(motmId);
    if (!result.ok) {
      alert(result.message);
      return;
    }
    dispatchLiveRefresh();
  });
}

function renderScorerSummary(scorers, players, lastGoal, highlightActive, teamKey) {
  const counts = countScorers(scorers);
  const entries = Object.entries(counts);
  if (!entries.length) {
    return '<p class="live-empty-text">No goals yet</p>';
  }

  return entries
    .map(([playerId, goals]) => {
      const player = playerId === OWN_GOAL_ID ? { name: "Own Goal" } : players.find((item) => item.id === playerId);
      const isLatest = highlightActive && lastGoal?.teamKey === teamKey && lastGoal?.playerId === playerId;
      return `<p class="${isLatest ? "live-scorer-highlight" : ""}"><strong>${escapeHtml(player?.name || "Unknown")}</strong> <span>(${goals})</span></p>`;
    })
    .join("");
}

function bindLiveTimer(node, startTime) {
  clearLiveTimer();
  if (!node) return;
  const update = () => {
    node.textContent = formatElapsedTime(startTime);
  };
  update();
  liveTimerId = window.setInterval(update, 30000);
}

function formatElapsedTime(startTime) {
  const start = new Date(startTime).getTime();
  if (Number.isNaN(start)) return "--'";
  const minutes = Math.max(0, Math.floor((matchNowTimeValue() - start) / 60000));
  return `${minutes}'`;
}

function dispatchLiveRefresh() {
  document.dispatchEvent(new CustomEvent("live-match:updated"));
}

function isHighlightedTeam(teams, teamKey, highlightActive) {
  return highlightActive && teams.lastGoal?.teamKey === teamKey;
}

function scheduleHighlightRefresh(lastGoal) {
  if (highlightTimeoutId) {
    clearTimeout(highlightTimeoutId);
    highlightTimeoutId = null;
  }

  if (!lastGoal) return;
  const remaining = 2200 - (Date.now() - Number(lastGoal.timestamp || 0));
  if (remaining <= 0) return;
  highlightTimeoutId = window.setTimeout(() => {
    dispatchLiveRefresh();
  }, remaining);
}
