import type { PrismaClient } from "@prisma/client";

export type LoyaltyTier = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";

const TIER_ORDER: LoyaltyTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];

const TIER_THRESHOLDS: Array<{ tier: LoyaltyTier; minPoints: number }> = [
  { tier: "PLATINUM", minPoints: 2000 },
  { tier: "GOLD", minPoints: 1000 },
  { tier: "SILVER", minPoints: 500 },
  { tier: "BRONZE", minPoints: 50 },
];

// Le niveau qu'un cumul de points suffirait à atteindre, indépendamment de ce
// que le client a déjà (fonction pure, ne regarde que le nombre).
export function getTierForPoints(points: number): LoyaltyTier | null {
  const match = TIER_THRESHOLDS.find((t) => points >= t.minPoints);
  return match?.tier ?? null;
}

export function getTierThreshold(tier: LoyaltyTier): number {
  return TIER_THRESHOLDS.find((t) => t.tier === tier)!.minPoints;
}

export function getTierRank(tier: LoyaltyTier | null): number {
  return tier ? TIER_ORDER.indexOf(tier) : -1;
}

export function getNextTier(tier: LoyaltyTier | null): LoyaltyTier | null {
  const index = tier ? TIER_ORDER.indexOf(tier) : -1;
  return TIER_ORDER[index + 1] ?? null;
}

// Un cran en dessous — utilisé pour la descente progressive, jamais pour un
// recalcul complet (voir décision utilisateur du 2026-08-10).
export function getTierOneStepDown(tier: LoyaltyTier): LoyaltyTier | null {
  const index = TIER_ORDER.indexOf(tier);
  return index > 0 ? TIER_ORDER[index - 1] : null;
}

const ROLLING_WINDOW_DAYS = 365;

// Types de transaction qui comptent pour le maintien du niveau : les gains
// réels, moins les ajustements de remboursement (qui annulent des points
// jamais vraiment gagnés). Les paliers/fréquence d'achat ont points: 0 et
// n'ont pas besoin d'être exclus explicitement.
const TIER_WINDOW_TYPES = [
  "EARN_WELCOME",
  "EARN_ORDER",
  "EARN_ACTION",
  "EARN_REFERRAL",
  "ADJUST_REFUND",
] as const;

// Points gagnés (nets des remboursements) sur les 12 derniers mois glissants
// — base du maintien de niveau, différente de lifetimePoints qui ne baisse
// jamais (sauf remboursement) et sert de plafond historique, pas de jauge.
export async function getRollingPoints(
  db: PrismaClient,
  customerId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.pointsTransaction.aggregate({
    where: {
      customerId,
      type: { in: [...TIER_WINDOW_TYPES] },
      createdAt: { gte: since },
    },
    _sum: { points: true },
  });
  return result._sum.points ?? 0;
}

// À appeler juste après tout gain de points : fait monter le niveau
// immédiatement si le cumul sur 12 mois le justifie. Ne fait jamais
// redescendre (la descente est gérée séparément, par la tâche planifiée).
export async function syncTierUpgrade(
  db: PrismaClient,
  customerId: string,
): Promise<LoyaltyTier | null> {
  const customer = await db.loyaltyCustomer.findUnique({ where: { id: customerId } });
  if (!customer) return null;

  const rollingPoints = await getRollingPoints(db, customerId);
  const eligibleTier = getTierForPoints(rollingPoints);

  if (eligibleTier && getTierRank(eligibleTier) > getTierRank(customer.currentTier)) {
    await db.loyaltyCustomer.update({
      where: { id: customerId },
      data: { currentTier: eligibleTier },
    });
    return eligibleTier;
  }

  return customer.currentTier;
}
