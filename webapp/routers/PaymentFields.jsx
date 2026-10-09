export const PAYMENT_METHODS = ['Cash', 'Mobile money', 'Bank transfer', 'Cheque', 'Other']

export const emptyPayment = () => ({
  amount: 0,
  method: 'Cash',
  note: '',
  date: new Date().toISOString().slice(0, 10), // yyyy-mm-dd, editable to back-date a late entry
})

/** Turn the form state into the body the pay endpoints expect. */
export function paymentBody(p) {
  const body = { amount: Number(p.amount), method: p.method, note: p.note }
  // Only send a date when it isn't today, so "now" keeps its exact time.
  if (p.date && p.date !== new Date().toISOString().slice(0, 10)) {
    body.paid_at = new Date(`${p.date}T12:00:00`).toISOString()
  }
  return body
}

/** Method / date / note inputs shown under the amount in the Record Payment dialogs. */
export default function PaymentFields({ value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  return (
    <>
      <div className="debtor-form-grid" style={{ textAlign: 'left' }}>
        <div className="form-row">
          <label>Method</label>
          <select value={value.method} onChange={set('method')}>
            {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label>Date</label>
          <input type="date" value={value.date} max={new Date().toISOString().slice(0, 10)} onChange={set('date')} />
        </div>
        <div className="form-row span-2">
          <label>Note (optional)</label>
          <input value={value.note} onChange={set('note')} placeholder="e.g. M-Pesa ref, receipt number" />
        </div>
      </div>
    </>
  )
}
