import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import MetricCarousel from '../components/MetricCarousel.jsx'
import { AlertBannerContainer } from '../components/AlertBanner.jsx'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

// Aging bucket colors run green -> red as invoices get older.
const AGING_COLORS = ['#34c07a', '#8ac926', '#ffb347', '#ff8c42', '#e63946']
const PAID_UNPAID_COLORS = { Paid: '#34c07a', Unpaid: '#e0722f' }
const CUSTOMER_DONUT_COLORS = ['#e0722f', '#4f7cff', '#8a63ff', '#ff6b6b', '#34c07a', '#ffb347']

function KpiCard({ label, value, health, onClick, style }) {
  const isWarning = health === 'warning';
  const isHealthy = health === 'healthy';
  const isCritical = health === 'critical';

  return (
    <div
      className="card home-kpi-card metric-card"
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: '110px',
        ...style
      }}
    >
      <div className="label" style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
        {label}
      </div>
      <div className="value" style={{
        fontSize: value?.length > 20 ? 16 : 22,
        fontWeight: 700,
        color: 'var(--text-dark)',
        wordBreak: 'break-word',
      }}>
        {value}
      </div>
      {(isWarning || isHealthy || isCritical) && (
        <div style={{
          position: 'absolute',
          top: 12,
          right: 12,
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--success)',
          boxShadow: `0 0 8px ${isCritical ? 'rgba(180,69,58,0.4)' : isWarning ? 'rgba(185,134,46,0.4)' : 'rgba(107,143,94,0.4)'}`,
          animation: isCritical ? 'pulse 2s infinite' : 'none'
        }} />
      )}
    </div>
  );
}

function CashflowChart({ series }) {
  const { t } = useTranslation()
  if (!series || series.length === 0) return null
  return (
    <div className="card" style={{ marginBottom: 20 }}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>{t('dashboard.cashFlowTitle')}</h3>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        {t('dashboard.cashFlowSubtitle', { count: series.length })}
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={series} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="incomingFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--success)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--success)" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="outgoingFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--danger)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--danger)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--text-muted)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)}
          />
          <Tooltip
            formatter={(value, name) => [money(value), name]}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }}
          />
          <Area type="monotone" dataKey="incoming" name="Incoming" stroke="var(--success)" fill="url(#incomingFill)" strokeWidth={2} />
          <Area type="monotone" dataKey="outgoing" name="Outgoing" stroke="var(--danger)" fill="url(#outgoingFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function ActivityRing({ data, centerValue, centerLabel, colors }) {
  return (
    <div style={{ position: 'relative' }}>
      <ResponsiveContainer width="100%" height={240}>
        <PieChart>
          <Pie
            data={data}
            dataKey="amount"
            nameKey="bucket"
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={90}
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
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{centerLabel}</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{centerValue}</div>
      </div>
    </div>
  )
}

function ARDashboardWidget() {
  const api = useApi()
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/ar-dashboard')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [api])

  if (loading || !data) return null

  const unpaidDonutData = (() => {
    const top5 = data.unpaid_by_customer.slice(0, 5)
    const top5Total = top5.reduce((s, c) => s + c.amount, 0)
    const other = data.summary.total_unpaid - top5Total
    return other > 0.5 ? [...top5, { customer: 'Other', amount: other }] : top5
  })()

  return (
    <div style={{ marginTop: 24, marginBottom: 24 }}>
      <h3 style={{ marginBottom: 16 }}>{t('nav.arDashboard')}</h3>

      <div className="card-grid" style={{ marginBottom: 16 }}>
        <KpiCard label="Total Unpaid" value={money(data.summary.total_unpaid)} health={data.summary.total_unpaid > 0 ? 'warning' : 'healthy'} />
        <KpiCard label="Total Overdue" value={money(data.summary.total_overdue)} health={data.summary.total_overdue > 0 ? 'critical' : 'healthy'} />
        <KpiCard label="Avg. Days Overdue" value={`${data.summary.avg_days_overdue} days`} health={data.summary.avg_days_overdue > 30 ? 'critical' : data.summary.avg_days_overdue > 0 ? 'warning' : 'healthy'} />
        <KpiCard label="Collection Rate" value={`${Math.round((data.summary.total_paid / (data.summary.total_paid + data.summary.total_unpaid)) * 100 || 0)}%`} health="healthy" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div className="card">
          <h4 style={{ marginTop: 0, marginBottom: 12 }}>AR Aging</h4>
          <ActivityRing
            data={data.aging}
            centerValue={money(data.summary.total_unpaid)}
            centerLabel="Total unpaid"
            colors={AGING_COLORS}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', justifyContent: 'center', marginTop: 8 }}>
            {data.aging.map((b, i) => (
              <div key={b.bucket} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: AGING_COLORS[i % AGING_COLORS.length], display: 'inline-block' }} />
                <span style={{ color: 'var(--text-muted)' }}>{b.bucket}</span>
                <span style={{ fontWeight: 700 }}>{money(b.amount)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h4 style={{ marginTop: 0, marginBottom: 12 }}>Unpaid by Customer</h4>
          {unpaidDonutData.length === 0 ? (
            <div className="doc-sheet-muted">No unpaid invoices.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={unpaidDonutData}
                  dataKey="amount"
                  nameKey="customer"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
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
        </div>
      </div>
    </div>
  )
}

function CommunityDashboard() {
  const api = useApi()
  const { t } = useTranslation()
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/community/summary')
      .then(setSummary)
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('nav.home')}</h1>
      </div>

      {error && <div className="error-text">{error}</div>}

      <MetricCarousel
        sectionLabel={t('nav.home')}
        items={[
          { key: 'members', label: t('dashboard.members'), value: summary ? summary.member_count : '—', tone: 'blue', badge: '👥' },
          { key: 'contrib', label: t('dashboard.totalContributionsAllTime'), value: summary ? money(summary.total_contributions) : '—', tone: 'green', badge: '💰' },
          { key: 'payouts', label: t('dashboard.totalPayoutsAllTime'), value: summary ? money(summary.total_payouts) : '—', tone: 'orange', badge: '💵' },
          { key: 'loans', label: t('dashboard.loansOutstanding'), value: summary ? money(summary.total_loans_outstanding) : '—', tone: 'red', badge: '🏦' },
        ]}
      />

      <div className="card-grid dashboard-grid-desktop">
        <KpiCard
          label={t('dashboard.members')}
          value={summary ? summary.member_count : '—'}
          health={summary?.member_count > 0 ? 'healthy' : null}
        />
        <KpiCard
          label={t('dashboard.totalContributionsAllTime')}
          value={summary ? money(summary.total_contributions) : '—'}
          health={summary?.total_contributions > 0 ? 'healthy' : null}
        />
        <KpiCard
          label={t('dashboard.totalPayoutsAllTime')}
          value={summary ? money(summary.total_payouts) : '—'}
        />
        <KpiCard
          label={t('dashboard.loansOutstanding')}
          value={summary ? money(summary.total_loans_outstanding) : '—'}
          health={summary?.total_loans_outstanding > 0 ? 'critical' : 'healthy'}
        />
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3 style={{ marginTop: 0, marginBottom: 4 }}>{t('dashboard.groupFeatures')}</h3>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {summary?.rotation_enabled ? t('dashboard.rotationEnabled') : t('dashboard.rotationDisabled')}
          {' · '}
          {summary?.lending_enabled ? t('dashboard.lendingEnabled') : t('dashboard.lendingDisabled')}
        </div>
      </div>
    </div>
  )
}

function LoansAndDeadlinesWidget({ loans, deadlines }) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  const activeLoans = (loans || []).filter((l) => l.status === 'active')
  const totalOutstanding = activeLoans.reduce((s, l) => {
    const paidPrincipal = (l.payments || []).reduce((sp, p) => sp + p.principal_portion, 0)
    return s + (l.principal - paidPrincipal)
  }, 0)

  const upcomingDeadlines = [...(deadlines || [])]
    .filter(d => d.is_active)
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 3)

  if (activeLoans.length === 0 && upcomingDeadlines.length === 0) return null

  return (
    <div className="card-grid" style={{ marginBottom: 20 }}>
      {activeLoans.length > 0 && (
        <KpiCard
          label={t('bankLoans.totalOutstanding')}
          value={`TZS ${totalOutstanding.toLocaleString()}`}
          health="critical"
          onClick={() => navigate('/app/bank-loans')}
        />
      )}
      {upcomingDeadlines.length > 0 && (
        <div className="card" style={{ cursor: 'pointer', gridColumn: 'span 2' }} onClick={() => navigate('/app/deadlines')}>
          <div className="label" style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('deadlines.upcomingCompliance')}</span>
            <span style={{ fontSize: 10, background: 'var(--danger)', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>ACTION REQUIRED</span>
          </div>
          {upcomingDeadlines.map((d) => {
            const isOverdue = new Date(d.due_date) < new Date();
            return (
              <div key={d.id} style={{ fontSize: 13, display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span style={isOverdue ? { color: 'var(--danger)', fontWeight: 600 } : {}}>{d.label} {isOverdue ? '⚠️' : ''}</span>
                <span style={{ color: isOverdue ? 'var(--danger)' : 'var(--text-muted)' }}>{new Date(d.due_date).toLocaleDateString()}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  )
}

function AuditWidget() {
  const api = useApi()
  const navigate = useNavigate()
  const [auditStats, setAuditStats] = useState(null)

  useEffect(() => {
    // Simple frontend-side audit logic or a dedicated backend call
    api.get('/sales/').then(sales => {
      const zeroSales = sales.filter(s => s.total === 0).length
      const informalNames = sales.filter(s => s.customer_name && s.customer_name.length < 3 && s.customer_name.toLowerCase() !== 'walk-in').length
      setAuditStats({ zeroSales, informalNames })
    }).catch(() => {})
  }, [api])

  if (!auditStats || (auditStats.zeroSales === 0 && auditStats.informalNames === 0)) return null

  return (
    <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid var(--warning)' }}>
      <h3 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>🕵️ Audit Recommendations</span>
        <span className="badge badge-partial">WEEKLY CHECK</span>
      </h3>
      <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {auditStats.zeroSales > 0 && (
          <div>⚠️ Found <strong>{auditStats.zeroSales}</strong> sales with zero value. This distorts revenue reports.</div>
        )}
        {auditStats.informalNames > 0 && (
          <div>📋 Found <strong>{auditStats.informalNames}</strong> informal customer entries. Clean these up to ensure collection accuracy.</div>
        )}
        <button className="btn btn-outline btn-sm" onClick={() => navigate('/app/activity')} style={{ width: 'fit-content' }}>
          View Activity Logs
        </button>
      </div>
    </div>
  )
}

function BusinessDashboard() {
  const api = useApi()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { user } = useAuth()

  const isManagement = user?.role === 'admin' || user?.role === 'manager' || user?.role === 'accountant'
  const isSalesTeam = user?.role === 'sales'
  const isInventoryTeam = user?.role === 'inventory'

  const [daily, setDaily] = useState(null)
  const [inv, setInv] = useState(null)
  const [fin, setFin] = useState(null)
  const [cashflow, setCashflow] = useState(null)
  const [salesStats, setSalesStats] = useState(null)
  const [lowStock, setLowStock] = useState([])
  const [loans, setLoans] = useState([])
  const [deadlines, setDeadlines] = useState([])
  const [reminders, setReminders] = useState([])
  const [error, setError] = useState('')

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

  useEffect(() => {
    const calls = [
      api.get('/reports/daily-summary'),
      api.get('/inventory/metrics'),
      api.get('/inventory/low-stock/alerts'),
      api.get('/reminders/').catch(() => []),
    ]

    if (isManagement) {
      calls.push(api.get('/reports/financial-summary'))
      calls.push(api.get('/reports/cashflow?months=12'))
      calls.push(api.get('/sales/stats/summary'))
      calls.push(api.get('/bank-loans/').catch(() => []))
      calls.push(api.get('/deadlines/').catch(() => []))
    }

    Promise.all(calls)
      .then((results) => {
        setDaily(results[0])
        setInv(results[1])
        setLowStock(results[2])
        setReminders(results[3])
        if (isManagement) {
          setFin(results[4])
          setCashflow(results[5])
          setSalesStats(results[6])
          setLoans(results[7])
          setDeadlines(results[8])
        }
      })
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManagement])

  // Filter Carousel items by role
  const todayMetrics = [
    { key: 'earnings', label: t('dashboard.todaysEarnings'), value: daily ? `TZS ${daily.earnings.toLocaleString()}` : '—', tone: 'blue', badge: '💰', roles: ['admin', 'manager', 'accountant', 'sales'] },
    { key: 'itemsSold', label: t('dashboard.itemsSoldToday'), value: daily ? daily.items_sold : '—', tone: 'green', badge: '📦', roles: ['admin', 'manager', 'accountant', 'sales', 'inventory'] },
    { key: 'topProduct', label: t('dashboard.topProductToday'), value: daily?.top_product || t('dashboard.noSalesYet'), valueFontSize: 19, tone: 'purple', badge: '⭐', roles: ['admin', 'manager', 'accountant', 'sales'] },
    {
      key: 'lowStock', label: t('dashboard.lowStockItems'), value: daily ? daily.low_stock_count : '—',
      tone: 'red', badge: '⚠️', onClick: () => navigate('/app/inventory'), roles: ['admin', 'manager', 'accountant', 'inventory']
    },
  ].filter(m => !m.roles || m.roles.includes(user?.role))

  const overallMetrics = [
    { key: 'invValue', label: t('dashboard.inventoryValue'), value: inv ? `TZS ${inv.total_value.toLocaleString()}` : '—', tone: 'navy', badge: '🏬', roles: ['admin', 'manager', 'accountant', 'inventory'] },
    { key: 'stockUnits', label: t('dashboard.totalStockUnits'), value: inv ? inv.total_units : '—', tone: 'blue', badge: '📦', roles: ['admin', 'manager', 'accountant', 'inventory'] },
    { key: 'netProfit', label: t('dashboard.netProfitAllTime'), value: fin ? `TZS ${fin.net_profit.toLocaleString()}` : '—', tone: 'orange', badge: '📊', roles: ['admin', 'manager', 'accountant'] },
    { key: 'revenue', label: t('dashboard.totalRevenueAllTime'), value: fin ? `TZS ${fin.revenue.toLocaleString()}` : '—', tone: 'green', badge: '💵', roles: ['admin', 'manager', 'accountant'] },
    {
      key: 'mostSold', label: t('dashboard.mostSoldItemAllTime'),
      value: salesStats?.most_sold_item ? `${salesStats.most_sold_item.item_name} (${salesStats.most_sold_item.quantity} sold)` : t('dashboard.noSalesYet'),
      valueFontSize: 18, tone: 'blue', badge: '🏆', roles: ['admin', 'manager', 'accountant', 'sales']
    },
    {
      key: 'topRevenue', label: t('dashboard.topRevenueItemAllTime'),
      value: salesStats?.top_revenue_item ? `${salesStats.top_revenue_item.item_name} (TZS ${salesStats.top_revenue_item.revenue.toLocaleString()})` : t('dashboard.noSalesYet'),
      valueFontSize: 18, tone: 'green', badge: '💵', roles: ['admin', 'manager', 'accountant', 'sales']
    },
  ].filter(m => !m.roles || m.roles.includes(user?.role))

  return (
    <div className="page page-dashboard-home">
      <div className="page-header">
        <h1>{t('nav.home')}</h1>
      </div>

      {error && <div className="error-text">{error}</div>}

      {isManagement && <AuditWidget />}
      <AlertBannerContainer reminders={reminders} onDismiss={dismissReminder} />

      {(isManagement || isInventoryTeam) && lowStock.length > 0 && (
        <div
          onClick={() => navigate('/app/inventory')}
          style={{
            cursor: 'pointer',
            padding: '1rem',
            backgroundColor: 'rgba(237, 108, 2, 0.12)',
            border: '1px solid rgba(237, 108, 2, 0.4)',
            borderRadius: '8px',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: 14,
          }}
        >
          <span>⚠️ <strong>{lowStock.length} items</strong> {t('dashboard.lowStockAlert')} — {t('dashboard.tapToReview')}.</span>
        </div>
      )}

      <MetricCarousel sectionLabel="Today" items={todayMetrics} />

      <div className="card-grid dashboard-grid-desktop">
        {(isManagement || isSalesTeam) && (
          <KpiCard
            label={t('dashboard.todaysEarnings')}
            value={daily ? `TZS ${daily.earnings.toLocaleString()}` : '—'}
            health={daily?.earnings > 0 ? 'healthy' : null}
          />
        )}
        {(isManagement || isSalesTeam || isInventoryTeam) && (
          <KpiCard
            label={t('dashboard.itemsSoldToday')}
            value={daily ? daily.items_sold : '—'}
            health={daily?.items_sold > 0 ? 'healthy' : null}
          />
        )}
        {(isManagement || isSalesTeam) && (
          <KpiCard
            label={t('dashboard.topProductToday')}
            value={daily?.top_product || t('dashboard.noSalesYet')}
            style={{ fontSize: 16 }}
          />
        )}
        {(isManagement || isInventoryTeam) && (
          <KpiCard
            label={t('dashboard.lowStockItems')}
            value={daily ? daily.low_stock_count : '—'}
            health={daily?.low_stock_count > 0 ? 'critical' : 'healthy'}
            onClick={() => navigate('/app/inventory')}
          />
        )}
      </div>

      <MetricCarousel sectionLabel="Overall" items={overallMetrics} />

      <div className="card-grid dashboard-grid-desktop">
        {(isManagement || isInventoryTeam) && (
          <KpiCard
            label={t('dashboard.inventoryValue')}
            value={inv ? `TZS ${inv.total_value.toLocaleString()}` : '—'}
          />
        )}
        {(isManagement || isInventoryTeam) && (
          <KpiCard
            label={t('dashboard.totalStockUnits')}
            value={inv ? inv.total_units : '—'}
          />
        )}
        {isManagement && (
          <>
            <KpiCard
              label={t('dashboard.netProfitAllTime')}
              value={fin ? `TZS ${fin.net_profit.toLocaleString()}` : '—'}
              health={fin?.net_profit > 0 ? 'healthy' : fin?.net_profit < 0 ? 'critical' : null}
            />
            <KpiCard
              label={t('dashboard.totalRevenueAllTime')}
              value={fin ? `TZS ${fin.revenue.toLocaleString()}` : '—'}
            />
          </>
        )}
      </div>

      {isManagement && (
        <div className="card-grid dashboard-grid-desktop">
          <KpiCard
            label={t('dashboard.mostSoldItemAllTime')}
            value={salesStats?.most_sold_item ? `${salesStats.most_sold_item.item_name} (${salesStats.most_sold_item.quantity} sold)` : t('dashboard.noSalesYet')}
          />
          <KpiCard
            label={t('dashboard.topRevenueItemAllTime')}
            value={salesStats?.top_revenue_item ? `${salesStats.top_revenue_item.item_name} (TZS ${salesStats.top_revenue_item.revenue.toLocaleString()})` : t('dashboard.noSalesYet')}
          />
        </div>
      )}

      {isManagement && <ARDashboardWidget />}

      {isManagement && <LoansAndDeadlinesWidget loans={loans} deadlines={deadlines} />}

      {isManagement && <CashflowChart series={cashflow?.series} />}
    </div>
  )
}

export default function Dashboard() {
  const { account } = useAuth()
  if (account?.account_type === 'community') return <CommunityDashboard />
  return <BusinessDashboard />
}
