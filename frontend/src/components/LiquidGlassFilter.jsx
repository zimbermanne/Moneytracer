/**
 * Mounts the SVG <filter> definitions that power the app's liquid-glass
 * surfaces (replaces the old flat frosted-glass look).
 *
 * Render this ONCE near the root of the app (see App.jsx) — every
 * .card / .sidebar / .modal / input etc. references it by id via the
 * --glass-blur token in design-tokens.css, so one mount serves the
 * whole app. It renders nothing visible itself (0x0, aria-hidden).
 *
 * Full Apple-style treatment: feTurbulence-driven procedural distortion
 * (no embedded raster asset, keeps bundle size down) + a 3-channel
 * chromatic-aberration split + a specular highlight pass for the "wet
 * glass" light catch along curved edges.
 *
 * Perf notes:
 * - Procedural feTurbulence instead of a baked-in base64 noise image —
 *   same visual family, no ~10kb inline asset per filter.
 * - Consumers apply `contain: strict` + `will-change: transform` on the
 *   filtered element (already done for .card/.sidebar/.modal in
 *   globals.css) to isolate paint and keep this off the main thread's
 *   critical path.
 * - Respects prefers-reduced-motion by disabling the (optional) subtle
 *   turbulence animation — see the CSS in globals.css.
 */
export default function LiquidGlassFilter() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        {/* ---- Base distortion field --------------------------------
            Procedural fractal noise standing in for a baked displacement
            map. baseFrequency/numOctaves tuned for a gentle, glassy
            ripple rather than a busy/noisy texture. */}
        <filter id="liquid-glass-filter" color-interpolation-filters="sRGB" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.008 0.012"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="2" result="softNoise" />

          {/* ---- Chromatic aberration: displace R/G/B channels by
              slightly different amounts, then screen-blend back
              together — this is what sells "refraction" rather than
              a flat blur. ---- */}
          <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="14" xChannelSelector="R" yChannelSelector="G" result="dispRed" />
          <feColorMatrix in="dispRed" type="matrix"
            values="1 0 0 0 0
                    0 0 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0" result="red" />

          <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="17" xChannelSelector="R" yChannelSelector="G" result="dispGreen" />
          <feColorMatrix in="dispGreen" type="matrix"
            values="0 0 0 0 0
                    0 1 0 0 0
                    0 0 0 0 0
                    0 0 0 1 0" result="green" />

          <feDisplacementMap in="SourceGraphic" in2="softNoise" scale="20" xChannelSelector="R" yChannelSelector="G" result="dispBlue" />
          <feColorMatrix in="dispBlue" type="matrix"
            values="0 0 0 0 0
                    0 0 0 0 0
                    0 0 1 0 0
                    0 0 0 1 0" result="blue" />

          <feBlend in="red" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blue" mode="screen" result="chroma" />

          {/* ---- Specular highlight: a soft directional light catch
              along the distortion field, giving the "wet glass" sheen
              on curved corners. Kept subtle (low surfaceScale) so it
              reads as a highlight, not a glare. ---- */}
          <feSpecularLighting in="softNoise" surfaceScale="3" specularConstant="0.55" specularExponent="12" lightingColor="#ffffff" result="specular">
            <feDistantLight azimuth="235" elevation="60" />
          </feSpecularLighting>
          <feComposite in="specular" in2="chroma" operator="in" result="specularClipped" />
          <feComposite in="chroma" in2="specularClipped" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="withSpecular" />

          <feGaussianBlur in="withSpecular" stdDeviation="0.6" />
        </filter>

        {/* ---- Lighter variant for small/frequent elements (badges,
            inputs, buttons) where the full chromatic pass is overkill
            and the extra filter cost adds up across many instances on
            one page. Single displacement, no channel split. ---- */}
        <filter id="liquid-glass-filter-sm" color-interpolation-filters="sRGB" x="-15%" y="-15%" width="130%" height="130%">
          <feTurbulence type="fractalNoise" baseFrequency="0.01 0.015" numOctaves="2" seed="7" result="noiseSm" />
          <feGaussianBlur in="noiseSm" stdDeviation="1.5" result="softNoiseSm" />
          <feDisplacementMap in="SourceGraphic" in2="softNoiseSm" scale="8" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}
