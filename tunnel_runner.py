"""
Strawberry Tarneeb - Online Game & Cloudflare Tunnel Runner
===========================================================
1. Ensures cloudflared.exe is present (downloads if missing).
2. Starts FastAPI game server on port 8000.
3. Starts Cloudflare Tunnel to expose port 8000.
4. Extracts clean https://*.trycloudflare.com URL and displays it.
5. Automatically opens the link in default browser.
"""

import os
import re
import sys
import time
import signal
import subprocess
import webbrowser

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CLOUDFLARED = os.path.join(BASE_DIR, "cloudflared.exe")
DOWNLOAD_SCRIPT = os.path.join(BASE_DIR, "download_cloudflared.py")

def ensure_tunnel_binary():
    if not os.path.exists(CLOUDFLARED) or os.path.getsize(CLOUDFLARED) < 30 * 1024 * 1024:
        print("[*] cloudflared.exe missing or incomplete. Downloading now...")
        subprocess.run([sys.executable, DOWNLOAD_SCRIPT], cwd=BASE_DIR, check=True)
    if not os.path.exists(CLOUDFLARED):
        print("[ERROR] Could not obtain cloudflared.exe")
        sys.exit(1)

def main():
    os.chdir(BASE_DIR)
    print("===================================================================")
    print("         🍓 STRAWBERRY TARNEEB - ONLINE CARD GAME 🍓               ")
    print("===================================================================")

    # 1. Ensure cloudflared binary exists
    ensure_tunnel_binary()

    # 2. Start FastAPI Server
    print("[1/3] Starting FastAPI Game Server on port 8000...")
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--log-level", "warning"],
        cwd=BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT
    )

    # Give server 1.5 seconds to bind
    time.sleep(1.5)
    if server_proc.poll() is not None:
        print("[ERROR] FastAPI server failed to start.")
        sys.exit(1)

    # 3. Start Cloudflare Tunnel
    print("[2/3] Starting Cloudflare Tunnel...")
    cf_proc = subprocess.Popen(
        [CLOUDFLARED, "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate"],
        cwd=BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        encoding="utf-8",
        errors="replace"
    )

    tunnel_url = None
    url_pattern = re.compile(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com")

    # Read output to capture public URL
    print("[3/3] Acquiring secure HTTPS link for mobile devices...")
    start_wait = time.time()
    while time.time() - start_wait < 30:
        line = cf_proc.stdout.readline()
        if not line and cf_proc.poll() is not None:
            break
        if line:
            match = url_pattern.search(line)
            if match:
                tunnel_url = match.group(0)
                break

    if not tunnel_url:
        print("\n[!] Could not parse trycloudflare URL. Local server is still running on http://localhost:8000")
        tunnel_url = "http://localhost:8000"
    else:
        # Copy to clipboard if possible
        try:
            subprocess.run(["clip"], input=tunnel_url.encode("utf-8"), check=False)
        except Exception:
            pass

    print("\n" + "=" * 67)
    print(" 🎉 ONLINE TARNEEB TABLE IS LIVE & READY FOR MOBILE BROWSERS! 🎉 ")
    print("=" * 67)
    print(f"\n👉  PUBLIC SHARE LINK:  {tunnel_url}  👈")
    print("\n(Link has been copied to your clipboard. Send it to your friends!)")
    print(f"Local access: http://localhost:8000")
    print("=" * 67)
    print("Press Ctrl+C at any time to stop the server and close the tunnel.\n")

    # Open link in browser
    try:
        webbrowser.open(tunnel_url)
    except Exception:
        pass

    # Keep running and stream tunnel / server logs
    try:
        while True:
            time.sleep(1)
            if cf_proc.poll() is not None or server_proc.poll() is not None:
                break
    except KeyboardInterrupt:
        print("\n[*] Stopping Strawberry Tarneeb server and closing tunnel...")
    finally:
        try:
            cf_proc.terminate()
            cf_proc.kill()
        except Exception:
            pass
        try:
            server_proc.terminate()
            server_proc.kill()
        except Exception:
            pass
        print("[OK] Stopped cleanly. Thanks for playing Strawberry Tarneeb! 🍓")

if __name__ == "__main__":
    main()
