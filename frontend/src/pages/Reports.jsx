import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { apiUrl } from '../api-config.js'
import { downloadFile } from '../utils/download.js'
import Accordion from '../components/Accordion.jsx'
import { AlertBannerContainer } from '../components/AlertBanner.jsx'
import ReconciliationStatement from '../components/ReconciliationStatement.jsx'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString()}`
}

const marginColor = (n) => (n >= 0 ? 'var(--success)' : 'var(--danger)')

function Row({ left, right, bold, color, border }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', fontSize: bold ? 15 : 14,
      fontWeight: bold ? 700 : 400, padding: border ? '10px 0 6px' : '6px 0',
      color: color || 'inherit',
    }}>
      <span>{left}</span><span>{right}</span>
    </div>
  )
}

// Financial Summary: point-in-time (or period) headline numbers.
function FinancialSummary({ data }) {
  return (
    <>
      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Net Profit</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: marginColor(data.net_profit), marginTop: 2 }}>
              {money(data.net_profit)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              {data.net_margin_pct}% net margin
            </div>
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Revenue</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{money(data.revenue)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Gross Profit</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{money(data.gross_profit)}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{data.gross_margin_pct}% margin</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card-grid">
        <div className="card metric-card"><div className="label">Revenue</div><div className="value">{money(data.revenue)}</div></div>
        <div className="card metric-card"><div className="label">Cost of Goods Sold</div><div className="value">{money(data.cogs)}</div></div>
        <div className="card metric-card"><div className="label">Gross Profit</div><div className="value">{money(data.gross_profit)}</div></div>
        <div className="card metric-card"><div className="label">Expenses</div><div className="value">{money(data.expenses)}</div></div>
        <div className="card metric-card"><div className="label">Purchases</div><div className="value">{money(data.purchases)}</div></div>
        <div className="card metric-card">
          <div className="label">Net Profit</div>
          <div className="value" style={{ color: marginColor(data.net_profit) }}>{money(data.net_profit)}</div>
        </div>
        <div className="card metric-card"><div className="label">Receivables (owed to you)</div><div className="value">{money(data.receivables)}</div></div>
        <div className="card metric-card"><div className="label">Payables (you owe)</div><div className="value">{money(data.payables)}</div></div>
      </div>
    </>
  )
}

// Profit & Loss: revenue/expense breakdown plus per-item profitability.
function ProfitLoss({ data }) {
  return (
    <>
      <Accordion title="1. Summary & Net Profit" defaultOpen={true}>
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Net Profit</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: marginColor(data.net_profit), marginTop: 2 }}>
              {money(data.net_profit)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
              Total Revenue: {money(data.total_revenue)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Gross Profit</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{money(data.total_revenue - data.cogs)}</div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Total Expenses</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{money(data.total_expenses)}</div>
            </div>
          </div>
        </div>
      </Accordion>

      <Accordion title="2. Expenses by Category" defaultOpen={true}>
        <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
          {Object.entries(data.by_category || {}).map(([cat, amount]) => (
            <Row key={cat} left={cat} right={money(amount)} />
          ))}
          <Row left="Total Operating Expenses" right={money(data.total_expenses)} bold border />
        </div>
      </Accordion>

      <Accordion title="3. Margin by Item (Top Sales)" defaultOpen={false}>
        <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
          {(data.item_breakdown || []).map((it) => (
            <Row
              key={it.name}
              left={`${it.name} (${it.quantity_sold} sold)`}
              right={`${money(it.profit)} profit (${it.margin_pct}%)`}
              color={marginColor(it.profit)}
            />
          ))}
        </div>
      </Accordion>
    </>
  )
}

function CashFlow({ data }) {
  return (
    <>
      <div className="card-grid" style={{ marginBottom: 20 }}>
        <div className="card home-kpi-card metric-card">
          <div className="label">12-Month Net Flow</div>
          <div className="value" style={{ color: marginColor(data.net_12m) }}>{money(data.net_12m)}</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Monthly Cash Flow</h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="pl-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Incoming</th>
                <th>Outgoing</th>
                <th>Net</th>
                <th>Balance</th>
              </tr>
            </thead>
            <tbody>
              {data.series.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td>{money(m.incoming)}</td>
                  <td>{money(m.outgoing)}</td>
                  <td style={{ color: marginColor(m.net), fontWeight: 600 }}>{money(m.net)}</td>
                  <td>{money(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function LedgerReport({ data, listKey, title, onReconcile, isCreditorReport = false }) {
  const [categorizeBy, setCategorizeBy] = useState('accounts') // 'accounts' or 'aging'
  const accounts = data.accounts || []

  const downloadNote = (acc) => {
    if (isCreditorReport) {
      downloadFile(apiUrl(`/api/ledgers/creditors/${acc.id}/credit-note/pdf`), `CreditNote-${acc.name.replace(/\s+/g, '-')}.pdf`)
    } else {
      downloadFile(apiUrl(`/api/ledgers/debtors/${acc.id}/debit-note/pdf`), `DebitNote-${acc.name.replace(/\s+/g, '-')}.pdf`)
    }
  }

  return (
    <>
      <div className="card-grid">
        <div className="card home-kpi-card metric-card">
          <div className="label">Total Outstanding</div>
          <div className="value">{money(data.total_outstanding)}</div>
        </div>
        <div className="card home-kpi-card metric-card">
          <div className="label">Total Accounts</div>
          <div className="value">{data.count}</div>
        </div>
        {Object.entries(data.by_status || {}).map(([status, count]) => (
          <div className="card home-kpi-card metric-card" key={status}>
            <div className="label" style={{ textTransform: 'capitalize' }}>{status}</div>
            <div className="value">{count}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)' }}>Categorize by:</span>
          <div className="receipt-width-toggle">
            <button
              type="button"
              className={categorizeBy === 'accounts' ? 'active' : ''}
              onClick={() => setCategorizeBy('accounts')}
            >
              Customer / Supplier Accounts ({accounts.length})
            </button>
            <button
              type="button"
              className={categorizeBy === 'aging' ? 'active' : ''}
              onClick={() => setCategorizeBy('aging')}
            >
              Time Aging Buckets
            </button>
          </div>
        </div>
        <button className="btn btn-outline btn-sm" onClick={() => onReconcile && onReconcile({})}>
          🤝 Reconcile Account
        </button>
      </div>

      {categorizeBy === 'accounts' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {accounts.map((acc) => (
            <Accordion
              key={acc.id}
              title={`${acc.name} — Balance: ${money(acc.balance)} (${acc.status})`}
              defaultOpen={acc.balance > 0}
            >
              <div style={{ padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Phone: {acc.phone || '—'} | TIN: {acc.tin_number || '—'} | Added: {acc.created_at ? new Date(acc.created_at).toLocaleDateString() : '—'}
                    </div>
                    {acc.note && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>Note: {acc.note}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-outline btn-sm" onClick={() => downloadNote(acc)}>
                      {isCreditorReport ? '⬇ Credit Note (PDF)' : '⬇ Debit Note (PDF)'}
                    </button>
                    <button className="btn btn-outline btn-sm" onClick={() => onReconcile && onReconcile({ phone: acc.phone || '', tin: acc.tin_number || '' })}>
                      🤝 Reconcile
                    </button>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 16, marginBottom: 12, padding: '10px 14px', background: 'var(--surface-sunken)', borderRadius: 8, flexWrap: 'wrap' }}>
                  <div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>TOTAL OWED: </span><strong>{money(acc.total_owed)}</strong></div>
                  <div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>PAID: </span><strong>{money(acc.amount_paid)}</strong></div>
                  <div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>REMAINING BALANCE: </span><strong style={{ color: acc.balance > 0 ? 'var(--danger)' : 'var(--success)' }}>{money(acc.balance)}</strong></div>
                </div>

                {acc.items && acc.items.length > 0 ? (
                  <table className="pl-table" style={{ fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th>Item Description</th>
                        <th style={{ textAlign: 'right' }}>Qty</th>
                        <th style={{ textAlign: 'right' }}>Unit Price</th>
                        <th style={{ textAlign: 'right' }}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {acc.items.map((it, idx) => (
                        <tr key={idx}>
                          <td>{it.description}</td>
                          <td style={{ textAlign: 'right' }}>{it.quantity}</td>
                          <td style={{ textAlign: 'right' }}>{money(it.unit_price)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(it.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div style={{ fontSize: 13, color: 'var(--text-faint)' }}>No itemized breakdown recorded for this account.</div>
                )}
              </div>
            </Accordion>
          ))}
          {accounts.length === 0 && (
            <div className="card" style={{ color: 'var(--text-muted)', padding: 16 }}>No creditor accounts found.</div>
          )}
        </div>
      )}

      {categorizeBy === 'aging' && data.aging && (
        <div>
          <div className="card-grid" style={{ marginBottom: 16 }}>
            {Object.entries({
              current_0_30: '0–30 days',
              days_31_60: '31–60 days',
              days_61_90: '61–90 days',
              over_90: 'Over 90 days (at risk)',
            }).map(([key, label]) => (
              <div className="card home-kpi-card metric-card" key={key}>
                <div className="label">{label}</div>
                <div className="value" style={key === 'over_90' ? { color: 'var(--danger)' } : undefined}>
                  {money((data.aging.summary || {})[key])}
                </div>
              </div>
            ))}
          </div>

          {Object.entries({
            current_0_30: '0–30 days',
            days_31_60: '31–60 days',
            days_61_90: '61–90 days',
            over_90: 'Over 90 days (at risk)',
          }).map(([key, label]) => {
            const rows = (data.aging.buckets || {})[key] || []
            if (rows.length === 0) return null
            return (
              <Accordion key={key} title={`${label} — Detailed List (${rows.length})`} defaultOpen={key === 'over_90'}>
                <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
                  {rows.map((r, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <div>
                        <strong>{r.name}</strong>
                        {r.phone && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}> ({r.phone})</span>}
                        <span style={{ fontSize: 12, color: 'var(--text-faint)', marginLeft: 8 }}>— {r.age_days}d</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontWeight: 700, color: key === 'over_90' ? 'var(--danger)' : 'inherit' }}>{money(r.balance)}</span>
                        <button className="btn btn-outline btn-sm" onClick={() => onReconcile && onReconcile({ phone: r.phone || '', tin: r.tin_number || '' })}>
                          🤝 Reconcile
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </Accordion>
            )
          })}
        </div>
      )}
    </>
  )
}

function InventoryValuation({ data }) {
  return (
    <>
      <div className="card-grid">
        <div className="card home-kpi-card metric-card">
          <div className="label">Total Inventory Value</div>
          <div className="value">{money(data.total_value)}</div>
        </div>
      </div>

      <Accordion title="Value by Category" defaultOpen={true}>
        <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
          {Object.entries(data.by_category).map(([name, val]) => (
            <Row key={name} left={name} right={money(val)} />
          ))}
        </div>
      </Accordion>

      <Accordion title="Top Items by Value" defaultOpen={true}>
        <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
          {(data.top_items || []).map((i) => (
            <Row
              key={i.item_name}
              left={i.low_stock ? `${i.item_name} ⚠️ low stock` : i.item_name}
              right={money(i.value)}
            />
          ))}
        </div>
      </Accordion>
    </>
  )
}

function TrialBalance({ data }) {
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Trial Balance</h3>
      <div style={{ overflowX: 'auto' }}>
        <table className="pl-table">
          <thead>
            <tr>
              <th>Account Code</th>
              <th>Account Name</th>
              <th>Type</th>
              <th style={{ textAlign: 'right' }}>Debit</th>
              <th style={{ textAlign: 'right' }}>Credit</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {(data.accounts || []).map((acc) => (
              <tr key={acc.code}>
                <td>{acc.code}</td>
                <td>{acc.name}</td>
                <td style={{ textTransform: 'capitalize' }}>{acc.account_type}</td>
                <td style={{ textAlign: 'right' }}>{acc.total_debit > 0 ? money(acc.total_debit) : '—'}</td>
                <td style={{ textAlign: 'right' }}>{acc.total_credit > 0 ? money(acc.total_credit) : '—'}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(acc.balance)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '2px solid var(--border-strong)', backgroundColor: 'var(--surface-sunken)', fontWeight: 700 }}>
              <td colSpan={3}>Totals</td>
              <td style={{ textAlign: 'right' }}>{money(data.total_debits)}</td>
              <td style={{ textAlign: 'right' }}>{money(data.total_credits)}</td>
              <td style={{ textAlign: 'right' }}>{money((data.total_debits || 0) - (data.total_credits || 0))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function BalanceSheet({ data }) {
  return (
    <>
      <div className="card-grid" style={{ marginBottom: 20 }}>
        <div className="card home-kpi-card metric-card">
          <div className="label">Total Assets</div>
          <div className="value">{money(data.total_assets)}</div>
        </div>
        <div className="card home-kpi-card metric-card">
          <div className="label">Total Liabilities</div>
          <div className="value">{money(data.total_liabilities)}</div>
        </div>
        <div className="card home-kpi-card metric-card">
          <div className="label">Total Equity</div>
          <div className="value">{money(data.total_equity)}</div>
        </div>
      </div>

      <Accordion title="Assets" defaultOpen={true}>
        <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
          {Object.entries(data.assets || {}).map(([name, val]) => (
            <Row key={name} left={name} right={money(val)} />
          ))}
          <Row left="Total Assets" right={money(data.total_assets)} bold border />
        </div>
      </Accordion>

      <Accordion title="Liabilities" defaultOpen={true}>
        <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
          {Object.entries(data.liabilities || {}).map(([name, val]) => (
            <Row key={name} left={name} right={money(val)} />
          ))}
          <Row left="Total Liabilities" right={money(data.total_liabilities)} bold border />
        </div>
      </Accordion>

      <Accordion title="Equity" defaultOpen={true}>
        <div style={{ background: 'transparent', padding: '4px 16px', borderRadius: '12px' }}>
          {Object.entries(data.equity || {}).map(([name, val]) => (
            <Row key={name} left={name} right={money(val)} />
          ))}
          <Row left="Total Equity" right={money(data.total_equity)} bold border />
        </div>
      </Accordion>
    </>
  )
}

function VATReturn({ data }) {
  const statusColors = {
    refund_due: 'var(--success)',
    payment_due: 'var(--danger)',
    balanced: 'var(--text-muted)',
  }
  const statusLabels = {
    refund_due: 'Refund Due',
    payment_due: 'Payment Due',
    balanced: 'Balanced',
  }

  return (
    <>
      <div className="card-grid" style={{ marginBottom: 20 }}>
        <div className="card metric-card">
          <div className="label">VAT Output (Sales)</div>
          <div className="value">{money(data.vat_output)}</div>
        </div>
        <div className="card metric-card">
          <div className="label">VAT Input (Purchases)</div>
          <div className="value">{money(data.vat_input)}</div>
        </div>
        <div className="card metric-card">
          <div className="label">Net VAT Due</div>
          <div className="value" style={{ color: statusColors[data.status] }}>
            {money(data.net_vat_due)}
          </div>
        </div>
        <div className="card metric-card">
          <div className="label">Status</div>
          <div className="value" style={{ color: statusColors[data.status], textTransform: 'capitalize' }}>
            {statusLabels[data.status]}
          </div>
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>VAT Return Summary</h3>
        <Row left="Period Start" right={data.period_start || 'All time'} />
        <Row left="Period End" right={data.period_end || 'Now'} />
        <Row left="Total Output VAT" right={money(data.vat_output)} />
        <Row left="Total Input VAT" right={money(data.vat_input)} />
        <Row left="Net VAT Due" right={money(data.net_vat_due)} bold color={statusColors[data.status]} border />
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>
          This report calculates VAT liability based on posted journal entries to the VAT Payable (Output) 
          and VAT Receivable (Input) accounts. Ensure all sales and purchases with VAT are properly recorded.
        </div>
      </div>
    </>
  )
}

const VIEW_CONFIG = {
  'profit-loss': { title: 'Profit & Loss', endpoint: '/reports/profit-loss', dateFilter: true, Component: ProfitLoss },
  'financial-summary': { title: 'Financial Summary', endpoint: '/reports/financial-summary', dateFilter: true, Component: FinancialSummary },
  'cashflow': { title: 'Cash Flow', endpoint: '/reports/cashflow?months=12', dateFilter: false, Component: CashFlow },
  'debtors': { title: 'Debtors Report', endpoint: '/reports/debtors', dateFilter: false, Component: (p) => <LedgerReport {...p} listKey="top_debtors" title="Top Debtors" /> },
  'creditors': { title: 'Creditors Report', endpoint: '/reports/creditors', dateFilter: false, Component: (p) => <LedgerReport {...p} listKey="top_creditors" title="Top Creditors" /> },
  'inventory-valuation': { title: 'Inventory Valuation', endpoint: '/reports/inventory-valuation', dateFilter: false, Component: InventoryValuation },
  'trial-balance': { title: 'Trial Balance', endpoint: '/reports/trial-balance', dateFilter: true, Component: TrialBalance },
  'balance-sheet': { title: 'Balance Sheet', endpoint: '/reports/balance-sheet', dateFilter: true, Component: BalanceSheet },
  'vat-return': { title: 'VAT Return', endpoint: '/reports/vat-return', dateFilter: true, Component: VATReturn },
}

export default function Reports({ view }) {
  const api = useApi()
  const { account } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [exporting, setExporting] = useState(false)
  const [reminders, setReminders] = useState([])
  const [reconcileTarget, setReconcileTarget] = useState(null)

  const config = VIEW_CONFIG[view] || VIEW_CONFIG['financial-summary']

  const loadReminders = () => {
    api.get('/reminders/').then(data => {
      const map = new Map();
      const result = [];
      const loanRegex = /Payment to (.*) is due (\d+) day\(s\) overdue/;
      const invoiceRegex = /\((.*)\) is (\d+) day\(s\) overdue/;
      data.forEach(r => {
        const loanMatch = r.text.match(loanRegex);
        const invMatch = r.text.match(invoiceRegex);
        if (loanMatch || invMatch) {
          const entity = loanMatch ? loanMatch[1] : `Invoice (${invMatch[1]})`;
          const days = parseInt(loanMatch ? loanMatch[2] : invMatch[2], 10);
          const existing = map.get(entity);
          if (!existing || days > existing.days) map.set(entity, { id: r.id, days, record: r });
        } else { result.push(r); }
      });
      setReminders([...result, ...Array.from(map.values()).map(v => v.record)]);
    }).catch(() => {})
  }

  const dismissReminder = (id) => {
    setReminders((prev) => prev.filter((r) => r.id !== id))
    api.patch(`/reminders/${id}/done`, {}).catch(loadReminders)
  }

  const load = () => {
    setData(null)
    setError('')
    let endpoint = config.endpoint
    if (config.dateFilter && (start || end)) {
      const params = new URLSearchParams()
      if (start) params.set('start', start)
      if (end) params.set('end', end)
      endpoint += (endpoint.includes('?') ? '&' : '?') + params.toString()
    }
    api.get(endpoint).then(setData).catch((e) => setError(e.message))
  }

  useEffect(() => {
    setStart('')
    setEnd('')
    setData(null)
    setError('')
    api.get(config.endpoint).then(setData).catch((e) => setError(e.message))
    loadReminders()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const handleExport = () => {
    let endpoint = `/api/reports/export/${view}`
    const params = new URLSearchParams()
    if (config.dateFilter) {
      if (start) params.set('start', start)
      if (end) params.set('end', end)
    }
    if ([...params].length) endpoint += `?${params.toString()}`
    downloadFile(apiUrl(endpoint), `${config.title.replace(/\s+/g, '_')}.xlsx`)
  }

  const Component = config.Component

  return (
    <div className="page">
      <div className="page-header">
        <h1>{config.title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={handleExport} disabled={exporting || !data}>
            {exporting ? 'Exporting…' : ' Export Excel'}
          </button>
        </div>
      </div>

      <AlertBannerContainer reminders={reminders} onDismiss={dismissReminder} />

      {config.dateFilter && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>From:</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>To:</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <button className="btn btn-outline" onClick={load}>Apply Filter</button>
          {(start || end) && (
            <button className="btn btn-outline" onClick={() => { setStart(''); setEnd(''); load() }}>
              Reset
            </button>
          )}
        </div>
      )}

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {!data ? (
        <div className="card" style={{ padding: 24, color: 'var(--text-muted)' }}>Loading report…</div>
      ) : (
        <Component data={data} onReconcile={(target) => setReconcileTarget(target)} />
      )}

      {reconcileTarget && (
        <ReconciliationStatement
          company={account}
          initialPhone={reconcileTarget.phone || ''}
          initialTin={reconcileTarget.tin || ''}
          onClose={() => setReconcileTarget(null)}
        />
      )}
    </div>
  )
}
