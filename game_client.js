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
    this.suitColors = { H: '#ef4444', S: '#f8fafc', D: '#ef4444', C: '#f8fafc' };
    this.suitNames = { H: 'Hearts', S: 'Spades', D: 'Diamonds', C: 'Clubs' };
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
      this.sendJoinMessage();
      this.flushPendingMessages();
    };
    this.ws.onmessage = (evt) => this.handleServerMessage(JSON.parse(evt.data));
    this.ws.onclose = () => {
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
        this.renderGame();
        break;

      case 'player_joined':
        this.showToast(`${data.name} joined as ${data.role === 'spectator' ? 'Spectator 👁️' : 'Player 🂠'}`);
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
    document.getElementById('onlinePhaseInfo').textContent = this.getPhaseLabel(gs);

    // Render dealer + round info
    const dealer = gs.players.find(p => p.id === gs.dealer);
    document.getElementById('onlineRoundBadge').textContent = `Round ${gs.round} of 15`;
    document.getElementById('onlineDealerBadge').textContent = `🂠 Dealer: ${dealer ? dealer.name : '-'}`;

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

    // Turn indicator (never shown to spectators)
    const myTurn = !isSpectator && gs.current_turn === this.myId;
    document.getElementById('myTurnBanner').style.display = myTurn && gs.phase === 'playing' ? 'flex' : 'none';

    // Highlight playable cards
    if (myTurn && gs.phase === 'playing') {
      this.highlightPlayableCards(gs);
    }
  }

  getPhaseLabel(gs) {
    switch (gs.phase) {
      case 'lobby': return '⏳ Waiting for players to join…';
      case 'bidding': return `🎯 Bidding Phase — Round ${gs.round}`;
      case 'playing': return `🃏 Playing — Trick ${gs.current_trick || 1} of 13`;
      case 'round_end': return `📊 Round ${gs.round} Complete`;
      case 'game_end': return '🏆 Game Over!';
      default: return '';
    }
  }

  renderScoreSidebar(gs) {
    const container = document.getElementById('onlineScoreboard');
    const players = [...gs.players].filter(p => p.role === 'player');
    players.sort((a, b) => (gs.scores[b.id] || 0) - (gs.scores[a.id] || 0));

    let html = '<div class="score-sidebar-title">📊 Live Scores</div>';
    players.forEach((p, idx) => {
      const score = gs.scores[p.id] || 0;
      const bid = gs.bids[p.id];
      const tricks = gs.tricks_taken[p.id] || 0;
      const isMe = p.id === this.myId;
      const isCurrent = p.id === gs.current_turn;
      const medals = ['🥇','🥈','🥉','4️⃣'];

      html += `
        <div class="score-row ${isMe ? 'is-me' : ''} ${isCurrent ? 'is-turn' : ''}">
          <span class="score-medal">${medals[idx] || '🎖️'}</span>
          <span class="score-name">${this.esc(p.name)}${isMe ? ' (You)' : ''}</span>
          <div class="score-details">
            ${bid !== undefined && bid !== null ? `<span class="bid-chip">Bid ${bid}</span>` : ''}
            ${gs.phase === 'playing' ? `<span class="tricks-chip">${tricks}T</span>` : ''}
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
    const cards = gs.trick_cards || [];

    if (cards.length === 0) {
      area.innerHTML = '<div class="trick-empty-hint">Waiting for first card…</div>';
      return;
    }

    let html = '';
    cards.forEach(({ player_id, card }) => {
      const player = gs.players.find(p => p.id === player_id);
      const pos = this.getRelativePosition(player_id, gs);
      html += `
        <div class="trick-card-slot pos-${pos}">
          ${this.renderCard(card, false, false)}
          <div class="trick-player-label">${this.esc(player?.name || '')}</div>
        </div>
      `;
    });
    area.innerHTML = html;
  }

  renderOpponents(gs) {
    const me = gs.players.find(p => p.id === this.myId);
    const isSpectator = me ? me.role === 'spectator' : (this.myRole === 'spectator');
    const positions = ['left', 'top', 'right'];

    // Clear all
    ['left', 'top', 'right'].forEach(pos => {
      const el = document.getElementById(`opponent-${pos}`);
      if (el) el.style.display = 'none';
    });

    const activePlayers = isSpectator
      ? gs.players.filter(p => p.role === 'player')
      : gs.players.filter(p => p.role === 'player' && p.id !== this.myId);

    activePlayers.slice(0, 3).forEach((player, idx) => {
      const pos = positions[idx];
      const el = document.getElementById(`opponent-${pos}`);
      if (!el) return;
      el.style.display = 'flex';

      const cardCount = player.card_count || 13;
      const tricks = gs.tricks_taken[player.id] || 0;
      const bid = gs.bids[player.id];
      const isCurrent = player.id === gs.current_turn;

      const cardBacks = Array.from({ length: Math.max(0, cardCount) }, () =>
        `<div class="card-back ${pos === 'top' ? 'card-back-horizontal' : ''}"></div>`
      ).join('');

      el.innerHTML = `
        <div class="opponent-name ${isCurrent ? 'is-current-turn' : ''}">${this.esc(player.name)} ${isCurrent ? '🔥' : ''}</div>
        ${bid !== undefined && bid !== null ? `<div class="opponent-bid-badge">Bid ${bid} • ${tricks}T</div>` : ''}
        <div class="opponent-cards-row">${cardBacks}</div>
      `;
    });
  }

  renderMyHand(gs) {
    const container = document.getElementById('myHandContainer');
    const me = gs.players.find(p => p.id === this.myId);
    const isSpectator = me ? me.role === 'spectator' : (this.myRole === 'spectator');

    const handTitle = document.querySelector('.my-hand-dock .hand-title');
    const handHint = document.querySelector('.my-hand-dock .hand-hint');

    if (isSpectator) {
      if (handTitle) handTitle.textContent = '👀 Bench / Spectator Lounge';
      if (handHint) handHint.textContent = 'Watching match • Table tricks and scores update live';
      container.innerHTML = `
        <div class="spectator-hand-notice">
          <div class="spec-title">👀 Spectating: <strong>${this.esc(this.myName || me?.name || 'Spectator')}</strong></div>
          <div class="spec-desc">You are on the bench enjoying the match. Active players are taking tricks on the felt table above!</div>
        </div>
      `;
      return;
    }

    if (handTitle) handTitle.textContent = `🂠 Your Hand (${this.myHand ? this.myHand.length : 0} Cards)`;
    if (handHint) handHint.textContent = 'Tap card once to select, tap again to play';

    if (!this.myHand || this.myHand.length === 0) {
      container.innerHTML = '<div class="hand-empty">Waiting for deal…</div>';
      return;
    }

    const displayHand = this.sortMode === 'auto' ? this.getSortedHand() : this.myHand;
    const myTurn = gs.current_turn === this.myId && gs.phase === 'playing';

    // Sort toggle
    document.getElementById('sortToggleBtn').textContent = this.sortMode === 'auto' ? '🔀 Auto Sort ON' : '🔀 Manual Mode';

    let html = '';
    displayHand.forEach((cardStr, idx) => {
      const { rank, suit } = this.parseCard(cardStr);
      const isSelected = this.selectedCard === cardStr;
      const isPlayable = myTurn && this.isCardPlayable(cardStr, gs);

      html += `
        <div class="hand-card ${isSelected ? 'selected' : ''} ${!myTurn ? '' : isPlayable ? 'playable' : 'not-playable'}"
          data-card="${cardStr}"
          data-idx="${idx}"
          ${this.sortMode === 'manual' ? 'draggable="true"' : ''}
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
    document.querySelectorAll('.hand-card').forEach(el => {
      const card = el.dataset.card;
      const playable = this.isCardPlayable(card, gs);
      el.classList.toggle('playable', playable);
      el.classList.toggle('not-playable', !playable);
    });
  }

  // =========================================================================
  // USER ACTIONS
  // =========================================================================
  handleCardClick(cardStr) {
    if (!this.gameState || this.gameState.phase !== 'playing') return;
    if (this.gameState.current_turn !== this.myId) {
      this.showToast("It's not your turn!", 'warning');
      return;
    }
    if (!this.isCardPlayable(cardStr, this.gameState)) {
      this.showToast('You must follow the led suit!', 'warning');
      return;
    }
    if (this.selectedCard === cardStr) {
      // Second click confirms play
      this.send('play_card', { card: cardStr });
      this.selectedCard = null;
    } else {
      this.selectedCard = cardStr;
      this.renderMyHand(this.gameState);
    }
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
    const winner = data.winner_name || 'Player';
    const kh = data.special_kh;
    const ah = data.special_ah;
    let text = `🃏 ${winner} wins the trick!`;
    if (kh && ah) {
      text += ` ⚡ King of Hearts Snip! (K♥ -5, A♥ +5)`;
    }
    this.showToast(text, 'info');
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
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;background:#0f172a;padding:8px 12px;border-radius:8px;">
          <span style="font-weight:700;">${this.esc(p.name)}</span>
          <span style="color:#94a3b8;font-size:0.85rem;">Bid ${bid} • ${tricks}T → <strong style="color:${rScore >= 0 ? '#4ade80' : '#f87171'}">${pts}</strong></span>
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

function initOnlineGame() {
  setupOnlineUIEvents();

  // Check if identity was already selected in current session
  const sessionName = sessionStorage.getItem('tarneeb_session_name') || window.tarneebGame.myName;
  const sessionRole = sessionStorage.getItem('tarneeb_session_role') || window.tarneebGame.myRole || 'player';

  if (sessionName) {
    // Already identified in this session -> connect if not connected
    if (!window.tarneebGame.ws || window.tarneebGame.ws.readyState !== WebSocket.OPEN) {
      connectWithIdentity(sessionName, sessionRole);
    }
  } else {
    // Not yet identified in this session -> prompt "Who are you?" modal
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

function handleJoinSubmit(role) {
  const input = document.getElementById('customNameInput');
  const inputVal = (input?.value || '').trim();
  const chosenName = inputVal || (pendingSelectedName || '').trim();

  if (!chosenName) {
    alert('Please pick your name from the group roster or enter a custom nickname first!');
    input?.focus();
    return;
  }

  // Ensure role is explicitly set
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

  // Sort toggle
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
