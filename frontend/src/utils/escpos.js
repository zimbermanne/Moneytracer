/**
 * Minimal ESC/POS command builder for mini thermal receipt printers
 * (the cheap 58mm/80mm Bluetooth printers common with POS-58/POS-80
 * hardware). No dependencies — builds a raw Uint8Array of printer
 * commands that gets sent straight to the printer over Web Bluetooth.
 *
 * Reference: standard ESC/POS command set, supported by the near-universal
 * "generic ESC/POS" firmware these printers ship with.
 */

const ESC = 0x1b
const GS = 0x1d

// Most of these printers only understand plain ASCII/CP437 over the wire.
// We transliterate anything outside that range (accented Latin, curly
// quotes, etc.) rather than sending bytes the printer will render as
// garbage — thermal firmware rarely supports UTF-8.
function toPrinterBytes(str) {
  const cleaned = (str || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritics after decomposition
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x00-\x7E\n]/g, '?') // anything still non-ASCII becomes '?'
  const bytes = []
  for (let i = 0; i < cleaned.length; i++) bytes.push(cleaned.charCodeAt(i))
  return bytes
}

export class EscPosBuilder {
  constructor(charsPerLine = 32) {
    this.bytes = []
    this.charsPerLine = charsPerLine // 32 for 58mm at font A, 48 for 80mm
    this.raw([ESC, 0x40]) // ESC @ — initialize printer
  }

  raw(arr) {
    this.bytes.push(...arr)
    return this
  }

  text(str = '') {
    this.raw(toPrinterBytes(str))
    return this
  }

  line(str = '') {
    this.text(str)
    this.raw([0x0a])
    return this
  }

  feed(n = 1) {
    for (let i = 0; i < n; i++) this.raw([0x0a])
    return this
  }

  align(mode) {
    // 0 = left, 1 = center, 2 = right
    const n = mode === 'center' ? 1 : mode === 'right' ? 2 : 0
    this.raw([ESC, 0x61, n])
    return this
  }

  /**
   * ESC/POS printers offer two built-in fonts: Font A (~12x24px, the
   * default, ~32 chars/line on 58mm) and Font B (~9x17px, noticeably
   * smaller, ~42 chars/line on 58mm). Using Font B for the whole receipt
   * is what actually lets more text (like the site URL) fit on a line —
   * CSS font-size only affects the on-screen preview, not the physical
   * printer, which has its own fixed character cells per font.
   */
  font(mode) {
    // 0 = Font A, 1 = Font B
    this.raw([ESC, 0x4d, mode === 'B' || mode === 1 ? 1 : 0])
    return this
  }

  bold(on) {
    this.raw([ESC, 0x45, on ? 1 : 0])
    return this
  }

  doubleSize(on) {
    // GS ! n — 0x11 = double width + double height, 0x00 = normal
    this.raw([GS, 0x21, on ? 0x11 : 0x00])
    return this
  }

  underline(on) {
    this.raw([ESC, 0x2d, on ? 1 : 0])
    return this
  }

  hr(char = '-') {
    this.line(char.repeat(this.charsPerLine))
    return this
  }

  /** Print text wrapped at charsPerLine on whole-word boundaries (falls back
   * to a hard break only if a single word is longer than the line itself).
   * Optional indent is applied to every wrapped line after the first, so a
   * long item description reads as one indented block instead of the
   * printer's own mid-word wrap, which is what makes wrapped text hard to
   * scan on a receipt. */
  wrapLine(str = '', indent = 0) {
    const width = this.charsPerLine
    const pad = ' '.repeat(indent)
    const words = String(str).split(/\s+/).filter(Boolean)
    let current = ''
    let first = true
    const flush = () => {
      this.line((first ? '' : pad) + current)
      first = false
      current = ''
    }
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      const maxWidth = width - (first ? 0 : indent)
      if (candidate.length > maxWidth && current) {
        flush()
        current = word
      } else if (candidate.length > maxWidth) {
        // Single word longer than the line — hard-break it rather than
        // overflow, since the printer won't wrap it cleanly either.
        this.line((first ? '' : pad) + candidate.slice(0, maxWidth))
        current = candidate.slice(maxWidth)
        first = false
      } else {
        current = candidate
      }
    }
    if (current || words.length === 0) flush()
    return this
  }

  /** Two-column row: label on the left, value right-aligned. Wraps the
   * label onto its own line first if there isn't room to fit both. */
  row(left = '', right = '') {
    const width = this.charsPerLine
    const l = String(left)
    const r = String(right)
    if (l.length + r.length + 1 > width) {
      this.line(l)
      this.line(r.padStart(width, ' '))
    } else {
      const gap = width - l.length - r.length
      this.line(l + ' '.repeat(Math.max(1, gap)) + r)
    }
    return this
  }

  cut() {
    this.feed(3)
    this.raw([GS, 0x56, 0x42, 0x00]) // GS V B 0 — partial cut (falls back to full cut if unsupported)
    return this
  }

  /**
   * Native ESC/POS QR code printing (GS ( k), supported by the near-
   * universal "generic ESC/POS" firmware on these printers. Printed by
   * the printer's own QR generator -- no image conversion needed, and it
   * comes out crisp even on cheap 203dpi heads, unlike a rasterized QR
   * image at receipt width.
   */
  qrCode(data, moduleSize = 6) {
    const bytes = toPrinterBytes(data)
    const len = bytes.length + 3
    const pL = len & 0xff
    const pH = (len >> 8) & 0xff

    // Model 2 (the common default)
    this.raw([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00])
    // Module size
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, moduleSize])
    // Error correction level (48 = L)
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30])
    // Store the data
    this.raw([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...bytes])
    // Print it
    this.raw([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30])
    return this
  }

  /**
   * Raster image printing (GS v 0) for the logo — printers don't decode
   * PNG/JPEG themselves, so this expects a pre-converted 1-bit monochrome
   * bitmap: { width, height, packedBytes } as produced by
   * imageElementToMonochromeBitmap() in thermalPrinter.js. Silently no-ops
   * if bitmap is null (e.g. no logo configured, or conversion failed) so a
   * missing logo never breaks the rest of the receipt.
   */
  image(bitmap) {
    if (!bitmap) return this
    const { width, height, packedBytes } = bitmap
    const widthBytes = Math.ceil(width / 8)
    this.raw([GS, 0x76, 0x30, 0x00, widthBytes & 0xff, (widthBytes >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff])
    this.raw(Array.from(packedBytes))
    this.raw([0x0a])
    return this
  }

  toBytes() {
    return new Uint8Array(this.bytes)
  }
}

/**
 * Build the full byte sequence for a sales receipt.
 * @param {object} receipt - { receipt_no, sales, total, customer_name, payment_mode, created_at }
 * @param {object} company - { name, address, phone, tin, vrn, owner_full_name }
 * @param {number} charsPerLine - 32 (58mm) or 48 (80mm)
 * @param {object} extra - { logoBitmap, customerPhone, customerTin, qrData, landingUrl }
 */
export function buildReceiptEscPos(receipt, company = {}, charsPerLine = 42, extra = {}) {
  const b = new EscPosBuilder(charsPerLine)
  const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
  // This is a multi-country app — company.currency is the tenant's own
  // ISO 4217 code (KES, GHS, XOF, ...), set from their account's country.
  // TZS is only the fallback for tenants who haven't set one.
  const currency = company.currency || 'TZS'
  const { logoBitmap, customerPhone, customerTin, qrData, landingUrl } = extra
  // Font B (smaller) for the whole receipt -- harmonizes sizing and is
  // what actually lets more characters fit per line on 58mm paper, unlike
  // a CSS font-size change which only affects the on-screen preview.
  b.font(1)
  // Printed compactly (no https:// or trailing slash) so it comfortably
  // fits one line even on 58mm -- the full URL is still shown on-screen
  // and used as-is for the QR code data, just not spelled out in text here.
  const compactUrl = landingUrl ? landingUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') : ''

  b.align('center')
  if (logoBitmap) b.image(logoBitmap)
  b.bold(true)
  b.line(company.name || 'Moneytracer')
  b.bold(false)
  if (compactUrl) b.line(compactUrl)
  if (company.street_address || company.address) b.line(company.street_address || company.address)
  if (company.phone) b.line(`Tel: ${company.phone}`)
  if (company.tin) b.line(`TIN: ${company.tin}`)
  if (company.vrn) b.line(`VRN: ${company.vrn}`)
  if (company.owner_full_name) b.line(company.owner_full_name)
  b.hr('=')

  b.align('left')
  b.line(`Receipt: ${receipt.receipt_no || ''}`)
  b.line(`Date: ${receipt.created_at ? new Date(receipt.created_at).toLocaleString() : new Date().toLocaleString()}`)
  if (receipt.customer_name) b.line(`Customer: ${receipt.customer_name}`)
  if (customerPhone) b.line(`Client Phone: ${customerPhone}`)
  if (customerTin) b.line(`Client TIN: ${customerTin}`)
  if (receipt.payment_mode) b.line(`Payment: ${String(receipt.payment_mode).replace('_', ' ')}`)
  b.hr()

  for (const s of receipt.sales || []) {
    b.line(`${s.item_name}`)
    const qty = s.quantity
    const unit = s.unit_price != null ? s.unit_price : (s.total && qty ? s.total / qty : 0)
    b.row(`  ${qty} x ${money(unit)}`, money(s.total))
  }
  b.hr()

  b.bold(true)
  b.row('TOTAL', `${currency} ${money(receipt.total)}`)
  b.bold(false)
  b.feed(1)

  b.align('center')
  b.line('Thank you for your business!')
  if (qrData) {
    b.feed(1)
    b.qrCode(qrData)
    b.feed(1)
  }
  b.bold(true)
  b.line('END OF RECEIPT')
  b.bold(false)
  b.cut()

  return b.toBytes()
}

/**
 * Build the full byte sequence for a customer statement of accounts —
 * opening balance, a running-balance ledger of invoiced/received entries,
 * and the closing balance due. Printed narrower-feeling than a sales
 * receipt since each ledger line carries a date, so long descriptions get
 * wrapped onto their own line rather than truncated.
 * @param {object} statement - { customer_name, date_from, date_to,
 *   opening_balance, invoiced_amount, amount_received, balance_due, entries }
 *   entries: [{ date, description, reference, invoiced, received, balance }]
 * @param {object} company - { name, address, phone, tin, vrn, owner_full_name }
 * @param {number} charsPerLine - 32 (58mm) or 48 (80mm) at Font A, or the
 *   wider Font B counts (42 / 64) if the caller sets font(1) itself.
 */
export function buildStatementEscPos(statement, company = {}, charsPerLine = 42) {
  const b = new EscPosBuilder(charsPerLine)
  const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
  const shortDate = (d) => new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
  const currency = company.currency || 'TZS'
  // Font B (smaller) for the whole statement -- same rationale as receipts:
  // fits noticeably more per line than Font A, which matters here since
  // ledger rows pack a date, description, and two amounts.
  b.font(1)

  b.align('center')
  b.bold(true)
  b.line(company.name || 'Moneytracer')
  b.bold(false)
  if (company.street_address || company.address) b.line(company.street_address || company.address)
  if (company.phone) b.line(`Tel: ${company.phone}`)
  if (company.tin) b.line(`TIN: ${company.tin}`)
  if (company.vrn) b.line(`VRN: ${company.vrn}`)
  b.hr('=')
  b.bold(true)
  b.line('STATEMENT OF ACCOUNT')
  b.bold(false)

  b.align('left')
  b.line(`Customer: ${statement.customer_name || ''}`)
  const from = statement.date_from ? new Date(statement.date_from).toLocaleDateString() : ''
  const to = statement.date_to ? new Date(statement.date_to).toLocaleDateString() : ''
  if (from || to) b.line(`Period: ${from} - ${to}`)
  b.line(`Printed: ${new Date().toLocaleString()}`)
  b.hr()

  b.row('Opening Balance', `${currency} ${money(statement.opening_balance)}`)
  b.hr('-')

  // Ledger: each entry gets a date+description line, then an
  // invoiced/received/balance line so the numbers stay aligned and
  // readable even when the description is long.
  for (const e of statement.entries || []) {
    const desc = e.reference ? `${e.description} (${e.reference})` : e.description
    b.line(`${shortDate(e.date)}  ${desc}`)
    const parts = []
    if (e.invoiced) parts.push(`Inv ${money(e.invoiced)}`)
    if (e.received) parts.push(`Recv ${money(e.received)}`)
    parts.push(`Bal ${money(e.balance)}`)
    b.line(`   ${parts.join('  ')}`)
  }
  if (!statement.entries || statement.entries.length === 0) {
    b.line('No activity in this period.')
  }
  b.hr()

  b.row('Total Invoiced', `${currency} ${money(statement.invoiced_amount)}`)
  b.row('Total Received', `${currency} ${money(statement.amount_received)}`)
  b.hr('-')
  b.bold(true)
  b.doubleSize(true)
  b.row('BALANCE DUE', `${currency} ${money(statement.balance_due)}`)
  b.doubleSize(false)
  b.bold(false)
  b.feed(1)

  b.align('center')
  b.line('Thank you for your business!')
  b.bold(true)
  b.line('END OF STATEMENT')
  b.bold(false)
  b.cut()

  return b.toBytes()
}

/**
 * Item-level thermal statement for a Debtor (informal credit-sale ledger) —
 * distinct from buildStatementEscPos (Customer, invoice-based AR): a Debtor
 * has no per-transaction invoiced/received ledger, just a list of items
 * bought on credit (DebtorItem) plus a manually-tracked total_owed/
 * amount_paid. total_owed is the authoritative figure — it does NOT
 * necessarily equal the sum of the printed item lines (see Debtor model
 * docstring), so both are shown rather than one derived from the other.
 *
 * Formatting choices are aimed at readability on a narrow physical printer,
 * not just fitting characters in: each item gets its own numbered block
 * (name, then qty/price/line-total clearly labeled on the next line) rather
 * than cramming everything onto one row, long names word-wrap with a
 * hanging indent instead of the printer's own mid-word cut, and every
 * money figure repeats the tenant's currency code so nothing reads as a
 * bare, ambiguous number — this is a multi-country app, so that code comes
 * from company.currency (set per-account from the tenant's country, see
 * routers/accounts.py + african_currencies.py), not a fixed "TZS".
 *
 * debtor shape: { name, phone, note, total_owed, amount_paid, created_at,
 *   items: [{ description, quantity, unit_price, created_at }] }
 */
export function buildDebtorStatementEscPos(debtor, company = {}, charsPerLine = 42) {
  const b = new EscPosBuilder(charsPerLine)
  const money = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
  const shortDate = (d) => d ? new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : ''
  // Multi-country app — always print the tenant's own currency (set from
  // their account's country, see routers/accounts.py), not a fixed one.
  const currency = company.currency || 'TZS'
  b.font(1)

  b.align('center')
  b.bold(true)
  b.line(company.name || 'Moneytracer')
  b.bold(false)
  if (company.street_address || company.address) b.line(company.street_address || company.address)
  if (company.phone) b.line(`Tel: ${company.phone}`)
  if (company.tin) b.line(`TIN: ${company.tin}`)
  if (company.vrn) b.line(`VRN: ${company.vrn}`)
  b.hr('=')
  b.bold(true)
  b.doubleSize(true)
  b.line('DEBTOR STATEMENT')
  b.doubleSize(false)
  b.bold(false)

  b.align('left')
  b.line(`Client:  ${debtor.name || ''}`)
  if (debtor.phone) b.line(`Phone:   ${debtor.phone}`)
  b.line(`Since:   ${shortDate(debtor.created_at)}`)
  b.line(`Printed: ${new Date().toLocaleString()}`)
  b.hr()

  // Each item is its own clearly-separated block:
  //   1. Item name (word-wrapped, hanging indent if it runs long)
  //      Qty: 2   Price: <currency> 5,000   = <currency> 10,000
  // rather than one dense row, so a client reading a printed slip can
  // follow quantity -> unit price -> line total without doing the math.
  const items = debtor.items || []
  if (items.length > 0) {
    b.bold(true)
    b.line('ITEMS BOUGHT ON CREDIT')
    b.bold(false)
    let itemsTotal = 0
    items.forEach((it, idx) => {
      const qty = Number(it.quantity) || 0
      const unit = Number(it.unit_price) || 0
      const lineTotal = qty * unit
      itemsTotal += lineTotal
      const dateStr = shortDate(it.created_at)
      b.wrapLine(`${idx + 1}. ${it.description}${dateStr ? ` (${dateStr})` : ''}`, 3)
      b.line(`   Qty: ${qty}   Price: ${currency} ${money(unit)}`)
      b.row('   Subtotal', `${currency} ${money(lineTotal)}`)
      if (idx < items.length - 1) b.line('')
    })
    b.hr('-')
    b.bold(true)
    b.row('Items Total', `${currency} ${money(itemsTotal)}`)
    b.bold(false)
  } else {
    b.line('No items on record for this debt.')
  }
  b.hr()

  // Total Owed is the authoritative balance the business tracks — shown
  // plainly, never mixed with or overwritten by the items total above,
  // since the two aren't guaranteed to match (see docstring).
  b.bold(true)
  b.line('ACCOUNT SUMMARY')
  b.bold(false)
  b.row('Total Owed', `${currency} ${money(debtor.total_owed)}`)
  b.row('Amount Paid', `${currency} ${money(debtor.amount_paid)}`)
  b.hr('-')
  const balance = (debtor.total_owed || 0) - (debtor.amount_paid || 0)
  b.bold(true)
  b.doubleSize(true)
  if (balance < 0) {
    b.row('OVERPAID BY', `${currency} ${money(Math.abs(balance))}`)
  } else {
    b.row('BALANCE DUE', `${currency} ${money(balance)}`)
  }
  b.doubleSize(false)
  b.bold(false)
  b.feed(1)

  if (debtor.note) {
    b.align('left')
    b.wrapLine(`Note: ${debtor.note}`, 6)
    b.feed(1)
  }

  b.align('center')
  b.line('Thank you for your business!')
  b.bold(true)
  b.line('END OF STATEMENT')
  b.bold(false)
  b.cut()

  return b.toBytes()
}
