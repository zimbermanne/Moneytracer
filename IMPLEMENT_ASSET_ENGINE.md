# Specification: Asset Appreciation, Depreciation & Revaluation Engine

## 1. Objectives
1. Add sub-category classification (Fixed Assets vs. Financial Investments).
2. Implement an Asset Revaluation / Appreciation module (Mark-to-Market).
3. Implement a Straight-Line Depreciation schedule generator for fixed assets.
4. Auto-post unrealized gains/losses and depreciation entries to the General Ledger.

---

## 2. Technical Architecture & Schema Upgrades

### A. Extended Asset Schema (`src/types/asset.ts`)
```ts
export type AssetType = 'FIXED_ASSET' | 'FINANCIAL_INVESTMENT' | 'INTANGIBLE';

export interface Asset {
  id: string;
  name: string;
  type: AssetType;
  category: 'Shares' | 'Bonds' | 'Group Equity (SACCOS/VIKOBA)' | 'Equipment' | 'Property' | 'Other';
  acquisitionCost: number;
  currentValue: number;
  acquiredDate: string; // YYYY-MM-DD
  usefulLifeYears?: number; // For depreciation
  salvageValue?: number;     // For depreciation
  lastRevaluationDate?: string;
}

export interface AssetRevaluationHistory {
  id: string;
  assetId: string;
  date: string;
  previousValue: number;
  newValue: number;
  gainLossAmount: number;
  notes?: string;
}

```

### B. Accounting Posting Rules

* **When Asset Appreciates (Revaluation Gain):**
* **Debit:** Asset Account (`Asset`) -> Increases Carrying Value
* **Credit:** Revaluation Gain / Other Income (`Income` / `Equity`)


* **When Asset Depreciates:**
* **Debit:** Depreciation Expense (`Expense`)
* **Credit:** Accumulated Depreciation (`Contra-Asset`)



---

## 3. Calculation Helper Logic (`src/utils/assetEngine.ts`)

```ts
/**
 * Calculates straight-line annual & monthly depreciation.
 */
export function calculateDepreciation(cost: number, salvageValue: number, usefulLifeYears: number) {
  const depreciableBase = Math.max(0, cost - salvageValue);
  const annualDepreciation = depreciableBase / usefulLifeYears;
  const monthlyDepreciation = annualDepreciation / 12;

  return { annualDepreciation, monthlyDepreciation };
}

/**
 * Calculates appreciation rate and unrealized gain/loss.
 */
export function calculateRevaluation(acquisitionCost: number, currentValue: number) {
  const gainLoss = currentValue - acquisitionCost;
  const percentageChange = acquisitionCost > 0 ? (gainLoss / acquisitionCost) * 100 : 0;

  return {
    gainLoss: Number(gainLoss.toFixed(2)),
    percentageChange: Number(percentageChange.toFixed(2)),
    isGain: gainLoss >= 0,
  };
}

```

---

## 4. UI Enhancements for Assets View (`/app/assets`)

1. **Revaluation Button (`+ Revalue / Update Market Price`):**
* Provide an inline action for investments (e.g., *vodaacom shares*, *CRDB bonds*) allowing users to record the latest market price.


2. **Gain/Loss Metrics Summary:**
* Display total unrealized gains across all investment assets in the summary header.


3. **Depreciation Schedule Tab:**
* For fixed assets, render a tab showing monthly accumulated depreciation and net book value.



---

## 5. Execution Instructions for Claude Code

1. Update `src/types/asset.ts` with extended fields for asset types, depreciation rules, and revaluation history.
2. Build the `calculateRevaluation` and `calculateDepreciation` utilities in `src/utils/assetEngine.ts`.
3. Add a **"Revalue Asset" modal** to `src/pages/Assets.tsx` to update current market values and auto-post the gain/loss entry to the General Ledger.
4. Run `npm run build` or `pnpm build` to verify type safety and build health.
