import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { POINTS_MILESTONES } from "../points-milestones.server";

function generateDiscountCode() {
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `ETHNI-VIP-${random}`;
}

const DISCOUNT_CODE_MUTATION = `#graphql
  mutation EthniRewardsMilestoneDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
    discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
      codeDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);

  if (!session || !admin) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const url = new URL(request.url);
  const shopifyCustomerId = url.searchParams.get("logged_in_customer_id");
  if (!shopifyCustomerId) {
    return Response.json({ error: "not_logged_in" }, { status: 401 });
  }

  const formData = await request.formData();
  const milestonePoints = Number(formData.get("milestonePoints"));
  const milestone = POINTS_MILESTONES.find((m) => m.points === milestonePoints);
  if (!milestone) {
    return Response.json({ error: "invalid_milestone" }, { status: 400 });
  }

  const customer = await db.loyaltyCustomer.findUnique({
    where: { shop_shopifyCustomerId: { shop: session.shop, shopifyCustomerId } },
  });
  if (!customer) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  if (customer.lifetimePoints < milestone.points) {
    return Response.json({ error: "milestone_not_reached" }, { status: 400 });
  }

  const alreadyClaimed = await db.pointsTransaction.findFirst({
    where: {
      customerId: customer.id,
      milestonePoints: milestone.points,
      type: "MILESTONE_REWARD",
    },
  });
  if (alreadyClaimed) {
    return Response.json({ error: "already_claimed" }, { status: 400 });
  }

  const code = generateDiscountCode();
  const percentLabel = `${Math.round(milestone.percent * 100)}%`;

  try {
    const response = await admin.graphql(DISCOUNT_CODE_MUTATION, {
      variables: {
        basicCodeDiscount: {
          title: `Ethni Rewards - Palier ${milestone.points} pts (${percentLabel})`,
          code,
          startsAt: new Date().toISOString(),
          usageLimit: 1,
          appliesOncePerCustomer: true,
          customerSelection: {
            customers: {
              add: [`gid://shopify/Customer/${shopifyCustomerId}`],
            },
          },
          customerGets: {
            items: { all: true },
            value: {
              percentage: milestone.percent,
            },
          },
        },
      },
    });

    const result = await response.json();
    const userErrors = result.data?.discountCodeBasicCreate?.userErrors ?? [];
    if (userErrors.length > 0) {
      throw new Error(
        userErrors.map((e: { message: string }) => e.message).join(", "),
      );
    }
  } catch (error) {
    console.error("Échec de création du code de réduction palier:", error);
    return Response.json({ error: "discount_creation_failed" }, { status: 502 });
  }

  try {
    await db.pointsTransaction.create({
      data: {
        customerId: customer.id,
        type: "MILESTONE_REWARD",
        points: 0,
        milestonePoints: milestone.points,
        discountCode: code,
        note: `Récompense du palier ${milestone.points} points : ${percentLabel} de réduction`,
      },
    });
  } catch (error) {
    // Code P2002 = ce palier a déjà été réclamé (double-clic, requête rejouée).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return Response.json({ error: "already_claimed" }, { status: 400 });
    }
    throw error;
  }

  return Response.json({ code, percent: percentLabel });
};
