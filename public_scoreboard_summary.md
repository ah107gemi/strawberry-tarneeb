# Tarneeb Public Scoreboard - Project Summary

## Overview
A standalone public-facing variant of the Tarneeb scoreboard (`public-scoreboard.html`) hosted on Render via GitHub Pages.

## Visual Identity
*   **Theme:** Graphite (distinct from the private scoreboard to visually separate the environments).

## Core Features & Logic
*   **Quick-Fill Checkmark (✅):** Instantly auto-fills target bids into tricks taken for faster scoring.
*   **King Status (👑):** Players who reach 18+ points trigger a glowing King rank and crown animation in the active table standings.
*   **Penalty Integration:** Includes the identical 💀 -5 penalty button and logic found in the private scoreboard.

## Video Tutorial Automation
*   **Tooling:** Python, Playwright, and FFmpeg.
*   **Scripts:** `generate_tutorial_video.py` and `generate_tutorial.bat` (strictly ASCII-formatted to prevent Windows `cmd.exe` parsing errors).
*   **Functionality:** Automatically launches a headless Chromium instance, simulates typing names, bidding, using the quick-fill checkmark, triggering the King status, and recording a 1080x1920 MP4 tutorial video without requiring a heavy React/Remotion setup.