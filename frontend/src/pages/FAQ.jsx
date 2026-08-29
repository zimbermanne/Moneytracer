import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import LanguageSwitcher from '../components/LanguageSwitcher'

function BlobBackground() {
  return (
    <div className="lg-blobs" aria-hidden="true">
      <div className="lg-blob lg-blob-1" />
      <div className="lg-blob lg-blob-2" />
      <div className="lg-blob lg-blob-3" />
    </div>
  )
}

function FAQItem({ question, answer }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`lg-faq-item ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
      <div className="lg-faq-question">
        <span>{question}</span>
        <span className="lg-faq-chevron">⌄</span>
      </div>
      {open && <div className="lg-faq-answer">{answer}</div>}
    </div>
  )
}

export default function FAQ() {
  const [scrolled, setScrolled] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const faqs = [
    {
      question: "What is Moneytracer?",
      answer: "Moneytracer is an all-in-one financial tool designed for small businesses, community savings groups (Chamas/VICOBA), and individuals. It helps you track sales, manage inventory, record community contributions, and handle personal budgeting—all without needing complex spreadsheets."
    },
    {
      question: "Is my data secure?",
      answer: "Yes. Every account is isolated and secured. We use industry-standard encryption for data at rest and in transit. Additionally, full activity logs are maintained so you can see exactly who made what changes and when."
    },
    {
      question: "How much does it cost?",
      answer: "Moneytracer is currently in Beta and is free to use for the first 90 days. We believe in pricing that makes sense for small businesses and communities. We will announce clear, affordable pricing plans well before the beta period ends."
    },
    {
      question: "Can I use it on my phone?",
      answer: "Absolutely. Moneytracer is built to be mobile-first and works beautifully in any mobile browser. You can also install it as a Progressive Web App (PWA) for an app-like experience with offline capabilities."
    },
    {
      question: "Can I switch between business, community, and personal tracking?",
      answer: "Yes! While you choose a primary track during signup to optimize your dashboard, Moneytracer allows you to manage multiple 'worlds' from one account. You can track your business sales during the day and log your personal dinner expense at night."
    },
    {
      question: "How do I get my data out of Moneytracer?",
      answer: "Your data belongs to you. You can export your reports (Profit & Loss, Balance Sheet, Inventory, etc.) and transaction lists to CSV format at any time from the Reports and Settings sections."
    },
    {
      question: "I need help. How can I contact support?",
      answer: "If you're logged into the app, you can use the 'Support' section in the sidebar to open a message thread with our team. For general inquiries, you can also reach us through our social media channels linked in the footer."
    }
  ]

  return (
    <div className="lg-page">
      <style>{`
        .lg-page {
          min-height: 100vh;
          font-family: var(--font-body);
          color: #fff;
          background: #0a0a1a;
          position: relative;
        }
        .lg-blobs { position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
        .lg-blob { position: absolute; border-radius: 50%; filter: blur(80px); opacity: 0.4; animation: lg-drift 20s infinite alternate; }
        .lg-blob-1 { width: 500px; height: 500px; background: #6c3bfa; top: -100px; left: -100px; }
        .lg-blob-2 { width: 400px; height: 400px; background: #1aa3ff; bottom: -50px; right: -50px; animation-delay: -5s; }
        .lg-blob-3 { width: 300px; height: 300px; background: #ff6db0; top: 40%; left: 20%; animation-delay: -10s; }

        @keyframes lg-drift {
          from { transform: translate(0,0) scale(1); }
          to { transform: translate(30px, 20px) scale(1.1); }
        }

        .lg-header { position: sticky; top: 0; z-index: 100; transition: all 0.3s; }
        .lg-header.scrolled { background: rgba(10,10,26,0.8); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255,255,255,0.1); }
        .lg-header-inner { max-width: 1200px; margin: 0 auto; padding: 18px 28px; display: flex; align-items: center; justify-content: space-between; }
        .lg-brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #fff; }
        .lg-brand-mark { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #7c5cfc, #3b82f6); display: flex; align-items: center; justify-content: center; font-weight: 900; }
        .lg-brand-name { font-size: 18px; font-weight: 700; }
        .lg-nav { display: flex; align-items: center; gap: 28px; font-size: 14px; }
        .lg-nav a { color: rgba(255,255,255,0.7); text-decoration: none; }
        .lg-nav-cta { background: linear-gradient(135deg, #7c5cfc, #3b82f6); padding: 9px 20px; border-radius: 12px; font-weight: 700; }

        .lg-content { position: relative; z-index: 1; max-width: 800px; margin: 0 auto; padding: 120px 24px 80px; }
        .lg-content h1 { font-size: clamp(2rem, 5vw, 3.5rem); font-weight: 900; text-align: center; margin-bottom: 16px; background: linear-gradient(to bottom, #fff, #b4a0ff); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .lg-content p.sub { text-align: center; color: rgba(255,255,255,0.6); margin-bottom: 60px; font-size: 1.1rem; }

        .lg-faq-list { display: flex; flex-direction: column; gap: 16px; }
        .lg-faq-item { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; cursor: pointer; transition: all 0.2s; overflow: hidden; }
        .lg-faq-item:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.2); }
        .lg-faq-item.open { background: rgba(255,255,255,0.07); border-color: rgba(124,92,252,0.4); }
        .lg-faq-question { padding: 20px 24px; display: flex; justify-content: space-between; align-items: center; font-weight: 600; font-size: 1.1rem; }
        .lg-faq-chevron { transition: transform 0.3s; opacity: 0.5; }
        .lg-faq-item.open .lg-faq-chevron { transform: rotate(180deg); }
        .lg-faq-answer { padding: 0 24px 24px; color: rgba(255,255,255,0.6); line-height: 1.6; font-size: 1rem; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 20px; }

        .lg-footer { max-width: 1200px; margin: 0 auto; padding: 40px 28px; border-top: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center; font-size: 13px; color: rgba(255,255,255,0.4); }
        .lg-footer-links { display: flex; gap: 20px; }
        .lg-footer-links a { color: inherit; text-decoration: none; }

        @media (max-width: 640px) {
          .lg-nav { display: none; }
          .lg-faq-question { font-size: 1rem; }
        }
      `}</style>

      <BlobBackground />

      <header className={`lg-header ${scrolled ? 'scrolled' : ''}`}>
        <div className="lg-header-inner">
          <Link to="/" className="lg-brand">
            <div className="lg-brand-mark">M</div>
            <span className="lg-brand-name">Moneytracer</span>
          </Link>
          <nav className="lg-nav">
            <Link to="/">Features</Link>
            <Link to="/download">App</Link>
            <Link to="/login">Log in</Link>
            <Link to="/register" className="lg-nav-cta">Get started</Link>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>

      <main className="lg-content">
        <h1>Help Center</h1>
        <p class="sub">Everything you need to know about Moneytracer. Can't find what you're looking for? Reach out to our support team.</p>

        <div className="lg-faq-list">
          {faqs.map((faq, i) => (
            <FAQItem key={i} question={faq.question} answer={faq.answer} />
          ))}
        </div>
      </main>

      <footer className="lg-footer">
        <div>© {new Date().getFullYear()} Moneytracer.</div>
        <div className="lg-footer-links">
          <Link to="/">Back to Home</Link>
          <Link to="/legal/tos">Terms</Link>
          <Link to="/legal/privacy">Privacy</Link>
        </div>
      </footer>
    </div>
  )
}
