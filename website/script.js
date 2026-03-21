/* ============================================
   Indexa Marketing Website — script.js
   Minimal JS: scroll animations, terminal, copy
   ============================================ */

(function () {
  'use strict';

  // --- Scroll-triggered fade-in ---
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.fade-in').forEach((el) => observer.observe(el));

  // --- Navbar scroll effect ---
  const nav = document.querySelector('.nav');
  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y > 40) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
    lastScroll = y;
  }, { passive: true });

  // --- Mobile nav toggle ---
  const toggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (toggle && navLinks) {
    toggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      toggle.setAttribute('aria-expanded', navLinks.classList.contains('open'));
    });
    // Close on link click
    navLinks.querySelectorAll('a').forEach((a) => {
      a.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  // --- Terminal typing animation ---
  function animateTerminal() {
    const lines = document.querySelectorAll('.terminal-line');
    if (!lines.length) return;

    const delays = [0, 800, 1800, 2800, 3800];
    lines.forEach((line, i) => {
      setTimeout(() => {
        line.classList.add('shown');
      }, delays[i] || i * 900);
    });
  }

  // Start terminal animation when hero is visible
  const heroObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          animateTerminal();
          heroObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );
  const heroTerminal = document.querySelector('.hero-terminal');
  if (heroTerminal) heroObserver.observe(heroTerminal);

  // --- Copy buttons ---
  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const block = btn.closest('.code-block') || btn.closest('.terminal');
      if (!block) return;

      const codeEl = block.querySelector('.code-body') || block.querySelector('.terminal-body');
      if (!codeEl) return;

      // Get raw text content, clean up
      let text = codeEl.innerText
        .replace(/^\$\s*/gm, '')  // Remove prompt chars
        .replace(/^#.*$/gm, '')   // Remove comment lines
        .replace(/Copy(ed)?/g, '') // Remove copy button text if captured
        .trim();

      navigator.clipboard.writeText(text).then(() => {
        const originalHTML = btn.innerHTML;
        btn.classList.add('copied');
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Copied';
        setTimeout(() => {
          btn.classList.remove('copied');
          btn.innerHTML = originalHTML;
        }, 2000);
      });
    });
  });

  // --- Smooth scroll for anchor links ---
  document.querySelectorAll('a[href^="#"]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (id === '#') return;
      const target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // --- Animated counter for stats ---
  function animateCount(el, target, suffix) {
    const duration = 1500;
    const start = performance.now();
    const startVal = 0;

    function update(now) {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current = Math.round(startVal + (target - startVal) * eased);
      el.textContent = current.toLocaleString() + (suffix || '');
      if (progress < 1) requestAnimationFrame(update);
    }
    requestAnimationFrame(update);
  }

  const statObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = parseInt(el.dataset.count, 10);
          const suffix = el.dataset.suffix || '';
          animateCount(el, target, suffix);
          statObserver.unobserve(el);
        }
      });
    },
    { threshold: 0.5 }
  );

  document.querySelectorAll('[data-count]').forEach((el) => statObserver.observe(el));

})();
