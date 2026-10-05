import { useEffect, useRef, useState } from 'react'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'

function money(n) {
  return `TZS ${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

/**
 * Full-screen invoice/quotation editor. Renders the form on the left and a
 * live-updating preview of the document sheet on the right, so the user can
 * see exactly what the customer will get as they fill it in. Also includes
 * an "Amount to Collect" field so the user can key in what they expect the
 * total to be and instantly see whether it matches the computed total.
 */
export default function InvoiceEditor({
  kind, isInvoice, editingId, form, setForm, company, error,
  updateLine, addLine, removeLine, moveLine, subtotal, taxAmt, total,
  onClose, onSave, saving, inventoryItems = [], selectInventoryItem, showProfit = false,
}) {
  const [checkAmount, setCheckAmount] = useState('')
  const { setDirty, setDirtyMessage, setOnSaveDraft } = useNavigationGuard()

  // Drag-to-reorder: press and hold the handle on a line, then slide up or
  // down over the other lines. Pointer events cover mouse, touch and pen with
  // one code path; the handle is also keyboard-operable (Arrow Up / Down).
  const [dragIdx, setDragIdx] = useState(null)
  const dragRef = useRef(null)
  const scrollerRef = useRef(null)

  const scrollParent = (node) => {
    for (let el = node.parentElement; el; el = el.parentElement) {
      const oy = getComputedStyle(el).overflowY
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el
    }
    return document.scrollingElement
  }
  const startDrag = (e, idx) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    scrollerRef.current = scrollParent(e.currentTarget)
    dragRef.current = idx
    setDragIdx(idx)
  }
  const onDragMove = (e) => {
    const cur = dragRef.current
    if (cur == null) return
    // Near the top/bottom edge of the scroll area: scroll so long lists work.
    const sc = scrollerRef.current
    if (sc) {
      const r = sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect()
      if (e.clientY < r.top + 70) sc.scrollBy(0, -12)
      else if (e.clientY > r.bottom - 70) sc.scrollBy(0, 12)
    }
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-line-idx]')
    if (!row) return
    const target = Number(row.dataset.lineIdx)
    if (target === cur) return
    const step = target > cur ? 1 : -1
    moveLine(cur, step)
    dragRef.current = cur + step
    setDragIdx(cur + step)
  }
  const endDrag = () => { dragRef.current = null; setDragIdx(null) }
  const onHandleKey = (e, idx) => {
    if (e.key === 'ArrowUp' && idx > 0) { e.preventDefault(); moveLine(idx, -1) }
    else if (e.key === 'ArrowDown' && idx < form.items.length - 1) { e.preventDefault(); moveLine(idx, 1) }
  }
  const label = isInvoice ? 'Invoice' : 'Quotation'

  useEffect(() => {
    // A document is considered "dirty" (work in progress) if it has at least
    // one line item with a description, or a customer name set.
    const hasData = form.customer_name.trim() !== '' || form.items.some(l => l.description.trim() !== '')
    if (hasData) {
      setDirtyMessage(`You have an unsaved ${label.toLowerCase()} in progress. Leaving this page will discard your changes.`)
      setDirty(true)
      // Provide the save function to the navigation guard so the "Save as Draft"
      // button in the exit prompt actually works.
      setOnSaveDraft(() => () => onSave(true))
    } else {
      setDirty(false)
      setOnSaveDraft(null)
    }
    return () => {
      setDirty(false)
      setOnSaveDraft(null)
    }
  }, [form, onSave, label, setDirty, setDirtyMessage, setOnSaveDraft])

  const checkValue = checkAmount === '' ? null : Number(checkAmount)
  const checkDiff = checkValue === null ? null : Math.round((checkValue - total) * 100) / 100
  const checkMatches = checkValue !== null && Math.abs(checkDiff) < 0.5
  const itemsWithText = form.items.filter((l) => l.description.trim())

  return (
    <div className="invoice-editor-overlay">
      <div className="invoice-editor">
        <div className="invoice-editor-topbar">
          <div>
            <div className="doc-sheet-muted">{editingId ? `Edit ${label}` : `New ${label}`}</div>
            <h2 style={{ margin: 0 }}>{form.customer_name || 'New customer'}</h2>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={onSave} disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save Changes' : 'Save'}
            </button>
          </div>
        </div>

        {error && <div className="error-text" style={{ padding: '0 24px' }}>{error}</div>}

        <div className="invoice-editor-body">
          <div className="invoice-editor-form">
            <div className="form-row"><label>Customer Name *</label>
              <input value={form.customer_name} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} /></div>
            <div className="form-row"><label>Phone</label>
              <input value={form.customer_phone} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} /></div>
            <div className="form-row"><label>Address</label>
              <input value={form.customer_address} onChange={(e) => setForm({ ...form, customer_address: e.target.value })} /></div>
            {isInvoice && (
              <>
                <div className="form-row"><label>Customer TIN</label>
                  <input value={form.customer_tin} onChange={(e) => setForm({ ...form, customer_tin: e.target.value })} /></div>
                <div className="form-row"><label>Customer VRN</label>
                  <input value={form.customer_vrn} onChange={(e) => setForm({ ...form, customer_vrn: e.target.value })} /></div>
                <div className="form-row"><label>Due Date</label>
                  <input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
                <div className="form-row"><label>PO / DO Number</label>
                  <input value={form.po_number} onChange={(e) => setForm({ ...form, po_number: e.target.value })} /></div>
              </>
            )}
            {!isInvoice && (
              <div className="form-row"><label>Valid for (days)</label>
                <input type="number" value={form.valid_days} onChange={(e) => setForm({ ...form, valid_days: Number(e.target.value) })} /></div>
            )}

            <div className="invoice-editor-section-label">Line Items</div>
            {form.items.map((line, idx) => {
              const isCustom = !line.item_id
              return (
              <div key={idx} data-line-idx={idx} className={`invoice-editor-line${showProfit ? ' invoice-editor-line-with-profit' : ''}${dragIdx === idx ? ' invoice-editor-line-dragging' : ''}`}>
                <button
                  type="button"
                  className="invoice-line-handle"
                  onPointerDown={(e) => startDrag(e, idx)}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => onHandleKey(e, idx)}
                  aria-label={`Reorder item ${idx + 1}. Drag, or use the up and down arrow keys.`}
                  title="Drag to reorder"
                >
                  <span className="invoice-line-handle-grip">⠿</span>
                  <span className="invoice-line-handle-text">Drag to reorder · {idx + 1}</span>
                </button>
                <div className="invoice-line-item-picker">
                  <span className="invoice-line-field-label">Item</span>
                  <div className="invoice-line-item-row">
                  <select
                    className="invoice-line-item-select"
                    value={line.item_id ?? ''}
                    onChange={(e) => selectInventoryItem(idx, e.target.value)}
                  >
                    <option value="">Lookup</option>
                    {inventoryItems.map((it) => (
                      <option key={it.id} value={it.id} disabled={it.quantity <= 0}>
                        {it.name} {it.quantity <= 0 ? '(out of stock)' : `(${it.quantity} in stock)`}
                      </option>
                    ))}
                  </select>
                  {isCustom && (
                    <input placeholder="Describe the item" value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)} />
                  )}
                  </div>
                </div>
                <label className="invoice-line-field invoice-line-qty">
                  <span className="invoice-line-field-label">Qty</span>
                  <input type="number" inputMode="decimal" placeholder="Qty" value={line.quantity}
                    onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))} />
                </label>
                <label className="invoice-line-field invoice-line-price">
                  <span className="invoice-line-field-label">Price</span>
                  <input type="number" inputMode="decimal" placeholder="Unit Price" value={line.unit_price}
                    onChange={(e) => updateLine(idx, 'unit_price', Number(e.target.value))} />
                </label>
                <div className="invoice-line-total">
                  <span className="invoice-line-field-label">Total</span>
                  <span className="invoice-editor-line-total">{money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</span>
                </div>
                {showProfit && (() => {
                  const inv = line.item_id ? inventoryItems.find((it) => String(it.id) === String(line.item_id)) : null
                  if (!inv) return <span className="doc-sheet-item-profit invoice-line-profit">—</span>
                  const profit = ((Number(line.unit_price) || 0) - (inv.cost_price || 0)) * (Number(line.quantity) || 0)
                  return (
                    <span className={`doc-sheet-item-profit invoice-line-profit${profit < 0 ? ' negative' : ''}`} title="Profit for this line — visible to you only, never shown to the customer or on the PDF">
                      Profit: {profit >= 0 ? '+' : ''}{money(profit)}
                    </span>
                  )
                })()}
                <button className="btn btn-danger invoice-line-remove" onClick={() => removeLine(idx)} aria-label="Remove line">✕</button>
              </div>
            )})}
            <button className="btn btn-outline" onClick={addLine} style={{ marginBottom: 20 }}>+ Add Line</button>

            <div className="form-row"><label>Tax Rate (%)</label>
              <input type="number" value={form.tax_rate} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
            <div className="form-row"><label>Discount (TZS)</label>
              <input type="number" value={form.discount} onChange={(e) => setForm({ ...form, discount: Number(e.target.value) })} /></div>
            <div className="form-row"><label>Notes</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>

            <div className="invoice-editor-checkline">
              <div>
                <label>Amount to Collect (cross-check)</label>
                <div className="doc-sheet-muted" style={{ marginBottom: 6 }}>
                  Enter the amount you expect to charge, and we'll check it against the computed total.
                </div>
                <input
                  type="number"
                  placeholder={`e.g. ${Math.round(total)}`}
                  value={checkAmount}
                  onChange={(e) => setCheckAmount(e.target.value)}
                />
              </div>
              {checkValue !== null && (
                <div className={`invoice-editor-check-result ${checkMatches ? 'match' : 'mismatch'}`}>
                  {checkMatches ? (
                    <>✅ Matches the computed total ({money(total)})</>
                  ) : (
                    <>
                      ⚠️ {checkDiff > 0 ? 'Over' : 'Under'} the computed total by {money(Math.abs(checkDiff))}
                      <span className="doc-sheet-muted" style={{ display: 'block', marginTop: 2 }}>
                        Computed total is {money(total)}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="invoice-editor-preview">
            <div className="invoice-editor-preview-label">Live Preview</div>
            <div className="doc-sheet doc-sheet-live">
              <div className="doc-sheet-head">
                <div>
                  <div className="doc-sheet-company">{company?.name || 'Your Company'}</div>
                  {company?.address && <div className="doc-sheet-muted">{company.address}</div>}
                  {company?.email && <div className="doc-sheet-muted">{company.email}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="doc-sheet-title">{label}</div>
                  <div className="doc-sheet-muted">{editingId ? '(editing)' : '# (assigned on save)'}</div>
                </div>
              </div>

              <div className="doc-sheet-meta">
                <div>
                  <div className="doc-sheet-label">Bill To</div>
                  <div style={{ fontWeight: 600 }}>{form.customer_name || '—'}</div>
                  {form.customer_phone && <div className="doc-sheet-muted">{form.customer_phone}</div>}
                  {form.customer_address && <div className="doc-sheet-muted">{form.customer_address}</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="doc-sheet-label">Date</div>
                  <div>{new Date().toLocaleDateString()}</div>
                </div>
              </div>

              <table className="doc-sheet-items">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Description</th>
                    <th style={{ textAlign: 'right' }}>Qty</th>
                    <th style={{ textAlign: 'right' }}>Rate</th>
                    <th style={{ textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsWithText.map((line, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{line.description}</td>
                      <td style={{ textAlign: 'right' }}>{line.quantity}</td>
                      <td style={{ textAlign: 'right' }}>{money(line.unit_price)}</td>
                      <td style={{ textAlign: 'right' }}>{money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}</td>
                    </tr>
                  ))}
                  {itemsWithText.length === 0 && (
                    <tr><td colSpan={5} className="doc-sheet-muted" style={{ padding: '14px 10px' }}>Add a line item to see it here.</td></tr>
                  )}
                </tbody>
              </table>

              <div className="doc-sheet-totals">
                <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
                {form.tax_rate > 0 && <div><span>Tax ({form.tax_rate}%)</span><span>{money(taxAmt)}</span></div>}
                {form.discount > 0 && <div><span>Discount</span><span>-{money(form.discount)}</span></div>}
                <div className="doc-sheet-total-row"><span>Total</span><span>{money(total)}</span></div>
              </div>

              {form.notes && (
                <div style={{ marginTop: 18 }}>
                  <div className="doc-sheet-label">Notes</div>
                  <div className="doc-sheet-muted">{form.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* Compact mobile-only stand-in for the desktop live preview above.
              A phone screen can't fit the form and the full invoice sheet at
              once, so instead of hiding the preview entirely we show a
              condensed summary: totals up front, line items as a simple
              stacked list (a wide 5-column table doesn't fit a phone width
              at all) rather than trying to shrink the real sheet. */}
          <div className="invoice-editor-preview-mobile">
            <div className="mobile-summary-row">
              <div>
                <div className="doc-sheet-label">{label} for</div>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{form.customer_name || 'New customer'}</div>
              </div>
              <div className="mobile-summary-total">
                <div className="doc-sheet-label">Total</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{money(total)}</div>
              </div>
            </div>

            {itemsWithText.length > 0 ? (
              <div className="mobile-summary-items">
                {itemsWithText.map((line, i) => (
                  <div key={i} className="mobile-summary-item">
                    <div className="mobile-summary-item-desc">{line.description}</div>
                    <div className="mobile-summary-item-meta">
                      {line.quantity} × {money(line.unit_price)}
                      <span className="mobile-summary-item-amount">
                        {money((Number(line.quantity) || 0) * (Number(line.unit_price) || 0))}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="doc-sheet-muted" style={{ padding: '10px 0' }}>Add a line item to see it here.</div>
            )}

            <div className="mobile-summary-totals">
              <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
              {form.tax_rate > 0 && <div><span>Tax ({form.tax_rate}%)</span><span>{money(taxAmt)}</span></div>}
              {form.discount > 0 && <div><span>Discount</span><span>-{money(form.discount)}</span></div>}
              <div className="mobile-summary-total-row"><span>Total</span><span>{money(total)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
