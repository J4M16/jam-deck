from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def fit_crop(image: Image.Image, width: int, height: int) -> Image.Image:
    target_ratio = width / height
    source_ratio = image.width / image.height
    if source_ratio > target_ratio:
        crop_width = round(image.height * target_ratio)
        left = (image.width - crop_width) // 2
        box = (left, 0, left + crop_width, image.height)
    else:
        crop_height = round(image.width / target_ratio)
        top = (image.height - crop_height) // 2
        box = (0, top, image.width, top + crop_height)
    return image.crop(box).resize((width, height), Image.Resampling.LANCZOS)


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    canvas = fit_crop(Image.open(args.source).convert("RGB"), 360, 200).convert("RGBA")
    overlay = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # Quiet left field for exact, readable cover typography.
    for x in range(190):
        alpha = round(90 * (1 - x / 190) ** 1.7)
        draw.line((x, 0, x, 200), fill=(250, 249, 246, alpha))

    green = "#A8FF2A"
    ink = "#191D1B"
    muted = "#6F7772"
    draw.rounded_rectangle((22, 28, 31, 37), radius=3, fill=green)
    draw.text((39, 23), "Jam Deck", font=font(r"C:\Windows\Fonts\bahnschrift.ttf", 25), fill=ink)
    draw.text((23, 63), "本地副屏工作台", font=font(r"C:\Windows\Fonts\msyhbd.ttc", 13), fill=ink)
    draw.text((23, 89), "让灵感从剪贴板流向知识库", font=font(r"C:\Windows\Fonts\msyh.ttc", 9), fill=muted)
    draw.rounded_rectangle((23, 119, 91, 137), radius=9, fill=(168, 255, 42, 42), outline=(134, 198, 38, 96), width=1)
    draw.text((32, 123), "LOCAL FIRST", font=font(r"C:\Windows\Fonts\bahnschrift.ttf", 8), fill="#51603F")

    result = Image.alpha_composite(canvas, overlay).convert("RGB")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.output, format="PNG", optimize=True)


if __name__ == "__main__":
    main()
