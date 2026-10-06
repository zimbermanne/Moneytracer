import { useState, useEffect, Suspense, lazy } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from './hooks/useAuth.jsx'
import { NavigationGuardProvider } from './hooks/useNavigationGuard.jsx'
import { useApi } from './hooks/useApi.js'
import Sidebar, { PAGE_TITLE_KEYS } from './components/Sidebar.jsx'
import MobileTopBar from './components/MobileTopBar.jsx'
import BottomNav from './components/BottomNav.jsx'
import PageLoader from './components/PageLoader.jsx'
import PlatformBanner from './components/PlatformBanner.jsx'
import ServerStatusBanner from './components/ServerStatusBanner.jsx'
import SessionExpiredModal from './components/SessionExpiredModal.jsx'
import Clock from './Clock.jsx'
import LiquidGlassFilter from './components/LiquidGlassFilter.jsx'
// Landing and Login are the two screens almost everyone hits first (an
// anonymous visitor lands on one or the other), so they stay in the main
// bundle -- no loading flicker on the very first paint. Everything past
// that point is behind an auth check or a deliberate navigation anyway,
// so it's lazy-loaded: each page's JS is fetched only when its route is
// actually visited, instead of every page (Payroll, Budgets, Reports and
// its recharts dependency, PDF/thermal-printer code, etc.) all being
// forced into the one bundle every visitor downloads before anything
// renders. That single bundle was 1MB+ before this change -- a big chunk
// of the "sluggish, especially right after opening the app" feeling on
// mobile data.
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'

const Download = lazy(() => import('./pages/Download.jsx'))
const Legal = lazy(() => import('./pages/Legal.jsx'))
const FAQ = lazy(() => import('./pages/FAQ.jsx'))
const Register = lazy(() => import('./pages/Register.jsx'))
const QuickSignup = lazy(() => import('./pages/QuickSignup.jsx'))
const ForgotPassword = lazy(() => import('./pages/ForgotPassword.jsx'))
const ResetPassword = lazy(() => import('./pages/ResetPassword.jsx'))
const Onboarding = lazy(() => import('./pages/Onboarding.jsx'))
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'))
const POS = lazy(() => import('./pages/POS.jsx'))
const Inventory = lazy(() => import('./pages/Inventory.jsx'))
const Sales = lazy(() => import('./pages/Sales.jsx'))
const Purchases = lazy(() => import('./pages/Purchases.jsx'))
const PurchaseOrders = lazy(() => import('./pages/PurchaseOrders.jsx'))
const Expenses = lazy(() => import('./pages/Expenses.jsx'))
const Debtors = lazy(() => import('./pages/Debtors.jsx'))
const ARDashboard = lazy(() => import('./pages/ARDashboard.jsx'))
const Creditors = lazy(() => import('./pages/Creditors.jsx'))
const Reports = lazy(() => import('./pages/Reports.jsx'))
const Documents = lazy(() => import('./pages/Documents.jsx'))
const Customers = lazy(() => import('./pages/Customers.jsx'))
const Suppliers = lazy(() => import('./pages/Suppliers.jsx'))
const Settings = lazy(() => import('./pages/Settings.jsx'))
const ActivityLogs = lazy(() => import('./pages/ActivityLogs.jsx'))
const VerifyDocument = lazy(() => import('./pages/VerifyDocument.jsx'))
const BankLoans = lazy(() => import('./pages/BankLoans.jsx'))
const BankReconciliation = lazy(() => import('./pages/BankReconciliation.jsx'))
const Deadlines = lazy(() => import('./pages/Deadlines.jsx'))
const Assets = lazy(() => import('./pages/Assets.jsx'))
const Personal = lazy(() => import('./pages/Personal.jsx'))
const ChartOfAccounts = lazy(() => import('./pages/ChartOfAccounts.jsx'))
const GeneralLedger = lazy(() => import('./pages/GeneralLedger.jsx'))
const Payroll = lazy(() => import('./pages/Payroll.jsx'))
const Budgets = lazy(() => import('./pages/Budgets.jsx'))
const GroupLedger = lazy(() => import('./pages/GroupLedger.jsx'))
const Messages = lazy(() => import('./pages/Messages.jsx'))

function pageTitle(pathname, t) {
  const key = PAGE_TITLE_KEYS[pathname]
  return key ? t(key) : 'Moneytracer'
}

function Layout({ children }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const { user } = useAuth()
  const api = useApi()
  const { t } = useTranslation()
  const [company, setCompany] = useState(null)
  const [reminders, setReminders] = useState([])
  const [unreadMessages, setUnreadMessages] = useState(0)

  const loadUnreadMessages = () => {
    api.get('/messages/unread-count').then(data => setUnreadMessages(data.count || 0)).catch(() => {})
  }

  const loadReminders = () => {
    api.get('/reminders/').then(data => {
      // Deduplicate overdue alerts before setting state
      const map = new Map();
      const result = [];
      const loanRegex = /Payment to (.*) is due (\d+) day\(s\) overdue/;
      const invoiceRegex = /\((.*)\) is (\d+) day\(s\) overdue/;

      data.forEach(r => {
        const loanMatch = r.text.match(loanRegex);
        const invMatch = r.text.match(invoiceRegex);

        if (loanMatch || invMatch) {
          const entity = loanMatch ? loanMatch[1] : `Invoice (${invMatch[1]})`;
          const days = parseInt(loanMatch ? loanMatch[2] : invMatch[2], 10);

          const existing = map.get(entity);
          if (!existing || days > existing.days) {
            map.set(entity, { id: r.id, days, record: r });
          }
        } else {
          result.push(r);
        }
      });

      const deduplicated = [...result, ...Array.from(map.values()).map(v => v.record)];
      setReminders(deduplicated);
    }).catch(() => {})
  }

  useEffect(() => {
    api.get('/accounts/company-info').then(setCompany).catch(() => {})
    loadReminders()
    loadUnreadMessages()
    const id = setInterval(loadUnreadMessages, 60000) // check every minute
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const addReminder = (text) => {
    api.post('/reminders/', { text }).then((r) => setReminders((prev) => [r, ...prev])).catch(() => {})
  }

  const dismissReminder = (id) => {
    setReminders((prev) => prev.filter((r) => r.id !== id))
    api.patch(`/reminders/${id}/done`, {}).catch(loadReminders)
  }

  return (
    <div className="app-shell">
      {/* Ambient color blobs — give glass cards something to refract on flat pages */}
      <div className="app-blob app-blob-1" aria-hidden="true" />
      <div className="app-blob app-blob-2" aria-hidden="true" />
      <div className="app-blob app-blob-3" aria-hidden="true" />
      <MobileTopBar
        title={pageTitle(location.pathname, t)}
        open={mobileOpen}
        onToggle={() => setMobileOpen((o) => !o)}
        accountName={company?.name}
        accountRank={user?.role}
        reminders={reminders}
        onAddReminder={addReminder}
        onDismissReminder={dismissReminder}
        unreadMessages={unreadMessages}
      />
      <div className={`mobile-backdrop ${mobileOpen ? 'open' : ''}`} onClick={() => setMobileOpen(false)} />
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="main-content">
        <ServerStatusBanner />
        <PlatformBanner />
        {user?.profile_incomplete && location.pathname !== '/app/settings' && (
          <div style={{
            background: 'var(--warning-bg, #fff7e6)', color: 'var(--warning-text, #8a5a00)',
            padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
          }}>
            <span>👋 This account was created via the sign-up QR code. Add your name and email in Settings.</span>
            <a href="/app/settings" className="btn btn-outline" style={{ padding: '4px 12px', fontSize: 12 }}>Complete profile</a>
          </div>
        )}
        <div className="desktop-topbar">
          <Clock
            accountName={company?.name}
            accountRank={user?.role}
            reminders={reminders}
            onAddReminder={addReminder}
            onDismissReminder={dismissReminder}
            unreadMessages={unreadMessages}
          />
        </div>
        {children}
      </div>
      <BottomNav onMore={() => setMobileOpen(true)} />
    </div>
  )
}

function PrivateRoutes() {
  const { user, loading, account, accountLoading, accountError, refreshAccount, logout } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />

  // Only account admins go through onboarding; wait for the account to
  // load before deciding, so we don't flash the dashboard first.
  if (user.role === 'admin') {
    if (accountError) {
      return (
        <div className="login-screen">
          <div className="login-orb login-orb-shadow login-orb-1" />
          <div className="login-orb login-orb-shadow login-orb-2" />
          <div className="login-card" style={{ textAlign: 'center', maxWidth: 440, position: 'relative', zIndex: 10 }}>
            <h1 style={{ color: 'var(--danger-text, #c00)' }}>Something went wrong</h1>
            <div className="sub" style={{ margin: '8px 0 20px' }}>
              We couldn't prepare your account. This is usually due to a connection issue or an expired session.
            </div>
            <div className="error-text" style={{
              margin: '16px 0',
              padding: 12,
              background: 'rgba(255,0,0,0.05)',
              borderRadius: 8,
              fontSize: 13,
              fontFamily: 'monospace',
              wordBreak: 'break-all'
            }}>
              {accountError}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
              <button className="btn btn-primary" style={{ flex: 2 }} onClick={refreshAccount}>Retry</button>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={logout}>Logout</button>
            </div>
          </div>
        </div>
      )
    }
    if (accountLoading || account === null) return <PageLoader label="Preparing your account" />
    if (!account.onboarding_completed) return (
      <Suspense fallback={<PageLoader />}>
        <Onboarding />
      </Suspense>
    )
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pos" element={<POS />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/purchases" element={<Purchases />} />
        <Route path="/purchase-orders" element={<PurchaseOrders />} />
        <Route path="/expenses" element={<Expenses />} />
        <Route path="/debtors" element={<Debtors />} />
        <Route path="/creditors" element={<Creditors />} />
        <Route path="/reports/profit-loss" element={<Reports key="profit-loss" view="profit-loss" />} />
        <Route path="/reports/financial-summary" element={<Reports key="financial-summary" view="financial-summary" />} />
        <Route path="/reports/cashflow" element={<Reports key="cashflow" view="cashflow" />} />
        <Route path="/reports/debtors" element={<Reports key="debtors" view="debtors" />} />
        <Route path="/reports/debtors-aging" element={<Reports key="debtors-aging" view="debtors-aging" />} />
        <Route path="/reports/creditors" element={<Reports key="creditors" view="creditors" />} />
        <Route path="/reports/creditors-aging" element={<Reports key="creditors-aging" view="creditors-aging" />} />
        <Route path="/reports/inventory-valuation" element={<Reports key="inventory-valuation" view="inventory-valuation" />} />
        <Route path="/reports/trial-balance" element={<Reports key="trial-balance" view="trial-balance" />} />
        <Route path="/reports/balance-sheet" element={<Reports key="balance-sheet" view="balance-sheet" />} />
        <Route path="/reports/vat-return" element={<Reports key="vat-return" view="vat-return" />} />
        <Route path="/accounting/chart-of-accounts" element={<ChartOfAccounts />} />
        <Route path="/accounting/general-ledger" element={<GeneralLedger />} />
        <Route path="/payroll" element={<Payroll />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/invoices" element={<Documents kind="invoices" />} />
        <Route path="/quotations" element={<Documents kind="quotations" />} />
        <Route path="/customers" element={<Customers />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/activity" element={<ActivityLogs />} />
        <Route path="/bank-loans" element={<BankLoans />} />
        <Route path="/bank-reconciliation" element={<BankReconciliation />} />
        <Route path="/deadlines" element={<Deadlines />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/personal" element={<Personal />} />
        <Route path="/community/ledger" element={<GroupLedger />} />
        <Route path="*" element={<Navigate to="/app" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <LiquidGlassFilter />
      <NavigationGuardProvider>
        <SessionExpiredModal />
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/download" element={<Download />} />
          <Route path="/faq" element={<FAQ />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/legal/:doc" element={<Legal />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/quick-signup" element={<QuickSignup />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify/invoice/:id" element={<VerifyDocument kind="invoice" />} />
          <Route path="/verify/receipt/:id" element={<VerifyDocument kind="receipt" />} />
          <Route path="/app/*" element={<PrivateRoutes />} />
        </Routes>
        </Suspense>
      </NavigationGuardProvider>
    </AuthProvider>
  )
}
