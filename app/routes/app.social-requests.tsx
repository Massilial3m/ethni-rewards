import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getSocialAction } from "../social-actions.server";
import { syncTierUpgrade } from "../loyalty-tier.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const requests = await db.socialActionRequest.findMany({
    where: { status: "PENDING", customer: { shop: session.shop } },
    include: { customer: true },
    orderBy: { createdAt: "asc" },
  });

  return {
    requests: requests.map((r) => ({
      id: r.id,
      action: r.action,
      points: r.points,
      handle: r.handle,
      createdAt: r.createdAt,
      shopifyCustomerId: r.customer.shopifyCustomerId,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const requestId = String(formData.get("requestId"));
  const decision = String(formData.get("decision"));

  const socialRequest = await db.socialActionRequest.findUnique({
    where: { id: requestId },
    include: { customer: true },
  });

  if (
    !socialRequest ||
    socialRequest.customer.shop !== session.shop ||
    socialRequest.status !== "PENDING"
  ) {
    return { error: "not_found" };
  }

  if (decision === "reject") {
    await db.socialActionRequest.update({
      where: { id: requestId },
      data: { status: "REJECTED", reviewedAt: new Date() },
    });
    return { ok: true };
  }

  if (decision === "approve") {
    try {
      await db.$transaction(async (tx) => {
        // Débit atomique sur le statut : si la requête a déjà été traitée
        // entre-temps (double-clic), on abandonne sans créditer deux fois.
        const updated = await tx.socialActionRequest.updateMany({
          where: { id: requestId, status: "PENDING" },
          data: { status: "APPROVED", reviewedAt: new Date() },
        });
        if (updated.count === 0) {
          throw new Error("already_processed");
        }

        await tx.pointsTransaction.create({
          data: {
            customerId: socialRequest.customerId,
            type: "EARN_ACTION",
            points: socialRequest.points,
            note: `Action validée : ${getSocialAction(socialRequest.action)?.label ?? socialRequest.action}`,
          },
        });
        await tx.loyaltyCustomer.update({
          where: { id: socialRequest.customerId },
          data: {
            pointsBalance: { increment: socialRequest.points },
            lifetimePoints: { increment: socialRequest.points },
          },
        });
      });
    } catch {
      return { error: "already_processed" };
    }
    await syncTierUpgrade(db, socialRequest.customerId);
    return { ok: true };
  }

  return { error: "invalid_decision" };
};

export default function SocialRequests() {
  const { requests } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const submit = (requestId: string, decision: "approve" | "reject") => {
    fetcher.submit({ requestId, decision }, { method: "POST" });
  };

  return (
    <s-page heading="Demandes de points — actions sociales">
      <s-section heading={`${requests.length} demande(s) en attente`}>
        {requests.length === 0 && (
          <s-paragraph>Aucune demande en attente.</s-paragraph>
        )}
        <s-stack direction="block" gap="base">
          {requests.map((r) => (
            <s-box
              key={r.id}
              padding="base"
              borderWidth="base"
              borderRadius="base"
            >
              <s-stack direction="inline" gap="base">
                <s-text>
                  Client {r.shopifyCustomerId} — {r.action} — {r.points} pts
                  {r.handle ? ` — pseudo : ${r.handle}` : ""} —{" "}
                  {new Date(r.createdAt).toLocaleDateString("fr-FR")}
                </s-text>
                <s-button onClick={() => submit(r.id, "approve")}>
                  Approuver
                </s-button>
                <s-button
                  variant="tertiary"
                  onClick={() => submit(r.id, "reject")}
                >
                  Rejeter
                </s-button>
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}
