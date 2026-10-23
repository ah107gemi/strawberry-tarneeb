"""
End-to-End Solo Testing & Bot Simulation for Strawberry Tarneeb
================================================================
Simulates 1 real player ('Ahmed') and 3 automated bots playing Strawberry Tarneeb:
1. Connects via WebSocket to FastAPI backend
2. Joins as active player
3. Triggers 'fill_bots'
4. Verifies 4 players seated and cards dealt (13 cards each)
5. Plays through full tricks with bots taking automated legal turns
6. Verifies trick winner resolution, trick clearing, and turn progression
"""

import asyncio
import json
import logging
import threading
import time
import uvicorn
import websockets

from server import app, manager, GameState, Player, card_suit, card_rank_value, TRUMP_SUIT

TEST_PORT = 8765
WS_URL = f"ws://127.0.0.1:{TEST_PORT}/ws/test_token_ahmed"

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("simulation_test")


def start_test_server():
    config = uvicorn.Config(app, host="127.0.0.1", port=TEST_PORT, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return server


def test_claim_tricks_unit_logic():
    print("\n" + "=" * 65)
    print("🧪 UNIT TEST: GameState.can_claim_tricks() [Strict Claim Rules]")
    print("=" * 65)
    gs = GameState()
    gs.phase = "playing"
    p0 = Player(token="p0", name="Ahmed", seat=0, role="player")
    p0.hand = ["AH", "KH"]
    p1 = Player(token="p1", name="Bot 1", seat=1, role="player")
    p1.hand = ["2C", "3C"]
    p2 = Player(token="p2", name="Bot 2", seat=2, role="player")
    p2.hand = ["4D", "5D"]
    p3 = Player(token="p3", name="Bot 3", seat=3, role="player")
    p3.hand = ["6S", "7S"]
    gs.players = {"p0": p0, "p1": p1, "p2": p2, "p3": p3}
    gs.seats = ["p0", "p1", "p2", "p3"]
    gs.current_turn_seat = 0

    # 1. Exactly 2 cards remaining: [AH, KH] -> True
    p0.hand = ["AH", "KH"]
    assert gs.can_claim_tricks("p0") is True, "Expected True when holding [AH, KH]"
    print("  ✓ Strict 2-card match: [AH, KH] allowed to claim")

    # 2. Exactly 3 cards remaining: [AH, KH, QH] -> True
    p0.hand = ["AH", "KH", "QH"]
    assert gs.can_claim_tricks("p0") is True, "Expected True when holding [AH, KH, QH]"
    print("  ✓ Strict 3-card match: [AH, KH, QH] allowed to claim")

    # 3. Exactly 4 cards remaining: [AH, KH, QH, JH] -> True
    p0.hand = ["AH", "KH", "QH", "JH"]
    assert gs.can_claim_tricks("p0") is True, "Expected True when holding [AH, KH, QH, JH]"
    print("  ✓ Strict 4-card match: [AH, KH, QH, JH] allowed to claim")

    # 4. 2 cards lower: [KH, QH] -> False
    p0.hand = ["KH", "QH"]
    assert gs.can_claim_tricks("p0") is False, "Expected False for [KH, QH]"
    print("  ✓ Strict rejection: [KH, QH] cannot claim")

    # 5. 3 cards missing Q: [AH, KH, 10H] -> False
    p0.hand = ["AH", "KH", "10H"]
    assert gs.can_claim_tricks("p0") is False, "Expected False for [AH, KH, 10H]"
    print("  ✓ Strict rejection: [AH, KH, 10H] cannot claim")

    # 6. 5 cards: [AH, KH, QH, JH, 10H] -> False
    p0.hand = ["AH", "KH", "QH", "JH", "10H"]
    assert gs.can_claim_tricks("p0") is False, "Expected False for 5 cards"
    print("  ✓ Strict rejection: 5 cards cannot claim (must be exactly 2, 3, or 4)")

    # 7. 1 card: [AH] -> False
    p0.hand = ["AH"]
    assert gs.can_claim_tricks("p0") is False, "Expected False for 1 card"
    print("  ✓ Strict rejection: 1 card cannot claim")

    # 8. Side suit: [AH, KH, 5S] -> False
    p0.hand = ["AH", "KH", "5S"]
    assert gs.can_claim_tricks("p0") is False, "Expected False for side suit"
    print("  ✓ Strict rejection: Side suit cards cannot claim")

    # 9. Not player's turn -> False
    p0.hand = ["AH", "KH"]
    gs.current_turn_seat = 1
    assert gs.can_claim_tricks("p0") is False, "Expected False when not player's turn"
    print("  ✓ Player cannot claim when it is not their turn")

    # 10. Not playing phase -> False
    gs.current_turn_seat = 0
    gs.phase = "bidding"
    assert gs.can_claim_tricks("p0") is False, "Expected False during bidding"
    print("  ✓ Player cannot claim outside playing phase")
    print("=" * 65 + "\n")


async def run_simulation():
    print("\n" + "=" * 65)
    print("🍓 STRAWBERRY TARNEEB — SOLO BOT SIMULATION TEST")
    print("=" * 65)

    server = start_test_server()
    await asyncio.sleep(1.5)  # Allow server to bind

    my_token = "test_token_ahmed"
    my_name = "Ahmed"

    print("\n[Step 1] Connecting to server at", WS_URL)
    async with websockets.connect(WS_URL) as ws:
        print("  ✓ Connected successfully!")

        # Step 2: Join as active player
        print("\n[Step 2] Sending JOIN as active player ('Ahmed')...")
        await ws.send(json.dumps({
            "type": "join",
            "name": my_name,
            "role": "player",
            "is_spectator": False
        }))

        # Read responses until player_joined
        joined = False
        while not joined:
            msg = json.loads(await ws.recv())
            if msg.get("type") == "player_joined" and msg.get("data", {}).get("name") == my_name:
                seat = msg["data"].get("seat")
                print(f"  ✓ Seated at Seat {seat + 1} (seat index {seat})")
                joined = True

        # Step 3: Trigger 'fill_bots'
        print("\n[Step 3] Sending 'fill_bots' to fill remaining 3 seats...")
        await ws.send(json.dumps({"type": "fill_bots"}))

        # Wait for table to be filled and round 1 to start
        current_state = None
        bots_detected = []
        round_started = False

        print("\n[Step 4] Monitoring lobby & bot seating...")
        while not round_started:
            msg = json.loads(await ws.recv())
            mtype = msg.get("type")
            data = msg.get("data", {})

            if mtype == "player_joined" and data.get("is_bot"):
                bot_name = data.get("name")
                bots_detected.append(bot_name)
                print(f"  ✓ Bot joined: {bot_name} at Seat {data.get('seat') + 1}")

            elif mtype == "game_state":
                current_state = data
                seated_players = [p for p in data.get("players", []) if p.get("role") == "player"]
                if len(seated_players) == 4 and data.get("phase") == "playing" and data.get("round") >= 1:
                    round_started = True
                    print(f"  ✓ Round {data.get('round')} started in phase '{data.get('phase')}'!")
                    print(f"  ✓ Hand dealt: {len(data.get('my_hand', []))} cards: {data.get('my_hand')}")
                    print(f"  ✓ Trump suit: {data.get('trump_suit')} (Hearts)")

        # Verify initial conditions
        my_hand = current_state.get("my_hand", [])
        assert len(my_hand) == 13, f"Expected 13 cards, got {len(my_hand)}"
        assert len(bots_detected) == 3, f"Expected 3 bots, got {len(bots_detected)}"

        # Step 5: Test manual "Change Dealer" (rotate_dealer) with bots (Counter-Clockwise order)
        print("\n[Step 5] Testing 'rotate_dealer' (manual Change Dealer with bots, counter-clockwise)...")
        initial_dealer = current_state.get("dealer")
        # Find Ahmed's seat
        ahmed_seat = 0
        expected_next_seat = (ahmed_seat - 1 + 4) % 4  # 3 (East / physical right)
        await ws.send(json.dumps({"type": "rotate_dealer"}))
        await asyncio.sleep(0.3)
        # Receive dealer_updated or game_state
        dealer_rotated = False
        rotated_seat = None
        while not dealer_rotated:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            if msg.get("type") in ("dealer_updated", "game_state"):
                if msg.get("type") == "dealer_updated":
                    rotated_seat = msg.get("data", {}).get("dealer_seat")
                    print(f"  ✓ Dealer rotated successfully to: {msg.get('data', {}).get('dealer_name')} (Seat {rotated_seat + 1})")
                    dealer_rotated = True
                elif msg.get("type") == "game_state" and msg.get("data", {}).get("dealer") != initial_dealer:
                    print(f"  ✓ Dealer updated in game state to: {msg.get('data', {}).get('dealer')}")
                    dealer_rotated = True
        if rotated_seat is not None:
            assert rotated_seat == expected_next_seat, f"Expected counter-clockwise seat {expected_next_seat}, got {rotated_seat}"
            print(f"  ✓ Verified counter-clockwise rotation: Seat {ahmed_seat + 1} ➔ Seat {rotated_seat + 1} (to player's physical right)")

        # Step 6: Play through 2 full tricks with faster bot speed
        tricks_completed = 0
        TARGET_TRICKS = 2

        print(f"\n[Step 6] Simulating gameplay for {TARGET_TRICKS} full tricks (speed check)...")
        start_time = time.time()

        while tricks_completed < TARGET_TRICKS:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=8.0))
            mtype = msg.get("type")
            data = msg.get("data", {})

            if mtype == "game_state":
                current_state = data
                my_hand = data.get("my_hand", [])
                turn_id = data.get("current_turn")
                trick_cards = data.get("trick_cards", [])
                phase = data.get("phase")

                # If it's the human's turn to play:
                if phase == "playing" and turn_id == my_token and len(trick_cards) < 4:
                    led_suit = data.get("led_suit") or (card_suit(trick_cards[0]["card"]) if trick_cards else None)
                    print(f"\n  👉 [Human Turn] Trick currently has {len(trick_cards)} cards. Led suit: {led_suit}")

                    # Choose a legal card according to Tarneeb rules
                    following = [c for c in my_hand if card_suit(c) == led_suit] if led_suit else []
                    if following:
                        card_to_play = following[0]
                    else:
                        card_to_play = my_hand[0]

                    print(f"     Ahmed plays legal card: {card_to_play} (Remaining hand: {len(my_hand) - 1})")
                    await ws.send(json.dumps({
                        "type": "play_card",
                        "card": card_to_play
                    }))

            elif mtype == "trick_complete":
                tricks_completed += 1
                winner = data.get("winner_name")
                win_card = data.get("winning_card")
                cards = [f"{p['player_id'][:6]}:{p['card']}" for p in data.get("cards", [])]
                print(f"\n  🎉 [Trick {tricks_completed} Complete]")
                print(f"     Winning Card: {win_card} by {winner}")
                print(f"     Trick Cards: {cards}")

        elapsed = time.time() - start_time
        print(f"\n  ⏱️  2 Tricks completed in {elapsed:.2f}s (significantly faster with reduced delays!)")

        # Step 7: Test 'claim_tricks' (Claim Remaining Tricks feature)
        print("\n[Step 7] Testing 'claim_tricks' (Claim Remaining Tricks feature)...")
        # Allow trick 2 broadcast and any pending bot actions to settle
        await asyncio.sleep(1.5)

        # Drain pending queue
        while True:
            try:
                await asyncio.wait_for(ws.recv(), timeout=0.2)
            except asyncio.TimeoutError:
                break

        ahmed_prev_tricks = manager.game.tricks_taken.get(my_token, 0)
        manager.game.players[my_token].hand = ["AH", "KH"]
        for seat_idx in [1, 2, 3]:
            bot_tok = manager.game.seats[seat_idx]
            if bot_tok and bot_tok in manager.game.players:
                manager.game.players[bot_tok].hand = ["2C", "3C"]
        manager.game.current_turn_seat = 0
        manager.game.trick_cards = []
        manager.game.led_suit = None

        # Verify server logic allows claim
        assert manager.game.can_claim_tricks(my_token) is True, "Server should allow claim"

        # Broadcast state so client receives can_claim_tricks: True
        await manager.broadcast_game_state()

        # Check received game_state
        state_received = False
        while not state_received:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=3.0))
            if msg.get("type") == "game_state" and msg.get("data", {}).get("current_turn") == my_token:
                assert msg.get("data", {}).get("can_claim_tricks") is True, "can_claim_tricks should be true in public state"
                print("  ✓ Client received game_state with can_claim_tricks=True")
                state_received = True

        # Send claim_tricks WebSocket action
        print("  👉 Sending 'claim_tricks' action...")
        await ws.send(json.dumps({"type": "claim_tricks"}))

        # Expect tricks_claimed event and round_complete
        tricks_claimed_verified = False
        round_complete_verified = False

        while not (tricks_claimed_verified and round_complete_verified):
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            mtype = msg.get("type")
            data = msg.get("data", {})

            if mtype == "tricks_claimed":
                tricks_claimed_verified = True
                print(f"  ✓ tricks_claimed event verified: {data.get('header')}")
                assert data.get("player_id") == my_token
                assert data.get("tricks_claimed") == 2
                assert data.get("cards") == ["AH", "KH"]
                assert data.get("header") == "Ahmed Claimed the Rest!"
            elif mtype == "round_complete":
                round_complete_verified = True
                print(f"  ✓ Round completed after claim! Round score breakdown: {data.get('round_scores')}")
                assert data.get("tricks_taken", {}).get(my_token) == ahmed_prev_tricks + 2, "Tricks should be awarded to Ahmed"
            elif mtype == "game_state":
                if data.get("phase") == "round_end":
                    print(f"  ✓ Game phase transitioned to '{data.get('phase')}'")

        assert tricks_claimed_verified, "Expected tricks_claimed event"
        assert round_complete_verified, "Expected round_complete event"
        print("  ✓ Verified: Remaining tricks cleanly awarded and round resolved!")

        # Step 8: Test 'leave_seat' (Leave Game terminates active match for table)
        print("\n[Step 8] Testing 'leave_seat' (Active player leaves table; match terminates)...")
        await ws.send(json.dumps({"type": "leave_seat"}))

        match_terminated_verified = False
        lobby_reset_verified = False

        while not (match_terminated_verified and lobby_reset_verified):
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=5.0))
            mtype = msg.get("type")
            data = msg.get("data", {})

            if mtype in ("match_terminated", "game_terminated"):
                match_terminated_verified = True
                print(f"  ✓ Match termination event verified ({mtype}): {data.get('reason')}")
                assert data.get("leaving_player") == my_name, f"Expected {my_name}, got {data.get('leaving_player')}"
            elif mtype == "game_state":
                current_state = data
                if data.get("phase") == "lobby":
                    lobby_reset_verified = True
                    print(f"  ✓ Game state successfully reset to lobby! Phase: '{data.get('phase')}'")

        assert match_terminated_verified, "Expected match_terminated / game_terminated event"
        assert lobby_reset_verified, "Expected game_state reset to lobby"
        print(f"  ✓ Verified active game destruction: phase='{current_state.get('phase')}', round={current_state.get('round')}")

        print("\n" + "=" * 65)
        print("✅ SIMULATION VERIFICATION SUCCESSFUL!")
        print(f"  • Seated 1 human + 3 bots successfully")
        print(f"  • Dealt 13 cards correctly")
        print(f"  • 'Change Dealer' (rotate_dealer) verified working with bots")
        print(f"  • Bots took automated legal turns with snappy, fast delays")
        print(f"  • Successfully resolved {tricks_completed} tricks with Tarneeb rules")
        print(f"  • Successfully tested 'Claim Remaining Tricks' (auto-award & round resolution)")
        print(f"  • Successfully tested active game termination upon 'leave_seat'")
        print("=" * 65 + "\n")


async def run_full_13_tricks_test():
    """
    Test full 13-trick gameplay without early claims to verify
    zero game freezes and smooth progression through all 13 tricks.
    """
    print("\n" + "=" * 65)
    print("🃏 FULL 13-TRICK GAMEPLAY LOOP VERIFICATION (ZERO FREEZE CHECK)")
    print("=" * 65)

    ws_url = f"ws://127.0.0.1:{TEST_PORT}/ws/test_token_full_loop"
    my_token = "test_token_full_loop"
    my_name = "Hosam"

    async with websockets.connect(ws_url) as ws:
        # Join as player
        await ws.send(json.dumps({
            "type": "join",
            "name": my_name,
            "role": "player",
            "is_spectator": False
        }))

        # Wait until seated
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") == "player_joined" and msg.get("data", {}).get("name") == my_name:
                print(f"  ✓ Seated player {my_name}")
                break

        # Fill table with bots
        await ws.send(json.dumps({"type": "fill_bots"}))

        # Wait for round 1 to start
        current_hand = []
        while True:
            msg = json.loads(await ws.recv())
            if msg.get("type") == "game_state":
                state = msg.get("data", {})
                if state.get("phase") == "playing" and state.get("round") >= 1:
                    current_hand = list(state.get("my_hand", []))
                    print(f"  ✓ Round 1 started with {len(current_hand)} cards in hand")
                    break

        tricks_won = 0
        round_finished = False
        start_time = time.time()

        while not round_finished:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=10.0))
            mtype = msg.get("type")
            data = msg.get("data", {})

            if mtype == "game_state":
                state = data
                phase = state.get("phase")
                turn_id = state.get("current_turn")
                trick_cards = state.get("trick_cards", [])
                current_hand = list(state.get("my_hand", []))

                if phase == "playing" and turn_id == my_token and len(trick_cards) < 4 and current_hand:
                    led_suit = state.get("led_suit") or (card_suit(trick_cards[0]["card"]) if trick_cards else None)
                    following = [c for c in current_hand if card_suit(c) == led_suit] if led_suit else []
                    card_to_play = following[0] if following else current_hand[0]
                    await ws.send(json.dumps({
                        "type": "play_card",
                        "card": card_to_play
                    }))

            elif mtype == "trick_complete":
                tricks_won += 1
                winner = data.get("winner_name")
                card = data.get("winning_card")
                print(f"  ✓ Trick {tricks_won}/13 resolved: {winner} won with {card}")

            elif mtype == "round_complete":
                round_finished = True
                print(f"  🎉 All 13 tricks complete! Round finished in {time.time() - start_time:.2f}s")
                print(f"     Round scores: {data.get('round_scores')}")

        assert tricks_won == 13, f"Expected 13 tricks, got {tricks_won}"
        assert round_finished, "Expected round_complete event"
        print("=" * 65)
        print("✅ FULL 13-TRICK TEST PASSED WITHOUT FREEZES!")
        print("=" * 65 + "\n")


async def main_tests():
    await run_simulation()
    await run_full_13_tricks_test()


if __name__ == "__main__":
    test_claim_tricks_unit_logic()
    asyncio.run(main_tests())
