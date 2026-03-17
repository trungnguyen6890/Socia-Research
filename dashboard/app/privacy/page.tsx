export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6 text-neutral-700 text-[14px] leading-relaxed">
      <h1 className="text-2xl font-semibold text-neutral-900 mb-2">Privacy Policy</h1>
      <p className="text-neutral-400 text-[13px] mb-8">Last updated: March 17, 2026</p>

      <section className="space-y-6">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">1. Introduction</h2>
          <p>
            Socia Research (&quot;we&quot;, &quot;our&quot;, or &quot;the Service&quot;) is a research automation tool that collects and analyzes publicly available content from social media platforms and websites. This Privacy Policy explains how we collect, use, and protect information when you use our Service.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">2. Information We Collect</h2>
          <p className="mb-2">We collect the following types of information:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Publicly available content</strong> — Posts, articles, and media that are publicly accessible on social media platforms (Facebook, Instagram, X/Twitter, YouTube, Telegram) and websites.</li>
            <li><strong>Engagement metrics</strong> — Publicly visible statistics such as likes, comments, shares, and view counts.</li>
            <li><strong>Admin account data</strong> — Login credentials for administrators who manage the Service (stored securely as encrypted secrets).</li>
          </ul>
          <p className="mt-2">We do <strong>not</strong> collect private messages, non-public profile information, personal data of end users, or any data that requires special permissions beyond public access.</p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">3. How We Use Information</h2>
          <p className="mb-2">Collected information is used solely for:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Aggregating publicly available content for research and analysis purposes.</li>
            <li>Scoring and tagging content based on relevance to configured research goals.</li>
            <li>Detecting duplicate content to avoid redundant processing.</li>
            <li>Displaying collected data within the admin dashboard for authorized users only.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">4. Data Storage and Security</h2>
          <ul className="list-disc pl-6 space-y-1">
            <li>All data is stored on <strong>Cloudflare D1</strong> (SQLite-compatible database) within Cloudflare&apos;s global infrastructure.</li>
            <li>API keys and secrets are stored as <strong>encrypted Cloudflare Worker secrets</strong> and are never exposed in source code or client-side applications.</li>
            <li>The admin dashboard is protected by password authentication.</li>
            <li>All communications are encrypted via HTTPS/TLS.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">5. Data Sharing</h2>
          <p>
            We do <strong>not</strong> sell, rent, or share collected data with any third parties. Data is accessed only by authorized administrators of the Service. We do not use collected data for advertising or marketing purposes.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">6. Third-Party Services</h2>
          <p className="mb-2">The Service integrates with the following third-party platforms via their official APIs and public data:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Facebook / Meta</strong> — Public page content via Facebook Graph API.</li>
            <li><strong>Instagram</strong> — Public business/creator account content via Instagram Graph API.</li>
            <li><strong>YouTube</strong> — Public video data via YouTube Data API.</li>
            <li><strong>X / Twitter</strong> — Public posts via available APIs.</li>
            <li><strong>Telegram</strong> — Public channel content via Telegram Bot API.</li>
            <li><strong>Cloudflare</strong> — Infrastructure provider for hosting, database, and security.</li>
          </ul>
          <p className="mt-2">Each platform&apos;s own privacy policy governs the data they provide. We only access data in compliance with their respective terms of service and API policies.</p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">7. Data Retention</h2>
          <p>
            Collected content is retained in our database until manually deleted by an administrator. Administrators can delete individual content items, entire sources, or all data associated with a source at any time through the admin dashboard.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">8. User Rights</h2>
          <p className="mb-2">If you are a content creator whose publicly available content has been collected by the Service, you have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Request access</strong> — Ask what data we have collected related to your public content.</li>
            <li><strong>Request deletion</strong> — Ask us to remove your content from our database.</li>
            <li><strong>Opt out</strong> — Request that your public content no longer be collected by the Service.</li>
          </ul>
          <p className="mt-2">To exercise any of these rights, please contact us using the information in Section 11.</p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">9. Cookies</h2>
          <p>
            The Service uses minimal browser storage (localStorage) solely for maintaining admin session authentication. We do not use tracking cookies, analytics cookies, or any third-party cookie-based tracking.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">10. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Any changes will be reflected on this page with an updated &quot;Last updated&quot; date. Continued use of the Service after changes constitutes acceptance of the revised policy.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">11. Contact Us</h2>
          <p>
            If you have any questions about this Privacy Policy or wish to exercise your data rights, please contact us at:
          </p>
          <p className="mt-2">
            <strong>Email:</strong> trungnguyen6890@gmail.com
          </p>
        </div>
      </section>

      <div className="mt-12 pt-6 border-t border-neutral-200 text-[12px] text-neutral-400">
        Socia Research &mdash; Research Bot Platform
      </div>
    </div>
  );
}
