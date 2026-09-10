import type { ActionFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getFrequencyReward } from "../frequency-rewards.server";
import { syncTierUpgrade } from "../loyalty-tier.server";

const POINTS_EXPIRY_DAYS = 365;
const FREQUENCY_CODE_VALIDITY_DAYS = 7;
const REFERRAL_REWARD_POINTS = 100;

function generateDiscountCode(prefix: string) {
  const random = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `${prefix}-${random}`;
}

const DISCOUNT_CODE_MUTATION = `#graphql
  mutation EthniRewardsFrequencyDiscountCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
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

  const order = payload as {
    id: number;
    customer?: { id: number } | null;
    subtotal_price?: string;
    current_subtotal_price?: string;
    discount_codes?: Array<{ code: string }>;
  };

  const shopifyCustomerId = order.customer?.id?.toString();
  if (!shopifyCustomerId) {
    // Commande sans compte client (invité) : pas de programme de fidélité à créditer.
    return new Response();
  }

  const subtotal = Number(
    order.current_subtotal_price ?? order.subtotal_price ?? "0",
  );
  const points = Math.floor(subtotal);
  if (points <= 0) {
    return new Response();
  }

  const customer = await db.loyaltyCustomer.upsert({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId } },
    create: { shop, shopifyCustomerId },
    update: {},
  });

  try {
    await db.$transaction([
      db.pointsTransaction.create({
        data: {
          customerId: customer.id,
          type: "EARN_ORDER",
          points,
          remainingPoints: points,
          shopifyOrderId: order.id.toString(),
          expiresAt: new Date(
            Date.now() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
          ),
          note: `Commande #${order.id} : ${subtotal}€ HT`,
        },
      }),
      db.loyaltyCustomer.update({
        where: { id: customer.id },
        data: {
          pointsBalance: { increment: points },
          lifetimePoints: { increment: points },
        },
      }),
    ]);
  } catch (error) {
    // Code P2002 = contrainte d'unicité violée : ce webhook a déjà été traité
    // (Shopify peut livrer le même événement plusieurs fois).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      console.log(`Order ${order.id} already credited, skipping.`);
      return new Response();
    }
    throw error;
  }

  await syncTierUpgrade(db, customer.id);

  // Volet fréquence d'achat (système séparé des points) : si l'écart avec la
  // commande précédente correspond à un rythme récompensé, on génère un code
  // promo à usage unique, valable 7 jours.
  const recentOrders = await db.pointsTransaction.findMany({
    where: { customerId: customer.id, type: "EARN_ORDER" },
    orderBy: { createdAt: "desc" },
    take: 2,
  });

  if (recentOrders.length === 2 && admin) {
    const [current, previous] = recentOrders;
    const gapDays =
      (current.createdAt.getTime() - previous.createdAt.getTime()) /
      (1000 * 60 * 60 * 24);
    const reward = getFrequencyReward(gapDays);

    if (reward) {
      const code = generateDiscountCode("ETHNI-FREQ");
      const now = new Date();
      const endsAt = new Date(
        now.getTime() + FREQUENCY_CODE_VALIDITY_DAYS * 24 * 60 * 60 * 1000,
      );

      try {
        const response = await admin.graphql(DISCOUNT_CODE_MUTATION, {
          variables: {
            basicCodeDiscount: {
              title: `Ethni Rewards - Fidélité ${reward.label}`,
              code,
              startsAt: now.toISOString(),
              endsAt: endsAt.toISOString(),
              usageLimit: 1,
              appliesOncePerCustomer: true,
              customerSelection: {
                customers: {
                  add: [`gid://shopify/Customer/${shopifyCustomerId}`],
                },
              },
              customerGets: {
                items: { all: true },
                value: { percentage: reward.percent },
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

        await db.pointsTransaction.create({
          data: {
            customerId: customer.id,
            type: "FREQUENCY_REWARD",
            points: 0,
            shopifyOrderId: order.id.toString(),
            discountCode: code,
            expiresAt: endsAt,
            note: `Récompense fréquence d'achat (${reward.label}) : code ${code} pour ${Math.round(reward.percent * 100)}% de réduction, valable 7 jours`,
          },
        });
      } catch (error) {
        // Code P2002 = ce cadeau de fréquence a déjà été généré pour cette
        // commande (webhook redélivré) — pas grave, on l'ignore.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          console.log(`Frequency reward for order ${order.id} already created, skipping.`);
        } else {
          console.error("Échec de création du code fréquence d'achat:", error);
        }
      }
    }
  }

  // Parrainage : si cette commande utilise le code personnel d'un autre
  // client, on lui crédite +100 pts. Comme Shopify limite ce code à un usage
  // par client (`appliesOncePerCustomer`), un même filleul ne peut déclencher
  // cette récompense qu'une seule fois, sur sa première commande avec le code.
  const discountCodesUsed = (order.discount_codes ?? []).map((d) => d.code);
  if (discountCodesUsed.length > 0) {
    const referrer = await db.loyaltyCustomer.findFirst({
      where: { referralCode: { in: discountCodesUsed } },
    });

    if (referrer && referrer.id !== customer.id) {
      try {
        await db.$transaction([
          db.pointsTransaction.create({
            data: {
              customerId: referrer.id,
              type: "EARN_REFERRAL",
              points: REFERRAL_REWARD_POINTS,
              remainingPoints: REFERRAL_REWARD_POINTS,
              shopifyOrderId: order.id.toString(),
              expiresAt: new Date(
                Date.now() + POINTS_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
              ),
              note: `Parrainage : un ami a passé sa première commande (#${order.id})`,
            },
          }),
          db.loyaltyCustomer.update({
            where: { id: referrer.id },
            data: {
              pointsBalance: { increment: REFERRAL_REWARD_POINTS },
              lifetimePoints: { increment: REFERRAL_REWARD_POINTS },
            },
          }),
        ]);
        await syncTierUpgrade(db, referrer.id);
      } catch (error) {
        // Code P2002 = ce parrainage a déjà été crédité (webhook redélivré).
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        ) {
          console.log(`Referral reward for order ${order.id} already credited, skipping.`);
        } else {
          throw error;
        }
      }
    }
  }

  return new Response();
};
