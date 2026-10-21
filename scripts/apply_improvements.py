#!/usr/bin/env python3
import os, json
from PIL import Image

# ---------- 1. thumbnails ----------
refs = ['coat-men-1.jpg','coat-men-2.webp','coat-men-3.webp','coat-men-4.jpg','coat-men-5.webp',
        'set-kids-1.webp','coat-women-1.jpg','helmet-men-1.webp','helmet-women-1.webp','helmet-kids-1.webp',
        'goggles-men-1.webp','goggles-men-2.webp','goggles-men-3.webp','goggles-women-1.webp','goggles-women-2.webp',
        'goggles-kids-1.webp','gloves-men-1.webp','gloves-women-1.webp',
        'pants-men-1.webp','pants-women-1.webp']
entries = []
for f in refs:
    src = os.path.join('images', f)
    im = Image.open(src)
    w, h = im.size
    scale = min(1.0, 560 / max(w, h))
    nw, nh = round(w*scale), round(h*scale)
    im2 = im.convert('RGBA') if im.mode not in ('RGB','RGBA') else im
    if scale < 1.0:
        im2 = im2.resize((nw, nh), Image.LANCZOS)
    if im2.mode == 'RGBA':
        bg = Image.new('RGB', im2.size, (255,255,255))
        bg.paste(im2, mask=im2.split()[-1])
        im2 = bg
    base = 'thumb-' + os.path.splitext(f)[0] + '.webp'
    im2.save(os.path.join('images', base), 'WEBP', quality=82, method=6)
    entries.append("        'images/%s': { src: 'images/%s', w: %d, h: %d }" % (f, base, nw, nh))
thumbmap = '{\n' + ',\n'.join(entries) + '\n    }'

# ---------- 2. index.html ----------
html = open('index.html', encoding='utf-8').read()
def rep(old, new, count=1):
    global html
    n = html.count(old)
    assert n == count, 'expected %d found %d: %r' % (count, n, old[:80])
    html = html.replace(old, new, count)

bundles_marker = '    <!-- ================= BUNDLES ================= -->\n'
booking_marker = '    <!-- ================= BOOKING / DATES ================= -->\n'
catalog_marker = '    <!-- ================= CATALOG ================= -->\n'
main_marker = '<main class="container">\n'
b_start = html.index(bundles_marker)
bk_start = html.index(booking_marker)
c_start = html.index(catalog_marker)
bundles_block = html[b_start:bk_start]
booking_block = html[bk_start:c_start]
html = html[:b_start] + html[c_start:]
main_idx = html.index(main_marker) + len(main_marker)
html = html[:main_idx] + '\n' + bundles_block + booking_block.rstrip() + '\n\n' + html[main_idx:].lstrip('\n')

kd = ' role="button" tabindex="0" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();this.click();}"'
rep('<a class="nav-link" onclick="openReviewsModal()">', '<a class="nav-link" onclick="openReviewsModal()"' + kd + '>')
rep('<a class="nav-link" onclick="openOrderHistoryModal()">', '<a class="nav-link" onclick="openOrderHistoryModal()"' + kd + '>')
rep('<a class="nav-link" onclick="showModal(\'contactModal\')">', '<a class="nav-link" onclick="showModal(\'contactModal\')"' + kd + '>')
rep('<a class="nav-link" id="lang-toggle-btn" onclick="toggleLanguage()" aria-label="Switch language">', '<a class="nav-link" id="lang-toggle-btn" onclick="toggleLanguage()" aria-label="Switch language"' + kd + '>')
rep('<a class="nav-link nav-cart" onclick="showModal(\'cartModal\')">', '<a class="nav-link nav-cart" onclick="showModal(\'cartModal\')"' + kd + '>')

rep('<select id="reviews-star-filter" onchange="renderReviewsPublic()">', '<select id="reviews-star-filter" aria-label="סינון ביקורות לפי דירוג" onchange="renderReviewsPublic()">')
rep('<select id="reviews-sort" onchange="renderReviewsPublic()">', '<select id="reviews-sort" aria-label="מיון ביקורות" onchange="renderReviewsPublic()">')
rep('<input type="password" id="admin-login-input"', '<input type="password" id="admin-login-input" aria-label="סיסמת מנהל"')

rep("ofLabel: (n) => `מתוך ${n}`,", "ofLabel: (n) => `מתוך ${n}`,\n            showMoreItems: (n) => `הצג עוד ${n} פריטים`, showLessItems: 'הצג פחות',")
rep("ofLabel: (n) => `of ${n}`,", "ofLabel: (n) => `of ${n}`,\n            showMoreItems: (n) => `Show ${n} more items`, showLessItems: 'Show less',")

anchor = "    products = products.filter(p => !p.image.includes('placehold.jp'));\n"
thumbs_js = anchor + "\n    // גרסאות מוקטנות של תמונות המוצר לכרטיסים בקטלוג (התמונה המלאה נשמרת לתצוגה מוגדלת).\n    const imageThumbs = " + thumbmap + ";\n\n    // קיצור הגלילה בקטלוג: מציגים 4 פריטים ראשונים בכל קטגוריה, עם כפתור להצגת השאר\n    const CAT_INITIAL_COUNT = 4;\n    const expandedCats = {};\n"
rep(anchor, thumbs_js)

old_render_head = """    function render() {
        cats.forEach(c => {
            const gridEl = document.getElementById(`grid-${c}`);
            if (gridEl) gridEl.innerHTML = '';
        });

        const filtered = products.filter(p => (currentCat === 'all' || p.cat === currentCat) && (currentGender === 'all' || p.gender === currentGender));
        
        filtered.forEach(p => {"""
new_render_head = """    function render() {
        cats.forEach(c => {
            const gridEl = document.getElementById(`grid-${c}`);
            if (gridEl) gridEl.innerHTML = '';
            const oldToggle = document.getElementById(`cat-more-${c}`);
            if (oldToggle) oldToggle.remove();
        });

        const filtered = products.filter(p => (currentCat === 'all' || p.cat === currentCat) && (currentGender === 'all' || p.gender === currentGender));
        const isFiltered = currentCat !== 'all' || currentGender !== 'all';
        const byCat = {};
        filtered.forEach(p => { (byCat[p.cat] = byCat[p.cat] || []).push(p); });

        Object.keys(byCat).forEach(catName => {
            const catList = byCat[catName];
            const expanded = isFiltered || expandedCats[catName];
            const visibleList = expanded ? catList : catList.slice(0, CAT_INITIAL_COUNT);
            visibleList.forEach(p => renderProductCard(p));

            const targetGrid = document.getElementById(`grid-${catName}`);
            if (!targetGrid || isFiltered || catList.length <= CAT_INITIAL_COUNT) return;
            const wrap = document.createElement('div');
            wrap.className = 'show-more-wrap';
            wrap.id = `cat-more-${catName}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-outline show-more-btn';
            btn.textContent = expanded ? t('showLessItems') : t('showMoreItems', catList.length - CAT_INITIAL_COUNT);
            btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            btn.onclick = () => { expandedCats[catName] = !expandedCats[catName]; render(); };
            wrap.appendChild(btn);
            targetGrid.after(wrap);
        });
    }

    function renderProductCard(p) {"""
rep(old_render_head, new_render_head)

old_tail = """                </article>`;
        });
    }

    function getProductStock(id) {"""
new_tail = """                </article>`;
    }

    function getProductStock(id) {"""
rep(old_tail, new_tail)

old_img = """            const imageHTML = p.images ? `
                <div class="img-slider">
                    <img id="img-${p.id}" loading="lazy" decoding="async"
                        src="${p.images[0]}" 
                        alt="${translateProductName(p)}"
                        onclick="openLightbox('${p.images[0]}')"
                        ontouchstart="handleTouchStart(event)"
                        ontouchend="handleTouchEnd(event, '${p.id}')">
                    <button onclick="prevImage('${p.id}')" class="image-nav-btn prev">‹</button>
                    <button onclick="nextImage('${p.id}')" class="image-nav-btn next">›</button>
                </div>
            ` : `<img loading="lazy" decoding="async" src="${p.image}" alt="${translateProductName(p)}" onclick="openLightbox('${p.image}')" title="לחץ להגדלה">`;"""
new_img = """            const thumb = imageThumbs[p.image];
            const cardSrc = thumb ? thumb.src : p.image;
            const dimAttrs = thumb ? ` width="${thumb.w}" height="${thumb.h}"` : '';
            const imageHTML = p.images ? `
                <div class="img-slider">
                    <img id="img-${p.id}" loading="lazy" decoding="async"
                        src="${p.images[0]}"${dimAttrs}
                        alt="${translateProductName(p)}"
                        onclick="openLightbox('${p.images[0]}')"
                        ontouchstart="handleTouchStart(event)"
                        ontouchend="handleTouchEnd(event, '${p.id}')">
                    <button onclick="prevImage('${p.id}')" class="image-nav-btn prev" aria-label="תמונה קודמת">‹</button>
                    <button onclick="nextImage('${p.id}')" class="image-nav-btn next" aria-label="תמונה הבאה">›</button>
                </div>
            ` : `<img loading="lazy" decoding="async" src="${cardSrc}"${dimAttrs} alt="${translateProductName(p)}" onclick="openLightbox('${p.image}')" title="לחץ להגדלה">`;"""
rep(old_img, new_img)

rep("""<select id="size-${p.id}" class="card-select" onchange="onSizeChange('${p.id}')">""",
    """<select id="size-${p.id}" class="card-select" aria-label="${t('sizeLabel')} ${translateProductName(p)}" onchange="onSizeChange('${p.id}')">""")
rep("""<input id="qty-${p.id}" type="text" inputmode="numeric" value="${cartQ}" readonly>""",
    """<input id="qty-${p.id}" type="text" inputmode="numeric" value="${cartQ}" readonly aria-label="${t('qtyLabel')} ${translateProductName(p)}">""")
rep("""<img class="ci-thumb" src="${productData.image}" alt="">""",
    """<img class="ci-thumb" src="${(imageThumbs[productData.image] || {}).src || productData.image}" alt="${translateProductName(productData)}" width="64" height="64">""")

open('index.html', 'w', encoding='utf-8').write(html)

# ---------- 3. styles.css ----------
css = open('styles.css', encoding='utf-8').read()
old1 = """.features {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
  margin-top: -48px;
}"""
new1 = """.features {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
}"""
assert css.count(old1) == 1
css = css.replace(old1, new1)
old2 = ".features { grid-template-columns: 1fr; gap: 10px; margin-top: -40px; }"
assert css.count(old2) == 1
css = css.replace(old2, ".features { grid-template-columns: 1fr; gap: 10px; }")
css += "\n/* show-more toggle for long catalog categories */\n.show-more-wrap { display: flex; justify-content: center; margin: 18px 0 8px; }\n.show-more-btn { min-width: 220px; }\n"
open('styles.css', 'w', encoding='utf-8').write(css)

# ---------- 4. vercel.json ----------
vercel = {
  "headers": [
    { "source": "/images/(.*)", "headers": [
        { "key": "Cache-Control", "value": "public, max-age=2592000, stale-while-revalidate=86400" } ] },
    { "source": "/(.*)", "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" } ] }
  ],
  "redirects": [
    { "source": "/((?!api/).*)",
      "has": [{ "type": "host", "value": "skirent-ten.vercel.app" }],
      "destination": "https://ski.surfrent-il.com/$1",
      "permanent": True }
  ]
}
open('vercel.json', 'w', encoding='utf-8').write(json.dumps(vercel, indent=2, ensure_ascii=False) + '\n')
print('all edits applied')
