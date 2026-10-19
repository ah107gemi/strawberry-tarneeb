"""
Strawberry Tarneeb – FastAPI + WebSocket Game Server
=====================================================
Handles 4 seated players + unlimited spectators.
Hearts (H) is always trump.
15 rounds total with specific bidding / scoring rules.

Run with:
    python server.py
or:
    uvicorn server:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
import uuid
from collections import defaultdict
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("tarneeb")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SUITS = ["S", "H", "D", "C"]          # Spades, Hearts, Diamonds, Clubs
RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"]
RANK_ORDER = {r: i for i, r in enumerate(RANKS)}  # 2=0 … A=12

TRUMP_SUIT = "H"
TOTAL_ROUNDS = 15
MAX_PLAYERS = 4
RECONNECT_TIMEOUT = 60  # seconds

ROSTER = ["Ahmed", "Hosam", "Shiba", "Furjani", "Naas", "Zentani"]

# Scoring constants
SCORE_BID_0_MADE   = +5
SCORE_BID_0_FAILED = -5
SCORE_BID_7_MADE   = +14
SCORE_BID_7_FAILED = -14

# Special K♥ + A♥ in same trick
SPECIAL_KH_PENALTY = -5
SPECIAL_AH_BONUS   = +5

# ---------------------------------------------------------------------------
# Card helpers
# ---------------------------------------------------------------------------

def make_deck() -> List[str]:
    """Return a shuffled 52-card deck. Card format: rank+suit e.g. 'AH', '10S'."""
    deck = [r + s for s in SUITS for r in RANKS]
    random.shuffle(deck)
    return deck


def card_suit(card: str) -> str:
    """Extract suit letter from card string."""
    return card[-1]


def card_rank(card: str) -> str:
    """Extract rank string from card string."""
    return card[:-1]


def card_rank_value(card: str) -> int:
    """Numeric rank value for comparison."""
    return RANK_ORDER[card_rank(card)]


def trick_winner(trick: List[Dict], led_suit: str) -> Dict:
    """
    Determine which play wins the trick.
    A play is {player_id, card}.
    Trump (Hearts) beats led suit. Within same suit, higher rank wins.
    """
    winning_play = trick[0]
    for play in trick[1:]:
        c_win = winning_play["card"]
        c_new = play["card"]
        s_win = card_suit(c_win)
        s_new = card_suit(c_new)

        if s_win == TRUMP_SUIT and s_new != TRUMP_SUIT:
            # current winner is trump, challenger is not → keep winner
            continue
        if s_new == TRUMP_SUIT and s_win != TRUMP_SUIT:
            # challenger is trump, winner is not → challenger wins
            winning_play = play
        elif s_new == s_win:
            # same suit → higher rank wins
            if card_rank_value(c_new) > card_rank_value(c_win):
                winning_play = play
        else:
            # challenger is off-suit non-trump → cannot beat
            continue

    return winning_play


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

class Player:
    """Represents a connected (or temporarily disconnected) participant."""

    def __init__(self, token: str, name: str, seat: Optional[int], role: str):
        self.token = token
        self.name = name
        self.seat = seat          # 0-3 for players, None for spectators
        self.role = role          # 'player' | 'spectator'
        self.hand: List[str] = []
        self.ws: Optional[WebSocket] = None
        self.connected_at: float = time.time()
        self.disconnected_at: Optional[float] = None

    @property
    def is_connected(self) -> bool:
        return self.ws is not None

    @property
    def id(self) -> str:
        return self.token

    def to_dict(self, include_hand: bool = False) -> Dict:
        d = {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "seat": self.seat,
            "connected": self.is_connected,
            "card_count": len(self.hand),
        }
        if include_hand:
            d["hand"] = self.hand
        return d


class GameState:
    """
    Central in-memory state for one Tarneeb game session.
    """

    def __init__(self):
        self.players: Dict[str, Player] = {}   # token → Player
        self.seats: List[Optional[str]] = [None, None, None, None]  # seat → token

        self.phase: str = "lobby"              # lobby | bidding | playing | round_end | game_end
        self.round: int = 0                    # 1-based when started
        self.dealer_seat: int = 0              # seat index of dealer
        self.current_turn_seat: int = 0        # seat index whose turn it is

        self.bids: Dict[str, int] = {}         # token → bid amount
        self.tricks_taken: Dict[str, int] = {} # token → tricks this round
        self.trick_cards: List[Dict] = []      # [{player_id, card}, ...]
        self.led_suit: Optional[str] = None    # suit led in current trick

        self.scores: Dict[str, int] = defaultdict(int)       # cumulative
        self.round_scores: Dict[str, int] = defaultdict(int) # this round

        self.trump_suit: str = TRUMP_SUIT
        self.kings_snip: Optional[Dict[str, Any]] = None

        # Track bid order for bidding phase
        self.bid_order: List[str] = []    # list of tokens in bid order
        self.bidding_idx: int = 0          # index into bid_order

    # ------------------------------------------------------------------
    # Seat / roster helpers
    # ------------------------------------------------------------------

    def seated_tokens_in_order(self, starting_seat: int = 0) -> List[str]:
        """Return token list starting from given seat, wrapping around."""
        tokens = []
        for i in range(MAX_PLAYERS):
            seat = (starting_seat + i) % MAX_PLAYERS
            if self.seats[seat]:
                tokens.append(self.seats[seat])
        return tokens

    def all_seats_filled(self) -> bool:
        return all(s is not None for s in self.seats)

    def player_left_of(self, seat: int) -> int:
        """Clockwise next seat."""
        return (seat + 1) % MAX_PLAYERS

    def token_at_seat(self, seat: int) -> Optional[str]:
        return self.seats[seat]

    def seat_of_token(self, token: str) -> Optional[int]:
        player = self.players.get(token)
        return player.seat if player else None

    # ------------------------------------------------------------------
    # Public state slice (hands are private)
    # ------------------------------------------------------------------

    def public_state(self, for_token: Optional[str] = None) -> Dict:
        if self.phase == "bidding":
            current_turn = self.bid_order[self.bidding_idx] if (self.bid_order and self.bidding_idx < len(self.bid_order)) else None
        else:
            current_turn = self.token_at_seat(self.current_turn_seat)

        state = {
            "phase": self.phase,
            "round": self.round,
            "dealer": self.token_at_seat(self.dealer_seat),
            "current_turn": current_turn,
            "bids": dict(self.bids),
            "tricks_taken": dict(self.tricks_taken),
            "trick_cards": list(self.trick_cards),
            "scores": {k: v for k, v in self.scores.items()},
            "round_scores": {k: v for k, v in self.round_scores.items()},
            "trump_suit": self.trump_suit,
            "players": [p.to_dict() for p in self.players.values()],
        }
        # Attach private hand only for the requesting player
        if for_token and for_token in self.players:
            state["my_hand"] = self.players[for_token].hand
        else:
            state["my_hand"] = []
        return state


# ---------------------------------------------------------------------------
# Connection manager
# ---------------------------------------------------------------------------

class ConnectionManager:
    """Manages WebSocket connections and message dispatch."""

    def __init__(self):
        self.game = GameState()

    # ------------------------------------------------------------------
    # Connection lifecycle
    # ------------------------------------------------------------------

    async def connect(self, ws: WebSocket, token: str) -> Player:
        await ws.accept()
        player = self.game.players.get(token)

        if player:
            # Reconnect
            player.ws = ws
            player.disconnected_at = None
            log.info("Reconnected: %s (%s)", player.name, token)
        else:
            # New connection — seat assignment happens on 'join' message
            player = Player(token=token, name="", seat=None, role="spectator")
            player.ws = ws
            self.game.players[token] = player
            log.info("New connection token=%s", token)

        return player

    def disconnect(self, token: str):
        player = self.game.players.get(token)
        if player:
            player.ws = None
            player.disconnected_at = time.time()
            log.info("Disconnected: %s (%s)", player.name, token)

    # ------------------------------------------------------------------
    # Send helpers
    # ------------------------------------------------------------------

    async def send_to(self, token: str, msg: Dict):
        player = self.game.players.get(token)
        if player and player.ws:
            try:
                await player.ws.send_json(msg)
            except Exception as exc:
                log.warning("send_to %s failed: %s", token, exc)

    async def broadcast(self, msg: Dict, exclude: Optional[str] = None):
        """Send a message to every connected client."""
        for token, player in self.game.players.items():
            if token == exclude:
                continue
            if player.is_connected:
                try:
                    await player.ws.send_json(msg)
                except Exception as exc:
                    log.warning("broadcast to %s failed: %s", token, exc)

    async def broadcast_game_state(self):
        """
        Send a personalised game_state to every connected client.
        Each player gets their own hand; spectators get empty hand.
        """
        for token, player in self.game.players.items():
            if player.is_connected:
                state = self.game.public_state(for_token=token)
                try:
                    await player.ws.send_json({"type": "game_state", "data": state})
                except Exception as exc:
                    log.warning("broadcast_game_state to %s failed: %s", token, exc)

    # ------------------------------------------------------------------
    # Message routing
    # ------------------------------------------------------------------

    async def handle_message(self, token: str, raw: str):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await self.send_to(token, {"type": "error", "data": {"message": "Invalid JSON"}})
            return

        mtype = msg.get("type", "")
        data = msg.get("data")
        if data is None or not isinstance(data, dict):
            data = msg

        handlers = {
            "join": self._handle_join,
            "bid": self._handle_bid,
            "play_card": self._handle_play_card,
            "smirk": self._handle_smirk,
            "request_state": self._handle_request_state,
        }

        handler = handlers.get(mtype)
        if handler:
            await handler(token, data)
        else:
            await self.send_to(token, {"type": "error", "data": {"message": f"Unknown message type: {mtype}"}})

    # ------------------------------------------------------------------
    # Handler: join
    # ------------------------------------------------------------------

    async def _handle_join(self, token: str, data: Dict):
        game = self.game
        player = game.players[token]

        # Allow roster pick or custom name
        chosen_name = data.get("name", "").strip() or data.get("roster_pick", "").strip()
        if not chosen_name:
            chosen_name = f"Player {len(game.players)}"

        # Check if name already taken by another active token
        for tok, p in game.players.items():
            if tok != token and p.name.lower() == chosen_name.lower():
                await self.send_to(token, {"type": "error", "data": {"message": f"'{chosen_name}' is already taken."}})
                return

        player.name = chosen_name
        is_spectator_requested = bool(data.get("as_spectator")) or data.get("role") == "spectator"

        if is_spectator_requested:
            # Explicit spectator request
            if player.seat is not None:
                game.seats[player.seat] = None
                player.seat = None
            player.role = "spectator"
            log.info("%s joined as spectator", player.name)
        else:
            # Active player request
            if player.seat is None:
                empty_seat = next((i for i, s in enumerate(game.seats) if s is None), None)
                if empty_seat is not None:
                    player.seat = empty_seat
                    player.role = "player"
                    game.seats[empty_seat] = token
                    log.info("%s joined as player at seat %d", player.name, empty_seat)
                else:
                    log.info("%s attempted to join as player but table is full", player.name)
                    await self.send_to(token, {
                        "type": "error",
                        "data": {
                            "message": "The card table is currently full (all 4 seats taken). Please join as a Bench / Spectator to watch!",
                            "code": "TABLE_FULL"
                        }
                    })
                    return
            else:
                player.role = "player"
                log.info("%s re-confirmed as player at seat %d", player.name, player.seat)

        await self.broadcast({
            "type": "player_joined",
            "data": {"id": token, "name": player.name, "role": player.role, "seat": player.seat},
        })
        await self.broadcast_game_state()

        # Auto-start if all 4 seats filled and game is in lobby
        if game.phase == "lobby" and game.all_seats_filled():
            await self._start_round()

    # ------------------------------------------------------------------
    # Handler: bid
    # ------------------------------------------------------------------

    async def _handle_bid(self, token: str, data: Dict):
        game = self.game

        if game.phase != "bidding":
            await self.send_to(token, {"type": "error", "data": {"message": "Not in bidding phase."}})
            return

        # Validate it's this player's turn to bid
        expected_token = game.bid_order[game.bidding_idx]
        if token != expected_token:
            await self.send_to(token, {"type": "error", "data": {"message": "Not your turn to bid."}})
            return

        try:
            amount = int(data.get("amount"))
        except (TypeError, ValueError):
            await self.send_to(token, {"type": "error", "data": {"message": "Bid amount must be an integer."}})
            return

        # Round 1 has no bidding — should never reach here but guard anyway
        if game.round == 1:
            await self.send_to(token, {"type": "error", "data": {"message": "No bidding in round 1."}})
            return

        # Validate bid: 0 is allowed, 1 is prohibited, 2-13 allowed
        if amount == 1 or amount < 0 or amount > 13:
            await self.send_to(token, {"type": "error", "data": {"message": "Invalid bid. Allowed: 0, 2-13."}})
            return

        game.bids[token] = amount
        game.bidding_idx += 1
        log.info("%s bid %d", game.players[token].name, amount)

        if game.bidding_idx >= len(game.bid_order):
            # All bids collected — start playing phase
            await self._start_playing_phase()
        else:
            await self.broadcast_game_state()

    # ------------------------------------------------------------------
    # Handler: play_card
    # ------------------------------------------------------------------

    async def _handle_play_card(self, token: str, data: Dict):
        game = self.game

        if game.phase != "playing":
            await self.send_to(token, {"type": "error", "data": {"message": "Not in playing phase."}})
            return

        expected_token = game.token_at_seat(game.current_turn_seat)
        if token != expected_token:
            await self.send_to(token, {"type": "error", "data": {"message": "Not your turn to play."}})
            return

        player = game.players[token]
        card = data.get("card", "").strip().upper()

        if card not in player.hand:
            await self.send_to(token, {"type": "error", "data": {"message": f"Card {card} not in your hand."}})
            return

        # Validate suit-following rules
        valid, err = self._validate_play(player, card)
        if not valid:
            await self.send_to(token, {"type": "error", "data": {"message": err}})
            return

        # Play the card
        player.hand.remove(card)
        play = {"player_id": token, "card": card}
        game.trick_cards.append(play)

        # Track led suit
        if len(game.trick_cards) == 1:
            game.led_suit = card_suit(card)

        # Smirk: non-Heart led, this card is a Heart (cut)
        if game.led_suit and game.led_suit != TRUMP_SUIT and card_suit(card) == TRUMP_SUIT:
            prior_cuts = any(card_suit(p["card"]) == TRUMP_SUIT for p in game.trick_cards[:-1])
            if not prior_cuts:
                await self.send_to(token, {
                    "type": "prompt_smirk",
                    "data": {"message": "Send Smirk 😏?"}
                })

        log.info("%s played %s", player.name, card)

        # Move to next seat
        game.current_turn_seat = self.game.player_left_of(game.current_turn_seat)

        if len(game.trick_cards) == MAX_PLAYERS:
            # Trick complete
            await self._resolve_trick()
        else:
            await self.broadcast_game_state()

    def _validate_play(self, player: Player, card: str) -> tuple[bool, str]:
        """
        Returns (is_valid, error_message).
        Must follow led suit if possible. If void in led suit, may play anything.
        """
        game = self.game
        if not game.trick_cards:
            # Leading — any card is fine
            return True, ""

        led = game.led_suit
        suit_of_card = card_suit(card)

        # Does player have any card of led suit?
        has_led_suit = any(card_suit(c) == led for c in player.hand)
        if has_led_suit and suit_of_card != led:
            return False, f"Must follow led suit ({led})."

        return True, ""

    # ------------------------------------------------------------------
    # Handler: smirk
    # ------------------------------------------------------------------

    async def _handle_smirk(self, token: str, data: Dict):
        player = self.game.players.get(token)
        if not player:
            return
        # Player-triggered smirk (emoji / animation reaction)
        await self.broadcast({
            "type": "smirk_trigger",
            "data": {"player_id": token, "player_name": player.name},
        })

    # ------------------------------------------------------------------
    # Handler: request_state
    # ------------------------------------------------------------------

    async def _handle_request_state(self, token: str, data: Dict):
        state = self.game.public_state(for_token=token)
        await self.send_to(token, {"type": "game_state", "data": state})

    # ------------------------------------------------------------------
    # Game flow
    # ------------------------------------------------------------------

    async def _start_round(self):
        game = self.game
        game.round += 1
        log.info("=== Starting Round %d ===", game.round)

        # Rotate dealer clockwise each round (round 1 → seat 0)
        game.dealer_seat = (game.round - 1) % MAX_PLAYERS

        # Reset per-round state
        game.bids = {}
        game.tricks_taken = {tok: 0 for tok in game.seats if tok}
        game.trick_cards = []
        game.led_suit = None
        game.round_scores = defaultdict(int)
        game.bid_order = []
        game.bidding_idx = 0
        game.kings_snip = None

        # Deal cards (13 each)
        deck = make_deck()
        seated = [game.seats[i] for i in range(MAX_PLAYERS)]
        for i, tok in enumerate(seated):
            if tok:
                game.players[tok].hand = sorted(deck[i * 13:(i + 1) * 13], key=lambda c: (card_suit(c), card_rank_value(c)))

        if game.round == 1:
            # No bidding in round 1
            game.phase = "playing"
            # First to play is left of dealer
            first_seat = game.player_left_of(game.dealer_seat)
            game.current_turn_seat = first_seat
        else:
            # Bidding starts left of dealer
            game.phase = "bidding"
            first_bid_seat = game.player_left_of(game.dealer_seat)
            game.bid_order = game.seated_tokens_in_order(first_bid_seat)

        await self.broadcast_game_state()

    async def _start_playing_phase(self):
        game = self.game
        game.phase = "playing"
        # First to play is left of dealer
        game.current_turn_seat = game.player_left_of(game.dealer_seat)
        game.led_suit = None
        game.trick_cards = []
        log.info("Playing phase started. Bids: %s", game.bids)
        await self.broadcast_game_state()

    async def _resolve_trick(self):
        game = self.game
        led = game.led_suit
        winner_play = trick_winner(game.trick_cards, led)
        winner_token = winner_play["player_id"]
        winner_name = game.players[winner_token].name

        game.tricks_taken[winner_token] = game.tricks_taken.get(winner_token, 0) + 1

        # Check special K♥ + A♥ rule
        kh_play = next((p for p in game.trick_cards if p["card"] == "KH"), None)
        ah_play = next((p for p in game.trick_cards if p["card"] == "AH"), None)
        special_kh_token = None
        special_ah_token = None
        if kh_play and ah_play:
            special_kh_token = kh_play["player_id"]
            special_ah_token = ah_play["player_id"]
            game.kings_snip = {"kh": special_kh_token, "ah": special_ah_token}
            log.info("Special rule triggered: KH(%s) AH(%s) in same trick",
                     game.players[special_kh_token].name, game.players[special_ah_token].name)

        trick_summary = {
            "winner_id": winner_token,
            "winner_name": winner_name,
            "cards": list(game.trick_cards),
            "special_kh": special_kh_token,
            "special_ah": special_ah_token,
        }

        await self.broadcast({"type": "trick_complete", "data": trick_summary})

        # Reset for next trick
        completed_trick = list(game.trick_cards)
        game.trick_cards = []
        game.led_suit = None

        # Winner leads next trick
        winner_seat = game.seat_of_token(winner_token)
        game.current_turn_seat = winner_seat

        # Check if round is over (all cards played = 13 tricks)
        total_tricks = sum(game.tricks_taken.values())
        if total_tricks == 13:
            await self._resolve_round()
        else:
            await self.broadcast_game_state()

    async def _resolve_round(self):
        game = self.game
        log.info("=== Round %d complete ===", game.round)
        game.phase = "round_end"

        # Calculate scores for each seated player
        for seat_idx in range(MAX_PLAYERS):
            tok = game.seats[seat_idx]
            if not tok:
                continue

            tricks = game.tricks_taken.get(tok, 0)

            if game.round == 1:
                # Round 1: no bids, score = tricks taken
                round_score = tricks
            else:
                bid = game.bids.get(tok, 0)
                made = tricks >= bid

                if bid == 0:
                    round_score = SCORE_BID_0_MADE if made else SCORE_BID_0_FAILED
                elif bid == 7:
                    round_score = SCORE_BID_7_MADE if made else SCORE_BID_7_FAILED
                else:
                    round_score = bid if made else -bid

            game.round_scores[tok] = round_score
            game.scores[tok] = game.scores.get(tok, 0) + round_score

        # Apply special K♥/A♥ bonuses AFTER normal scoring
        special_kh_token = game.kings_snip.get("kh") if game.kings_snip else None
        special_ah_token = game.kings_snip.get("ah") if game.kings_snip else None
        if special_kh_token:
            game.round_scores[special_kh_token] = game.round_scores.get(special_kh_token, 0) + SPECIAL_KH_PENALTY
            game.scores[special_kh_token] = game.scores.get(special_kh_token, 0) + SPECIAL_KH_PENALTY
        if special_ah_token:
            game.round_scores[special_ah_token] = game.round_scores.get(special_ah_token, 0) + SPECIAL_AH_BONUS
            game.scores[special_ah_token] = game.scores.get(special_ah_token, 0) + SPECIAL_AH_BONUS

        round_summary = {
            "round": game.round,
            "tricks_taken": dict(game.tricks_taken),
            "bids": dict(game.bids),
            "round_scores": dict(game.round_scores),
            "cumulative_scores": dict(game.scores),
            "special_kh": special_kh_token,
            "special_ah": special_ah_token,
        }

        await self.broadcast({"type": "round_complete", "data": round_summary})
        await self.broadcast_game_state()

        if game.round >= TOTAL_ROUNDS:
            await self._end_game()
        else:
            # Wait a moment then start next round
            await asyncio.sleep(4)
            await self._start_round()

    async def _end_game(self):
        game = self.game
        game.phase = "game_end"
        log.info("=== Game Over ===")

        # Build final standings sorted by score
        standings = sorted(
            [
                {"id": tok, "name": game.players[tok].name, "score": game.scores.get(tok, 0)}
                for tok in game.seats if tok
            ],
            key=lambda x: x["score"],
            reverse=True,
        )
        for i, s in enumerate(standings):
            s["rank"] = i + 1

        await self.broadcast({"type": "game_complete", "data": {"standings": standings}})
        await self.broadcast_game_state()

    # ------------------------------------------------------------------
    # Reconnect cleanup
    # ------------------------------------------------------------------

    async def cleanup_stale_connections(self):
        """Periodically evict players that have been disconnected > RECONNECT_TIMEOUT."""
        while True:
            await asyncio.sleep(10)
            now = time.time()
            to_remove = []
            for tok, player in list(self.game.players.items()):
                if not player.is_connected and player.disconnected_at:
                    if now - player.disconnected_at > RECONNECT_TIMEOUT:
                        to_remove.append(tok)

            for tok in to_remove:
                player = self.game.players.pop(tok, None)
                if player and player.seat is not None:
                    self.game.seats[player.seat] = None
                    log.info("Evicted stale player: %s (seat %d)", player.name, player.seat)
                    await self.broadcast({
                        "type": "player_left",
                        "data": {"id": tok, "name": player.name},
                    })


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Strawberry Tarneeb Server")
manager = ConnectionManager()


@app.on_event("startup")
async def startup_event():
    """Launch background cleanup task."""
    asyncio.create_task(manager.cleanup_stale_connections())
    log.info("Strawberry Tarneeb server started on port 8000")


@app.get("/health")
async def health():
    """Simple health-check endpoint."""
    game = manager.game
    return {
        "status": "ok",
        "phase": game.phase,
        "round": game.round,
        "players": [p.to_dict() for p in game.players.values()],
    }


@app.websocket("/ws/{player_token}")
async def websocket_endpoint(ws: WebSocket, player_token: str):
    """
    Main WebSocket endpoint.
    player_token identifies the client. Use a stable UUID per device/session
    so reconnects are handled transparently.
    """
    player = await manager.connect(ws, player_token)

    try:
        # Send current state immediately on connect/reconnect
        state = manager.game.public_state(for_token=player_token)
        await ws.send_json({"type": "game_state", "data": state})

        async for raw_msg in ws.iter_text():
            await manager.handle_message(player_token, raw_msg)

    except WebSocketDisconnect:
        manager.disconnect(player_token)
        await manager.broadcast({
            "type": "player_disconnected",
            "data": {"id": player_token, "name": player.name},
        })
    except Exception as exc:
        log.exception("Unhandled error for token %s: %s", player_token, exc)
        manager.disconnect(player_token)


# ---------------------------------------------------------------------------
# Static files — MUST be mounted AFTER all API/WS routes
# ---------------------------------------------------------------------------
app.mount("/", StaticFiles(directory=".", html=True), name="static")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=False)
