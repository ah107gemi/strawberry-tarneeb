# Tarneeb Live Multiplayer Game - Project Summary

## Overview
A real-time multiplayer card game environment utilizing WebSockets. The backend (`server.py`) is hosted as a Render web service (`strawberry-tarneeb`), paired with a frontend client (`game_client.js`).

## Core Gameplay Logic
*   **Standard Tarneeb Rules:** 4 players, 13 cards each, trick-taking mechanics, with Hearts (♥) acting as the default trump suit.

## Advanced Custom Features
1.  **7-Card Non-Trump Redeal Rule:** 
    *   If a player is dealt 7 or more cards of a single non-trump suit (Spades, Clubs, or Diamonds), the server detects this.
    *   The player is presented with a private UI prompt to either "Keep Hand" or "Request Redeal 🔄".
    *   If requested, the server announces the redeal, shuffles, and restarts the current round without advancing the match index.
2.  **Hold & Auto-Reconnect System:**
    *   **Pause State:** A "⏸️ Hold" / "▶️ Resume" toggle allows players to pause the match, freezing turn timers and displaying an overlay.
    *   **Grace Period:** To handle mobile browser backgrounding/tab switching, player connection details (`session_id`, `room_code`) are cached in `sessionStorage`. 
    *   **No Bot Takeovers:** The server holds the room open with a 3-minute grace period upon disconnect. When the player returns and `visibilitychange` triggers, the client instantly reconnects, re-hydrates the game state, and resumes seamlessly.