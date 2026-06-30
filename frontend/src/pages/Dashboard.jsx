import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'

export default function Dashboard() {
  const api = useApi()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/reports/daily-summary'),
      api.get('/inventory/metrics'),
      api.get('/reports/financial-summary'),
    ])
      .then(([d, i, f]) => setData({ daily: d, inv: i, fin: f }))
      .catch((e) => setError(e.message))
  }, [])

  if (!data) return <div className="page">Loading...</div>
  
  const { daily, inv, fin } = data

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Dashboard Overview</h1>
          <div className="text-muted" style={{ fontSize: '13px' }}>Business intelligence at a glance</div>
        </div>
      </div>
      
      {error && <div className="error-text">{error}</div>}

      {/* Use card-grid from globals.css for the responsive 4-column layout */}
      <div className="card-grid">
        <div className="card metric-card">
          <div className="label">TODAY'S REVENUE</div>
          <div className="value">TZS {daily.earnings.toLocaleString()}</div>
          <div className="text-muted" style={{ fontSize: '12px' }}>{daily.items_sold} transaction</div>
        </div>
        
        <div className="card metric-card">
          <div className="label">TOTAL REVENUE</div>
          <div className="value">TZS {fin.total_revenue.toLocaleString()}</div>
          <div className="text-muted" style={{ fontSize: '12px' }}>All time</div>
        </div>

        <div className="card metric-card">
          <div className="label">STOCK ALERTS</div>
          <div className="value" style={{ color: 'var(--danger)' }}>{daily.low_stock_count}</div>
          <div className="text-muted" style={{ fontSize: '12px' }}>Out of stock · {daily.low_stock_secondary || 0} low</div>
        </div>

        <div className="card metric-card">
          <div className="label">OUTSTANDING PAYABLES</div>
          <div className="value">0</div>
          <div className="text-muted" style={{ fontSize: '12px' }}>TZS · 0 creditors</div>
        </div>
      </div>

      <div className="card-grid">
        <div className="card metric-card" style={{ maxWidth: '280px' }}>
          <div className="label">NET PROFIT/LOSS (ALL TIME)</div>
          <div className="value" style={{ color: 'var(--success)' }}>+{fin.net_profit.toLocaleString()}</div>
          <div className="text-muted" style={{ fontSize: '12px' }}>TZS · {fin.margin}% margin</div>
        </div>
      </div>
    </div>
  )
}