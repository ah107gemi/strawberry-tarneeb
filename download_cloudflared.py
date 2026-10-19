import os
import sys
import time
import urllib.request

DEST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cloudflared.exe")
URL = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

def ensure_cloudflared():
    if os.path.exists(DEST) and os.path.getsize(DEST) > 30 * 1024 * 1024:
        print(f"[OK] cloudflared.exe already exists ({os.path.getsize(DEST):,} bytes)")
        return True

    print("[*] Downloading cloudflared-windows-amd64.exe from GitHub releases...")
    req = urllib.request.Request(URL, headers={"User-Agent": "Mozilla/5.0"})
    
    start_time = time.time()
    try:
        with urllib.request.urlopen(req) as resp, open(DEST + ".tmp", "wb") as out:
            total_size = int(resp.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 1024 * 512
            
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                
                if total_size > 0:
                    pct = (downloaded / total_size) * 100
                    elapsed = time.time() - start_time
                    speed = downloaded / (1024 * 1024 * (elapsed or 1))
                    sys.stdout.write(f"\rDownloading: {downloaded / (1024*1024):.1f}/{total_size / (1024*1024):.1f} MB ({pct:.1f}%) - {speed:.2f} MB/s")
                    sys.stdout.flush()

        print("\nDownload complete. Verifying file...")
        if os.path.exists(DEST):
            os.remove(DEST)
        os.rename(DEST + ".tmp", DEST)
        print(f"[SUCCESS] cloudflared.exe saved to {DEST} ({os.path.getsize(DEST):,} bytes)")
        return True
    except Exception as e:
        print(f"\n[ERROR] Download failed: {e}")
        if os.path.exists(DEST + ".tmp"):
            os.remove(DEST + ".tmp")
        return False

if __name__ == "__main__":
    ensure_cloudflared()
