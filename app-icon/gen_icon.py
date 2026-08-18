from PIL import Image, ImageDraw
import os

OUT = os.path.dirname(os.path.abspath(__file__))
SIZE = 1024
BG = (58, 71, 194, 255)      # 深靛蓝（Zion 主色）
WHITE = (255, 255, 255, 255)
ORANGE = (255, 122, 69, 255) # 生活橙（阅读/生活强调色）

img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# 背景圆角方块
d.rounded_rectangle([0, 0, SIZE, SIZE], radius=int(SIZE * 0.22), fill=BG)

# 看板柱状 motif（底部对齐、居中）：白、橙(高)、白
baseline = 770
bar_w = 132
gap = 112
heights = [250, 392, 312]
colors = [WHITE, ORANGE, WHITE]
total_w = len(heights) * bar_w + (len(heights) - 1) * gap
start_x = (SIZE - total_w) // 2
bar_radius = 44
x = start_x
for h, c in zip(heights, colors):
    top = baseline - h
    d.rounded_rectangle([x, top, x + bar_w, baseline], radius=bar_radius, fill=c)
    x += bar_w + gap

# 主图 1024
img.save(os.path.join(OUT, "icon-1024.png"))

# 缩小档
for s in [512, 384, 192, 144, 96, 72, 48, 36]:
    img.resize((s, s), Image.LANCZOS).save(os.path.join(OUT, f"icon-{s}.png"))

# 矢量母版（方便后续改色）
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
<rect x="0" y="0" width="{SIZE}" height="{SIZE}" rx="{int(SIZE*0.22)}" fill="#3A47C2"/>
<rect x="{start_x}" y="{baseline-heights[0]}" width="{bar_w}" height="{heights[0]}" rx="{bar_radius}" fill="#FFFFFF"/>
<rect x="{start_x+bar_w+gap}" y="{baseline-heights[1]}" width="{bar_w}" height="{heights[1]}" rx="{bar_radius}" fill="#FF7A45"/>
<rect x="{start_x+2*(bar_w+gap)}" y="{baseline-heights[2]}" width="{bar_w}" height="{heights[2]}" rx="{bar_radius}" fill="#FFFFFF"/>
</svg>'''
with open(os.path.join(OUT, "icon.svg"), "w") as f:
    f.write(svg)

print("generated:", sorted(os.listdir(OUT)))
