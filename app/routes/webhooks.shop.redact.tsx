import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customers = await db.loyaltyCustomer.findMany({
    where: { shop },
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);

  await db.$transaction([
    db.pointsTransaction.deleteMany({ where: { customerId: { in: customerIds } } }),
    db.loyaltyCustomer.deleteMany({ where: { shop } }),
  ]);

  return new Response();
};
