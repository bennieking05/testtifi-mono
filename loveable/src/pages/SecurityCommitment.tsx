
import React from "react";
import { Link } from "react-router-dom";
import { Sidebar } from "@/components/layout/Sidebar";
import { Footer } from "@/components/layout/Footer";
import { Menu, Shield, Lock, Server, Eye, Award, Users, FileCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

const SecurityCommitment = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900">
      <div className="fixed inset-0 pattern-grid-white opacity-30 pointer-events-none" />
      
      {/* Mobile menu button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSidebarOpen(true)}
          className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm shadow-lg border-white/50 dark:border-slate-700/50"
        >
          <Menu className="w-4 h-4" />
        </Button>
      </div>

      {/* Fixed Sidebar */}
      <Sidebar show={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      
      {/* Main Content Area with proper margin for sidebar */}
      <div className="flex flex-col flex-1 lg:ml-[286px] min-h-screen pt-16 lg:pt-0">
        <div className="flex-1 relative z-10">
          <div className="flex flex-col items-start p-6 w-full text-slate-800 dark:text-slate-200 max-md:p-4">
            
            {/* Professional Header */}
            <div className="flex items-center gap-3 mb-8">
              <div className="p-3 bg-gradient-to-br from-[#5674BC] to-[#4a65a7] rounded-xl shadow-lg">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold text-slate-900 dark:text-slate-100">Enterprise Security Commitment</h1>
                <p className="text-slate-600 dark:text-slate-400 mt-1">Protecting your confidential legal documents with military-grade security</p>
              </div>
            </div>

            <div className="max-w-4xl space-y-8">
              {/* Trust Indicators */}
              <div className="grid md:grid-cols-3 gap-4 mb-8">
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 text-center">
                  <Award className="w-8 h-8 text-blue-600 dark:text-blue-400 mx-auto mb-2" />
                  <h3 className="font-semibold text-blue-900 dark:text-blue-100">SOC 2 Compliant</h3>
                  <p className="text-xs text-blue-700 dark:text-blue-300">Annual third-party audits</p>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 text-center">
                  <Users className="w-8 h-8 text-green-600 dark:text-green-400 mx-auto mb-2" />
                  <h3 className="font-semibold text-green-900 dark:text-green-100">500+ Firms</h3>
                  <p className="text-xs text-green-700 dark:text-green-300">Trust our platform daily</p>
                </div>
                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4 text-center">
                  <FileCheck className="w-8 h-8 text-purple-600 dark:text-purple-400 mx-auto mb-2" />
                  <h3 className="font-semibold text-purple-900 dark:text-purple-100">HIPAA Ready</h3>
                  <p className="text-xs text-purple-700 dark:text-purple-300">Healthcare compliance</p>
                </div>
              </div>

              <p className="text-lg text-slate-700 dark:text-slate-300 leading-relaxed">
                We understand that your legal documents contain highly sensitive and privileged information. 
                That's why we've implemented enterprise-grade security measures that exceed industry standards 
                to protect your data throughout the entire processing lifecycle.
              </p>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-lg border border-white/50 dark:border-slate-700/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <Lock className="w-6 h-6 text-[#5674BC] dark:text-blue-400" />
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Military-Grade Encryption</h3>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 mb-3">
                    All files are encrypted using AES-256 encryption during upload, processing, and storage. 
                    Your data is protected both in transit (TLS 1.3) and at rest with enterprise key management.
                  </p>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• AES-256 encryption at rest</li>
                    <li>• TLS 1.3 encryption in transit</li>
                    <li>• Hardware security modules (HSMs)</li>
                  </ul>
                </div>

                <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-lg border border-white/50 dark:border-slate-700/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <Server className="w-6 h-6 text-[#5674BC] dark:text-blue-400" />
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Enterprise Infrastructure</h3>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 mb-3">
                    Our servers are hosted on AWS with SOC 2 Type II compliance, featuring multiple layers 
                    of security controls, 24/7 monitoring, and geographical redundancy.
                  </p>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• AWS SOC 2 Type II compliant infrastructure</li>
                    <li>• 24/7 security monitoring & incident response</li>
                    <li>• Multi-region backup and disaster recovery</li>
                  </ul>
                </div>

                <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-lg border border-white/50 dark:border-slate-700/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <Eye className="w-6 h-6 text-[#5674BC] dark:text-blue-400" />
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Zero-Access Architecture</h3>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 mb-3">
                    Our team cannot access your documents under any circumstances. All processing is fully automated, 
                    and files are automatically purged from all systems after 72 hours.
                  </p>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• Zero-knowledge architecture</li>
                    <li>• Automated processing only</li>
                    <li>• Automatic 72-hour file deletion</li>
                  </ul>
                </div>

                <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-lg border border-white/50 dark:border-slate-700/50 shadow-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <Shield className="w-6 h-6 text-[#5674BC] dark:text-blue-400" />
                    <h3 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Legal Compliance</h3>
                  </div>
                  <p className="text-slate-700 dark:text-slate-300 mb-3">
                    We maintain strict compliance with all relevant legal and privacy regulations, including 
                    attorney-client privilege protection and professional responsibility standards.
                  </p>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>• GDPR & CCPA compliant</li>
                    <li>• Attorney-client privilege protection</li>
                    <li>• Professional responsibility compliance</li>
                  </ul>
                </div>
              </div>

              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 border-l-4 border-[#5674BC] dark:border-blue-400 p-6 rounded-r-lg">
                <h3 className="text-xl font-semibold mb-3 text-[#5674BC] dark:text-blue-300">Our Enterprise Commitment</h3>
                <ul className="space-y-2 text-slate-700 dark:text-slate-300">
                  <li>• <strong>Automatic Security:</strong> Files are processed in isolated, encrypted environments and deleted within 72 hours</li>
                  <li>• <strong>No Human Access:</strong> Zero-knowledge architecture ensures no human ever views your confidential documents</li>
                  <li>• <strong>Bank-Level Security:</strong> Multi-layered security protocols exceed banking industry standards</li>
                  <li>• <strong>Complete Audit Trail:</strong> Comprehensive logging of all file access and processing activities for compliance</li>
                  <li>• <strong>Professional Indemnity:</strong> Fully insured with professional liability coverage for legal service providers</li>
                  <li>• <strong>24/7 Security Monitoring:</strong> Continuous threat detection and incident response capabilities</li>
                </ul>
              </div>

              {/* Compliance Certifications */}
              <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm p-6 rounded-lg border border-white/50 dark:border-slate-700/50 shadow-sm">
                <h3 className="text-xl font-semibold mb-4 text-slate-900 dark:text-slate-100">Security Certifications & Compliance</h3>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-2">Industry Standards</h4>
                    <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                      <li>• SOC 2 Type II Certified</li>
                      <li>• ISO 27001 Compliant</li>
                      <li>• PCI DSS Level 1</li>
                      <li>• NIST Cybersecurity Framework</li>
                    </ul>
                  </div>
                  <div>
                    <h4 className="font-medium text-slate-800 dark:text-slate-200 mb-2">Legal & Privacy</h4>
                    <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                      <li>• GDPR Article 32 Compliant</li>
                      <li>• CCPA Privacy Certified</li>
                      <li>• HIPAA Business Associate Ready</li>
                      <li>• State Bar Ethics Compliant</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="text-center pt-8">
                <p className="text-slate-600 dark:text-slate-400 mb-4">
                  Have questions about our security practices or need a custom security assessment?
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <Link
                    to="/support"
                    className="bg-[#5674BC] dark:bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors font-medium"
                  >
                    Contact Enterprise Security Team
                  </Link>
                  <Link
                    to="/dashboard"
                    className="border border-[#5674BC] dark:border-blue-400 text-[#5674BC] dark:text-blue-400 px-6 py-3 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors font-medium"
                  >
                    Return to Dashboard
                  </Link>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
                  For enterprise security inquiries: <a href="mailto:security@testifi.ai" className="text-[#5674BC] dark:text-blue-400 hover:underline">security@testifi.ai</a>
                </p>
              </div>
            </div>
          </div>
        </div>
        <Footer />
      </div>
    </div>
  );
};

export default SecurityCommitment;
