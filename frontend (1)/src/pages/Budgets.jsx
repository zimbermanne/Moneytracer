import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`
const currentYear = new Date().getFullYear()

const emptyForm = () => ({
  period_type: 'monthly', year: currentYear, month: '', quarter: '', category: '', budgeted_amount: '',
})

export default function Budgets() {
  const api = useApi()
  const [budgets, setBudgets] = useState([])
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [yearFilter, setYearFilter] = useState(currentYear)

  const load = () => {
    setListLoading(true)
    api.get(`/approvals/budgets?year=${yearFilter}`)
      .then(setBudgets)
      .catch((e) => setError(e.message))
      .finally(() => setListLoading(false))
  }

  useEffect(() => { load() }, [yearFilter]) // eslint-disable-line

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

  const totalBudgeted = budgets.reduce((s, b) => s + (Number(b.budgeted_amount) || 0), 0)
  const totalActual = budgets.reduce((s, b) => s + (Number(b.actual_amount) || 0), 0)

  const periodLabel = (b) => {
    if (b.period_type === 'monthly' && b.month) return `${b.year}-${String(b.month).padStart(2, '0')}`
    if (b.period_type === 'quarterly' && b.quarter) return `${b.year} Q${b.quarter}`
    return `${b.year}`
  }

  const columns = [
    { key: 'category', header: 'Category', render: (b) => <strong>{b.category}</strong> },
    { key: 'period', header: 'Period', render: (b) => periodLabel(b) },
    { key: 'budgeted_amount', header: 'Budgeted', render: (b) => money(b.budgeted_amount) },
    { key: 'actual_amount', header: 'Actual', render: (b) => money(b.actual_amount) },
    {
      key: 'variance', header: 'Variance',
      render: (b) => (
        <span style={{ color: b.variance < 0 ? 'var(--danger)' : 'var(--success, #16a34a)' }}>
          {money(b.variance)}
        </span>
      ),
    },
    { key: 'is_active', header: 'Status', render: (b) => <span className={b.is_active ? 'badge badge-paid' : 'badge badge-unpaid'}>{b.is_active ? 'Active' : 'Inactive'}</span> },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (b) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => openEdit(b) },
          { label: 'Delete', onClick: () => remove(b), danger: true },
        ]} />
      ),
    },
  ]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0 }}>Budgets</h1>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            Total budgeted: {money(totalBudgeted)} · Total actual: {money(totalActual)}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={yearFilter} onChange={(e) => setYearFilter(Number(e.target.value))}>
            {Array.from({ length: 5 }, (_, i) => currentYear - 2 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={openNew}>+ Add Budget</button>
        </div>
      </div>

      <Table columns={columns} rows={budgets} loading={listLoading} emptyText="No budgets set for this year yet." onRowClick={openEdit} />

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
