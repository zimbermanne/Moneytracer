import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import Table from '../components/Table.jsx'
import Modal from '../components/Modal.jsx'
import SearchBar from '../components/SearchBar.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import DebtorStatement from '../components/DebtorStatement.jsx'
import ReconciliationStatement from '../components/ReconciliationStatement.jsx'
import { useSearch } from '../hooks/useSearch.js'
import { apiUrl } from '../api-config.js'
import { downloadFile, openPdfForPrint } from '../utils/download.js'

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

export default function Debtors() {
  const api = useApi()
  const { user, account } = useAuth()
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin'

  const [debtors, setDebtors] = useState([])
  const [inventoryItems, setInventoryItems] = useState([])
  const [error, setError] = useState('')
  const [listLoading, setListLoading] = useState(true)

  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)

  const [payTarget, setPayTarget] = useState(null)
  const [payAmount, setPayAmount] = useState(0)
  const [printTarget, setPrintTarget] = useState(null)
  const [reconcileTarget, setReconcileTarget] = useState(null)

  const load = () => {
    setListLoading(true)
    api.get('/ledgers/debtors').then(setDebtors).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }

  useEffect(() => {
    load()
    api.get('/inventory/').then(setInventoryItems).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openNew = () => { setEditingId(null); setForm(emptyForm()); setError(''); setOpen(true) }
  const openEdit = (d) => {
    setEditingId(d.id)
    setForm({
      name: d.name, phone: d.phone || '', tin_number: d.tin_number || '', total_owed: d.total_owed, note: d.note || '',
      created_at: d.created_at,
      items: (d.items || []).map((it) => ({
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
        items: form.items
          .filter((l) => l.description.trim())
          .map((l) => ({ item_id: l.item_id, description: l.description, quantity: Number(l.quantity) || 1, unit_price: Number(l.unit_price) || 0 })),
      }
      if (editingId) await api.put(`/ledgers/debtors/${editingId}`, payload)
      else await api.post('/ledgers/debtors', payload)
      setOpen(false); setEditingId(null); setForm(emptyForm()); load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const recordPayment = async () => {
    try {
      await api.post(`/ledgers/debtors/pay/${payTarget.id}`, { amount: Number(payAmount) })
      setPayTarget(null)
      setPayAmount(0)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  const remove = async (d) => {
    if (!confirm(`Delete debtor "${d.name}"? This cannot be undone.`)) return
    try {
      await api.del(`/ledgers/debtors/${d.id}`)
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  const [pdfBusyId, setPdfBusyId] = useState(null)

  const downloadDebitNote = (d) => {
    downloadFile(apiUrl(`/api/ledgers/debtors/${d.id}/debit-note/pdf`), `DebitNote-${d.name.replace(/\s+/g, '-')}.pdf`)
  }

  const printDebitNote = (d) => {
    openPdfForPrint(apiUrl(`/api/ledgers/debtors/${d.id}/debit-note/pdf`))
  }

  const columns = [
    { key: 'name', header: 'Client', render: (r) => <strong>{r.name}</strong> },
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
          { label: 'Print Debit Note', onClick: () => printDebitNote(r), disabled: pdfBusyId === r.id },
          { label: 'Download Debit Note (PDF)', onClick: () => downloadDebitNote(r), disabled: pdfBusyId === r.id },
          { label: 'Print Thermal Statement', onClick: () => setPrintTarget(r) },
          { label: 'Reconcile Account', onClick: () => setReconcileTarget({ phone: r.phone || '', tin_number: r.tin_number || '' }) },
          { label: 'Delete', onClick: () => remove(r), danger: true, hidden: !isAdmin },
        ]} />
      ),
    },
  ]

  const { query, setQuery, filtered } = useSearch(debtors, [
    'name', 'phone',
    (r) => new Date(r.created_at).toLocaleDateString(),
  ])

  return (
    <div className="page">
      <div className="page-header">
        <h1>Debtors</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setReconcileTarget({})}>Reconcile Account</button>
          <button className="btn btn-primary" onClick={openNew}>+ Add Debtor</button>
        </div>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by name or phone…" />
      </div>
      <Table columns={columns} rows={filtered} loading={listLoading} loadingText="Loading debtors…"
             emptyText={query ? 'No debtors match your search.' : 'No debtors recorded yet.'} onRowClick={openEdit} />

      {open && (
        <Modal
          title={editingId ? `Edit Debtor — ${form.name || ''}` : 'Add Debtor'}
          onClose={() => setOpen(false)}
          footer={(<>
            {editingId && (
              <button
                className="btn btn-outline"
                style={{ marginInlineEnd: 'auto' }}
                onClick={() => downloadDebitNote({ id: editingId, name: form.name })}
                disabled={pdfBusyId === editingId}
              >
                {pdfBusyId === editingId ? 'Preparing…' : '⬇ Debit Note (PDF)'}
              </button>
            )}
            {editingId && (
              <button
                className="btn btn-outline"
                onClick={() => setPrintTarget(debtors.find((d) => d.id === editingId))}
              >
                🖨 Thermal Statement
              </button>
            )}
            <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save'}
            </button>
          </>)}
        >
          {editingId && (
            <div className="debtor-summary-card">
              <div className="debtor-summary-item">
                <span className="label">Total Owed</span>
                <span className="value">{money(form.total_owed)}</span>
              </div>
              <div className="debtor-summary-item">
                <span className="label">Status</span>
                <span className="value">{statusBadge(debtors.find((d) => d.id === editingId)?.status)}</span>
              </div>
              <div className="debtor-summary-item">
                <span className="label">Balance</span>
                <span className="value balance">
                  {money(form.total_owed - (debtors.find((d) => d.id === editingId)?.amount_paid || 0))}
                </span>
              </div>
            </div>
          )}

          <div className="debtor-section-label">Debtor Details</div>
          <div className="debtor-form-grid">
            <div className="form-row"><label>Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Client or company name" /></div>
            <div className="form-row"><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="e.g. +255 7XX XXX XXX" /></div>
            <div className="form-row"><label>TIN</label><input value={form.tin_number} onChange={(e) => setForm({ ...form, tin_number: e.target.value })} placeholder="Optional — used to reconcile with creditor records" /></div>
            <div className="form-row"><label>Total Owed</label><input type="number" value={form.total_owed} onChange={(e) => setForm({ ...form, total_owed: Number(e.target.value) })} /></div>
            {editingId && (
              <div className="form-row">
                <label>Date Added</label>
                <input value={new Date(form.created_at).toLocaleString()} disabled />
              </div>
            )}
            <div className="form-row span-2"><label>Note</label><input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Optional note about this debt" /></div>
          </div>

          <div className="debtor-section-label">Items (optional — what was bought on credit)</div>
          {form.items.map((line, idx) => {
            const isCustom = !line.item_id
            return (
              <div key={idx} className="invoice-editor-line">
                <div className="invoice-line-item-picker">
                  <select
                    className="invoice-line-item-select"
                    value={line.item_id ?? ''}
                    onChange={(e) => selectInventoryItem(idx, e.target.value)}
                  >
                    <option value="">— Custom item (not in inventory) —</option>
                    {inventoryItems.map((it) => (
                      <option key={it.id} value={it.id}>{it.name} ({it.quantity} in stock)</option>
                    ))}
                  </select>
                  {isCustom && (
                    <input placeholder="Describe the item" value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                  )}
                </div>
                <input type="number" placeholder="Qty" value={line.quantity}
                  onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))} />
                <input type="number" placeholder="Unit Price" value={line.unit_price}
                  onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))} />
                <span className="invoice-editor-line-total">{money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</span>
                <button className="btn btn-danger" onClick={() => removeLine(idx)} aria-label="Remove line">✕</button>
              </div>
            )
          })}
          <button className="btn btn-outline" style={{ marginTop: 8 }} onClick={addLine}>+ Add Line</button>
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
          <div className="form-row"><label>Amount Paid</label><input type="number" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} /></div>
        </Modal>
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
