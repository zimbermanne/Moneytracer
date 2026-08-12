import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
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

function CustomerDetail({ customer, onBack }) {
  const api = useApi()
  const [tab, setTab] = useState('Overview')
  const [profile, setProfile] = useState(null)
  const [statement, setStatement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setProfile(null)
    setStatement(null)
    setTab('Overview')
    api.get(`/customers/${customer.id}/profile`)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [customer.id]) // eslint-disable-line

  useEffect(() => {
    if (tab !== 'Statement' || statement) return
    api.get(`/customers/${customer.id}/statement`).then(setStatement).catch((e) => setError(e.message))
  }, [tab]) // eslint-disable-line

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
        <h2 style={{ margin: 0 }}>{customer.name}</h2>
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
              <div className="label">Address</div>
              <div className="value" style={{ fontSize: 16 }}>{profile.address || '—'}</div>
            </div>
            <div className="card metric-card">
              <div className="label">TIN Number</div>
              <div className="value" style={{ fontSize: 16 }}>{profile.tin || '—'}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Outstanding Receivables</div>
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
    </div>
  )
}

export default function Customers() {
  const api = useApi()
  const [customers, setCustomers] = useState([])
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', address: '', tin_number: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

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

  const submitCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post('/customers/', form)
      setShowCreate(false)
      setForm({ name: '', phone: '', address: '', tin_number: '' })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page customers-page">
      <div className="page-header">
        <h1>Customers</h1>
        <button className="btn btn-gold" onClick={() => setShowCreate(true)}>+ New Customer</button>
      </div>
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
            <CustomerDetail customer={selected} onBack={() => setSelected(null)} />
          ) : (
            <div className="customers-detail-placeholder">
              Select a customer on the left to view their profile, invoices, quotations, debts, and statement.
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <Modal title="New Customer" onClose={() => setShowCreate(false)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn btn-gold" onClick={submitCreate} disabled={saving}>{saving ? 'Saving…' : 'Save Customer'}</button>
          </>}>
          <form onSubmit={submitCreate}>
            <div className="form-row">
              <label>Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            </div>
            <div className="form-row">
              <label>Phone</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. 255712345678" />
            </div>
            <div className="form-row">
              <label>Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </div>
            <div className="form-row">
              <label>TIN Number</label>
              <input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} />
            </div>
            {error && <div className="error-text">{error}</div>}
          </form>
        </Modal>
      )}
    </div>
  )
}
