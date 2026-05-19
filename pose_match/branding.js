/**
 * Centralized branding configuration.
 *
 * Edit the values below to customize the look of all pages.
 * This file injects CSS custom properties (variables) into the page,
 * which are referenced by the stylesheets in index.html, info.html, and about.html.
 *
 * Include this file via <script src="branding.js"></script> in the <head> of each page,
 * BEFORE any <style> blocks so the variables are available when styles are parsed.
 */
(function () {
  try {
    // ============== EDIT THESE VALUES ==============

    var brand = {
      // Typography (font files in branding/fonts/)
      fontFamily: '"Cooper Hewitt", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontPath: "branding/fonts/",  // path to self-hosted font files

      // Page background
      pageBg: "#f5f5f5",

      // Card / container styles
      cardBg: "#ffffff",
      cardShadow: "0 2px 4px rgba(0,34,53,0.1)",
      cardRadius: "8px",

      // Text colors
      textDark: "#002235",
      textLight: "#446a7f",

      // Accent color (buttons, links)
      accent: "#00f47b",
      accentHover: "#00d46b",
      accentText: "#002235",

      // Overlay background (e.g. floating buttons on canvas)
      overlayBg: "rgba(255, 255, 255, 0.9)",
      overlayBgHover: "#ffffff",

      // Images (stored in /branding folder)
      // Set to "" to disable any of these
      logo: "branding/logo.svg",
      logoBg: "#002235",  // background color behind the logo (useful for white logos)
      favicon: "branding/favicon.png",
      backgroundImage: "",  // e.g. "branding/background.png"
      backgroundRepeat: "no-repeat",
      backgroundSize: "cover",
      backgroundPosition: "center",
      logoLink: "https://www.glamelab.org/",
    };

    // ============== DO NOT EDIT BELOW ==============

    // @font-face declarations for self-hosted fonts
    var css = "";
    if (brand.fontPath) {
      css += "@font-face {\n";
      css += "  font-family: 'Cooper Hewitt';\n";
      css += "  src: url('" + brand.fontPath + "cooper-hewitt-light.woff2') format('woff2');\n";
      css += "  font-weight: 300;\n";
      css += "  font-style: normal;\n";
      css += "  font-display: swap;\n";
      css += "}\n";
      css += "@font-face {\n";
      css += "  font-family: 'Cooper Hewitt';\n";
      css += "  src: url('" + brand.fontPath + "cooper-hewitt-regular.woff2') format('woff2');\n";
      css += "  font-weight: 400;\n";
      css += "  font-style: normal;\n";
      css += "  font-display: swap;\n";
      css += "}\n";
      css += "@font-face {\n";
      css += "  font-family: 'Cooper Hewitt';\n";
      css += "  src: url('" + brand.fontPath + "cooper-hewitt-bold.woff2') format('woff2');\n";
      css += "  font-weight: 700;\n";
      css += "  font-style: normal;\n";
      css += "  font-display: swap;\n";
      css += "}\n";
    }

    // CSS custom properties
    css += ":root {\n";
    css += "  --brand-font-family: " + brand.fontFamily + ";\n";
    css += "  --brand-page-bg: " + brand.pageBg + ";\n";
    css += "  --brand-card-bg: " + brand.cardBg + ";\n";
    css += "  --brand-card-shadow: " + brand.cardShadow + ";\n";
    css += "  --brand-card-radius: " + brand.cardRadius + ";\n";
    css += "  --brand-text-dark: " + brand.textDark + ";\n";
    css += "  --brand-text-light: " + brand.textLight + ";\n";
    css += "  --brand-accent: " + brand.accent + ";\n";
    css += "  --brand-accent-hover: " + brand.accentHover + ";\n";
    css += "  --brand-accent-text: " + brand.accentText + ";\n";
    css += "  --brand-overlay-bg: " + brand.overlayBg + ";\n";
    css += "  --brand-overlay-bg-hover: " + brand.overlayBgHover + ";\n";
    if (brand.logoBg) {
      css += "  --brand-logo-bg: " + brand.logoBg + ";\n";
    }
    if (brand.backgroundImage) {
      css += "  --brand-bg-image: url('" + brand.backgroundImage + "');\n";
      css += "  --brand-bg-repeat: " + brand.backgroundRepeat + ";\n";
      css += "  --brand-bg-size: " + brand.backgroundSize + ";\n";
      css += "  --brand-bg-position: " + brand.backgroundPosition + ";\n";
    }
    css += "}\n";

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    // Set favicon if provided
    if (brand.favicon) {
      var link = document.querySelector("link[rel~='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = brand.favicon;
    }

    // Populate logo placeholders: any <img class="brand-logo"> gets its src set
    if (brand.logo) {
      document.addEventListener("DOMContentLoaded", function () {
        var logos = document.querySelectorAll(".brand-logo");
        for (var i = 0; i < logos.length; i++) {
          logos[i].src = brand.logo;
          logos[i].style.display = "";
          if (brand.logoLink) {
            var a = document.createElement("a");
            a.href = brand.logoLink;
            a.target = "_blank";
            logos[i].parentNode.insertBefore(a, logos[i]);
            a.appendChild(logos[i]);
          }
        }
      });
    }
  } catch (e) {
    // Branding failed silently — pages will use fallback values in their stylesheets
  }
})();
