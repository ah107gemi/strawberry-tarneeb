/**
 * Strawberry Tarneeb Online Card Game Client
 * Mode 2: Real-Time Multiplayer via WebSocket
 *
 * Card representation: rank+suit string e.g. "AH", "10S", "7D", "KC"
 * Suits: H=Hearts(trump), S=Spades, D=Diamonds, C=Clubs
 * Ranks: 2,3,4,5,6,7,8,9,10,J,Q,K,A
 */

class TarneebOnlineGame {
  constructor() {
    this.ws = null;
    this.myId = null;
    this.myName = null;
    this.gameState = null;
    this.myHand = [];
    this.sortMode = localStorage.getItem('tarneeb_sort_mode') || 'auto';
    this.dragSrc = null;
    this.selectedCard = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;

    // Suit order for sorting: Hearts (trump) first
    this.suitOrder = { H: 0, S: 1, D: 2, C: 3 };
    this.rankOrder = { '2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'10':10,'J':11,'Q':12,'K':13,'A':14 };
    this.suitSymbols = { H: '♥', S: '♠', D: '♦', C: '♣' };
    this.suitColors = { H: '#FF3B5C', S: '#FFFFFF', D: '#FF3B5C', C: '#FFFFFF' };
    this.suitNames = { H: 'Hearts', S: 'Spades', D: 'Diamonds', C: 'Clubs' };
    this.isSubmittingPlay = false;
    this.heartbeatTimer = null;
    this._lastHandHash = null;
    this._lastTrickHash = null;
    this._lastScoreHash = null;
    this._lastOppHash = null;
    this._forceTrickRerender = false;
    this._lastSortPromptedRound = 0;
    this.matchHistory = [];
  }

  // =========================================================================
  // HEARTBEAT
  // =========================================================================
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send('ping');
      }
    }, 15000);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // =========================================================================
  // CONNECTION
  // =========================================================================
  connect(playerToken) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) && this.myId === playerToken) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.sendJoinMessage();
      }
      return;
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = location.host;
    const wsUrl = `${protocol}//${host}/ws/${playerToken}`;

    this.ws = new WebSocket(wsUrl);
    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.showStatus('🟢 Connected to game server');
      this.startHeartbeat();
      this.sendJoinMessage();
      this.flushPendingMessages();
    };
    this.ws.onmessage = (evt) => this.handleServerMessage(JSON.parse(evt.data));
    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.showStatus('🔴 Disconnected. Reconnecting…');
      this.scheduleReconnect(playerToken);
    };
    this.ws.onerror = (e) => {
      this.showStatus('❌ Connection error');
      console.error('WebSocket error:', e);
    };
  }

  scheduleReconnect(token) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.showStatus('❌ Cannot reconnect. Please refresh the page.');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000);
    this.reconnectAttempts++;
    setTimeout(() => this.connect(token), delay);
  }

  send(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pendingMessages = this.pendingMessages || [];
      this.pendingMessages.push(msg);
    }
  }

  flushPendingMessages() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.pendingMessages) {
      while (this.pendingMessages.length > 0) {
        const msg = this.pendingMessages.shift();
        this.ws.send(msg);
      }
    }
  }

  sendJoinMessage() {
    if (!this.myName) return;
    const isSpec = (this.myRole === 'spectator');
    const roleToSend = isSpec ? 'spectator' : 'player';
    this.send('JOIN', {
      name: this.myName,
      roster_pick: this.myName,
      role: roleToSend,
      is_spectator: isSpec,
      as_spectator: isSpec
    });
  }

  // =========================================================================
  // SERVER MESSAGE HANDLER
  // =========================================================================
  handleServerMessage(msg) {
    const data = msg.data || msg;
    switch (msg.type) {
      case 'game_state':
        this.gameState = data;
        this.myHand = data.my_hand || this.myHand;
        if (data.history && Array.isArray(data.history)) {
          this.matchHistory = data.history;
        }
        this.isSubmittingPlay = false;

        // Auto-Sort Prompt: Prompt human player immediately after cards are distributed in a new round
        if (data.my_hand && data.my_hand.length === 13 && data.round > 0 && this._lastSortPromptedRound !== data.round) {
          const me = data.players?.find(p => p.id === this.myId);
          if (me && !me.is_spectator && me.role === 'player') {
            this._lastSortPromptedRound = data.round;
            this.showAutoSortPrompt(data.round);
          }
        }

        this.renderGame();
        break;

      case 'pong':
        break;

      case 'prompt_select_dealer':
        this.showDealerSelectModal(data);
        break;

      case 'dealer_updated':
        this.showToast(`🂠 Dealer set to ${data.dealer_name}`, 'info');
        break;

      case 'player_joined':
        if (data.is_bot) {
          this.showToast(`🤖 ${data.name} joined the table!`, 'info');
        } else {
          this.showToast(`${data.name} joined as ${data.role === 'spectator' ? 'Spectator 👁️' : 'Player 🂠'}`);
        }
        break;

      case 'bots_removed':
        this.showToast('🤖 Bots removed from table', 'info');
        break;

      case 'player_left_replaced_by_bot':
        this.showToast(`🤖 ${data.message || (data.leaving_player_name + ' replaced by ' + data.bot_name)}`, 'info');
        if (data.leaving_player_id !== this.myId) {
          this.showPlayerLeftNotice(data);
        }
        break;

      case 'role_changed':
        this.myRole = data.role;
        sessionStorage.setItem('tarneeb_session_role', data.role);
        this.showToast(data.message || `Switched to ${data.role}`, 'info');
        break;

      case 'trick_complete':
        this.showTrickResult(data);
        break;

      case 'round_complete':
        if (data && !this.matchHistory.some(h => h.round === data.round)) {
          this.matchHistory.push(data);
        }
        this.showRoundSummary(data);
        break;

      case 'game_complete':
        this.showGameVictory(data);
        break;

      case 'smirk_trigger':
        this.showSmirkAnimation(data.player_id, data.player_name);
        break;

      case 'prompt_smirk':
        this.showSmirkPrompt();
        break;

      case 'error':
        const errMsg = data.message || msg.message || 'Error occurred';
        this.showToast(`❌ ${errMsg}`, 'error');
        if (data.code === 'TABLE_FULL') {
          setTimeout(() => {
            alert(errMsg);
          }, 250);
        }
        break;
    }
  }

  // =========================================================================
  // CARD HELPERS
  // =========================================================================
  parseCard(cardStr) {
    // e.g. "10H" -> {rank: "10", suit: "H"}   "AH" -> {rank: "A", suit: "H"}
    const suit = cardStr.slice(-1);
    const rank = cardStr.slice(0, -1);
    return { rank, suit, str: cardStr };
  }

  cardSortKey(cardStr) {
    const { rank, suit } = this.parseCard(cardStr);
    return this.suitOrder[suit] * 100 + this.rankOrder[rank];
  }

  getSortedHand() {
    return [...this.myHand].sort((a, b) => this.cardSortKey(a) - this.cardSortKey(b));
  }

  // =========================================================================
  // RENDER MAIN GAME TABLE
  // =========================================================================
  renderGame() {
    if (!this.gameState) return;
    const gs = this.gameState;

    // Phase routing
    const phaseLabel = this.getPhaseLabel(gs);
    const phaseEl = document.getElementById('onlinePhaseInfo');
    if (phaseEl && phaseEl.textContent !== phaseLabel) phaseEl.textContent = phaseLabel;

    // Render dealer + round info
    const dealer = gs.players.find(p => p.id === gs.dealer);
    const roundText = `Round ${gs.round} of 15`;
    const dealerText = `🂠 Dealer: ${dealer ? dealer.name : '-'}`;
    const roundEl = document.getElementById('onlineRoundBadge');
    if (roundEl && roundEl.textContent !== roundText) roundEl.textContent = roundText;
    const dealerEl = document.getElementById('onlineDealerBadge');
    if (dealerEl && dealerEl.textContent !== dealerText) dealerEl.textContent = dealerText;

    // Dealer selection phase popup handling
    if (gs.phase === 'dealer_select') {
      this.showDealerSelectModal();
    } else {
      this.hideDealerSelectModal();
    }

    // Render user role tag
    const me = gs.players.find(p => p.id === this.myId);
    let isSpectator = false;
    if (me) {
      isSpectator = (me.role === 'spectator' || me.is_spectator === true);
      this.myRole = isSpectator ? 'spectator' : 'player';
      sessionStorage.setItem('tarneeb_session_role', this.myRole);
    } else {
      isSpectator = (this.myRole === 'spectator');
    }

    const roleBadge = document.getElementById('onlineUserRoleBadge');
    if (roleBadge) {
      roleBadge.style.display = 'inline-block';
      if (isSpectator) {
        roleBadge.className = 'online-pill-badge role-pill spectator';
        roleBadge.textContent = `👀 Spectating: ${this.myName || me?.name || 'Spectator'}`;
      } else {
        roleBadge.className = 'online-pill-badge role-pill';
        const seatStr = (me && me.seat !== null && me.seat !== undefined) ? ` (Seat ${me.seat + 1})` : '';
        roleBadge.textContent = `🎮 Player: ${this.myName || me?.name || 'Player'}${seatStr}`;
      }
    }

    // Role Switch Button in header ("🔄 Change Role")
    const switchRoleBtn = document.getElementById('btnSwitchIdentity');
    if (switchRoleBtn) {
      if (isSpectator) {
        switchRoleBtn.innerHTML = '🎮 Take Table Seat';
        switchRoleBtn.title = 'Switch from Spectator to Active Table Seat';
      } else {
        switchRoleBtn.innerHTML = '👀 Move to Bench';
        switchRoleBtn.title = 'Switch from Active Player to Bench Spectator';
      }
    }

    // Leave Game Button ("🚪 Leave Game") - visible only to active seated players
    const leaveGameBtn = document.getElementById('btnLeaveActiveGame');
    if (leaveGameBtn) {
      const isSeatedPlayer = !isSpectator && me && me.seat !== null && me.seat !== undefined;
      leaveGameBtn.style.display = isSeatedPlayer ? 'flex' : 'none';
    }

    // Render live scores sidebar
    this.renderScoreSidebar(gs);

    // Render trick area (center table)
    this.renderTrickArea(gs);

    // Render opponents (top, left, right)
    this.renderOpponents(gs);

    // Render my hand (bottom)
    this.renderMyHand(gs);

    // Show/hide bidding UI
    this.renderBiddingPanel(gs);

    // Turn status update in permanent subtle dock bar (no abrupt popping banners)
    const myTurn = !isSpectator && gs.current_turn === this.myId;
    const turnBar = document.getElementById('turnStatusBar');
    const turnText = document.getElementById('turnStatusText');
    if (turnBar && turnText) {
      if (isSpectator) {
        turnBar.className = 'hand-turn-status-bar not-my-turn';
        const curPlayer = gs.players.find(p => p.id === gs.current_turn);
        turnText.innerHTML = `👀 Spectating • Active player turn: <strong>${this.esc(curPlayer ? curPlayer.name : '—')}</strong>`;
      } else if (gs.phase === 'bidding') {
        const isMyBid = gs.bidding_idx < (gs.bid_order?.length || 0) && gs.bid_order[gs.bidding_idx] === this.myId;
        const bidderName = gs.players.find(p => p.id === (gs.bid_order?.[gs.bidding_idx]))?.name || 'Player';
        if (isMyBid) {
          turnBar.className = 'hand-turn-status-bar is-my-turn';
          turnText.innerHTML = '🎯 <strong>YOUR TURN TO BID</strong> • Select your target tricks (0, 2–13)';
        } else {
          turnBar.className = 'hand-turn-status-bar not-my-turn';
          turnText.innerHTML = `⏳ Bidding Phase • Waiting for <strong>${this.esc(bidderName)}</strong> to bid…`;
        }
      } else if (gs.phase === 'playing') {
        const curPlayer = gs.players.find(p => p.id === gs.current_turn);
        const curName = curPlayer ? curPlayer.name : 'Player';
        if (myTurn) {
          turnBar.className = 'hand-turn-status-bar is-my-turn';
          const isLead = !gs.trick_cards || gs.trick_cards.length === 0;
          turnText.innerHTML = isLead
            ? '🔥 <strong>YOUR TURN TO LEAD</strong> • Play any card to start trick'
            : '🔥 <strong>YOUR TURN TO PLAY</strong> • Tap card to play';
        } else {
          turnBar.className = 'hand-turn-status-bar not-my-turn';
          turnText.innerHTML = `⏳ Current Turn: <strong>${this.esc(curName)}</strong> is playing…`;
        }
      } else if (gs.phase === 'dealer_select') {
        turnBar.className = 'hand-turn-status-bar not-my-turn';
        turnText.innerHTML = '🂠 Selecting dealer for Round 1…';
      } else if (gs.phase === 'round_end') {
        turnBar.className = 'hand-turn-status-bar not-my-turn';
        turnText.innerHTML = `📊 Round ${gs.round} Complete • Next round starting shortly…`;
      } else {
        turnBar.className = 'hand-turn-status-bar not-my-turn';
        turnText.innerHTML = '⏳ Waiting for round to start…';
      }
    }

    // Highlight playable cards
    if (myTurn && gs.phase === 'playing') {
      this.highlightPlayableCards(gs);
    }
  }

  getPhaseLabel(gs) {
    switch (gs.phase) {
      case 'lobby': return '⏳ Waiting for players to join…';
      case 'dealer_select': return '🂠 Selecting Round 1 Dealer…';
      case 'bidding': return `🎯 Bidding Phase — Round ${gs.round}`;
      case 'playing': return `🃏 Playing — Trick ${gs.current_trick || 1} of 13`;
      case 'round_end': return `📊 Round ${gs.round} Complete`;
      case 'game_end': return '🏆 Game Over!';
      default: return '';
    }
  }

  renderScoreSidebar(gs) {
    const container = document.getElementById('onlineScoreboard');
    if (!container) return;
    const players = [...gs.players].filter(p => p.role === 'player');
    const scoreHash = players.map(p => `${p.id}:${gs.scores[p.id]}:${gs.bids[p.id]}:${gs.tricks_taken[p.id]}:${p.id===gs.current_turn}`).join(';') + '|' + gs.phase;
    if (this._lastScoreHash === scoreHash) return;
    this._lastScoreHash = scoreHash;

    players.sort((a, b) => (gs.scores[b.id] || 0) - (gs.scores[a.id] || 0));

    let html = '<div class="score-sidebar-title">📊 Live Scores</div>';
    players.forEach((p, idx) => {
      const score = gs.scores[p.id] || 0;
      const bid = gs.bids[p.id];
      const tricks = gs.tricks_taken[p.id] || 0;
      const isComplete = (bid !== undefined && bid !== null && Number(bid) > 0 && tricks >= Number(bid));
      const isMe = p.id === this.myId;
      const isCurrent = p.id === gs.current_turn;
      const medals = ['🥇','🥈','🥉','4️⃣'];

      html += `
        <div class="score-row ${isMe ? 'is-me' : ''} ${isCurrent ? 'is-turn' : ''}">
          <span class="score-medal">${medals[idx] || '🎖️'}</span>
          <span class="score-name">${this.esc(p.name)}${isMe ? ' (You)' : ''}${isComplete ? ' <span class="bid-complete-check" title="Bid Completed!">✅</span>' : ''}</span>
          <div class="score-details">
            ${bid !== undefined && bid !== null ? `<span class="bid-chip">Bid ${bid}</span>` : ''}
            ${gs.phase === 'playing' ? `<span class="tricks-chip">${tricks}(eat)</span>` : ''}
            <span class="score-num">${score >= 0 ? '+' : ''}${score}</span>
          </div>
        </div>
      `;
    });

    // Spectators
    const specs = gs.players.filter(p => p.role === 'spectator');
    if (specs.length > 0) {
      html += `<div class="spectator-row">👁️ Spectators: ${specs.map(s => this.esc(s.name)).join(', ')}</div>`;
    }

    container.innerHTML = html;
  }

  renderTrickArea(gs) {
    const area = document.getElementById('trickCardsArea');
    if (!area) return;
    const cards = gs.trick_cards || [];
    const leaderId = gs.current_turn;
    const trickHash = cards.map(c => c.player_id + ':' + c.card).join(',') + '|' + (leaderId || '');
    if (this._lastTrickHash === trickHash && !this._forceTrickRerender) {
      return;
    }
    this._lastTrickHash = trickHash;
    this._forceTrickRerender = false;

    if (cards.length === 0) {
      const leader = gs.players.find(p => p.id === gs.current_turn);
      const isMe = gs.current_turn === this.myId;
      const leaderText = isMe
        ? '🔥 Your turn to lead — play any card to start trick'
        : (leader ? `Waiting for ${this.esc(leader.name)} to lead…` : 'Waiting for first card…');
      area.innerHTML = `<div class="trick-empty-hint">${leaderText}</div>`;
      return;
    }

    let html = '';
    cards.forEach(({ player_id, card }) => {
      const player = gs.players.find(p => p.id === player_id);
      const pos = this.getRelativePosition(player_id, gs);
      html += `
        <div class="trick-card-slot pos-${pos}">
          ${this.renderCard(card, true, false)}
          <div class="trick-player-label">${this.esc(player?.name || 'Player')}</div>
        </div>
      `;
    });
    area.innerHTML = html;
  }

  renderOpponents(gs) {
    const me = gs.players.find(p => p.id === this.myId);
    const isSpectator = me ? me.role === 'spectator' : (this.myRole === 'spectator');
    const positions = ['left', 'top', 'right'];

    const activePlayers = isSpectator
      ? gs.players.filter(p => p.role === 'player')
      : gs.players.filter(p => p.role === 'player' && p.id !== this.myId);

    const oppHash = activePlayers.map(p => `${p.id}:${p.card_count}:${gs.bids[p.id]}:${gs.tricks_taken[p.id]}:${p.id===gs.current_turn}`).join(';') + '|' + (isSpectator ? 'spec' : 'play');
    if (this._lastOppHash === oppHash) return;
    this._lastOppHash = oppHash;

    const isNewRoundDeal = gs.round > 0 && this._lastDealtRoundOpponents !== gs.round && activePlayers.some(p => (p.card_count || 13) === 13);
    if (isNewRoundDeal) {
      this._lastDealtRoundOpponents = gs.round;
    }

    // Clear all
    ['left', 'top', 'right'].forEach(pos => {
      const el = document.getElementById(`opponent-${pos}`);
      if (el) el.style.display = 'none';
    });

    activePlayers.slice(0, 3).forEach((player, idx) => {
      const pos = positions[idx];
      const el = document.getElementById(`opponent-${pos}`);
      if (!el) return;
      el.style.display = 'flex';

      const cardCount = player.card_count || 13;
      const tricks = gs.tricks_taken[player.id] || 0;
      const bid = gs.bids[player.id];
      const isComplete = (bid !== undefined && bid !== null && Number(bid) > 0 && tricks >= Number(bid));
      const isCurrent = player.id === gs.current_turn;

      const cardBacks = Array.from({ length: Math.max(0, cardCount) }, (_, bIdx) =>
        `<div class="card-back ${isNewRoundDeal ? 'card-dealing' : ''}" style="--card-i: ${bIdx};"></div>`
      ).join('');

      if (pos === 'top') {
        el.innerHTML = `
          <div class="opponent-meta-group">
            <span class="opponent-name ${isCurrent ? 'is-current-turn' : ''}">${this.esc(player.name)}${isComplete ? ' <span class="bid-complete-check" title="Bid Completed!">✅</span>' : ''} ${isCurrent ? '🔥' : ''}</span>
            ${bid !== undefined && bid !== null ? `<span class="opponent-bid-badge">Bid ${bid} • ${tricks}(eat)</span>` : ''}
          </div>
          <div class="opponent-cards-row">${cardBacks}</div>
        `;
      } else {
        el.innerHTML = `
          <div class="opponent-name ${isCurrent ? 'is-current-turn' : ''}">${this.esc(player.name)}${isComplete ? ' <span class="bid-complete-check" title="Bid Completed!">✅</span>' : ''} ${isCurrent ? '🔥' : ''}</div>
          ${bid !== undefined && bid !== null ? `<div class="opponent-bid-badge">Bid ${bid} • ${tricks}(eat)</div>` : ''}
          <div class="opponent-cards-row">${cardBacks}</div>
        `;
      }
    });
  }

  renderMyHand(gs) {
    const container = document.getElementById('myHandContainer');
    if (!container) return;
    const me = gs.players.find(p => p.id === this.myId);
    const isSpectator = me ? (me.role === 'spectator' || me.is_spectator) : (this.myRole === 'spectator');

    const handTitle = document.querySelector('.my-hand-dock .hand-title');
    const handHint = document.querySelector('.my-hand-dock .hand-hint');

    if (isSpectator) {
      if (this._lastHandSpectator !== true) {
        this._lastHandSpectator = true;
        this._lastHandHash = null;
        if (handTitle) handTitle.textContent = '👀 Bench / Spectator Lounge';
        if (handHint) handHint.textContent = 'Watching match • Table tricks and scores update live';
        container.innerHTML = `
          <div class="spectator-hand-notice">
            <div class="spec-title">👀 Spectating: <strong>${this.esc(this.myName || me?.name || 'Spectator')}</strong></div>
            <div class="spec-desc">You are on the bench enjoying the match. Active players are taking tricks on the felt table above!</div>
          </div>
        `;
      }
      return;
    }
    this._lastHandSpectator = false;

    const myBid = gs.bids?.[this.myId];
    const myTricks = gs.tricks_taken?.[this.myId] || 0;
    const isComplete = (myBid !== undefined && myBid !== null && Number(myBid) > 0 && myTricks >= Number(myBid));
    if (handTitle) handTitle.innerHTML = `🂠 Your Hand (${this.myHand ? this.myHand.length : 0} Cards)${isComplete ? ' <span class="bid-complete-check" title="Bid Completed!">✅</span>' : ''}`;
    if (handHint) handHint.textContent = 'Tap card to play instantly';

    if (!this.myHand || this.myHand.length === 0) {
      if (this._lastHandHash !== 'empty') {
        this._lastHandHash = 'empty';
        container.innerHTML = '<div class="hand-empty">Waiting for deal…</div>';
      }
      return;
    }

    const displayHand = this.sortMode === 'auto' ? this.getSortedHand() : this.myHand;
    const myTurn = gs.current_turn === this.myId && gs.phase === 'playing';

    const handHash = displayHand.join(',') + '|' + (this.selectedCard || '') + '|' + (myTurn ? 'turn' : 'wait') + '|' + (gs.trick_cards?.[0]?.card || '') + '|' + this.sortMode;
    if (this._lastHandHash === handHash) {
      return;
    }
    this._lastHandHash = handHash;

    // Sort toggle (if present)
    const sortBtn = document.getElementById('sortToggleBtn');
    if (sortBtn) {
      sortBtn.textContent = this.sortMode === 'auto' ? '🔀 Auto Sort ON' : '🔀 Manual Mode';
    }

    const isNewRoundDeal = gs.round > 0 && this._lastDealtRoundHand !== gs.round && displayHand.length === 13;
    if (isNewRoundDeal) {
      this._lastDealtRoundHand = gs.round;
    }

    const isTrickStarted = gs.trick_cards && gs.trick_cards.length > 0;
    const ledCard = isTrickStarted ? gs.trick_cards[0].card : null;
    const ledSuit = ledCard ? ledCard.slice(-1) : null;
    const hasLedSuit = ledSuit ? displayHand.some(c => c.slice(-1) === ledSuit) : false;

    let html = '';
    displayHand.forEach((cardStr, idx) => {
      const { rank, suit } = this.parseCard(cardStr);
      const isSelected = this.selectedCard === cardStr;
      const isPlayable = myTurn && this.isCardPlayable(cardStr, gs);

      let popClass = '';
      if (myTurn) {
        if (isTrickStarted && hasLedSuit) {
          popClass = suit === ledSuit ? 'card-suit-pop playable' : 'not-playable';
        } else {
          // Leading trick or void in led suit: all legal playable cards pop up
          popClass = 'card-legal-pop playable';
        }
      }

      html += `
        <div class="hand-card ${isNewRoundDeal ? 'card-dealing' : ''} ${isSelected ? 'selected' : ''} ${popClass}"
          style="--card-i: ${idx}; z-index: ${idx + 1};"
          data-card="${cardStr}"
          data-idx="${idx}"
          ${this.sortMode === 'manual' ? 'draggable="true"' : ''}
          onpointerdown="window.tarneebGame.handleCardPointerDown(event, '${cardStr}')"
          onclick="window.tarneebGame.handleCardClick('${cardStr}')">
          ${this.renderCard(cardStr, true, isSelected)}
        </div>
      `;
    });

    container.innerHTML = html;

    // Attach drag events for manual mode
    if (this.sortMode === 'manual') {
      this.attachDragHandlers(container);
    }
  }

  renderCard(cardStr, faceUp = true, highlighted = false) {
    if (!faceUp) {
      return `<div class="card card-back-face">🂠</div>`;
    }
    const { rank, suit } = this.parseCard(cardStr);
    const color = this.suitColors[suit];
    const symbol = this.suitSymbols[suit];
    return `
      <div class="card card-face ${highlighted ? 'card-highlighted' : ''}" style="--card-color: ${color}">
        <div class="card-top-rank">${rank}<span class="card-suit-small">${symbol}</span></div>
        <div class="card-center-suit">${symbol}</div>
        <div class="card-bot-rank">${rank}<span class="card-suit-small">${symbol}</span></div>
      </div>
    `;
  }

  getRelativePosition(playerId, gs) {
    const seated = gs.players.filter(p => p.role === 'player');
    const myIdx = seated.findIndex(p => p.id === this.myId);
    const theirIdx = seated.findIndex(p => p.id === playerId);
    if (myIdx === -1 || theirIdx === -1) {
      if (theirIdx !== -1) {
        return ['bottom', 'left', 'top', 'right'][theirIdx % 4];
      }
      return 'top';
    }
    const diff = (theirIdx - myIdx + 4) % 4;
    return ['bottom', 'left', 'top', 'right'][diff];
  }

  // =========================================================================
  // BIDDING PANEL
  // =========================================================================
  renderBiddingPanel(gs) {
    const panel = document.getElementById('biddingPanel');
    const me = gs.players.find(p => p.id === this.myId);
    const isSpectator = me ? me.role === 'spectator' : (this.myRole === 'spectator');

    if (isSpectator) {
      panel.style.display = 'none';
      return;
    }

    const myTurnToBid = gs.phase === 'bidding' && gs.current_turn === this.myId;

    panel.style.display = myTurnToBid ? 'flex' : 'none';

    if (!myTurnToBid) return;

    const isRound1 = gs.round === 1;
    if (isRound1) {
      panel.innerHTML = '<div class="bid-info">Round 1: No bidding — play to earn tricks!</div>';
      return;
    }

    const bids = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    let html = `
      <div class="bid-panel-title">🎯 Your Bid (Bid 1 is prohibited!)</div>
      <div class="bid-buttons-row">
        ${bids.map(b => `
          <button class="bid-btn-online ${b === 0 ? 'bid-0' : b === 7 ? 'bid-7' : ''}"
            onclick="window.tarneebGame.placeBid(${b})">${b}</button>
        `).join('')}
      </div>
    `;
    panel.innerHTML = html;
  }

  // =========================================================================
  // PLAYABLE CARD LOGIC (CLIENT-SIDE HINT)
  // =========================================================================
  isCardPlayable(cardStr, gs) {
    // If first card in trick, any card is playable
    if (!gs.trick_cards || gs.trick_cards.length === 0) return true;
    const ledCard = gs.trick_cards[0].card;
    const ledSuit = ledCard.slice(-1);
    const { suit } = this.parseCard(cardStr);
    // Check if I have any card of the led suit
    const hasLedSuit = this.myHand.some(c => c.slice(-1) === ledSuit);
    if (!hasLedSuit) return true; // can play anything if void
    return suit === ledSuit; // must follow suit
  }

  highlightPlayableCards(gs) {
    const isTrickStarted = gs.trick_cards && gs.trick_cards.length > 0;
    const ledCard = isTrickStarted ? gs.trick_cards[0].card : null;
    const ledSuit = ledCard ? ledCard.slice(-1) : null;
    const hasLedSuit = ledSuit ? this.myHand.some(c => c.slice(-1) === ledSuit) : false;

    document.querySelectorAll('.hand-card').forEach(el => {
      const card = el.dataset.card;
      const suit = card ? card.slice(-1) : '';
      const playable = this.isCardPlayable(card, gs);

      let isSuitPop = false;
      let isLegalPop = false;

      if (playable) {
        if (isTrickStarted && hasLedSuit && suit === ledSuit) {
          isSuitPop = true;
        } else {
          isLegalPop = true;
        }
      }

      el.classList.toggle('card-suit-pop', isSuitPop);
      el.classList.toggle('card-legal-pop', isLegalPop);
      el.classList.toggle('playable', playable);
      el.classList.toggle('not-playable', !playable);
    });
  }

  // =========================================================================
  // USER ACTIONS
  // =========================================================================
  handleCardPointerDown(e, cardStr) {
    if (e && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
      e.preventDefault();
      this.handleCardClick(cardStr);
    }
  }

  handleCardClick(cardStr) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;
    if (this.isSubmittingPlay) return;
    if (this.gameState.current_turn !== this.myId) {
      this.showToast("It's not your turn!", 'warning');
      return;
    }
    if (!this.isCardPlayable(cardStr, this.gameState)) {
      this.showToast('You must follow the led suit!', 'warning');
      return;
    }

    // Instant card play on first tap
    this.isSubmittingPlay = true;

    // 1. Immediately animate card leaving hand
    const cardEl = document.querySelector(`.hand-card[data-card="${cardStr}"]`);
    if (cardEl) {
      cardEl.classList.add('playing-flying');
    }

    // 2. Optimistically render card onto table in player's bottom slot
    const trickArea = document.getElementById('trickCardsArea');
    if (trickArea) {
      const emptyHint = trickArea.querySelector('.trick-empty-hint');
      if (emptyHint) emptyHint.style.display = 'none';
      const existingBottom = trickArea.querySelector('.trick-card-slot.pos-bottom');
      if (!existingBottom) {
        const slot = document.createElement('div');
        slot.className = 'trick-card-slot pos-bottom optimistic-play';
        slot.innerHTML = `
          ${this.renderCard(cardStr, true, false)}
          <div class="trick-player-label">${this.esc(this.myName || 'You')}</div>
        `;
        trickArea.appendChild(slot);
      }
    }

    // 3. Immediately dismiss YOUR TURN banner
    const banner = document.getElementById('myTurnBanner');
    if (banner) banner.style.display = 'none';

    // 4. Send play to server
    this._forceTrickRerender = true;
    this.send('play_card', { card: cardStr });
    this.selectedCard = null;
    setTimeout(() => { this.isSubmittingPlay = false; }, 300);
  }

  showDealerSelectModal(data) {
    const modal = document.getElementById('modalDealerSelect');
    const grid = document.getElementById('dealerSelectButtonsGrid');
    const promptText = document.getElementById('dealerModalPromptText');
    if (!modal || !grid) return;

    const gs = this.gameState;
    const players = (data && data.seated_players) || (gs ? gs.players.filter(p => p.role === 'player') : []);
    if (!players || players.length === 0) return;

    if (promptText) {
      promptText.textContent = (gs && gs.round > 1)
        ? `Select dealer for Round ${gs.round} (Play rotates to their right):`
        : `Who is dealing Round 1? (Play rotates to their right)`;
    }

    let html = '';
    players.forEach(p => {
      const seat = (p.seat !== undefined && p.seat !== null) ? p.seat : (gs ? gs.players.findIndex(x => x.id === p.id) : 0);
      const isCurrent = gs && gs.dealer === p.id;
      html += `
        <button type="button" class="dealer-pick-btn ${isCurrent ? 'is-active-dealer' : ''}" onclick="window.tarneebGame.chooseDealer(${seat})">
          <span>🂠 ${this.esc(p.name)}</span>
          <span style="font-size:0.8rem;opacity:0.8;">Seat ${seat + 1}${isCurrent ? ' (Current)' : ''}</span>
        </button>
      `;
    });
    grid.innerHTML = html;
    modal.style.display = 'flex';
  }

  hideDealerSelectModal() {
    const modal = document.getElementById('modalDealerSelect');
    if (modal) modal.style.display = 'none';
  }

  chooseDealer(seat) {
    this.send('set_dealer', { seat: seat });
    this.hideDealerSelectModal();
  }

  rotateDealer() {
    this.send('rotate_dealer', {});
    this.showToast('🂠 Rotating dealer to next player…', 'info');
  }

  placeBid(amount) {
    this.send('bid', { amount });
    document.getElementById('biddingPanel').style.display = 'none';
  }

  sendSmirk() {
    this.send('smirk');
  }

  toggleSortMode() {
    this.sortMode = this.sortMode === 'auto' ? 'manual' : 'auto';
    localStorage.setItem('tarneeb_sort_mode', this.sortMode);
    if (this.gameState) this.renderMyHand(this.gameState);
  }

  // =========================================================================
  // DRAG & DROP (MANUAL SORT)
  // =========================================================================
  attachDragHandlers(container) {
    const cards = container.querySelectorAll('.hand-card');
    cards.forEach(card => {
      card.addEventListener('dragstart', (e) => {
        this.dragSrc = card;
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
      card.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        if (this.dragSrc === card) return;
        // Reorder myHand
        const srcIdx = parseInt(this.dragSrc.dataset.idx, 10);
        const dstIdx = parseInt(card.dataset.idx, 10);
        const [removed] = this.myHand.splice(srcIdx, 1);
        this.myHand.splice(dstIdx, 0, removed);
        if (this.gameState) this.renderMyHand(this.gameState);
      });
    });
  }

  // =========================================================================
  // ANIMATIONS & REACTIONS
  // =========================================================================
  showSmirkAnimation(playerId, playerName) {
    const overlay = document.createElement('div');
    overlay.className = 'smirk-overlay';
    overlay.innerHTML = `
      <div class="smirk-bubble">
        <div class="smirk-emoji">😏</div>
        <div class="smirk-name">${this.esc(playerName)} smirks!</div>
      </div>
    `;
    document.body.appendChild(overlay);

    // Show smirk prompt if it was me cutting
    if (playerId === this.myId) {
      // Already triggered by me - no extra prompt needed
    }

    setTimeout(() => overlay.remove(), 3000);
  }

  showSmirkPrompt() {
    const banner = document.getElementById('smirkPromptBanner');
    if (banner) {
      banner.style.display = 'flex';
      setTimeout(() => {
        banner.style.display = 'none';
      }, 7000);
    }
    const btn = document.getElementById('smirkBtn');
    if (btn) {
      btn.style.display = 'inline-flex';
      btn.classList.add('smirk-pulse');
      setTimeout(() => {
        btn.classList.remove('smirk-pulse');
      }, 5000);
    }
  }

  showTrickResult(data) {
    // Disabled: trick winner popup completely removed so trick resolves & clears silently
    return;
  }

  showRoundSummary(data) {
    const modal = document.getElementById('modalRoundSummary');
    const content = document.getElementById('roundSummaryContent');
    if (!modal || !content) return;
    let html = `<h3 style="color:#fde047;margin-bottom:10px;">Round ${data.round} Complete!</h3>`;
    html += '<div style="display:flex;flex-direction:column;gap:6px;">';
    const players = (this.gameState?.players || []).filter(p => p.role === 'player');
    players.forEach(p => {
      const bid = data.bids?.[p.id] !== undefined ? data.bids[p.id] : '-';
      const tricks = data.tricks_taken?.[p.id] ?? 0;
      const rScore = data.round_scores?.[p.id] ?? 0;
      const total = data.cumulative_scores?.[p.id] ?? (this.gameState?.scores?.[p.id] ?? 0);
      const pts = rScore >= 0 ? `+${rScore}` : `${rScore}`;
      const isComplete = (bid !== '-' && Number(bid) > 0 && tricks >= Number(bid));
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;background:#0f172a;padding:8px 12px;border-radius:8px;">
          <span style="font-weight:700;">${this.esc(p.name)}${isComplete ? ' <span class="bid-complete-check" title="Bid Completed!">✅</span>' : ''}</span>
          <span style="color:#94a3b8;font-size:0.85rem;">Bid ${bid} • ${tricks}(eat) → <strong style="color:${rScore >= 0 ? '#4ade80' : '#f87171'}">${pts}</strong></span>
          <span style="color:#fde047;font-weight:800;">${total} pts</span>
        </div>
      `;
    });
    html += '</div>';
    if (data.special_kh && data.special_ah) {
      const khName = this.gameState?.players?.find(p => p.id === data.special_kh)?.name || 'K♥';
      const ahName = this.gameState?.players?.find(p => p.id === data.special_ah)?.name || 'A♥';
      html += `<div style="margin-top:10px;padding:8px;background:rgba(239,68,68,0.18);border:1px solid rgba(239,68,68,0.4);border-radius:8px;font-size:0.8rem;color:#fca5a5;">
        ⚡ <strong>King of Hearts Snip!</strong> ${this.esc(khName)} (-5 pts) • ${this.esc(ahName)} (+5 pts)
      </div>`;
    }
    content.innerHTML = html;
    modal.classList.add('open');
  }

  showAutoSortPrompt(round) {
    const modal = document.getElementById('modalAutoSortPrompt');
    const title = document.getElementById('autoSortRoundTitle');
    if (title) title.textContent = `Round ${round}: Cards Dealt!`;
    if (modal) modal.style.display = 'flex';
  }

  hideAutoSortPrompt() {
    const modal = document.getElementById('modalAutoSortPrompt');
    if (modal) modal.style.display = 'none';
  }

  showPlayerLeftNotice(data) {
    const modal = document.getElementById('modalPlayerLeftNotice');
    const msgEl = document.getElementById('playerLeftMessageText');
    if (msgEl) {
      const leavingName = data.leaving_player_name || 'A player';
      const botName = data.bot_name || 'Bot';
      msgEl.innerHTML = `<strong>${this.esc(leavingName)}</strong> left the table.<br>An automated Bot (<strong>${this.esc(botName)}</strong>) has seamlessly taken over their seat and cards so the match never hangs!`;
    }
    if (modal) modal.style.display = 'flex';
  }

  hidePlayerLeftNotice() {
    const modal = document.getElementById('modalPlayerLeftNotice');
    if (modal) modal.style.display = 'none';
  }

  showMatchHistoryModal() {
    const modal = document.getElementById('modalMatchHistory');
    const content = document.getElementById('matchHistoryContent');
    if (!modal || !content) return;

    const history = (this.gameState && this.gameState.history) || this.matchHistory || [];
    if (!history || history.length === 0) {
      content.innerHTML = `
        <div class="empty-history-notice">
          <div style="font-size: 2.2rem; margin-bottom: 6px;">📜</div>
          <strong>No completed rounds yet</strong>
          <p style="margin-top: 4px; font-size: 0.8rem; opacity: 0.8;">Play through rounds to view each player's bids, tricks taken (eat), and round scores here.</p>
        </div>
      `;
    } else {
      const players = this.gameState ? this.gameState.players.filter(p => p.role === 'player') : [];
      let html = '';
      history.forEach(item => {
        const rNum = item.round;
        const dealerName = item.dealer_name || (item.dealer_seat !== undefined ? `Seat ${item.dealer_seat + 1}` : '—');
        html += `
          <div class="history-round-card">
            <div class="history-round-header">
              <span>Round ${rNum}</span>
              <span class="history-round-dealer">🂠 Dealer: ${this.esc(dealerName)}</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 4px;">
        `;
        const playerIds = Object.keys(item.bids || {});
        const displayPlayers = playerIds.length > 0 ? playerIds : (players.map(p => p.id));
        displayPlayers.forEach(pId => {
          const pObj = players.find(p => p.id === pId);
          const pName = pObj ? pObj.name : `Player (${pId.substring(0, 4)})`;
          const bidVal = item.bids?.[pId];
          const bidText = rNum === 1 ? 'Round 1' : (bidVal !== undefined ? `Bid ${bidVal}` : 'No Bid');
          const tricks = item.tricks_taken?.[pId] ?? 0;
          const rScore = item.round_scores?.[pId] ?? 0;
          const cumScore = item.cumulative_scores?.[pId] ?? 0;
          const scoreClass = rScore > 0 ? 'pos' : rScore < 0 ? 'neg' : '';
          const scoreSign = rScore > 0 ? `+${rScore}` : `${rScore}`;
          const isMade = (rNum > 1 && bidVal !== undefined && Number(bidVal) > 0 && tricks >= Number(bidVal));

          html += `
            <div class="history-player-row">
              <span class="history-player-name">${this.esc(pName)}${isMade ? ' ✅' : ''}</span>
              <span class="history-player-stats">${bidText} • ${tricks}(eat)</span>
              <span class="history-player-score ${scoreClass}">${scoreSign} pts (${cumScore})</span>
            </div>
          `;
        });

        if (item.special_kh && item.special_ah) {
          const khName = players.find(p => p.id === item.special_kh)?.name || 'K♥';
          const ahName = players.find(p => p.id === item.special_ah)?.name || 'A♥';
          html += `
            <div style="font-size: 0.75rem; color: #fca5a5; margin-top: 4px; padding-top: 4px; border-top: 1px dashed rgba(239, 68, 68, 0.3);">
              ⚡ King Snip: ${this.esc(khName)} (-5) • ${this.esc(ahName)} (+5)
            </div>
          `;
        }

        html += `
            </div>
          </div>
        `;
      });
      content.innerHTML = html;
    }

    modal.style.display = 'flex';
    modal.classList.add('open');
  }

  hideMatchHistoryModal() {
    const modal = document.getElementById('modalMatchHistory');
    if (modal) {
      modal.classList.remove('open');
      modal.style.display = 'none';
    }
  }

  showGameVictory(data) {
    const modal = document.getElementById('modalVictoryOnline');
    if (!modal) return;
    modal.classList.add('open');
    const winner = data.standings?.[0]?.name || 'Champion';
    const score = data.standings?.[0]?.score || 0;
    const winnerEl = document.getElementById('victoryWinnerOnline');
    const scoreEl = document.getElementById('victoryScoreOnline');
    if (winnerEl) winnerEl.textContent = winner;
    if (scoreEl) scoreEl.textContent = `${score} pts`;

    let podium = '';
    (data.standings || []).forEach((s, i) => {
      const medals = ['🥇','🥈','🥉','4️⃣'];
      podium += `<div style="display:flex;justify-content:space-between;background:#0f172a;padding:8px 12px;border-radius:8px;margin-bottom:4px;">
        <span>${medals[i] || '🎖️'} ${this.esc(s.name)}</span>
        <span style="color:#fde047;font-weight:700;">${s.score} pts</span>
      </div>`;
    });
    const standingsEl = document.getElementById('victoryStandingsOnline');
    if (standingsEl) standingsEl.innerHTML = podium;
  }

  showStatus(msg) {
    const el = document.getElementById('onlineStatus');
    if (el) el.textContent = msg;
  }

  showToast(msg, type = 'info') {
    const toast = document.getElementById('onlineToast');
    if (!toast) return;
    toast.textContent = msg;
    toast.className = `online-toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3500);
  }

  esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
}

// Global instance
window.tarneebGame = new TarneebOnlineGame();

// =========================================================================
// ONLINE GAME UI INIT & IDENTITY LOBBY FLOW
// =========================================================================

let pendingSelectedName = '';
let onlineEventsConfigured = false;
let userActivelyIdentified = false;

function initOnlineGame() {
  setupOnlineUIEvents();

  // DO NOT auto-join from cached storage on page load!
  // Always check if the user has actively chosen their role/name for the current session.
  if (userActivelyIdentified && window.tarneebGame && window.tarneebGame.myName) {
    // User has already actively identified in current session
    if (!window.tarneebGame.ws || window.tarneebGame.ws.readyState !== WebSocket.OPEN) {
      connectWithIdentity(window.tarneebGame.myName, window.tarneebGame.myRole || 'player');
    }
  } else {
    // If not actively identified in this session, ALWAYS display the "Who are you?" modal!
    openIdentityModal();
  }
}

function openIdentityModal() {
  const modal = document.getElementById('identityModal');
  if (!modal) return;
  modal.classList.add('open');

  // Populate roster quick-select buttons
  const roster = ['Ahmed', 'Hosam', 'Shiba', 'Furjani', 'Naas', 'Zentani'];
  const grid = document.getElementById('identityRosterGrid');
  if (grid) {
    grid.innerHTML = roster.map(name => `
      <button type="button" class="roster-pick-btn ${pendingSelectedName === name ? 'selected' : ''}" onclick="selectRosterName('${name}')">${name}</button>
    `).join('');
  }

  // Pre-fill input if name was selected
  const input = document.getElementById('customNameInput');
  if (input) {
    input.value = pendingSelectedName || '';
  }

  updateSelectedIdentityDisplay();
}

function selectRosterName(name) {
  pendingSelectedName = name;
  const input = document.getElementById('customNameInput');
  if (input) input.value = name;

  document.querySelectorAll('.roster-pick-btn').forEach(btn => {
    btn.classList.toggle('selected', btn.textContent.trim() === name);
  });

  updateSelectedIdentityDisplay();
}

function updateSelectedIdentityDisplay() {
  const banner = document.getElementById('selectedIdentityBanner');
  const nameDisplay = document.getElementById('selectedIdentityNameDisplay');
  if (!banner || !nameDisplay) return;

  const trimmed = (pendingSelectedName || '').trim();
  if (trimmed) {
    nameDisplay.textContent = trimmed;
    banner.style.display = 'block';
  } else {
    banner.style.display = 'none';
  }
}

function closeIdentityModalAndBackToScoreboard() {
  const modal = document.getElementById('identityModal');
  if (modal) modal.classList.remove('open');
  if (typeof window.switchAppMode === 'function') {
    window.switchAppMode('scoreboard');
  }
}

function logoutAndSwitchName() {
  userActivelyIdentified = false;
  sessionStorage.removeItem('tarneeb_session_name');
  sessionStorage.removeItem('tarneeb_session_role');

  if (window.tarneebGame) {
    if (window.tarneebGame.ws && window.tarneebGame.ws.readyState === WebSocket.OPEN) {
      window.tarneebGame.send('leave', {});
    }
    window.tarneebGame.myName = null;
    window.tarneebGame.myRole = null;
    window.tarneebGame.myHand = [];
  }

  pendingSelectedName = '';
  const input = document.getElementById('customNameInput');
  if (input) input.value = '';
  document.querySelectorAll('.roster-pick-btn').forEach(b => b.classList.remove('selected'));
  const banner = document.getElementById('selectedIdentityBanner');
  if (banner) banner.style.display = 'none';

  const roleBadge = document.getElementById('onlineUserRoleBadge');
  if (roleBadge) roleBadge.style.display = 'none';

  openIdentityModal();
}

function handleJoinSubmit(role) {
  const input = document.getElementById('customNameInput');
  const inputVal = (input?.value || '').trim();
  const chosenName = inputVal || (pendingSelectedName || '').trim();

  if (!chosenName) {
    alert('Please pick your name from the group roster or enter a custom nickname first!');
    input?.focus();
    return;
  }

  userActivelyIdentified = true;
  const actualRole = (role === 'spectator') ? 'spectator' : 'player';

  // Persist identity & role in this session
  sessionStorage.setItem('tarneeb_session_name', chosenName);
  sessionStorage.setItem('tarneeb_session_role', actualRole);

  // Close identity modal
  document.getElementById('identityModal')?.classList.remove('open');

  // Connect to server
  connectWithIdentity(chosenName, actualRole);
}

function connectWithIdentity(name, role) {
  const actualRole = (role === 'spectator') ? 'spectator' : 'player';
  window.tarneebGame.myName = name;
  window.tarneebGame.myRole = actualRole;

  let token = localStorage.getItem('tarneeb_token_' + name.toLowerCase());
  if (!token) {
    token = btoa(name + ':' + Math.random().toString(36).substring(2, 9));
    localStorage.setItem('tarneeb_token_' + name.toLowerCase(), token);
  }
  window.tarneebGame.myId = token;

  const onlineTable = document.getElementById('onlineGameTable');
  if (onlineTable) onlineTable.style.display = 'flex';

  // Connect to server (will send JOIN on open or immediately if already connected)
  window.tarneebGame.connect(token);
  window.tarneebGame.sendJoinMessage();
}

function setupOnlineUIEvents() {
  if (onlineEventsConfigured) return;
  onlineEventsConfigured = true;

  // Modal Close ("✕") and Cancel ("← Back to Scoreboard")
  document.getElementById('btnCloseIdentityModal')?.addEventListener('click', closeIdentityModalAndBackToScoreboard);
  document.getElementById('btnCancelIdentity')?.addEventListener('click', closeIdentityModalAndBackToScoreboard);

  // Role Action Buttons
  document.getElementById('btnJoinAsPlayer')?.addEventListener('click', () => handleJoinSubmit('player'));
  document.getElementById('btnJoinAsSpectator')?.addEventListener('click', () => handleJoinSubmit('spectator'));

  // Solo Play (Fill with Bots) button in identity modal
  document.getElementById('btnFillBotsModal')?.addEventListener('click', () => {
    const customInput = document.getElementById('customNameInput');
    const chosenName = pendingSelectedName || customInput?.value.trim();
    if (!chosenName) {
      alert('Please pick your name from the group roster or enter a custom nickname first!');
      customInput?.focus();
      return;
    }
    handleJoinSubmit('player');
    setTimeout(() => {
      window.tarneebGame.send('fill_bots', {});
    }, 200);
  });

  // Fill with Bots button in online header
  document.getElementById('btnFillBots')?.addEventListener('click', () => {
    if (window.tarneebGame.ws && window.tarneebGame.ws.readyState === WebSocket.OPEN) {
      window.tarneebGame.send('fill_bots', {});
      window.tarneebGame.showToast('🤖 Filling table with bots…', 'info');
    } else {
      openIdentityModal();
    }
  });

  // Custom Name Input Sync
  const customInput = document.getElementById('customNameInput');
  if (customInput) {
    customInput.addEventListener('input', (e) => {
      pendingSelectedName = e.target.value.trim();
      document.querySelectorAll('.roster-pick-btn').forEach(btn => {
        btn.classList.toggle('selected', btn.textContent.trim().toLowerCase() === pendingSelectedName.toLowerCase());
      });
      updateSelectedIdentityDisplay();
    });
    customInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleJoinSubmit('player');
      }
    });
  }

  // Role Switch button in online header ("🔄 Change Role")
  document.getElementById('btnSwitchIdentity')?.addEventListener('click', () => {
    if (window.tarneebGame.ws && window.tarneebGame.ws.readyState === WebSocket.OPEN) {
      window.tarneebGame.send('switch_role', {});
    } else {
      openIdentityModal();
    }
  });

  // Switch Name / Logout button in online header ("👤 Switch Name")
  document.getElementById('btnSwitchName')?.addEventListener('click', logoutAndSwitchName);

  // Leave Game button in online header ("🚪 Leave Game")
  document.getElementById('btnLeaveActiveGame')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave your table seat? An automated bot will take over so your match can continue smoothly!')) {
      window.tarneebGame.send('leave_seat', {});
    }
  });

  // Player Left Notice Modal buttons
  document.getElementById('btnKeepPlayingWithBot')?.addEventListener('click', () => {
    window.tarneebGame.hidePlayerLeftNotice();
  });

  document.getElementById('btnLeaveMatchToo')?.addEventListener('click', () => {
    window.tarneebGame.hidePlayerLeftNotice();
    window.tarneebGame.send('leave_seat', {});
    if (typeof window.setGameMode === 'function') {
      window.setGameMode('scoreboard');
    }
  });

  document.getElementById('btnClosePlayerLeftModal')?.addEventListener('click', () => {
    window.tarneebGame.hidePlayerLeftNotice();
  });

  // Dealer change button (rotates dealer in order) & badge (modal picker)
  document.getElementById('btnChangeDealer')?.addEventListener('click', () => {
    window.tarneebGame.rotateDealer();
  });
  document.getElementById('onlineDealerBadge')?.addEventListener('click', () => {
    window.tarneebGame.showDealerSelectModal();
  });
  document.getElementById('btnCloseDealerModal')?.addEventListener('click', () => {
    window.tarneebGame.hideDealerSelectModal();
  });

  // Match History Modal
  const historyModal = document.getElementById('modalMatchHistory');
  document.getElementById('btnMatchHistory')?.addEventListener('click', () => {
    if (window.tarneebGame) {
      window.tarneebGame.showMatchHistoryModal();
    }
  });
  document.getElementById('btnCloseMatchHistory')?.addEventListener('click', () => {
    if (window.tarneebGame) {
      window.tarneebGame.hideMatchHistoryModal();
    } else if (historyModal) {
      historyModal.classList.remove('open');
      historyModal.style.display = 'none';
    }
  });
  historyModal?.addEventListener('click', (e) => {
    if (e.target === historyModal) {
      if (window.tarneebGame) {
        window.tarneebGame.hideMatchHistoryModal();
      } else {
        historyModal.classList.remove('open');
        historyModal.style.display = 'none';
      }
    }
  });

  // Auto-Sort Prompt buttons
  document.getElementById('btnAutoSortYes')?.addEventListener('click', () => {
    window.tarneebGame.sortMode = 'auto';
    localStorage.setItem('tarneeb_sort_mode', 'auto');
    window.tarneebGame._lastHandHash = null;
    if (window.tarneebGame.gameState) {
      window.tarneebGame.renderMyHand(window.tarneebGame.gameState);
    }
    window.tarneebGame.hideAutoSortPrompt();
    window.tarneebGame.showToast('✨ Hand sorted automatically!', 'info');
  });

  document.getElementById('btnAutoSortNo')?.addEventListener('click', () => {
    window.tarneebGame.sortMode = 'manual';
    localStorage.setItem('tarneeb_sort_mode', 'manual');
    window.tarneebGame._lastHandHash = null;
    if (window.tarneebGame.gameState) {
      window.tarneebGame.renderMyHand(window.tarneebGame.gameState);
    }
    window.tarneebGame.hideAutoSortPrompt();
  });

  document.getElementById('btnCloseAutoSortModal')?.addEventListener('click', () => {
    window.tarneebGame.hideAutoSortPrompt();
  });

  // Sort toggle (if present in DOM)
  document.getElementById('sortToggleBtn')?.addEventListener('click', () => {
    window.tarneebGame.toggleSortMode();
  });

  // Smirk button
  document.getElementById('smirkBtn')?.addEventListener('click', () => {
    window.tarneebGame.sendSmirk();
  });

  // Smirk prompt button
  document.getElementById('smirkPromptBtn')?.addEventListener('click', () => {
    window.tarneebGame.sendSmirk();
    const banner = document.getElementById('smirkPromptBanner');
    if (banner) banner.style.display = 'none';
  });

  // Round summary close
  document.getElementById('closeRoundSummaryBtn')?.addEventListener('click', () => {
    document.getElementById('modalRoundSummary')?.classList.remove('open');
  });

  // Victory modal close
  document.getElementById('closeVictoryOnlineBtn')?.addEventListener('click', () => {
    document.getElementById('modalVictoryOnline')?.classList.remove('open');
  });
}
