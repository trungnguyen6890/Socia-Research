export default function DataDeletionPage() {
  return (
    <div className="max-w-3xl mx-auto py-12 px-6 text-neutral-700 text-[14px] leading-relaxed">
      <h1 className="text-2xl font-semibold text-neutral-900 mb-2">Data Deletion Request</h1>
      <p className="text-neutral-400 text-[13px] mb-8">Socia Research &mdash; User Data Deletion Instructions</p>

      <section className="space-y-6">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">How to Request Data Deletion</h2>
          <p>
            If you have logged in to Socia Research using your Facebook account, or if your publicly available content has been collected by our Service, you can request complete deletion of your data by following these steps:
          </p>
        </div>

        <div className="border border-neutral-200 rounded-lg divide-y divide-neutral-100">
          <div className="px-5 py-4 flex gap-4">
            <div className="w-7 h-7 rounded-full bg-neutral-900 text-white flex items-center justify-center text-[13px] font-medium shrink-0">1</div>
            <div>
              <p className="font-medium text-neutral-900">Send a deletion request via email</p>
              <p className="text-neutral-500 mt-1">
                Email us at <a href="mailto:trungnguyen6890@gmail.com" className="text-neutral-900 underline">trungnguyen6890@gmail.com</a> with the subject line <strong>&quot;Data Deletion Request&quot;</strong>.
              </p>
            </div>
          </div>
          <div className="px-5 py-4 flex gap-4">
            <div className="w-7 h-7 rounded-full bg-neutral-900 text-white flex items-center justify-center text-[13px] font-medium shrink-0">2</div>
            <div>
              <p className="font-medium text-neutral-900">Include your identification details</p>
              <p className="text-neutral-500 mt-1">
                In the email, please include your Facebook User ID, your name, or the URL of the content you want removed, so that we can locate and delete your data.
              </p>
            </div>
          </div>
          <div className="px-5 py-4 flex gap-4">
            <div className="w-7 h-7 rounded-full bg-neutral-900 text-white flex items-center justify-center text-[13px] font-medium shrink-0">3</div>
            <div>
              <p className="font-medium text-neutral-900">We process your request</p>
              <p className="text-neutral-500 mt-1">
                We will delete all data associated with your account or content within <strong>30 days</strong> of receiving your request, and send you a confirmation email once completed.
              </p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">What Data Will Be Deleted</h2>
          <p className="mb-2">Upon receiving your request, we will permanently delete:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Any content items collected from your public profiles or pages.</li>
            <li>Associated metadata including engagement metrics, tags, and scores.</li>
            <li>Run logs and processing records related to your content.</li>
            <li>Any account or authentication data if you logged in via Facebook.</li>
          </ul>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">Facebook Login Data</h2>
          <p>
            If you logged in using Facebook, you can also remove our app&apos;s access to your data directly from your Facebook account:
          </p>
          <ol className="list-decimal pl-6 space-y-1 mt-2">
            <li>Go to <strong>Facebook Settings &amp; Privacy</strong> &rarr; <strong>Settings</strong>.</li>
            <li>Navigate to <strong>Apps and Websites</strong>.</li>
            <li>Find <strong>Socia Research</strong> and click <strong>Remove</strong>.</li>
            <li>Check the box to <strong>Delete all posts, photos, and videos</strong> that Socia Research may have published on your behalf.</li>
          </ol>
          <p className="mt-2">
            Removing the app from Facebook revokes our access. To also delete data already stored in our system, please email us as described above.
          </p>
        </div>

        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900 mb-2">Contact</h2>
          <p>For any questions regarding data deletion:</p>
          <p className="mt-2"><strong>Email:</strong> <a href="mailto:trungnguyen6890@gmail.com" className="text-neutral-900 underline">trungnguyen6890@gmail.com</a></p>
          <p className="text-neutral-500 mt-1">We aim to respond to all requests within 48 hours.</p>
        </div>
      </section>

      <div className="mt-12 pt-6 border-t border-neutral-200 text-[12px] text-neutral-400">
        Socia Research &mdash; Research Bot Platform &middot; <a href="/privacy" className="underline hover:text-neutral-600">Privacy Policy</a>
      </div>
    </div>
  );
}
