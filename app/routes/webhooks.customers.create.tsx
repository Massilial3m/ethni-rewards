import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const WELCOME_POINTS = 50;
const POINTS_EXPIRY_DAYS = 365;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const shopifyCustomer = payload as { id: number };
  const shopifyCustomerId = shopifyCustomer.id.toString();

  const customer = await db.loyaltyCustomer.upsert({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId } },
    create: { shop, shopifyCustomerId },
    update: {},
  });

  const alreadyWelcomed = await db.pointsTransaction.findFirst({
    where: { customerId: customer.id, type: "EARN_WELCOME" },
  });
  if (alreadyWelcomed) {
    return new Response();
  }

  await db.$transaction([
    db.pointsTransaction.create({
      data: {
        customerId: customer.id,
        type: "EARN_WELCOME",
        points: WELCOME_POINTS,
        expiresAt: new Date(
          Date.now() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        ),
        note: "Points de bienvenue à l'inscription",
      },
    }),
    db.loyaltyCustomer.update({
      where: { id: customer.id },
      data: { pointsBalance: { increment: WELCOME_POINTS } },
    }),
  ]);

  return new Response();
};
