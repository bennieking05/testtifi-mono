
import React from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MainContent } from "@/components/layout/MainContent";

const Privacy = () => {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <MainContent>
        <div className="px-8 py-6">
          <h1 className="text-3xl font-bold mb-6 text-[#5674BC]">Privacy Policy</h1>
          
          <div className="space-y-6">
            <section>
              <h2 className="text-2xl font-semibold mb-3">1. Information We Collect</h2>
              <p className="text-gray-700">
                We collect information you provide directly to us, such as when you create or modify your account, request services, contact customer support, or otherwise communicate with us. This information may include your name, email address, phone number, postal address, and other contact or identifying information you choose to provide.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">2. How We Use Your Information</h2>
              <p className="text-gray-700">
                We use the information we collect to provide, maintain, and improve our services, process transactions, send communications, and personalize your experience.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">3. Information Sharing</h2>
              <p className="text-gray-700">
                We may share information as required by law, to protect rights and safety, or with your consent. We employ security measures to protect your data and provide options for managing your information.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">4. Data Security</h2>
              <p className="text-gray-700">
                We take reasonable measures to help protect information about you from loss, theft, misuse, and unauthorized access, disclosure, alteration, and destruction.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">5. Your Rights</h2>
              <p className="text-gray-700">
                You may have rights to access, correct, or delete your personal information. Contact us to exercise these rights or if you have questions about our privacy practices.
              </p>
            </section>
          </div>
        </div>
      </MainContent>
    </div>
  );
};

export default Privacy;
