import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'

export default function Reports({ view }) {
  const api = useApi()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const endpoint = view === 'profit-loss' ? '/reports/profit-loss' : '/reports/financial-summary'
    api.get(endpoint).then(setData).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const title = view === 'profit-loss' ? 'Profit & Loss' : 'Financial Summary'

  return (
    <div className="page">
      <div className="page-header"><h1>{title}</h1></div>
      {error && <div className="error-text">{error}</div>}
      {!data && !error && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}

      {data && view === 'financial-summary' && (
        <div className="card-grid">
          <div className="card metric-card"><div className="label">Revenue</div><div className="value">TZS {data.revenue.toLocaleString()}</div></div>
          <div className="card metric-card"><div className="label">COGS</div><div className="value">TZS {data.cogs.toLocaleString()}</div></div>
          <div className="card metric-card"><div className="label">Gross Profit</div><div className="value">TZS {data.gross_profit.toLocaleString()}</div></div>
          <div className="card metric-card"><div className="label">Expenses</div><div className="value">TZS {data.expenses.toLocaleString()}</div></div>
          <div className="card metric-card"><div className="label">Net Profit</div><div className="value">TZS {data.net_profit.toLocaleString()}</div></div>
        </div>
      )}

      {data && view === 'profit-loss' && (
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div className="card" style={{ flex: 1, minWidth: 280 }}>
            <h3 style={{ marginTop: 0 }}>Revenue by Item</h3>
            {Object.entries(data.revenue_by_item).map(([name, val]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0', borderBottom: '1px solid #f0ece1' }}>
                <span>{name}</span><span>TZS {val.toLocaleString()}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 10 }}>
              <span>Total Revenue</span><span>TZS {data.total_revenue.toLocaleString()}</span>
            </div>
          </div>
          <div className="card" style={{ flex: 1, minWidth: 280 }}>
            <h3 style={{ marginTop: 0 }}>Expenses by Category</h3>
            {Object.entries(data.expense_by_category).map(([name, val]) => (
              <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '6px 0', borderBottom: '1px solid #f0ece1' }}>
                <span>{name}</span><span>TZS {val.toLocaleString()}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 10 }}>
              <span>Total Expenses</span><span>TZS {data.total_expenses.toLocaleString()}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 6, color: data.net_profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              <span>Net Profit</span><span>TZS {data.net_profit.toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
