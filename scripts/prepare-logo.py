"""EduSetupPlus logosunu favicon ve arayüz kullanımına hazırlar.

Kaynak görselde logo, siyah zemin üzerinde ince mavi "veri yağmuru" efektiyle
birlikte duruyor. Bu efekt neredeyse tüm kareye yayıldığı için basit bir
parlaklık kutusu (bbox) işe yaramaz; bunun yerine satır/sütun bazlı yoğunluk
kullanılır. Ayrıca ikon çıktısında zemindeki efekt çizgileri düz koyu renkle
bastırılır, böylece sekmedeki küçük favicon net görünür.

Çıktılar:
- edusetupplus-logo-wide.png : simge + "EduSetupPlus" yazısı (üst menü / açılış)
- edusetupplus-icon.png      : yalnızca üçgen simge, kare favicon (256x256)
"""

from PIL import Image

SRC = "/workspace/app/frontend/public/assets/edusetupplus-logo.png"
OUT_WIDE = "/workspace/app/frontend/public/assets/edusetupplus-logo-wide.png"
OUT_ICON = "/workspace/app/frontend/public/assets/edusetupplus-icon.png"

BRIGHT = 120  # yoğunluk analizinde logoyu efektten ayıran eşik
FLOOR = 96  # ikonda zemine indirilecek karanlık piksel eşiği
BG = (4, 7, 17, 255)


def bright_mask(image: Image.Image) -> Image.Image:
    """Parlak (logo) pikselleri 255, geri kalanı 0 yapan maske."""
    return image.convert("L").point(lambda v: 255 if v > BRIGHT else 0)


def counts(mask: Image.Image, axis: str) -> list[int]:
    """Satır (row) veya sütun (col) başına parlak piksel sayısı."""
    data = list(mask.getdata())
    w, h = mask.size
    if axis == "row":
        return [sum(1 for x in range(w) if data[y * w + x]) for y in range(h)]
    return [sum(1 for y in range(h) if data[y * w + x]) for x in range(w)]


def dense_range(values: list[int], ratio: float) -> tuple[int, int]:
    """Yoğun bölgenin başlangıç/bitiş indeksini döndürür."""
    peak = max(values) if values else 0
    if peak <= 0:
        return 0, len(values)
    limit = max(1, int(peak * ratio))
    idx = [i for i, v in enumerate(values) if v >= limit]
    return (idx[0], idx[-1] + 1) if idx else (0, len(values))


def trim(
    image: Image.Image,
    ratio: float,
    margin: float = 0.03,
    col_ratio: float | None = None,
) -> Image.Image:
    """Görseli yoğun logo alanına göre kırpar, kenarda güvenlik payı bırakır.

    `col_ratio` verilirse yatay eksende daha sıkı bir eşik kullanılır; bu sayede
    yalnızca simge kalır ve zemine yayılan ince efekt sütunları atılır.
    """
    mask = bright_mask(image)
    x0, x1 = dense_range(counts(mask, "col"), col_ratio if col_ratio is not None else ratio)
    y0, y1 = dense_range(counts(mask, "row"), ratio)
    mx = max(4, int((x1 - x0) * margin))
    my = max(4, int((y1 - y0) * margin))
    return image.crop(
        (
            max(0, x0 - mx),
            max(0, y0 - my),
            min(image.width, x1 + mx),
            min(image.height, y1 + my),
        )
    )


def flatten(image: Image.Image) -> Image.Image:
    """Karanlık efekt çizgilerini düz zemine indirir (favicon netliği için)."""
    out = image.convert("RGBA")
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if (r * 299 + g * 587 + b * 114) // 1000 < FLOOR:
                px[x, y] = BG
    return out


img = Image.open(SRC).convert("RGBA")
print("kaynak boyut:", img.size)

# 1) Yatay logo: simge + yazı; düşük eşik kullanılır ki simgenin ucu kesilmesin.
wide = trim(img, ratio=0.02, margin=0.05)
print("yatay kirpim:", wide.size)
wide_out = wide.copy()
wide_out.thumbnail((640, 640), Image.LANCZOS)
wide_out.save(OUT_WIDE, optimize=True)
print("yatay logo yazildi:", wide_out.size)

# 2) Simge bandını bul: yoğun satır kümelerinden ilki üçgen, ikincisi yazıdır.
mask = bright_mask(wide)
row_counts = counts(mask, "row")
limit = max(1, int(max(row_counts) * 0.08))

groups: list[tuple[int, int]] = []
start = None
for y, value in enumerate(row_counts):
    if value >= limit:
        if start is None:
            start = y
    elif start is not None:
        if y - start > wide.height * 0.03:
            groups.append((start, y))
        start = None
if start is not None:
    groups.append((start, wide.height))
print("satir kumeleri:", groups)

if len(groups) >= 2:
    band_top = 0
    band_bottom = (groups[0][1] + groups[1][0]) // 2
else:
    band_top, band_bottom = 0, wide.height

# Simge bandındaki en büyük bağlantılı parlak kütle üçgen simgedir.
# Zemindeki "veri yağmuru" noktaları küçük ve dağınık olduğu için
# bağlı bileşen analizi simgeyi güvenilir biçimde ayırır.
band = wide.crop((0, band_top, wide.width, band_bottom))

SCALE = 320
small = band.resize((SCALE, max(1, int(band.height * SCALE / band.width))), Image.LANCZOS)
# Üçgen simge doygun mavi olduğu için gri tonda parlak görünmez;
# bu yüzden maske mavi baskınlığına göre kurulur.
sm_rgb = small.convert("RGB")
sw, sh = sm_rgb.size
flags = [
    1 if (b > 110 and b > r + 35) else 0
    for (r, g, b) in list(sm_rgb.getdata())
]

best: tuple[int, tuple[int, int, int, int]] = (0, (0, 0, sw, sh))
seen = [False] * (sw * sh)
for idx in range(sw * sh):
    if not flags[idx] or seen[idx]:
        continue
    stack = [idx]
    seen[idx] = True
    area = 0
    x0 = x1 = idx % sw
    y0 = y1 = idx // sw
    while stack:
        cur = stack.pop()
        cx, cy = cur % sw, cur // sw
        area += 1
        x0, x1 = min(x0, cx), max(x1, cx)
        y0, y1 = min(y0, cy), max(y1, cy)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < sw and 0 <= ny < sh:
                    nidx = ny * sw + nx
                    if flags[nidx] and not seen[nidx]:
                        seen[nidx] = True
                        stack.append(nidx)
    if area > best[0]:
        best = (area, (x0, y0, x1 + 1, y1 + 1))

print("en buyuk kutle alani:", best[0], "kucuk kutu:", best[1])
ratio_x = band.width / sw
ratio_y = band.height / sh
bx0, by0, bx1, by1 = best[1]
pad = int((bx1 - bx0) * ratio_x * 0.05)
sym_box = (
    max(0, int(bx0 * ratio_x) - pad),
    max(0, int(by0 * ratio_y) - pad),
    min(band.width, int(bx1 * ratio_x) + pad),
    min(band.height, int(by1 * ratio_y) + pad),
)
print("simge sinir kutusu:", sym_box)

symbol = flatten(band.crop(sym_box))
print("simge kirpim:", symbol.size)

# Simge kare alanın yaklaşık %80'ini kaplasın.
side = int(max(symbol.size) / 0.8)
canvas = Image.new("RGBA", (side, side), BG)
canvas.paste(symbol, ((side - symbol.width) // 2, (side - symbol.height) // 2), symbol)
canvas.resize((256, 256), Image.LANCZOS).save(OUT_ICON, optimize=True)
print("favicon yazildi: 256x256, kare kenar:", side)