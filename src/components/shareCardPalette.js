// Shared color palette for the share-card family (ShareCard, StreakShareCard,
// InviteShareCard). Two variants: "dark" punches on social feeds; "cream"
// stays on-brand with the light-mode app and matches the Lemme/Bloom-adjacent
// Gen Z wellness visual lane.

export function shareCardPalette(variant) {
  if (variant === 'cream') {
    return {
      gradient: ['#fbf5e6', '#f0e4c5'],
      glow: 'rgba(196,168,108,0.28)',
      wordmark: '#8a6f3a',
      label: '#6b6357',
      accent: '#c4a86c',
      goldDeep: '#8a6f3a',
      body: '#2a2620',
      muted: '#6b6357',
    };
  }
  return {
    gradient: ['#1a1612', '#0f0d0a'],
    glow: 'rgba(196,168,108,0.18)',
    wordmark: '#c4a86c',
    label: '#8a8070',
    accent: '#c4a86c',
    goldDeep: '#c4a86c',
    body: '#e8e0d4',
    muted: '#8a8070',
  };
}
