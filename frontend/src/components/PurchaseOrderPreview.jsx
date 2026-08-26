import { useState } from 'react'
import { useApi } from '../hooks/useApi.js'
import { apiUrl } from '../api-config.js'
import { downloadFile, openPdfForPrint } from '../utils/download.js'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Preview + export/print/email a Purchase Order before it goes out to a
 * supplier. Deliberately mirrors DocumentPreview.jsx (used for invoices and
 * quotations) rather than introducing a new visual language — same
 * .doc-sheet/.doc-preview-* classes — just addressed to a supplier instead
 * of a customer, and without the invoice-only "Valid Until" field.
 */
export default function PurchaseOrderPreview({ doc, company, onClose }) {
  const api = useApi()

  const [pdfLoading, setPdfLoading] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [emailAddr, setEmailAddr] = useState(doc.supplier_email || '')
  const [emailSending, setEmailSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const pdfUrl = apiUrl(`/api/purchase-orders/${doc.id}/pdf`)

  const handleExportPdf = () => {
    downloadFile(pdfUrl, `PurchaseOrder-${doc.po_no}.pdf`)
  }

  const handlePrint = () => {
    openPdfForPrint(pdfUrl)
  }

  const handleSendEmail = async () => {
    if (!emailAddr.trim()) { setError("Enter the supplier's email"); return }
    setError(''); setEmailSending(true); setNotice('')
    try {
      const res = await api.post(`/purchase-orders/${doc.id}/email`, { to_email: emailAddr.trim() })
      setNotice(res.detail || 'Email sent.')
      setEmailOpen(false)
    } catch (e) { setError(e.message) }
    finally { setEmailSending(false) }
  }

  const items = doc.items || []

  return (
    <div className="doc-preview-overlay" onClick={onClose}>
      <div className="doc-preview-panel" onClick={(e) => e.stopPropagation()}>
        <div className="doc-preview-header">
          <div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Purchase Order</div>
            <h2 style={{ margin: 0 }} className="doc-number">{doc.po_no}</h2>
          </div>
          <button className="btn btn-outline" onClick={onClose} aria-label="Close preview">✕</button>
        </div>

        <div className="doc-preview-toolbar">
          <button className="btn btn-outline" onClick={() => setEmailOpen((o) => !o)}>
            ✉ Send to Supplier
          </button>
          <button className="btn btn-outline" onClick={handlePrint} disabled={pdfLoading}>
            🖨 Print
          </button>
          <button className="btn btn-primary" onClick={handleExportPdf} disabled={pdfLoading}>
            ⬇ Export PDF
          </button>
        </div>

        {emailOpen && (
          <div className="doc-preview-email-row">
            <input
              type="email"
              placeholder="supplier@email.com"
              value={emailAddr}
              onChange={(e) => setEmailAddr(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={handleSendEmail} disabled={emailSending}>
              {emailSending ? 'Sending…' : 'Send'}
            </button>
          </div>
        )}

        {notice && <div style={{ color: 'var(--success)', fontSize: 13, padding: '0 20px' }}>{notice}</div>}
        {error && <div className="error-text" style={{ padding: '0 20px' }}>{error}</div>}

        <div className="doc-preview-body">
          <div className="doc-sheet doc-numerals">
            <div className="doc-sheet-head">
              <div>
                <div className="doc-sheet-company">{company?.name || 'Your Company'}</div>
                {company?.address && <div className="doc-sheet-muted">{company.address}</div>}
                {company?.email && <div className="doc-sheet-muted">{company.email}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="doc-sheet-title">Purchase Order</div>
                <div className="doc-sheet-muted doc-number"># {doc.po_no}</div>
                <span className={`badge badge-${doc.status}`} style={{ marginTop: 6, display: 'inline-block' }}>
                  {doc.status}
                </span>
              </div>
            </div>

            <div className="doc-sheet-meta">
              <div>
                <div className="doc-sheet-label">Supplier</div>
                <div style={{ fontWeight: 600 }}>{doc.supplier_name}</div>
                {doc.supplier_phone && <div className="doc-sheet-muted">{doc.supplier_phone}</div>}
                {doc.supplier_address && <div className="doc-sheet-muted">{doc.supplier_address}</div>}
                {doc.supplier_tin && <div className="doc-sheet-muted">TIN: {doc.supplier_tin}</div>}
                {doc.supplier_vrn && <div className="doc-sheet-muted">VRN: {doc.supplier_vrn}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="doc-sheet-label">Date</div>
                <div>{new Date(doc.created_at).toLocaleDateString()}</div>
                {doc.expected_date && (
                  <>
                    <div className="doc-sheet-label" style={{ marginTop: 8 }}>Expected Delivery</div>
                    <div>{new Date(doc.expected_date).toLocaleDateString()}</div>
                  </>
                )}
                <div className="doc-sheet-label" style={{ marginTop: 8 }}>Payment Terms</div>
                <div>{doc.payment_mode === 'credit' ? 'Credit' : 'Cash'}</div>
              </div>
            </div>

            <table className="doc-sheet-items">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Qty</th>
                  <th style={{ textAlign: 'right' }}>Unit Cost</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((line, i) => (
                  <tr key={line.id ?? i}>
                    <td>{i + 1}</td>
                    <td>{line.description}</td>
                    <td style={{ textAlign: 'right' }}>{line.quantity}</td>
                    <td style={{ textAlign: 'right' }}>{money(line.unit_price)}</td>
                    <td style={{ textAlign: 'right' }}>{money(line.total ?? line.quantity * line.unit_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="doc-sheet-totals">
              <div><span>Subtotal</span><span>{money(doc.subtotal)}</span></div>
              {doc.tax_rate > 0 && <div><span>Tax ({doc.tax_rate}%)</span><span>{money(doc.tax_amount)}</span></div>}
              {doc.discount > 0 && <div><span>Discount</span><span>-{money(doc.discount)}</span></div>}
              <div className="doc-sheet-total-row"><span>Total</span><span>{money(doc.total)}</span></div>
            </div>

            {doc.notes && (
              <div style={{ marginTop: 18 }}>
                <div className="doc-sheet-label">Notes</div>
                <div className="doc-sheet-muted">{doc.notes}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
