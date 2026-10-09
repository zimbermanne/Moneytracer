import { useEffect, useState } from 'react'
import Modal from './Modal.jsx'
import { useApi } from '../hooks/useApi.js'

const money = (n) => `TZS ${(Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const day = (d) => (d ? new Date(d).toLocaleDateString() : '')
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** The plain-language steps that lead from the items to the balance. */
function explain(st) {
  const owes = st.party_type === 'debtor' ? 'owes you' : 'you owe'
  const steps = []
  const itemLines = st.lines.filter((l) => l.kind === 'charge').length
  if (st.lines.some((l) => l.kind === 'charge' && l.quantity != null)) {
    steps.push(`Items: ${itemLines} line${itemLines === 1 ? '' : 's'} (quantity × price) add up to ${money(st.items_subtotal)}.`)
    if (st.adjustment) {
      const dir = st.adjustment > 0 ? 'more' : 'less'
      steps.push(`Adjustment: Total Owed was set to ${money(st.total_owed)}, which is ${money(Math.abs(st.adjustment))} ${dir} than the items. Reason: ${st.adjustment_reason || 'not given'}.`)
    } else {
      steps.push('Total Owed matches the items exactly — no adjustment.')
    }
  } else {
    steps.push(`Total Owed (${money(st.total_owed)}) was entered as one amount; no item lines are attached.`)
  }
  const opening = st.lines.find((l) => l.kind === 'opening')
  steps.push(
    `Payments: ${st.payments_count} payment record${st.payments_count === 1 ? '' : 's'} add up to ${money(st.payments_sum)}`
    + (opening ? `, including ${money(opening.payment)} already paid before individual payments were tracked.` : '.'),
  )
  steps.push(`Balance = Total Owed ${money(st.total_owed)} − Paid ${money(st.total_paid)} = ${money(st.balance)} (${owes}).`)
  steps.push('Status is "Paid" when Paid ≥ Total Owed, "Partial" when something has been paid, otherwise "Unpaid".')
  return steps
}

function buildPrintHtml(st, company) {
  const steps = explain(st).map((s) => `<li>${esc(s)}</li>`).join('')
  const rows = st.lines.map((l) => `<tr>
    <td>${esc(day(l.date))}</td>
    <td>${esc(l.description)}${l.quantity != null ? ` — ${esc(l.quantity)} × ${esc(money(l.unit_price))}` : ''}${l.method ? ` <em>(${esc(l.method)})</em>` : ''}${l.note ? `<br><small>${esc(l.note)}</small>` : ''}</td>
    <td class="n">${l.charge ? esc(money(l.charge)) : ''}</td>
    <td class="n">${l.payment ? esc(money(l.payment)) : ''}</td>
    <td class="n">${esc(money(l.balance))}</td></tr>`).join('')
  const stock = st.stock_receipts?.length ? `<h3>Stock received from this supplier</h3>
    <table><thead><tr><th>Date</th><th>Item</th><th class="n">Qty</th><th class="n">Buying price</th><th class="n">Total</th></tr></thead><tbody>
    ${st.stock_receipts.map((r) => `<tr><td>${esc(day(r.date))}</td><td>${esc(r.item_name)}</td><td class="n">${esc(r.quantity)}</td><td class="n">${esc(money(r.unit_cost))}</td><td class="n">${esc(money(r.total))}</td></tr>`).join('')}
    </tbody></table>` : ''
  return `<!doctype html><html><head><meta charset="utf-8"><title>Account statement — ${esc(st.name)}</title>
  <style>body{font-family:Arial,sans-serif;color:#222;padding:28px;max-width:820px;margin:auto}h1{margin:0 0 4px;font-size:22px}h3{margin:22px 0 8px}
  .muted{color:#666;font-size:13px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top}
  th{background:#f3f3f3}.n{text-align:right;white-space:nowrap}.box{background:#f7f7f7;border-radius:8px;padding:12px 16px;margin:14px 0}
  .box ol{margin:6px 0 0 18px;padding:0}.box li{margin:4px 0}.tot{font-weight:700;font-size:15px}.warn{color:#b3261e;margin-top:10px}</style></head><body>
  <h1>${esc(company?.name || 'Account statement')}</h1>
  <div class="muted">Account statement — ${st.party_type === 'debtor' ? 'Customer (owes us)' : 'Supplier (we owe)'} · Printed ${esc(new Date().toLocaleString())}</div>
  <h3 style="margin-bottom:2px">${esc(st.name)}</h3>
  <div class="muted">${esc([st.phone, st.tin_number && `TIN ${st.tin_number}`, st.note].filter(Boolean).join(' · '))}</div>
  <div class="box"><strong>How this figure is calculated</strong><ol>${steps}</ol></div>
  <table><thead><tr><th>Date</th><th>Description</th><th class="n">Charges</th><th class="n">Payments</th><th class="n">Balance</th></tr></thead><tbody>${rows}</tbody>
  <tfoot><tr class="tot"><td colspan="2">Totals</td><td class="n">${esc(money(st.total_owed))}</td><td class="n">${esc(money(st.total_paid))}</td><td class="n">${esc(money(st.balance))}</td></tr></tfoot></table>
  ${st.payments_match ? '' : `<div class="warn">Note: payment records add up to ${esc(money(st.payments_sum))} but the account shows ${esc(money(st.total_paid))} paid.</div>`}
  ${stock}</body></html>`
}

/**
 * Account statement for one debtor or creditor: the balance, built up line by
 * line, with a plain-language explanation of how the figure was reached.
 * partyType: 'debtor' | 'creditor'.
 */
export default function AccountStatement({ partyType, partyId, company, onClose }) {
  const api = useApi()
  const [st, setSt] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/ledgers/${partyType}s/${partyId}/statement`).then(setSt).catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partyType, partyId])

  const print = () => {
    const w = window.open('', '_blank')
    if (!w) { setError('Allow pop-ups to print the statement.'); return }
    w.document.write(buildPrintHtml(st, company))
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 250)
  }

  return (
    <Modal
      title={st ? `Account Statement — ${st.name}` : 'Account Statement'}
      onClose={onClose}
      wide={true}
      footer={(<>
        <button className="btn btn-outline" onClick={onClose}>Close</button>
        <button className="btn btn-primary" onClick={print} disabled={!st}>🖨 Print / Save as PDF</button>
      </>)}
    >
      {error && <div className="error-text">{error}</div>}
      {!st && !error && <div style={{ padding: 20, color: 'var(--text-muted)' }}>Loading…</div>}
      {st && (
        <>
          <div className="debtor-summary-card" style={{ marginBottom: 14 }}>
            <div className="debtor-summary-item"><span className="label">Total owed</span><span className="value">{money(st.total_owed)}</span></div>
            <div className="debtor-summary-item"><span className="label">Paid</span><span className="value">{money(st.total_paid)}</span></div>
            <div className="debtor-summary-item"><span className="label">Balance</span><span className="value balance">{money(st.balance)}</span></div>
            <div className="debtor-summary-item"><span className="label">Status</span><span className="value" style={{ textTransform: 'capitalize' }}>{st.status}</span></div>
          </div>

          <div className="card" style={{ marginBottom: 14, fontSize: 13 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>How this figure is calculated</div>
            <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {explain(st).map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          </div>

          {!st.payments_match && (
            <div style={{ background: 'var(--danger-bg, #fdecea)', color: 'var(--danger-text, #b3261e)', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
              ⚠️ The payment records add up to {money(st.payments_sum)}, but the account shows {money(st.total_paid)} paid. The headline balance uses the account figure — please review.
            </div>
          )}

          <div style={{ overflowX: 'auto' }}>
            <table className="table" style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr><th>Date</th><th>Description</th><th style={{ textAlign: 'right' }}>Charges</th><th style={{ textAlign: 'right' }}>Payments</th><th style={{ textAlign: 'right' }}>Balance</th></tr>
              </thead>
              <tbody>
                {st.lines.map((l, i) => (
                  <tr key={i}>
                    <td style={{ whiteSpace: 'nowrap' }}>{day(l.date)}</td>
                    <td>
                      {l.description}
                      {l.quantity != null && <span style={{ color: 'var(--text-muted)' }}> — {l.quantity} × {money(l.unit_price)}</span>}
                      {l.method && <span style={{ color: 'var(--text-muted)' }}> ({l.method})</span>}
                      {l.note && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{l.note}</div>}
                      {l.recorded_by && l.kind === 'payment' && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>recorded by {l.recorded_by}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }}>{l.charge ? money(l.charge) : ''}</td>
                    <td style={{ textAlign: 'right' }}>{l.payment ? money(l.payment) : ''}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(l.balance)}</td>
                  </tr>
                ))}
                {st.lines.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--text-muted)' }}>Nothing recorded yet.</td></tr>}
              </tbody>
            </table>
          </div>

          {st.stock_receipts?.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Stock received from this supplier</div>
              <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%', fontSize: 13 }}>
                  <thead><tr><th>Date</th><th>Item</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Buying price</th><th style={{ textAlign: 'right' }}>Total</th></tr></thead>
                  <tbody>
                    {st.stock_receipts.map((r, i) => (
                      <tr key={i}>
                        <td>{day(r.date)}</td><td>{r.item_name}</td>
                        <td style={{ textAlign: 'right' }}>{r.quantity}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.unit_cost)}</td>
                        <td style={{ textAlign: 'right' }}>{money(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
