// Règle de détection non précisée dans le brief (seuls les paliers de
// récompense et le délai d'expiration à 7 jours y sont indiqués) — inventée
// faute de mieux : sur l'écart avec la commande précédente, pas sur un
// historique plus long. À confirmer avec EBM avant la mise en prod réelle.
export const FREQUENCY_TIERS = [
  { maxDays: 15, percent: 0.15, label: "toutes les 2 semaines" },
  { maxDays: 31, percent: 0.1, label: "mensuelle" },
  { maxDays: 62, percent: 0.05, label: "tous les 2 mois" },
];

export function getFrequencyReward(gapDays: number) {
  return FREQUENCY_TIERS.find((t) => gapDays <= t.maxDays) ?? null;
}
