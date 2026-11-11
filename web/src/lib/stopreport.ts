/**
 * The stop summary (round 4, 12 Nov 2026): everything a finished stop holds, on
 * one screen, before the creator moves on. Built only from what the editor has
 * already loaded; nothing here asks the server.
 */

export type ReportMedia = { kind: 'image' | 'audio' | 'video' | 'link' | string; url: string; label: string };

export type ReportStop = {
  number: number;
  titleBg: string; titleEn: string;
  bodyBg: string; bodyEn: string;
  lat: number; lng: number;
  colour: string;
  shape: string;
  answerKind: 'none' | 'exact' | 'choice' | 'free' | string;
  answerLabel: string;
  questionBg: string; questionEn: string;
  choices: { bg: string; en: string; correct: boolean }[];
  accepted: string[];
  points: number | null;
  hints: { bg: string; en: string }[];
  media: ReportMedia[];
  model: { about: string; heightM: number | null; headingDeg: number; url: string } | null;
  questions: boolean;
};

export type ReportStrings = Record<string, string>;

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);


/** What the stop lacks that a walker would notice. Empty when nothing. */
export function reportWarnings(s: ReportStop, S: ReportStrings): string[] {
  const out: string[] = [];
  if (!s.titleBg.trim() || !s.bodyBg.trim()) out.push(S.noBg);
  if (!s.titleEn.trim() || !s.bodyEn.trim()) out.push(S.noEn);
  if (!s.media.some((m) => m.kind === 'image')) out.push(S.noPhoto);
  if (s.questions && s.answerKind !== 'none') {
    if (!s.questionBg.trim() && !s.questionEn.trim()) out.push(S.noQuestion);
    if (s.questionBg.trim() && !s.questionEn.trim()) out.push(S.noQuestionEn);
  }
  return out;
}

function row(label: string, value: string) {
  return `<div class="rep-row"><dt>${esc(label)}</dt><dd>${value}</dd></div>`;
}

/** Fills `host` with the summary. `onMap` gets the box for the small map. */
export function renderStopReport(host: HTMLElement, s: ReportStop, S: ReportStrings, onMap?: (box: HTMLElement) => void) {
  // N, NE, E ... in the page's language, from the four the dial uses.
  const compass = [S.n, S.n + S.e, S.e, S.s + S.e, S.s, S.s + S.w, S.w, S.n + S.w];
  const count = (kind: string) => s.media.filter((m) => m.kind === kind).length;
  const lang = (bg: boolean, en: boolean) =>
    `<span class="rep-lang ${bg ? 'is-on' : ''}">BG</span><span class="rep-lang ${en ? 'is-on' : ''}">EN</span>`;
  const warnings = reportWarnings(s, S);

  const media = s.media.length
    ? `<ul class="rep-media">${s.media.map((m) => m.kind === 'image'
        ? `<li><a href="${esc(m.url)}" target="_blank" rel="noopener" title="${esc(m.label)}"><img src="${esc(m.url)}" alt="${esc(m.label)}" loading="lazy" /></a></li>`
        : `<li><a class="rep-file" href="${esc(m.url)}" target="_blank" rel="noopener" title="${esc(m.label)}"><span class="eyebrow">${esc(S['kind_' + m.kind] ?? m.kind)}</span><span class="rep-file-name">${esc(m.label)}</span></a></li>`).join('')}</ul>`
    : '';

  const model = s.model
    ? `<div class="rep-model">
        ${s.model.url ? `<model-viewer src="${esc(s.model.url)}" loading="eager" camera-controls auto-rotate interaction-prompt="none" camera-orbit="0deg 72deg auto" orientation="0deg 0deg ${180 - s.model.headingDeg}deg" alt=""></model-viewer>` : ''}
        <dl class="rep-list">
          ${s.model.about ? row(S.modelName, esc(s.model.about)) : ''}
          ${row(S.size, s.model.heightM ? `<span class="data">${esc(String(s.model.heightM).replace('.', S.decimal))} m</span>` : '—')}
          ${row(S.facing, `<span class="data">${s.model.headingDeg}° ${esc(compass[Math.round(s.model.headingDeg / 45) % 8])}</span>`)}
        </dl>
      </div>`
    : `<p class="rep-dim">${esc(s.shape)}</p>`;

  const question = !s.questions ? '' : s.answerKind === 'none'
    ? `<p class="rep-dim">${esc(S.noQuestionSet)}</p>`
    : `<dl class="rep-list">
        ${row(S.kind, esc(s.answerLabel) + (s.points != null ? ` · <span class="data">${s.points}</span> ${esc(S.points)}` : ''))}
        ${row('BG', esc(s.questionBg) || '—')}
        ${row('EN', esc(s.questionEn) || '—')}
        ${s.answerKind === 'choice' ? row(S.answers, `<ul class="rep-answers">${s.choices.map((c) =>
          `<li class="${c.correct ? 'is-right' : ''}">${c.correct ? '✓ ' : ''}${esc(c.bg || c.en)}</li>`).join('')}</ul>`) : ''}
        ${s.answerKind === 'exact' && s.accepted.length ? row(S.answers, esc(s.accepted.join(', '))) : ''}
      </dl>`;

  const hints = !s.questions ? '' : s.hints.length
    ? `<ol class="rep-hints">${s.hints.map((h) => `<li>${esc(h.bg || h.en)}</li>`).join('')}</ol>`
    : `<p class="rep-dim">${esc(S.noHints)}</p>`;

  host.innerHTML = `
    <header class="rep-head">
      <span class="rep-pin data" style="--pin:${esc(s.colour)}">${s.number}</span>
      <div class="min-w-0">
        <p class="eyebrow">${esc(S.title)}</p>
        <h3 class="rep-title">${esc(s.titleBg || s.titleEn || S.untitled)}</h3>
        ${s.titleEn && s.titleBg ? `<p class="rep-sub">${esc(s.titleEn)}</p>` : ''}
      </div>
    </header>

    ${warnings.length ? `<ul class="rep-warn" role="status">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}

    <div class="rep-grid">
      <section class="rep-card">
        <h4>${esc(S.place)}</h4>
        <div class="rep-map" data-rep-map></div>
        <p class="data rep-dim">${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}</p>
      </section>

      <section class="rep-card">
        <h4>${esc(S.text)}</h4>
        <dl class="rep-list">
          ${row(S.languages, lang(Boolean(s.titleBg.trim() && s.bodyBg.trim()), Boolean(s.titleEn.trim() && s.bodyEn.trim())))}
          ${row('BG', `<span class="data">${words(s.bodyBg)}</span> ${esc(S.words)} · <span class="data">${s.bodyBg.trim().length}</span> ${esc(S.chars)}`)}
          ${row('EN', `<span class="data">${words(s.bodyEn)}</span> ${esc(S.words)} · <span class="data">${s.bodyEn.trim().length}</span> ${esc(S.chars)}`)}
          ${row(S.colour, `<span class="rep-swatch" style="background:${esc(s.colour)}"></span><span class="data">${esc(s.colour.toUpperCase())}</span>`)}
        </dl>
      </section>

      <section class="rep-card">
        <h4>${esc(S.media)}</h4>
        <p class="rep-counts">
          <span><span class="data">${count('image')}</span> ${esc(S.photos)}</span>
          <span><span class="data">${count('audio')}</span> ${esc(S.audio)}</span>
          <span><span class="data">${count('video') + count('link')}</span> ${esc(S.video)}</span>
        </p>
        ${media}
      </section>

      <section class="rep-card">
        <h4>${esc(S.look)}</h4>
        ${model}
      </section>

      ${s.questions ? `<section class="rep-card rep-wide">
        <h4>${esc(S.question)}</h4>
        ${question}
        <h4 class="rep-gap">${esc(S.hints)}</h4>
        ${hints}
      </section>` : ''}
    </div>`;

  const box = host.querySelector<HTMLElement>('[data-rep-map]');
  if (box && onMap) onMap(box);
}
