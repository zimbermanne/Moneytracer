import { useEffect, useMemo, useState } from 'react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import ThermalStatement from '../components/ThermalStatement.jsx'
import ThermalReceipt from '../components/ThermalReceipt.jsx'
import ReceiptEditor from '../components/ReceiptEditor.jsx'
import { useSearch } from '../hooks/useSearch.js'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString()}`
}

function daysAgo(iso) {
  if (!iso) return '—'
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (d <= 0) return 'Today'
  if (d === 1) return 'Yesterday'
  if (d < 30) return `${d} days ago`
  if (d < 365) return `${Math.floor(d / 30)} mo ago`
  return `${Math.floor(d / 365)} yr ago`
}

// wa.me wants international digits only (no +, spaces, or leading 00).
const waDigits = (phone) => (phone || '').replace(/\D/g, '').replace(/^00/, '')

function downloadCsv(filename, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const blob = new Blob(['\uFEFF' + rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

const TABS = ['Overview', 'Receipts', 'Invoices', 'Quotations', 'Debts', 'Statement']

function CustomerDetail({ customer, customers, refreshKey, onBack, onEdit, onDelete, onChanged }) {
  const api = useApi()
  const { account, user } = useAuth()
  // Same rule the server enforces on receipt edits and merges (admin / manager).
  const canManage = user?.role === 'admin' || user?.role === 'manager'
  const [tab, setTab] = useState('Overview')
  const [profile, setProfile] = useState(null)
  const [statement, setStatement] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [printStatement, setPrintStatement] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [receiptData, setReceiptData] = useState(null)
  const [receiptQuery, setReceiptQuery] = useState('')
  const [expanded, setExpanded] = useState({})
  const [editingReceipt, setEditingReceipt] = useState(null)
  const [printingReceipt, setPrintingReceipt] = useState(null)
  const [notice, setNotice] = useState('')
  const [showMerge, setShowMerge] = useState(false)
  const [mergeSourceId, setMergeSourceId] = useState('')
  const [merging, setMerging] = useState(false)
  const [mergeError, setMergeError] = useState('')

  // Switching customer: reset the view.
  useEffect(() => {
    setLoading(true)
    setProfile(null)
    setReceiptData(null)
    setStatement(null)
    setTab('Overview')
    setDateFrom('')
    setDateTo('')
    setExpanded({})
    setReceiptQuery('')
    setNotice('')
    setError('')
  }, [customer.id])

  // Load (and re-load after any edit/merge) without bouncing the user off their tab.
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get(`/customers/${customer.id}/profile`),
      api.get(`/customers/${customer.id}/receipts`),
    ])
      .then(([p, r]) => { if (!cancelled) { setProfile(p); setReceiptData(r); setStatement(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [customer.id, customer.name, refreshKey]) // eslint-disable-line

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
  }, [tab, statement]) // eslint-disable-line

  const receipts = receiptData?.receipts || []
  const summary = receiptData?.summary
  const visibleReceipts = useMemo(() => {
    const q = receiptQuery.trim().toLowerCase()
    if (!q) return receipts
    return receipts.filter((r) =>
      r.receipt_no.toLowerCase().includes(q) ||
      r.payment_method.toLowerCase().includes(q) ||
      r.lines.some((l) => l.item_name.toLowerCase().includes(q)) ||
      new Date(r.created_at).toLocaleDateString().includes(q))
  }, [receipts, receiptQuery])

  const exportReceipts = () => {
    const rows = [['Receipt #', 'Date', 'Customer', 'Payment', 'Item', 'Qty', 'Unit price', 'Line total']]
    receipts.forEach((r) => r.lines.forEach((l) =>
      rows.push([r.receipt_no, new Date(r.created_at).toLocaleString(), r.customer_name, r.payment_method, l.item_name, l.quantity, l.unit_price, l.total])))
    downloadCsv(`${customer.name.replace(/[^\w]+/g, '_')}_receipts.csv`, rows)
  }

  const printReceipt = (r) => setPrintingReceipt({
    receipt_no: r.receipt_no,
    sales: r.lines.map((l) => ({ item_name: l.item_name, quantity: l.quantity, unit_price: l.unit_price, total: l.total })),
    total: r.total,
    customer_name: r.customer_name,
    payment_mode: r.payment_method,
    created_at: r.created_at,
  })

  const receiptSaved = (res) => {
    const movedAway = res.customer_name !== customer.name
    setEditingReceipt(null)
    setNotice(
      (movedAway ? `Receipt ${res.receipt_no} moved to ${res.customer_name}. ` : `Receipt ${res.receipt_no} updated. `) +
      (res.ledger_warning ? res.ledger_warning : '')
    )
    onChanged()
  }

  const doMerge = async () => {
    if (!mergeSourceId) return
    setMerging(true)
    setMergeError('')
    try {
      await api.post(`/customers/${customer.id}/merge`, { source_id: Number(mergeSourceId) })
      setShowMerge(false)
      setMergeSourceId('')
      setNotice('Customers merged. All their sales, invoices, quotations and debts are now under this customer.')
      onChanged()
    } catch (e) {
      setMergeError(e.message)
    } finally {
      setMerging(false)
    }
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
        <button className="btn btn-gold" onClick={() => onEdit(customer)}>✎ Edit details</button>
        {canManage && customers.length > 1 && (
          <button className="btn btn-outline" onClick={() => { setMergeError(''); setMergeSourceId(''); setShowMerge(true) }}>⇄ Merge duplicate</button>
        )}
        <button className="btn btn-outline" style={{ color: 'var(--danger)' }} onClick={() => onDelete(customer)}>🗑 Delete</button>
      </div>

      {notice && (
        <div className="success-text" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <span>{notice}</span>
          <button className="btn btn-outline" style={{ padding: '0 8px' }} onClick={() => setNotice('')}>✕</button>
        </div>
      )}
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      {loading ? <div style={{ padding: 20, textAlign: 'center' }}>Loading…</div> : profile && (
        <>
          {(profile.phone || profile.email) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {profile.phone && <a className="btn btn-outline" href={`tel:${profile.phone}`}>📞 Call</a>}
              {profile.phone && waDigits(profile.phone).length >= 8 && (
                <a className="btn btn-outline" href={`https://wa.me/${waDigits(profile.phone)}`} target="_blank" rel="noreferrer">💬 WhatsApp</a>
              )}
              {profile.email && <a className="btn btn-outline" href={`mailto:${profile.email}`}>✉ Email</a>}
            </div>
          )}

          <div className="card-grid" style={{ marginBottom: 16 }}>
            {[
              ['Phone', profile.phone], ['Email', profile.email], ['Address', profile.address], ['TIN Number', profile.tin],
            ].map(([label, value]) => (
              <div key={label} className="card metric-card" style={{ cursor: 'pointer' }} title="Click to edit"
                onClick={() => onEdit(customer)}>
                <div className="label">{label}</div>
                <div className="value" style={{ fontSize: 16, ...(value ? null : { color: 'var(--text-muted)', fontWeight: 400 }) }}>
                  {value || '+ add'}
                </div>
              </div>
            ))}
          </div>

          <div className="card-grid" style={{ marginBottom: 16 }}>
            <div className="card metric-card">
              <div className="label">Total Purchased (Credit)</div>
              <div className="value">{money(profile.total_purchased)}</div>
            </div>
            <div className="card metric-card">
              <div className="label">Outstanding Receivables (Debit)</div>
              <div className="value" style={profile.outstanding_receivables > 0 ? { color: 'var(--danger)' } : undefined}>{money(profile.outstanding_receivables)}</div>
            </div>
            {summary && (
              <>
                <div className="card metric-card">
                  <div className="label">Receipts</div>
                  <div className="value">{summary.receipt_count}</div>
                </div>
                <div className="card metric-card">
                  <div className="label">Average Receipt</div>
                  <div className="value">{money(summary.average_receipt)}</div>
                </div>
                <div className="card metric-card">
                  <div className="label">Last Purchase</div>
                  <div className="value" style={{ fontSize: 18 }}>{daysAgo(summary.last_purchase)}</div>
                </div>
              </>
            )}
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
              {summary && summary.top_items.length > 0 && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <h3 style={{ marginTop: 0, marginBottom: 8 }}>What they buy most</h3>
                  {summary.top_items.map((t) => (
                    <div key={t.item_name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontWeight: 600 }}>{t.item_name} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: 12 }}>× {t.quantity.toLocaleString()}</span></span>
                      <span>{money(t.total)}</span>
                    </div>
                  ))}
                  {summary.first_purchase && (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                      Customer since {new Date(summary.first_purchase).toLocaleDateString()}
                    </div>
                  )}
                </div>
              )}
              <IncomeChart series={profile.income_last_6_months} />
              <div style={{ fontWeight: 700, textAlign: 'right' }}>
                Total Income (Last 6 Months) — {money(profile.total_income_last_6_months)}
              </div>
            </>
          )}

          {tab === 'Receipts' && (
            <div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <SearchBar value={receiptQuery} onChange={setReceiptQuery} placeholder="Search receipt #, item, payment…" />
                </div>
                <button className="btn btn-outline" onClick={exportReceipts} disabled={receipts.length === 0}>⬇ Export CSV</button>
              </div>
              {visibleReceipts.length === 0 ? (
                <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                  {receiptQuery ? 'No receipts match your search.' : 'No POS receipts for this customer yet.'}
                </div>
              ) : visibleReceipts.map((r) => (
                <div key={r.receipt_no} className="card" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, cursor: 'pointer' }}
                    onClick={() => setExpanded((p) => ({ ...p, [r.receipt_no]: !p[r.receipt_no] }))}>
                    <span style={{ color: 'var(--accent)', fontWeight: 800, width: 14 }}>{expanded[r.receipt_no] ? '−' : '+'}</span>
                    <span className="cheque-number">{r.receipt_no}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{new Date(r.created_at).toLocaleDateString()}</span>
                    <span className={`badge badge-${r.is_credit ? 'credit' : 'cash'}`}>{r.payment_method}</span>
                    <div style={{ flex: 1 }} />
                    <strong>{money(r.total)}</strong>
                  </div>
                  {expanded[r.receipt_no] && (
                    <div style={{ marginTop: 10 }}>
                      <div className="responsive-table" style={{ overflowX: 'auto' }}>
                        <table className="pl-table">
                          <thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                          <tbody>
                            {r.lines.map((l) => (
                              <tr key={l.sale_id}>
                                <td data-label="Item">{l.item_name}</td>
                                <td data-label="Qty">{l.quantity}</td>
                                <td data-label="Unit price">{money(l.unit_price)}</td>
                                <td data-label="Total" style={{ textAlign: 'right' }}>{money(l.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                        {r.sold_by && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sold by {r.sold_by}</span>}
                        <div style={{ flex: 1 }} />
                        <button className="btn btn-outline" onClick={() => printReceipt(r)}>🖨 Print</button>
                        {canManage && <button className="btn btn-gold" onClick={() => setEditingReceipt(r)}>✎ Edit receipt</button>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!canManage && receipts.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Only admins and managers can edit receipts.</div>
              )}
            </div>
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
                  <button className="btn btn-outline" onClick={() => setPrintStatement(true)}>
                    🖨 Print Statement
                  </button>
                </div>
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

      {printingReceipt && (
        <ThermalReceipt receipt={printingReceipt} company={account} onClose={() => setPrintingReceipt(null)} />
      )}

      {editingReceipt && (
        <ReceiptEditor
          receipt={editingReceipt}
          customerNames={customers.map((c) => c.name)}
          onClose={() => setEditingReceipt(null)}
          onSaved={receiptSaved}
        />
      )}

      {showMerge && (
        <Modal title={`Merge a duplicate into ${customer.name}`} onClose={() => setShowMerge(false)} isDirty={!!mergeSourceId}
          footer={<>
            <button className="btn btn-outline" onClick={() => setShowMerge(false)}>Cancel</button>
            <button className="btn btn-gold" onClick={doMerge} disabled={!mergeSourceId || merging}>
              {merging ? 'Merging…' : 'Merge customers'}
            </button>
          </>}>
          <p style={{ marginTop: 0 }}>
            Pick the duplicate (e.g. a misspelled name). All of its receipts, invoices, quotations and debts move to
            <strong> {customer.name}</strong>, missing contact details are copied across, and the duplicate record is removed.
            This can’t be undone.
          </p>
          <div className="form-row">
            <label>Duplicate to merge in</label>
            <select value={mergeSourceId} onChange={(e) => setMergeSourceId(e.target.value)}>
              <option value="">Select a customer…</option>
              {customers.filter((c) => c.id !== customer.id).map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>
              ))}
            </select>
          </div>
          {mergeError && <div className="error-text">{mergeError}</div>}
        </Modal>
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
  const [refreshKey, setRefreshKey] = useState(0) // bumped after receipt edits / merges so the detail pane reloads
  const [owingOnly, setOwingOnly] = useState(false)

  const load = (keepSelection = true) => api.get('/customers/').then((rows) => {
    setCustomers(rows)
    // Keep the detail pane in sync with any updated totals after a reload,
    // instead of silently going stale while a customer stays "selected".
    if (keepSelection) {
      setSelected((prev) => prev ? rows.find((r) => r.id === prev.id) || null : null)
    }
  }).catch((e) => setError(e.message))

  useEffect(() => { load(false) }, []) // eslint-disable-line

  const { query, setQuery, filtered: searched } = useSearch(customers, ['name'])
  const filteredCustomers = owingOnly ? searched.filter((c) => c.total_owed > 0) : searched
  const owingCount = customers.filter((c) => c.total_owed > 0).length
  const editingOriginal = editingId ? customers.find((c) => c.id === editingId) : null
  const renaming = !!editingOriginal && form.name.trim() !== '' && form.name.trim() !== editingOriginal.name

  const onChanged = () => { load(); setRefreshKey((k) => k + 1) }

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
      onChanged()
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
          {owingCount > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={owingOnly} onChange={(e) => setOwingOnly(e.target.checked)} />
              Owing money only ({owingCount})
            </label>
          )}
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
                    <span className="customers-list-sub" style={c.total_owed > 0 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
                      {c.total_owed > 0 ? `Owes ${money(c.total_owed)}` : money(c.total_purchased)}
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
              customers={customers}
              refreshKey={refreshKey}
              onBack={() => setSelected(null)}
              onEdit={openEdit}
              onDelete={setDeleting}
              onChanged={onChanged}
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
          wide={true}
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
              {renaming && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                  Their past receipts, invoices, quotations and debts will be moved to the new name.
                </div>
              )}
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
