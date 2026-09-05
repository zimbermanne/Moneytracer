import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import Attachments from '../components/Attachments.jsx'
import { apiUrl } from '../api-config.js'

const emptyForm = () => ({
  category: 'General',
  description: '',
  vendor_name: '',
  amount: 0,
  expense_date: new Date().toISOString().split('T')[0],
  payment_method_id: null
})

const emptyRecForm = () => ({
  category: 'General',
  description: '',
  vendor_name: '',
  amount: 0,
  payment_method_id: null,
  frequency: 'monthly',
  interval: 1,
  start_date: new Date().toISOString().split('T')[0]
})

export default function Expenses() {
  const api = useApi()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager'

  const [tab, setTab] = useState('Ledger') // 'Ledger' or 'Recurring'
  const [expenses, setExpenses] = useState([])
  const [stats, setStats] = useState(null)
  const [categories, setCategories] = useState([])
  const [paymentMethods, setPaymentMethods] = useState([])
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)

  // Ledger Filters
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [searchQuery, setSearchQuery] = useState('')

  // Modal state
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  // Recurring Expenses state
  const [recurring, setRecurring] = useState([])
  const [showRecurringForm, setShowRecurringForm] = useState(false)
  const [editingRecurring, setEditingRecurring] = useState(null)
  const [recForm, setRecForm] = useState(emptyRecForm())

  const load = async () => {
    setListLoading(true)
    try {
      if (tab === 'Ledger') {
        const params = new URLSearchParams()
        if (startDate) params.set('start', startDate)
        if (endDate) params.set('end', endDate)
        if (categoryFilter) params.set('category', categoryFilter)
        if (searchQuery) params.set('q', searchQuery)

        const data = await api.get(`/expenses/?${params.toString()}`)
        setExpenses(data)

        const statsData = await api.get('/expenses/stats/summary')
        setStats(statsData)
      } else {
        const data = await api.get('/recurring-expenses/')
        setRecurring(data)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setListLoading(false)
    }
  }

  const loadMetaData = async () => {
    try {
      const cats = await api.get('/expenses/categories/list')
      setCategories(cats)
      const methods = await api.get('/ledgers/payment-methods')
      setPaymentMethods(methods.filter(m => !m.is_credit))
    } catch (e) {
      console.error('Failed to load metadata:', e)
    }
  }

  useEffect(() => {
    load()
  }, [startDate, endDate, categoryFilter, searchQuery, tab]) // eslint-disable-line

  useEffect(() => {
    loadMetaData()
  }, []) // eslint-disable-line

  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm())
    setError('')
    setOpen(true)
  }

  const openEdit = (e) => {
    setEditingId(e.id)
    setForm({
      category: e.category,
      description: e.description,
      vendor_name: e.vendor_name || '',
      amount: e.amount,
      expense_date: e.expense_date.split('T')[0],
      payment_method_id: e.payment_method_id
    })
    setError('')
    setOpen(true)
  }

  const save = async () => {
    if (!form.category) { setError('Category is required.'); return }
    if (form.amount <= 0) { setError('Amount must be greater than zero.'); return }

    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        expense_date: new Date(form.expense_date).toISOString()
      }

      if (editingId) {
        await api.put(`/expenses/${editingId}`, payload)
      } else {
        await api.post('/expenses/', payload)
      }

      setOpen(false)
      load()
      loadMetaData()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    if (!confirm('Delete this expense? Ledger entries will be reversed.')) return
    try {
      await api.del(`/expenses/${id}`)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const exportCsv = () => {
    const params = new URLSearchParams()
    if (startDate) params.set('start', startDate)
    if (endDate) params.set('end', endDate)
    if (categoryFilter) params.set('category', categoryFilter)

    window.location.href = apiUrl(`/api/expenses/export/csv?${params.toString()}`)
  }

  const columns = [
    {
      key: 'expense_date',
      header: 'Date',
      render: (r) => new Date(r.expense_date).toLocaleDateString()
    },
    { key: 'category', header: 'Category', render: (r) => <span className="badge badge-outline">{r.category}</span> },
    { key: 'vendor_name', header: 'Vendor', render: (r) => r.vendor_name || <span style={{color: 'var(--text-faint)'}}>—</span> },
    { key: 'description', header: 'Description' },
    { key: 'payment_method_name', header: 'Paid From', render: (r) => r.payment_method_name || 'Cash' },
    {
      key: 'amount',
      header: 'Amount',
      render: (r) => <strong style={{color: 'var(--danger)'}}>TZS {r.amount.toLocaleString()}</strong>
    },
    {
      key: 'actions',
      header: '',
      stopRowClick: true,
      render: (r) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => openEdit(r) },
          { label: 'Delete', onClick: () => remove(r.id), danger: true, hidden: !isAdmin },
        ]} />
      )
    }
  ]

  const recurringColumns = [
    { key: 'description', header: 'Template', render: (r) => <strong>{r.description}</strong> },
    { key: 'category', header: 'Category' },
    { key: 'frequency', header: 'Frequency', render: (r) => `${r.interval} ${r.frequency}` },
    { key: 'amount', header: 'Amount', render: (r) => `TZS ${r.amount.toLocaleString()}` },
    { key: 'next_generation', header: 'Next Run', render: (r) => new Date(r.next_generation).toLocaleDateString() },
    { key: 'is_active', header: 'Status', render: (r) => <span className={`badge badge-${r.is_active ? 'paid' : 'unpaid'}`}>{r.is_active ? 'Active' : 'Paused'}</span> },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (r) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => { setEditingRecurring(r); setRecForm(r); setShowRecurringForm(true) } },
          { label: r.is_active ? 'Pause' : 'Resume', onClick: () => toggleRecurring(r) },
          { label: 'Generate Now', onClick: () => generateNow(r.id) },
          { label: 'Delete', onClick: () => removeRecurring(r.id), danger: true },
        ]} />
      )
    }
  ]

  const toggleRecurring = async (r) => {
    try {
      await api.put(`/recurring-expenses/${r.id}`, { is_active: !r.is_active })
      load()
    } catch (e) { setError(e.message) }
  }

  const generateNow = async (id) => {
    try {
      await api.post(`/recurring-expenses/${id}/generate`, {})
      alert('Expense instance generated successfully.')
      load()
    } catch (e) { setError(e.message) }
  }

  const removeRecurring = async (id) => {
    if (!confirm('Delete this recurring template?')) return
    try {
      await api.del(`/recurring-expenses/${id}`)
      load()
    } catch (e) { setError(e.message) }
  }

  const saveRecurring = async () => {
    try {
      if (editingRecurring) {
        await api.put(`/recurring-expenses/${editingRecurring.id}`, recForm)
      } else {
        await api.post('/recurring-expenses/', recForm)
      }
      setShowRecurringForm(false)
      load()
    } catch (e) { setError(e.message) }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Expense Ledger</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={exportCsv}>⬇ Export CSV</button>
          <button className="btn btn-primary" onClick={openNew}>+ Record Expense</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setTab('Ledger')}
          style={{
            padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: tab === 'Ledger' ? 700 : 400,
            borderBottom: tab === 'Ledger' ? '3px solid var(--accent)' : '3px solid transparent',
            color: tab === 'Ledger' ? 'var(--accent)' : 'var(--text-muted)'
          }}
        >
          Expense History
        </button>
        <button
          onClick={() => setTab('Recurring')}
          style={{
            padding: '10px 20px', background: 'none', border: 'none', cursor: 'pointer',
            fontWeight: tab === 'Recurring' ? 700 : 400,
            borderBottom: tab === 'Recurring' ? '3px solid var(--accent)' : '3px solid transparent',
            color: tab === 'Recurring' ? 'var(--accent)' : 'var(--text-muted)'
          }}
        >
          Recurring Templates
        </button>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      {tab === 'Ledger' ? (
        <>
          {stats && (
            <div className="card-grid" style={{ marginBottom: 20 }}>
              <div className="card metric-card">
                <div className="label">Operating Expenses</div>
                <div className="value">TZS {stats.total_amount.toLocaleString()}</div>
                <div className="sub">{stats.total_expenses} entries</div>
              </div>
              <div className="card metric-card">
                <div className="label">Cost of Goods Sold (COGS)</div>
                <div className="value">TZS {stats.cogs.toLocaleString()}</div>
                <div className="sub">Inventory cost</div>
              </div>
              <div className="card metric-card" style={{ background: 'var(--surface-sunken)' }}>
                <div className="label">Total Outgoings</div>
                <div className="value" style={{ color: 'var(--danger)' }}>TZS {stats.total_outgoings.toLocaleString()}</div>
                <div className="sub">Combined</div>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <SearchBar value={searchQuery} onChange={setSearchQuery} placeholder="Search description or vendor..." />
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>Category</label>
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>From</label>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="form-row" style={{ marginBottom: 0 }}>
              <label>To</label>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <button className="btn btn-outline" onClick={() => {
              setStartDate(''); setEndDate(''); setCategoryFilter(''); setSearchQuery('')
            }}>Reset</button>
          </div>

          <Table
            columns={columns}
            rows={expenses}
            loading={listLoading}
            loadingText="Loading expenses..."
            emptyText={searchQuery || categoryFilter || startDate ? 'No expenses match filters.' : 'No expenses recorded yet.'}
            onRowClick={openEdit}
          />
        </>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
             <button className="btn btn-primary" onClick={() => { setEditingRecurring(null); setRecForm(emptyRecForm()); setShowRecurringForm(true); }}>+ Create Recurring Template</button>
          </div>
          <Table
            columns={recurringColumns}
            rows={recurring}
            loading={listLoading}
            loadingText="Loading recurring expenses..."
            emptyText="No recurring templates set up."
          />
        </>
      )}

      {open && (
        <Modal
          title={editingId ? 'Edit Expense' : 'Record Expense'}
          onClose={() => setOpen(false)}
          wide={true}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Record Expense'}
            </button>
          </>)}
        >
          <div style={{ display: 'grid', gridTemplateColumns: editingId ? '1fr 320px' : '1fr', gap: 24 }}>
            <div>
              <div className="debtor-section-label">Expense Details</div>
              <div className="debtor-form-grid">
                <div className="form-row">
                  <label>Date</label>
                  <input type="date" value={form.expense_date} onChange={(e) => setForm({ ...form, expense_date: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Category</label>
                  <input
                    list="expense-categories"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="e.g. Rent, Electricity"
                  />
                  <datalist id="expense-categories">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="form-row">
                  <label>Vendor / Paid To</label>
                  <input value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} placeholder="Who was paid?" />
                </div>
                <div className="form-row">
                  <label>Amount</label>
                  <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} />
                </div>
                <div className="form-row">
                  <label>Paid From</label>
                  <select
                    value={form.payment_method_id ?? ''}
                    onChange={(e) => setForm({ ...form, payment_method_id: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Cash (unspecified)</option>
                    {paymentMethods.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-row span-2">
                  <label>Description / Note</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Optional details about this expense"
                  />
                </div>
              </div>
            </div>

            {editingId && (
              <div>
                <div className="debtor-section-label">Receipts & Attachments</div>
                <Attachments entityType="expense" entityId={editingId} />
              </div>
            )}
          </div>
        </Modal>
      )}

      {showRecurringForm && (
        <Modal
          title={editingRecurring ? 'Edit Recurring Template' : 'New Recurring Template'}
          onClose={() => setShowRecurringForm(false)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setShowRecurringForm(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={saveRecurring}>Save Template</button>
          </>)}
        >
          <div className="debtor-form-grid">
            <div className="form-row">
              <label>Frequency</label>
              <select value={recForm.frequency} onChange={e => setRecForm({...recForm, frequency: e.target.value})}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="form-row">
              <label>Interval (every X frequency)</label>
              <input type="number" min="1" value={recForm.interval} onChange={e => setRecForm({...recForm, interval: Number(e.target.value)})} />
            </div>
            <div className="form-row">
              <label>Start Date</label>
              <input type="date" value={recForm.start_date.split('T')[0]} onChange={e => setRecForm({...recForm, start_date: e.target.value})} />
            </div>
            <div className="form-row">
              <label>Category</label>
              <input list="expense-categories" value={recForm.category} onChange={e => setRecForm({...recForm, category: e.target.value})} />
            </div>
            <div className="form-row"><label>Amount</label><input type="number" value={recForm.amount} onChange={e => setRecForm({...recForm, amount: Number(e.target.value)})} /></div>
            <div className="form-row"><label>Vendor</label><input value={recForm.vendor_name} onChange={e => setRecForm({...recForm, vendor_name: e.target.value})} /></div>
            <div className="form-row span-2"><label>Description</label><input value={recForm.description} onChange={e => setRecForm({...recForm, description: e.target.value})} /></div>
          </div>
        </Modal>
      )}
    </div>
  )
}
