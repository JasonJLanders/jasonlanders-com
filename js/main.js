// jasonlanders.com — main.js

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// Nav background on scroll
const nav = document.querySelector('.nav');
window.addEventListener('scroll', () => {
  if (window.scrollY > 20) {
    nav.style.boxShadow = '0 1px 12px rgba(0,0,0,0.08)';
  } else {
    nav.style.boxShadow = 'none';
  }
});

// Newsletter form — basic validation
const form = document.querySelector('.newsletter-form form');
if (form) {
  form.addEventListener('submit', function(e) {
    const email = this.querySelector('input[type="email"]').value;
    if (!email || !email.includes('@')) {
      e.preventDefault();
      alert('Please enter a valid email address.');
    }
    // If valid, form submits to Beehiiv
  });
}
