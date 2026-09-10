import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { getRollingPoints, getTierForPoints, getTierOneStepDown, getTierRank } from "../loyalty-tier.server";

// À exécuter périodiquement (ex: une fois par jour, comme /cron/expire-points).
// Contrairement à la montée de niveau (immédiate, déclenchée à chaque gain de
// points), la descente ne peut être détectée que par le simple passage du
// temps : d'anciens points sortent de la fenêtre glissante de 12 mois sans
// qu'aucune action du client ne le déclenche.
export const action = async ({ request }: ActionFunctionArgs) => {
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("Authorization");

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const customers = await db.loyaltyCustomer.findMany({
    where: { currentTier: { not: null } },
    select: { id: true, currentTier: true },
  });

  let downgraded = 0;

  for (const customer of customers) {
    if (!customer.currentTier) continue;

    const rollingPoints = await getRollingPoints(db, customer.id);
    const eligibleTier = getTierForPoints(rollingPoints);

    // Ne descend que d'un cran, jamais un recalcul complet (décision utilisateur).
    if (getTierRank(eligibleTier) < getTierRank(customer.currentTier)) {
      const newTier = getTierOneStepDown(customer.currentTier);
      await db.loyaltyCustomer.update({
        where: { id: customer.id },
        data: { currentTier: newTier },
      });
      downgraded += 1;
    }
  }

  return Response.json({ checked: customers.length, downgraded });
};
