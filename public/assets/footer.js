const root = document.getElementById("footer-root");

if (root) {
  root.classList.add("footer");
  root.innerHTML = `
    <div class="shell">
      <div class="footer-panel">
        <div class="footer-grid">
          <div>
            <div class="footer-head">LIVENEW</div>
            <div class="footer-links">Reset-first stress regulation for a healthy daily rhythm.</div>
          </div>
          <div>
            <div class="footer-head">Platform</div>
            <div class="footer-links">
              <a href="/">Home</a>
              <a href="/day">Today</a>
            </div>
          </div>
          <div>
            <div class="footer-head">Resources</div>
            <div class="footer-links">
              <a href="/help">Help Center</a>
              <a href="/privacy">Privacy Policy</a>
              <a href="/terms">Terms of Service</a>
            </div>
          </div>
          <div>
            <div class="footer-head">Company</div>
            <div class="footer-links">
              <a href="/contact">Contact</a>
              <a href="/reset-access">Reset Access</a>
            </div>
          </div>
        </div>
        <div class="footer-bottom">© 2026 LiveNew. All rights reserved.</div>
      </div>
    </div>
  `;
}
