// assets/js/script.js

/******************************************************
 * THROTTLE FUNCTION (keeps app smooth @60fps)
 ******************************************************/
function throttle(fn, wait) {
  let last = 0;
  return function (...args) {
    const now = Date.now();
    if (now - last >= wait) {
      last = now;
      fn(...args);
    }
  };
}


/******************************************************
 * MAIN FUNCTION FOR INDEX PAGE
 ******************************************************/
(function () {
  const holder = document.getElementById("splineHolder");
  if (!holder) return;

  const iframe = document.getElementById("splineFrame");
  const fallback = holder.querySelector(".spline-fallback");
  let iframeLoaded = false;

  /******************************************************
   * 1. LAZY LOAD via IntersectionObserver
   ******************************************************/
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !iframeLoaded) {
          iframeLoaded = true;
          // If iframe src is empty in HTML for performance, set it here:
          // iframe.src = "https://my.spline.design/robot..."; 
          
          iframe.addEventListener(
            "load",
            () => {
              holder.classList.add("spline-loaded");
              // hide fallback slowly
              setTimeout(() => {
                if (fallback) fallback.style.display = "none";
              }, 900);
            },
            { once: true }
          );
        }
      });
    },
    { threshold: 0.05 }
  );
  io.observe(holder);

  /******************************************************
   * 2. FULL-PAGE CURSOR TRACKING → Spline
   * Sends coordinates to iframe even if overlay blocks mouse
   ******************************************************/
  const sendCursor = throttle((e) => {
    if (!iframe || !iframe.contentWindow) return;

    // Normalize cursor coords to (-1..1)
    const nx = (e.clientX / window.innerWidth) * 2 - 1;
    const ny = -((e.clientY / window.innerHeight) * 2 - 1);

    // Send BOTH head & body messages (Custom Events)
    iframe.contentWindow.postMessage({ type: "cursorHeadFast", x: nx, y: ny }, "*");
    iframe.contentWindow.postMessage({ type: "cursorBodySlow", x: nx, y: ny }, "*");
  }, 16);

  // FULL PAGE tracking
  window.addEventListener("mousemove", sendCursor);

  // Touch support
  window.addEventListener(
    "touchmove",
    throttle((e) => {
      if (!e.touches || !e.touches.length) return;
      const t = e.touches[0];
      const nx = (t.clientX / window.innerWidth) * 2 - 1;
      const ny = -((t.clientY / window.innerHeight) * 2 - 1);
      iframe.contentWindow.postMessage({ type: "cursorHeadFast", x: nx, y: ny }, "*");
      iframe.contentWindow.postMessage({ type: "cursorBodySlow", x: nx, y: ny }, "*");
    }, 50),
    { passive: true }
  );

  /******************************************************
   * 3. login.js sends "sendHideEyes" → hide robot eyes
   ******************************************************/
  window.sendHideEyes = function (value) {
    if (!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "hideEyes", value: !!value }, "*");
  };

  /******************************************************
   * 4. Page intro animation trigger
   ******************************************************/
  window.addEventListener("load", () => {
    document.body.classList.add("site-ready");
    document.querySelectorAll(".lazy-load").forEach((el) => el.classList.add("visible"));
  });
})();

/* ---------- Enhancements: entrance animation + magnetic cursor orb + head-bob idle ---------- */
(function () {
  // Page entrance
  document.documentElement.classList.add("page-enter");
  window.addEventListener("load", () => {
    setTimeout(() => document.documentElement.classList.add("page-ready"), 120);
    setTimeout(() => document.documentElement.classList.add("page-ready-done"), 980);
  });

  // --- CURSOR ORB LOGIC ---
  // Check if orb exists in HTML, otherwise create it
  let orb = document.querySelector(".cursor-orb");
  if (!orb) {
    orb = document.createElement("div");
    orb.className = "cursor-orb";
    document.body.appendChild(orb);
  }
  
  // Make sure it's visible once script runs
  orb.style.display = "block"; 
  orb.style.opacity = "0";

  // track mouse for orb (smooth)
  let ox = 0, oy = 0;
  let tx = 0, ty = 0;
  const lerp = (a, b, t) => a + (b - a) * t;

  document.addEventListener("mousemove", (e) => {
    tx = e.clientX;
    ty = e.clientY;
    orb.style.opacity = "1";
  });

  function orbLoop() {
    ox = lerp(ox, tx, 0.28);
    oy = lerp(oy, ty, 0.28);
    
    // FIXED: Added backticks (`) for template literal
    orb.style.transform = `translate(${ox}px, ${oy}px) translate(-50%, -50%)`;
    
    requestAnimationFrame(orbLoop);
  }
  orbLoop();

  // Make orb shrink/grow on interactive elements
  const interactables = document.querySelectorAll("a, button, .btn-solid, .project-card, .nav a, .social-icons a");
  interactables.forEach((el) => {
    el.addEventListener("mouseenter", () => {
      orb.style.width = "36px";
      orb.style.height = "36px";
      orb.style.opacity = "0.96";
      orb.style.mixBlendMode = "difference"; // Cool effect
    });
    el.addEventListener("mouseleave", () => {
      orb.style.width = "18px";
      orb.style.height = "18px";
      orb.style.opacity = "0.88";
      orb.style.mixBlendMode = "normal";
    });
  });

  // Head-bob idle: send message to Spline to run a subtle bob loop
  let headBobOn = true;
  setInterval(() => {
    const iframe = document.getElementById("splineFrame");
    if (iframe && iframe.contentWindow && headBobOn) {
      iframe.contentWindow.postMessage({ type: "headBob", t: Date.now() }, "*");
    }
  }, 5600);

  // Robot aura toggle
  window.toggleRobotAura = function (on) {
    const holder = document.getElementById("splineHolder");
    if (!holder) return;
    holder.classList.toggle("robot-aura-on", !!on);
    holder.classList.toggle("robot-aura-off", !on);
    const iframe = document.getElementById("splineFrame");
    if (iframe && iframe.contentWindow)
      iframe.contentWindow.postMessage({ type: "robotAura", value: !!on }, "*");
  };

  // Robot shadow toggle
  window.toggleRobotShadow = function (on) {
    const holder = document.getElementById("splineHolder");
    if (!holder) return;
    holder.classList.toggle("robot-shadow-off", !on);
    const iframe = document.getElementById("splineFrame");
    if (iframe && iframe.contentWindow)
      iframe.contentWindow.postMessage({ type: "robotShadow", value: !!on }, "*");
  };

  // initialize: aura on & shadow on
  setTimeout(() => {
    if(window.toggleRobotAura) toggleRobotAura(true);
    if(window.toggleRobotShadow) toggleRobotShadow(true);
  }, 900);
})();

