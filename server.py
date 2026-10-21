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
import os
import random
import time
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).parent.resolve()

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
        self.is_bot: bool = False
        self.connected_at: float = time.time()
        self.disconnected_at: Optional[float] = None

    @property
    def is_connected(self) -> bool:
        return self.is_bot or (self.ws is not None)

    @property
    def id(self) -> str:
        return self.token

    @property
    def is_spectator(self) -> bool:
        return self.role == "spectator"

    @is_spectator.setter
    def is_spectator(self, val: bool):
        self.role = "spectator" if val else "player"

    def to_dict(self, include_hand: bool = False) -> Dict:
        d = {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "is_spectator": self.is_spectator,
            "seat": self.seat,
            "connected": self.is_connected,
            "card_count": len(self.hand),
            "is_bot": self.is_bot,
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
        self.round_history: List[Dict] = []  # past rounds match history

    # ------------------------------------------------------------------
    # Seat / roster helpers
    # ------------------------------------------------------------------

    def seated_tokens_in_order(self, starting_seat: int = 0) -> List[str]:
        """Return token list starting from given seat, rotating to the right (counter-clockwise)."""
        tokens = []
        for i in range(MAX_PLAYERS):
            seat = (starting_seat - i + MAX_PLAYERS) % MAX_PLAYERS
            if self.seats[seat]:
                tokens.append(self.seats[seat])
        return tokens

    def all_seats_filled(self) -> bool:
        return all(s is not None for s in self.seats)

    def player_right_of(self, seat: int) -> int:
        """Right-hand (counter-clockwise) next seat in Tarneeb."""
        return (seat - 1 + MAX_PLAYERS) % MAX_PLAYERS

    def player_left_of(self, seat: int) -> int:
        """Left-hand (clockwise) seat in Tarneeb."""
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
        elif len(self.trick_cards) >= MAX_PLAYERS:
            current_turn = None
        else:
            current_turn = self.token_at_seat(self.current_turn_seat)

        current_trick = min(13, sum(self.tricks_taken.values()) + 1)

        state = {
            "phase": self.phase,
            "round": self.round,
            "dealer": self.token_at_seat(self.dealer_seat),
            "current_turn": current_turn,
            "current_trick": current_trick,
            "bids": dict(self.bids),
            "tricks_taken": dict(self.tricks_taken),
            "trick_cards": list(self.trick_cards),
            "led_suit": self.led_suit,
            "scores": {k: v for k, v in self.scores.items()},
            "round_scores": {k: v for k, v in self.round_scores.items()},
            "trump_suit": self.trump_suit,
            "players": [p.to_dict() for p in self.players.values()],
            "history": list(self.round_history),
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
        self._bot_turn_in_progress: bool = False

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
        """Send a message to every connected client safely."""
        for token, player in list(self.game.players.items()):
            if token == exclude:
                continue
            if player and player.is_connected and player.ws:
                try:
                    await player.ws.send_json(msg)
                except Exception as exc:
                    log.warning("broadcast to %s failed, marking disconnected: %s", token, exc)
                    player.ws = None
                    player.disconnected_at = time.time()

    async def broadcast_game_state(self):
        """
        Send a personalised game_state to every connected client.
        Safely iterate over copies and discard dead sockets silently.
        """
        for token, player in list(self.game.players.items()):
            if player and player.is_connected and player.ws:
                try:
                    state = self.game.public_state(for_token=token)
                    await player.ws.send_json({"type": "game_state", "data": state})
                except Exception as exc:
                    log.warning("broadcast_game_state to %s failed, marking disconnected: %s", token, exc)
                    player.ws = None
                    player.disconnected_at = time.time()

        # Check and trigger bot turn if active
        self._trigger_bot_turn_if_needed()

    # ------------------------------------------------------------------
    # Message routing
    # ------------------------------------------------------------------

    async def handle_message(self, token: str, raw: str):
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            await self.send_to(token, {"type": "error", "data": {"message": "Invalid JSON"}})
            return

        mtype = str(msg.get("type", "")).strip().lower()
        data = msg.get("data")
        if data is None or not isinstance(data, dict):
            data = msg

        handlers = {
            "join": self._handle_join,
            "bid": self._handle_bid,
            "play_card": self._handle_play_card,
            "request_state": self._handle_request_state,
            "switch_role": self._handle_switch_role,
            "change_role": self._handle_switch_role,
            "leave": self._handle_leave,
            "logout": self._handle_leave,
            "leave_seat": self._handle_leave_seat,
            "leave_game": self._handle_leave_seat,
            "ping": self._handle_ping,
            "set_dealer": self._handle_set_dealer,
            "change_dealer": self._handle_set_dealer,
            "rotate_dealer": self._handle_set_dealer,
            "fill_bots": self._handle_fill_bots,
            "fill_table_with_bots": self._handle_fill_bots,
            "remove_bots": self._handle_remove_bots,
        }

        handler = handlers.get(mtype)
        if handler:
            try:
                await handler(token, data)
            except Exception as exc:
                import traceback
                print(f"[ERROR] Handler '{mtype}' for token {token} failed:")
                traceback.print_exc()
                await self.send_to(token, {"type": "error", "data": {"message": f"Server error handling {mtype}"}})
        else:
            await self.send_to(token, {"type": "error", "data": {"message": f"Unknown message type: {mtype}"}})

    # ------------------------------------------------------------------
    # Handler: join
    # ------------------------------------------------------------------

    async def _handle_join(self, token: str, data: Dict):
        game = self.game
        player = game.players.get(token)
        if not player:
            return

        # Allow roster pick or custom name
        chosen_name = (data.get("name") or "").strip() or (data.get("roster_pick") or "").strip()
        if not chosen_name:
            chosen_name = f"Player {len(game.players)}"

        # Handle duplicate player names gracefully:
        # If a connection claims a name that is already in active_players or spectators,
        # replace the old WebSocket connection instead of raising a KeyError or mutation error.
        for old_tok, old_player in list(game.players.items()):
            if old_tok != token and old_player.name and old_player.name.lower() == chosen_name.lower():
                log.info("Player '%s' connecting with new token %s (replacing old %s)", chosen_name, token, old_tok)
                if old_player.ws:
                    try:
                        await old_player.ws.close(code=1000, reason="Replaced by new session")
                    except Exception:
                        pass
                    old_player.ws = None

                # Transfer seat, role, hand, and scores from old player to new player
                if old_player.seat is not None:
                    player.seat = old_player.seat
                    game.seats[old_player.seat] = token
                    player.role = "player"
                    player.is_spectator = False
                else:
                    player.seat = None
                    player.role = old_player.role
                    player.is_spectator = old_player.is_spectator

                player.hand = list(old_player.hand)

                if old_tok in game.scores:
                    game.scores[token] = game.scores.pop(old_tok)
                if old_tok in game.round_scores:
                    game.round_scores[token] = game.round_scores.pop(old_tok)
                if old_tok in game.tricks_taken:
                    game.tricks_taken[token] = game.tricks_taken.pop(old_tok)
                if old_tok in game.bids:
                    game.bids[token] = game.bids.pop(old_tok)

                for play in game.trick_cards:
                    if play.get("player_id") == old_tok:
                        play["player_id"] = token

                if game.bid_order:
                    game.bid_order = [token if t == old_tok else t for t in game.bid_order]

                game.players.pop(old_tok, None)
                break

        player.name = chosen_name

        # Check explicit spectator request
        role_req = str(data.get("role", "")).strip().lower()
        as_spectator = bool(data.get("as_spectator")) or bool(data.get("is_spectator")) or (role_req == "spectator")

        if as_spectator:
            # Explicit spectator request
            if player.seat is not None:
                game.seats[player.seat] = None
                player.seat = None
            player.role = "spectator"
            player.is_spectator = True
            player.hand = []
            log.info("%s joined explicitly as spectator", player.name)
        else:
            # Active player request (role == 'player' or not spectator)
            if player.seat is not None:
                # Already seated
                player.role = "player"
                player.is_spectator = False
                log.info("%s confirmed active player at seat %d", player.name, player.seat)
            else:
                # Check for an empty seat among the 4 active seats (0 to 3)
                empty_seat = next((i for i, s in enumerate(game.seats) if s is None), None)

                # In lobby, if all seats seem taken, check if any seated player is disconnected
                if empty_seat is None and game.phase == "lobby":
                    empty_seat = next((i for i, s in enumerate(game.seats) if s and not game.players.get(s, Player("", "", None, "")).is_connected), None)
                    if empty_seat is not None:
                        old_tok = game.seats[empty_seat]
                        old_p = game.players.get(old_tok)
                        if old_p:
                            old_p.seat = None
                            old_p.role = "spectator"
                            old_p.is_spectator = True
                        game.seats[empty_seat] = None

                if empty_seat is not None:
                    # Assign the player to the next open seat (Seat 1 to 4)
                    player.seat = empty_seat
                    player.role = "player"
                    player.is_spectator = False
                    game.seats[empty_seat] = token
                    log.info("%s assigned active seat %d (Seat %d)", player.name, empty_seat, empty_seat + 1)
                else:
                    # All 4 active seats are already occupied
                    player.role = "spectator"
                    player.is_spectator = True
                    log.info("%s table full, placed as spectator", player.name)
                    await self.send_to(token, {
                        "type": "error",
                        "data": {
                            "message": "All 4 active seats are already occupied. You have joined as a Spectator.",
                            "code": "TABLE_FULL"
                        }
                    })

        # Broadcast updated table state with the player seated in their active position
        await self.broadcast({
            "type": "player_joined",
            "data": {"id": token, "name": player.name, "role": player.role, "is_spectator": player.is_spectator, "seat": player.seat},
        })
        await self.broadcast_game_state()

        # If client requested to fill table with bots on join:
        if data.get("fill_bots"):
            await self._handle_fill_bots(token, data)
        elif game.phase == "lobby" and game.all_seats_filled() and game.round == 0:
            # When 4 active players are seated in lobby, prompt for Round 1 dealer:
            game.phase = "dealer_select"
            await self.broadcast({
                "type": "prompt_select_dealer",
                "data": {
                    "message": "Who is dealing Round 1?",
                    "seated_players": [
                        {"seat": i, "name": game.players[s].name, "id": s}
                        for i, s in enumerate(game.seats) if s and s in game.players
                    ]
                }
            })
            await self.broadcast_game_state()

    # ------------------------------------------------------------------
    # Handler: ping / heartbeat
    # ------------------------------------------------------------------

    async def _handle_ping(self, token: str, data: Dict):
        await self.send_to(token, {"type": "pong"})

    # ------------------------------------------------------------------
    # Handler: set_dealer / change_dealer
    # ------------------------------------------------------------------

    async def _handle_set_dealer(self, token: str, data: Dict):
        game = self.game
        seat = data.get("seat")
        player_id = data.get("player_id")
        if seat is None and player_id:
            seat = game.seat_of_token(player_id)
        if seat is None:
            # Rotate to next seat in order (counter-clockwise / to player's physical right)
            seat = game.player_right_of(game.dealer_seat)

        try:
            chosen_seat = int(seat)
        except (ValueError, TypeError):
            return
        if 0 <= chosen_seat < MAX_PLAYERS:
            game.dealer_seat = chosen_seat
            dealer_tok = game.seats[game.dealer_seat]
            dealer_name = game.players[dealer_tok].name if dealer_tok and dealer_tok in game.players else f"Seat {game.dealer_seat + 1}"
            log.info("Dealer updated: seat %d (%s)", game.dealer_seat, dealer_name)
            await self.broadcast({
                "type": "dealer_updated",
                "data": {"dealer_seat": game.dealer_seat, "dealer_name": dealer_name}
            })
            if game.phase in ("lobby", "dealer_select") and game.all_seats_filled():
                await self._start_round(dealer_seat_override=chosen_seat)
            else:
                await self.broadcast_game_state()



    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Match Termination & Reset
    # ------------------------------------------------------------------

    async def terminate_match(self, leaving_player_name: str, reason: str = ""):
        game = self.game
        if not reason:
            reason = f"{leaving_player_name} left the game. The active match has ended."
        log.info("Match terminated! Reason: %s", reason)

        # Snapshot final scores and history before destruction
        final_scores = {p.name: game.scores.get(tok, 0) for tok, p in game.players.items() if p.name}
        final_history = list(game.round_history)
        round_reached = game.round

        # Broadcast match_terminated event to all connected clients
        await self.broadcast({
            "type": "match_terminated",
            "data": {
                "reason": reason,
                "leaving_player": leaving_player_name,
                "scores": final_scores,
                "history": final_history,
                "round": round_reached
            }
        })

        # Destroy active game state on server
        game.phase = "lobby"
        game.round = 0
        game.dealer_seat = 0
        game.current_turn_seat = 0
        game.bids.clear()
        game.tricks_taken.clear()
        game.trick_cards.clear()
        game.led_suit = None
        game.scores.clear()
        game.round_scores.clear()
        game.round_history.clear()
        game.bid_order.clear()
        game.bidding_idx = 0

        # Reset players and clear bots
        for tok, p in list(game.players.items()):
            if getattr(p, "is_bot", False):
                game.players.pop(tok, None)
            else:
                p.seat = None
                p.role = "spectator"
                p.is_spectator = True
                p.hand = []
        game.seats = [None, None, None, None]
        await self.broadcast_game_state()

    # ------------------------------------------------------------------
    # Handler: leave / logout / leave_seat
    # ------------------------------------------------------------------

    async def _handle_leave_seat(self, token: str, data: Dict):
        game = self.game
        player = game.players.get(token)
        if not player:
            return

        old_seat = player.seat
        old_name = player.name or "Player"

        if old_seat is not None and 0 <= old_seat < MAX_PLAYERS:
            is_active_game = (game.phase in ("bidding", "playing", "round_end", "dealer_select") or game.round > 0)
            if is_active_game:
                await self.terminate_match(leaving_player_name=old_name, reason=f"{old_name} left the game. The active match has ended.")
                return
            else:
                game.seats[old_seat] = None
                player.seat = None
                player.role = "spectator"
                player.is_spectator = True
                player.hand = []

                await self.send_to(token, {
                    "type": "role_changed",
                    "data": {"role": "spectator", "seat": None, "message": "You moved to spectator."}
                })
                await self.broadcast({
                    "type": "player_left",
                    "data": {"id": token, "name": old_name}
                })
                await self.broadcast_game_state()
        else:
            await self.send_to(token, {
                "type": "role_changed",
                "data": {"role": "spectator", "seat": None, "message": "You are currently a spectator."}
            })

    async def _handle_leave(self, token: str, data: Dict):
        game = self.game
        player = game.players.get(token)
        if not player:
            return

        old_name = player.name
        if player.seat is not None:
            # If leaving during an active game, replace seat with bot
            await self._handle_leave_seat(token, data)
        player.name = ""

        log.info("Player '%s' (%s) logged out", old_name, token)
        await self.broadcast({
            "type": "player_left",
            "data": {"id": token, "name": old_name},
        })
        await self.broadcast_game_state()

    # ------------------------------------------------------------------
    # Handler: switch_role / change_role
    # ------------------------------------------------------------------

    async def _handle_switch_role(self, token: str, data: Dict):
        game = self.game
        player = game.players.get(token)
        if not player:
            return

        if player.role == "player":
            # Active player moving to spectator -> use _handle_leave_seat to replace with bot if active
            await self._handle_leave_seat(token, data)
            return
        else:
            # Spectator clicks switch role -> if there is an open seat (< 4 players), assign to active seat
            empty_seat = next((i for i, s in enumerate(game.seats) if s is None), None)
            if empty_seat is None and game.phase == "lobby":
                empty_seat = next((i for i, s in enumerate(game.seats) if s and not game.players.get(s, Player("", "", None, "")).is_connected), None)
                if empty_seat is not None:
                    old_tok = game.seats[empty_seat]
                    old_p = game.players.get(old_tok)
                    if old_p:
                        old_p.seat = None
                        old_p.role = "spectator"
                        old_p.is_spectator = True
                    game.seats[empty_seat] = None

            if empty_seat is not None:
                player.seat = empty_seat
                player.role = "player"
                player.is_spectator = False
                game.seats[empty_seat] = token
                log.info("%s switched to active seat %d (Seat %d)", player.name, empty_seat, empty_seat + 1)
                await self.send_to(token, {
                    "type": "role_changed",
                    "data": {"role": "player", "seat": empty_seat, "message": f"You took Seat {empty_seat + 1}!"}
                })
            else:
                await self.send_to(token, {
                    "type": "error",
                    "data": {"message": "All 4 table seats are full! Cannot switch to active player.", "code": "TABLE_FULL"}
                })
                return

        await self.broadcast({
            "type": "player_joined",
            "data": {"id": token, "name": player.name, "role": player.role, "is_spectator": player.is_spectator, "seat": player.seat},
        })
        await self.broadcast_game_state()

        # When 4 active players are seated in lobby, prompt for Round 1 dealer:
        if game.phase == "lobby" and game.all_seats_filled() and game.round == 0:
            game.phase = "dealer_select"
            await self.broadcast({
                "type": "prompt_select_dealer",
                "data": {
                    "message": "Who is dealing Round 1?",
                    "seated_players": [
                        {"seat": i, "name": game.players[s].name, "id": s}
                        for i, s in enumerate(game.seats) if s and s in game.players
                    ]
                }
            })
            await self.broadcast_game_state()

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

        if len(game.trick_cards) >= MAX_PLAYERS:
            await self.send_to(token, {"type": "error", "data": {"message": "Trick is resolving. Please wait."}})
            return

        expected_token = game.token_at_seat(game.current_turn_seat)
        if token != expected_token:
            await self.send_to(token, {"type": "error", "data": {"message": "Not your turn to play."}})
            return

        player = game.players.get(token)
        if not player:
            return

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

        log.info("%s played %s (trick cards: %d)", player.name, card, len(game.trick_cards))

        # Move to next seat (to the right in Tarneeb)
        game.current_turn_seat = self.game.player_right_of(game.current_turn_seat)

        # Broadcast the updated table state immediately on each play
        await self.broadcast_game_state()

        if len(game.trick_cards) == MAX_PLAYERS:
            # All 4 players have played: resolve trick after 1.5s pause
            asyncio.create_task(self._resolve_trick())

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
    # Handler: request_state
    # ------------------------------------------------------------------

    async def _handle_request_state(self, token: str, data: Dict):
        state = self.game.public_state(for_token=token)
        await self.send_to(token, {"type": "game_state", "data": state})

    # ------------------------------------------------------------------
    # Game flow
    # ------------------------------------------------------------------

    async def _start_round(self, dealer_seat_override: Optional[int] = None):
        game = self.game

        # Guard: only allow starting from lobby, dealer_select (round 1) or round_end (subsequent rounds)
        if game.phase not in ("lobby", "dealer_select", "round_end"):
            log.warning("Attempted to start round while phase is '%s', ignoring", game.phase)
            return

        # Verify all 4 seats are valid and present in players dictionary
        if not game.all_seats_filled():
            log.warning("Cannot start round: not all 4 seats are filled (%s)", game.seats)
            return

        for seat_idx, tok in enumerate(game.seats):
            if not tok or tok not in game.players:
                log.error("Invalid seat %d token: %s", seat_idx, tok)
                return

        # Immediate state transition guard so concurrent calls cannot re-enter
        game.phase = "starting"
        game.round += 1
        log.info("=== Starting Round %d ===", game.round)

        # Dealer rotation:
        # In Round 1: use dealer_seat_override if provided, else keep current game.dealer_seat
        # In subsequent rounds: dealer automatically advances to the next player in order!
        if game.round == 1:
            if dealer_seat_override is not None:
                game.dealer_seat = dealer_seat_override
        else:
            # Dealer advances counter-clockwise to the next player's physical right!
            game.dealer_seat = game.player_right_of(game.dealer_seat)

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
        for i in range(MAX_PLAYERS):
            tok = game.seats[i]
            if tok and tok in game.players:
                game.players[tok].hand = sorted(
                    deck[i * 13:(i + 1) * 13],
                    key=lambda c: (card_suit(c), card_rank_value(c))
                )

        if game.round == 1:
            # No bidding in round 1
            game.phase = "playing"
            # First to play is RIGHT of dealer
            first_seat = game.player_right_of(game.dealer_seat)
            game.current_turn_seat = first_seat
        else:
            # Bidding starts RIGHT of dealer
            game.phase = "bidding"
            first_bid_seat = game.player_right_of(game.dealer_seat)
            game.bid_order = game.seated_tokens_in_order(first_bid_seat)

        await self.broadcast_game_state()

    async def _start_playing_phase(self):
        game = self.game
        game.phase = "playing"
        # First to play is RIGHT of dealer
        game.current_turn_seat = game.player_right_of(game.dealer_seat)
        game.led_suit = None
        game.trick_cards = []
        log.info("Playing phase started. Bids: %s", game.bids)
        await self.broadcast_game_state()

    async def _resolve_trick(self):
        game = self.game
        led = game.led_suit
        winner_play = trick_winner(game.trick_cards, led)
        winner_token = winner_play["player_id"]
        winner_name = game.players[winner_token].name if winner_token in game.players else "Winner"

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
            "winning_card": winner_play["card"],
            "cards": list(game.trick_cards),
            "special_kh": special_kh_token,
            "special_ah": special_ah_token,
        }

        # Snappy pause so players can see the completed trick
        await asyncio.sleep(0.75)

        await self.broadcast({"type": "trick_complete", "data": trick_summary})

        # Clear the table and reset led suit
        game.trick_cards = []
        game.led_suit = None

        # Winner leads next trick
        winner_seat = game.seat_of_token(winner_token)
        if winner_seat is not None:
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
                    # 0-Bid Penalty: If a player bids 0 and takes at least 1 trick, apply -5 point penalty
                    round_score = SCORE_BID_0_MADE if tricks == 0 else SCORE_BID_0_FAILED
                elif bid == 7:
                    # Bid 7: +14 if made (>= 7 tricks), -14 if failed (< 7 tricks)
                    round_score = SCORE_BID_7_MADE if tricks >= 7 else SCORE_BID_7_FAILED
                else:
                    # Bids 2-6 and 8-13: +Bid if made (tricks >= bid), -Bid if failed (tricks < bid)
                    round_score = bid if tricks >= bid else -bid

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
            "dealer_seat": game.dealer_seat,
            "dealer_name": game.players[game.seats[game.dealer_seat]].name if game.seats[game.dealer_seat] in game.players else f"Seat {game.dealer_seat + 1}",
            "tricks_taken": dict(game.tricks_taken),
            "bids": dict(game.bids),
            "round_scores": dict(game.round_scores),
            "cumulative_scores": dict(game.scores),
            "special_kh": special_kh_token,
            "special_ah": special_ah_token,
        }
        game.round_history.append(dict(round_summary))

        await self.broadcast({"type": "round_complete", "data": round_summary})
        await self.broadcast_game_state()

        if game.round >= TOTAL_ROUNDS:
            await self._end_game()
        else:
            # Snappy delay then start next round
            await asyncio.sleep(2.0)
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
                if getattr(player, "is_bot", False):
                    continue
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

    # ------------------------------------------------------------------
    # Bot automation & Solo simulation
    # ------------------------------------------------------------------

    async def _handle_fill_bots(self, token: str, data: Dict):
        game = self.game
        BOT_NAMES = ["Bot Hosam", "Bot Furjani", "Bot Shiba", "Bot Ahmed", "Bot Naas", "Bot Zentani"]
        existing_names = {p.name.strip().lower() for p in game.players.values()}
        available_names = [n for n in BOT_NAMES if n.lower() not in existing_names]

        added_bots = []
        for seat_idx in range(MAX_PLAYERS):
            if game.seats[seat_idx] is None:
                bot_name = available_names.pop(0) if available_names else f"Bot {seat_idx + 1}"
                bot_token = f"bot_{uuid.uuid4().hex[:8]}"
                bot_p = Player(token=bot_token, name=bot_name, seat=seat_idx, role="player")
                bot_p.is_bot = True
                game.players[bot_token] = bot_p
                game.seats[seat_idx] = bot_token
                added_bots.append(bot_p)
                log.info("🤖 Seated %s at seat %d (%s)", bot_name, seat_idx, bot_token)

        for b in added_bots:
            await self.broadcast({
                "type": "player_joined",
                "data": {"id": b.token, "name": b.name, "role": b.role, "is_spectator": False, "seat": b.seat, "is_bot": True},
            })

        # Start Round 1 automatically if all 4 seats are filled
        if game.all_seats_filled() and game.round == 0:
            log.info("Table full with bots; auto-starting Round 1 with dealer seat %d", game.dealer_seat)
            await self._start_round(dealer_seat_override=game.dealer_seat)
        else:
            await self.broadcast_game_state()

    async def _handle_remove_bots(self, token: str, data: Dict):
        game = self.game
        removed = []
        for seat_idx, tok in enumerate(list(game.seats)):
            if tok:
                p = game.players.get(tok)
                if p and getattr(p, "is_bot", False):
                    game.seats[seat_idx] = None
                    game.players.pop(tok, None)
                    removed.append(p.name)

        if removed:
            log.info("Removed bots: %s", ", ".join(removed))
            if game.phase != "lobby":
                game.phase = "lobby"
                game.round = 0
                game.trick_cards = []
                game.led_suit = None
                game.bids = {}
                game.tricks_taken = {}
                for p in game.players.values():
                    p.hand = []
            await self.broadcast({
                "type": "bots_removed",
                "data": {"removed": removed}
            })
            await self.broadcast_game_state()

    def _trigger_bot_turn_if_needed(self):
        if self._bot_turn_in_progress:
            return
        game = self.game
        if game.phase == "bidding":
            if game.bidding_idx < len(game.bid_order):
                expected_token = game.bid_order[game.bidding_idx]
                player = game.players.get(expected_token)
                if player and getattr(player, "is_bot", False):
                    self._bot_turn_in_progress = True
                    asyncio.create_task(self._run_bot_turn(expected_token, "bid"))
        elif game.phase == "playing":
            if len(game.trick_cards) >= MAX_PLAYERS:
                return  # Trick resolution in progress
            expected_token = game.token_at_seat(game.current_turn_seat)
            if not expected_token:
                return
            player = game.players.get(expected_token)
            if player and getattr(player, "is_bot", False):
                self._bot_turn_in_progress = True
                asyncio.create_task(self._run_bot_turn(expected_token, "play"))

    async def _run_bot_turn(self, token: str, action: str):
        try:
            # Fast, snappy thinking pause: 0.35 to 0.55 seconds
            await asyncio.sleep(random.uniform(0.35, 0.55))
            game = self.game
            player = game.players.get(token)
            if not player or not getattr(player, "is_bot", False):
                return

            if action == "bid" and game.phase == "bidding":
                if game.bidding_idx < len(game.bid_order) and game.bid_order[game.bidding_idx] == token:
                    bid_amount = self._calculate_bot_bid(player)
                    log.info("🤖 Bot %s bids %d", player.name, bid_amount)
                    await self._handle_bid(token, {"amount": bid_amount})
            elif action == "play" and game.phase == "playing":
                if len(game.trick_cards) < MAX_PLAYERS and game.token_at_seat(game.current_turn_seat) == token:
                    card_to_play = self._choose_bot_card(player)
                    if card_to_play:
                        log.info("🤖 Bot %s plays %s", player.name, card_to_play)
                        await self._handle_play_card(token, {"card": card_to_play})
        except Exception as exc:
            log.exception("Error in bot turn for %s: %s", token, exc)
        finally:
            self._bot_turn_in_progress = False
            self._trigger_bot_turn_if_needed()

    def _choose_bot_card(self, player: Player) -> Optional[str]:
        if not player.hand:
            return None

        # Filter all strictly legal cards
        legal_cards = [c for c in player.hand if self._validate_play(player, c)[0]]
        if not legal_cards:
            legal_cards = list(player.hand)

        game = self.game
        # Case 1: Leading the trick
        if not game.trick_cards or not game.led_suit:
            non_trumps = [c for c in legal_cards if card_suit(c) != TRUMP_SUIT]
            high_non_trumps = [c for c in non_trumps if card_rank(c) in ("A", "K", "Q")]
            if high_non_trumps:
                return max(high_non_trumps, key=card_rank_value)
            elif non_trumps:
                return min(non_trumps, key=card_rank_value)
            return max(legal_cards, key=card_rank_value)

        # Case 2: Following a led suit
        led = game.led_suit
        following = [c for c in legal_cards if card_suit(c) == led]
        if following:
            cur_winner = trick_winner(game.trick_cards, led)
            win_card = cur_winner["card"]
            win_suit = card_suit(win_card)

            # If current winner cut with trump, led suit cannot win
            if win_suit == TRUMP_SUIT and led != TRUMP_SUIT:
                return min(following, key=card_rank_value)

            win_val = card_rank_value(win_card)
            winning_cards = [c for c in following if card_rank_value(c) > win_val]
            if winning_cards:
                return min(winning_cards, key=card_rank_value)
            return min(following, key=card_rank_value)

        # Case 3: Void in led suit (trump cut or slough)
        trumps = [c for c in legal_cards if card_suit(c) == TRUMP_SUIT]
        cur_winner = trick_winner(game.trick_cards, led)
        win_card = cur_winner["card"]
        win_suit = card_suit(win_card)

        if win_suit == TRUMP_SUIT:
            win_trump_val = card_rank_value(win_card)
            over_trumps = [c for c in trumps if card_rank_value(c) > win_trump_val]
            if over_trumps:
                return min(over_trumps, key=card_rank_value)
        else:
            if trumps:
                return min(trumps, key=card_rank_value)

        # Slough lowest non-trump, or lowest card in hand
        non_trumps = [c for c in legal_cards if card_suit(c) != TRUMP_SUIT]
        if non_trumps:
            return min(non_trumps, key=card_rank_value)
        return min(legal_cards, key=card_rank_value)

    def _calculate_bot_bid(self, player: Player) -> int:
        trumps = [c for c in player.hand if card_suit(c) == TRUMP_SUIT]
        aces = [c for c in player.hand if card_rank(c) == "A"]
        kings = [c for c in player.hand if card_rank(c) == "K"]

        trump_count = len(trumps)
        high_trumps = sum(1 for c in trumps if card_rank(c) in ("A", "K", "Q", "J"))

        est = len(aces) + int(len(kings) * 0.6) + max(0, trump_count - 3) + high_trumps * 0.5
        est_tricks = int(round(est))

        # Tarneeb bidding rules:
        # Bid 0 is allowed (+5/-5).
        # Bid 1 is PROHIBITED.
        # Bids 2-13 are allowed.
        if est_tricks <= 0 and len(aces) == 0 and trump_count <= 1:
            return 0
        if est_tricks <= 1:
            return 2  # Bid 1 prohibited, minimum positive bid is 2
        bid = min(13, max(2, est_tricks))
        if bid == 1:
            bid = 2
        return bid


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


@app.get("/healthz")
def health():
    return {"status": "ok"}


@app.get("/health")
async def health_detail():
    """Detailed health-check endpoint."""
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
            try:
                await manager.handle_message(player_token, raw_msg)
            except Exception as e:
                import traceback
                print(f"[ERROR] Exception processing message from {player_token}: {e}")
                traceback.print_exc()
                try:
                    await ws.send_json({"type": "error", "data": {"message": "Server error processing message."}})
                except Exception:
                    pass

    except WebSocketDisconnect:
        is_seated_active = (player and player.seat is not None and not getattr(player, "is_bot", False))
        is_active_game = (manager.game.phase in ("bidding", "playing", "round_end", "dealer_select") or manager.game.round > 0)
        manager.disconnect(player_token)
        if is_seated_active and is_active_game:
            await manager.terminate_match(leaving_player_name=player.name, reason=f"{player.name} disconnected. The active match has ended.")
        else:
            await manager.broadcast({
                "type": "player_disconnected",
                "data": {"id": player_token, "name": player.name},
            })
    except Exception as exc:
        import traceback
        print(f"[ERROR] WebSocket fatal error for token {player_token}: {exc}")
        traceback.print_exc()
        manager.disconnect(player_token)


# ---------------------------------------------------------------------------
# Standalone Scoreboard Route (Pure Client-Side Scorekeeper)
# ---------------------------------------------------------------------------
@app.get("/scoreboard")
@app.get("/scoreboard.html")
async def serve_standalone_scoreboard():
    """
    Serve clean, static, isolated scoreboard without websockets, bots, or cards.
    Operates 100% client-side with localStorage.
    """
    scoreboard_file = BASE_DIR / "scoreboard.html"
    if scoreboard_file.exists():
        return FileResponse(str(scoreboard_file), media_type="text/html")
    fallback = Path("scoreboard.html").resolve()
    if fallback.exists():
        return FileResponse(str(fallback), media_type="text/html")
    raise HTTPException(status_code=404, detail="scoreboard.html not found")


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
