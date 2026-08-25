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
// Fixed categorical palette for the unpaid-by-customer donut slices — a
// customer keeps the same color across re-renders/filters since it's
// assigned by array position within a sorted (by amount) list.
const CUSTOMER_DONUT_COLORS = ['#e0722f', '#4f7cff', '#8a63ff', '#ff6b6b', '#34c07a', '#ffb347']

function KpiCard({ label, value, health, onClick }) {
  const isCritical = health === 'critical';
  const isWarning = health === 'warning';
  const isHealthy = health === 'healthy';

  return (
    <div
      className="card home-kpi-card metric-card"
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default', position: 'relative' }}
    >
      <div className="label">{label}</div>
      <div className="value" style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      {(isCritical || isWarning || isHealthy) && (
        <div style={{
          position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: '50%',
          backgroundColor: isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--success)',
          boxShadow: `0 0 8px ${isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--success)'}`,
          animation: isCritical ? 'pulse 2s infinite' : 'none'
        }} />
      )}
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

// Small "quick stat" ring — a CSS conic-gradient donut with the percentage
// punched through the middle, plus a label/sublabel beside it. Cheap to
// render (no chart library needed) for glanceable ratios like collection
// rate or how much of the unpaid balance sits with one customer.
function MiniRing({ label, sublabel, percent, color }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent || 0)))
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        style={{
          width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
          background: `conic-gradient(${color} ${pct * 3.6}deg, var(--surface-sunken) 0deg)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <div style={{
          width: 46, height: 46, borderRadius: '50%', background: 'var(--surface)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700,
        }}>
          {pct}%
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{sublabel}</div>
      </div>
    </div>
  )
}

// The "ACTIVITY $125.5" style ring from the reference image: a donut chart
// with the headline number placed in the punched-out center via absolute
// positioning over the ResponsiveContainer, rather than recharts' own
// (much more limited) label positioning.
function ActivityRing({ data, centerValue, centerLabel, colors }) {
  return (
    <div style={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={280}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="bucket"
            cx="50%"
            cy="50%"
            innerRadius={70}
            outerRadius={110}
            paddingAngle={3}
            cornerRadius={6}
          >
            {data.map((entry, i) => (
              <Cell key={entry.bucket} fill={colors[i % colors.length]} stroke="none" />
            ))}
          </Pie>
          <Tooltip formatter={(v) => money(v)} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        textAlign: 'center', pointerEvents: 'none',
      }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{centerLabel}</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{centerValue}</div>
      </div>
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

  // Top 5 unpaid customers + an "Other" slice for the remainder, for the
  // donut breakdown (a straight top-10 list doesn't read well as a donut —
  // too many thin slices — so this caps it the way a real report would).
  const unpaidDonutData = (() => {
    if (!data) return []
    const top5 = data.unpaid_by_customer.slice(0, 5)
    const top5Total = top5.reduce((s, c) => s + c.amount, 0)
    const other = data.summary.total_unpaid - top5Total
    return other > 0.5 ? [...top5, { customer: 'Other', amount: other }] : top5
  })()

  // Quick-stat ring percentages, derived from data already in the payload.
  const ringStats = (() => {
    if (!data) return null
    const { total_unpaid, total_paid, total_overdue } = data.summary
    const currentBucket = data.aging.find((b) => b.bucket === 'Current')
    const collectionRate = total_paid + total_unpaid > 0 ? (total_paid / (total_paid + total_unpaid)) * 100 : 0
    const overdueShare = total_unpaid > 0 ? (total_overdue / total_unpaid) * 100 : 0
    const currentShare = total_unpaid > 0 && currentBucket ? (currentBucket.amount / total_unpaid) * 100 : 0
    const topCustomerShare = total_unpaid > 0 && data.unpaid_by_customer[0]
      ? (data.unpaid_by_customer[0].amount / total_unpaid) * 100 : 0
    return { collectionRate, overdueShare, currentShare, topCustomerShare }
  })()

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
          <div className="card-grid" style={{ marginBottom: 16 }}>
            <KpiCard label="Total Unpaid" value={money(data.summary.total_unpaid)} health={data.summary.total_unpaid > 0 ? 'warning' : 'healthy'} />
            <KpiCard label="Total Overdue" value={money(data.summary.total_overdue)} health={data.summary.total_overdue > 0 ? 'critical' : 'healthy'} />
            <KpiCard label="Unpaid Invoices" value={data.summary.unpaid_count} />
            <KpiCard label="Overdue Invoices" value={data.summary.overdue_count} health={data.summary.overdue_count > 0 ? 'critical' : 'healthy'} />
            <KpiCard label="Avg. Days Overdue" value={data.summary.avg_days_overdue} health={data.summary.avg_days_overdue > 30 ? 'critical' : data.summary.avg_days_overdue > 0 ? 'warning' : 'healthy'} />
            <KpiCard label="Total Paid (period)" value={money(data.summary.total_paid)} health="healthy" />
          </div>

          {/* Quick-stat rings */}
          <div className="card-grid" style={{ marginBottom: 20 }}>
            <MiniRing label="Collection Rate" sublabel="Paid vs. total invoiced" percent={ringStats.collectionRate} color="#34c07a" />
            <MiniRing label="Overdue Share" sublabel="Of total unpaid" percent={ringStats.overdueShare} color="#e63946" />
            <MiniRing label="Not Yet Due" sublabel="Of total unpaid" percent={ringStats.currentShare} color="#4f7cff" />
            <MiniRing
              label="Top Customer"
              sublabel={data.unpaid_by_customer[0] ? data.unpaid_by_customer[0].customer : 'Concentration'}
              percent={ringStats.topCustomerShare}
              color="#8a63ff"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
            {/* Unpaid invoices by customer — donut (top 5 + Other) */}
            <ChartCard title="Unpaid Composition by Customer">
              {unpaidDonutData.length === 0 ? (
                <div className="doc-sheet-muted">No unpaid invoices in this period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={unpaidDonutData}
                      dataKey="amount"
                      nameKey="customer"
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={100}
                      paddingAngle={2}
                      label={(entry) => `${entry.customer}: ${Math.round((entry.amount / data.summary.total_unpaid) * 100)}%`}
                    >
                      {unpaidDonutData.map((entry, i) => (
                        <Cell key={entry.customer} fill={entry.customer === 'Other' ? '#c9c2b4' : CUSTOMER_DONUT_COLORS[i % CUSTOMER_DONUT_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => money(v)} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            {/* AR aging — activity ring with center total */}
            <ChartCard title="AR Aging">
              <ActivityRing
                data={data.aging}
                centerValue={money(data.summary.total_unpaid)}
                centerLabel="Total unpaid"
                colors={AGING_COLORS}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', justifyContent: 'center', marginTop: 8 }}>
                {data.aging.map((b, i) => (
                  <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: AGING_COLORS[i % AGING_COLORS.length], display: 'inline-block' }} />
                    <span style={{ color: 'var(--text-muted)' }}>{b.bucket}</span>
                    <span style={{ fontWeight: 700 }}>{money(b.amount)}</span>
                  </div>
                ))}
              </div>
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

          {/* Last 12 months: raised vs paid — full width, independent of the date filter */}
          <ChartCard
            title="Last 12 Months — Raised vs Paid"
            subtitle={customer ? `Filtered to ${customer}. This chart always shows a rolling 12 months, regardless of the Date from/to filter above.` : 'This chart always shows a rolling 12 months, regardless of the Date from/to filter above.'}
          >
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.paid_last_12_months}>
                <defs>
                  <linearGradient id="arRaisedTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4f7cff" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#4f7cff" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="arPaidTrend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34c07a" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#34c07a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis tickFormatter={(v) => money(v)} fontSize={11} width={80} />
                <Tooltip formatter={(v) => money(v)} />
                <Legend />
                <Area type="monotone" dataKey="raised" name="Invoiced" stroke="#4f7cff" fill="url(#arRaisedTrend)" strokeWidth={2} />
                <Area type="monotone" dataKey="paid" name="Paid" stroke="#34c07a" fill="url(#arPaidTrend)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
        </>
      )}
    </div>
  )
}
