import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const { customer } = payload as { customer?: { id: number } };
  const shopifyCustomerId = customer?.id?.toString();
  if (!shopifyCustomerId) {
    return new Response();
  }

  const record = await db.loyaltyCustomer.findUnique({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId } },
    include: { transactions: true },
  });

  // Pas d'automatisation d'envoi au marchand pour l'instant : on trace les
  // données détenues dans les logs serveur, à transmettre manuellement dans
  // le délai légal de 30 jours.
  console.log(
    `[GDPR data_request] Client ${shopifyCustomerId} (${shop}) :`,
    JSON.stringify(record, null, 2),
  );

  return new Response();
};
