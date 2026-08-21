import { useEffect, useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import { AlertBannerContainer } from '../components/AlertBanner.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`
const currentYear = new Date().getFullYear()

/**
 * Maps budget categories to actual spending from expenses and payroll.
 */
export function calculateActualSpending(budget, expenses, payroll, purchases) {
  let total = 0
  const { category, period_type, year, month, quarter } = budget
  const catLower = category.toLowerCase()

  // Helper to check if a date string matches the budget period
  const isPeriodMatch = (dateStr) => {
    if (!dateStr) return false
    const d = new Date(dateStr)
    if (d.getFullYear() !== year) return false

    if (period_type === 'monthly') {
      return d.getMonth() + 1 === month
    }
    if (period_type === 'quarterly') {
      const q = Math.floor(d.getMonth() / 3) + 1
      return q === quarter
    }
    return true // yearly
  }

  // 1. Match from Expenses
  const matchingExpenses = expenses.filter(e =>
    e.category.toLowerCase() === catLower && isPeriodMatch(e.created_at)
  )
  total += matchingExpenses.reduce((sum, e) => sum + e.amount, 0)

  // 2. Match from Purchases (Inventory)
  // Check if category is "Inventory" or "Purchases"
  if (catLower.includes('inventory') || catLower.includes('purchase')) {
    const matchingPurchases = purchases.filter(p => isPeriodMatch(p.created_at))
    total += matchingPurchases.reduce((sum, p) => sum + p.total, 0)
  }

  // 3. Match from Payroll
  if (catLower.includes('salaries') || catLower.includes('payroll') || catLower.includes('wages')) {
    const matchingPayroll = payroll.filter(p => isPeriodMatch(p.pay_date))
    total += matchingPayroll.reduce((sum, p) => sum + p.net_pay, 0)
  }

  return total
}

export function BudgetProgressBar({ budgeted, actual }) {
  const percentage = budgeted > 0 ? Math.min(Math.round((actual / budgeted) * 100), 100) : 0

  let barColor = '#2e7d32' // Green (< 80%)
  if (percentage >= 80 && percentage < 100) barColor = '#ed6c02' // Orange (Near limit)
  if (actual > budgeted) barColor = '#d32f2f' // Red (Over budget)

  return (
    <div style={{ minWidth: '120px' }}>
      <div style={{ width: '100%', backgroundColor: 'var(--border)', borderRadius: '4px', overflow: 'hidden', height: '8px', marginBottom: '4px' }}>
        <div style={{ width: `${percentage}%`, backgroundColor: barColor, height: '100%', transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
        <span>{percentage}% utilized</span>
        {actual > budgeted && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>OVER</span>}
      </div>
    </div>
  )
}

const emptyForm = () => ({
  period_type: 'monthly', year: currentYear, month: new Date().getMonth() + 1, quarter: '', category: '', budgeted_amount: '',
})

export default function Budgets() {
  const api = useApi()
  const [budgets, setBudgets] = useState([])
  const [expenses, setExpenses] = useState([])
  const [payroll, setPayroll] = useState([])
  const [purchases, setPurchases] = useState([])
  const [reminders, setReminders] = useState([])

  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [yearFilter, setYearFilter] = useState(currentYear)
  const [periodTypeFilter, setPeriodTypeFilter] = useState('all') // 'all' | 'monthly' | 'yearly'

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
    setListLoading(true)
    Promise.all([
      api.get(`/approvals/budgets?year=${yearFilter}`),
      api.get('/expenses/'),
      api.get('/payroll/payslips'),
      api.get('/purchases/'),
    ])
      .then(([b, e, p, pur]) => {
        setBudgets(b)
        setExpenses(e)
        setPayroll(p)
        setPurchases(pur)
      })
      .catch((e) => setError(e.message))
      .finally(() => setListLoading(false))
  }

  useEffect(() => {
    load()
    loadReminders()
  }, [yearFilter]) // eslint-disable-line

  const enrichedBudgets = useMemo(() => {
    return budgets.map(b => {
      const actual = calculateActualSpending(b, expenses, payroll, purchases)
      const variance = b.budgeted_amount - actual
      let status = 'Within Budget'
      const pct = (actual / b.budgeted_amount) * 100
      if (pct > 100) status = 'Over Budget'
      else if (pct >= 80) status = 'Near Limit'

      return { ...b, actual_calculated: actual, variance_calculated: variance, status_label: status }
    }).filter(b => periodTypeFilter === 'all' || b.period_type === periodTypeFilter)
  }, [budgets, expenses, payroll, purchases, periodTypeFilter])

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setError(''); setOpen(true) }
  const openEdit = (b) => {
    setEditingId(b.id)
    setForm({
      period_type: b.period_type, year: b.year, month: b.month || '', quarter: b.quarter || '',
      category: b.category, budgeted_amount: b.budgeted_amount,
    })
    setError(''); setOpen(true)
  }

  const save = async () => {
    if (!form.category.trim() || !form.budgeted_amount) { setError('Category and budgeted amount are required.'); return }
    setSaving(true); setError('')
    try {
      if (editingId) {
        await api.put(`/approvals/budgets/${editingId}`, { budgeted_amount: Number(form.budgeted_amount) })
      } else {
        const payload = {
          period_type: form.period_type,
          year: Number(form.year),
          month: form.period_type === 'monthly' ? Number(form.month) || null : null,
          quarter: form.period_type === 'quarterly' ? Number(form.quarter) || null : null,
          category: form.category.trim(),
          budgeted_amount: Number(form.budgeted_amount) || 0,
        }
        await api.post('/approvals/budgets', payload)
      }
      setOpen(false); load()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const remove = async (b) => {
    if (!confirm(`Delete budget for "${b.category}"?`)) return
    try { await api.del(`/approvals/budgets/${b.id}`); load() } catch (e) { alert(e.message) }
  }

  const totalBudgeted = enrichedBudgets.reduce((s, b) => s + (Number(b.budgeted_amount) || 0), 0)
  const totalActual = enrichedBudgets.reduce((s, b) => s + (Number(b.actual_calculated) || 0), 0)

  const periodLabel = (b) => {
    if (b.period_type === 'monthly' && b.month) return `${b.year}-${String(b.month).padStart(2, '0')}`
    if (b.period_type === 'quarterly' && b.quarter) return `${b.year} Q${b.quarter}`
    return `${b.year}`
  }

  const columns = [
    { key: 'category', header: 'Category', render: (b) => <strong>{b.category}</strong> },
    { key: 'period', header: 'Period', render: (b) => periodLabel(b) },
    { key: 'budgeted_amount', header: 'Budgeted', render: (b) => money(b.budgeted_amount) },
    { key: 'actual_amount', header: 'Actual', render: (b) => money(b.actual_calculated) },
    {
      key: 'variance', header: 'Variance',
      render: (b) => (
        <span style={{ color: b.variance_calculated < 0 ? 'var(--danger)' : 'var(--success, #16a34a)' }}>
          {money(b.variance_calculated)}
        </span>
      ),
    },
    {
      key: 'health', header: 'Utilization',
      render: (b) => <BudgetProgressBar budgeted={b.budgeted_amount} actual={b.actual_calculated} />
    },
    {
      key: 'status', header: 'Status',
      render: (b) => {
        const color = b.status_label === 'Over Budget' ? 'var(--danger)' : b.status_label === 'Near Limit' ? 'var(--warning)' : 'var(--success)'
        return <span className="badge" style={{ background: `${color}20`, color, border: `1px solid ${color}40` }}>{b.status_label}</span>
      }
    },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (b) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => openEdit(b) },
          { label: 'Log Expense', onClick: () => { /* would ideally open expense modal with this category */ } },
          { label: 'Delete', onClick: () => remove(b), danger: true },
        ]} />
      ),
    },
  ]

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 style={{ margin: 0 }}>Budgets</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
            Total budgeted: <strong>{money(totalBudgeted)}</strong> · Total actual: <strong>{money(totalActual)}</strong>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div className="mode-switch">
            <button className={periodTypeFilter === 'all' ? 'active' : ''} onClick={() => setPeriodTypeFilter('all')}>All</button>
            <button className={periodTypeFilter === 'monthly' ? 'active' : ''} onClick={() => setPeriodTypeFilter('monthly')}>Monthly</button>
            <button className={periodTypeFilter === 'yearly' ? 'active' : ''} onClick={() => setPeriodTypeFilter('yearly')}>Annual</button>
          </div>
          <select value={yearFilter} onChange={(e) => setYearFilter(Number(e.target.value))} style={{ width: 'auto' }}>
            {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={openNew}>+ Add Budget</button>
        </div>
      </div>

      <AlertBannerContainer reminders={reminders} onDismiss={dismissReminder} />

      <Table columns={columns} rows={enrichedBudgets} loading={listLoading} emptyText="No budgets set for this year yet." onRowClick={openEdit} />

      {open && (
        <Modal
          title={editingId ? 'Edit Budget' : 'Add Budget'}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save'}
              </button>
            </>
          }
        >
          {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
          {!editingId && (
            <>
              <label>Period Type</label>
              <select value={form.period_type} onChange={(e) => setForm({ ...form, period_type: e.target.value })}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
              <label>Year</label>
              <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} />
              {form.period_type === 'monthly' && (
                <>
                  <label>Month</label>
                  <select value={form.month} onChange={(e) => setForm({ ...form, month: e.target.value })}>
                    <option value="">Select month…</option>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('default', { month: 'long' })}</option>
                    ))}
                  </select>
                </>
              )}
              {form.period_type === 'quarterly' && (
                <>
                  <label>Quarter</label>
                  <select value={form.quarter} onChange={(e) => setForm({ ...form, quarter: e.target.value })}>
                    <option value="">Select quarter…</option>
                    {[1, 2, 3, 4].map((q) => <option key={q} value={q}>Q{q}</option>)}
                  </select>
                </>
              )}
              <label>Category</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Rent, Marketing, Utilities" />
            </>
          )}
          <label>Budgeted Amount</label>
          <input type="number" value={form.budgeted_amount} onChange={(e) => setForm({ ...form, budgeted_amount: e.target.value })} />
        </Modal>
      )}
    </div>
  )
}
