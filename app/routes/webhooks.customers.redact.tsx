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
  });
  if (!record) {
    return new Response();
  }

  await db.$transaction([
    db.pointsTransaction.deleteMany({ where: { customerId: record.id } }),
    db.loyaltyCustomer.delete({ where: { id: record.id } }),
  ]);

  return new Response();
};
