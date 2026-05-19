/**
 * Analytics Configuration
 *
 * Uncomment and configure ONE of the options below to enable analytics.
 * The site will work normally if this file is empty or analytics fails to load.
 */

(function() {
  try {
    // ===== Plausible Analytics =====
    var script = document.createElement('script');
    script.async = true;
    script.src = 'https://plausible.io/js/pa-1E23ur5gghzXU6vzBVaTA.js';
    document.head.appendChild(script);
    window.plausible = window.plausible || function() {
      (plausible.q = plausible.q || []).push(arguments);
    };
    plausible.init = plausible.init || function(i) { plausible.o = i || {}; };
    plausible.init();

    // ===== OPTION 2: Google Analytics (GA4) =====
    // Uncomment and set your Measurement ID (G-XXXXXXXXXX):
    //
    // var gaId = 'G-XXXXXXXXXX';
    // var script = document.createElement('script');
    // script.async = true;
    // script.src = 'https://www.googletagmanager.com/gtag/js?id=' + gaId;
    // document.head.appendChild(script);
    // window.dataLayer = window.dataLayer || [];
    // function gtag(){dataLayer.push(arguments);}
    // gtag('js', new Date());
    // gtag('config', gaId);

    // ===== OPTION 3: Fathom Analytics =====
    // Uncomment and set your site ID:
    //
    // var script = document.createElement('script');
    // script.src = 'https://cdn.usefathom.com/script.js';
    // script.dataset.site = 'YOURSITEID';
    // script.defer = true;
    // document.head.appendChild(script);

  } catch (e) {
    // Analytics failed to load - site continues to work normally
    console.log('Analytics not loaded');
  }
})();
