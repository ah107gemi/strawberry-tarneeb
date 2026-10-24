/**
 * Strawberry Tarneeb Scoreboard
 * Engine with 4-Player Table Roster, Pre-Round Bidding, and Exact Tarneeb Scoring Rules.
 * Rules:
 *   - Exactly 4 active players seated at the table; remaining roster on Bench / Sitting Out.
 *   - Pre-round Bidding Phase: Allowed bids: 0, 2-13 (Bid 1 is strictly prohibited).
 *   - Scoring:
 *       * Bid 0: +5 if made (0 tricks), -5 if failed (>= 1 trick)
 *       * Bid 7: +14 if made (>= 7 tricks), -14 if failed (< 7 tricks)
 *       * General (2-6, 8-13): +Bid if made (tricks >= bid), -Bid if failed (tricks < bid)
 */

(function () {
  'use strict';

  // Constants
  const TOTAL_ROUNDS = 15;
  const ALLOWED_BIDS = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]; // 1 is strictly prohibited!
  const STORAGE_KEY_STATE = 'strawberry_tarneeb_v2_custom_rules';
  const STORAGE_KEY_HISTORY = 'strawberry_tarneeb_v2_history';

  const DEFAULT_ROSTER = [
    { id: 'p_1', name: 'Player 1', active: true },
    { id: 'p_2', name: 'Player 2', active: true },
    { id: 'p_3', name: 'Player 3', active: true },
    { id: 'p_4', name: 'Player 4', active: true }
  ];

  // Application State
  let state = {
    roster: JSON.parse(JSON.stringify(DEFAULT_ROSTER)),
    activePlayerIds: ['p_1', 'p_2', 'p_3', 'p_4'],
    // 15 rounds
    rounds: Array.from({ length: TOTAL_ROUNDS }, () => ({
      bids: {},    // { [playerId]: number | null }
      tricks: {},  // { [playerId]: number | null }
      scores: {},  // { [playerId]: number | null }
      completed: false
    })),
    activeRound: 0, // 0-indexed (Round 1 = 0)
    gameStartedAt: new Date().toISOString()
  };

  let deferredInstallPrompt = null;
  let currentModalRound = 0;

  // DOM Elements
  const podiumContainer = document.getElementById('podiumContainer');
  const benchContainer = document.getElementById('benchContainer');
  const tableHeaderRow = document.getElementById('tableHeaderRow');
  const tableBody = document.getElementById('tableBody');
  const tableFooterRow = document.getElementById('tableFooterRow');
  const tableScrollContainer = document.getElementById('tableScrollContainer');
  const activeRoundLabel = document.getElementById('activeRoundLabel');
  const dealerInfoTag = document.getElementById('dealerInfoTag');
  const roundProgressBar = document.getElementById('roundProgressBar');
  const playerCountTag = document.getElementById('playerCountTag');

  // Modals
  const modalBidding = document.getElementById('modalBidding');
  const modalScoring = document.getElementById('modalScoring');
  const modalPlayers = document.getElementById('modalPlayers');
  const modalNewGame = document.getElementById('modalNewGame');
  const modalHistory = document.getElementById('modalHistory');
  const modalVictory = document.getElementById('modalVictory');

  // Bidding Modal Elements
  const biddingModalRoundTitle = document.getElementById('biddingModalRoundTitle');
  const biddingModalDealer = document.getElementById('biddingModalDealer');
  const biddingPlayerList = document.getElementById('biddingPlayerList');
  const btnSaveBidsAndPlay = document.getElementById('btnSaveBidsAndPlay');
  const btnBiddingDone = document.getElementById('btnBiddingDone');
  const btnCloseBiddingModal = document.getElementById('btnCloseBiddingModal');

  // Scoring Modal Elements
  const scoringModalRoundTitle = document.getElementById('scoringModalRoundTitle');
  const scoringModalRoundNum = document.getElementById('scoringModalRoundNum');
  const scoringModalDealer = document.getElementById('scoringModalDealer');
  const scoringPlayerList = document.getElementById('scoringPlayerList');
  const tricksTotalBadge = document.getElementById('tricksTotalBadge');
  const tricksStatusIcon = document.getElementById('tricksStatusIcon');
  const btnPrevRound = document.getElementById('btnPrevRound');
  const btnNextRound = document.getElementById('btnNextRound');
  const btnBackToBidding = document.getElementById('btnBackToBidding');
  const btnSaveScoring = document.getElementById('btnSaveScoring');
  const btnCloseScoringModal = document.getElementById('btnCloseScoringModal');

  // Roster Modal Elements
  const activeCounterPill = document.getElementById('activeCounterPill');
  const activeCountNum = document.getElementById('activeCountNum');
  const activePlayersList = document.getElementById('activePlayersList');
  const benchPlayersList = document.getElementById('benchPlayersList');
  const newPlayerNameInput = document.getElementById('newPlayerNameInput');
  const btnAddPlayer = document.getElementById('btnAddPlayer');
  const btnResetDefaultPlayers = document.getElementById('btnResetDefaultPlayers');
  const btnSaveRoster = document.getElementById('btnSaveRoster');
  const btnClosePlayersModal = document.getElementById('btnClosePlayersModal');

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
    checkGameCompletion(false);

    // Always default to Scoreboard Mode on initial page load / refresh
    window.switchAppMode('scoreboard');
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_STATE);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.roster && Array.isArray(parsed.roster)) {
          state.roster = parsed.roster;
        }
        if (parsed.activePlayerIds && Array.isArray(parsed.activePlayerIds) && parsed.activePlayerIds.length === 4) {
          state.activePlayerIds = parsed.activePlayerIds.map(id => id === 'p_surum' ? 'p_naas' : id);
        } else {
          ensureFourActivePlayers();
        }
        if (parsed.rounds && Array.isArray(parsed.rounds)) {
          state.rounds = Array.from({ length: TOTAL_ROUNDS }, (_, rIdx) => {
            const r = parsed.rounds[rIdx] || {};
            return {
              bids: r.bids || {},
              tricks: r.tricks || {},
              scores: r.scores || {},
              completed: !!r.completed
            };
          });
        }
        if (typeof parsed.activeRound === 'number') {
          state.activeRound = Math.min(Math.max(0, parsed.activeRound), TOTAL_ROUNDS - 1);
        }
        if (parsed.gameStartedAt) {
          state.gameStartedAt = parsed.gameStartedAt;
        }
      } else {
        ensureFourActivePlayers();
      }
    } catch (e) {
      console.warn('Error reading state from localStorage:', e);
      ensureFourActivePlayers();
    }
  }

  function ensureFourActivePlayers() {
    let actives = state.roster.filter(p => p.active);
    if (actives.length !== 4) {
      // Pick first 4 as active, rest as bench
      state.roster.forEach((p, idx) => {
        p.active = idx < 4;
      });
      actives = state.roster.filter(p => p.active);
    }
    state.activePlayerIds = actives.slice(0, 4).map(p => p.id);
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(state));
    } catch (e) {
      console.warn('Error saving state:', e);
    }
  }

  function getHistory() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_HISTORY);
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
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
  // HELPERS & ACTIVE PLAYERS
  // ==========================================================================

  function getActivePlayers() {
    return state.activePlayerIds
      .map(id => state.roster.find(p => p.id === id))
      .filter(Boolean);
  }

  function getBenchPlayers() {
    return state.roster.filter(p => !state.activePlayerIds.includes(p.id));
  }

  function getPlayerById(id) {
    return state.roster.find(p => p.id === id);
  }

  function getDealerForRound(roundIndex) {
    const actives = getActivePlayers();
    if (actives.length === 0) return 'Dealer';
    const idx = roundIndex % actives.length;
    return actives[idx].name;
  }

  // ==========================================================================
  // EXACT SCORING ENGINE
  // ==========================================================================

  /**
   * Exact Game Rules:
   *  - Round 1 Exception: Skip pre-round bidding entirely; score directly as +1 point per trick taken ("get what you take").
   *  - Rounds 2 to 15:
   *      * Bid 0: +5 points if made (0 tricks), -5 points if failed (>= 1 trick)
   *      * Bid 7: +14 points if made (>= 7 tricks), -14 points if failed (< 7 tricks)
   *      * General Bids (2-6, 8-13): +Bid points if made (tricks >= bid), -Bid points if failed (tricks < bid)
   *      * Note: Bid 1 is strictly prohibited in bidding phase.
   */
  function calculateRoundScore(bid, tricks, roundIndex = null) {
    if (roundIndex === 0) {
      if (tricks === null || tricks === undefined || isNaN(tricks)) {
        return null;
      }
      return Number(tricks); // Get what you take: +1 pt per trick
    }
    if (bid === null || tricks === null || isNaN(bid) || isNaN(tricks)) {
      return null;
    }
    bid = Number(bid);
    tricks = Number(tricks);

    // Bid 0 special rule
    if (bid === 0) {
      return tricks === 0 ? 5 : -5;
    }

    // Bid 7 special rule
    if (bid === 7) {
      return tricks >= 7 ? 14 : -14;
    }

    // General Bids (2-6, 8-13)
    return tricks >= bid ? bid : -bid;
  }

  /**
   * Total Score: Sum of Round 1 through Round 15 for each active player
   * = SUM(Round 1 : Round 15)
   */
  function calculateTotals() {
    const actives = getActivePlayers();
    return actives.map((player) => {
      let sum = 0;
      let playedRounds = 0;
      for (let r = 0; r < TOTAL_ROUNDS; r++) {
        const score = state.rounds[r].scores[player.id];
        if (score !== null && score !== undefined && !isNaN(score)) {
          sum += Number(score);
          playedRounds++;
        }
      }
      return {
        id: player.id,
        name: player.name,
        total: sum,
        playedRounds: playedRounds
      };
    });
  }

  /**
   * Dynamic Live Ranking:
   * Ranked from 1st to 4th based on highest total score descending.
   */
  function calculateRankings() {
    const totals = calculateTotals();
    totals.sort((a, b) => b.total - a.total);

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

  function detectActiveRound() {
    const actives = getActivePlayers();
    for (let r = 0; r < TOTAL_ROUNDS; r++) {
      const isComplete = actives.every(p => state.rounds[r].scores[p.id] !== null && state.rounds[r].scores[p.id] !== undefined);
      if (!isComplete) {
        return r;
      }
    }
    return TOTAL_ROUNDS - 1;
  }

  // ==========================================================================
  // RENDERING
  // ==========================================================================

  function renderAll() {
    state.activeRound = detectActiveRound();
    renderHeaderInfo();
    renderLeaderboard();
    renderScoreboardTable();
  }

  function renderHeaderInfo() {
    const roundNumber = state.activeRound + 1;
    const dealer = getDealerForRound(state.activeRound);
    activeRoundLabel.textContent = `Round ${roundNumber} of ${TOTAL_ROUNDS}`;
    dealerInfoTag.textContent = `• Dealer: ${dealer} 🂠`;

    const actives = getActivePlayers();
    let completedCount = 0;
    for (let r = 0; r < TOTAL_ROUNDS; r++) {
      if (actives.every(p => state.rounds[r].scores[p.id] !== null && state.rounds[r].scores[p.id] !== undefined)) {
        completedCount++;
      }
    }
    const percent = Math.round((completedCount / TOTAL_ROUNDS) * 100);
    roundProgressBar.style.width = `${percent}%`;
    playerCountTag.textContent = `4 Active Seated`;
  }

  /**
   * Render Top Leaderboard Podium (4 Seated Players) + Bench Strip
   * Includes "(The King)" Badge & Title Rule for all players with 18+ points
   */
  function renderLeaderboard() {
    const rankings = calculateRankings();
    if (rankings.length === 0) return;

    const first = rankings[0];

    let podiumHtml = '';
    const rankBadges = ['👑', '🥈', '🥉', '4️⃣'];
    const rankClasses = ['first', 'second', 'third', 'fourth'];
    const rankLabels = ['1st Place', '2nd Place', '3rd Place', '4th Place'];

    rankings.forEach((item, idx) => {
      const isKing = item.total >= 18;
      const diff = item.total - first.total;
      let gapText = '';
      if (idx === 0) {
        const second = rankings[1];
        gapText = second ? (first.total === second.total ? 'Tied' : `+${first.total - second.total} ahead`) : 'Leader';
      } else {
        gapText = diff === 0 ? 'Tied 1st' : `${diff} pts`;
      }

      podiumHtml += `
        <div class="podium-item ${rankClasses[idx]} ${isKing ? 'is-king' : ''}">
          <div class="podium-badge">${rankBadges[idx]}</div>
          <span class="podium-rank-tag">${rankLabels[idx]}</span>
          <div class="podium-name" title="${escapeHtml(item.name)}${isKing ? ' (The King)' : ''}">
            ${escapeHtml(item.name)}${isKing ? '<span class="king-title-badge"> (The King)</span>' : ''}
          </div>
          ${isKing ? '<div class="king-card-badge" title="Scored 18+ Points!">👑 (The King)</div>' : ''}
          <div class="podium-score num ${isKing ? 'king-total' : ''}">${item.total}</div>
          <div class="podium-gap num">${gapText}</div>
        </div>
      `;
    });
    podiumContainer.innerHTML = podiumHtml;

    // Render Bench / Sitting Out Strip
    const bench = getBenchPlayers();
    const totals = calculateTotals();
    if (bench.length > 0) {
      benchContainer.style.display = 'flex';
      benchContainer.innerHTML = `
        <span class="bench-title">🪑 Bench / Sitting Out:</span>
        ${bench.map(p => {
          const pTotal = totals.find(t => t.id === p.id)?.total ?? 0;
          const isKing = pTotal >= 18;
          return `<span class="bench-pill ${isKing ? 'is-king' : ''}">${escapeHtml(p.name)}${isKing ? ' 👑 (The King)' : ''}</span>`;
        }).join('')}
      `;
    } else {
      benchContainer.style.display = 'none';
    }
  }

  /**
   * Render 15-Round Matrix Scoreboard
   */
  function renderScoreboardTable() {
    const actives = getActivePlayers();
    const totals = calculateTotals();

    // 1. Table Header (Sticky)
    let headerHtml = `<th class="col-round">Round</th>`;
    actives.forEach((player) => {
      const playerTotalObj = totals.find(t => t.id === player.id);
      const totalScore = playerTotalObj?.total ?? 0;
      const isKing = totalScore >= 18;
      headerHtml += `
        <th class="${isKing ? 'col-king' : ''}">
          <div class="player-header-wrap">
            <span class="player-header-name">
              ${escapeHtml(player.name)}${isKing ? '<span class="king-header-tag" title="The King (18+ pts)"> (The King)</span>' : ''}
            </span>
            ${isKing ? '<div class="king-sub-badge">👑 (The King)</div>' : ''}
            <span class="player-header-total num ${isKing ? 'king-header-total' : ''}">${totalScore} pts</span>
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
      const roundObj = state.rounds[r];

      bodyHtml += `<tr id="tableRow-${r}" class="${isActive ? 'active-round' : ''}" data-round="${r}">`;
      bodyHtml += `
        <td class="col-round" onclick="window.handleScoreCellClick(${r})">
          <div class="round-info-cell">
            <span class="round-num-label">R${roundNum}</span>
            <span class="dealer-tag" title="Dealer: ${escapeHtml(dealer)}">🂠 ${escapeHtml(dealer)}</span>
          </div>
        </td>
      `;

      actives.forEach((player) => {
        const bid = roundObj.bids[player.id];
        const tricks = roundObj.tricks[player.id];
        const score = roundObj.scores[player.id];

        let cellContent = '';
        if (score !== null && score !== undefined && !isNaN(score)) {
          const isPos = score >= 0;
          cellContent = `
            <div class="table-score-cell">
              <span class="cell-score-num ${isPos ? 'pos' : 'neg'} num">${isPos ? '+' : ''}${score}</span>
              <span class="cell-sub-detail">Bid ${bid ?? '-'} • ${tricks ?? 0}(eat)</span>
            </div>
          `;
        } else if (bid !== null && bid !== undefined && !isNaN(bid)) {
          cellContent = `
            <div class="table-score-cell">
              <span class="cell-bid-only num">Bid: ${bid}</span>
              <span class="cell-sub-detail">In play...</span>
            </div>
          `;
        } else {
          cellContent = `
            <div class="table-score-cell">
              <span class="cell-empty-dash">-</span>
            </div>
          `;
        }

        bodyHtml += `
          <td onclick="window.handleScoreCellClick(${r})">
            ${cellContent}
          </td>
        `;
      });
      bodyHtml += `</tr>`;
    }
    tableBody.innerHTML = bodyHtml;

    // 3. Table Footer (Totals)
    let footerHtml = `<td class="col-round">TOTAL</td>`;
    actives.forEach((player) => {
      const playerTotalObj = totals.find(t => t.id === player.id);
      const totalScore = playerTotalObj?.total ?? 0;
      const isKing = totalScore >= 18;
      footerHtml += `
        <td class="${isKing ? 'col-king' : ''}">
          <span class="footer-total-score num ${isKing ? 'king-total' : ''}">${totalScore}${isKing ? ' 👑' : ''}</span>
        </td>
      `;
    });
    tableFooterRow.innerHTML = footerHtml;
  }

  window.handleScoreCellClick = function (roundIndex) {
    if (roundIndex === 0) {
      openScoringModal(0);
      return;
    }
    const roundObj = state.rounds[roundIndex];
    const actives = getActivePlayers();
    const hasBids = actives.every(p => roundObj.bids[p.id] !== null && roundObj.bids[p.id] !== undefined);

    if (!hasBids) {
      openBiddingModal(roundIndex);
    } else {
      openScoringModal(roundIndex);
    }
  };

  function scrollToActiveRound() {
    const activeRow = document.getElementById(`tableRow-${state.activeRound}`);
    if (activeRow) {
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearCurrentRoundScores() {
    const roundNum = state.activeRound + 1;
    if (confirm(`Clear all bids, tricks, and scores entered for Round ${roundNum}?`)) {
      state.rounds[state.activeRound] = {
        bids: {},
        tricks: {},
        scores: {},
        completed: false
      };
      saveState();
      renderAll();
      showToast(`Round ${roundNum} scores cleared.`);
    }
  }

  // ==========================================================================
  // PRE-ROUND BIDDING PHASE MODAL
  // ==========================================================================

  function openBiddingModal(roundIndex = null) {
    if (roundIndex === null) roundIndex = state.activeRound;
    if (roundIndex === 0) {
      showToast('Round 1 has no bidding! Score tricks directly ⚡');
      openScoringModal(0);
      return;
    }
    currentModalRound = Math.min(Math.max(0, roundIndex), TOTAL_ROUNDS - 1);

    const roundNum = currentModalRound + 1;
    const dealer = getDealerForRound(currentModalRound);

    biddingModalRoundTitle.textContent = `Round ${roundNum} Bidding Phase`;
    biddingModalDealer.textContent = `Dealer: ${dealer}`;

    renderBiddingPlayerList();
    modalBidding.classList.add('open');
  }

  function closeBiddingModal() {
    modalBidding.classList.remove('open');
    renderAll();
  }

  function renderBiddingPlayerList() {
    const actives = getActivePlayers();
    const roundObj = state.rounds[currentModalRound];
    const dealerIdx = currentModalRound % actives.length;

    let html = '';
    actives.forEach((player, idx) => {
      const isDealer = idx === dealerIdx;
      const currentBid = roundObj.bids[player.id];

      html += `
        <div class="bidding-player-card ${isDealer ? 'is-dealer' : ''}" data-player-id="${player.id}">
          <div class="bidding-card-header">
            <span class="bidding-card-name">
              ${escapeHtml(player.name)} ${isDealer ? '🂠 (Dealer)' : ''}
            </span>
            <span class="bidding-current-val num" id="bidLabel-${player.id}">
              ${currentBid !== null && currentBid !== undefined ? `Bid: ${currentBid}` : 'No Bid'}
            </span>
          </div>

          <!-- Allowed Bids Grid: 0, and 2 to 13 (1 is prohibited!) -->
          <div class="bid-buttons-grid">
            ${ALLOWED_BIDS.map(val => {
              const isSelected = currentBid === val;
              const specialClass = val === 0 ? 'bid-0' : val === 7 ? 'bid-7' : '';
              return `
                <button 
                  type="button"
                  class="bid-btn ${specialClass} ${isSelected ? 'active' : ''}" 
                  data-val="${val}" 
                  data-player-id="${player.id}"
                >
                  ${val}
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });
    biddingPlayerList.innerHTML = html;

    // Attach listeners to bid buttons
    const bidButtons = biddingPlayerList.querySelectorAll('.bid-btn');
    bidButtons.forEach((btn) => {
      btn.addEventListener('click', function () {
        triggerHaptic(12);
        const pId = this.dataset.playerId;
        const val = parseInt(this.dataset.val, 10);

        state.rounds[currentModalRound].bids[pId] = val;
        saveState();

        // Update UI active buttons for this player
        const card = biddingPlayerList.querySelector(`.bidding-player-card[data-player-id="${pId}"]`);
        if (card) {
          card.querySelectorAll('.bid-btn').forEach(b => b.classList.remove('active'));
          this.classList.add('active');
          const label = card.querySelector(`#bidLabel-${pId}`);
          if (label) label.textContent = `Bid: ${val}`;
        }
      });
    });
  }

  function handleSaveBidsAndPlay() {
    const actives = getActivePlayers();
    const roundObj = state.rounds[currentModalRound];
    const missing = actives.filter(p => roundObj.bids[p.id] === null || roundObj.bids[p.id] === undefined);

    if (missing.length > 0) {
      if (!confirm(`Some players (${missing.map(m => m.name).join(', ')}) don't have a bid yet. Continue to trick scoring anyway?`)) {
        return;
      }
    }

    saveState();
    closeBiddingModal();
    openScoringModal(currentModalRound);
  }

  // ==========================================================================
  // TRICKS ENTRY & SCORING PHASE MODAL
  // ==========================================================================

  function openScoringModal(roundIndex = null) {
    if (roundIndex === null) roundIndex = state.activeRound;
    currentModalRound = Math.min(Math.max(0, roundIndex), TOTAL_ROUNDS - 1);

    renderScoringModalContent();
    modalScoring.classList.add('open');
  }

  function closeScoringModal() {
    modalScoring.classList.remove('open');
    renderAll();
  }

  function renderScoringModalContent() {
    const roundNum = currentModalRound + 1;
    const dealer = getDealerForRound(currentModalRound);
    const actives = getActivePlayers();
    const roundObj = state.rounds[currentModalRound];

    scoringModalRoundTitle.textContent = `Round ${roundNum} Tricks & Scoring`;
    scoringModalRoundNum.textContent = `Round ${roundNum}`;
    scoringModalDealer.textContent = `Dealer: ${dealer} 🂠`;

    btnPrevRound.disabled = currentModalRound <= 0;
    btnNextRound.disabled = currentModalRound >= TOTAL_ROUNDS - 1;

    let html = '';
    const isRound1 = currentModalRound === 0;
    actives.forEach((player) => {
      const bid = roundObj.bids[player.id];
      const tricks = roundObj.tricks[player.id] ?? 0;
      const score = calculateRoundScore(bid, tricks, currentModalRound);

      html += `
        <div class="scoring-player-card" data-player-id="${player.id}">
          <div class="scoring-player-info">
            <span class="scoring-player-name">${escapeHtml(player.name)}</span>
            <span class="scoring-bid-badge num">
              ${isRound1 ? 'Round 1: +1/trick' : (bid !== null && bid !== undefined ? `Bid: ${bid}` : 'No Bid')}
            </span>
          </div>

          <div class="scoring-player-controls">
            <button class="btn-step" data-action="minus" data-player-id="${player.id}">-</button>
            <input 
              type="number" 
              inputmode="numeric" 
              min="0" 
              max="13" 
              class="tricks-input-box num" 
              data-player-id="${player.id}" 
              value="${tricks}"
            />
            <button class="btn-step" data-action="plus" data-player-id="${player.id}">+</button>
          </div>

          <div class="scoring-live-preview">
            <span class="score-badge-live num ${score !== null && score >= 0 ? 'pos' : 'neg'}" id="liveScore-${player.id}">
              ${score !== null ? (score >= 0 ? `+${score}` : `${score}`) : '-'}
            </span>
            <span style="font-size: 0.65rem; color: var(--text-dim);">Points</span>
          </div>
        </div>
      `;
    });
    scoringPlayerList.innerHTML = html;

    updateTricksSumBadge();

    // Attach step & input listeners
    const inputs = scoringPlayerList.querySelectorAll('.tricks-input-box');
    inputs.forEach((input) => {
      input.addEventListener('focus', function () { this.select(); });
      input.addEventListener('input', function () {
        const pId = this.dataset.playerId;
        let val = parseInt(this.value, 10);
        if (isNaN(val) || val < 0) val = 0;
        if (val > 13) val = 13;
        this.value = val;

        state.rounds[currentModalRound].tricks[pId] = val;
        recalculateAndSaveModalScores();
      });
    });

    const stepBtns = scoringPlayerList.querySelectorAll('.btn-step');
    stepBtns.forEach((btn) => {
      btn.addEventListener('click', function () {
        triggerHaptic(12);
        const pId = this.dataset.playerId;
        const action = this.dataset.action;
        let current = state.rounds[currentModalRound].tricks[pId] ?? 0;

        if (action === 'plus' && current < 13) current++;
        if (action === 'minus' && current > 0) current--;

        state.rounds[currentModalRound].tricks[pId] = current;
        const inp = scoringPlayerList.querySelector(`.tricks-input-box[data-player-id="${pId}"]`);
        if (inp) inp.value = current;

        recalculateAndSaveModalScores();
      });
    });
  }

  function recalculateAndSaveModalScores() {
    const actives = getActivePlayers();
    const roundObj = state.rounds[currentModalRound];

    actives.forEach((player) => {
      const bid = roundObj.bids[player.id];
      const tricks = roundObj.tricks[player.id] ?? 0;
      const score = calculateRoundScore(bid, tricks, currentModalRound);

      roundObj.scores[player.id] = score;

      const badge = scoringPlayerList.querySelector(`#liveScore-${player.id}`);
      if (badge) {
        if (score !== null) {
          badge.textContent = score >= 0 ? `+${score}` : `${score}`;
          badge.className = `score-badge-live num ${score >= 0 ? 'pos' : 'neg'}`;
        } else {
          badge.textContent = '-';
          badge.className = 'score-badge-live num';
        }
      }
    });

    roundObj.completed = true;
    saveState();
    updateTricksSumBadge();
  }

  function updateTricksSumBadge() {
    const actives = getActivePlayers();
    const roundObj = state.rounds[currentModalRound];
    let sum = 0;
    actives.forEach(p => {
      sum += (roundObj.tricks[p.id] ?? 0);
    });

    tricksTotalBadge.textContent = `${sum} / 13`;
    if (sum === 13) {
      tricksTotalBadge.className = 'tricks-badge num valid';
      tricksStatusIcon.textContent = '✓';
    } else {
      tricksTotalBadge.className = 'tricks-badge num';
      tricksStatusIcon.textContent = sum < 13 ? '⚠️' : '❌';
    }
  }

  function handleSaveScoringAndNext() {
    recalculateAndSaveModalScores();
    saveState();

    if (currentModalRound < TOTAL_ROUNDS - 1) {
      currentModalRound++;
      closeScoringModal();
      openBiddingModal(currentModalRound);
    } else {
      closeScoringModal();
      checkGameCompletion(true);
    }
  }

  // ==========================================================================
  // TABLE ROSTER & 4-PLAYER MANAGEMENT
  // ==========================================================================

  function openPlayersModal() {
    renderRosterManageLists();
    modalPlayers.classList.add('open');
  }

  function closePlayersModal() {
    modalPlayers.classList.remove('open');
  }

  function renderRosterManageLists() {
    const activeCount = state.activePlayerIds.length;
    activeCountNum.textContent = activeCount;
    if (activeCount === 4) {
      activeCounterPill.className = 'active-counter-pill valid';
      activeCounterPill.innerHTML = `✓ Seated Table: <strong>4 / 4 Players</strong>`;
    } else {
      activeCounterPill.className = 'active-counter-pill';
      activeCounterPill.innerHTML = `⚠️ Select <strong>exactly 4</strong> players (${activeCount} currently active)`;
    }

    // 1. Seated Active Table List
    const actives = getActivePlayers();
    let activeHtml = '';
    actives.forEach((player, idx) => {
      activeHtml += `
        <div class="player-manage-row is-active-seated" data-player-id="${player.id}">
          <span style="font-weight: 800; color: #34d399; font-size: 0.85rem; width: 24px;">#${idx + 1}</span>
          <input type="text" class="player-name-input" value="${escapeHtml(player.name)}" data-player-id="${player.id}" maxlength="16" />
          <button class="btn-toggle-seat to-bench" data-action="bench" data-player-id="${player.id}" title="Move to Bench">
            🪑 Bench
          </button>
        </div>
      `;
    });
    activePlayersList.innerHTML = activeHtml || '<p style="color: var(--text-dim); font-size: 0.8rem; padding: 6px;">No players seated.</p>';

    // 2. Bench List
    const bench = getBenchPlayers();
    let benchHtml = '';
    bench.forEach((player) => {
      benchHtml += `
        <div class="player-manage-row is-bench" data-player-id="${player.id}">
          <span style="font-size: 0.85rem; color: var(--text-dim); width: 24px;">🪑</span>
          <input type="text" class="player-name-input" value="${escapeHtml(player.name)}" data-player-id="${player.id}" maxlength="16" />
          <button class="btn-toggle-seat to-table" data-action="seat" data-player-id="${player.id}" title="Seat at Table">
            🂠 Seat at Table
          </button>
          ${state.roster.length > 4 ? `
            <button class="btn-del-player" data-player-id="${player.id}" title="Remove from Roster">&times;</button>
          ` : ''}
        </div>
      `;
    });
    benchPlayersList.innerHTML = benchHtml || '<p style="color: var(--text-dim); font-size: 0.8rem; padding: 6px;">No players on bench (All 4 are seated).</p>';

    attachRosterActionListeners();
  }

  function attachRosterActionListeners() {
    // Bench / Seat Toggles
    const toggleBtns = modalPlayers.querySelectorAll('.btn-toggle-seat');
    toggleBtns.forEach((btn) => {
      btn.addEventListener('click', function () {
        triggerHaptic(15);
        const pId = this.dataset.playerId;
        const action = this.dataset.action;

        if (action === 'bench') {
          // Remove from active
          state.activePlayerIds = state.activePlayerIds.filter(id => id !== pId);
          const p = getPlayerById(pId);
          if (p) p.active = false;
        } else if (action === 'seat') {
          if (state.activePlayerIds.length >= 4) {
            alert('The table already has 4 active players. Please bench one player first before seating another!');
            return;
          }
          state.activePlayerIds.push(pId);
          const p = getPlayerById(pId);
          if (p) p.active = true;
        }
        renderRosterManageLists();
      });
    });

    // Name edits
    const nameInputs = modalPlayers.querySelectorAll('.player-name-input');
    nameInputs.forEach((inp) => {
      inp.addEventListener('input', function () {
        const pId = this.dataset.playerId;
        const p = getPlayerById(pId);
        if (p) p.name = this.value.trim() || 'Player';
      });
    });

    // Delete player from roster
    const delBtns = modalPlayers.querySelectorAll('.btn-del-player');
    delBtns.forEach((btn) => {
      btn.addEventListener('click', function () {
        const pId = this.dataset.playerId;
        const p = getPlayerById(pId);
        if (confirm(`Remove "${p ? p.name : 'player'}" completely from the group roster?`)) {
          state.roster = state.roster.filter(item => item.id !== pId);
          state.activePlayerIds = state.activePlayerIds.filter(id => id !== pId);
          renderRosterManageLists();
        }
      });
    });
  }

  function handleAddPlayerToRoster() {
    const name = newPlayerNameInput.value.trim();
    if (!name) return;
    const newId = 'p_' + Date.now();
    const shouldBeActive = state.activePlayerIds.length < 4;

    state.roster.push({
      id: newId,
      name: name,
      active: shouldBeActive
    });
    if (shouldBeActive) {
      state.activePlayerIds.push(newId);
    }
    newPlayerNameInput.value = '';
    renderRosterManageLists();
  }

  function handleSaveRoster() {
    if (state.activePlayerIds.length !== 4) {
      alert(`A Tarneeb table requires EXACTLY 4 active players. You currently have ${state.activePlayerIds.length} selected. Please seat 4 players!`);
      return;
    }

    saveState();
    closePlayersModal();
    renderAll();
    showToast('Table roster updated! 4 active players seated.');
  }

  function handleResetDefaultRoster() {
    if (confirm('Reset to default table (Player 1, Player 2, Player 3, Player 4)?')) {
      state.roster = JSON.parse(JSON.stringify(DEFAULT_ROSTER));
      state.activePlayerIds = ['p_1', 'p_2', 'p_3', 'p_4'];
      saveState();
      renderRosterManageLists();
      renderAll();
      showToast('Reset to default 4-player table.');
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

    const hasAnyScore = state.rounds.some(r => Object.keys(r.scores).length > 0);
    if (!hasAnyScore) return;

    const history = getHistory();
    const matchRecord = {
      id: 'match_' + Date.now(),
      date: new Date().toLocaleString(),
      activePlayers: getActivePlayers().map(p => p.name),
      benchPlayers: getBenchPlayers().map(p => p.name),
      totals: calculateTotals(),
      rankings: rankings,
      winner: rankings[0].name,
      winnerScore: rankings[0].total,
      rounds: JSON.parse(JSON.stringify(state.rounds))
    };

    history.unshift(matchRecord);
    saveHistory(history);
  }

  function renderHistoryList() {
    const history = getHistory();
    if (history.length === 0) {
      historyListContainer.innerHTML = `
        <div class="history-empty">
          <p style="font-size: 2rem; margin-bottom: 8px;">📭</p>
          <p>No archived matches yet.</p>
          <span style="font-size: 0.75rem;">Completed 4-player matches will be recorded here with final standings and bench players.</span>
        </div>
      `;
      return;
    }

    let html = '';
    history.forEach((m) => {
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
          ${m.benchPlayers && m.benchPlayers.length > 0 ? `
            <div style="font-size: 0.72rem; color: var(--text-dim);">
              Bench: ${m.benchPlayers.map(escapeHtml).join(', ')}
            </div>
          ` : ''}
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
    if (confirm('Are you sure you want to delete ALL archived match history?')) {
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
    const keepActive = document.getElementById('chkKeepActivePlayers').checked;

    if (shouldArchive) {
      archiveCurrentMatch();
    }

    if (!keepActive) {
      state.roster = JSON.parse(JSON.stringify(DEFAULT_ROSTER));
      state.activePlayerIds = ['p_ahmed', 'p_hosam', 'p_shiba', 'p_furjani'];
    }

    // Reset rounds
    state.rounds = Array.from({ length: TOTAL_ROUNDS }, () => ({
      bids: {},
      tricks: {},
      scores: {},
      completed: false
    }));
    state.activeRound = 0;
    state.gameStartedAt = new Date().toISOString();

    saveState();
    closeNewGameModal();
    renderAll();
    showToast('New Tarneeb match started! Good luck! 🍓');
  }

  // ==========================================================================
  // WHATSAPP / CHAT SHARING
  // ==========================================================================

  function shareGame() {
    const rankings = calculateRankings();
    if (rankings.length === 0) return;

    let text = `🍓 *Strawberry Tarneeb Scoreboard* 🍓\n`;
    text += `📅 ${new Date().toLocaleDateString()}\n`;
    text += `━━━━━━━━━━━━━━━━━━━━\n`;

    rankings.forEach((r, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4️⃣';
      text += `${medal} *${r.name}*: ${r.total} pts\n`;
    });

    const bench = getBenchPlayers();
    if (bench.length > 0) {
      text += `━━━━━━━━━━━━━━━━━━━━\n`;
      text += `🪑 Bench / Sitting Out: ${bench.map(p => p.name).join(', ')}\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━━━\n`;
    text += `Round ${state.activeRound + 1} of 15 (Tarneeb 4-Player Rules)\n`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Standings copied to clipboard! Ready to paste into WhatsApp 📋');
      }).catch(() => {
        window.prompt('Copy game standings:', text);
      });
    } else {
      window.prompt('Copy game standings:', text);
    }
  }

  // ==========================================================================
  // VICTORY & CONFETTI
  // ==========================================================================

  let celebrationTriggeredForCurrent = false;

  function checkGameCompletion(triggerCelebration = true) {
    const actives = getActivePlayers();
    const allFilled = state.rounds.every(r => actives.every(p => r.scores[p.id] !== null && r.scores[p.id] !== undefined));

    if (allFilled && triggerCelebration && !celebrationTriggeredForCurrent) {
      celebrationTriggeredForCurrent = true;
      showVictoryModal();
    }
  }

  function showVictoryModal() {
    const rankings = calculateRankings();
    if (rankings.length === 0) return;

    const winner = rankings[0];
    const winnerIsKing = winner.total >= 18;
    document.getElementById('victoryWinnerName').textContent = `${winner.name}${winnerIsKing ? ' (The King)' : ''}`;
    document.getElementById('victoryScore').textContent = `Total Score: ${winner.total} pts`;

    let podiumListHtml = '';
    rankings.forEach((r, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : '4️⃣';
      const isKing = r.total >= 18;
      podiumListHtml += `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; background: #0f172a; border-radius: 8px; font-weight: 700; font-size: 0.9rem; ${isKing ? 'border: 1px solid #facc15;' : ''}">
          <span>${medal} ${escapeHtml(r.name)}${isKing ? ' <span style="color: #facc15; font-size: 0.78rem; font-weight: 800;">👑 (The King)</span>' : ''}</span>
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
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('SW registration:', err);
      });
    }

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
          deferredInstallPrompt.userChoice.then(() => {
            deferredInstallPrompt = null;
            if (pwaBanner) pwaBanner.style.display = 'none';
          });
        }
      });
    }

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
  // MODE SWITCHER (Scoreboard vs Online Game)
  // ==========================================================================

  window.switchAppMode = function (mode) {
    localStorage.setItem('tarneeb_app_mode', mode);
    const btnScoreboard = document.getElementById('navModeScoreboard');
    const btnOnline = document.getElementById('navModeOnline');
    const viewScoreboard = document.getElementById('viewScoreboard');
    const viewOnline = document.getElementById('viewOnlineGame');

    if (mode === 'online') {
      btnOnline?.classList.add('active');
      btnScoreboard?.classList.remove('active');
      if (viewScoreboard) {
        viewScoreboard.style.display = 'none';
        viewScoreboard.classList.add('hidden-mode');
      }
      if (viewOnline) {
        viewOnline.style.display = 'flex';
        viewOnline.classList.remove('hidden-mode');
      }
      if (typeof initOnlineGame === 'function') {
        initOnlineGame();
      }
    } else {
      btnScoreboard?.classList.add('active');
      btnOnline?.classList.remove('active');
      if (viewScoreboard) {
        viewScoreboard.style.display = 'flex';
        viewScoreboard.classList.remove('hidden-mode');
      }
      if (viewOnline) {
        viewOnline.style.display = 'none';
        viewOnline.classList.add('hidden-mode');
      }
      document.getElementById('identityModal')?.classList.remove('open');
      renderAll();
    }
  };

  // ==========================================================================
  // EVENT LISTENERS & HELPERS
  // ==========================================================================

  function setupEventListeners() {
    // Mode Switcher Navigation
    document.getElementById('navModeScoreboard')?.addEventListener('click', () => window.switchAppMode('scoreboard'));
    document.getElementById('navModeOnline')?.addEventListener('click', () => window.switchAppMode('online'));

    // Header Buttons
    document.getElementById('btnOpenPlayers').addEventListener('click', openPlayersModal);
    document.getElementById('btnOpenHistory').addEventListener('click', openHistoryModal);
    document.getElementById('btnShareGame').addEventListener('click', shareGame);
    document.getElementById('btnNewGame').addEventListener('click', openNewGameModal);

    // Status strip triggers
    document.getElementById('btnTriggerBidding').addEventListener('click', () => {
      if (state.activeRound === 0) {
        showToast('Round 1 has no bidding! Score tricks directly ⚡');
        openScoringModal(0);
      } else {
        openBiddingModal();
      }
    });
    document.getElementById('btnTriggerScoring').addEventListener('click', () => openScoringModal());

    // Scoreboard Table controls
    document.getElementById('btnScrollToActive').addEventListener('click', scrollToActiveRound);
    document.getElementById('btnClearRound').addEventListener('click', clearCurrentRoundScores);

    // Bidding Modal
    btnCloseBiddingModal.addEventListener('click', closeBiddingModal);
    btnBiddingDone.addEventListener('click', closeBiddingModal);
    btnSaveBidsAndPlay.addEventListener('click', handleSaveBidsAndPlay);

    // Scoring Modal
    btnCloseScoringModal.addEventListener('click', closeScoringModal);
    btnBackToBidding.addEventListener('click', () => {
      if (currentModalRound === 0) {
        showToast('Round 1 has no bidding!');
        return;
      }
      closeScoringModal();
      openBiddingModal(currentModalRound);
    });
    btnSaveScoring.addEventListener('click', handleSaveScoringAndNext);

    btnPrevRound.addEventListener('click', () => {
      if (currentModalRound > 0) {
        currentModalRound--;
        renderScoringModalContent();
      }
    });

    btnNextRound.addEventListener('click', () => {
      if (currentModalRound < TOTAL_ROUNDS - 1) {
        currentModalRound++;
        renderScoringModalContent();
      }
    });

    // Roster Modal
    btnClosePlayersModal.addEventListener('click', closePlayersModal);
    btnSaveRoster.addEventListener('click', handleSaveRoster);
    btnAddPlayer.addEventListener('click', handleAddPlayerToRoster);
    btnResetDefaultPlayers.addEventListener('click', handleResetDefaultRoster);
    newPlayerNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAddPlayerToRoster();
    });

    // New Game Modal
    document.getElementById('btnCloseNewGameModal').addEventListener('click', closeNewGameModal);
    document.getElementById('btnCancelNewGame').addEventListener('click', closeNewGameModal);
    document.getElementById('btnConfirmNewGame').addEventListener('click', confirmNewGame);

    // History Modal
    document.getElementById('btnCloseHistoryModal').addEventListener('click', closeHistoryModal);
    document.getElementById('btnCloseHistoryFooter').addEventListener('click', closeHistoryModal);
    document.getElementById('btnClearAllHistory').addEventListener('click', clearAllHistory);

    // Victory Modal
    document.getElementById('btnCloseVictoryModal').addEventListener('click', () => {
      modalVictory.classList.remove('open');
      stopConfetti();
    });
    document.getElementById('btnVictoryShare').addEventListener('click', shareGame);
    document.getElementById('btnVictoryNewGame').addEventListener('click', () => {
      modalVictory.classList.remove('open');
      stopConfetti();
      openNewGameModal();
    });

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
      try { navigator.vibrate(pattern); } catch (e) {}
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

  document.addEventListener('DOMContentLoaded', init);
})();
