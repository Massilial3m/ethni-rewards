import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session) {
    return Response.json({ customer: null }, NO_STORE);
  }

  const url = new URL(request.url);
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id");

  if (!shopifyCustomerId) {
    return Response.json({ customer: null }, NO_STORE);
  }

  const customer = await db.loyaltyCustomer.findUnique({
    where: {
      shop_shopifyCustomerId: { shop: session.shop, shopifyCustomerId },
    },
    include: {
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!customer) {
    return Response.json({ customer: null }, NO_STORE);
  }

  return Response.json(
    {
      customer: { shopifyCustomerId },
      balance: customer.pointsBalance,
      transactions: customer.transactions.map((t) => ({
        type: t.type,
        points: t.points,
        note: t.note,
        createdAt: t.createdAt,
      })),
    },
    NO_STORE,
  );
};
