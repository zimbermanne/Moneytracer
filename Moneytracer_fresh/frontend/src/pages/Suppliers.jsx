import { useEffect, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi.js'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString()}`
}

function SpendChart({ series }) {
  if (!series || series.length === 0) return null
  const data = series.map((p) => ({ month: p.month, total: p.total }))
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0, marginBottom: 4 }}>Spend</h3>
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        This chart is displayed in the organization's base currency.
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="supplierSpendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.35} />
              <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false}
            tickFormatter={(v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)}K` : v)} />
          <Tooltip formatter={(value) => [money(value), 'Spend']}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13 }} />
          <Area type="monotone" dataKey="total" stroke="var(--accent)" fill="url(#supplierSpendFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

const TABS = ['Overview', 'Purchase Orders', 'Purchases', 'Payables']

function SupplierDetail({ supplier, onBack, onEdit, onDelete }) {
  const api = useApi()
  const [tab, setTab] = useState('Overview')
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    setProfile(null)
    setTab('Overview')
    api.get(`/suppliers/${supplier.id}/profile`)
      .then(setProfile)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [supplier.id]) // eslint-disable-line

  const poColumns = [
    { key: 'po_no', header: 'PO #' },
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'total', header: 'Amount', render: (r) => money(r.total) },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
  ]

  const purchaseColumns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'item_name', header: 'Item' },
    { key: 'quantity', header: 'Qty' },
    { key: 'unit_cost', header: 'Unit Cost', render: (r) => money(r.unit_cost) },
    { key: 'total', header: 'Total', render: (r) => money(r.total) },
  ]

  const payableColumns = [
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleDateString() },
    { key: 'note', header: 'Note' },
    { key: 'total_owed', header: 'Owed', render: (r) => money(r.total_owed) },
    { key: 'amount_paid', header: 'Paid', render: (r) => money(r.amount_paid) },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
  ]

  return (
    <div className="customer-detail-pane">
      <div className="customer-detail-header">
        <button className="btn btn-outline customer-back-btn" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0, flex: 1 }}>{supplier.name}</h2>
        <button className="btn btn-outline" onClick={() => onEdit(supplier)}>✎ Edit</button>
        <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => onDelete(supplier)}>🗑 Delete</button>
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
              <div className="label">TIN / VRN</div>
              <div className="value" style={{ fontSize: 16 }}>{profile.tin || '—'} {profile.vrn ? `/ ${profile.vrn}` : ''}</div>
            </div>
          </div>

          <div className="card-grid" style={{ marginBottom: 16 }}>
            <div className="card metric-card">
              <div className="label">Total Spent</div>
              <div className="value">{money(profile.total_spent)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Outstanding Payables</div>
              <div className="value">{money(profile.outstanding_payables)}</div>
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
              <SpendChart series={profile.spend_last_6_months} />
              <div style={{ fontWeight: 700, textAlign: 'right' }}>
                Total Spend (Last 6 Months) — {money(profile.total_spend_last_6_months)}
              </div>
            </>
          )}

          {tab === 'Purchase Orders' && (
            <Table columns={poColumns} rows={profile.purchase_orders} emptyText="No purchase orders for this supplier yet." />
          )}

          {tab === 'Purchases' && (
            <Table columns={purchaseColumns} rows={profile.purchases} emptyText="No received purchases from this supplier yet." />
          )}

          {tab === 'Payables' && (
            <Table columns={payableColumns} rows={profile.payables} emptyText="No outstanding balances with this supplier." />
          )}
        </>
      )}
    </div>
  )
}

export default function Suppliers() {
  const api = useApi()
  const [suppliers, setSuppliers] = useState([])
  const [selected, setSelected] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', tin_number: '', vrn_number: '', notes: '' })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  const [deleting, setDeleting] = useState(null)
  const [query, setQuery] = useState('')

  const load = (keepSelection = true) => api.get('/suppliers/').then((rows) => {
    setSuppliers(rows)
    if (keepSelection) {
      setSelected((prev) => prev ? rows.find((r) => r.id === prev.id) || null : null)
    }
  }).catch((e) => setError(e.message))

  useEffect(() => { load(false) }, []) // eslint-disable-line

  const filteredSuppliers = suppliers.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))

  const openCreate = () => {
    setEditingId(null)
    setForm({ name: '', phone: '', email: '', address: '', tin_number: '', vrn_number: '', notes: '' })
    setError('')
    setShowForm(true)
  }

  const openEdit = (supplier) => {
    setEditingId(supplier.id)
    setForm({
      name: supplier.name || '',
      phone: supplier.phone || '',
      email: supplier.email || '',
      address: supplier.address || '',
      tin_number: supplier.tin_number || '',
      vrn_number: supplier.vrn_number || '',
      notes: supplier.notes || '',
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
        await api.put(`/suppliers/${editingId}`, form)
      } else {
        await api.post('/suppliers/', form)
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
      await api.del(`/suppliers/${deleting.id}`)
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
      const result = await api.post('/suppliers/sync-existing', {})
      setSyncMessage(
        result.created_count > 0
          ? `Imported ${result.created_count} supplier${result.created_count === 1 ? '' : 's'} from existing purchases, purchase orders, and payables.`
          : 'Everything is already imported — no new suppliers found in your existing records.'
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
        <h1>Suppliers</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={syncExisting} disabled={syncing}>
            {syncing ? 'Importing…' : 'Import from existing records'}
          </button>
          <button className="btn btn-gold" onClick={openCreate}>+ New Supplier</button>
        </div>
      </div>
      {syncMessage && <div className="success-text" style={{ marginBottom: 12 }}>{syncMessage}</div>}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className={`customers-split${selected ? ' has-selection' : ''}`}>
        <div className="customers-list-pane">
          <div style={{ marginBottom: 10 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Search suppliers…" />
          </div>
          {filteredSuppliers.length === 0 ? (
            <div className="customers-list-empty">
              {query ? 'No suppliers match your search.' : 'No suppliers yet — add one to get started.'}
            </div>
          ) : (
            <ul className="customers-list">
              {filteredSuppliers.map((s) => (
                <li key={s.id}>
                  <button
                    className={`customers-list-item${selected?.id === s.id ? ' active' : ''}`}
                    onClick={() => setSelected(s)}
                  >
                    <span className="customers-list-name">{s.name}</span>
                    <span className="customers-list-sub">
                      {s.total_owed > 0 ? money(s.total_owed) : money(s.total_spent)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="customers-detail-pane">
          {selected ? (
            <SupplierDetail
              supplier={selected}
              onBack={() => setSelected(null)}
              onEdit={openEdit}
              onDelete={setDeleting}
            />
          ) : (
            <div className="customers-detail-placeholder">
              Select a supplier on the left to view their profile, purchase orders, purchases, and payables.
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <Modal title={editingId ? 'Edit Supplier' : 'New Supplier'} onClose={() => setShowForm(false)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setShowForm(false)}>Cancel</button>
            <button className="btn btn-gold" onClick={submitForm} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save Supplier'}
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
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="e.g. supplier@example.com" />
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
              <label>VRN Number</label>
              <input value={form.vrn_number} onChange={(e) => setForm({ ...form, vrn_number: e.target.value })} />
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
        <Modal title="Delete Supplier" onClose={() => setDeleting(null)}
          footer={<>
            <button className="btn btn-outline" onClick={() => setDeleting(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={confirmDelete} disabled={saving}>
              {saving ? 'Deleting…' : 'Delete Supplier'}
            </button>
          </>}>
          <p>
            Delete <strong>{deleting.name}</strong>? This removes their supplier record (contact info and notes).
            Their existing purchases, purchase orders, and payables stay on file — they just won't be linked to a
            supplier record anymore.
          </p>
          {error && <div className="error-text">{error}</div>}
        </Modal>
      )}
    </div>
  )
}
