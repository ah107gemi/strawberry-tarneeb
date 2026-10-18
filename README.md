# 🍓 Strawberry Tarneeb Scoreboard

A modern, responsive, mobile-first Progressive Web App (PWA) customized specifically for your exact Tarneeb game rules.

🌐 **Live 24/7 HTTPS App**: **[https://ah107gemi.github.io/strawberry-tarneeb/](https://ah107gemi.github.io/strawberry-tarneeb/)**

---

## 🂠 Exact Custom Game Rules

1. **Table Roster & 4-Player Selection**:
   - **Full Group Roster**: Default group includes "Ahmed", "Hosam", "Shiba", "Furjani", "Naas", "Zentani".
   - **Table Seats (4 Active Players)**: Exactly 4 active players are chosen for the match.
   - **Bench / Sitting Out**: The remaining players are marked as "Sitting Out / Bench" with their stats and roster presence fully preserved. You can easily rotate players between active table seats and the bench anytime in the **Manage Players** modal (`👥`).

2. **Pre-Round Bidding Phase (`🎯 Enter Bids`)**:
   - Before tricks can be entered, players submit bids for each round.
   - **Allowed Bids**: `0`, or `2` through `13`.
   - **🚫 Bid 1 is strictly prohibited!**
   - Each player's bid is displayed live on the scoreboard during the round (`Bid: X`).
   - The dealer rotates cyclically among the 4 active table players (`Round % 4`).

3. **Exact Scoring Engine**:
   - **Bid 0**:
     * **+5 points** if made (`0 tricks won`)
     * **-5 points** if failed (`>= 1 trick won`)
   - **Bid 7**:
     * **+14 points** if made (`>= 7 tricks won`)
     * **-14 points** if failed (`< 7 tricks won`)
   - **General Bids (2-6, 8-13)**:
     * **+Bid points** if made (`tricks >= bid`)
     * **-Bid points** if failed (`tricks < bid`)
   - **Tricks Validation**: Total tricks in each 4-player round equals 13 (`52 cards / 4`). The interface validates tricks out of 13 (`0/13` up to `13/13`).
   - **Total Score**: `=SUM(Round 1 score : Round 15 score)` for each player.
   - **Live Standings**: Dynamically ranked 1st to 4th based on highest total score descending.

---

## 🚀 Key Features

* **Mobile-First & Touch-Friendly**: Big touch-friendly numpads, quick steppers (`+`, `-`), and live preview of calculated points (+5, -5, +14, etc.) in real time.
* **Persistent State**: Automatic `localStorage` saving prevents losing scores if mobile tabs are closed or refreshed.
* **Match History**: Archives previous matches with dates, final standings, and bench players.
* **WhatsApp / Chat Sharing (`📤`)**: One-click copy of formatted standings with medals and bench players ready for group chats.
* **PWA & Offline Play**: Installable to iOS Home Screen ("Share" ➔ "Add to Home Screen") and Android Chrome ("Install App"), works 100% offline via Service Worker.

---

## 🔄 Automated GitHub Sync

To automatically sync and deploy any future modifications to GitHub Pages:
```powershell
python d:\Antigravity.google\strawberry-tarneeb\deploy_github.py
```
This script commits and pushes all updated files directly to `ah107gemi/strawberry-tarneeb` on branch `main` and refreshes GitHub Pages.
