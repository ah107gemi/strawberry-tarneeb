/**
 * Strawberry Tarneeb Scoreboard
 * Logic & State Engine
 */

(function () {
  'use strict';

  // Constants & Defaults
  const DEFAULT_PLAYERS = ['Ahmed', 'Hosam', 'Shiba', 'Furjani', 'Surum'];
  const TOTAL_ROUNDS = 15;
  const STORAGE_KEY_STATE = 'strawberry_tarneeb_state_v1';
  const STORAGE_KEY_HISTORY = 'strawberry_tarneeb_history_v1';

  // State
  let state = {
    players: [...DEFAULT_PLAYERS],
    // rounds: 15 arrays, each of length players.length, storing number or null
    rounds: Array.from({ length: TOTAL_ROUNDS }, () => Array(DEFAULT_PLAYERS.length).fill(null)),
    activeRound: 0, // 0-indexed (Round 1 = 0)
    gameStartedAt: new Date().toISOString()
  };

  let deferredInstallPrompt = null;
  let activeFastPlayerIndex = 0; // for fast keypad focus

  // DOM Elements
  const podiumContainer = document.getElementById('podiumContainer');
  const secondaryStandingsList = document.getElementById('secondaryStandingsList');
  const tableHeaderRow = document.getElementById('tableHeaderRow');
  const tableBody = document.getElementById('tableBody');
  const tableFooterRow = document.getElementById('tableFooterRow');
  const tableScrollContainer = document.getElementById('tableScrollContainer');
  const activeRoundLabel = document.getElementById('activeRoundLabel');
  const dealerInfoTag = document.getElementById('dealerInfoTag');
  const roundProgressBar = document.getElementById('roundProgressBar');
  const playerCountTag = document.getElementById('playerCountTag');

  // Modals
  const modalFastEntry = document.getElementById('modalFastEntry');
  const modalPlayers = document.getElementById('modalPlayers');
  const modalNewGame = document.getElementById('modalNewGame');
  const modalHistory = document.getElementById('modalHistory');
  const modalVictory = document.getElementById('modalVictory');

  // Fast modal elements
  const fastModalRoundTitle = document.getElementById('fastModalRoundTitle');
  const fastModalDealer = document.getElementById('fastModalDealer');
  const fastPlayerList = document.getElementById('fastPlayerList');
  const btnPrevRound = document.getElementById('btnPrevRound');
  const btnNextRound = document.getElementById('btnNextRound');
  let fastModalRoundIndex = 0;

  // Manage Players elements
  const playerManageList = document.getElementById('playerManageList');
  const newPlayerNameInput = document.getElementById('newPlayerNameInput');
  const btnAddPlayer = document.getElementById('btnAddPlayer');
  const btnSavePlayers = document.getElementById('btnSavePlayers');
  const btnResetDefaultPlayers = document.getElementById('btnResetDefaultPlayers');

  // History elements
  const historyListContainer = document.getElementById('historyListContainer');
  const btnClearAllHistory = document.getElementById('btnClearAllHistory');

  // Confetti Canvas
  const confettiCanvas = document.getElementById('confettiCanvas');
  let confettiCtx = confettiCanvas.getContext('2d');
  let confettiParticles = [];
  let confettiAnimId = null;

  // ==========================================================================
  // INITIALIZATION & STORAGE
  // ==========================================================================

  function init() {
    loadState();
    setupPWA();
    setupEventListeners();
    renderAll();

    // Check if initial load is already completed game
    checkGameCompletion(false);
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATE);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.players && Array.isArray(parsed.players) && parsed.players.length > 0) {
          state.players = parsed.players;
        }
        if (parsed.rounds && Array.isArray(parsed.rounds)) {
          // Normalize rounds to 15 rounds and match player count
          state.rounds = Array.from({ length: TOTAL_ROUNDS }, (_, rIdx) => {
            const savedRow = parsed.rounds[rIdx] || [];
            return state.players.map((_, pIdx) => {
              const val = savedRow[pIdx];
              return (val !== null && val !== undefined && val !== '') ? Number(val) : null;
            });
          });
        }
        if (typeof parsed.activeRound === 'number') {
          state.activeRound = Math.min(Math.max(0, parsed.activeRound), TOTAL_ROUNDS - 1);
        }
        if (parsed.gameStartedAt) {
          state.gameStartedAt = parsed.gameStartedAt;
        }
      }
    } catch (e) {
      console.warn('Error reading state from localStorage:', e);
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
    } catch (e) {
      console.warn('Error saving state to localStorage:', e);
    }
  }

  function getHistory() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      console.warn('Error reading history:', e);
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch (e) {
      console.warn('Error saving history:', e);
    }
  }

  // ==========================================================================
  // CORE CALCULATION & RANKING LOGIC
  // ==========================================================================

  /**
   * Calculates Total Score for each player:
   * = SUM(Round 1 : Round 15)
   */
  function calculateTotals() {
    const totals = state.players.map((name, pIdx) => {
      let sum = 0;
      let playedRounds = 0;
      for (let r = 0; r < TOTAL_ROUNDS; r++) {
        const val = state.rounds[r][pIdx];
        if (val !== null && !isNaN(val)) {
          sum += val;
          playedRounds++;
        }
      }
      return {
        playerIndex: pIdx,
        name: name,
        total: sum,
        playedRounds: playedRounds
      };
    });
    return totals;
  }

  /**
   * Dynamic Live Ranking:
   * Ranked from 1st to Nth based on highest total score descending.
   */
  function calculateRankings() {
    const totals = calculateTotals();
    // Sort descending by total score
    totals.sort((a, b) => b.total - a.total);

    // Assign rank with tie handling
    let currentRank = 1;
    for (let i = 0; i < totals.length; i++) {
      if (i > 0 && totals[i].total === totals[i - 1].total) {
        totals[i].rank = totals[i - 1].rank;
      } else {
        totals[i].rank = currentRank;
      }
      currentRank++;
    }

    return totals;
  }

  /**
   * Determine the current active round (the first round that still has unentered scores)
   */
  function detectActiveRound() {
    for (let r = 0; r < TOTAL_ROUNDS; r++) {
      const isComplete = state.players.every((_, pIdx) => state.rounds[r][pIdx] !== null);
      if (!isComplete) {
        return r;
      }
    }
    return TOTAL_ROUNDS - 1; // all completed
  }

  function getDealerForRound(roundIndex) {
    if (state.players.length === 0) return '';
    // Cyclical dealer rotation
    const dealerIdx = roundIndex % state.players.length;
    return state.players[dealerIdx];
  }

  // ==========================================================================
  // RENDERING
  // ==========================================================================

  function renderAll() {
    state.activeRound = detectActiveRound();
    renderHeaderInfo();
    renderLeaderboard();
    renderScoreboardTable();
    playerCountTag.textContent = `${state.players.length} Players`;
  }

  function renderHeaderInfo() {
    const roundNumber = state.activeRound + 1;
    const dealer = getDealerForRound(state.activeRound);
    activeRoundLabel.textContent = `Round ${roundNumber} of ${TOTAL_ROUNDS}`;
    dealerInfoTag.textContent = `• Dealer: ${dealer} 🂠`;

    // Calculate overall completed rounds percentage
    let completedCount = 0;
    for (let r = 0; r < TOTAL_ROUNDS; r++) {
      if (state.players.every((_, pIdx) => state.rounds[r][pIdx] !== null)) {
        completedCount++;
      }
    }
    const percent = Math.round((completedCount / TOTAL_ROUNDS) * 100);
    roundProgressBar.style.width = `${percent}%`;
  }

  /**
   * Render Top Leaderboard with Gold / Silver / Bronze podium
   */
  function renderLeaderboard() {
    const rankings = calculateRankings();
    if (rankings.length === 0) return;

    const first = rankings[0];
    const second = rankings.length > 1 ? rankings[1] : null;
    const third = rankings.length > 2 ? rankings[2] : null;

    // Podium HTML (1st, 2nd, 3rd)
    let podiumHtml = '';

    // 2nd Place (Left)
    if (second) {
      const diff1 = second.total - first.total;
      podiumHtml += `
        <div class="podium-item second">
          <div class="podium-badge">🥈</div>
          <span class="podium-rank-tag">2nd Place</span>
          <div class="podium-name" title="${escapeHtml(second.name)}">${escapeHtml(second.name)}</div>
          <div class="podium-score num">${second.total}</div>
          <div class="podium-gap num">${diff1 === 0 ? 'Tied 1st' : `${diff1} pts`}</div>
        </div>
      `;
    }

    // 1st Place (Center - Prominent)
    podiumHtml += `
      <div class="podium-item first">
        <div class="podium-badge">👑</div>
        <span class="podium-rank-tag">1st Place</span>
        <div class="podium-name" title="${escapeHtml(first.name)}">${escapeHtml(first.name)}</div>
        <div class="podium-score num">${first.total}</div>
        <div class="podium-gap num">${second ? (first.total === second.total ? 'Tied' : `+${first.total - second.total} ahead`) : 'Leader'}</div>
      </div>
    `;

    // 3rd Place (Right)
    if (third) {
      const diff1 = third.total - first.total;
      podiumHtml += `
        <div class="podium-item third">
          <div class="podium-badge">🥉</div>
          <span class="podium-rank-tag">3rd Place</span>
          <div class="podium-name" title="${escapeHtml(third.name)}">${escapeHtml(third.name)}</div>
          <div class="podium-score num">${third.total}</div>
          <div class="podium-gap num">${diff1 === 0 ? 'Tied 1st' : `${diff1} pts`}</div>
        </div>
      `;
    }

    podiumContainer.innerHTML = podiumHtml;

    // 4th, 5th, etc. Remaining Standings
    let remainingHtml = '';
    for (let i = 3; i < rankings.length; i++) {
      const item = rankings[i];
      const diff1 = item.total - first.total;
      remainingHtml += `
        <div class="standing-row">
          <div class="standing-left">
            <span class="standing-rank">${item.rank}</span>
            <span class="standing-name">${escapeHtml(item.name)}</span>
          </div>
          <div class="standing-right">
            <span class="standing-diff num">${diff1 === 0 ? 'Tied' : `${diff1} pts`}</span>
            <span class="standing-score num">${item.total}</span>
          </div>
        </div>
      `;
    }
    secondaryStandingsList.innerHTML = remainingHtml;
  }

  /**
   * Render Full Matrix Scoreboard Table
   */
  function renderScoreboardTable() {
    const totals = calculateTotals();

    // 1. Table Header (Sticky)
    let headerHtml = `<th class="col-round">Round</th>`;
    state.players.forEach((player, pIdx) => {
      const playerTotal = totals[pIdx]?.total ?? 0;
      headerHtml += `
        <th>
          <div class="player-header-wrap">
            <span class="player-header-name">${escapeHtml(player)}</span>
            <span class="player-header-total num">${playerTotal} pts</span>
          </div>
        </th>
      `;
    });
    tableHeaderRow.innerHTML = headerHtml;

    // 2. Table Body (15 Rounds)
    let bodyHtml = '';
    for (let r = 0; r < TOTAL_ROUNDS; r++) {
      const roundNum = r + 1;
      const dealer = getDealerForRound(r);
      const isActive = r === state.activeRound;

      bodyHtml += `<tr id="tableRow-${r}" class="${isActive ? 'active-round' : ''}">`;
      bodyHtml += `
        <td class="col-round">
          <div class="round-info-cell">
            <span class="round-num-label">R${roundNum}</span>
            <span class="dealer-tag" title="Dealer: ${escapeHtml(dealer)}">🂠 ${escapeHtml(dealer)}</span>
          </div>
        </td>
      `;

      // Inputs for each player
      state.players.forEach((_, pIdx) => {
        const val = state.rounds[r][pIdx];
        const displayVal = val !== null ? val : '';
        bodyHtml += `
          <td>
            <div class="score-input-wrap">
              <input 
                type="number" 
                inputmode="numeric" 
                pattern="[0-9\-]*" 
                class="score-cell-input" 
                data-round="${r}" 
                data-player="${pIdx}" 
                value="${displayVal}" 
                placeholder="-"
                autocomplete="off"
              />
            </div>
          </td>
        `;
      });
      bodyHtml += `</tr>`;
    }
    tableBody.innerHTML = bodyHtml;

    // 3. Table Footer (Totals `=SUM(Round 1 : Round 15)`)
    let footerHtml = `<td class="col-round">TOTAL</td>`;
    state.players.forEach((_, pIdx) => {
      const total = totals[pIdx]?.total ?? 0;
      footerHtml += `
        <td>
          <span class="footer-total-score num">${total}</span>
        </td>
      `;
    });
    tableFooterRow.innerHTML = footerHtml;

    // Attach in-cell input event handlers
    attachTableInputListeners();
  }

  function attachTableInputListeners() {
    const inputs = tableBody.querySelectorAll('.score-cell-input');
    inputs.forEach((input) => {
      input.addEventListener('focus', function () {
        this.select();
        const r = parseInt(this.dataset.round, 10);
        updateActiveRowHighlight(r);
      });

      input.addEventListener('input', function () {
        const r = parseInt(this.dataset.round, 10);
        const p = parseInt(this.dataset.player, 10);
        const valStr = this.value.trim();

        if (valStr === '' || isNaN(valStr)) {
          state.rounds[r][p] = null;
        } else {
          state.rounds[r][p] = Number(valStr);
        }

        saveState();
        updateScoresFast();
      });

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const r = parseInt(this.dataset.round, 10);
          const p = parseInt(this.dataset.player, 10);

          // Focus next player in same round, or next round first player
          let nextP = p + 1;
          let nextR = r;
          if (nextP >= state.players.length) {
            nextP = 0;
            nextR = r + 1;
          }

          if (nextR < TOTAL_ROUNDS) {
            const nextInput = tableBody.querySelector(`.score-cell-input[data-round="${nextR}"][data-player="${nextP}"]`);
            if (nextInput) nextInput.focus();
          } else {
            this.blur();
            checkGameCompletion(true);
          }
        }
      });
    });
  }

  /**
   * Fast incremental UI update without destroying input focus
   */
  function updateScoresFast() {
    const totals = calculateTotals();

    // Update header total tags
    const headerTotals = tableHeaderRow.querySelectorAll('.player-header-total');
    headerTotals.forEach((el, pIdx) => {
      el.textContent = `${totals[pIdx]?.total ?? 0} pts`;
    });

    // Update footer total values
    const footerTotals = tableFooterRow.querySelectorAll('.footer-total-score');
    footerTotals.forEach((el, pIdx) => {
      el.textContent = `${totals[pIdx]?.total ?? 0}`;
    });

    // Update Leaderboard
    renderLeaderboard();
    renderHeaderInfo();

    checkGameCompletion(true);
  }

  function updateActiveRowHighlight(activeRoundIdx) {
    const rows = tableBody.querySelectorAll('tr');
    rows.forEach((row, idx) => {
      if (idx === activeRoundIdx) {
        row.classList.add('active-round');
      } else {
        row.classList.remove('active-round');
      }
    });
  }

  function scrollToActiveRound() {
    const activeRow = document.getElementById(`tableRow-${state.activeRound}`);
    if (activeRow) {
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const firstInput = activeRow.querySelector('.score-cell-input');
      if (firstInput) firstInput.focus();
    }
  }

  // ==========================================================================
  // FAST ROUND ENTRY MODAL
  // ==========================================================================

  function openFastEntryModal(roundIdx = null) {
    if (roundIdx === null) {
      roundIdx = state.activeRound;
    }
    fastModalRoundIndex = Math.min(Math.max(0, roundIdx), TOTAL_ROUNDS - 1);
    renderFastModalContent();
    modalFastEntry.classList.add('open');
  }

  function closeFastEntryModal() {
    modalFastEntry.classList.remove('open');
    renderAll();
  }

  function renderFastModalContent() {
    const roundNum = fastModalRoundIndex + 1;
    const dealer = getDealerForRound(fastModalRoundIndex);

    fastModalRoundTitle.textContent = `Round ${roundNum} of ${TOTAL_ROUNDS}`;
    fastModalDealer.textContent = `Dealer: ${dealer} 🂠`;

    btnPrevRound.disabled = fastModalRoundIndex <= 0;
    btnNextRound.disabled = fastModalRoundIndex >= TOTAL_ROUNDS - 1;

    let html = '';
    state.players.forEach((player, pIdx) => {
      const val = state.rounds[fastModalRoundIndex][pIdx];
      const isDealer = (fastModalRoundIndex % state.players.length) === pIdx;
      html += `
        <div class="fast-player-card ${isDealer ? 'active-dealer' : ''}" data-player="${pIdx}">
          <div class="fast-player-info">
            <span class="fast-player-name">${escapeHtml(player)} ${isDealer ? '🂠' : ''}</span>
            <span class="fast-player-sub">${isDealer ? 'Dealer' : 'Player'}</span>
          </div>
          <div class="fast-player-controls">
            <button class="btn-step" data-action="minus" data-player="${pIdx}">-</button>
            <input 
              type="number" 
              inputmode="numeric" 
              class="fast-input-box num" 
              data-player="${pIdx}" 
              value="${val !== null ? val : ''}" 
              placeholder="0"
            />
            <button class="btn-step" data-action="plus" data-player="${pIdx}">+</button>
          </div>
        </div>
      `;
    });
    fastPlayerList.innerHTML = html;

    // Attach listeners for fast inputs and steppers
    const inputs = fastPlayerList.querySelectorAll('.fast-input-box');
    inputs.forEach((input) => {
      input.addEventListener('focus', function () {
        this.select();
        activeFastPlayerIndex = parseInt(this.dataset.player, 10);
      });
      input.addEventListener('input', function () {
        const p = parseInt(this.dataset.player, 10);
        const val = this.value.trim();
        state.rounds[fastModalRoundIndex][p] = val === '' || isNaN(val) ? null : Number(val);
        saveState();
      });
    });

    const stepBtns = fastPlayerList.querySelectorAll('.btn-step');
    stepBtns.forEach((btn) => {
      btn.addEventListener('click', function () {
        triggerHaptic();
        const p = parseInt(this.dataset.player, 10);
        const action = this.dataset.action;
        let current = state.rounds[fastModalRoundIndex][p];
        if (current === null || isNaN(current)) current = 0;

        if (action === 'plus') current += 1;
        if (action === 'minus') current -= 1;

        state.rounds[fastModalRoundIndex][p] = current;
        saveState();

        const input = fastPlayerList.querySelector(`.fast-input-box[data-player="${p}"]`);
        if (input) input.value = current;
      });
    });
  }

  // Quick number pills
  const numPills = document.querySelectorAll('.num-pill');
  numPills.forEach((pill) => {
    pill.addEventListener('click', function () {
      triggerHaptic();
      const val = parseInt(this.dataset.val, 10);
      state.rounds[fastModalRoundIndex][activeFastPlayerIndex] = val;
      saveState();

      const input = fastPlayerList.querySelector(`.fast-input-box[data-player="${activeFastPlayerIndex}"]`);
      if (input) input.value = val;

      // Auto-advance focus to next player in list
      if (activeFastPlayerIndex < state.players.length - 1) {
        activeFastPlayerIndex++;
        const nextInput = fastPlayerList.querySelector(`.fast-input-box[data-player="${activeFastPlayerIndex}"]`);
        if (nextInput) {
          nextInput.focus();
        }
      }
    });
  });

  // ==========================================================================
  // PLAYER MANAGEMENT
  // ==========================================================================

  function openPlayersModal() {
    renderPlayerManageList();
    modalPlayers.classList.add('open');
  }

  function closePlayersModal() {
    modalPlayers.classList.remove('open');
  }

  function renderPlayerManageList() {
    let html = '';
    state.players.forEach((name, idx) => {
      html += `
        <div class="player-manage-row" data-index="${idx}">
          <span style="font-size: 0.8rem; color: var(--text-dim); width: 20px;">#${idx + 1}</span>
          <input type="text" class="player-name-input" value="${escapeHtml(name)}" data-index="${idx}" maxlength="16"/>
          ${state.players.length > 2 ? `<button class="btn-del-player" data-index="${idx}" title="Delete Player">&times;</button>` : ''}
        </div>
      `;
    });
    playerManageList.innerHTML = html;

    // Attach delete listeners
    const delBtns = playerManageList.querySelectorAll('.btn-del-player');
    delBtns.forEach((btn) => {
      btn.addEventListener('click', function () {
        const idx = parseInt(this.dataset.index, 10);
        if (confirm(`Remove "${state.players[idx]}" from the game?`)) {
          state.players.splice(idx, 1);
          // Also remove score column
          for (let r = 0; r < TOTAL_ROUNDS; r++) {
            state.rounds[r].splice(idx, 1);
          }
          saveState();
          renderPlayerManageList();
        }
      });
    });
  }

  function handleSavePlayers() {
    const inputs = playerManageList.querySelectorAll('.player-name-input');
    const newNames = [];
    inputs.forEach((inp) => {
      const val = inp.value.trim();
      newNames.push(val || `Player ${newNames.length + 1}`);
    });

    state.players = newNames;
    saveState();
    closePlayersModal();
    renderAll();
    showToast('Player names updated!');
  }

  function handleAddPlayer() {
    const name = newPlayerNameInput.value.trim();
    if (!name) return;
    state.players.push(name);
    // Add null score to each round
    for (let r = 0; r < TOTAL_ROUNDS; r++) {
      state.rounds[r].push(null);
    }
    newPlayerNameInput.value = '';
    saveState();
    renderPlayerManageList();
  }

  function handleResetDefaultPlayers() {
    if (confirm('Reset players to the default 5: Ahmed, Hosam, Shiba, Furjani, Surum?')) {
      state.players = [...DEFAULT_PLAYERS];
      state.rounds = Array.from({ length: TOTAL_ROUNDS }, () => Array(DEFAULT_PLAYERS.length).fill(null));
      saveState();
      renderPlayerManageList();
      renderAll();
      showToast('Reset to default 5 players!');
    }
  }

  // ==========================================================================
  // MATCH HISTORY & ARCHIVING
  // ==========================================================================

  function openHistoryModal() {
    renderHistoryList();
    modalHistory.classList.add('open');
  }

  function closeHistoryModal() {
    modalHistory.classList.remove('open');
  }

  function archiveCurrentMatch() {
    const rankings = calculateRankings();
    if (rankings.length === 0) return;

    // Check if any scores exist
    const hasAnyScore = state.rounds.some(r => r.some(s => s !== null));
    if (!hasAnyScore) return;

    const history = getHistory();
    const matchRecord = {
      id: 'match_' + Date.now(),
      date: new Date().toLocaleString(),
      players: [...state.players],
      totals: calculateTotals(),
      rankings: rankings,
      winner: rankings[0].name,
      winnerScore: rankings[0].total,
      rounds: JSON.parse(JSON.stringify(state.rounds))
    };

    history.unshift(matchRecord); // newest first
    saveHistory(history);
  }

  function renderHistoryList() {
    const history = getHistory();
    if (history.length === 0) {
      historyListContainer.innerHTML = `
        <div class="history-empty">
          <p style="font-size: 2rem; margin-bottom: 8px;">📭</p>
          <p>No archived matches yet.</p>
          <span style="font-size: 0.75rem;">Finished games will appear here with final scores and dates.</span>
        </div>
      `;
      return;
    }

    let html = '';
    history.forEach((m, idx) => {
      html += `
        <div class="history-card-item">
          <div class="history-meta">
            <span>📅 ${escapeHtml(m.date)}</span>
            <button class="btn-subtle" style="padding: 2px 6px; color: #ef4444;" onclick="window.deleteHistoryMatch('${m.id}')">Delete</button>
          </div>
          <div class="history-winner-banner">
            <span>👑 Winner: ${escapeHtml(m.winner)} (${m.winnerScore} pts)</span>
          </div>
          <div class="history-standings-mini">
            ${m.rankings.map(r => `<span class="history-pill">${r.rank}. ${escapeHtml(r.name)} (${r.total})</span>`).join('')}
          </div>
        </div>
      `;
    });
    historyListContainer.innerHTML = html;
  }

  window.deleteHistoryMatch = function (id) {
    if (confirm('Delete this saved match record?')) {
      const history = getHistory().filter(m => m.id !== id);
      saveHistory(history);
      renderHistoryList();
      showToast('Match record deleted');
    }
  };

  function clearAllHistory() {
    if (confirm('Are you sure you want to delete ALL archived match history? This cannot be undone.')) {
      saveHistory([]);
      renderHistoryList();
      showToast('All history cleared');
    }
  }

  // ==========================================================================
  // NEW GAME & RESET LOGIC
  // ==========================================================================

  function openNewGameModal() {
    modalNewGame.classList.add('open');
  }

  function closeNewGameModal() {
    modalNewGame.classList.remove('open');
  }

  function confirmNewGame() {
    const shouldArchive = document.getElementById('chkArchiveBeforeReset').checked;
    const keepPlayers = document.getElementById('chkKeepPlayers').checked;

    if (shouldArchive) {
      archiveCurrentMatch();
    }

    if (!keepPlayers) {
      state.players = [...DEFAULT_PLAYERS];
    }

    // Reset scores to 15 rounds of null
    state.rounds = Array.from({ length: TOTAL_ROUNDS }, () => Array(state.players.length).fill(null));
    state.activeRound = 0;
    state.gameStartedAt = new Date().toISOString();

    saveState();
    closeNewGameModal();
    renderAll();
    showToast('New match started! Good luck! 🍓');
  }

  function clearCurrentRoundScores() {
    const roundNum = state.activeRound + 1;
    if (confirm(`Clear all scores entered for Round ${roundNum}?`)) {
      state.rounds[state.activeRound] = Array(state.players.length).fill(null);
      saveState();
      renderAll();
      showToast(`Round ${roundNum} scores cleared.`);
    }
  }

  // ==========================================================================
  // SHARING STANDINGS (WHATSAPP / CLIPBOARD)
  // ==========================================================================

  function shareGame() {
    const rankings = calculateRankings();
    if (rankings.length === 0) return;

    let text = `🍓 *Strawberry Tarneeb Scoreboard* 🍓\n`;
    text += `📅 ${new Date().toLocaleDateString()}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;

    rankings.forEach((r, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
      text += `${medal} *${r.name}*: ${r.total} pts\n`;
    });

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `Game Progress: Round ${state.activeRound + 1} of 15\n`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Standings copied to clipboard! Ready to paste into WhatsApp 📋');
      }).catch(() => {
        promptFallbackCopy(text);
      });
    } else {
      promptFallbackCopy(text);
    }
  }

  function promptFallbackCopy(text) {
    window.prompt('Copy game standings:', text);
  }

  // ==========================================================================
  // GAME COMPLETION & CONFETTI CELEBRATION
  // ==========================================================================

  let celebrationTriggeredForCurrent = false;

  function checkGameCompletion(triggerCelebration = true) {
    // Check if every single round from 1 to 15 has all scores filled
    const allFilled = state.rounds.every(row => row.every(val => val !== null && !isNaN(val)));

    if (allFilled && triggerCelebration && !celebrationTriggeredForCurrent) {
      celebrationTriggeredForCurrent = true;
      showVictoryModal();
    }
  }

  function showVictoryModal() {
    const rankings = calculateRankings();
    if (rankings.length === 0) return;

    const winner = rankings[0];
    document.getElementById('victoryWinnerName').textContent = winner.name;
    document.getElementById('victoryScore').textContent = `Total Score: ${winner.total} pts`;

    let podiumListHtml = '';
    rankings.forEach((r, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
      podiumListHtml += `
        <div style="display: flex; justify-content: space-between; padding: 6px 12px; background: #0f172a; border-radius: 8px; font-weight: 700; font-size: 0.9rem;">
          <span>${medal} ${escapeHtml(r.name)}</span>
          <span style="color: #fde047;">${r.total} pts</span>
        </div>
      `;
    });
    document.getElementById('victoryPodiumList').innerHTML = podiumListHtml;

    modalVictory.classList.add('open');
    startConfetti();
    triggerHaptic([100, 50, 100]);
  }

  function startConfetti() {
    confettiParticles = [];
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;

    const colors = ['#f43f5e', '#e11d48', '#f59e0b', '#fde047', '#38bdf8', '#4ade80', '#ffffff'];

    for (let i = 0; i < 120; i++) {
      confettiParticles.push({
        x: Math.random() * confettiCanvas.width,
        y: Math.random() * confettiCanvas.height - confettiCanvas.height,
        w: Math.random() * 9 + 4,
        h: Math.random() * 9 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: Math.random() * 4 - 2,
        vy: Math.random() * 4 + 3,
        rot: Math.random() * 360,
        rotSpeed: Math.random() * 8 - 4
      });
    }

    if (confettiAnimId) cancelAnimationFrame(confettiAnimId);
    animateConfetti();
  }

  function animateConfetti() {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

    confettiParticles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.rotSpeed;

      confettiCtx.save();
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate((p.rot * Math.PI) / 180);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confettiCtx.restore();

      if (p.y > confettiCanvas.height) {
        p.y = -10;
        p.x = Math.random() * confettiCanvas.width;
      }
    });

    confettiAnimId = requestAnimationFrame(animateConfetti);
  }

  function stopConfetti() {
    if (confettiAnimId) {
      cancelAnimationFrame(confettiAnimId);
      confettiAnimId = null;
    }
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }

  // ==========================================================================
  // PWA SUPPORT & EVENTS
  // ==========================================================================

  function setupPWA() {
    // Register Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('ServiceWorker registered:', reg.scope);
      }).catch((err) => {
        console.warn('ServiceWorker registration failed:', err);
      });
    }

    // Capture install prompt
    const pwaBanner = document.getElementById('pwaBanner');
    const btnInstallPwa = document.getElementById('btnInstallPwa');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (pwaBanner) pwaBanner.style.display = 'flex';
    });

    if (btnInstallPwa) {
      btnInstallPwa.addEventListener('click', () => {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          deferredInstallPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
              console.log('User accepted PWA installation');
            }
            deferredInstallPrompt = null;
            if (pwaBanner) pwaBanner.style.display = 'none';
          });
        }
      });
    }

    // Check if on iOS Safari to show manual prompt tip
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    if (isIos && !isStandalone && pwaBanner) {
      pwaBanner.style.display = 'flex';
      const bannerText = pwaBanner.querySelector('.pwa-banner-text');
      if (bannerText) {
        bannerText.innerHTML = `<strong>Install on iOS</strong><span>Tap Share 📤 then <em>"Add to Home Screen" ⊞</em></span>`;
      }
      btnInstallPwa.style.display = 'none';
    }
  }

  // ==========================================================================
  // EVENT LISTENERS & HELPERS
  // ==========================================================================

  function setupEventListeners() {
    // Header Buttons
    document.getElementById('btnOpenPlayers').addEventListener('click', openPlayersModal);
    document.getElementById('btnOpenHistory').addEventListener('click', openHistoryModal);
    document.getElementById('btnShareGame').addEventListener('click', shareGame);
    document.getElementById('btnNewGame').addEventListener('click', openNewGameModal);

    // Fast Entry Modal triggers
    document.getElementById('btnFastRoundModal').addEventListener('click', () => openFastEntryModal());
    document.getElementById('btnCloseFastModal').addEventListener('click', closeFastEntryModal);
    document.getElementById('btnFastDone').addEventListener('click', closeFastEntryModal);

    btnPrevRound.addEventListener('click', () => {
      if (fastModalRoundIndex > 0) {
        fastModalRoundIndex--;
        renderFastModalContent();
      }
    });

    btnNextRound.addEventListener('click', () => {
      if (fastModalRoundIndex < TOTAL_ROUNDS - 1) {
        fastModalRoundIndex++;
        renderFastModalContent();
      }
    });

    document.getElementById('btnFastNextStep').addEventListener('click', () => {
      if (fastModalRoundIndex < TOTAL_ROUNDS - 1) {
        fastModalRoundIndex++;
        renderFastModalContent();
      } else {
        closeFastEntryModal();
      }
    });

    // Scoreboard Card Buttons
    document.getElementById('btnScrollToActive').addEventListener('click', scrollToActiveRound);
    document.getElementById('btnClearRound').addEventListener('click', clearCurrentRoundScores);

    // Players Modal
    document.getElementById('btnClosePlayersModal').addEventListener('click', closePlayersModal);
    btnSavePlayers.addEventListener('click', handleSavePlayers);
    btnAddPlayer.addEventListener('click', handleAddPlayer);
    btnResetDefaultPlayers.addEventListener('click', handleResetDefaultPlayers);
    newPlayerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddPlayer();
    });

    // New Game Modal
    document.getElementById('btnCloseNewGameModal').addEventListener('click', closeNewGameModal);
    document.getElementById('btnCancelNewGame').addEventListener('click', closeNewGameModal);
    document.getElementById('btnConfirmNewGame').addEventListener('click', confirmNewGame);

    // History Modal
    document.getElementById('btnCloseHistoryModal').addEventListener('click', closeHistoryModal);
    document.getElementById('btnCloseHistoryFooter').addEventListener('click', closeHistoryModal);
    btnClearAllHistory.addEventListener('click', clearAllHistory);

    // Victory Modal
    document.getElementById('btnCloseVictoryModal').addEventListener('click', () => {
      modalVictory.classList.remove('open');
      stopConfetti();
    });
    document.getElementById('btnVictoryShare').addEventListener('click', () => {
      shareGame();
    });
    document.getElementById('btnVictoryNewGame').addEventListener('click', () => {
      modalVictory.classList.remove('open');
      stopConfetti();
      openNewGameModal();
    });

    // Resize canvas on window resize
    window.addEventListener('resize', () => {
      confettiCanvas.width = window.innerWidth;
      confettiCanvas.height = window.innerHeight;
    });
  }

  function showToast(msg) {
    const toast = document.getElementById('toastNotice');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !msgEl) return;

    msgEl.textContent = msg;
    toast.classList.add('show');

    setTimeout(() => {
      toast.classList.remove('show');
    }, 3200);
  }

  function triggerHaptic(pattern = 15) {
    if ('vibrate' in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch (e) {
        // Ignored
      }
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Start app
  document.addEventListener('DOMContentLoaded', init);

})();
