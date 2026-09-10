import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const expectedSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("Authorization");

  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();
  let expiredLots = 0;
  let expiredPoints = 0;

  // Un lot à la fois : le plus ancien expiré en premier. Chaque itération met
  // remainingPoints à 0 sur le lot traité, donc la boucle se termine
  // naturellement quand plus aucun lot ne correspond au filtre.
  while (true) {
    const lot = await db.pointsTransaction.findFirst({
      where: { remainingPoints: { gt: 0 }, expiresAt: { lte: now } },
      orderBy: { expiresAt: "asc" },
    });
    if (!lot || lot.remainingPoints === null) break;

    const amount = lot.remainingPoints;

    await db.$transaction([
      db.pointsTransaction.create({
        data: {
          customerId: lot.customerId,
          type: "EXPIRE",
          points: -amount,
          sourceTransactionId: lot.id,
          note: `Expiration de ${amount} points acquis le ${lot.createdAt
            .toISOString()
            .slice(0, 10)}`,
        },
      }),
      db.pointsTransaction.update({
        where: { id: lot.id },
        data: { remainingPoints: 0 },
      }),
      db.loyaltyCustomer.update({
        where: { id: lot.customerId },
        data: { pointsBalance: { decrement: amount } },
      }),
    ]);

    expiredLots += 1;
    expiredPoints += amount;
  }

  return Response.json({ expiredLots, expiredPoints });
};
