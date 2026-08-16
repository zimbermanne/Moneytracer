import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { apiUrl } from '../api-config.js'
import Table from '../components/Table.jsx'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import SearchBar from '../components/SearchBar.jsx'
import PurchaseOrderPreview from '../components/PurchaseOrderPreview.jsx'
import { useSearch } from '../hooks/useSearch.js'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString()}`

const emptyLine = () => ({ description: '', quantity: 1, unit_price: 0, item_id: null })
const emptyForm = () => ({
  supplier_name: '', supplier_phone: '', supplier_email: '', supplier_address: '',
  supplier_tin: '', supplier_vrn: '', expected_date: '',
  tax_rate: 0, discount: 0, notes: '', items: [emptyLine()],
})

export default function PurchaseOrders() {
  const api = useApi()
  const { user } = useAuth()
  const canApprove = user?.role === 'admin' || user?.role === 'superadmin' || user?.role === 'manager'

  const [docs, setDocs] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [pdfLoading, setPdfLoading] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editingPoNo, setEditingPoNo] = useState('')
  const [saving, setSaving] = useState(false)
  const [inventoryItems, setInventoryItems] = useState([])
  const [previewDoc, setPreviewDoc] = useState(null)
  const [company, setCompany] = useState(null)
  const [suppliers, setSuppliers] = useState([])

  // Received POs have real stock/ledger movements and can't be touched.
  // Approved POs are locked too — a manager signed off on these exact
  // numbers, so changing quantities/prices afterwards would silently
  // invalidate that approval. Reset to draft (via the status action) if
  // it genuinely needs edits, then re-approve.
  const isLocked = (doc) => doc.status === 'received' || doc.status === 'approved'

  const load = () => {
    setListLoading(true)
    api.get('/purchase-orders/').then(setDocs).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }
  useEffect(() => { load() }, []) // eslint-disable-line
  useEffect(() => { api.get('/inventory/').then(setInventoryItems).catch(() => {}) }, []) // eslint-disable-line
  useEffect(() => { api.get('/accounts/company-info').then(setCompany).catch(() => {}) }, []) // eslint-disable-line
  useEffect(() => { api.get('/suppliers/').then(setSuppliers).catch(() => {}) }, []) // eslint-disable-line

  // Selecting a known supplier pre-fills their contact details — the same
  // "pick from directory instead of retyping" shortcut inventory items get.
  const selectSupplier = (name) => {
    const match = suppliers.find((s) => s.name === name)
    setForm((f) => ({
      ...f,
      supplier_name: name,
      supplier_phone: match?.phone || f.supplier_phone,
      supplier_email: match?.email || f.supplier_email,
      supplier_address: match?.address || f.supplier_address,
      supplier_tin: match?.tin_number || f.supplier_tin,
      supplier_vrn: match?.vrn_number || f.supplier_vrn,
    }))
  }

  const updateLine = (idx, field, value) => {
    setForm((f) => ({ ...f, items: f.items.map((l, i) => i === idx ? { ...l, [field]: value } : l) }))
  }
  const addLine = () => setForm((f) => ({ ...f, items: [...f.items, emptyLine()] }))
  const removeLine = (idx) => setForm((f) => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))

  // Selecting an inventory item pre-fills description + cost from its
  // current cost price; choosing "Custom item" clears item_id so the line
  // is freehand — either a one-off cost, or something new you're stocking
  // for the first time (the backend will create it in inventory once this
  // PO is marked received).
  const selectInventoryItem = (idx, itemId) => {
    if (!itemId) {
      setForm((f) => ({ ...f, items: f.items.map((l, i) => i === idx ? { ...l, item_id: null } : l) }))
      return
    }
    const inv = inventoryItems.find((it) => String(it.id) === String(itemId))
    if (!inv) return
    setForm((f) => ({
      ...f,
      items: f.items.map((l, i) => i === idx
        ? { ...l, item_id: inv.id, description: inv.name, unit_price: inv.cost_price || inv.selling_price || 0 }
        : l),
    }))
  }

  const openNew = () => { setEditingId(null); setEditingPoNo(''); setForm(emptyForm()); setError(''); setOpen(true) }
  const openEdit = (doc) => {
    setEditingId(doc.id)
    setEditingPoNo(doc.po_no)
    setForm({
      supplier_name: doc.supplier_name || '', supplier_phone: doc.supplier_phone || '',
      supplier_email: doc.supplier_email || '',
      supplier_address: doc.supplier_address || '', supplier_tin: doc.supplier_tin || '',
      supplier_vrn: doc.supplier_vrn || '',
      expected_date: doc.expected_date ? doc.expected_date.slice(0, 10) : '',
      tax_rate: doc.tax_rate, discount: doc.discount, notes: doc.notes || '',
      items: doc.items.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, item_id: l.item_id ?? null })),
    })
    setError('')
    setOpen(true)
  }

  const save = async () => {
    setError('')
    setSaving(true)
    try {
      const { expected_date, ...rest } = form
      const payload = {
        ...rest,
        items: form.items.filter((l) => l.description.trim()),
        expected_date: expected_date ? new Date(expected_date).toISOString() : null,
      }
      if (!payload.items.length) { setError('Add at least one line item'); setSaving(false); return }
      if (editingId) {
        await api.put(`/purchase-orders/${editingId}`, payload)
      } else {
        await api.post('/purchase-orders/', payload)
      }
      setOpen(false); setEditingId(null); setEditingPoNo(''); setForm(emptyForm()); load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!confirm('Delete this purchase order?')) return
    try { await api.del(`/purchase-orders/${id}`); load() } catch (e) { setError(e.message) }
  }

  const approvePO = async (doc) => {
    if (!confirm(`Approve ${doc.po_no}? This authorizes the purchase but does not add stock yet — you'll still need to "Mark as Received" once the goods actually arrive.`)) return
    try {
      await api.post(`/purchase-orders/${doc.id}/approve`, {})
      load()
    } catch (e) { setError(e.message) }
  }

  const markReceived = async (doc) => {
    if (!confirm(`Mark ${doc.po_no} as received? This adds the items to inventory and records the purchase — it can't be undone.`)) return
    try {
      await api.patch(`/purchase-orders/${doc.id}/status?status=received`)
      load()
    } catch (e) { setError(e.message) }
  }

  const downloadPdf = async (doc) => {
    setPdfLoading(doc.id)
    try {
      const res = await fetch(apiUrl(`/api/purchase-orders/${doc.id}/pdf`), { credentials: 'include' })
      if (!res.ok) throw new Error('PDF generation failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `PurchaseOrder-${doc.po_no}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setError(e.message) }
    finally { setPdfLoading(null) }
  }

  const columns = [
    { key: 'no', header: 'No.', render: (r) => <span className="cheque-number">{r.po_no}</span> },
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'supplier_name', header: 'Supplier' },
    { key: 'total', header: 'Total', render: (r) => money(r.total) },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
    {
      key: 'actions', header: '',
      stopRowClick: true,
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          {isLocked(r) && (
            <span title={r.status === 'received' ? 'A received purchase order cannot be edited' : 'An approved purchase order cannot be edited — reset to draft first if changes are needed'}
                  style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              🔒 Locked
            </span>
          )}
          <RowActionsMenu items={[
            { label: 'Preview', icon: '👁', onClick: () => setPreviewDoc(r) },
            { label: 'Edit', icon: '✎', onClick: () => openEdit(r), hidden: isLocked(r) },
            { label: 'Approve', icon: '👍', onClick: () => approvePO(r), hidden: !canApprove || (r.status !== 'draft' && r.status !== 'sent') },
            { label: 'Mark as Received', icon: '✓', onClick: () => markReceived(r), hidden: r.status !== 'approved' },
            { label: pdfLoading === r.id ? 'Downloading…' : 'PDF', icon: '⬇', onClick: () => downloadPdf(r), disabled: pdfLoading === r.id },
            { label: 'Delete', icon: '✕', onClick: () => remove(r.id), danger: true, hidden: r.status === 'received' },
          ]} />
        </div>
      ),
    },
  ]

  const { query, setQuery, filtered } = useSearch(docs, [
    'supplier_name',
    'po_no',
    (r) => new Date(r.created_at).toLocaleDateString(),
  ])

  const subtotal = form.items.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0)
  const taxAmt   = subtotal * ((Number(form.tax_rate) || 0) / 100)
  const total    = subtotal + taxAmt - (Number(form.discount) || 0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>Purchase Orders</h1>
        <button className="btn btn-primary" onClick={openNew}>+ New Purchase Order</button>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by supplier, number, or date…" />
      </div>
      <Table columns={columns} rows={filtered} loading={listLoading} loadingText="Loading purchase orders…"
        emptyText={query ? 'No purchase orders match your search.' : 'No purchase orders yet.'}
        onRowClick={(row) => setPreviewDoc(row)} />

      {open && (
        <div className="invoice-editor-overlay">
          <div className="invoice-editor">
            <div className="invoice-editor-topbar">
              <div>
                <div className="doc-sheet-muted">{editingId ? 'Edit Purchase Order' : 'New Purchase Order'}</div>
                <h2 style={{ margin: 0 }}>{form.supplier_name || 'New supplier'}</h2>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
                {editingId && (
                  <>
                    <button className="btn btn-outline"
                            onClick={() => setPreviewDoc(docs.find((d) => d.id === editingId))}>
                      👁 Preview
                    </button>
                    <button className="btn btn-outline" onClick={() => downloadPdf({ id: editingId, po_no: editingPoNo })}
                            disabled={pdfLoading === editingId}>
                      {pdfLoading === editingId ? 'Downloading…' : '⬇ PDF'}
                    </button>
                  </>
                )}
                <button className="btn btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save'}
                </button>
              </div>
            </div>

            {error && <div className="error-text" style={{ padding: '0 24px' }}>{error}</div>}

            <div className="invoice-editor-body">
              <div className="invoice-editor-form">
            <div className="invoice-editor-section-label">Supplier</div>
            <div className="form-row"><label>Supplier Name *</label>
              <input value={form.supplier_name} onChange={(e) => selectSupplier(e.target.value)}
                list="po-supplier-list" placeholder="Type or pick a known supplier" />
              <datalist id="po-supplier-list">
                {suppliers.map((s) => <option key={s.id} value={s.name} />)}
              </datalist>
            </div>
            <div className="form-row"><label>Phone</label>
              <input value={form.supplier_phone} onChange={(e) => setForm({ ...form, supplier_phone: e.target.value })} /></div>
            <div className="form-row"><label>Email</label>
              <input type="email" value={form.supplier_email} onChange={(e) => setForm({ ...form, supplier_email: e.target.value })}
                placeholder="For easy PO delivery from the preview screen" /></div>
            <div className="form-row"><label>Address</label>
              <input value={form.supplier_address} onChange={(e) => setForm({ ...form, supplier_address: e.target.value })} /></div>
            <div className="form-row"><label>Supplier TIN</label>
              <input value={form.supplier_tin} onChange={(e) => setForm({ ...form, supplier_tin: e.target.value })} /></div>
            <div className="form-row"><label>Supplier VRN</label>
              <input value={form.supplier_vrn} onChange={(e) => setForm({ ...form, supplier_vrn: e.target.value })} /></div>
            <div className="form-row"><label>Expected Delivery</label>
              <input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} /></div>

            <div className="invoice-editor-section-label">Line Items</div>
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
                      <option value="">— Custom / new item (not in inventory) —</option>
                      {inventoryItems.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.name} ({it.quantity} in stock)
                        </option>
                      ))}
                    </select>
                    {isCustom && (
                      <input placeholder="Describe the item" value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                    )}
                  </div>
                  <input type="number" placeholder="Qty" value={line.quantity}
                    onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))} />
                  <input type="number" placeholder="Unit Cost" value={line.unit_price}
                    onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))} />
                  <span className="invoice-editor-line-total">{money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</span>
                  <button className="btn btn-danger" onClick={() => removeLine(idx)} aria-label="Remove line">✕</button>
                </div>
              )
            })}
            <button className="btn btn-outline" onClick={addLine} style={{ marginBottom: 20 }}>+ Add Line</button>

            <div className="form-row"><label>Tax Rate (%)</label>
              <input type="number" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
            <div className="form-row"><label>Discount</label>
              <input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} /></div>
            <div className="form-row"><label>Notes</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="invoice-editor-checkline">
              <div>Subtotal: {money(subtotal)}</div>
              <div>Tax: {money(taxAmt)}</div>
              <div><strong>Total: {money(total)}</strong></div>
            </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {previewDoc && (
        <PurchaseOrderPreview doc={previewDoc} company={company} onClose={() => setPreviewDoc(null)} />
      )}
    </div>
  )
}
