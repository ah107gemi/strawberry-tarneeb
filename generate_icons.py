import zlib
import struct
import math

def create_png(width, height, draw_func):
    """Creates an uncompressed/zlib-compressed truecolor RGBA PNG file."""
    # PNG signature
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    
    # IHDR chunk: width(4), height(4), bit_depth(1), color_type(6=RGBA), compression(0), filter(0), interlace(0)
    ihdr_data = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    ihdr_crc = struct.pack('>I', zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff)
    png.extend(struct.pack('>I', len(ihdr_data)) + b'IHDR' + ihdr_data + ihdr_crc)
    
    # Raw pixel scanlines: each line starts with filter byte 0 (None)
    raw_scanlines = bytearray()
    for y in range(height):
        raw_scanlines.append(0) # filter type
        for x in range(width):
            r, g, b, a = draw_func(x, y, width, height)
            raw_scanlines.extend((r, g, b, a))
            
    # IDAT chunk
    compressed = zlib.compress(bytes(raw_scanlines), 9)
    idat_crc = struct.pack('>I', zlib.crc32(b'IDAT' + compressed) & 0xffffffff)
    png.extend(struct.pack('>I', len(compressed)) + b'IDAT' + compressed + idat_crc)
    
    # IEND chunk
    iend_crc = struct.pack('>I', zlib.crc32(b'IEND') & 0xffffffff)
    png.extend(struct.pack('>I', 0) + b'IEND' + iend_crc)
    
    return bytes(png)

def draw_strawberry_icon(x, y, w, h):
    # Normalized coords from -1 to 1
    nx = (x - w / 2) / (w / 2)
    ny = (y - h / 2) / (h / 2)
    dist = math.sqrt(nx * nx + ny * ny)
    
    # Rounded squircle background: radius ~ 0.88
    # Background color: rich dark slate gradient with crimson glow
    bg_r = int(15 + 15 * (1 - ny))
    bg_g = int(23 + 5 * (1 - ny))
    bg_b = int(42 + 10 * (1 - ny))
    
    # Border & squircle shape: superellipse |nx|^3.5 + |ny|^3.5 < 0.85
    sq_dist = (abs(nx)**3.2 + abs(ny)**3.2)
    if sq_dist > 0.95:
        return (0, 0, 0, 0) # transparent outside rounded icon
    elif sq_dist > 0.88:
        # Crimson gold border
        t = (sq_dist - 0.88) / (0.95 - 0.88)
        alpha = int(255 * (1 - t))
        return (225, 29, 72, alpha)
    
    # Inside icon background
    # Inner subtle glow from center
    glow = max(0.0, 1.0 - dist)
    r = min(255, int(bg_r + glow * 40))
    g = min(255, int(bg_g + glow * 10))
    b = min(255, int(bg_b + glow * 20))
    
    # Strawberry berry body: centered slightly down (cy ~ 0.15)
    # Heart/strawberry shape equation:
    bx = nx * 1.5
    by = (ny - 0.1) * 1.5
    berry_dist = bx*bx + (by - math.sqrt(abs(bx)))**2
    
    # Check strawberry body
    # Modified strawberry profile:
    sy = (ny - 0.12)
    # strawberry width tapers toward bottom
    width_at_y = 0.55 * (1.1 - 0.6 * sy)
    if -0.45 <= sy <= 0.65 and abs(nx) <= width_at_y:
        # Bottom curve
        if sy > 0.4:
            dy = (sy - 0.4) / 0.25
            if (nx / 0.3)**2 + dy**2 > 1.0:
                pass # outside bottom tip
            else:
                # Strawberry Crimson Red gradient
                shade = 0.8 + 0.3 * (1 - ny) - 0.2 * abs(nx)
                return (min(255, int(225 * shade)), min(255, int(29 * shade)), min(255, int(72 * shade)), 255)
        else:
            # Strawberry Crimson Red gradient
            shade = 0.85 + 0.25 * (1 - ny) - 0.15 * abs(nx)
            # Seeds pattern
            seed_x = (x * 7) % 24
            seed_y = (y * 7) % 24
            if (seed_x - 12)**2 + (seed_y - 12)**2 < 4 and sy > -0.3:
                return (254, 240, 138, 255) # golden seed
            return (min(255, int(225 * shade)), min(255, int(29 * shade)), min(255, int(72 * shade)), 255)
            
    # Green leaves crown at the top
    if -0.7 <= ny <= -0.35:
        lx = abs(nx)
        ly = ny + 0.48
        if (lx < 0.45 and abs(ly) < 0.18) or (lx < 0.2 and ny < -0.45):
            return (34, 197, 94, 255) # emerald leaf green
            
    return (r, g, b, 255)

# Generate 192x192 and 512x512
with open("d:/Antigravity.google/strawberry-tarneeb/icon-192.png", "wb") as f:
    f.write(create_png(192, 192, draw_strawberry_icon))

with open("d:/Antigravity.google/strawberry-tarneeb/icon-512.png", "wb") as f:
    f.write(create_png(512, 512, draw_strawberry_icon))

print("PNG icons generated successfully!")
