import { useEffect, useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useDraft } from '../hooks/useDraft.js'
import DraftBanner from '../components/DraftBanner.jsx'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import { useSearch } from '../hooks/useSearch.js'
import ReconciliationStatement from '../components/ReconciliationStatement.jsx'
import AccountStatement from '../components/AccountStatement.jsx'
import PaymentFields, { emptyPayment, paymentBody } from '../components/PaymentFields.jsx'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

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

export default function Creditors() {
  const api = useApi()
  const { user, account } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [creditors, setCreditors] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  // Autosave the open form to this device so a logout/restart/refresh can't wipe it.
  const draft = useDraft(open ? `creditors:${editingId ?? 'new'}` : null, form, setForm, {
    isEmpty: (f) => !f.name.trim() && !f.note.trim() && !(Number(f.total_owed) > 0) && f.items.every((l) => !l.description.trim()),
  })
  const [lockTotal, setLockTotal] = useState(true)

  const [payTarget, setPayTarget] = useState(null)
  const [payment, setPayment] = useState(emptyPayment())
  const [statementTarget, setStatementTarget] = useState(null)
  const [reconcileTarget, setReconcileTarget] = useState(null)

  const load = () => {
    setListLoading(true)
    api.get('/ledgers/creditors').then(setCreditors).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }

  useEffect(() => {
    load()
    api.get('/inventory/').then(setInventoryItems).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const itemsTotal = useMemo(() => {
    return form.items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unit_price) || 0), 0)
  }, [form.items])

  useEffect(() => {
    if (lockTotal && itemsTotal > 0) {
      setForm((f) => ({ ...f, total_owed: itemsTotal }))
    }
  }, [itemsTotal, lockTotal])

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setLockTotal(true); setError(''); setOpen(true) }
  const openEdit = (c) => {
    setEditingId(c.id)
    setForm({
      name: c.name, phone: c.phone || '', tin_number: c.tin_number || '', total_owed: c.total_owed, note: c.note || '', adjustment_reason: c.adjustment_reason || '',
      created_at: c.created_at,
      items: (c.items || []).map((it) => ({
        item_id: it.item_id, description: it.description, quantity: it.quantity, unit_price: it.unit_price,
      })),
    })
    setLockTotal(c.items?.length > 0)
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
        unit_price: inv.cost_price ?? items[idx].unit_price,
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
      if (editingId) await api.put(`/ledgers/creditors/${editingId}`, payload)
      else await api.post('/ledgers/creditors', payload)
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
      await api.post(`/ledgers/creditors/pay/${payTarget.id}`, paymentBody(payment))
      setPayTarget(null)
      setPayment(emptyPayment())
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (c) => {
    if (!confirm(`Delete creditor "${c.name}"? This cannot be undone.`)) return
    try {
      await api.del(`/ledgers/creditors/${c.id}`)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const columns = [
    { key: 'name', header: 'Supplier', render: (r) => <strong>{r.name}</strong> },
    { key: 'items', header: 'Items', render: (r) => itemsSummary(r.items) },
    { key: 'total_owed', header: 'Owed', render: (r) => money(r.total_owed) },
    { key: 'amount_paid', header: 'Paid', render: (r) => money(r.amount_paid) },
    { key: 'balance', header: 'Balance', render: (r) => money(r.total_owed - r.amount_paid) },
    { key: 'status', header: 'Status', render: (r) => statusBadge(r.status) },
    { key: 'phone', header: 'Phone' },
    { key: 'created_at', header: 'Date Added', render: (r) => new Date(r.created_at).toLocaleString() },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (r) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => openEdit(r) },
          {
            label: 'Record Payment',
            onClick: () => { setPayTarget(r); setPayment({ ...emptyPayment(), amount: r.total_owed - r.amount_paid }) },
            hidden: r.status === 'paid',
          },
          { label: 'Account Statement', onClick: () => setStatementTarget(r) },
          { label: 'Reconcile Account', onClick: () => setReconcileTarget({ phone: r.phone || '', tin_number: r.tin_number || '' }) },
          { label: 'Delete', onClick: () => remove(r), danger: true, hidden: !isAdmin },
        ]} />
      ),
    },
  ]

  const { query, setQuery, filtered } = useSearch(creditors, [
    'name', 'phone',
    (r) => new Date(r.created_at).toLocaleDateString(),
  ])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Creditors Ledger</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setReconcileTarget({})}>Reconcile Account</button>
          <button className="btn btn-primary" onClick={openNew}>+ Add Creditor</button>
        </div>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by name or phone…" />
      </div>
      <Table columns={columns} rows={filtered} loading={listLoading} loadingText="Loading creditors…"
             emptyText={query ? 'No creditors match your search.' : 'No creditors recorded yet.'} onRowClick={openEdit} />

      {open && (
        <Modal
          title={editingId ? `Edit Creditor — ${form.name || ''}` : 'Add Creditor'}
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
          <div className="debtor-section-label">Creditor Details</div>
          <div className="debtor-form-grid">
            <div className="form-row"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Supplier or company name" /></div>
            <div className="form-row"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +255 7XX XXX XXX" /></div>
            <div className="form-row"><label>TIN</label><input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} placeholder="Optional — used to reconcile with debtor records" /></div>

            <div className="form-row">
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                Total Owed
                <span style={{ fontSize: 10, cursor: 'pointer', color: lockTotal ? 'var(--accent)' : 'var(--text-muted)' }} onClick={() => setLockTotal(!lockTotal)}>
                  {lockTotal ? '🔒 Auto' : '🔓 Manual'}
                </span>
              </label>
              <input type="number" value={form.total_owed} onChange={(e) => { setForm({ ...form, total_owed: Number(e.target.value) }); setLockTotal(false) }} disabled={lockTotal && itemsTotal > 0} />
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

          <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 8 }}>
            Items listed here are added to your inventory at this price and recorded as a purchase from this supplier. Editing them later adjusts stock to match.
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
            <button className="btn btn-primary" onClick={recordPayment}>Save</button>
          </>)}
        >
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 10 }}>
            Outstanding balance: {money(payTarget.total_owed - payTarget.amount_paid)}
          </div>
          <div className="form-row"><label>Amount Paid</label><input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></div>
          <PaymentFields value={payment} onChange={setPayment} />
        </Modal>
      )}

      {statementTarget && (
        <AccountStatement partyType="creditor" partyId={statementTarget.id} company={account} onClose={() => setStatementTarget(null)} />
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
