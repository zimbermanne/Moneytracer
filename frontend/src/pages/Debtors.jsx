import { useEffect, useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useDraft } from '../hooks/useDraft.js'
import DraftBanner from '../components/DraftBanner.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import DebtorStatement from '../components/DebtorStatement.jsx'
import ReconciliationStatement from '../components/ReconciliationStatement.jsx'
import AccountStatement from '../components/AccountStatement.jsx'
import PaymentFields, { emptyPayment, paymentBody } from '../components/PaymentFields.jsx'
import { useSearch } from '../hooks/useSearch.js'
import { apiUrl } from '../api-config.js'
import { downloadFile, openPdfForPrint } from '../utils/download.js'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString()}`
}

const emptyForm = () => ({ name: '', phone: '', tin_number: '', total_owed: 0, note: '', adjustment_reason: '', items: [] })
const emptyLine = () => ({ item_id: null, description: '', quantity: 1, unit_price: 0 })

function statusBadge(status) {
  if (status === 'paid') return <span className="badge badge-paid">Paid</span>
  if (status === 'partial') return <span className="badge badge-partial">Partial</span>
  return <span className="badge badge-unpaid">Unpaid</span>
}

function itemsSummary(items) {
  if (!items || items.length === 0) return <span style={{ color: 'var(--text-faint)' }}>—</span>
  const text = items.map((it) => it.quantity > 1 ? `${it.description} ×${it.quantity}` : it.description).join(', ')
  return <span title={text}>{text.length > 40 ? text.slice(0, 40) + '…' : text}</span>
}

function DebtorDetail({ debtor, onBack, onEdit, onDelete, onPay, onStatement, onPrint, onReconcile, downloadDebitNote, isAdmin }) {
  return (
    <div className="customers-detail-pane">
      <div className="customer-detail-header">
        <button className="btn btn-outline customer-back-btn" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0, flex: 1 }}>{debtor.name}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
           <button className="btn btn-primary btn-sm" onClick={() => onPay(debtor)} disabled={debtor.status === 'paid'}>Record Payment</button>
           <button className="btn btn-outline btn-sm" onClick={() => onEdit(debtor)}>✎ Edit</button>
           {isAdmin && <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => onDelete(debtor)}>🗑 Delete</button>}
        </div>
      </div>

      <div className="debtor-summary-card" style={{ marginBottom: 16 }}>
        <div className="debtor-summary-item">
          <span className="label">Owed</span>
          <span className="value">{money(debtor.total_owed)}</span>
        </div>
        <div className="debtor-summary-item">
          <span className="label">Paid</span>
          <span className="value">{money(debtor.amount_paid)}</span>
        </div>
        <div className="debtor-summary-item">
          <span className="label">Balance</span>
          <span className="value balance">{money(debtor.total_owed - debtor.amount_paid)}</span>
        </div>
        <div className="debtor-summary-item">
          <span className="label">Status</span>
          <span className="value">{statusBadge(debtor.status)}</span>
        </div>
      </div>

      <div className="card-grid" style={{ marginBottom: 16 }}>
        <div className="card metric-card">
          <div className="label">Phone</div>
          <div className="value" style={{ fontSize: 15 }}>{debtor.phone || '—'}</div>
        </div>
        <div className="card metric-card">
          <div className="label">TIN</div>
          <div className="value" style={{ fontSize: 15 }}>{debtor.tin_number || '—'}</div>
        </div>
        <div className="card metric-card">
          <div className="label">Added</div>
          <div className="value" style={{ fontSize: 15 }}>{new Date(debtor.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      {debtor.note && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 4, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-faint)' }}>Notes</div>
          <div style={{ fontSize: 14 }}>{debtor.note}</div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 8, fontWeight: 700 }}>Items</div>
        <Table
          columns={[
            { key: 'description', header: 'Item' },
            { key: 'quantity', header: 'Qty' },
            { key: 'unit_price', header: 'Price', render: (r) => money(r.unit_price) },
            { key: 'total', header: 'Total', render: (r) => money(r.quantity * r.unit_price) },
          ]}
          rows={debtor.items || []}
          emptyText="No line items recorded for this debt."
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
        <button className="btn btn-primary" onClick={() => onStatement(debtor)}>📄 Account Statement</button>
        <button className="btn btn-outline" onClick={() => onPrint(debtor)}>🖨 Thermal Statement</button>
        <button className="btn btn-outline" onClick={() => downloadDebitNote(debtor)}>⬇ Debit Note (PDF)</button>
        <button className="btn btn-outline" onClick={() => onReconcile(debtor)}>🤝 Reconcile Account</button>
      </div>
    </div>
  )
}

export default function Debtors() {
  const api = useApi()
  const { user, account } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [debtors, setDebtors] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  // Autosave the open form to this device so a logout/restart/refresh can't wipe it.
  const draft = useDraft(open ? `debtors:${editingId ?? 'new'}` : null, form, setForm, {
    isEmpty: (f) => !f.name.trim() && !f.note.trim() && !(Number(f.total_owed) > 0) && f.items.every((l) => !l.description.trim()),
  })
  const [lockTotal, setLockTotal] = useState(true)

  const [payTarget, setPayTarget] = useState(null)
  const [payment, setPayment] = useState(emptyPayment())
  const [statementTarget, setStatementTarget] = useState(null)
  const [printTarget, setPrintTarget] = useState(null)
  const [reconcileTarget, setReconcileTarget] = useState(null)

  const load = (keepSelection = true) => {
    setListLoading(true)
    api.get('/ledgers/debtors').then(rows => {
      setDebtors(rows)
      if (keepSelection) {
        setSelected(prev => prev ? rows.find(r => r.id === prev.id) || null : null)
      }
    }).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }

  useEffect(() => {
    load(false)
    api.get('/inventory/').then(setInventoryItems).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const itemsTotal = useMemo(() => {
    return form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0)
  }, [form.items])

  useEffect(() => {
    if (lockTotal && itemsTotal > 0) {
      setForm(f => ({ ...f, total_owed: itemsTotal }))
    }
  }, [itemsTotal, lockTotal])

  const openNew = () => {
    setEditingId(null)
    setForm(emptyForm())
    setLockTotal(true)
    setError('')
    setOpen(true)
  }
  const openEdit = (d) => {
    setEditingId(d.id)
    setForm({
      name: d.name, phone: d.phone || '', tin_number: d.tin_number || '', total_owed: d.total_owed, note: d.note || '', adjustment_reason: d.adjustment_reason || '',
      created_at: d.created_at,
      items: (d.items || []).map((it) => ({
        item_id: it.item_id, description: it.description, quantity: it.quantity, unit_price: it.unit_price,
      })),
    })
    setLockTotal(d.items?.length > 0)
    setError('')
    setOpen(true)
  }

  const addLine = () => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }))
  const removeLine = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  const updateLine = (idx, field, value) => setForm((f) => {
    const items = [...f.items]
    items[idx] = { ...items[idx], [field]: value }
    return { ...f, items }
  })
  const selectInventoryItem = (idx, itemId) => {
    if (!itemId) { updateLine(idx, 'item_id', null); return }
    const inv = inventoryItems.find((it) => String(it.id) === String(itemId))
    setForm((f) => {
      const items = [...f.items]
      items[idx] = {
        ...items[idx], item_id: inv.id, description: inv.name,
        unit_price: inv.selling_price ?? items[idx].unit_price,
      }
      return { ...f, items }
    })
  }

  const save = async () => {
    if (!form.name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    setError('')
    try {
      const payload = {
        name: form.name.trim(), phone: form.phone, tin_number: form.tin_number, total_owed: Number(form.total_owed) || 0,
        note: form.note,
        adjustment_reason: form.adjustment_reason,
        items: form.items
          .filter((l) => l.description.trim())
          .map((l) => ({ item_id: l.item_id, description: l.description, quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0 })),
      }
      if (editingId) await api.put(`/ledgers/debtors/${editingId}`, payload)
      else await api.post('/ledgers/debtors', payload)
      draft.clear()
      setOpen(false); setEditingId(null); setForm(emptyForm()); load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const recordPayment = async () => {
    try {
      await api.post(`/ledgers/debtors/pay/${payTarget.id}`, paymentBody(payment))
      setPayTarget(null)
      setPayment(emptyPayment())
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (d) => {
    if (!confirm(`Delete debtor "${d.name}"? This cannot be undone.`)) return
    try {
      await api.del(`/ledgers/debtors/${d.id}`)
      load(false)
      if (selected?.id === d.id) setSelected(null)
    } catch (e) {
      alert(e.message)
    }
  }

  const downloadDebitNote = (d) => {
    downloadFile(apiUrl(`/api/ledgers/debtors/${d.id}/debit-note/pdf`), `DebitNote-${d.name.replace(/\s+/g, '-')}.pdf`)
  }

  const { query, setQuery, filtered } = useSearch(debtors, ['name', 'phone'])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Debtors</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setReconcileTarget({})}>Reconcile Global</button>
          <button className="btn btn-primary" onClick={openNew}>+ Add Debtor</button>
        </div>
      </div>

      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}

      <div className={`customers-split${selected ? ' has-selection' : ''}`}>
        <div className="customers-list-pane">
          <div style={{ marginBottom: 10 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Search debtors…" />
          </div>
          {filtered.length === 0 ? (
            <div className="customers-list-empty">
              {query ? 'No debtors match your search.' : 'No debtors recorded yet.'}
            </div>
          ) : (
            <ul className="customers-list">
              {filtered.map((d) => (
                <li key={d.id}>
                  <button
                    className={`customers-list-item${selected?.id === d.id ? ' active' : ''}`}
                    onClick={() => setSelected(d)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                      <span className="customers-list-name">{d.name}</span>
                      {statusBadge(d.status)}
                    </div>
                    <div className="customers-list-sub" style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span>Balance: {money(d.total_owed - d.amount_paid)}</span>
                      <span>{new Date(d.created_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="customers-detail-pane" style={{ padding: 0, background: 'none', border: 'none', boxShadow: 'none' }}>
          {selected ? (
            <DebtorDetail
              debtor={selected}
              isAdmin={isAdmin}
              onBack={() => setSelected(null)}
              onEdit={openEdit}
              onDelete={remove}
              onPay={(d) => { setPayTarget(d); setPayment({ ...emptyPayment(), amount: d.total_owed - d.amount_paid }) }}
              onStatement={(d) => setStatementTarget(d)}
              onPrint={setPrintTarget}
              onReconcile={(d) => setReconcileTarget({ phone: d.phone || '', tin_number: d.tin_number || '' })}
              downloadDebitNote={downloadDebitNote}
            />
          ) : (
            <div className="customers-detail-placeholder">
              Select a debtor on the left to view their detailed history, items, and record payments.
            </div>
          )}
        </div>
      </div>

      {open && (
        <Modal
          title={editingId ? `Edit Debtor — ${form.name || ''}` : 'Add Debtor'}
          onClose={() => { draft.clear(); setOpen(false) }}
          wide={true}
          footer={(<>
            <button className="btn btn-outline" onClick={() => { draft.clear(); setOpen(false) }}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save'}
            </button>
          </>)}
        >
          <DraftBanner draft={draft} />
          <div className="debtor-section-label">Debtor Details</div>
          <div className="debtor-form-grid">
            <div className="form-row"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Client or company name" /></div>
            <div className="form-row"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +255 7XX XXX XXX" /></div>
            <div className="form-row"><label>TIN</label><input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} placeholder="Optional" /></div>

            <div className="form-row">
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                Total Owed
                <span style={{ fontSize: 10, cursor: 'pointer', color: lockTotal ? 'var(--accent)' : 'var(--text-muted)' }} onClick={() => setLockTotal(!lockTotal)}>
                  {lockTotal ? '🔒 Auto' : '🔓 Manual'}
                </span>
              </label>
              <input type="number" value={form.total_owed} onChange={(e) => { setForm({ ...form, total_owed: Number(e.target.value) }); setLockTotal(false); }} disabled={lockTotal && itemsTotal > 0} />
              {lockTotal && itemsTotal > 0 && <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 2 }}>Calculated from items</div>}
            </div>

            {itemsTotal > 0 && Math.abs((Number(form.total_owed) || 0) - itemsTotal) >= 0.5 && (
              <div className="form-row span-2">
                <label>Why is Total Owed different from the items ({money(itemsTotal)})?</label>
                <input value={form.adjustment_reason} onChange={(e) => setForm({ ...form, adjustment_reason: e.target.value })} placeholder="e.g. discount given, transport added, rounding" />
              </div>
            )}

            <div className="form-row span-2"><label>Note</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional note about this debt" /></div>
          </div>

          <div className="debtor-section-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Items (optional)</span>
            {itemsTotal > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>Subtotal: {money(itemsTotal)}</span>}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            {form.items.map((line, idx) => (
              <div key={idx} className="card" style={{ padding: 12, position: 'relative' }}>
                <button className="btn-icon" style={{ position: 'absolute', top: 8, right: 8 }} onClick={() => removeLine(idx)}>✕</button>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px', gap: 10, alignItems: 'end' }}>
                  <div className="invoice-line-item-picker" style={{ marginBottom: 0 }}>
                    <label style={{ fontSize: 11 }}>Item / Description</label>
                    <select
                      className="invoice-line-item-select"
                      value={line.item_id ?? ''}
                      onChange={(e) => selectInventoryItem(idx, e.target.value)}
                      style={{ marginBottom: line.item_id ? 0 : 6 }}
                    >
                      <option value="">— Custom item —</option>
                      {inventoryItems.map((it) => (
                        <option key={it.id} value={it.id}>{it.name} ({it.quantity} in stock)</option>
                      ))}
                    </select>
                    {!line.item_id && (
                      <input placeholder="Describe item..." value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                    )}
                  </div>
                  <div>
                    <label style={{ fontSize: 11 }}>Qty</label>
                    <input type="number" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11 }}>Price</label>
                    <input type="number" value={line.unit_price} onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))} />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={addLine}>+ Add Item Line</button>
        </Modal>
      )}

      {payTarget && (
        <Modal
          title={`Record Payment — ${payTarget.name}`}
          onClose={() => setPayTarget(null)}
          footer={(<>
            <button className="btn btn-outline" onClick={() => setPayTarget(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={recordPayment}>Save Payment</button>
          </>)}
        >
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Outstanding Balance</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--danger)', margin: '4px 0 20px' }}>
              {money(payTarget.total_owed - payTarget.amount_paid)}
            </div>
            <div className="form-row" style={{ textAlign: 'left' }}>
              <label>Amount Received</label>
              <input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} autoFocus />
            </div>
          </div>
          <PaymentFields value={payment} onChange={setPayment} />
        </Modal>
      )}

      {statementTarget && (
        <AccountStatement partyType="debtor" partyId={statementTarget.id} company={account} onClose={() => setStatementTarget(null)} />
      )}

      {printTarget && (
        <DebtorStatement
          debtor={printTarget}
          company={account}
          onClose={() => setPrintTarget(null)}
        />
      )}

      {reconcileTarget && (
        <ReconciliationStatement
          initialPhone={reconcileTarget.phone || ''}
          initialTin={reconcileTarget.tin_number || ''}
          company={account}
          onClose={() => setReconcileTarget(null)}
        />
      )}
    </div>
  )
}
