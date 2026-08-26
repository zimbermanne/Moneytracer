import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import ThermalStatement from '../components/ThermalStatement.jsx'
import { useSearch } from '../hooks/useSearch.js'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString()}`
}

function IncomeChart({ series }) {
  if (!series || series.length === 0) return null
  const data = series.map((p) => ({ month: p.month, total: p.total }))
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Income</h3>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        This chart is displayed in the organization's base currency.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="customerIncomeFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)} />
          <Tooltip formatter={(value) => [money(value), 'Income']}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
          <Area type="monotone" dataKey="total" stroke="var(--accent)" fill="url(#customerIncomeFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const TABS = ['Overview', 'Invoices', 'Quotations', 'Debts', 'Statement']

function CustomerDetail({ customer, onBack, onEdit, onDelete }) {
  const api = useApi()
  const { account } = useAuth()
  const [tab, setTab] = useState('Overview')
  const [profile, setProfile] = useState(null)
  const [statement, setStatement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printStatement, setPrintStatement] = useState(false)
  const [emailStatementOpen, setEmailStatementOpen] = useState(false)
  const [statementEmail, setStatementEmail] = useState('')
  const [emailSending, setEmailSending] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    setLoading(true)
    setProfile(null)
    setStatement(null)
    setTab('Overview')
    setDateFrom('')
    setDateTo('')
    setEmailStatementOpen(false)
    setStatementEmail(customer.email || '')
    api.get(`/customers/${customer.id}/profile`)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [customer.id]) // eslint-disable-line

  const loadStatement = (fromOverride, toOverride) => {
    const from = fromOverride !== undefined ? fromOverride : dateFrom
    const to = toOverride !== undefined ? toOverride : dateTo
    const params = new URLSearchParams()
    if (from) params.set('date_from', new Date(from).toISOString())
    if (to) {
      // Include the whole end day, not just its midnight.
      const end = new Date(to)
      end.setHours(23, 59, 59, 999)
      params.set('date_to', end.toISOString())
    }
    const qs = params.toString()
    setStatement(null)
    api.get(`/customers/${customer.id}/statement${qs ? `?${qs}` : ''}`).then(setStatement).catch((e) => setError(e.message))
  }

  useEffect(() => {
    if (tab !== 'Statement' || statement) return
    loadStatement()
  }, [tab]) // eslint-disable-line

  const handleEmailStatement = async () => {
    if (!statementEmail.trim()) { setError('Enter a recipient email'); return }
    setError(''); setEmailSending(true)
    try {
      const params = new URLSearchParams()
      if (dateFrom) params.set('date_from', new Date(dateFrom).toISOString())
      if (dateTo) {
        const end = new Date(dateTo)
        end.setHours(23, 59, 59, 999)
        params.set('date_to', end.toISOString())
      }
      const qs = params.toString()
      const res = await api.post(`/customers/${customer.id}/email-statement${qs ? `?${qs}` : ''}`, { to_email: statementEmail.trim() })
      alert(res.detail || 'Statement emailed.')
      setEmailStatementOpen(false)
    } catch (e) { setError(e.message) }
    finally { setEmailSending(false) }
  }

  const invoiceColumns = [
    { key: 'invoice_no', header: 'Invoice #' },
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'total', header: 'Amount', render: (r) => money(r.total) },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
  ]

  const quoteColumns = [
    { key: 'quote_no', header: 'Quote #' },
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'total', header: 'Amount', render: (r) => money(r.total) },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
  ]

  const debtColumns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'note', header: 'Note' },
    { key: 'total_owed', header: 'Owed', render: (r) => money(r.total_owed) },
    { key: 'amount_paid', header: 'Paid', render: (r) => money(r.amount_paid) },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
  ]

  const statementColumns = [
    { key: 'date', header: 'Date', render: (r) => new Date(r.date).toLocaleDateString() },
    { key: 'description', header: 'Details' },
    { key: 'invoiced', header: 'Invoiced', render: (r) => r.invoiced ? money(r.invoiced) : '—' },
    { key: 'received', header: 'Received', render: (r) => r.received ? money(r.received) : '—' },
    { key: 'balance', header: 'Balance', render: (r) => money(r.balance) },
  ]

  return (
    <div className="customer-detail-pane">
      <div className="customer-detail-header">
        <button className="btn btn-outline customer-back-btn" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0, flex: 1 }}>{customer.name}</h2>
        <button className="btn btn-outline" onClick={() => onEdit(customer)}>✎ Edit</button>
        <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => onDelete(customer)}>🗑 Delete</button>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? <div style={{ padding: 20, textAlign: 'center' }}>Loading…</div> : profile && (
        <>
          <div className="card-grid" style={{ marginBottom: 16 }}>
            <div className="card metric-card">
              <div className="label">Phone</div>
              <div className="value" style={{ fontSize: 16 }}>{profile.phone || '—'}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Email</div>
              <div className="value" style={{ fontSize: 16 }}>{profile.email || '—'}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Address</div>
              <div className="value" style={{ fontSize: 16 }}>{profile.address || '—'}</div>
            </div>
            <div className="card metric-card">
              <div className="label">TIN Number</div>
              <div className="value" style={{ fontSize: 16 }}>{profile.tin || '—'}</div>
            </div>
          </div>

          <div className="card-grid" style={{ marginBottom: 16 }}>
            <div className="card metric-card">
              <div className="label">Total Purchased (Credit)</div>
              <div className="value">{money(profile.total_purchased)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Outstanding Receivables (Debit)</div>
              <div className="value">{money(profile.outstanding_receivables)}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
            {TABS.map((t) => (
              <button key={t}
                onClick={() => setTab(t)}
                className="tab-btn"
                style={{
                  padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  fontWeight: tab === t ? 700 : 400,
                  borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                }}>
                {t}
              </button>
            ))}
          </div>

          {tab === 'Overview' && (
            <>
              {profile.notes && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="label" style={{ marginBottom: 6 }}>Notes</div>
                  <div style={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>{profile.notes}</div>
                </div>
              )}
              <IncomeChart series={profile.income_last_6_months} />
              <div style={{ fontWeight: 700, textAlign: 'right' }}>
                Total Income (Last 6 Months) — {money(profile.total_income_last_6_months)}
              </div>
            </>
          )}

          {tab === 'Invoices' && (
            <Table columns={invoiceColumns} rows={profile.invoices} emptyText="No invoices for this customer yet." />
          )}

          {tab === 'Quotations' && (
            <Table columns={quoteColumns} rows={profile.quotations} emptyText="No quotations for this customer yet." />
          )}

          {tab === 'Debts' && (
            <Table columns={debtColumns} rows={profile.debts} emptyText="No credit sales or debts for this customer." />
          )}

          {tab === 'Statement' && (
            statement ? (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10, marginBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>From</label>
                    <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>To</label>
                    <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                  <button className="btn btn-outline" onClick={loadStatement}>Apply</button>
                  {(dateFrom || dateTo) && (
                    <button className="btn btn-outline" onClick={() => { setDateFrom(''); setDateTo(''); loadStatement('', '') }}>
                      Reset to this month
                    </button>
                  )}
                  <div style={{ flex: 1 }} />
                  <button className="btn btn-outline" onClick={() => setEmailStatementOpen(!emailStatementOpen)}>
                    ✉ Email Statement
                  </button>
                  <button className="btn btn-outline" onClick={() => setPrintStatement(true)}>
                    🖨 Print Statement
                  </button>
                </div>

                {emailStatementOpen && (
                  <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      type="email"
                      placeholder="customer@email.com"
                      value={statementEmail}
                      onChange={(e) => setStatementEmail(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button className="btn btn-primary" onClick={handleEmailStatement} disabled={emailSending}>
                      {emailSending ? 'Sending…' : 'Send Statement'}
                    </button>
                  </div>
                )}

                <div className="card-grid" style={{ marginBottom: 16 }}>
                  <div className="card metric-card">
                    <div className="label">Opening Balance</div>
                    <div className="value" style={{ fontSize: 18 }}>{money(statement.opening_balance)}</div>
                  </div>
                  <div className="card metric-card">
                    <div className="label">Invoiced Amount</div>
                    <div className="value" style={{ fontSize: 18 }}>{money(statement.invoiced_amount)}</div>
                  </div>
                  <div className="card metric-card">
                    <div className="label">Amount Received</div>
                    <div className="value" style={{ fontSize: 18 }}>{money(statement.amount_received)}</div>
                  </div>
                  <div className="card metric-card">
                    <div className="label">Balance Due</div>
                    <div className="value" style={{ fontSize: 18 }}>{money(statement.balance_due)}</div>
                  </div>
                </div>
                <Table columns={statementColumns} rows={statement.entries} emptyText="No activity in this period." />
              </div>
            ) : <div style={{ padding: 20, textAlign: 'center' }}>Loading…</div>
          )}
        </>
      )}

      {printStatement && statement && (
        <ThermalStatement
          statement={statement}
          company={account}
          onClose={() => setPrintStatement(false)}
        />
      )}
    </div>
  )
}

export default function Customers() {
  const api = useApi()
  const [customers, setCustomers] = useState([])
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', tin_number: '', notes: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [deleting, setDeleting] = useState(null) // customer pending delete confirmation

  const load = (keepSelection = true) => api.get('/customers/').then((rows) => {
    setCustomers(rows)
    // Keep the detail pane in sync with any updated totals after a reload,
    // instead of silently going stale while a customer stays "selected".
    if (keepSelection) {
      setSelected((prev) => prev ? rows.find((r) => r.id === prev.id) || null : null)
    }
  }).catch((e) => setError(e.message))

  useEffect(() => { load(false) }, []) // eslint-disable-line

  const { query, setQuery, filtered: filteredCustomers } = useSearch(customers, ['name'])

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '', phone: '', email: '', address: '', tin_number: '', notes: '' })
    setError('')
    setShowForm(true)
  }

  const openEdit = (customer) => {
    setEditingId(customer.id)
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      tin_number: customer.tin_number || '',
      notes: customer.notes || '',
    })
    setError('')
    setShowForm(true)
  }

  const submitForm = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (editingId) {
        await api.put(`/customers/${editingId}`, form)
      } else {
        await api.post('/customers/', form)
      }
      setShowForm(false)
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setSaving(true)
    setError('')
    try {
      await api.del(`/customers/${deleting.id}`)
      setDeleting(null)
      setSelected((prev) => (prev?.id === deleting.id ? null : prev))
      load(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const syncExisting = async () => {
    setSyncing(true)
    setSyncMessage('')
    setError('')
    try {
      const result = await api.post('/customers/sync-existing', {})
      setSyncMessage(
        result.created_count > 0
          ? `Imported ${result.created_count} customer${result.created_count === 1 ? '' : 's'} from existing sales, invoices, quotations, and debts.`
          : 'Everything is already imported — no new customers found in your existing records.'
      )
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="page customers-page">
      <div className="page-header">
        <h1>Customers</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={syncExisting} disabled={syncing}>
            {syncing ? 'Importing…' : 'Import from existing records'}
          </button>
          <button className="btn btn-gold" onClick={openCreate}>+ New Customer</button>
        </div>
      </div>
      {syncMessage && <div className="success-text" style={{ marginBottom: 12 }}>{syncMessage}</div>}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className={`customers-split${selected ? ' has-selection' : ''}`}>
        <div className="customers-list-pane">
          <div style={{ marginBottom: 10 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Search customers…" />
          </div>
          {filteredCustomers.length === 0 ? (
            <div className="customers-list-empty">
              {query ? 'No customers match your search.' : 'No customers yet — add one to get started.'}
            </div>
          ) : (
            <ul className="customers-list">
              {filteredCustomers.map((c) => (
                <li key={c.id}>
                  <button
                    className={`customers-list-item${selected?.id === c.id ? ' active' : ''}`}
                    onClick={() => setSelected(c)}
                  >
                    <span className="customers-list-name">{c.name}</span>
                    <span className="customers-list-sub">
                      {c.total_owed > 0 ? money(c.total_owed) : money(c.total_purchased)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="customers-detail-pane">
          {selected ? (
            <CustomerDetail
              customer={selected}
              onBack={() => setSelected(null)}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          ) : (
            <div className="customers-detail-placeholder">
              Select a customer on the left to view their profile, invoices, quotations, debts, and statement.
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <Modal title={editingId ? 'Edit Customer' : 'New Customer'} onClose={() => setShowForm(false)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-gold" onClick={submitForm} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Customer'}
            </button>
          </>}>
          <form onSubmit={submitForm}>
            <div className="form-row">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </div>
            <div className="form-row">
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 255712345678" />
            </div>
            <div className="form-row">
              <label>Email</label>
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="e.g. customer@example.com" />
            </div>
            <div className="form-row">
              <label>Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="form-row">
              <label>TIN Number</label>
              <input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Notes</label>
              <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {error && <div className="error-text">{error}</div>}
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title="Delete Customer" onClose={() => setDeleting(null)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDelete} disabled={saving}>
              {saving ? 'Deleting…' : 'Delete Customer'}
            </button>
          </>}>
          <p>
            Delete <strong>{deleting.name}</strong>? This removes their customer record (contact info and notes).
            Their existing sales, invoices, quotations, and debts stay on file — they just won't be linked to a
            customer record anymore.
          </p>
          {error && <div className="error-text">{error}</div>}
        </Modal>
      )}
    </div>
  )
}
