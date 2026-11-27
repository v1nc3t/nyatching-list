// Hovering a cut-off title scrolls it back and forth (styles in theme.css).
// Markup: <span class="title-marquee"><span class="title-track">title</span></span>

export const startTitleMarquee = (event: Event) => {
  const marquee = event.currentTarget as HTMLElement
  const track = marquee.querySelector('.title-track') as HTMLElement | null
  if (!track) return

  const overflow = track.scrollWidth - marquee.clientWidth
  if (overflow <= 1) {
    marquee.classList.remove('is-overflowing')
    return
  }

  marquee.style.setProperty('--title-shift', `-${overflow}px`)
  marquee.style.setProperty('--title-duration', `${Math.min(10, Math.max(2.5, overflow / 45))}s`)
  marquee.classList.add('is-overflowing')
}

export const stopTitleMarquee = (event: Event) => {
  const marquee = event.currentTarget as HTMLElement
  marquee.classList.remove('is-overflowing')
}
