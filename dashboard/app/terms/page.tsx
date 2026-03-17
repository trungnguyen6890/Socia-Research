export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6 text-neutral-700 text-[14px] leading-relaxed">
      <h1 className="text-2xl font-semibold text-neutral-900 mb-2">Terms of Service</h1>
      <p className="text-neutral-400 text-[13px] mb-8">Socia Research &mdash; Last updated: March 17, 2026</p>

      <section className="space-y-6">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">1. Acceptance of Terms</h2>
          <p>
            By accessing or using Socia Research (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service. The Service is operated by Trung Nguyen (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;).
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">2. Description of Service</h2>
          <p>
            Socia Research is a private research automation tool that collects, aggregates, and analyzes publicly available content from social media platforms and websites. The Service is intended for internal research and monitoring purposes only and is accessible to authorized administrators.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">3. Permitted Use</h2>
          <p className="mb-2">You may use the Service only for lawful purposes and in accordance with these Terms. You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use the Service to collect, store, or process private or non-public information without proper authorization.</li>
            <li>Violate any applicable local, national, or international law or regulation.</li>
            <li>Infringe upon the intellectual property rights or privacy rights of any third party.</li>
            <li>Attempt to gain unauthorized access to any part of the Service or its infrastructure.</li>
            <li>Use the Service to harass, abuse, or harm any individual or group.</li>
            <li>Circumvent or interfere with the security features of any connected platform.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">4. Third-Party Platform Compliance</h2>
          <p className="mb-2">
            The Service interacts with third-party platforms including Facebook, Instagram, YouTube, X (Twitter), and Telegram. By using the Service, you agree to comply with the terms of service and usage policies of each respective platform:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Meta (Facebook &amp; Instagram)</strong> — Meta Platform Terms and Developer Policies.</li>
            <li><strong>YouTube</strong> — YouTube Terms of Service and API Services Terms.</li>
            <li><strong>X / Twitter</strong> — X Terms of Service and Developer Agreement.</li>
            <li><strong>Telegram</strong> — Telegram Terms of Service and API Terms of Use.</li>
          </ul>
          <p className="mt-2">
            The Service collects only publicly available data in accordance with each platform&apos;s respective policies. We do not scrape private content or circumvent access controls.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">5. Data and Privacy</h2>
          <p>
            Your use of the Service is also governed by our <a href="/privacy" className="text-neutral-900 underline">Privacy Policy</a>, which is incorporated into these Terms by reference. We handle all collected data in accordance with applicable privacy laws, including the collection and processing of publicly available social media content.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">6. Intellectual Property</h2>
          <p>
            The Service, including its software, design, and original content, is owned by us and protected by applicable intellectual property laws. Content collected from third-party platforms remains the property of the respective platform or content creator. You may not reproduce, distribute, or create derivative works from the Service without our express written permission.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">7. Disclaimer of Warranties</h2>
          <p>
            The Service is provided &quot;as is&quot; and &quot;as available&quot; without warranties of any kind, either express or implied. We do not warrant that the Service will be uninterrupted, error-free, or free of harmful components. We make no guarantees regarding the accuracy, completeness, or timeliness of any data collected by the Service.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">8. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of, or inability to use, the Service. Our total liability for any claims arising under these Terms shall not exceed the amount paid by you for the Service, if any.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">9. Modifications to the Service</h2>
          <p>
            We reserve the right to modify, suspend, or discontinue the Service at any time without notice. We are not liable to you or any third party for any modification, suspension, or discontinuation of the Service.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">10. Changes to These Terms</h2>
          <p>
            We may update these Terms of Service from time to time. Any changes will be posted on this page with an updated &quot;Last updated&quot; date. Your continued use of the Service after any changes constitutes your acceptance of the new Terms.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">11. Governing Law</h2>
          <p>
            These Terms are governed by and construed in accordance with the laws of Vietnam, without regard to its conflict of law provisions. Any disputes arising under these Terms shall be subject to the exclusive jurisdiction of the courts of Vietnam.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">12. Contact Us</h2>
          <p>If you have any questions about these Terms of Service, please contact us at:</p>
          <p className="mt-2"><strong>Email:</strong> <a href="mailto:trungnguyen6890@gmail.com" className="text-neutral-900 underline">trungnguyen6890@gmail.com</a></p>
          <p className="text-neutral-500 mt-1">We aim to respond to all inquiries within 48 hours.</p>
        </div>
      </section>

      <div className="mt-12 pt-6 border-t border-neutral-200 text-[12px] text-neutral-400">
        Socia Research &mdash; Research Bot Platform &middot;{' '}
        <a href="/privacy" className="underline hover:text-neutral-600">Privacy Policy</a>
        {' '}&middot;{' '}
        <a href="/data-deletion" className="underline hover:text-neutral-600">Data Deletion</a>
      </div>
    </div>
  );
}
