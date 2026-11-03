# Tarneeb Private Scoreboard - Project Summary

## Overview
A lightweight, web-based Tarneeb scoring application (`index.html` / `scoreboard.html`) designed for private group play. It tracks 15 rounds for 4 players.

## Visual Identity
*   **Theme:** Midnight Royale (dark navy/slate backgrounds, gold accent borders, champagne text highlights).
*   **UX:** Clean, minimalist UI optimized for mobile viewing and easy interaction.

## Core Features & Logic
*   **Match Setup:** Edit and save 4 player names.
*   **Tricks & Scoring Modal:** Input bids and tricks taken for each round.
*   **Scorecard Matrix:** A responsive table displaying round-by-round history and cumulative match totals.
*   **The "-5 Penalty" Skull Button (💀):** A toggle button placed directly next to the player's name in the scoring modal. When activated (glows red), it deducts exactly 5 points from that player's calculated round score, regardless of whether they made or missed their bid. 
*   **State Management:** Penalty states and round scores persist correctly in the matrix and can be reviewed or edited in past rounds.