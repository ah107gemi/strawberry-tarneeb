# 🍓 Strawberry Tarneeb — Scoreboard & Real-Time Multiplayer Card Game

A modern, responsive, mobile-first Progressive Web App (PWA) tailored for custom Strawberry Tarneeb rules, featuring two integrated operational modes:
1. **📋 Scoreboard Mode**: Digital scorecard for playing in-person with physical cards.
2. **🃏 Online Card Game**: Real-time virtual card table with WebSocket server and Cloudflare Tunnel for playing remotely on phones.

🌐 **GitHub Pages Live App**: **[https://ah107gemi.github.io/strawberry-tarneeb/](https://ah107gemi.github.io/strawberry-tarneeb/)**

---

## 🎮 Game Modes

Toggle between modes at any time using the persistent **Mode Selector** at the top of the screen:
* **📋 Scoreboard Mode**: Use your laptop or phone as the official game scorekeeper at the physical table.
* **🃏 Online Card Game**: Play the full virtual card game live with friends on their phones.

---

## 📋 Mode 1: In-Person Scoreboard Rules

1. **Table Roster & 4-Player Selection**:
   - **Roster**: `Ahmed`, `Hosam`, `Shiba`, `Furjani`, `Naas`, `Zentani`.
   - **Active Table (4 Players)**: Exactly 4 active players are chosen for the match.
   - **Bench / Sitting Out**: The remaining players are preserved on the bench with stats intact. Easily swap players between seats and bench via the Manage Players modal (`👥`).

2. **Round 1 Exception**:
   - Skips pre-round bidding entirely.
   - Scores directly as **+1 point per trick taken** ("get what you take").

3. **Rounds 2 to 15 (Bidding Phase)**:
   - Turn-by-turn bidding before card play.
   - **Allowed Bids**: `0`, or `2` through `13`.
   - **🚫 Bid 1 is strictly prohibited!**
   - Explicit dealer rotation display (`🂠 Dealer: Name`) clockwise each round.

4. **Exact Scoring Engine**:
   - **Bid 0**:
     * **+5 points** if made (`0 tricks won`)
     * **-5 points** if failed (`>= 1 trick won`)
   - **Bid 7**:
     * **+14 points** if made (`>= 7 tricks won`)
     * **-14 points** if failed (`< 7 tricks won`)
   - **General Bids (2-6, 8-13)**:
     * **+Bid points** if made (`tricks >= bid`)
     * **-Bid points** if failed (`tricks < bid`)

---

## 🃏 Mode 2: Online Multiplayer Card Game

* **Python FastAPI + WebSockets Engine (`server.py`)**:
  - Serves static files and maintains real-time game state on port 8000.
  - Automatically handles connection drops and reconnects within 60 seconds without losing state.
* **Lobby & Seating**:
  - Open the public link on any phone.
  - Quick-select your name from the group roster (`Ahmed`, `Hosam`, `Shiba`, `Furjani`, `Naas`, `Zentani`) or enter a custom nickname.
  - The first 4 connected players are seated at the active card table. Any subsequent players automatically join as **Spectators / Bench** with full live table viewing and score tracking.
* **Relative 1st-Person Perspective**:
  - Each player sees their own private 13-card hand at the bottom dock, and opponents at Left, Top, and Right displaying face-down card backs.
* **Hand Organization**:
  - **Auto-Sort**: Groups cards by suit (Hearts/trump first, then Spades, Diamonds, Clubs) and rank (2 up to Ace).
  - **Manual Mode**: Drag-and-drop / touch rearrangement with preference saved in `localStorage`.
* **Suit-Following Engine**:
  - Players must follow the led suit if held. Void players can cut with Hearts (trump) or slough an off-suit.
* **Special Rule — "King of Hearts Snip"**:
  - If both the King of Hearts (K♥) and Ace of Hearts (A♥) are played in the **exact same trick**:
    * The player who played K♥ receives a **-5 point penalty**.
    * The player who played A♥ receives a **+5 point bonus**.
    * Applied on top of their normal round score at round completion.
* **Cut-Trump "Smirk" Reaction**:
  - When a non-Heart suit is led and a player cuts with a Heart, an instant action prompt appears: *"Send Smirk 😏?"*.
  - Tapping it triggers a floating animated smirk reaction visible to all connected players and spectators!

---

## ⚡ One-Click Online Runner (`start_tarneeb_online.bat`)

To host the multiplayer game from your laptop and get an instant secure public HTTPS link for your friends to play from their phones:

1. Double-click **`start_tarneeb_online.bat`** in the project folder.
2. The script automatically:
   - Verifies `cloudflared.exe` (downloads it automatically from GitHub releases if missing).
   - Starts the FastAPI game server on port 8000.
   - Creates a Cloudflare tunnel and extracts the clean public HTTPS URL:
     ```
     👉  PUBLIC SHARE LINK:  https://xxxx-xxxx.trycloudflare.com  👈
     ```
   - Copies the public link to your clipboard and opens it in your default browser.
3. Share the link in your WhatsApp group — friends open it on mobile and join immediately!

---

## 🔄 Deploy to GitHub Pages

To commit and push all frontend updates to GitHub Pages:
```powershell
python deploy_github.py
```
Target repository: `ah107gemi/strawberry-tarneeb` (branch: `main`).
