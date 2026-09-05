import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import MetricCarousel from '../components/MetricCarousel.jsx'
import { AlertBannerContainer } from '../components/AlertBanner.jsx'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString()}`
}

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
    Promise.all([
      api.get('/reports/daily-summary'),
      api.get('/inventory/metrics'),
      api.get('/reports/financial-summary'),
      api.get('/reports/cashflow?months=12'),
      api.get('/sales/stats/summary'),
      api.get('/inventory/low-stock/alerts'),
      api.get('/bank-loans/').catch(() => []),
      api.get('/deadlines/').catch(() => []),
      api.get('/reminders/').catch(() => []),
    ])
      .then(([d, i, f, c, s, ls, bl, dl, rem]) => {
        setDaily(d)
        setInv(i)
        setFin(f)
        setCashflow(c)
        setSalesStats(s)
        setLowStock(ls)
        setLoans(bl)
        setDeadlines(dl)
        setReminders(rem)
      })
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="page page-dashboard-home">
      <div className="page-header">
        <h1>{t('nav.home')}</h1>
      </div>

      {error && <div className="error-text">{error}</div>}

      <AuditWidget />
      <AlertBannerContainer reminders={reminders} onDismiss={dismissReminder} />

      {lowStock.length > 0 && (
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

      <MetricCarousel
        sectionLabel="Today"
        items={[
          { key: 'earnings', label: t('dashboard.todaysEarnings'), value: daily ? `TZS ${daily.earnings.toLocaleString()}` : '—', tone: 'blue', badge: '💰' },
          { key: 'itemsSold', label: t('dashboard.itemsSoldToday'), value: daily ? daily.items_sold : '—', tone: 'green', badge: '📦' },
          { key: 'topProduct', label: t('dashboard.topProductToday'), value: daily?.top_product || t('dashboard.noSalesYet'), valueFontSize: 19, tone: 'purple', badge: '⭐' },
          {
            key: 'lowStock', label: t('dashboard.lowStockItems'), value: daily ? daily.low_stock_count : '—',
            tone: 'red', badge: '⚠️', onClick: () => navigate('/app/inventory'),
          },
        ]}
      />

      <div className="card-grid dashboard-grid-desktop">
        <KpiCard
          label={t('dashboard.todaysEarnings')}
          value={daily ? `TZS ${daily.earnings.toLocaleString()}` : '—'}
          health={daily?.earnings > 0 ? 'healthy' : null}
        />
        <KpiCard
          label={t('dashboard.itemsSoldToday')}
          value={daily ? daily.items_sold : '—'}
          health={daily?.items_sold > 0 ? 'healthy' : null}
        />
        <KpiCard
          label={t('dashboard.topProductToday')}
          value={daily?.top_product || t('dashboard.noSalesYet')}
          style={{ fontSize: 16 }}
        />
        <KpiCard
          label={t('dashboard.lowStockItems')}
          value={daily ? daily.low_stock_count : '—'}
          health={daily?.low_stock_count > 0 ? 'critical' : 'healthy'}
          onClick={() => navigate('/app/inventory')}
        />
      </div>

      <MetricCarousel
        sectionLabel="Overall"
        items={[
          { key: 'invValue', label: t('dashboard.inventoryValue'), value: inv ? `TZS ${inv.total_value.toLocaleString()}` : '—', tone: 'navy', badge: '🏬' },
          { key: 'stockUnits', label: t('dashboard.totalStockUnits'), value: inv ? inv.total_units : '—', tone: 'blue', badge: '📦' },
          { key: 'netProfit', label: t('dashboard.netProfitAllTime'), value: fin ? `TZS ${fin.net_profit.toLocaleString()}` : '—', tone: 'orange', badge: '📊' },
          { key: 'revenue', label: t('dashboard.totalRevenueAllTime'), value: fin ? `TZS ${fin.revenue.toLocaleString()}` : '—', tone: 'green', badge: '💵' },
          {
            key: 'mostSold', label: t('dashboard.mostSoldItemAllTime'),
            value: salesStats?.most_sold_item ? `${salesStats.most_sold_item.item_name} (${salesStats.most_sold_item.quantity} sold)` : t('dashboard.noSalesYet'),
            valueFontSize: 18, tone: 'blue', badge: '🏆',
          },
          {
            key: 'topRevenue', label: t('dashboard.topRevenueItemAllTime'),
            value: salesStats?.top_revenue_item ? `${salesStats.top_revenue_item.item_name} (TZS ${salesStats.top_revenue_item.revenue.toLocaleString()})` : t('dashboard.noSalesYet'),
            valueFontSize: 18, tone: 'green', badge: '💵',
          },
        ]}
      />

      <div className="card-grid dashboard-grid-desktop">
        <KpiCard
          label={t('dashboard.inventoryValue')}
          value={inv ? `TZS ${inv.total_value.toLocaleString()}` : '—'}
        />
        <KpiCard
          label={t('dashboard.totalStockUnits')}
          value={inv ? inv.total_units : '—'}
        />
        <KpiCard
          label={t('dashboard.netProfitAllTime')}
          value={fin ? `TZS ${fin.net_profit.toLocaleString()}` : '—'}
          health={fin?.net_profit > 0 ? 'healthy' : fin?.net_profit < 0 ? 'critical' : null}
        />
        <KpiCard
          label={t('dashboard.totalRevenueAllTime')}
          value={fin ? `TZS ${fin.revenue.toLocaleString()}` : '—'}
        />
      </div>

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

      <LoansAndDeadlinesWidget loans={loans} deadlines={deadlines} />

      <CashflowChart series={cashflow?.series} />
    </div>
  )
}

export default function Dashboard() {
  const { account } = useAuth()
  if (account?.account_type === 'community') return <CommunityDashboard />
  return <BusinessDashboard />
}
