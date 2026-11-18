// @ts-check

/**
 * Pure account lookup. Property mapping, then listing set (lowest priority number), then the default account.
 * A property listed in `unmappedPropertyIds` resolves to none.
 * @param {{ id: string, listingSetIds?: string[] }} property
 * @param {any} paymentAccounts
 */
export function resolvePaymentAccount(property, paymentAccounts) {
  if (!paymentAccounts) return null;
  if ((paymentAccounts.unmappedPropertyIds || []).includes(property.id)) return null;
  const accounts = paymentAccounts.accounts || [];
  const direct = accounts.find((account) => (account.propertyIds || []).includes(property.id));
  if (direct) return direct;

  const sets = paymentAccounts.listingSets || [];
  const mine = sets
    .filter((set) => (property.listingSetIds || []).includes(set.id))
    .sort((a, b) => a.priority - b.priority);
  for (const set of mine) {
    const hit = accounts.find((account) => (account.listingSetIds || []).includes(set.id));
    if (hit) return hit;
  }
  return accounts.find((account) => account.isDefault) || null;
}

export function createPayments() {
  let sequence = 0;
  /** @type {any[]} */
  const charges = [];
  return {
    charges,
    /**
     * Instant mock card payment. Refuses an account that carries a live secret.
     * @param {{ account: { id: string, label: string, secret_ref: unknown }, amount: number, currency: string }} input
     */
    chargeStripe(input) {
      if (input.account?.secret_ref) {
        throw new Error("Refusing an account that has a secret reference");
      }
      sequence += 1;
      const charge = {
        id: `pi_mock_${sequence}`,
        accountId: input.account.id,
        accountLabel: input.account.label,
        amount: input.amount,
        currency: input.currency,
        status: "paid",
      };
      charges.push(charge);
      return charge;
    },
  };
}
