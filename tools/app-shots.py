#!/usr/bin/env python3
"""App screens for the website, from the Unity preview renders.

    python3 tools/app-shots.py [path/to/AR-Trails project]

The renders (Tools/UI/Preview in the app project) use the sample Yambol trail,
never a real phone's location, so they are safe to publish. Each screen goes
to web/public/app/<name>-<en|bg>-<light|dark>.webp at half size: English from
PreviewShots, Bulgarian from PreviewShots-bg (rendered with
ARTRAIL_PREVIEW_LANG=bg). Run it after a build that changed how the app
looks, then commit web/public/app.
"""
import os, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, '..', '..', 'AR-Trails', 'AR-Trails')
FOLDERS = {'en': 'PreviewShots', 'bg': 'PreviewShots-bg'}
OUT = os.path.join(ROOT, 'web', 'public', 'app')
SCREENS = {  # website name: preview render
    'map': '01-map', 'menu': '01c-trail-menu', 'sheet': '05-marker-sheet',
    'question': '20-question', 'correct': '25-correct', 'team': '26-team',
    'trails': '12-trails', 'code': '13-code', 'welcome': '10-welcome',
}
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    if f.endswith('.webp'):
        os.remove(os.path.join(OUT, f))
n = 0
for lang, folder in FOLDERS.items():
    for name, render in SCREENS.items():
        for theme in ('light', 'dark'):
            src = os.path.join(PROJECT, folder, f'{render}-{theme}.png')
            img = Image.open(src).convert('RGB')
            img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
            img.save(os.path.join(OUT, f'{name}-{lang}-{theme}.webp'), 'WEBP', quality=82, method=6)
            n += 1
print('wrote', n, 'screens to', OUT)
