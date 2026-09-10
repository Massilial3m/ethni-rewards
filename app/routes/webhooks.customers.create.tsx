import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { syncTierUpgrade } from "../loyalty-tier.server";

const WELCOME_POINTS = 50;
const POINTS_EXPIRY_DAYS = 365;
const REFERRAL_DISCOUNT_PERCENT = 0.1;

function generateReferralCode() {
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `ETHNI-PARRAIN-${random}`;
}

const REFERRAL_DISCOUNT_MUTATION = `#graphql
  mutation EthniRewardsReferralDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
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
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

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

  if (!alreadyWelcomed) {
    await db.$transaction([
      db.pointsTransaction.create({
        data: {
          customerId: customer.id,
          type: "EARN_WELCOME",
          points: WELCOME_POINTS,
          remainingPoints: WELCOME_POINTS,
          expiresAt: new Date(
            Date.now() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ),
          note: "Points de bienvenue à l'inscription",
        },
      }),
      db.loyaltyCustomer.update({
        where: { id: customer.id },
        data: {
          pointsBalance: { increment: WELCOME_POINTS },
          lifetimePoints: { increment: WELCOME_POINTS },
        },
      }),
    ]);
    await syncTierUpgrade(db, customer.id);
  }

  // Génère le code de parrainage personnel séparément du bonus de bienvenue,
  // pour qu'un échec ici (ex: appel Shopify raté) puisse être retenté sur une
  // éventuelle redélivrance du webhook sans dépendre du bonus déjà crédité.
  if (!customer.referralCode && admin) {
    const code = generateReferralCode();

    try {
      const response = await admin.graphql(REFERRAL_DISCOUNT_MUTATION, {
        variables: {
          basicCodeDiscount: {
            title: `Ethni Rewards - Parrainage (${shopifyCustomerId})`,
            code,
            startsAt: new Date().toISOString(),
            appliesOncePerCustomer: true,
            customerSelection: { all: true },
            customerGets: {
              items: { all: true },
              value: { percentage: REFERRAL_DISCOUNT_PERCENT },
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

      await db.loyaltyCustomer.update({
        where: { id: customer.id },
        data: { referralCode: code },
      });
    } catch (error) {
      console.error("Échec de création du code de parrainage:", error);
    }
  }

  return new Response();
};
