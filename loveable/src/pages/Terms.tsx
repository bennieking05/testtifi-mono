
import React from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainContent } from "@/components/layout/MainContent";
import { DisclaimerNotice } from "@/components/layout/DisclaimerNotice";

const Terms = () => {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <MainContent>
        <div className="px-8 py-6">
          <h1 className="text-3xl font-bold mb-6 text-[#5674BC]">Terms of Service</h1>
          
          <div className="space-y-6">
            <section>
              <h2 className="text-2xl font-semibold mb-3">1. Acceptance of Terms</h2>
              <p className="text-gray-700">
                By accessing or using Testifi AI, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any of these terms, you are prohibited from using or accessing this site.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">2. Use License</h2>
              <p className="text-gray-700">
                Permission is granted to temporarily access the materials on Testifi AI's website for personal, non-commercial use only. This is the grant of a license, not a transfer of title, and under this license you may not:
              </p>
              <ul className="list-disc pl-6 mt-2 text-gray-700">
                <li>Modify or copy the materials</li>
                <li>Use the materials for any commercial purpose</li>
                <li>Attempt to decompile or reverse engineer any software contained on Testifi AI's website</li>
                <li>Remove any copyright or other proprietary notations from the materials</li>
                <li>Transfer the materials to another person or "mirror" the materials on any other server</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">3. Disclaimer</h2>
              <DisclaimerNotice className="mb-3 text-gray-700" />
              <p className="text-gray-700">
                The materials on Testifi AI's website are provided on an 'as is' basis. Testifi AI makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">4. Limitations</h2>
              <p className="text-gray-700">
                In no event shall Testifi AI or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on Testifi AI's website, even if Testifi AI or a Testifi AI authorized representative has been notified orally or in writing of the possibility of such damage.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">5. Revisions and Errata</h2>
              <p className="text-gray-700">
                The materials appearing on Testifi AI's website could include technical, typographical, or photographic errors. Testifi AI does not warrant that any of the materials on its website are accurate, complete, or current. Testifi AI may make changes to the materials contained on its website at any time without notice.
              </p>
            </section>
          </div>
        </div>
      </MainContent>
    </div>
  );
};

export default Terms;
