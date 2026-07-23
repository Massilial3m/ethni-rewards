import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

const MIN_REDEEM_POINTS = 200;
const POINTS_STEP = 25;
const POINTS_PER_EURO = 50;

function generateDiscountCode() {
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `ETHNI-${random}`;
}

const DISCOUNT_CODE_MUTATION = `#graphql
  mutation EthniRewardsDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
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
  const pointsToRedeem = Number(formData.get("points"));

  if (
    !Number.isInteger(pointsToRedeem) ||
    pointsToRedeem < MIN_REDEEM_POINTS ||
    pointsToRedeem % POINTS_STEP !== 0
  ) {
    return Response.json({ error: "invalid_amount" }, { status: 400 });
  }

  const customer = await db.loyaltyCustomer.findUnique({
    where: {
      shop_shopifyCustomerId: {
        shop: session.shop,
        shopifyCustomerId,
      },
    },
  });

  if (!customer) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // Débit atomique : n'affecte une ligne que si le solde est suffisant.
  const debited = await db.loyaltyCustomer.updateMany({
    where: { id: customer.id, pointsBalance: { gte: pointsToRedeem } },
    data: { pointsBalance: { decrement: pointsToRedeem } },
  });

  if (debited.count === 0) {
    return Response.json({ error: "insufficient_balance" }, { status: 400 });
  }

  const amount = (pointsToRedeem / POINTS_PER_EURO).toFixed(2);
  const code = generateDiscountCode();

  try {
    const response = await admin.graphql(DISCOUNT_CODE_MUTATION, {
      variables: {
        basicCodeDiscount: {
          title: `Ethni Rewards - ${pointsToRedeem} pts`,
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
              discountAmount: { amount, appliesOnEachItem: false },
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
    // La création du code a échoué : on recrédite les points.
    await db.loyaltyCustomer.update({
      where: { id: customer.id },
      data: { pointsBalance: { increment: pointsToRedeem } },
    });
    console.error("Échec de création du code de réduction:", error);
    return Response.json({ error: "discount_creation_failed" }, { status: 502 });
  }

  await db.pointsTransaction.create({
    data: {
      customerId: customer.id,
      type: "REDEEM",
      points: -pointsToRedeem,
      discountCode: code,
      note: `Conversion de ${pointsToRedeem} points en réduction de ${amount}€`,
    },
  });

  return Response.json({ code, amount });
};
