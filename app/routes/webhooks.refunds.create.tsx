import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Le payload est l'objet Refund lui-même (pas la commande), et ne contient
  // aucune information client — on retrouve le client via notre propre lot
  // EARN_ORDER enregistré pour cette commande, pas via l'API Shopify.
  const refund = payload as {
    id: number;
    order_id: number;
    refund_line_items?: Array<{ subtotal?: number }>;
  };

  const refundedSubtotal = (refund.refund_line_items ?? []).reduce(
    (sum, item) => sum + Number(item.subtotal ?? 0),
    0,
  );
  const points = Math.floor(refundedSubtotal);
  if (points <= 0) {
    return new Response();
  }

  const lot = await db.pointsTransaction.findFirst({
    where: { type: "EARN_ORDER", shopifyOrderId: refund.order_id.toString() },
    include: { customer: true },
  });
  if (!lot || lot.customer.shop !== shop) {
    return new Response();
  }

  const customer = lot.customer;

  // Le solde et le cumul VIP sont plafonnés à 0 : si le client a déjà dépensé
  // ces points, on ne les lui reprend pas en négatif, on absorbe la perte.
  const fromBalance = Math.min(points, customer.pointsBalance);
  const fromLifetime = Math.min(points, customer.lifetimePoints);
  const fromLot = Math.min(points, lot.remainingPoints ?? 0);
  const notRecovered = points - fromBalance;

  try {
    await db.$transaction([
      db.pointsTransaction.create({
        data: {
          customerId: customer.id,
          type: "ADJUST_REFUND",
          points: -fromBalance,
          shopifyOrderId: refund.order_id.toString(),
          shopifyRefundId: refund.id.toString(),
          note:
            `Remboursement partiel/total de la commande #${refund.order_id} : ` +
            `${fromBalance} pts retirés` +
            (notRecovered > 0
              ? ` (${notRecovered} pts déjà dépensés, non récupérés)`
              : ""),
        },
      }),
      db.pointsTransaction.update({
        where: { id: lot.id },
        data: { remainingPoints: { decrement: fromLot } },
      }),
      db.loyaltyCustomer.update({
        where: { id: customer.id },
        data: {
          pointsBalance: { decrement: fromBalance },
          lifetimePoints: { decrement: fromLifetime },
        },
      }),
    ]);
  } catch (error) {
    // Code P2002 = ce remboursement a déjà été traité (webhook redélivré).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.log(`Refund ${refund.id} already processed, skipping.`);
      return new Response();
    }
    throw error;
  }

  return new Response();
};
