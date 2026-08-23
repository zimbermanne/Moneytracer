import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import { AlertBannerContainer } from '../components/AlertBanner.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

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
  if (!data) return <div>Loading…</div>

  const totalVikobaLoans = (data.vikoba_memberships || []).reduce((sum, m) => sum + m.active_loan_balance, 0)
  const totalAssets = data.total_assets_value + data.total_owed_by_debtors
  const totalLiabilities = data.total_bank_debt + data.total_owed_to_creditors + totalVikobaLoans
  const netWorth = totalAssets - totalLiabilities

  const cards = [
    { label: 'Total Assets', value: totalAssets, sub: `(Includes ${money(data.total_owed_by_debtors)} receivables)` },
    { label: 'Bank & Social Debt', value: data.total_bank_debt + totalVikobaLoans, sub: `(Social: ${money(totalVikobaLoans)})`, tone: 'red' },
    { label: 'Owed to Creditors', value: data.total_owed_to_creditors, tone: 'red' },
    { label: 'Net Worth', value: netWorth, tone: netWorth >= 0 ? 'green' : 'red', bold: true },
    { label: 'Expenses (MTD)', value: data.expenses_this_month, sub: 'Month-to-date outflows' },
  ]

  return (
    <div>
      <div className="card-grid" style={{ marginBottom: 24 }}>
        {cards.map((c) => (
          <div key={c.label} className="card home-kpi-card" style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{c.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c.tone === 'red' ? 'var(--danger)' : c.tone === 'green' ? 'var(--success)' : 'inherit' }}>
                {money(c.value)}
              </div>
            </div>
            {c.sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {data.vikoba_memberships.length > 0 && (
        <>
          <h3>Vikoba Memberships</h3>
          <Table
            columns={[
              { key: 'group_name', header: 'Group' },
              { key: 'group_role', header: 'Role' },
              { key: 'total_contributed', header: 'Contributed', render: (r) => money(r.total_contributed) },
              { key: 'active_loan_balance', header: 'Loan Balance', render: (r) => money(r.active_loan_balance) },
            ]}
            rows={data.vikoba_memberships}
            emptyText="Not a member of any Vikoba group yet."
          />
        </>
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

function SocialSavingsTab({ api }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get('/personal/overview').then(setData).catch((e) => setError(e.message))
  }, []) // eslint-disable-line

  if (error) return <div className="error-text">{error}</div>
  if (!data) return <div>Loading…</div>

  return (
    <div>
      <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid var(--accent)' }}>
        <h3 style={{ marginTop: 0 }}>Social Obligations Tracker</h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Tracking your active participation in community lending and group savings.
        </p>
      </div>

      <Table
        columns={[
          { key: 'group_name', header: 'Group' },
          { key: 'group_role', header: 'Your Role' },
          { key: 'total_contributed', header: 'Total Shares/Paid', render: (r) => money(r.total_contributed) },
          {
            key: 'active_loan_balance',
            header: 'Loan Balance',
            render: (r) => (
              <span style={r.active_loan_balance > 0 ? { color: 'var(--danger)', fontWeight: 600 } : {}}>
                {money(r.active_loan_balance)}
              </span>
            )
          },
          {
            key: 'status',
            header: 'Health',
            render: (r) => (
              <span className="badge badge-active" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                On Track
              </span>
            )
          }
        ]}
        rows={data.vikoba_memberships}
        emptyText="Not a member of any Vikoba group yet."
      />

      <div style={{ marginTop: 24, fontSize: 13, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.03)', padding: 16, borderRadius: 8 }}>
        <strong>Pro Tip:</strong> To join a new group or manage group settings, contact your group treasurer.
        Obligations are automatically calculated based on group cycle frequency.
      </div>
    </div>
  )
}
