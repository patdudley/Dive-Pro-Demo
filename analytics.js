(function () {
  const config = window.DIVEPRO_ANALYTICS || {};
  const measurementId = String(config.ga4MeasurementId || "").trim();
  const isProductionHost = window.location.hostname === "diveproca.com";
  const consentKey = "divepro-analytics-choice-v1";
  let consent = "";
  try { consent = localStorage.getItem(consentKey) || ""; } catch (_) {}
  const privacySignal = navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  const measurementAllowed = consent === "yes" && !privacySignal;
  function privacyControls() {
    if (!isProductionHost) return;
    const style = document.createElement("style");
    style.textContent = `.dp-privacy-choice{position:fixed;z-index:10000;bottom:12px;left:12px;right:12px;max-width:560px;background:#fff;color:#173942;padding:20px;border:1px solid #ccc;border-radius:14px;box-shadow:0 4px 24px #0003;font:14px/1.5 system-ui}.dp-privacy-choice p{margin:0 0 12px}.dp-privacy-choice button,.dp-privacy-settings{font:inherit;padding:10px 14px;border:1px solid #52677a;border-radius:5px;background:white;color:#173942;cursor:pointer}.dp-privacy-choice button{margin:4px 8px 0 0;min-height:44px}.dp-privacy-settings{display:block;margin:22px auto;font:12px system-ui}`;
    document.head.appendChild(style);
    const settings = document.createElement("button");settings.className="dp-privacy-settings";settings.textContent="Privacy & analytics choices";document.body.appendChild(settings);
    function show() {
      document.querySelector(".dp-privacy-choice")?.remove();
      const panel=document.createElement("section");panel.className="dp-privacy-choice";panel.setAttribute("aria-label","Optional analytics");
      panel.innerHTML='<p><strong>Optional analytics</strong></p><p>Dive Pro uses Google Analytics cookies to understand which articles and conditions pages people use. We do not need analytics to show forecasts or maps. Our added events do not include feedback text, search text or contact details. Your choice is saved in this browser.</p><p><a href="/privacy.html">How measurement works</a></p>';
      if(privacySignal){const note=document.createElement("p");note.textContent="Your browser privacy signal is on, so analytics stays off.";panel.appendChild(note);}
      function choose(value){try{localStorage.setItem(consentKey,value);}catch(_){}window['ga-disable-'+measurementId]=true;panel.remove();if(value!==consent)window.location.reload();}
      if(!privacySignal){const yes=document.createElement("button");yes.textContent="Allow analytics";yes.onclick=()=>choose("yes");panel.appendChild(yes);}
      const no=document.createElement("button");no.textContent=consent==="yes"?"Turn analytics off":"No thanks";no.onclick=()=>choose("no");panel.appendChild(no);
      const close=document.createElement("button");close.textContent="Close";close.onclick=()=>panel.remove();panel.appendChild(close);document.body.appendChild(panel);
    }
    settings.onclick=show;if(!consent&&!privacySignal)show();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",privacyControls);else privacyControls();
  const isConfigured = measurementAllowed && isProductionHost && /^G-[A-Z0-9]+$/i.test(measurementId);

  window.diveproTrack = function (eventName, params) {
    if (!isConfigured || typeof window.gtag !== "function") return;
    const safe = {...(params || {})};
    // Never send mailto targets, query strings, fragment tokens, or free-form link text.
    if (safe.link_url) { try { const u=new URL(safe.link_url); if(!/^https?:$/.test(u.protocol))return;safe.link_url=u.origin+u.pathname; } catch (_) {return;} }
    if (safe.link_text) safe.link_text = "external link";
    window.gtag("event", eventName, safe);
  };

  if (!isConfigured) {
    window.DIVEPRO_ANALYTICS_STATUS = isProductionHost ? (measurementAllowed ? "not_configured" : "off_without_consent") : "disabled_non_production";
    return;
  }

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_referrer: (() => {try {const u=new URL(document.referrer);return u.origin+u.pathname;} catch (_) {return "";}})(),
    page_path: window.location.pathname,
    page_location: `${window.location.origin}${window.location.pathname}`,
  });
  window.DIVEPRO_ANALYTICS_STATUS = "configured";

  const path = window.location.pathname;
  const conditions = /^\/(?:la-jolla|monterey(?:-(?:mcabee|lovers|lobos|monastery))?|catalina-wrigley|anacapa-ocean)\.html$/;
  const article = /^\/blog\/[^/]+\/$/.test(path);
  if (conditions.test(path)) window.diveproTrack("conditions_view", {page_path:path});
  if (article) window.diveproTrack("article_view", {page_path:path});
  let activeSeconds=0,engaged=false;
  if(article)setInterval(()=>{
    if(document.visibilityState!=="visible"||!document.hasFocus())return;
    activeSeconds+=1;
    const root=document.querySelector(".post-article") || document.body;
    const rect=root.getBoundingClientRect();
    const depth=(window.innerHeight-rect.top)/Math.max(1,rect.height);
    if(!engaged&&activeSeconds>=45&&depth>=0.75){engaged=true;window.diveproTrack("article_engaged",{page_path:path,active_seconds:45,depth_percent:75});}
  },1000);
  document.addEventListener("click",event=>{
    const link=event.target.closest?.("a[href]");if(!link)return;
    let url;try{url=new URL(link.href,window.location.href);}catch(_){return;}
    if(url.origin!==window.location.origin)return;
    if(conditions.test(url.pathname))window.diveproTrack("conditions_open",{page_path:path,destination_path:url.pathname,placement:link.closest(".map-spot-pin")?"map_pin":article?"article":"site_link"});
    if(link.closest(".map-spot-pin"))window.diveproTrack("map_pin_open",{page_path:path,destination_path:url.pathname});
  });
  const scrollDepths = [25, 50, 75];
  const firedScrollDepths = new Set();
  let ticking = false;
  const trackScrollDepth = () => {
    ticking = false;
    const scrollable = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const viewportBottom = window.scrollY + window.innerHeight;
    const scrolled = scrollable > 0 ? (viewportBottom / scrollable) * 100 : 0;
    scrollDepths.forEach((percent) => {
      if (scrolled >= percent && !firedScrollDepths.has(percent)) {
        firedScrollDepths.add(percent);
        window.diveproTrack("scroll_depth", {
          percent,
          page_path: window.location.pathname,
        });
      }
    });
  };
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(trackScrollDepth);
  }, { passive: true });
  window.addEventListener("load", trackScrollDepth);

  document.addEventListener("click", (event) => {
    const link = event.target.closest?.("a[href]");
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin) {
      window.diveproTrack("outbound_link_click", {
        link_url: url.href,
        link_text: link.textContent.trim().slice(0, 80),
      });
    }
  });
}());
