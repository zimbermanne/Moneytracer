import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import { useSearch } from '../hooks/useSearch.js'
import ReconciliationStatement from '../components/ReconciliationStatement.jsx'
import CreditorEditor from '../components/CreditorEditor.jsx'

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
  const [editingPaid, setEditingPaid] = useState(0)

  const [payTarget, setPayTarget] = useState(null)
  const [payAmount, setPayAmount] = useState(0)
  const [reconcileTarget, setReconcileTarget] = useState(null)

  const load = () => {
    setListLoading(true)
    api.get('/ledgers/creditors').then(setCreditors).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }

  useEffect(() => {
    load()
    api.get('/inventory/').then(setInventoryItems).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditingId(null); setEditingPaid(0); setForm(emptyForm()); setError(''); setOpen(true) }
  const openEdit = (c) => {
    setEditingId(c.id)
    setEditingPaid(c.amount_paid || 0)
    setForm({
      name: c.name, phone: c.phone || '', tin_number: c.tin_number || '', total_owed: c.total_owed, note: c.note || '',
      created_at: c.created_at,
      items: (c.items || []).map((it) => ({
        item_id: it.item_id, description: it.description, quantity: it.quantity, unit_price: it.unit_price,
      })),
    })
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
    const j = idx + dir
    if (j < 0 || j >= f.items.length) return f
    const items = [...f.items]
    ;[items[idx], items[j]] = [items[j], items[idx]]
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
            onClick: () => { setPayTarget(r); setPayAmount(0) },
            hidden: r.status === 'paid',
          },
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
        <CreditorEditor
          editingId={editingId}
          form={form}
          setForm={setForm}
          company={account}
          error={error}
          saving={saving}
          updateLine={updateLine}
          addLine={addLine}
          removeLine={removeLine}
          moveLine={moveLine}
          inventoryItems={inventoryItems}
          selectInventoryItem={selectInventoryItem}
          amountPaid={editingPaid}
          onClose={() => setOpen(false)}
          onSave={save}
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
