export const POINTS_MILESTONES = [
  { points: 200, percent: 0.05 },
  { points: 500, percent: 0.1 },
  { points: 1000, percent: 0.15 },
  // Le brief indique 10% à ce palier, inférieur au 15% du palier précédent —
  // coquille probable (valeurs signalées comme à reconfirmer dans le brief).
  // Corrigé en attendant confirmation d'EBM.
  { points: 2000, percent: 0.2 },
];

export function getClaimableMilestones(
  lifetimePoints: number,
  claimedMilestonePoints: number[],
) {
  return POINTS_MILESTONES.filter(
    (m) => lifetimePoints >= m.points && !claimedMilestonePoints.includes(m.points),
  );
}
