# Specification: Budget Engine Fixes & Automatic Expense Aggregation

## 1. Core Objectives
1. Fix variance math and total sum calculation bugs.
2. Automatically pull and sum actual expenses from `Expenses` and `Payroll` modules by category and period.
3. Add visual budget health indicators (progress bars, alert thresholds).
4. Standardize period filters (Monthly vs. Annual views).

---

## 2. Technical Audit & Logic Upgrades

### A. Variance & Total Calculation Fixes
- **Variance Formula:**
  $$\text{Variance} = \text{Budgeted Amount} - \text{Actual Expenses}$$
- Ensure no hardcoded or malformatted string-to-number conversion bugs occur (e.g., preventing `442,000` from rendering as `4,420,000`).

### B. Auto-Aggregation Engine (`src/utils/budgetAggregator.ts`)
Map budget categories to posted entries in `expenses` and `payroll` tables:

```ts
export function calculateActualSpending(
  categoryName: string,
  period: string, // '2026' or '2026-08'
  expensesList: Array<{ category: string; amount: number; date: string }>,
  payrollList: Array<{ netPay: number; paymentDate: string }>
): number {
  let total = 0;

  // Aggregate matching general expenses
  const matchingExpenses = expensesList.filter((item) => {
    const isCategoryMatch = item.category.toLowerCase() === categoryName.toLowerCase();
    const isPeriodMatch = item.date.startsWith(period);
    return isCategoryMatch && isPeriodMatch;
  });
  total += matchingExpenses.reduce((sum, item) => sum + item.amount, 0);

  // If category is salaries/payroll, aggregate from payroll table
  if (categoryName.toLowerCase().includes('salaries') || categoryName.toLowerCase().includes('payroll')) {
    const matchingPayroll = payrollList.filter((item) => item.paymentDate.startsWith(period));
    total += matchingPayroll.reduce((sum, item) => sum + item.netPay, 0);
  }

  return total;
}

```

### C. Visual Budget Progress Indicator Component

Render a progress bar showing percentage utilized:

```tsx
export function BudgetProgressBar({ budgeted, actual }: { budgeted: number; actual: number }) {
  const percentage = budgeted > 0 ? Math.min(Math.round((actual / budgeted) * 100), 100) : 0;
  
  let barColor = '#2e7d32'; // Green (< 80%)
  if (percentage >= 80 && percentage < 100) barColor = '#ed6c02'; // Orange (Near limit)
  if (actual > budgeted) barColor = '#d32f2f'; // Red (Over budget)

  return (
    <div style={{ width: '100%', backgroundColor: '#e0e0e0', borderRadius: '4px', overflow: 'hidden' }}>
      <div style={{ width: `${percentage}%`, backgroundColor: barColor, height: '8px' }} />
      <span style={{ fontSize: '0.75rem', color: '#555' }}>{percentage}% spent</span>
    </div>
  );
}

```

---

## 3. UI/UX Enhancements for `/app/budgets`

1. **Period Toggle:** Add a explicit toggle between **Monthly View (`2026-08`)** and **Annual View (`2026`)** so period metrics don't mix unpredictably.
2. **Status Badges:** Update the `STATUS` column to show:
* `Within Budget` (Green)
* `Near Limit` (Yellow/Orange)
* `Over Budget` (Red)


3. **Quick Action:** Add a `+ Log Expense` quick action directly in the category row menu (`⋮`).

---

## 4. Execution Steps for Claude Code

1. Audit `src/pages/Budgets.tsx` (or equivalent file) for string parsing errors on the variance column.
2. Integrate `calculateActualSpending` to query the `expenses` and `payroll` state/DB tables dynamically.
3. Replace the text-only layout in the table with `BudgetProgressBar`.
4. Run `npm run build` or `pnpm build` to confirm zero build or TypeScript errors.
