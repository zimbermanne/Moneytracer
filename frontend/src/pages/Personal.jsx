import { useEffect, useState } from 'react'
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  AreaChart, Area, XAxis, YAxis, CartesianGrid
} from 'recharts'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import { AlertBannerContainer } from '../components/AlertBanner.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

const BREAKDOWN_COLORS = ['#C15F3C', '#4C6B8A', '#6B8F5E', '#B9862E', '#B4453A', '#8a63ff', '#ff6b6b', '#34c07a']

export default function Personal() {
  const api = useApi()
  const [tab, setTab] = useState('overview')
  const [reminders, setReminders] = useState([])

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
    loadReminders()
  }, []) // eslint-disable-line

  return (
    <div className="page">
      <div className="page-header">
        <h1>Personal Finance</h1>
      </div>

      <AlertBannerContainer reminders={reminders} onDismiss={dismissReminder} />

      <div className="tabs" style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border)' }}>
        {[
          ['overview', 'Overview'],
          ['savings', 'Savings'],
          ['social', 'Social Savings'],
        ].map(([key, label]) => (
          <div
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              color: tab === key ? 'var(--accent, #C15F3C)' : 'var(--text-muted)',
              borderBottom: tab === key ? '2px solid var(--accent, #C15F3C)' : '2px solid transparent',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab api={api} />}
      {tab === 'savings' && <SavingsTab api={api} />}
      {tab === 'social' && <SocialSavingsTab api={api} />}
    </div>
  )
}

// ---------- Overview ----------

function OverviewTab({ api }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/personal/overview').then(setData).catch((e) => setError(e.message))
  }, []) // eslint-disable-line

  if (error) return <div className="error-text">{error}</div>
  if (!data) return <div className="spinner-block">Loading your financial profile…</div>

  const totalVikobaLoans = (data.vikoba_memberships || []).reduce((sum, m) => sum + m.active_loan_balance, 0)
  const totalAssets = data.total_assets_value + data.total_owed_by_debtors
  const totalLiabilities = data.total_bank_debt + data.total_owed_to_creditors + totalVikobaLoans
  const netWorth = totalAssets - totalLiabilities

  const cashFlow = data.inflow_this_month - data.expenses_this_month

  return (
    <div className="overview-tab">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Financial Health Ratios */}
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Financial Health</div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Savings Rate</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: data.health_ratios.savings_rate > 20 ? 'var(--success)' : 'inherit' }}>
              {data.health_ratios.savings_rate}%
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Debt-to-Income</span>
            <span style={{ fontSize: 16, fontWeight: 700, color: data.health_ratios.debt_to_income > 0.4 ? 'var(--danger)' : 'inherit' }}>
              {data.health_ratios.debt_to_income}
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Runway</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>
              {data.health_ratios.runway_months} months
            </span>
          </div>

          <div style={{ marginTop: 'auto', fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>
            Calculated from this month's activity and current debt levels.
          </div>
        </div>

        {/* Net Worth Card */}
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', background: 'var(--surface)' }}>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Net Worth</div>
          <div style={{ fontSize: 28, fontWeight: 800, color: netWorth >= 0 ? 'var(--success)' : 'var(--danger)', marginBottom: 4 }}>
            {money(netWorth)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {money(totalAssets)} assets / {money(totalLiabilities)} debt
          </div>

          <div style={{ marginTop: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>Emergency Fund Progress</span>
              <span style={{ fontSize: 12, fontWeight: 700 }}>{Math.round(data.savings_goal_progress || 0)}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--surface-sunken)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${data.savings_goal_progress || 0}%`, background: 'var(--accent)', transition: 'width 1s ease' }} />
            </div>
          </div>
        </div>

        {/* Monthly Cash Flow Card */}
        <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Monthly Pulse (MTD)</div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Inflow</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--success)' }}>+{money(data.inflow_this_month)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Outflow</span>
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--danger)' }}>-{money(data.expenses_this_month)}</span>
          </div>

          <div style={{ marginTop: 'auto', padding: '8px 12px', background: cashFlow >= 0 ? 'var(--success-bg)' : 'var(--danger-bg)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: cashFlow >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>Net Flow</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: cashFlow >= 0 ? 'var(--success)' : 'var(--danger)' }}>
              {cashFlow >= 0 ? '+' : ''}{money(cashFlow)}
            </span>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 20, marginBottom: 24 }}>
        {/* Spending Breakdown */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Spending Breakdown (MTD)</h3>
          {data.expense_breakdown.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', height: 280 }}>
              <div style={{ flex: 1, height: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.expense_breakdown}
                      dataKey="amount"
                      nameKey="category_name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={3}
                    >
                      {data.expense_breakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={BREAKDOWN_COLORS[index % BREAKDOWN_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => money(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ flex: 1, paddingLeft: 20 }}>
                {data.expense_breakdown.slice(0, 6).map((item, i) => (
                  <div key={item.category_name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: BREAKDOWN_COLORS[i % BREAKDOWN_COLORS.length] }} />
                      <span style={{ color: 'var(--text-muted)' }}>{item.category_name}</span>
                    </div>
                    <span style={{ fontWeight: 600 }}>{item.percentage.toFixed(0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>
              No spending recorded this month.
            </div>
          )}
        </div>

        {/* Cash Flow History */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0, marginBottom: 16 }}>Income vs Spending</h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.cash_flow_history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--success)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--success)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--danger)" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="var(--danger)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis dataKey="month" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => v >= 1000 ? `${v/1000}k` : v} />
                <Tooltip formatter={(v) => money(v)} />
                <Area type="monotone" dataKey="inflow" stroke="var(--success)" fillOpacity={1} fill="url(#colorIn)" />
                <Area type="monotone" dataKey="outflow" stroke="var(--danger)" fillOpacity={1} fill="url(#colorOut)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card-grid">
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Fixed Assets</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{money(data.total_assets_value)}</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Receivables</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{money(data.total_owed_by_debtors)}</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Bank Debt</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{money(data.total_bank_debt)}</div>
        </div>
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Social Debt</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--danger)' }}>{money(totalVikobaLoans)}</div>
        </div>
      </div>

      {data.vikoba_memberships.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ margin: 0 }}>Social Savings Status</h3>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{data.vikoba_memberships.length} Groups</div>
          </div>
          <Table
            columns={[
              { key: 'group_name', header: 'Group Name' },
              { key: 'is_operated', header: 'Type', render: (r) => <span className="badge" style={{ background: r.is_operated ? 'var(--info-bg)' : 'var(--surface-sunken)', color: r.is_operated ? 'var(--info)' : 'var(--text-muted)' }}>{r.is_operated ? 'Platform Group' : 'Private Note'}</span> },
              { key: 'total_contributed', header: 'Contributed', render: (r) => money(r.total_contributed) },
              { key: 'active_loan_balance', header: 'Loan Balance', render: (r) => <span style={{ color: r.active_loan_balance > 0 ? 'var(--danger)' : 'inherit', fontWeight: r.active_loan_balance > 0 ? 600 : 400 }}>{money(r.active_loan_balance)}</span> },
            ]}
            rows={data.vikoba_memberships}
          />
        </div>
      )}
    </div>
  )
}

// ---------- Savings (categories, transactions, envelope/habit dashboards, insights) ----------

function SavingsTab({ api }) {
  const [categories, setCategories] = useState([])
  const [envelope, setEnvelope] = useState(null)
  const [habit, setHabit] = useState(null)
  const [insights, setInsights] = useState(null)
  const [transactions, setTransactions] = useState([])
  const [error, setError] = useState('')

  const [catOpen, setCatOpen] = useState(false)
  const [catForm, setCatForm] = useState({ name: '', icon: '', monthly_budget: '' })
  const [catSaving, setCatSaving] = useState(false)

  const [txnOpen, setTxnOpen] = useState(false)
  const [txnForm, setTxnForm] = useState({ category_id: '', amount: '', note: '', tag: '' })
  const [editingTxnId, setEditingTxnId] = useState(null)
  const [suggestion, setSuggestion] = useState(null)
  const [txnSaving, setTxnSaving] = useState(false)

  // Emergency fund: a real SpendingGroup the user owns (goal_amount/target_date
  // are user-set, not hardcoded), with deposits recorded as group contributions
  // instead of sign-flipped expense transactions.
  const [goalGroup, setGoalGroup] = useState(null)
  const [goalProgress, setGoalProgress] = useState(null)
  const [goalSetupOpen, setGoalSetupOpen] = useState(false)
  const [goalForm, setGoalForm] = useState({ name: 'Emergency Fund', goal_amount: '' })
  const [goalSaving, setGoalSaving] = useState(false)

  const [depositOpen, setDepositOpen] = useState(false)
  const [depositForm, setDepositForm] = useState({ amount: '' })
  const [depositSaving, setDepositSaving] = useState(false)

  const loadAll = () => {
    api.get('/personal/categories').then(setCategories).catch((e) => setError(e.message))
    api.get('/personal/dashboard/envelope').then(setEnvelope).catch(() => {})
    api.get('/personal/dashboard/habit').then(setHabit).catch(() => {})
    api.get('/personal/dashboard/insights').then(setInsights).catch(() => {})
    api.get('/personal/transactions').then(setTransactions).catch(() => {})
    api.get('/personal/groups').then((groups) => {
      // A personal emergency fund is modeled as a single-member SpendingGroup
      // the user created for themself — this reuses the same goal/progress
      // machinery as shared savings groups instead of a hardcoded target.
      const own = groups.find((g) => g.name === 'Emergency Fund') || groups[0] || null
      setGoalGroup(own)
      if (own) {
        api.get(`/personal/groups/${own.id}/progress`).then(setGoalProgress).catch(() => {})
      }
    }).catch(() => {})
  }

  const saveGoal = async () => {
    if (!goalForm.goal_amount) return
    setGoalSaving(true)
    try {
      const group = await api.post('/personal/groups', {
        name: goalForm.name.trim() || 'Emergency Fund',
        goal_amount: Number(goalForm.goal_amount),
      })
      setGoalGroup(group)
      setGoalSetupOpen(false)
      loadAll()
    } catch (e) {
      setError(e.message)
    } finally {
      setGoalSaving(false)
    }
  }

  useEffect(() => { loadAll() }, []) // eslint-disable-line

  const saveCategory = async () => {
    if (!catForm.name.trim()) return
    setCatSaving(true)
    try {
      await api.post('/personal/categories', {
        name: catForm.name.trim(), icon: catForm.icon || '', monthly_budget: Number(catForm.monthly_budget) || 0,
      })
      setCatOpen(false); setCatForm({ name: '', icon: '', monthly_budget: '' }); loadAll()
    } catch (e) {
      setError(e.message)
    } finally {
      setCatSaving(false)
    }
  }

  const onNoteBlur = async () => {
    if (!txnForm.note && !txnForm.amount) return
    try {
      const s = await api.get(`/personal/categories/suggest?note=${encodeURIComponent(txnForm.note)}&amount=${Number(txnForm.amount) || 0}`)
      setSuggestion(s)
      if (s.category_id && !txnForm.category_id) {
        setTxnForm((f) => ({ ...f, category_id: s.category_id }))
      }
    } catch (e) { /* best-effort, ignore */ }
  }

  const saveTransaction = async () => {
    if (!txnForm.category_id || !txnForm.amount) { setError('Category and amount are required.'); return }
    setTxnSaving(true)
    setError('')
    try {
      const body = {
        category_id: Number(txnForm.category_id),
        amount: Number(txnForm.amount),
        note: txnForm.note || '',
        tag: txnForm.tag || null,
      }
      if (editingTxnId) {
        await api.patch(`/personal/transactions/${editingTxnId}`, body)
      } else {
        await api.post('/personal/transactions', body)
      }
      setTxnOpen(false)
      setEditingTxnId(null)
      setTxnForm({ category_id: '', amount: '', note: '', tag: '' })
      setSuggestion(null)
      loadAll()
    } catch (e) {
      setError(e.message)
    } finally {
      setTxnSaving(false)
    }
  }

  const openEditTxn = (t) => {
    setEditingTxnId(t.id)
    setTxnForm({ category_id: String(t.category_id), amount: String(t.amount), note: t.note || '', tag: t.tag || '' })
    setTxnOpen(true)
  }

  const deleteTransaction = async (id) => {
    try {
      await api.del(`/personal/transactions/${id}`)
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  const saveDeposit = async () => {
    if (!depositForm.amount || !goalGroup) return
    setDepositSaving(true)
    try {
      await api.post(`/personal/groups/${goalGroup.id}/contribute`, {
        amount: Number(depositForm.amount),
      })
      setDepositOpen(false)
      setDepositForm({ amount: '' })
      loadAll()
    } catch (e) {
      setError(e.message)
    } finally {
      setDepositSaving(false)
    }
  }

  const currentSavings = goalProgress?.total_saved || 0
  const targetGoal = goalProgress?.goal_amount || goalGroup?.goal_amount || 0
  const progressPct = targetGoal ? Math.min(Math.round((currentSavings / targetGoal) * 100), 100) : 0

  return (
    <div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={() => { setEditingTxnId(null); setTxnForm({ category_id: '', amount: '', note: '', tag: '' }); setTxnOpen(true) }}>+ Log Expense</button>
        <button className="btn btn-outline" onClick={() => goalGroup ? setDepositOpen(true) : setGoalSetupOpen(true)}>+ Deposit to Savings</button>
        <button className="btn btn-outline" onClick={() => setCatOpen(true)}>+ New Category</button>
      </div>

      <div className="card" style={{ marginBottom: 24, padding: '18px 20px' }}>
        <h3 style={{ marginTop: 0, marginBottom: 12 }}>🚨 Emergency Fund Goal</h3>
        {goalGroup ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
              <span>{money(currentSavings)} saved</span>
              <span style={{ color: 'var(--text-muted)' }}>Target: {money(targetGoal)}</span>
            </div>
            <div style={{ height: 10, background: 'var(--border)', borderRadius: 5, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progressPct}%`, background: 'var(--success)', transition: 'width 0.5s ease' }} />
            </div>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
              {progressPct}% of goal reached. Keep it up!
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            No savings goal set yet.{' '}
            <span style={{ color: 'var(--accent, #C15F3C)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setGoalSetupOpen(true)}>
              Set your target
            </span>
          </div>
        )}
      </div>

      {insights && insights.alerts.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          {insights.alerts.map((a, i) => (
            <div key={i} className="card" style={{
              padding: '10px 14px', marginBottom: 8,
              background: a.severity === 'warning' ? 'var(--warning-bg, #F5E9D3)' : 'var(--info-bg, #E1E9F0)',
              color: a.severity === 'warning' ? 'var(--warning, #B9862E)' : 'var(--info, #4C6B8A)',
              fontSize: 13,
            }}>
              {a.message}
            </div>
          ))}
        </div>
      )}

      {envelope && envelope.categories.length > 0 && (
        <>
          <h3>Envelope Budgets <span style={{ fontWeight: 400, fontSize: 13, color: 'var(--text-muted)' }}>
            (safe to spend today: {money(envelope.safe_to_spend_today)})</span></h3>
          <Table
            columns={[
              { key: 'category_name', header: 'Category' },
              { key: 'budget', header: 'Budget', render: (r) => money(r.budget) },
              { key: 'spent', header: 'Spent', render: (r) => money(r.spent) },
              { key: 'remaining', header: 'Remaining', render: (r) => money(r.remaining) },
            ]}
            rows={envelope.categories}
          />
        </>
      )}

      {habit && (
        <div className="card" style={{ marginTop: 20, padding: '16px 18px' }}>
          <h3 style={{ marginTop: 0 }}>Habit Tracking</h3>
          <div>This week impulse spending: <strong>{habit.this_week_impulse_pct.toFixed(1)}%</strong></div>
          <div>Last week: {habit.last_week_impulse_pct.toFixed(1)}%
            {' '}({habit.change_vs_last_week >= 0 ? '+' : ''}{habit.change_vs_last_week.toFixed(1)} pts)</div>
        </div>
      )}

      {insights && insights.recurring.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Recurring Expenses</h3>
          <Table
            columns={[
              { key: 'category_name', header: 'Category' },
              { key: 'typical_amount', header: 'Typical Amount', render: (r) => money(r.typical_amount) },
              { key: 'typical_day_of_month', header: 'Usually on day' },
              { key: 'occurrences', header: 'Times seen' },
            ]}
            rows={insights.recurring}
          />
        </>
      )}

      {transactions.length > 0 && (
        <>
          <h3 style={{ marginTop: 24 }}>Transaction History</h3>
          <Table
            columns={[
              { key: 'spent_at', header: 'Date', render: (r) => new Date(r.spent_at).toLocaleDateString() },
              { key: 'category_id', header: 'Category', render: (r) => {
                const c = categories.find((cat) => cat.id === r.category_id)
                return c ? `${c.icon} ${c.name}` : '—'
              } },
              { key: 'note', header: 'Note' },
              { key: 'amount', header: 'Amount', render: (r) => money(r.amount) },
              { key: 'actions', header: '', stopRowClick: true, render: (r) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-outline" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => openEditTxn(r)}>Edit</button>
                  <button className="btn btn-outline" style={{ padding: '2px 10px', fontSize: 12, color: 'var(--danger)' }} onClick={() => deleteTransaction(r.id)}>Delete</button>
                </div>
              ) },
            ]}
            rows={transactions.slice(0, 25)}
          />
        </>
      )}

      {goalSetupOpen && (
        <Modal
          title="Set Savings Goal"
          onClose={() => setGoalSetupOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setGoalSetupOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveGoal} disabled={goalSaving}>
                {goalSaving ? 'Saving…' : 'Save Goal'}
              </button>
            </>
          }
        >
          <label>Goal Name</label>
          <input value={goalForm.name} onChange={(e) => setGoalForm({ ...goalForm, name: e.target.value })} />
          <label>Target Amount (TZS)</label>
          <input type="number" value={goalForm.goal_amount} onChange={(e) => setGoalForm({ ...goalForm, goal_amount: e.target.value })} placeholder="e.g. 5000000" />
        </Modal>
      )}

      {catOpen && (
        <Modal
          title="New Category"
          onClose={() => setCatOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setCatOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveCategory} disabled={catSaving}>
                {catSaving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <label>Name</label>
          <input value={catForm.name} onChange={(e) => setCatForm({ ...catForm, name: e.target.value })} placeholder="e.g. Transport, Food" />
          <label>Icon (optional emoji)</label>
          <input value={catForm.icon} onChange={(e) => setCatForm({ ...catForm, icon: e.target.value })} placeholder="🚌" />
          <label>Monthly Budget (leave 0 for habit-tracking only, no envelope budget)</label>
          <input type="number" value={catForm.monthly_budget} onChange={(e) => setCatForm({ ...catForm, monthly_budget: e.target.value })} />
        </Modal>
      )}

      {txnOpen && (
        <Modal
          title={editingTxnId ? 'Edit Expense' : 'Log Expense'}
          onClose={() => { setTxnOpen(false); setEditingTxnId(null) }}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => { setTxnOpen(false); setEditingTxnId(null) }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveTransaction} disabled={txnSaving}>
                {txnSaving ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <label>Amount</label>
          <input type="number" value={txnForm.amount} onChange={(e) => setTxnForm({ ...txnForm, amount: e.target.value })} onBlur={onNoteBlur} />
          <label>Note</label>
          <input value={txnForm.note} onChange={(e) => setTxnForm({ ...txnForm, note: e.target.value })} onBlur={onNoteBlur} placeholder="e.g. bus fare, lunch" />
          {suggestion && suggestion.category_name && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8, marginBottom: 12 }}>
              Suggested: {suggestion.category_name} ({suggestion.confidence} confidence)
            </div>
          )}
          <label>Category</label>
          <select value={txnForm.category_id} onChange={(e) => setTxnForm({ ...txnForm, category_id: e.target.value })}>
            <option value="">Select a category…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
          <label>Tag (optional)</label>
          <select value={txnForm.tag} onChange={(e) => setTxnForm({ ...txnForm, tag: e.target.value })}>
            <option value="">—</option>
            <option value="necessary">Necessary</option>
            <option value="impulse">Impulse</option>
          </select>
        </Modal>
      )}

      {depositOpen && (
        <Modal
          title="Deposit to Savings"
          onClose={() => setDepositOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setDepositOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDeposit} disabled={depositSaving}>
                {depositSaving ? 'Depositing…' : 'Confirm Deposit'}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Recording a deposit will move funds into your "{goalGroup?.name}" savings goal.
          </p>
          <label>Amount to Save</label>
          <input type="number" value={depositForm.amount} onChange={(e) => setDepositForm({ ...depositForm, amount: e.target.value })} placeholder="e.g. 50000" />
        </Modal>
      )}
    </div>
  )
}

// ---------- Social Savings (Vikoba memberships) ----------

// ---------- Social Savings (Unifying Operated & Informal) ----------

function SocialSavingsTab({ api }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    api.get('/personal/overview').then(setData).catch((e) => setError(e.message))
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  if (error) return <div className="error-text">{error}</div>
  if (!data) return <div className="spinner-block">Loading social savings…</div>

  return (
    <div className="social-savings-tab">
      <div className="card" style={{ marginBottom: 24, borderLeft: '4px solid var(--accent)', background: 'var(--surface)' }}>
        <h3 style={{ marginTop: 0 }}>Group Obligations Tracker</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Keep track of your contributions and loans across all your community groups.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        {data.vikoba_memberships.map((group) => (
          <div key={group.group_id + (group.is_operated ? '-op' : '-inf')} className="card" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>{group.group_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{group.is_operated ? 'Platform Group' : 'Private Profile'}</div>
              </div>
              <span className={`badge ${group.is_operated ? 'badge-active' : ''}`} style={{ fontSize: 10 }}>{group.group_role}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Shares/Contributed</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{money(group.total_contributed)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>Active Loan</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: group.active_loan_balance > 0 ? 'var(--danger)' : 'inherit' }}>
                  {money(group.active_loan_balance)}
                </div>
              </div>
            </div>

            {!group.is_operated && (
              <div style={{ fontSize: 12, padding: '8px 10px', background: 'var(--surface-sunken)', borderRadius: 6, color: 'var(--text-muted)' }}>
                Manual updates only. See list below to edit.
              </div>
            )}

            {group.is_operated && (
              <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                Synced with group ledger.
              </div>
            )}
          </div>
        ))}
        {data.vikoba_memberships.length === 0 && (
          <div className="card" style={{ padding: 40, textAlign: 'center', gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🤝</div>
            <div style={{ fontWeight: 600 }}>No social savings groups yet.</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Add your informal groups below to start tracking.</p>
          </div>
        )}
      </div>

      <SavingsSchemeProfiles api={api} onUpdate={load} />
    </div>
  )
}

function SavingsSchemeProfiles({ api, onUpdate }) {
  const [profiles, setProfiles] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({
    name: '', group_type: '', contribution_amount: '',
    cycle_frequency: 'monthly', total_contributed: '0',
    active_loan_balance: '0', member_names: '', notes: ''
  })
  const [saving, setSaving] = useState(false)

  const load = () => api.get('/personal/savings-schemes').then(setProfiles).catch((e) => setError(e.message))
  useEffect(() => { load() }, []) // eslint-disable-line

  const openNew = () => {
    setEditingId(null)
    setForm({
      name: '', group_type: '', contribution_amount: '',
      cycle_frequency: 'monthly', total_contributed: '0',
      active_loan_balance: '0', member_names: '', notes: ''
    })
    setOpen(true)
  }

  const openEdit = (p) => {
    setEditingId(p.id)
    setForm({
      name: p.name, group_type: p.group_type || '',
      contribution_amount: p.contribution_amount ?? '',
      cycle_frequency: p.cycle_frequency || 'monthly',
      total_contributed: String(p.total_contributed || 0),
      active_loan_balance: String(p.active_loan_balance || 0),
      member_names: p.member_names || '', notes: p.notes || '',
    })
    setOpen(true)
  }

  const save = async () => {
    if (!form.name.trim()) { setError('A name for the scheme is required.'); return }
    setSaving(true)
    setError('')
    try {
      const body = {
        name: form.name.trim(),
        group_type: form.group_type,
        contribution_amount: form.contribution_amount === '' ? null : Number(form.contribution_amount),
        cycle_frequency: form.cycle_frequency,
        total_contributed: Number(form.total_contributed) || 0,
        active_loan_balance: Number(form.active_loan_balance) || 0,
        member_names: form.member_names,
        notes: form.notes,
      }
      if (editingId) {
        await api.patch(`/personal/savings-schemes/${editingId}`, body)
      } else {
        await api.post('/personal/savings-schemes', body)
      }
      setOpen(false)
      load()
      if (onUpdate) onUpdate()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    if (!confirm('Are you sure you want to remove this profile?')) return
    try {
      await api.del(`/personal/savings-schemes/${id}`)
      load()
      if (onUpdate) onUpdate()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div style={{ marginTop: 40 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0 }}>Private Group Profiles</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Manage manual records for groups not yet using the platform ledger.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openNew}>+ Add Private Group</button>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <Table
          columns={[
            { key: 'name', header: 'Name', render: (p) => <strong>{p.name}</strong> },
            { key: 'group_type', header: 'Type' },
            { key: 'contribution', header: 'Commitment', render: (p) => p.contribution_amount ? `${money(p.contribution_amount)} / ${p.cycle_frequency}` : 'Flexible' },
            { key: 'total_contributed', header: 'Total Saved', render: (p) => money(p.total_contributed) },
            { key: 'active_loan_balance', header: 'Loan', render: (p) => <span style={p.active_loan_balance > 0 ? { color: 'var(--danger)', fontWeight: 600 } : {}}>{money(p.active_loan_balance)}</span> },
            { key: 'actions', header: '', stopRowClick: true, render: (p) => (
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>Edit</button>
                <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => remove(p.id)}>Remove</button>
              </div>
            ) },
          ]}
          rows={profiles}
          emptyText="No private group profiles recorded."
        />
      </div>

      {open && (
        <Modal
          title={editingId ? 'Edit Private Group Profile' : 'Add Private Group Profile'}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
            </>
          }
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="span-2" style={{ gridColumn: '1 / -1' }}>
              <label>Group Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Mama Group VICOBA" />
            </div>

            <div>
              <label>Category (Type)</label>
              <input value={form.group_type} onChange={(e) => setForm({ ...form, group_type: e.target.value })} placeholder="e.g. VICOBA, Chama" />
            </div>

            <div>
              <label>Cycle Frequency</label>
              <select value={form.cycle_frequency} onChange={(e) => setForm({ ...form, cycle_frequency: e.target.value })}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <div>
              <label>Commitment Amount</label>
              <input type="number" value={form.contribution_amount} onChange={(e) => setForm({ ...form, contribution_amount: e.target.value })} />
            </div>

            <div>
              <label>Total Saved to Date</label>
              <input type="number" value={form.total_contributed} onChange={(e) => setForm({ ...form, total_contributed: e.target.value })} />
            </div>

            <div>
              <label>Current Loan Balance</label>
              <input type="number" value={form.active_loan_balance} onChange={(e) => setForm({ ...form, active_loan_balance: e.target.value })} />
            </div>

            <div className="span-2" style={{ gridColumn: '1 / -1' }}>
              <label>Members (optional, freeform)</label>
              <input value={form.member_names} onChange={(e) => setForm({ ...form, member_names: e.target.value })} placeholder="e.g. Amina, John, Fatuma" />
            </div>

            <div className="span-2" style={{ gridColumn: '1 / -1' }}>
              <label>Private Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Escalation history, payout date, etc." />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
