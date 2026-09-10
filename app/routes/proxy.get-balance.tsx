import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getClaimableMilestones } from "../points-milestones.server";
import { SOCIAL_ACTIONS } from "../social-actions.server";

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

  // Requête séparée (pas limitée à l'historique affiché) : un palier réclamé
  // il y a longtemps ne doit pas redevenir "réclamable" une fois sorti des
  // 20 dernières transactions.
  const claimedMilestones = await db.pointsTransaction.findMany({
    where: { customerId: customer.id, type: "MILESTONE_REWARD" },
    select: { milestonePoints: true },
  });

  const socialRequests = await db.socialActionRequest.findMany({
    where: { customerId: customer.id },
    select: { action: true, status: true },
  });
  const socialActions = SOCIAL_ACTIONS.map((a) => ({
    action: a.action,
    label: a.label,
    points: a.points,
    requiresHandle: a.requiresHandle,
    status: socialRequests.find((r) => r.action === a.action)?.status ?? "NONE",
  }));

  return Response.json(
    {
      customer: { shopifyCustomerId },
      balance: customer.pointsBalance,
      lifetimePoints: customer.lifetimePoints,
      tier: customer.currentTier,
      claimableMilestones: getClaimableMilestones(
        customer.lifetimePoints,
        claimedMilestones.map((m) => m.milestonePoints).filter((p) => p !== null),
      ),
      socialActions,
      referralCode: customer.referralCode,
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
