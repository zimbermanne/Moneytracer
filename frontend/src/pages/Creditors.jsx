import { useEffect, useState, useMemo } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useDraft } from '../hooks/useDraft.js'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import CreditorEditor from '../components/CreditorEditor.jsx'
import ReconciliationStatement from '../components/ReconciliationStatement.jsx'
import { useSearch } from '../hooks/useSearch.js'
import { apiUrl } from '../api-config.js'
import { downloadFile } from '../utils/download.js'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

const emptyForm = () => ({ name: '', phone: '', tin_number: '', total_owed: 0, note: '', items: [] })
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

function CreditorDetail({ creditor, onBack, onEdit, onDelete, onPay, onReconcile, downloadCreditNote, isAdmin }) {
  return (
    <div className="customers-detail-pane">
      <div className="customer-detail-header">
        <button className="btn btn-outline customer-back-btn" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0, flex: 1 }}>{creditor.name}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
           <button className="btn btn-primary btn-sm" onClick={() => onPay(creditor)} disabled={creditor.status === 'paid'}>Record Payment</button>
           <button className="btn btn-outline btn-sm" onClick={() => onEdit(creditor)}>✎ Edit</button>
           {isAdmin && <button className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => onDelete(creditor)}>🗑 Delete</button>}
        </div>
      </div>

      <div className="debtor-summary-card" style={{ marginBottom: 16 }}>
        <div className="debtor-summary-item">
          <span className="label">Owed</span>
          <span className="value">{money(creditor.total_owed)}</span>
        </div>
        <div className="debtor-summary-item">
          <span className="label">Paid</span>
          <span className="value">{money(creditor.amount_paid)}</span>
        </div>
        <div className="debtor-summary-item">
          <span className="label">Balance</span>
          <span className="value balance">{money(creditor.total_owed - creditor.amount_paid)}</span>
        </div>
        <div className="debtor-summary-item">
          <span className="label">Status</span>
          <span className="value">{statusBadge(creditor.status)}</span>
        </div>
      </div>

      <div className="card-grid" style={{ marginBottom: 16 }}>
        <div className="card metric-card">
          <div className="label">Phone</div>
          <div className="value" style={{ fontSize: 15 }}>{creditor.phone || '—'}</div>
        </div>
        <div className="card metric-card">
          <div className="label">TIN</div>
          <div className="value" style={{ fontSize: 15 }}>{creditor.tin_number || '—'}</div>
        </div>
        <div className="card metric-card">
          <div className="label">Added</div>
          <div className="value" style={{ fontSize: 15 }}>{new Date(creditor.created_at).toLocaleDateString()}</div>
        </div>
      </div>

      {creditor.note && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="label" style={{ marginBottom: 4, fontSize: 11, textTransform: 'uppercase', color: 'var(--text-faint)' }}>Notes</div>
          <div style={{ fontSize: 14 }}>{creditor.note}</div>
        </div>
      )}

      <div style={{ marginBottom: 16 }}>
        <div className="label" style={{ marginBottom: 8, fontWeight: 700 }}>Items Bought on Credit</div>
        <Table
          columns={[
            { key: 'description', header: 'Item' },
            { key: 'quantity', header: 'Qty' },
            { key: 'unit_price', header: 'Unit Price', render: (r) => money(r.unit_price) },
            { key: 'total', header: 'Total', render: (r) => money(r.quantity * r.unit_price) },
          ]}
          rows={creditor.items || []}
          emptyText="No line items recorded for this creditor."
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
        <button className="btn btn-outline" onClick={() => downloadCreditNote(creditor)}>⬇ Credit Note (PDF)</button>
        <button className="btn btn-outline" onClick={() => onReconcile(creditor)}>🤝 Reconcile Account</button>
      </div>
    </div>
  )
}

export default function Creditors() {
  const api = useApi()
  const { user, account } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [creditors, setCreditors] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const draft = useDraft(open ? `creditors:${editingId ?? 'new'}` : null, form, setForm, {
    isEmpty: (f) => !f.name.trim() && !f.note.trim() && !(Number(f.total_owed) > 0) && f.items.every((l) => !l.description.trim()),
  })
  const [lockTotal, setLockTotal] = useState(true)

  const [payTarget, setPayTarget] = useState(null)
  const [payAmount, setPayAmount] = useState(0)
  const [reconcileTarget, setReconcileTarget] = useState(null)

  const load = (keepSelection = true) => {
    setListLoading(true)
    api.get('/ledgers/creditors').then(rows => {
      setCreditors(rows)
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
      setForm((f) => ({ ...f, total_owed: itemsTotal }))
    }
  }, [itemsTotal, lockTotal])

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setLockTotal(true); setError(''); setOpen(true) }
  const openEdit = (c) => {
    setEditingId(c.id)
    setForm({
      name: c.name, phone: c.phone || '', tin_number: c.tin_number || '', total_owed: c.total_owed, note: c.note || '',
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
  const moveLine = (idx, dir) => setForm((f) => {
    const items = [...f.items]
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= items.length) return f
    const temp = items[idx]
    items[idx] = items[targetIdx]
    items[targetIdx] = temp
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
      await api.post(`/ledgers/creditors/pay/${payTarget.id}`, { amount: Number(payAmount) })
      setPayTarget(null)
      setPayAmount(0)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (c) => {
    if (!confirm(`Delete creditor "${c.name}"? This cannot be undone.`)) return
    try {
      await api.del(`/ledgers/creditors/${c.id}`)
      load(false)
      if (selected?.id === c.id) setSelected(null)
    } catch (e) {
      alert(e.message)
    }
  }

  const downloadCreditNote = (c) => {
    downloadFile(apiUrl(`/api/ledgers/creditors/${c.id}/credit-note/pdf`), `CreditNote-${c.name.replace(/\s+/g, '-')}.pdf`)
  }

  const columns = [
    { key: 'name', header: 'Supplier', render: (r) => <strong>{r.name}</strong> },
    { key: 'items', header: 'Items', render: (r) => itemsSummary(r.items) },
    { key: 'total_owed', header: 'Owed', render: (r) => money(r.total_owed) },
    { key: 'amount_paid', header: 'Paid', render: (r) => money(r.amount_paid) },
    { key: 'balance', header: 'Balance', render: (r) => money(r.total_owed - r.amount_paid) },
    { key: 'status', header: 'Status', render: (r) => statusBadge(r.status) },
    { key: 'phone', header: 'Phone' },
    { key: 'created_at', header: 'Date Added', render: (r) => new Date(r.created_at).toLocaleDateString() },
    {
      key: 'actions', header: '', stopRowClick: true,
      render: (r) => (
        <RowActionsMenu items={[
          { label: 'Edit', onClick: () => openEdit(r) },
          {
            label: 'Record Payment',
            onClick: () => { setPayTarget(r); setPayAmount(r.total_owed - r.amount_paid) },
            hidden: r.status === 'paid',
          },
          { label: 'Download Credit Note (PDF)', onClick: () => downloadCreditNote(r) },
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

      <div className={`customers-split${selected ? ' has-selection' : ''}`}>
        <div className="customers-list-pane">
          <div style={{ marginBottom: 10 }}>
            <SearchBar value={query} onChange={setQuery} placeholder="Search creditors by name or phone…" />
          </div>
          <Table
            columns={columns}
            rows={filtered}
            loading={listLoading}
            loadingText="Loading creditors…"
            emptyText={query ? 'No creditors match your search.' : 'No creditors recorded yet.'}
            onRowClick={(r) => setSelected(r)}
          />
        </div>

        {selected && (
          <div className="customers-detail-pane" style={{ padding: 0, background: 'none', border: 'none', boxShadow: 'none' }}>
            <CreditorDetail
              creditor={selected}
              isAdmin={isAdmin}
              onBack={() => setSelected(null)}
              onEdit={openEdit}
              onDelete={remove}
              onPay={(c) => { setPayTarget(c); setPayAmount(c.total_owed - c.amount_paid) }}
              onReconcile={(c) => setReconcileTarget({ phone: c.phone || '', tin_number: c.tin_number || '' })}
              downloadCreditNote={downloadCreditNote}
            />
          </div>
        )}
      </div>

      {open && (
        <CreditorEditor
          editingId={editingId}
          form={form}
          setForm={setForm}
          company={account}
          error={error}
          updateLine={updateLine}
          addLine={addLine}
          removeLine={removeLine}
          moveLine={moveLine}
          itemsTotal={itemsTotal}
          lockTotal={lockTotal}
          setLockTotal={setLockTotal}
          onClose={() => { draft.clear(); setOpen(false) }}
          onSave={save}
          saving={saving}
          inventoryItems={inventoryItems}
          selectInventoryItem={selectInventoryItem}
        />
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
          <div className="form-row"><label>Amount Paid</label><input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
        </Modal>
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
