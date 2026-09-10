import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSocialAction } from "../social-actions.server";
import { syncTierUpgrade } from "../loyalty-tier.server";

const NEWSLETTER_CONSENT_QUERY = `#graphql
  query EthniRewardsCustomerMarketingConsent($id: ID!) {
    customer(id: $id) {
      emailMarketingConsent {
        marketingState
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);

  if (!session) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id");
  if (!shopifyCustomerId) {
    return Response.json({ error: "not_logged_in" }, { status: 401 });
  }

  const formData = await request.formData();
  const actionKey = String(formData.get("action"));
  const socialAction = getSocialAction(actionKey);
  if (!socialAction) {
    return Response.json({ error: "invalid_action" }, { status: 400 });
  }

  const customer = await db.loyaltyCustomer.upsert({
    where: { shop_shopifyCustomerId: { shop: session.shop, shopifyCustomerId } },
    create: { shop: session.shop, shopifyCustomerId },
    update: {},
  });

  const existing = await db.socialActionRequest.findUnique({
    where: { customerId_action: { customerId: customer.id, action: socialAction.action } },
  });
  if (existing) {
    return Response.json({ error: "already_requested", status: existing.status }, { status: 400 });
  }

  // La newsletter est vérifiable automatiquement via le consentement marketing
  // que Shopify enregistre nativement sur le client — pas besoin de validation
  // manuelle ni de pseudo, contrairement aux réseaux sociaux.
  if (socialAction.action === "NEWSLETTER") {
    if (!admin) {
      return Response.json({ error: "verification_unavailable" }, { status: 502 });
    }

    const response = await admin.graphql(NEWSLETTER_CONSENT_QUERY, {
      variables: { id: `gid://shopify/Customer/${shopifyCustomerId}` },
    });
    const result = await response.json();
    const marketingState = result.data?.customer?.emailMarketingConsent?.marketingState;

    if (marketingState !== "SUBSCRIBED") {
      return Response.json({ error: "not_subscribed" }, { status: 400 });
    }

    try {
      await db.$transaction([
        db.socialActionRequest.create({
          data: {
            customerId: customer.id,
            action: "NEWSLETTER",
            points: socialAction.points,
            status: "APPROVED",
            reviewedAt: new Date(),
          },
        }),
        db.pointsTransaction.create({
          data: {
            customerId: customer.id,
            type: "EARN_ACTION",
            points: socialAction.points,
            note: "Abonnement newsletter confirmé automatiquement via Shopify",
          },
        }),
        db.loyaltyCustomer.update({
          where: { id: customer.id },
          data: {
            pointsBalance: { increment: socialAction.points },
            lifetimePoints: { increment: socialAction.points },
          },
        }),
      ]);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return Response.json({ error: "already_requested", status: "APPROVED" }, { status: 400 });
      }
      throw error;
    }

    await syncTierUpgrade(db, customer.id);
    return Response.json({ status: "APPROVED" });
  }

  const handle = String(formData.get("handle") ?? "").trim();
  if (socialAction.requiresHandle && !handle) {
    return Response.json({ error: "handle_required" }, { status: 400 });
  }

  await db.socialActionRequest.create({
    data: {
      customerId: customer.id,
      action: socialAction.action,
      points: socialAction.points,
      handle: socialAction.requiresHandle ? handle : null,
    },
  });

  return Response.json({ status: "PENDING" });
};
