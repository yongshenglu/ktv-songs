"""
生成 KTV 歌单的图标资源（开发用脚本，不参与部署）。

设计：深色圆角底 + 琥珀色实心音符，与站内 brand-mark 同一套语言。
在 1024×1024 母版上绘制后降采样，保证边缘干净。

用法：
    python tools/make_icons.py
"""

from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets")

S = 1024  # 母版边长

BG_TOP = (18, 24, 38)
BG_BOTTOM = (8, 11, 17)
AMBER = (245, 185, 66, 255)
AMBER_DEEP = (216, 152, 40, 255)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def background() -> Image.Image:
    """冷调深色纵向渐变 + 音符后方一圈柔和琥珀辉光。"""
    strip = Image.new("RGB", (1, S))
    d = ImageDraw.Draw(strip)
    for y in range(S):
        d.point((0, y), fill=lerp(BG_TOP, BG_BOTTOM, y / (S - 1)))
    base = strip.resize((S, S), Image.BILINEAR).convert("RGBA")

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [S * 0.08, S * 0.16, S * 0.94, S * 1.02], fill=(245, 185, 66, 60)
    )
    glow = glow.filter(ImageFilter.GaussianBlur(150))
    return Image.alpha_composite(base, glow)


def rotated_ellipse(img, cx, cy, rx, ry, angle, fill):
    """在 img 上贴一个旋转过的实心椭圆。"""
    box = int(max(rx, ry) * 2 + 16)
    tmp = Image.new("RGBA", (box, box), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).ellipse(
        [box / 2 - rx, box / 2 - ry, box / 2 + rx, box / 2 + ry], fill=fill
    )
    tmp = tmp.rotate(angle, resample=Image.BICUBIC)
    img.alpha_composite(tmp, (int(round(cx - box / 2)), int(round(cy - box / 2))))


def quadratic(p0, p1, p2, t):
    u = 1 - t
    return (
        u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
        u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    )


def bez2(p0, p1, p2, steps=72):
    return [quadratic(p0, p1, p2, i / steps) for i in range(steps + 1)]


def draw_note(img: Image.Image) -> None:
    """实心音符：椭圆符头 + 符干 + 月牙形符尾。

    在设计坐标系里画完，再整体缩放平移到画布中央，
    保证内容落在 maskable 图标的圆形安全区内（距中心 < 410/1024）。
    """
    K = 1.22
    DX = S * 0.5 - 488 * K
    DY = S * 0.5 - 557 * K

    def pt(x, y):
        return (x * K + DX, y * K + DY)

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    # 符头
    hx, hy = S * 0.405, S * 0.705
    rx, ry = S * 0.148, S * 0.111

    # 符干：贴在符头右侧，向上
    stem_w = S * 0.058 * K
    stem_left = hx + rx * 0.52
    stem_right = stem_left + S * 0.058
    stem_top = S * 0.268
    stem_bot = hy + S * 0.012

    # 符尾：从符干顶端向右外鼓、再向左下收（实心月牙）
    # 收尾留出厚度，再用圆头封住，避免缩到桌面尺寸时变成针尖
    tip_out = pt(stem_right + S * 0.132, stem_top + S * 0.362)
    tip_in = pt(stem_right + S * 0.072, stem_top + S * 0.316)

    outer = bez2(
        pt(stem_right - S * 0.012, stem_top + S * 0.010),
        pt(stem_right + S * 0.215, stem_top + S * 0.055),
        tip_out,
    )
    inner = bez2(
        tip_in,
        pt(stem_right + S * 0.108, stem_top + S * 0.168),
        pt(stem_right + S * 0.006, stem_top + S * 0.070),
    )
    d.polygon(outer + inner, fill=AMBER)

    mid = ((tip_out[0] + tip_in[0]) / 2, (tip_out[1] + tip_in[1]) / 2)
    tip_r = math.hypot(tip_out[0] - tip_in[0], tip_out[1] - tip_in[1]) / 2
    d.ellipse([mid[0] - tip_r, mid[1] - tip_r, mid[0] + tip_r, mid[1] + tip_r], fill=AMBER)

    # 符干
    x0, y0 = pt(stem_left, stem_top)
    x1, y1 = pt(stem_right, stem_bot)
    d.rounded_rectangle([x0, y0, x1, y1], radius=stem_w * 0.34, fill=AMBER)

    # 符头（略向右倾，音符的标准姿态）
    cx, cy = pt(hx, hy)
    rotated_ellipse(layer, cx, cy, rx * K, ry * K, -20, AMBER)

    img.alpha_composite(layer)


def rounded_mask(size: int, radius_ratio: float) -> Image.Image:
    mask = Image.new("L", (size * 4, size * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size * 4 - 1, size * 4 - 1],
        radius=int(size * 4 * radius_ratio),
        fill=255,
    )
    return mask.resize((size, size), Image.LANCZOS)


def build(master: Image.Image, size: int, rounded: bool) -> Image.Image:
    img = master.resize((size, size), Image.LANCZOS)
    if rounded:
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), rounded_mask(size, 0.223))
        return out
    return img.convert("RGB").convert("RGBA")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    master = background()
    draw_note(master)

    targets = [
        # 文件名,                尺寸, 圆角, 转 RGB（去掉透明通道）
        ("apple-touch-icon.png", 180, False, True),
        ("favicon-32.png", 32, True, False),
        ("icon-192.png", 192, True, False),
        ("icon-512.png", 512, True, False),
        # maskable：满幅方图，内容已收在中央安全区，交给启动器裁圆
        ("icon-maskable-192.png", 192, False, False),
        ("icon-maskable-512.png", 512, False, False),
    ]

    for name, size, rounded, flatten in targets:
        img = build(master, size, rounded)
        if flatten:
            bg = Image.new("RGB", (size, size), (18, 24, 38))
            bg.paste(img, (0, 0), img)
            img = bg
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print(f"  {name:26s} {size}x{size}  {os.path.getsize(path):>6,d} B")


if __name__ == "__main__":
    main()
