import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const POINTS_EXPIRY_DAYS = 365;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const order = payload as {
    id: number;
    customer?: { id: number } | null;
    subtotal_price?: string;
    current_subtotal_price?: string;
  };

  const shopifyCustomerId = order.customer?.id?.toString();
  if (!shopifyCustomerId) {
    // Commande sans compte client (invité) : pas de programme de fidélité à créditer.
    return new Response();
  }

  const subtotal = Number(
    order.current_subtotal_price ?? order.subtotal_price ?? "0",
  );
  const points = Math.floor(subtotal);
  if (points <= 0) {
    return new Response();
  }

  const customer = await db.loyaltyCustomer.upsert({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId } },
    create: { shop, shopifyCustomerId },
    update: {},
  });

  try {
    await db.$transaction([
      db.pointsTransaction.create({
        data: {
          customerId: customer.id,
          type: "EARN_ORDER",
          points,
          shopifyOrderId: order.id.toString(),
          expiresAt: new Date(
            Date.now() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ),
          note: `Commande #${order.id} : ${subtotal}€ HT`,
        },
      }),
      db.loyaltyCustomer.update({
        where: { id: customer.id },
        data: { pointsBalance: { increment: points } },
      }),
    ]);
  } catch (error) {
    // Code P2002 = contrainte d'unicité violée : ce webhook a déjà été traité
    // (Shopify peut livrer le même événement plusieurs fois).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.log(`Order ${order.id} already credited, skipping.`);
      return new Response();
    }
    throw error;
  }

  return new Response();
};
