import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

function AccountTypeBadge(type) {
  const colors = {
    asset: 'badge badge-paid',
    liability: 'badge badge-partial',
    equity: 'badge badge-unpaid',
    revenue: 'badge',
    expense: 'badge',
  }
  return <span className={colors[type] || 'badge'} style={{ textTransform: 'capitalize' }}>{type}</span>
}

function AccountRow({ account, level = 0, onDrillDown }) {
  const paddingLeft = level * 20
  const hasChildren = account.children && account.children.length > 0

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '8px 12px',
          paddingLeft: 12 + paddingLeft,
          cursor: onDrillDown ? 'pointer' : 'default',
          backgroundColor: level === 0 ? 'var(--bg-light)' : 'transparent',
          borderBottom: '1px solid #f0ece1',
        }}
        onClick={() => onDrillDown && onDrillDown(account)}
      >
        <span style={{ flex: 1, fontWeight: level === 0 ? 600 : 400 }}>
          {account.code} - {account.name}
        </span>
        <AccountTypeBadge type={account.account_type} />
        <span style={{ marginLeft: 16, fontWeight: 600, minWidth: 120, textAlign: 'right' }}>
          {money(account.balance)}
        </span>
      </div>
      {hasChildren && account.children.map((child) => (
        <AccountRow key={child.id} account={child} level={level + 1} onDrillDown={onDrillDown} />
      ))}
    </div>
  )
}

export default function ChartOfAccounts() {
  const api = useApi()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager'

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = () => {
    setLoading(true)
    setError('')
    api.get('/ledgers/chart-of-accounts')
      .then(setAccounts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const handleDrillDown = (account) => {
    // Navigate to General Ledger filtered by this account
    // This will be implemented once GeneralLedger.jsx is created
    window.location.hash = `#general-ledger?account_id=${account.id}`
  }

  // Group accounts by type for display
  const groupedAccounts = {
    asset: accounts.filter((a) => a.account_type === 'asset'),
    liability: accounts.filter((a) => a.account_type === 'liability'),
    equity: accounts.filter((a) => a.account_type === 'equity'),
    revenue: accounts.filter((a) => a.account_type === 'revenue'),
    expense: accounts.filter((a) => a.account_type === 'expense'),
  }

  const totalAssets = groupedAccounts.asset.reduce((sum, a) => sum + a.balance, 0)
  const totalLiabilities = groupedAccounts.liability.reduce((sum, a) => sum + a.balance, 0)
  const totalEquity = groupedAccounts.equity.reduce((sum, a) => sum + a.balance, 0)
  const totalRevenue = groupedAccounts.revenue.reduce((sum, a) => sum + a.balance, 0)
  const totalExpenses = groupedAccounts.expense.reduce((sum, a) => sum + a.balance, 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Chart of Accounts</h1>
        <button className="btn btn-outline" onClick={load}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="error-text">{error}</div>}
      {loading && <div style={{ color: 'var(--text-muted)' }}>Loading…</div>}

      {!loading && !error && (
        <>
          <div className="card-grid" style={{ marginBottom: 20 }}>
            <div className="card metric-card">
              <div className="label">Total Assets</div>
              <div className="value">{money(totalAssets)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Total Liabilities</div>
              <div className="value">{money(totalLiabilities)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Total Equity</div>
              <div className="value">{money(totalEquity)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Total Revenue</div>
              <div className="value">{money(totalRevenue)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Total Expenses</div>
              <div className="value">{money(totalExpenses)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Net Income</div>
              <div className="value" style={{ color: totalRevenue - totalExpenses >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {money(totalRevenue - totalExpenses)}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            {Object.entries(groupedAccounts).map(([type, typeAccounts]) => (
              typeAccounts.length > 0 && (
                <div className="card" key={type} style={{ flex: 1, minWidth: 300 }}>
                  <h3 style={{ marginTop: 0, textTransform: 'capitalize' }}>{type}</h3>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                    Click any account to view its transaction history
                  </div>
                  {typeAccounts.map((account) => (
                    <AccountRow key={account.id} account={account} onDrillDown={handleDrillDown} />
                  ))}
                </div>
              )
            ))}
          </div>
        </>
      )}
    </div>
  )
}
