import { useEffect, useRef, useState } from 'react'

/**
 * Swipeable row of metric cards — MOBILE ONLY. Desktop keeps the existing
 * .card-grid layout (see globals.css: .dashboard-carousel is hidden above
 * 768px, .dashboard-grid-desktop is hidden at/below it), since desktop
 * already has plenty of room and doesn't need the extra tap-to-scroll UX.
 *
 * items: [{ key, label, value, sub, badge, tone, onClick }]
 *   tone picks the gradient — one of 'blue' | 'green' | 'orange' | 'red' |
 *   'navy' | 'purple'. sub/badge are optional.
 */
export default function MetricCarousel({ items, sectionLabel }) {
  const trackRef = useRef(null)
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onScroll = () => {
      const card = el.querySelector('.metric-card')
      if (!card) return
      const gap = 12
      const idx = Math.round(el.scrollLeft / (card.offsetWidth + gap))
      setActiveIndex(Math.min(idx, items.length - 1))
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [items.length])

  const scrollByCard = (dir) => {
    const el = trackRef.current
    const card = el?.querySelector('.metric-card')
    if (!el || !card) return
    el.scrollBy({ left: dir * (card.offsetWidth + 12), behavior: 'smooth' })
  }

  if (!items || items.length === 0) return null

  return (
    <div className="dashboard-carousel">
      {sectionLabel && <div className="carousel-section-label">{sectionLabel}</div>}
      <div className="metric-carousel-wrap">
        <button type="button" className="carousel-arrow prev" onClick={() => scrollByCard(-1)} aria-label="Previous">‹</button>
        <div className="metric-carousel" ref={trackRef}>
          {items.map((item) => (
            <div
              key={item.key}
              className={`metric-card tone-${item.tone || 'blue'}`}
              onClick={item.onClick}
              style={item.onClick ? { cursor: 'pointer' } : undefined}
            >
              {item.badge && <div className="metric-badge">{item.badge}</div>}
              <div>
                <div className="metric-label">{item.label}</div>
                <div className="metric-value" style={item.valueFontSize ? { fontSize: item.valueFontSize } : undefined}>
                  {item.value}
                </div>
                {item.sub && <div className="metric-sub">{item.sub}</div>}
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="carousel-arrow next" onClick={() => scrollByCard(1)} aria-label="Next">›</button>
      </div>
      <div className="carousel-dots">
        {items.map((item, i) => (
          <div key={item.key} className={`carousel-dot ${i === activeIndex ? 'active' : ''}`} />
        ))}
      </div>
    </div>
  )
}
