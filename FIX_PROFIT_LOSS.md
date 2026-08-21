# Specification: Profit & Loss Page Layout & Styling Improvements

## 1. Core Objectives
1. Restructure the P&L report into sequential, collapsible accordion sections:
   - **Section 1:** Financial Summary & Net Profit Overview
   - **Section 2:** Expenses by Category (Collapsible)
   - **Section 3:** Revenue by Item (Collapsible)
   - **Section 4:** Item Profitability Analysis (Collapsible)
2. Remove heavy table grid lines and borders for a cleaner, modern look.
3. Clean up alert banner stacking.

---

## 2. Component Layout Restructuring

### A. Collapsible Accordion Component (`src/components/Accordion.tsx`)
```tsx
import React, { useState } from 'react';

interface AccordionProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

export function Accordion({ title, defaultOpen = false, children }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{ marginBottom: '1rem', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.08)' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '1rem 1.25rem',
          display: 'flex',
          justify: 'space-between',
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.6)',
          border: 'none',
          cursor: 'pointer',
          fontWeight: 600,
          fontSize: '1.1rem',
        }}
      >
        <span>{title}</span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && <div style={{ padding: '1.25rem', background: 'transparent' }}>{children}</div>}
    </div>
  );
}

```

---

## 3. CSS Styling Clean-up (Removing Table Lines)

Update the CSS for the Item Profitability table in `src/pages/reports/ProfitLoss.tsx` (or associated stylesheet):

```css
/* Clean borderless table design */
.pl-table {
  width: 100%;
  border-collapse: collapse;
  border: none !important;
}

.pl-table th {
  border: none !important;
  border-bottom: 2px solid rgba(0, 0, 0, 0.1) !important;
  padding: 10px 14px;
  text-align: left;
  font-weight: 600;
  color: #444;
}

.pl-table td {
  border: none !important; /* Removes inner grid lines */
  padding: 10px 14px;
  background: transparent;
}

/* Subtle row hover effect instead of grid lines */
.pl-table tbody tr:hover {
  background-color: rgba(0, 0, 0, 0.025);
}

```

---

## 4. Execution Instructions for Claude Code

1. Inspect `src/pages/reports/ProfitLoss.tsx` (or equivalent file).
2. Group the existing tables into `<Accordion>` wrappers in the following vertical order:
* `<Accordion title="1. Summary & Net Profit" defaultOpen={true}>`
* `<Accordion title="2. Expenses by Category" defaultOpen={true}>`
* `<Accordion title="3. Revenue by Item" defaultOpen={false}>`
* `<Accordion title="4. Item Profitability Table" defaultOpen={true}>`


3. Apply the clean, borderless table styles to strip all internal grid lines.
4. Run `npm run build` or `pnpm build` to verify there are no TypeScript or compilation errors.
