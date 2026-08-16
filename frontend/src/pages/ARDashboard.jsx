import { useEffect, useState } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { useApi } from '../hooks/useApi.js'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// Aging bucket colors run green -> red as invoices get older, the same
// traffic-light convention the Coupler.io/Xero template uses so "how bad
// is this" reads at a glance without checking the legend.
const AGING_COLORS = ['#34c07a', '#8ac926', '#ffb347', '#ff8c42', '#e63946']
const PAID_UNPAID_COLORS = { Paid: '#34c07a', Unpaid: '#e0722f' }

function KpiCard({ label, value, tone }) {
  return (
    <div className="card metric-card">
      <div className="label">{label}</div>
      <div className="value" style={tone ? { color: tone } : undefined}>{value}</div>
    </div>
  )
}

function ChartCard({ title, children, subtitle }) {
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: subtitle ? 2 : 12 }}>{title}</h3>
      {subtitle && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>{subtitle}</div>}
      {children}
    </div>
  )
}

export default function ARDashboard() {
  const api = useApi()
  const [customers, setCustomers] = useState([])
  const [customer, setCustomer] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/ar-dashboard/customers').then(setCustomers).catch(() => {})
  }, []) // eslint-disable-line

  const load = () => {
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    if (customer) params.set('customer', customer)
    if (dateFrom) params.set('date_from', new Date(dateFrom).toISOString())
    if (dateTo) {
      const end = new Date(dateTo)
      end.setHours(23, 59, 59, 999)
      params.set('date_to', end.toISOString())
    }
    const qs = params.toString()
    api.get(`/ar-dashboard${qs ? `?${qs}` : ''}`)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, []) // eslint-disable-line

  const resetFilters = () => {
    setCustomer(''); setDateFrom(''); setDateTo('')
    setTimeout(load, 0)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Accounts Receivable Dashboard</h2>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Amounts shown in TZS.</div>
        </div>
      </div>

      {/* Filters — mirrors the template's "Customer" + "Date from/to" panel */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Customer</label>
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Date from</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Date to</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={load}>Apply</button>
        {(customer || dateFrom || dateTo) && (
          <button className="btn btn-outline" onClick={resetFilters}>Reset</button>
        )}
      </div>

      {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

      {loading || !data ? (
        <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="card-grid" style={{ marginBottom: 20 }}>
            <KpiCard label="Total Unpaid" value={money(data.summary.total_unpaid)} />
            <KpiCard label="Total Overdue" value={money(data.summary.total_overdue)} tone="#e0722f" />
            <KpiCard label="Unpaid Invoices" value={data.summary.unpaid_count} />
            <KpiCard label="Overdue Invoices" value={data.summary.overdue_count} tone={data.summary.overdue_count > 0 ? '#e0722f' : undefined} />
            <KpiCard label="Avg. Days Overdue" value={data.summary.avg_days_overdue} />
            <KpiCard label="Total Paid (period)" value={money(data.summary.total_paid)} tone="#34c07a" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
            {/* Unpaid invoices by customer (Top 10) */}
            <ChartCard title="Unpaid Invoices by Customer (Top 10)">
              {data.unpaid_by_customer.length === 0 ? (
                <div className="doc-sheet-muted">No unpaid invoices in this period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.unpaid_by_customer} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => money(v)} fontSize={11} />
                    <YAxis type="category" dataKey="customer" width={110} fontSize={12} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Bar dataKey="amount" fill="#e0722f" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* AR aging */}
            <ChartCard title="AR Aging">
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={data.aging}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="bucket" fontSize={11} />
                  <YAxis tickFormatter={(v) => money(v)} fontSize={11} width={80} />
                  <Tooltip formatter={(v) => money(v)} />
                  <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                    {data.aging.map((entry, i) => (
                      <Cell key={entry.bucket} fill={AGING_COLORS[i % AGING_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Paid vs Unpaid */}
            <ChartCard title="Paid vs Unpaid Invoices">
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.paid_vs_unpaid}
                    dataKey="amount"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(entry) => `${entry.status}: ${money(entry.amount)}`}
                  >
                    {data.paid_vs_unpaid.map((entry) => (
                      <Cell key={entry.status} fill={PAID_UNPAID_COLORS[entry.status] || '#999'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => money(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* Paid invoices by customer */}
            <ChartCard title="Paid Invoices by Customer">
              {data.paid_by_customer.length === 0 ? (
                <div className="doc-sheet-muted">No paid invoices in this period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={data.paid_by_customer} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v) => money(v)} fontSize={11} />
                    <YAxis type="category" dataKey="customer" width={110} fontSize={12} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Bar dataKey="amount" fill="#34c07a" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* Last 12 months paid trend — full width, independent of the date filter */}
          <ChartCard
            title="Last 12 Months — Paid Invoices"
            subtitle={customer ? `Filtered to ${customer}. This chart always shows a rolling 12 months, regardless of the Date from/to filter above.` : 'This chart always shows a rolling 12 months, regardless of the Date from/to filter above.'}
          >
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data.paid_last_12_months}>
                <defs>
                  <linearGradient id="arPaidTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34c07a" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#34c07a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => money(v)} fontSize={11} width={80} />
                <Tooltip formatter={(v) => money(v)} />
                <Area type="monotone" dataKey="amount" stroke="#34c07a" fill="url(#arPaidTrend)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  )
}
