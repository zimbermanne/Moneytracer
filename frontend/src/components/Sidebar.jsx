import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../hooks/useAuth.jsx'
import { useNavigationGuard } from '../hooks/useNavigationGuard.jsx'

// Emoji fallback icon pack — used on MOBILE ONLY (drawer + bottom nav).
// Phones get this instead of the animated-GIF pack because loading 30+
// animated GIFs at once (the whole flattened bottom nav renders in one
// go) is wasteful over mobile data and heavier on low-end devices than
// a hover-revealed desktop rail ever is. Keyed by the same slug used for
// the desktop icon file (see iconSrc below), so both packs stay in sync
// automatically when a nav entry is added.
export const EMOJI_ICONS = {
  home: '🏠',
  'point-of-sale': '🧾',
  'sales-history': '📜',
  customers: '👥',
  debtors: '📒',
  'purchases-ledger': '📦',
  'purchase-order': '📝',
  creditors: '🏦',
  invoice: '🧾',
  quotation: '📑',
  'inventory-ledger': '📋',
  'chart-of-accounts': '🗂️',
  trialbalance: '📖',
  'trial-balance': '⚖️',
  'balance-sheet': '🧮',
  vat: '🧾',
  'profit-asn-loss': '📈',
  'financial-samary': '💰',
  moneyflow: '💵',
  debts: '📒',
  inventory: '📦',
  expenses: '💸',
  'bank-loans': '🏦',
  assets: '🏠',
  payrol: '👔',
  budgeting: '🎯',
  'personal-accounting': '💰',
  deadline: '⏰',
  'activity-logs': '🕵️',
  settings: '⚙️',
}

// Renders BOTH icon packs and lets CSS decide which one is visible per
// breakpoint (mobile-first default = emoji, desktop media query in
// globals.css swaps to the GIF). This avoids any JS breakpoint-detection
// flicker and means the GIF <img> never even downloads on a phone —
// display:none images never enter the network/lazy-load queue.
export function NavIcon({ slug }) {
  return (
    <span className="menu-icon">
      <img className="menu-icon-gif" src={iconSrc(slug)} alt="" loading="lazy" />
      <span className="menu-icon-emoji" aria-hidden="true">{EMOJI_ICONS[slug] || '•'}</span>
    </span>
  )
}

// NAV is built from a function so labels re-translate whenever the
// active language changes (t comes from the component, not module scope).
function buildNav(t) {
  return [
    { type: 'item', label: t('nav.home'), icon: 'home', path: '/app' },
    { type: 'item', label: t('nav.pos'), icon: 'point-of-sale', path: '/app/pos', accountTypes: ['business', 'community'] },
    {
      type: 'group', label: t('nav.salesGroup'), key: 'sales', accountTypes: ['business', 'community'],
      children: [
        { label: t('nav.salesHistory'), icon: 'sales-history', path: '/app/sales' },
        { label: t('nav.customers'), icon: 'customers', path: '/app/customers' },
      ],
    },
    { type: 'item', label: t('nav.clientsDebtors'), icon: 'debtors', path: '/app/debtors' },
    {
      type: 'group', label: t('nav.purchasesGroup'), key: 'purchases', accountTypes: ['business', 'community'],
      children: [
        { label: t('nav.purchasesLedger'), icon: 'purchases-ledger', path: '/app/purchases' },
        { label: t('nav.purchaseOrders'), icon: 'purchase-order', path: '/app/purchase-orders' },
      ],
    },
    { type: 'item', label: t('nav.creditorsLedger'), icon: 'creditors', path: '/app/creditors' },
    {
      type: 'group', label: t('nav.proformaGroup'), key: 'proforma', accountTypes: ['business', 'community'],
      children: [
        { label: t('nav.invoices'), icon: 'invoice', path: '/app/invoices' },
        { label: t('nav.quotations'), icon: 'quotation', path: '/app/quotations' },
      ],
    },
    {
      type: 'group', label: t('nav.inventoryGroup'), key: 'inventory', accountTypes: ['business', 'community'],
      children: [
        { label: t('nav.inventoryLedger'), icon: 'inventory-ledger', path: '/app/inventory' },
      ],
    },
    {
      type: 'group', label: t('nav.accountingGroup'), key: 'accounting', accountTypes: ['business', 'community'],
      children: [
        { label: t('nav.chartOfAccounts'), icon: 'chart-of-accounts', path: '/app/accounting/chart-of-accounts' },
        { label: t('nav.generalLedger'), icon: 'trialbalance', path: '/app/accounting/general-ledger' },
        { label: t('nav.trialBalance'), icon: 'trial-balance', path: '/app/reports/trial-balance' },
        { label: t('nav.balanceSheet'), icon: 'balance-sheet', path: '/app/reports/balance-sheet' },
        { label: t('nav.vatReturn'), icon: 'vat', path: '/app/reports/vat-return' },
      ],
    },
    {
      type: 'group', label: t('nav.reportsGroup'), key: 'reports', accountTypes: ['business', 'community'],
      children: [
        { label: t('nav.profitLoss'), icon: 'profit-asn-loss', path: '/app/reports/profit-loss' },
        { label: t('nav.financialSummary'), icon: 'financial-samary', path: '/app/reports/financial-summary' },
        { label: t('nav.cashFlow'), icon: 'moneyflow', path: '/app/reports/cashflow' },
        { label: t('nav.debtorsReport'), icon: 'debts', path: '/app/reports/debtors' },
        { label: t('nav.creditorsReport'), icon: 'creditors', path: '/app/reports/creditors' },
        { label: t('nav.inventoryValuation'), icon: 'inventory', path: '/app/reports/inventory-valuation' },
      ],
    },
    { type: 'item', label: t('nav.expensesItem'), icon: 'expenses', path: '/app/expenses' },
    { type: 'item', label: t('nav.bankLoans'), icon: 'bank-loans', path: '/app/bank-loans' },
    { type: 'item', label: t('nav.assets'), icon: 'assets', path: '/app/assets' },
    { type: 'item', label: t('nav.payroll'), icon: 'payrol', path: '/app/payroll', accountTypes: ['business', 'community'] },
    { type: 'item', label: t('nav.budgets'), icon: 'budgeting', path: '/app/budgets', accountTypes: ['business', 'community'] },
    { type: 'item', label: t('nav.personal'), icon: 'personal-accounting', path: '/app/personal' },
    { type: 'item', label: t('nav.deadlines'), icon: 'deadline', path: '/app/deadlines' },
    { type: 'item', label: t('nav.activityLogsItem'), icon: 'activity-logs', path: '/app/activity', roles: ['manager', 'admin', 'superadmin'] },
    { type: 'item', label: t('nav.settingsItem'), icon: 'settings', path: '/app/settings' },
  ]
}

// Every nav icon is now a slug that maps to /public/icons/<slug>.gif —
// see ICON_SRC below for the actual file lookup used at render time.
function iconSrc(slug) {
  return `/icons/${slug}.gif`
}

// Static path -> translation key map, used by App.jsx to resolve page titles
// without needing the fully-built (and thus language-dependent) NAV array.
// Flat list of every leaf nav item (groups expanded), in the same order
// they appear in the sidebar — used by BottomNav so the phone tab bar can
// show every destination the sidebar has, not just a hand-picked subset.
export function buildFlatNav(t) {
  const flat = []
  buildNav(t).forEach((entry) => {
    if (entry.type === 'item') flat.push(entry)
    else entry.children.forEach((child) => flat.push({ ...child, accountTypes: entry.accountTypes, roles: entry.roles }))
  })
  return flat
}

export const PAGE_TITLE_KEYS = {
  '/app': 'nav.home',
  '/app/pos': 'nav.pos',
  '/app/sales': 'nav.salesHistory',
  '/app/customers': 'nav.customers',
  '/app/debtors': 'nav.clientsDebtors',
  '/app/purchases': 'nav.purchasesLedger',
  '/app/purchase-orders': 'nav.purchaseOrders',
  '/app/creditors': 'nav.creditorsLedger',
  '/app/invoices': 'nav.invoices',
  '/app/quotations': 'nav.quotations',
  '/app/inventory': 'nav.inventoryLedger',
  '/app/reports/profit-loss': 'nav.profitLoss',
  '/app/reports/financial-summary': 'nav.financialSummary',
  '/app/reports/cashflow': 'nav.cashFlow',
  '/app/reports/debtors': 'nav.debtorsReport',
  '/app/reports/creditors': 'nav.creditorsReport',
  '/app/reports/inventory-valuation': 'nav.inventoryValuation',
  '/app/reports/trial-balance': 'nav.trialBalance',
  '/app/reports/balance-sheet': 'nav.balanceSheet',
  '/app/reports/vat-return': 'nav.vatReturn',
  '/app/accounting/chart-of-accounts': 'nav.chartOfAccounts',
  '/app/accounting/general-ledger': 'nav.generalLedger',
  '/app/payroll': 'nav.payroll',
  '/app/budgets': 'nav.budgets',
  '/app/expenses': 'nav.expensesItem',
  '/app/bank-loans': 'nav.bankLoans',
  '/app/assets': 'nav.assets',
  '/app/personal': 'nav.personal',
  '/app/deadlines': 'nav.deadlines',
  '/app/activity': 'nav.activityLogsItem',
  '/app/settings': 'nav.settingsItem',
}

export default function Sidebar({ mobileOpen, onClose }) {
  const location = useLocation()
  const { guardedNavigate } = useNavigationGuard()
  const { user, account, logout } = useAuth()
  const [openGroups, setOpenGroups] = useState({})
  const { t } = useTranslation()
  const NAV = buildNav(t)

  useEffect(() => {
    NAV.forEach((entry) => {
      if (entry.type === 'group') {
        const isActive = entry.children.some((c) => c.path === location.pathname)
        if (isActive) setOpenGroups((prev) => ({ ...prev, [entry.key]: true }))
      }
    })
  }, [location.pathname]) // eslint-disable-line

  const go = (path) => {
    guardedNavigate(path)
    onClose?.()
  }

  const initials = (user?.full_name || user?.username || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="brand-logo">M</div>
        <div className="brand-text links_name">Moneytracer</div>
      </div>

      <nav className="sidebar-nav">
        {NAV.filter((entry) => !entry.roles || entry.roles.includes(user?.role))
          .filter((entry) => !entry.accountTypes || entry.accountTypes.includes(account?.account_type))
          .map((entry) => {
          if (entry.type === 'item') {
            const active = location.pathname === entry.path
            return (
              <div
                key={entry.path}
                className={`menu-item ${active ? 'active' : ''}`}
                onClick={() => go(entry.path)}
                title={entry.label}
              >
                <NavIcon slug={entry.icon} />
                <span className="links_name">{entry.label}</span>
              </div>
            )
          }
          const open = !!openGroups[entry.key]
          return (
            <div key={entry.key}>
              <div
                className="group-header"
                onClick={() => setOpenGroups((p) => ({ ...p, [entry.key]: !p[entry.key] }))}
                title={entry.label}
              >
                <span className="group-label links_name">{entry.label}</span>
                <span className={`chevron links_name ${open ? 'open' : ''}`}>›</span>
              </div>
              <div className={`group-children ${open ? 'open' : ''}`}>
                {entry.children.map((child) => {
                  const active = location.pathname === child.path
                  return (
                    <div
                      key={child.path}
                      className={`menu-item child ${active ? 'active' : ''}`}
                      onClick={() => go(child.path)}
                      title={child.label}
                    >
                      <NavIcon slug={child.icon} />
                      <span className="links_name">{child.label}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="avatar" title={user?.full_name || user?.username}>{initials}</div>
        <div className="links_name" style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.full_name || user?.username}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'capitalize' }}>{user?.role}</div>
        </div>
        <button
          onClick={logout}
          title={t('nav.logOut')}
          className="links_name"
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: '4px 6px',
                   color: 'var(--text-muted)', borderRadius: 6 }}
          onMouseEnter={(e) => e.currentTarget.style.color='var(--danger)'}
          onMouseLeave={(e) => e.currentTarget.style.color='var(--text-muted)'}
        >⏻</button>
      </div>
    </aside>
  )
}

