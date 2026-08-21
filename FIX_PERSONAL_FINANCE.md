# Specification: Personal Finance Dashboard Engine & UI Cleanup

## 1. Core Objectives
1. Verify and formalize the Net Worth accounting aggregation logic.
2. Deduplicate top notification banners to show only the single most recent alert per entity.
3. Add interactive goal tracking and entry forms to the `Savings` and `Social Savings` sub-tabs.

---

## 2. Technical Audit & Calculation Logic

### A. Dynamic Net Worth Formula
Ensure the calculation engine in `src/pages/PersonalFinance.tsx` (or equivalent) follows strict balance sheet accounting:

```ts
export function calculateNetWorth(data: {
  assetsTotal: number;
  debtorsTotal: number;  // Amounts owed TO user
  creditorsTotal: number; // Amounts owed BY user
  bankDebtTotal: number;  // Loan balances
}) {
  const totalAssets = data.assetsTotal + data.debtorsTotal;
  const totalLiabilities = data.bankDebtTotal + data.creditorsTotal;
  const netWorth = totalAssets - totalLiabilities;

  return {
    totalAssets,
    totalLiabilities,
    netWorth: Number(netWorth.toFixed(2)),
  };
}

```

### B. Notification Banner Deduplication (`src/components/AlertBanner.tsx`)

Group notifications by target entity/lender so identical daily alerts do not stack vertically:

```tsx
export function DeduplicatedAlerts({ alerts }: { alerts: Array<{ id: string; message: string; dueDate: string; daysOverdue: number }> }) {
  // Pick the alert with the highest daysOverdue per entity
  const latestAlert = alerts.reduce((prev, current) => {
    return (prev.daysOverdue > current.daysOverdue) ? prev : current;
  }, alerts[0]);

  if (!latestAlert) return null;

  return (
    <div className="alert-banner">
      <span>Payment to saccos NDELCT is due ({latestAlert.daysOverdue} day(s) overdue).</span>
      <button onClick={() => dismissAlert(latestAlert.id)}>✕</button>
    </div>
  );
}

```

---

## 3. Sub-Tab Extensions (`Savings` & `Social Savings`)

1. **Savings Module:**
* Add Emergency Fund progress bar ($\text{Current Savings} / \text{Target Goal}$).
* Add `+ Deposit to Savings` quick action modal.


2. **Social Savings (SACCOS / VIKOBA):**
* Track monthly contribution obligations vs. actual paid shares.
* Link SACCOS loan balances directly to the `Bank Debt` card.



---

## 4. Execution Steps for Claude Code

1. Audit `src/pages/PersonalFinance.tsx` and verify that `Net Worth` updates dynamically when new transactions or liabilities are added.
2. Replace the stacked alert renderer with deduplicated alert handling.
3. Implement basic state handling and deposit forms for the `Savings` and `Social Savings` sub-tabs.
4. Run `npm run build` or `pnpm build` to confirm build health.
