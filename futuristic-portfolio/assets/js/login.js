// pages/login.js

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('toggle');
  const pass = document.getElementById('pass');
  const form = document.getElementById('loginForm');

  // toggle show/hide password and notify spline scene
  toggle.addEventListener('click', () => {
    if (pass.type === 'password') {
      pass.type = 'text';
      toggle.textContent = 'Hide';
      // call global function in main script (sendHideEyes) or post directly to iframe
      if (window.parent && window.parent.sendHideEyes) {
        window.parent.sendHideEyes(true);
      } else {
        // try direct postMessage to login iframe
        const iframe = document.getElementById('splineFrameLogin');
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'hideEyes', value: true }, '*');
      }
    } else {
      pass.type = 'password';
      toggle.textContent = 'Show';
      if (window.parent && window.parent.sendHideEyes) {
        window.parent.sendHideEyes(false);
      } else {
        const iframe = document.getElementById('splineFrameLogin');
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'hideEyes', value: false }, '*');
      }
    }
  });

  // simple stub: intercept login and show toast (demo only)
  form.addEventListener('submit', e => {
    e.preventDefault();
    // replace this with real API call
    alert('Demo login — implement backend to authenticate.');
  });

  // login page: add load handling for iframe fallback
  const holder = document.getElementById('splineHolderLogin');
  const iframe = document.getElementById('splineFrameLogin');
  const fallback = holder.querySelector('.spline-fallback');

  iframe.addEventListener('load', () => {
    holder.classList.add('spline-loaded');
    setTimeout(()=> { if(fallback) fallback.style.display = 'none'; }, 700);
  }, { once: true });
});
