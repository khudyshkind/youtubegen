// Shared config — single source of truth for /tools page, /analytics page, and dashboard.
// No React imports here; labels are resolved via t(labelKey) in each component.

export const TOOL_CARDS = [
  {
    slug: 'script-gen',
    emoji: '📝',
    titleKey: 'tools.card_script',
    descKey: 'tools.card_script_desc',
    accent: { bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)', hover: 'rgba(124,58,237,0.35)', color: '#a78bfa' },
  },
  {
    slug: 'seo',
    emoji: '🎯',
    titleKey: 'tools.card_seo',
    descKey: 'tools.card_seo_desc',
    accent: { bg: 'rgba(59,130,246,0.08)', border: 'rgba(59,130,246,0.2)', hover: 'rgba(59,130,246,0.35)', color: '#60a5fa' },
  },
  {
    slug: 'repack',
    emoji: '🔁',
    titleKey: 'tools.card_repack',
    descKey: 'tools.card_repack_desc',
    accent: { bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.2)', hover: 'rgba(16,185,129,0.35)', color: '#34d399' },
  },
  {
    slug: 'uniqueize',
    emoji: '✍️',
    titleKey: 'tools.card_uniqueizer',
    descKey: 'tools.card_uniqueizer_desc',
    accent: { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)', hover: 'rgba(245,158,11,0.35)', color: '#fbbf24' },
  },
  {
    slug: 'tts',
    emoji: '🎙️',
    titleKey: 'tools.card_tts',
    descKey: 'tools.card_tts_desc',
    accent: { bg: 'rgba(236,72,153,0.08)', border: 'rgba(236,72,153,0.2)', hover: 'rgba(236,72,153,0.35)', color: '#f472b6' },
  },
  {
    slug: 'thumbnail-gen',
    emoji: '🖼️',
    titleKey: 'tools.card_thumb',
    descKey: 'tools.card_thumb_desc',
    accent: { bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.2)', hover: 'rgba(249,115,22,0.35)', color: '#fb923c' },
  },
  {
    slug: 'titles-by-niche',
    emoji: '📊',
    titleKey: 'tools.card_titles_niche',
    descKey: 'tools.card_titles_niche_desc',
    accent: { bg: 'rgba(6,182,212,0.08)', border: 'rgba(6,182,212,0.2)', hover: 'rgba(6,182,212,0.35)', color: '#22d3ee' },
  },
  {
    slug: 'subtitles',
    emoji: '🎧',
    titleKey: 'tools.card_subtitles',
    descKey: 'tools.card_subtitles_desc',
    accent: { bg: 'rgba(20,184,166,0.08)', border: 'rgba(20,184,166,0.2)', hover: 'rgba(20,184,166,0.35)', color: '#2dd4bf' },
  },
  {
    slug: 'illustrations',
    emoji: '🖌️',
    titleKey: 'tools.card_illustrations',
    descKey: 'tools.card_illustrations_desc',
    accent: { bg: 'rgba(168,85,247,0.08)', border: 'rgba(168,85,247,0.2)', hover: 'rgba(168,85,247,0.35)', color: '#c084fc' },
  },
]

export type AnalyticsGroupConfig = {
  groupKey: string
  accent?: boolean
  tabs: Array<{ id: string; labelKey: string; icon: string; descKey: string; showInDashboard: boolean }>
}

export const ANALYTICS_GROUPS: AnalyticsGroupConfig[] = [
  {
    groupKey: 'analytics.group_start',
    accent: true,
    tabs: [
      { id: 'niche_finder', labelKey: 'analytics.tab_niche_finder', icon: '🎯', descKey: 'analytics.desc_niche_finder', showInDashboard: true },
      { id: 'channel_plan', labelKey: 'analytics.tab_channel_plan', icon: '🚀', descKey: 'analytics.desc_channel_plan', showInDashboard: true },
    ],
  },
  {
    groupKey: 'analytics.group_research',
    tabs: [
      { id: 'trends',   labelKey: 'analytics.tab_trends',   icon: '🔥', descKey: 'analytics.desc_trends',   showInDashboard: true },
      { id: 'keywords', labelKey: 'analytics.tab_keywords', icon: '🔑', descKey: 'analytics.desc_keywords', showInDashboard: true },
      { id: 'revenue',  labelKey: 'analytics.tab_revenue',  icon: '💰', descKey: 'analytics.desc_revenue',  showInDashboard: true },
    ],
  },
  {
    groupKey: 'analytics.group_competitors',
    tabs: [
      { id: 'niche',        labelKey: 'analytics.tab_niche',        icon: '🧭', descKey: 'analytics.desc_niche',        showInDashboard: true },
      { id: 'sub_niche',   labelKey: 'analytics.tab_sub_niche',   icon: '🔍', descKey: 'analytics.desc_sub_niche',   showInDashboard: true },
      { id: 'channel',     labelKey: 'analytics.tab_channel',      icon: '📊', descKey: 'analytics.desc_channel',      showInDashboard: true },
      { id: 'compare',      labelKey: 'analytics.tab_compare',      icon: '⚖️', descKey: 'analytics.desc_compare',      showInDashboard: true },
      { id: 'rising_stars', labelKey: 'analytics.tab_rising_stars', icon: '⭐', descKey: 'analytics.desc_rising_stars', showInDashboard: true },
      { id: 'comments',     labelKey: 'analytics.tab_comments',     icon: '💬', descKey: 'analytics.desc_comments',     showInDashboard: true },
    ],
  },
  {
    groupKey: 'analytics.group_history',
    tabs: [
      // showInDashboard=false: this is the user's request log, not a report type
      { id: 'history', labelKey: 'analytics.tab_history', icon: '📋', descKey: 'analytics.desc_history', showInDashboard: false },
    ],
  },
]

// Studio pipeline steps — mirrors StepWizard.tsx steps 1-8 exactly (studio.step* keys defined in i18n.ts:91-98)
export const STUDIO_STEPS = [
  { icon: '💡', labelKey: 'studio.step1' },
  { icon: '📋', labelKey: 'studio.step2' },
  { icon: '📝', labelKey: 'studio.step3' },
  { icon: '🎙️', labelKey: 'studio.step4' },
  { icon: '🎧', labelKey: 'studio.step5' },
  { icon: '🖌️', labelKey: 'studio.step6' },
  { icon: '🎬', labelKey: 'studio.step7' },
  { icon: '🎯', labelKey: 'studio.step8' },
]
