// Renders the A5 stage's drawings to transparent PNGs for the Unity app
// (Assets/Art/Stage). The website is the source of truth: the scene paths are
// read from RoleScene.astro and the palettes from lib/stage.ts, so a change
// there is one re-run here.
//
//   export PATH=$HOME/.local/node/bin:$PATH
//   node --experimental-strip-types tools/render-stage-sprites.mjs [outDir]
//
// outDir defaults to the app repo's Assets/Art/Stage. Writes the PNGs and, for
// each one that has no .meta yet, a Sprite .meta with a fresh GUID.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '../web');
const require = createRequire(path.join(web, 'package.json'));
const { chromium } = require('playwright');
const { stagePaletteCss } = await import(path.join(web, 'src/lib/stage.ts'));
const { ICONS, GLYPHS } = await import(path.join(web, 'src/lib/role.ts'));

const OUT = process.argv[2] || `${process.env.HOME}/Desktop/ARTrails/AR-Trails/AR-Trails/Assets/Art/Stage`;
fs.mkdirSync(OUT, { recursive: true });

// ---- scene markup, straight from RoleScene.astro ---------------------------
const astro = fs.readFileSync(path.join(web, 'src/components/RoleScene.astro'), 'utf8');
let block = 'M40 194V70H170V194Z';
for (const y of [92, 118, 144, 170]) for (const x of [56, 96, 136]) block += `M${x} ${y}h20v16h-20z`;
block += 'M60 54h90v16h-90z';
const scenes = {};
for (const m of astro.matchAll(/role === '(\w+)' && <Fragment>([\s\S]*?)<\/Fragment>/g)) {
  scenes[m[1]] = m[2].replace('d={block}', `d="${block}"`);
}
const KEYS = ['guide', 'teacher', 'broker', 'other', 'viewer'];
for (const k of KEYS) if (!scenes[k]) throw new Error(`scene ${k} not found in RoleScene.astro`);

// sceneVars() is private to stage.ts, so read the --sc-* values back out of the
// stylesheet it emits (day: bare selectors; night: the data-theme="dark" copy).
const palette = stagePaletteCss();
const sceneVars = (mode, k) => {
  // Match at a line start: the night selectors end with the bare one.
  const sel = `\n${mode === 'night' ? ':root[data-theme="dark"] ' : ''}.stage .scene[data-scene="${k}"]{`;
  const all = '\n' + palette;
  const at = all.lastIndexOf(sel);
  if (at < 0) throw new Error(`no palette for ${mode} ${k}`);
  const body = all.slice(at + sel.length, all.indexOf('}', at));
  return Object.fromEntries(body.split(';').map((d) => d.split(/:(.+)/)).map(([n, v]) => [n.replace('--sc-', ''), v]));
};

// stage.css: .f-* fill, .s-* stroke, each from a --sc-* variable.
const css = (v) => `
  .f-far{fill:${v.far}} .f-fill{fill:${v.fill}} .f-line{fill:${v.line}} .f-tree{fill:${v.tree}}
  .f-trunk{fill:${v.trunk}} .f-crane{fill:${v.crane}} .f-ground{fill:${v.ground}} .f-accent{fill:${v.accent}}
  .f-bg{fill:${v.bg}} .s-line{stroke:${v.line}} .s-grass{stroke:${v.grass}} .s-accent{stroke:${v.accent}}`;

const PIN = 'M13 1a12 12 0 0 1 12 12c0 9-12 20-12 20S1 22 1 13A12 12 0 0 1 13 1z';
const TRAIL = 'M17.2 204.9C56.6 168 78.8 143.4 118.2 136S196.9 140.9 216.6 106.5S270.8 81.8 307.7 89.2';

const jobs = []; // { name, w, h, scale, svg, style? }
for (const mode of ['day', 'night'])
  for (const k of KEYS)
    jobs.push({ name: `scene-${k}-${mode}`, w: 480, h: 200, scale: 3,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200" viewBox="0 0 480 200" style="overflow:visible"><style>${css(sceneVars(mode, k))}</style>${scenes[k]}</svg>` });

jobs.push({ name: 'trail', w: 480, h: 200, scale: 3,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200" viewBox="0 0 480 200"><path fill="none" stroke="#0066cc" stroke-width="2.95" stroke-linecap="round" d="${TRAIL}"/></svg>` });
jobs.push({ name: 'pin', w: 26, h: 34, scale: 4,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34"><path fill="#0066cc" d="${PIN}"/><circle cx="13" cy="13" r="5" fill="#fff"/></svg>` });
jobs.push({ name: 'cloud', w: 120, h: 40, scale: 4,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40"><path fill="#fff" d="M16 40a16 16 0 0 1 3-31.7A21 21 0 0 1 58 5a18 18 0 0 1 31 8 14 14 0 0 1 24 15 12 12 0 0 1 0 12Z"/></svg>` });
// Phone sky bodies (RoleStage.astro, 390 x 392 sky): sun r20 at (360,34), moon
// path at 366,14. Both cropped to a 60-unit square on the body, drawn at 2x.
jobs.push({ name: 'sun', w: 60, h: 60, scale: 2,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="330 4 60 60"><circle cx="360" cy="34" r="20" fill="#fff6d6"/></svg>` });
jobs.push({ name: 'moon', w: 60, h: 60, scale: 2,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="326 4 60 60"><path fill="#f3eccb" d="M366 14a20 20 0 1 0 0 40a26 26 0 0 1 0-40z"/></svg>` });
jobs.push({ name: 'star', w: 16, h: 16, scale: 1,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8" fill="#fff"/></svg>` });

// White 24-unit line glyphs, 96 px. Stroke 2: between the signs (1.8), the seal (1.8-2) and the moment dot (2.6).
const glyph = (name, d) => jobs.push({ name: `icon-${name}`, w: 24, h: 24, scale: 4,
  svg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>` });
for (const [n, d] of Object.entries(ICONS)) glyph(n, d);
for (const [n, d] of Object.entries(GLYPHS)) glyph(n, d);

// ---- render ----------------------------------------------------------------
const browser = await chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` });
const sizes = [];
for (const j of jobs) {
  const ctx = await browser.newContext({ viewport: { width: j.w, height: j.h }, deviceScaleFactor: j.scale });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${j.svg}</body></html>`);
  const file = path.join(OUT, `${j.name}.png`);
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: j.w, height: j.h } });
  await ctx.close();
  sizes.push(`${j.name}.png ${j.w * j.scale}x${j.h * j.scale}`);

  const meta = file + '.meta';
  if (!fs.existsSync(meta)) fs.writeFileSync(meta, spriteMeta(crypto.randomBytes(16).toString('hex'), crypto.randomBytes(8).toString('hex') + '0800000000000000'));
}
await browser.close();
console.log(sizes.join('\n'));

function spriteMeta(guid, spriteId) {
  const plat = (t) => `  - serializedVersion: 4
    buildTarget: ${t}
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 1
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
`;
  return `fileFormatVersion: 2
guid: ${guid}
TextureImporter:
  internalIDToNameTable: []
  externalObjects: {}
  serializedVersion: 13
  mipmaps:
    mipMapMode: 0
    enableMipMap: 0
    sRGBTexture: 1
    linearTexture: 0
    fadeOut: 0
    borderMipMap: 0
    mipMapsPreserveCoverage: 0
    alphaTestReferenceValue: 0.5
    mipMapFadeDistanceStart: 1
    mipMapFadeDistanceEnd: 3
  bumpmap:
    convertToNormalMap: 0
    externalNormalMap: 0
    heightScale: 0.25
    normalMapFilter: 0
    flipGreenChannel: 0
  isReadable: 0
  streamingMipmaps: 0
  streamingMipmapsPriority: 0
  vTOnly: 0
  ignoreMipmapLimit: 0
  grayScaleToAlpha: 0
  generateCubemap: 6
  cubemapConvolution: 0
  seamlessCubemap: 0
  textureFormat: 1
  maxTextureSize: 2048
  textureSettings:
    serializedVersion: 2
    filterMode: 1
    aniso: 1
    mipBias: 0
    wrapU: 1
    wrapV: 1
    wrapW: 1
  nPOTScale: 0
  lightmap: 0
  compressionQuality: 50
  spriteMode: 1
  spriteExtrude: 1
  spriteMeshType: 1
  alignment: 0
  spritePivot: {x: 0.5, y: 0.5}
  spritePixelsToUnits: 100
  spriteBorder: {x: 0, y: 0, z: 0, w: 0}
  spriteGenerateFallbackPhysicsShape: 1
  alphaUsage: 1
  alphaIsTransparency: 1
  spriteTessellationDetail: -1
  textureType: 8
  textureShape: 1
  singleChannelComponent: 0
  flipbookRows: 1
  flipbookColumns: 1
  maxTextureSizeSet: 0
  compressionQualitySet: 0
  textureFormatSet: 0
  ignorePngGamma: 0
  applyGammaDecoding: 0
  swizzle: 50462976
  cookieLightType: 0
  platformSettings:
  - serializedVersion: 4
    buildTarget: DefaultTexturePlatform
    maxTextureSize: 2048
    resizeAlgorithm: 0
    textureFormat: -1
    textureCompression: 1
    compressionQuality: 50
    crunchedCompression: 0
    allowsAlphaSplitting: 0
    overridden: 0
    ignorePlatformSupport: 0
    androidETC2FallbackOverride: 0
    forceMaximumCompressionQuality_BC6H_BC7: 0
${plat('Standalone')}${plat('Android')}${plat('iOS')}  spriteSheet:
    serializedVersion: 2
    sprites: []
    outline: []
    customData: 
    physicsShape: []
    bones: []
    spriteID: ${spriteId}
    internalID: 0
    vertices: []
    indices: 
    edges: []
    weights: []
    secondaryTextures: []
    spriteCustomMetadata:
      entries: []
    nameFileIdTable: {}
  mipmapLimitGroupName: 
  pSDRemoveMatte: 0
  userData: 
  assetBundleName: 
  assetBundleVariant: 
`;
}
