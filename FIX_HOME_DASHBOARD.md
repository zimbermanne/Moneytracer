# Specification: Home Dashboard Restructuring & Alert Cleanup

## 1. Core Objectives
1. Fix notification banner stacking by deduplicating alert messages.
2. Fix KPI summary cards layout and add visual health indicators.
3. Add interactive quick actions for low stock management and compliance warnings.

---

## 2. Technical Audit & UI Fixes

### A. Deduplicate Notification Banners (`src/components/AlertBanner.tsx`)
Currently, daily overdue notifications (e.g., *"Payment to saccos NDELCT is due 14 day(s) overdue"*, *"13 day(s) overdue"*, etc.) stack repeatedly across the top of the viewport.

**Fix:** Group alerts by `loanId` or `entityName` and render only the **single most urgent/recent alert** per entity:

```tsx
export function AlertBannerList({ alerts }: { alerts: Array<{ id: string; entity: string; daysOverdue: number }> }) {
  // Deduplicate by keeping the highest daysOverdue per entity
  const deduplicated = Object.values(
    alerts.reduce((acc, current) => {
      if (!acc[current.entity] || current.daysOverdue > acc[current.entity].daysOverdue) {
        acc[current.entity] = current;
      }
      return acc;
    }, {} as Record<string, typeof alerts[0]>)
  );

  return (
    <div className="alerts-container">
      {deduplicated.map((alert) => (
        <div key={alert.id} className="alert-banner alert-warning">
          <span>
            Payment to {alert.entity} is due ({alert.daysOverdue} day(s) overdue).
          </span>
          <button onClick={() => handleDismiss(alert.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

```

---

## 3. Dashboard KPI Layout Refactoring (`src/pages/Home.tsx`)

### Key Improvements:

1. **Low Stock Action Banner:** Make the low stock warning (`184 items at or below reorder point`) directly clickable to route the user to the [Inventory Ledger](https://moneytracer.up.railway.app/app).
2. **Card Grid Alignment:** Standardize summary card heights and text contrast across:
* **Today's Overview:** `Today's Earnings`, `Items Sold Today`, `Top Product Today`
* **Inventory Metrics:** `Low Stock Items`, `Inventory Value`, `Total Stock Units`
* **All-Time Metrics:** `Net Profit (All-time)`, `Total Revenue (All-time)`, `Top Revenue Item`



---

## 4. Execution Steps for Claude Code

1. Inspect `src/pages/Home.tsx` and parent layout headers for notification banner rendering.
2. Replace the stacked alert array with the deduplicated alert renderer logic.
3. Ensure low stock warning banners redirect to `/app/inventory`.
4. Run `npm run build` or `pnpm build` to confirm zero build or TypeScript errors.
