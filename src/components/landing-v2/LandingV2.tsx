// Landing v2 — cinematic + three-track redesign orchestrator.
// Section order: Hero → Analytics → Studio → ShowcaseReel → Tools → Pricing → FAQ → CTA
// + TimelineBar (fixed at bottom, outside flow)
//
// All layout/animation CSS is injected here. Does NOT touch globals.css.

import HeroCinema     from '@/components/landing-v2/HeroCinema'
import AnalyticsTrack from '@/components/landing-v2/AnalyticsTrack'
import StudioTrack    from '@/components/landing-v2/StudioTrack'
import ProcessScene   from '@/components/landing-v2/ProcessScene'
import ShowcaseReel   from '@/components/landing-v2/ShowcaseReel'
import ToolsTrack     from '@/components/landing-v2/ToolsTrack'
import PricingGlass   from '@/components/landing-v2/PricingGlass'
import FaqV2          from '@/components/landing-v2/FaqV2'
import CtaFinal       from '@/components/landing-v2/CtaFinal'
import TimelineBar    from '@/components/landing-v2/TimelineBar'
import type { CSSProperties } from 'react'

// V2 palette — self-contained, does NOT touch globals.css
// WCAG: text 16.94 AAA · text-sec 6.86 AA · accent 8.71 AAA
const ROOT_VARS: CSSProperties = {
  '--v2-bg':       '#0E0E0E',
  '--v2-surface':  '#171717',
  '--v2-text':     '#F0F0F0',
  '--v2-text-sec': '#9A9A9A',
  '--v2-accent':   '#E8A020',
  '--v2-border':   'rgba(255,255,255,0.08)',
  background:      '#0E0E0E',
  color:           '#F0F0F0',
  minHeight:       '100vh',
  // ── Unified spacing scale (Step 6 — eliminates vertical gaps) ────────────
  '--lv2-py-section': 'clamp(64px, 8vw, 96px)',    // section vertical padding
  '--lv2-px-content': 'clamp(20px, 4vw, 64px)',    // horizontal content padding
} as CSSProperties

// ── Step 6 spacing scale documentation ─────────────────────────────────────
// | Token              | Value                    | Usage                     |
// |--------------------|--------------------------|---------------------------|
// | --lv2-py-section   | clamp(64px, 8vw, 96px)  | ALL section padding-top/bottom |
// | --lv2-px-content   | clamp(20px, 4vw, 64px)  | ALL section padding-left/right |
// | gap (asym grid)    | clamp(32px, 5vw, 64px)  | Left/right col gap        |
// | gap (cards)        | 10–12px                 | Card grid gaps            |
// | gap (steps list)   | 24–32px                 | Studio step gaps          |
// Old bug: FaqV2 used hardcoded 96px, ShowcaseReel used clamp(56px,7vw,88px)
// — both now read var(--lv2-py-section) or have been removed.

const CSS = `
/* ── Global resets scoped to v2 ─────────────────────────────────────────── */
.lv2-root *, .lv2-root *::before, .lv2-root *::after { box-sizing: border-box; }
.lv2-root textarea { color-scheme: dark; }
.lv2-root { overflow-x: hidden; }

/* ── Bottom padding so content isn't hidden behind TimelineBar ─────────── */
@media (min-width: 640px) {
  .lv2-root { padding-bottom: 52px; }
}

/* ══════════════════════════════════════════════════════════════════════════
   ASYMMETRIC GRID — used by Analytics, Studio, Tools, Pricing, FAQ sections
   Left col: section label (~220px). Right col: content (1fr).
   Step 7: replaces all centered-column layouts.
══════════════════════════════════════════════════════════════════════════ */
.lv2-asym {
  display: grid;
  grid-template-columns: clamp(200px, 22vw, 280px) 1fr;
  gap: clamp(32px, 5vw, 64px);
  align-items: start;
}
/* Left-column section titles: compact font prevents wrapping in narrow label column */
.lv2-asym > :first-child h2 {
  font-size: clamp(18px, 2.2vw, 26px) !important;
}
@media (max-width: 860px) {
  .lv2-asym { grid-template-columns: 1fr; gap: 28px; }
}

/* ══════════════════════════════════════════════════════════════════════════
   PRICING GRID (used by PricingGlass inside .lv2-asym right col)
══════════════════════════════════════════════════════════════════════════ */
.lv2-pricing-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 12px;
}

/* ══════════════════════════════════════════════════════════════════════════
   HERO CINEMA
══════════════════════════════════════════════════════════════════════════ */
.lv2c-hero {
  position: relative;
  height: 100svh;
  min-height: 600px;
  overflow: hidden;
}
@keyframes lv2c-heroBgScale {
  from { transform: scale(1); }
  to   { transform: scale(1.08); }
}
.lv2c-hero-bg {
  position: absolute; inset: 0;
  will-change: transform;
  animation: lv2c-heroBgScale 22s ease-in-out forwards;
}
.lv2c-hero-bg-static { animation: none !important; }
.lv2c-hero-overlay {
  position: absolute; inset: 0;
  background: linear-gradient(105deg,
    rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.55) 46%, rgba(0,0,0,0.12) 100%);
  pointer-events: none;
}
.lv2c-hero-inner {
  position: absolute; inset: 0;
  display: flex; align-items: flex-start;
  padding: clamp(24px, 5vh, 60px) clamp(24px, 5vw, 72px);
}
.lv2c-glass {
  width: min(46%, 560px);
  background: rgba(8,8,8,0.56);
  backdrop-filter: blur(22px) saturate(0.65);
  -webkit-backdrop-filter: blur(22px) saturate(0.65);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 18px;
  padding: clamp(24px, 3.5vw, 52px);
  display: flex; flex-direction: column; gap: 18px;
}
@media (max-width: 767px) {
  .lv2c-glass { width: 100%; border-radius: 14px; padding: 22px; }
}

/* ══════════════════════════════════════════════════════════════════════════
   ANALYTICS + STUDIO + TOOLS — card and step reveal
   transform + opacity only; prefers-reduced-motion at bottom.
══════════════════════════════════════════════════════════════════════════ */

/* Group cards (Analytics) */
.lv2c-group-card {
  border-radius: 12px;
  border: 1px solid var(--v2-border);
  display: flex; flex-direction: column;
  opacity: 0;
  transform: translateY(16px);
  transition: opacity 380ms ease, transform 380ms ease;
}
.lv2c-group-card.lv2c-in { opacity: 1; transform: translateY(0); }

/* Studio steps — compact grid cards */
.lv2c-studio-step {
  display: flex; flex-direction: column;
  gap: 8px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--v2-border);
  background: rgba(255,255,255,0.02);
  opacity: 0; transform: translateY(16px);
  transition: opacity 420ms ease, transform 420ms ease, border-color 180ms ease;
}
.lv2c-studio-step.lv2c-in { opacity: 1; transform: translateY(0); }
.lv2c-studio-step:hover { border-color: rgba(232,160,32,0.3); }

/* Tool cards */
.lv2c-tool-card {
  opacity: 0; transform: translateY(14px);
  transition: opacity 360ms ease, transform 360ms ease;
}
.lv2c-tool-card.lv2c-in { opacity: 1; transform: translateY(0); }

/* ══════════════════════════════════════════════════════════════════════════
   HERO — textarea calculator (fixed height, textarea scrolls internally)
══════════════════════════════════════════════════════════════════════════ */
.lv2c-calc-textarea {
  width: 100%;
  height: 168px;
  resize: none;
  background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.13);
  border-radius: 10px;
  padding: 12px 14px;
  font-size: 13px;
  line-height: 1.6;
  color: rgba(255,255,255,0.88);
  font-family: var(--font-geist-sans, sans-serif);
  outline: none;
  color-scheme: dark;
  overflow-y: auto;
}
@media (max-height: 750px) { .lv2c-calc-textarea { height: 110px; } }
@media (max-width: 767px)  { .lv2c-calc-textarea { height: 110px; } }

/* ══════════════════════════════════════════════════════════════════════════
   PROCESS SCENE (animated desktop; static mobile/reduced-motion)
══════════════════════════════════════════════════════════════════════════ */
.lv2c-process-outer  { display: none; }
.lv2c-process-static { display: block; }

@media (min-width: 768px) {
  .lv2c-process-outer {
    display: block;
    position: relative;
    height: 300vh;
    background: var(--v2-bg);
    border-top: 1px solid var(--v2-border);
  }
  .lv2c-process-static { display: none; }
}

.lv2c-process-sticky {
  position: sticky; top: 0;
  height: 100svh; min-height: 500px;
  display: flex; flex-direction: column;
  padding: var(--lv2-py-section) var(--lv2-px-content);
  overflow: hidden;
}

.lv2c-plines-wrap {
  position: absolute; inset: 0;
  padding: var(--lv2-px-content);
  display: flex; flex-direction: column;
  justify-content: center;
  gap: clamp(4px, 1vh, 10px);
}

.lv2c-pgrid {
  position: absolute; inset: 0;
  padding: 0 var(--lv2-px-content) clamp(80px, 14vh, 160px);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  align-content: center;
}

/* ══════════════════════════════════════════════════════════════════════════
   STUDIO GRID — fixed 4/2/1 columns (STUDIO_STEPS.length = 8 = 4×2, no orphans)
══════════════════════════════════════════════════════════════════════════ */
.lv2c-studio-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  align-content: start;
}
@media (max-width: 860px) { .lv2c-studio-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 480px) { .lv2c-studio-grid { grid-template-columns: 1fr; } }

/* ══════════════════════════════════════════════════════════════════════════
   SHOWCASE REEL — bento grid (12-col, 3 rows, 6 images, varied sizes)
══════════════════════════════════════════════════════════════════════════ */
.lv2c-reel-grid {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  grid-auto-rows: clamp(160px, 15vw, 220px);
  gap: 10px;
}
/* Bento positions (desktop) */
.lv2c-reel-p0 { grid-column: 1 / 9;  grid-row: 1; }
.lv2c-reel-p1 { grid-column: 9 / 13; grid-row: 1 / 3; }
.lv2c-reel-p2 { grid-column: 1 / 5;  grid-row: 2; }
.lv2c-reel-p3 { grid-column: 5 / 9;  grid-row: 2; }
.lv2c-reel-p4 { grid-column: 1 / 7;  grid-row: 3; }
.lv2c-reel-p5 { grid-column: 7 / 13; grid-row: 3; }
/* Mobile: 2-column flow, reset explicit placement */
@media (max-width: 767px) {
  .lv2c-reel-grid {
    grid-template-columns: repeat(2, 1fr);
    grid-auto-rows: clamp(130px, 25vw, 190px);
  }
  .lv2c-reel-p0, .lv2c-reel-p1, .lv2c-reel-p2,
  .lv2c-reel-p3, .lv2c-reel-p4, .lv2c-reel-p5 {
    grid-column: auto;
    grid-row: auto;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   FAQ — two-column layout on wide screens
══════════════════════════════════════════════════════════════════════════ */
.lv2c-faq-list {
  display: flex; flex-direction: column;
  gap: 2px; width: 100%;
}
@media (min-width: 1100px) {
  .lv2c-faq-list {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    align-items: start;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   CTA FINAL
══════════════════════════════════════════════════════════════════════════ */
.lv2c-cta {
  position: relative; height: 100svh; min-height: 560px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
}

/* ══════════════════════════════════════════════════════════════════════════
   TIMELINE BAR (Step 5)
   Desktop: 3-track fixed bar. Mobile: single thin progress bar.
══════════════════════════════════════════════════════════════════════════ */
.lv2c-timeline  { display: none; }  /* hidden on mobile */
.lv2c-tl-mobile { display: block; } /* visible on mobile */

@media (min-width: 640px) {
  .lv2c-timeline  { display: flex; }
  .lv2c-tl-mobile { display: none; }
}

/* ══════════════════════════════════════════════════════════════════════════
   SHOWCASE REEL (retained from cinematic version)
══════════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════════
   REDUCED-MOTION OVERRIDES (Step 8)
   All movement is transform + opacity. Nothing else is animated.
══════════════════════════════════════════════════════════════════════════ */
@media (prefers-reduced-motion: reduce) {
  .lv2c-hero-bg                 { animation: none !important; }
  .lv2c-group-card,
  .lv2c-studio-step,
  .lv2c-tool-card               { opacity: 1 !important; transform: none !important; transition: none !important; }
  [style*="transition"]         { transition: none !important; }
  .lv2c-process-outer           { display: none !important; }
  .lv2c-process-static          { display: block !important; }
}
`

export default function LandingV2() {
  return (
    <div className="lv2-root" style={ROOT_VARS}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── Sections — three-track structure ───────────────────────────── */}
      <HeroCinema />
      <AnalyticsTrack />
      <StudioTrack />
      <ProcessScene />     {/* visual demo immediately after Studio */}
      <ShowcaseReel />
      <ToolsTrack />
      <PricingGlass />
      <FaqV2 />
      <CtaFinal />

      {/* ── Fixed timeline bar (outside document flow) ─────────────────── */}
      <TimelineBar />
    </div>
  )
}
