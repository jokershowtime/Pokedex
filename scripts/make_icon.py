"""Rasterize the application's existing geometric icon for Windows packaging."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
root.joinpath('data').mkdir(exist_ok=True)
image = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 255, 255), radius=72, fill='#df514b')
draw.ellipse((48, 48, 208, 208), fill='#fff5ed')
draw.pieslice((48, 48, 208, 208), 180, 360, fill='#312f34')
draw.line((48, 128, 208, 128), fill='#df514b', width=20)
draw.ellipse((96, 96, 160, 160), fill='#df514b')
draw.ellipse((112, 112, 144, 144), fill='#fff5ed')
image.save(root / 'data/app-icon.png')
image.save(root / 'data/app-icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
