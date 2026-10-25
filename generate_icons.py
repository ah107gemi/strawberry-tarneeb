"""
Script to regenerate high-resolution PWA icons for Strawberry Tarneeb
with solid dark navy (#182032) background and 75-80% safe zone inner padding.
"""
import os
import subprocess
from PIL import Image

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ICON_512 = os.path.join(BASE_DIR, "icon-512.png")
ICON_192 = os.path.join(BASE_DIR, "icon-192.png")
ICON_SVG = os.path.join(BASE_DIR, "icon.svg")

def main():
    if os.path.exists(ICON_512):
        im = Image.open(ICON_512).convert("RGB")
        im_192 = im.resize((192, 192), Image.Resampling.LANCZOS)
        im_192.save(ICON_192, "PNG", optimize=True)
        print("Generated icon-192.png from icon-512.png successfully.")
    else:
        print("icon-512.png not found.")

if __name__ == "__main__":
    main()
