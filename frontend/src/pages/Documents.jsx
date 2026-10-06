import { useEffect, useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { useAuth } from '../hooks/useAuth.jsx'
import { apiUrl } from '../api-config.js'
import { downloadFile } from '../utils/download.js'
import Table from '../components/Table.jsx'
import DocumentPreview from '../components/DocumentPreview.jsx'
import InvoiceEditor from '../components/InvoiceEditor.jsx'
import { useDraft } from '../hooks/useDraft.js'
import RowActionsMenu from '../components/RowActionsMenu.jsx'
import SearchBar from '../components/SearchBar.jsx'
import { useSearch } from '../hooks/useSearch.js'

const emptyLine = () => ({ description: '', quantity: 1, unit_price: 0, item_id: null })
const emptyForm = () => ({
  customer_name: '', customer_phone: '', customer_address: '',
  customer_tin: '', customer_vrn: '', due_date: '', po_number: '',
  tax_rate: 0, discount: 0, notes: '', valid_days: 14, items: [emptyLine()],
})

export default function Documents({ kind }) {
  const api = useApi()
  const { account } = useAuth()
  const isInvoice = kind === 'invoices'
  const title = isInvoice ? 'Invoices' : 'Quotations / Proforma'
  const numberKey = isInvoice ? 'invoice_no' : 'quote_no'
  // Per-item profit annotation — admin-only (account is only populated for
  // the admin role, see useAuth/PrivateRoutes) and quotations-only (never
  // shown on invoices, and never sent to the PDF regardless — see
  // DocumentPreview.jsx / InvoiceEditor.jsx for where this actually renders).
  const showProfit = !isInvoice && !!account?.show_quote_profit

  const [docs, setDocs] = useState([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm())
  const [pdfLoading, setPdfLoading] = useState(null)
  const [listLoading, setListLoading] = useState(true)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [company, setCompany] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [inventoryItems, setInventoryItems] = useState([])

  // Autosave the open form to this device so a logout/restart/refresh can't wipe it.
  const draft = useDraft(open ? `${kind}:${editingId ?? 'new'}` : null, form, setForm, {
    isEmpty: (f) => !f.customer_name.trim() && !f.notes.trim() && f.items.every((l) => !l.description.trim()),
  })

  const [shareDoc, setShareDoc] = useState(null)
  const [shareQuery, setShareQuery] = useState('')
  const [shareResults, setShareResults] = useState([])
  const [shareSearching, setShareSearching] = useState(false)

  const lockedStatuses = isInvoice ? ['paid'] : ['accepted', 'rejected', 'expired']
  const isLocked = (doc) => lockedStatuses.includes(doc.status)

  const load = () => {
    setListLoading(true)
    api.get(`/${kind}/`).then(setDocs).catch((e) => setError(e.message)).finally(() => setListLoading(false))
  }
  useEffect(() => { load() }, [kind]) // eslint-disable-line
  useEffect(() => { api.get('/accounts/company-info').then(setCompany).catch(() => {}) }, []) // eslint-disable-line
  useEffect(() => { api.get('/inventory/').then(setInventoryItems).catch(() => {}) }, []) // eslint-disable-line

  // Selecting an inventory item pre-fills description + price from stock;
  // choosing "Custom item" (itemId === '') clears item_id so the line is
  // typed in freehand instead and never touches inventory when the
  // invoice is paid.
  const selectInventoryItem = (idx, itemId) => {
    if (!itemId) {
      setForm((f) => ({
        ...f,
        items: f.items.map((l, i) => i === idx ? { ...l, item_id: null } : l),
      }))
      return
    }
    const inv = inventoryItems.find((it) => String(it.id) === String(itemId))
    if (!inv) return
    setForm((f) => ({
      ...f,
      items: f.items.map((l, i) => i === idx
        ? { ...l, item_id: inv.id, description: inv.name, unit_price: inv.selling_price }
        : l),
    }))
  }

  const updateLine = (idx, field, value) => {
    const items = form.items.map((l, i) => i === idx ? { ...l, [field]: value } : l)
    setForm({ ...form, items })
  }
  const addLine = () => setForm({ ...form, items: [...form.items, emptyLine()] })
  const removeLine = (idx) => setForm({ ...form, items: form.items.filter((_, i) => i !== idx) })
  // Swaps a line with its neighbor above/below — the order here is exactly
  // the order items print on the invoice/quotation, so this is how the
  // user controls that without deleting and re-adding lines.
  const moveLine = (idx, direction) => {
    setForm((f) => {
      const target = idx + direction
      if (target < 0 || target >= f.items.length) return f
      const items = [...f.items]
      ;[items[idx], items[target]] = [items[target], items[idx]]
      return { ...f, items }
    })
  }

  const openEdit = (doc) => {
    setEditingId(doc.id)
    setForm({
      customer_name: doc.customer_name || '',
      customer_phone: doc.customer_phone || '',
      customer_address: doc.customer_address || '',
      customer_tin: doc.customer_tin || '',
      customer_vrn: doc.customer_vrn || '',
      due_date: doc.due_date ? doc.due_date.slice(0, 10) : '',
      po_number: doc.po_number || '',
      tax_rate: doc.tax_rate,
      discount: doc.discount,
      notes: doc.notes || '',
      valid_days: 14,
      items: doc.items.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unit_price, item_id: l.item_id ?? null })),
    })
    setError('')
    setOpen(true)
  }

  const save = async (isDraft = false) => {
    setError('')
    setSaving(true)
    try {
      const { customer_tin, customer_vrn, due_date, po_number, valid_days, ...rest } = form
      const payload = {
        ...rest,
        items: form.items.filter((l) => l.description.trim()),
        ...(isInvoice ? {
          customer_tin, customer_vrn, po_number,
          due_date: due_date ? new Date(due_date).toISOString() : null,
        } : { valid_days }),
        ...(isDraft ? { status: 'draft' } : {}),
      }
      if (!isDraft && !payload.items.length) { setError('Add at least one line item'); setSaving(false); return }
      if (editingId) {
        await api.put(`/${kind}/${editingId}`, payload)
      } else {
        await api.post(`/${kind}/`, payload)
      }
      draft.clear()
      setOpen(false); setEditingId(null); setForm(emptyForm()); load()
      return true // success
    } catch (e) { setError(e.message); return false }
    finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!confirm(`Delete this ${isInvoice ? 'invoice' : 'quotation'}?`)) return
    try { await api.del(`/${kind}/${id}`); load() } catch (e) { setError(e.message) }
  }

  const convert = async (id) => {
    try { await api.post(`/quotations/${id}/convert`, {}); load() }
    catch (e) { setError(e.message) }
  }

  const markPaid = async (doc) => {
    if (!confirm(`Mark ${doc[numberKey]} as paid? This records it as a sale and updates inventory — it can't be undone.`)) return
    try {
      await api.patch(`/${kind}/${doc.id}/status?status=paid`)
      load()
    } catch (e) { setError(e.message) }
  }

  // No fetch/blob here on purpose — see utils/download.js for why the
  // blob approach silently fails on mobile. This is now a synchronous,
  // instant handoff to the browser, so there's nothing to await and no
  // loading state needed; setPdfLoading stays only so the button can
  // show a brief "opening" flicker isn't needed but the prop is still
  // wired to RowActionsMenu below, so leave it settable/clearable.
  const downloadPdf = (doc, variant = 'pdf', filenamePrefix = isInvoice ? 'Invoice' : 'Quotation') => {
    const path = variant === 'pdf' ? `/${kind}/${doc.id}/pdf` : `/${kind}/${doc.id}/${variant}/pdf`
    downloadFile(apiUrl(`/api${path}`), `${filenamePrefix}-${doc[numberKey]}.pdf`)
  }

  const searchShare = (q) => {
    setShareQuery(q)
    if (q.length < 3) { setShareResults([]); return }
    setShareSearching(true)
    api.get(`/messages/directory?q=${encodeURIComponent(q)}`)
      .then(setShareResults)
      .catch(() => {})
      .finally(() => setShareSearching(false))
  }

  const doShare = async (business) => {
    try {
      const type = isInvoice ? 'invoice' : 'quotation'
      await api.post('/messages/threads', {
        recipient_account_id: business.id,
        subject: `Shared ${type}: ${shareDoc[numberKey]}`,
        body: `Hello! I am sharing a ${type} with you.`,
        attachment_type: type,
        attachment_id: shareDoc.id
      })
      alert('Document shared successfully!')
      setShareDoc(null)
    } catch (e) {
      setError(e.message)
    }
  }

  const columns = [
    { key: 'no', header: 'No.', render: (r) => <span className="cheque-number">{r[numberKey]}</span> },
    { key: 'created_at', header: 'Date', render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'customer_name', header: 'Customer' },
    { key: 'total', header: 'Total', render: (r) => `TZS ${r.total.toLocaleString()}` },
    { key: 'status', header: 'Status', render: (r) => <span className={`badge badge-${r.status}`}>{r.status}</span> },
    {
      key: 'actions', header: '',
      stopRowClick: true,
      render: (r) => (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          {isLocked(r) && (
            <span title={`A ${r.status} ${isInvoice ? 'invoice' : 'quotation'} cannot be edited`}
                  style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              🔒 Locked
            </span>
          )}
          <RowActionsMenu items={[
            { label: 'Edit', icon: '✎', onClick: () => openEdit(r), hidden: isLocked(r) },
            { label: 'Share', icon: '✉️', onClick: () => setShareDoc(r) },
            { label: 'Mark as Paid', icon: '✓', onClick: () => markPaid(r), hidden: !isInvoice || r.status === 'paid' },
            { label: pdfLoading === `${r.id}:pdf` ? 'Downloading…' : 'PDF', icon: '⬇', onClick: () => downloadPdf(r), disabled: pdfLoading === `${r.id}:pdf` },
            { label: pdfLoading === `${r.id}:packing-list` ? 'Downloading…' : 'Packing List', icon: '📦', onClick: () => downloadPdf(r, 'packing-list', 'PackingList'), disabled: pdfLoading === `${r.id}:packing-list`, hidden: !isInvoice },
            { label: pdfLoading === `${r.id}:delivery-note` ? 'Downloading…' : 'Delivery Note', icon: '🚚', onClick: () => downloadPdf(r, 'delivery-note', 'DeliveryNote'), disabled: pdfLoading === `${r.id}:delivery-note`, hidden: !isInvoice },
            { label: 'Convert to Invoice', icon: '→', onClick: () => convert(r.id), hidden: isInvoice || ['accepted','rejected'].includes(r.status) },
            { label: 'Delete', icon: '✕', onClick: () => remove(r.id), danger: true },
          ]} />
        </div>
      ),
    },
  ]

  const { query, setQuery, filtered } = useSearch(docs, [
    'customer_name',
    numberKey,
    (r) => new Date(r.created_at).toLocaleDateString(),
  ])

  const subtotal = form.items.reduce((s, l) => s + (Number(l.quantity)||0) * (Number(l.unit_price)||0), 0)
  const taxAmt   = subtotal * ((Number(form.tax_rate)||0) / 100)
  const total    = subtotal + taxAmt - (Number(form.discount)||0)

  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
        <button className="btn btn-primary" onClick={() => { setEditingId(null); setForm(emptyForm()); setOpen(true) }}>
          + New {isInvoice ? 'Invoice' : 'Quotation'}
        </button>
      </div>
      {error && <div className="error-text" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', marginBottom: 14 }}>
        <SearchBar value={query} onChange={setQuery} placeholder="Search by customer, number, or date…" />
      </div>
      <Table columns={columns} rows={filtered} loading={listLoading} loadingText={`Loading ${title.toLowerCase()}…`}
        emptyText={query ? `No ${title.toLowerCase()} match your search.` : `No ${title.toLowerCase()} yet.`} onRowClick={(row) => setPreviewDoc(row)} />

      {previewDoc && (
        <DocumentPreview kind={kind} doc={previewDoc} company={company} showProfit={showProfit} onClose={() => setPreviewDoc(null)} />
      )}

      {open && (
        <InvoiceEditor
          key={editingId ?? 'new'}
          kind={kind}
          isInvoice={isInvoice}
          editingId={editingId}
          form={form}
          setForm={setForm}
          company={company}
          error={error}
          saving={saving}
          updateLine={updateLine}
          addLine={addLine}
          removeLine={removeLine}
          moveLine={moveLine}
          inventoryItems={inventoryItems}
          selectInventoryItem={selectInventoryItem}
          showProfit={showProfit}
          subtotal={subtotal}
          taxAmt={taxAmt}
          total={total}
          draft={draft}
          onClose={() => { draft.clear(); setOpen(false); setEditingId(null) }}
          onSave={save}
        />
      )}

      {shareDoc && (
        <Modal
          title={isInvoice ? 'Share Invoice' : 'Share Quotation'}
          onClose={() => setShareDoc(null)}
          wide={true}
          isDirty={false}
          footer={(
            <button className="btn btn-outline" onClick={() => setShareDoc(null)}>Cancel</button>
          )}
        >
          <p className="sub">Share <strong>{shareDoc[numberKey]}</strong> with another business on Moneytracer.</p>
          <SearchBar value={shareQuery} onChange={searchShare} placeholder="Search business name or email..." autoFocus />

          <div style={{ marginTop: 20, maxHeight: 250, overflowY: 'auto' }}>
            {shareSearching ? <div>Searching...</div> : (
              shareResults.length === 0 && shareQuery.length >= 3 ? <div>No businesses found.</div> :
              shareResults.map(b => (
                <div
                  key={b.id}
                  onClick={() => doShare(b)}
                  style={{ padding: '12px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                  className="hover-bg"
                >
                  <strong>{b.name}</strong>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.email}</div>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
