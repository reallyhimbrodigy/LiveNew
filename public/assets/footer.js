const root = document.getElementById("footer-root");

if (root) {
  root.innerHTML = `
    <footer class="site-footer">
      <div class="site-footer__panel">
        <div class="site-footer__grid">
          <div>
            <div class="site-footer__title">LIVENEW</div>
            <div class="site-footer__links">Reset-first stress regulation for a healthy daily rhythm.</div>
          </div>
          <div>
            <div class="site-footer__title">Platform</div>
            <div class="site-footer__links">
              <a href="/">Home</a>
              <a href="/day">Today</a>
            </div>
          </div>
          <div>
            <div class="site-footer__title">Resources</div>
            <div class="site-footer__links">
              <a href="/help">Help Center</a>
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
            </div>
          </div>
          <div>
            <div class="site-footer__title">Company</div>
            <div class="site-footer__links">
              <a href="/contact">Contact</a>
              <a href="/reset-access">Reset Access</a>
            </div>
          </div>
        </div>
        <div class="site-footer__bottom">© 2026 LiveNew. All rights reserved.</div>
      </div>
    </footer>
  `;
}
