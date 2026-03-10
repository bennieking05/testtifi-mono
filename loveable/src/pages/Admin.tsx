
import React from "react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AdminSignups } from "@/components/admin/AdminSignups";
import { AdminPurchases } from "@/components/admin/AdminPurchases";
import { AdminDownloads } from "@/components/admin/AdminDownloads";
import { AdminSupport } from "@/components/admin/AdminSupport";
import { PurchaseDashboard } from "@/components/admin/PurchaseDashboard";

const Admin = () => {
  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-5 py-0 max-md:px-[15px] max-md:py-0 max-sm:px-2.5 max-sm:py-0">
        <header className="flex justify-between items-center px-0 py-[29px] max-sm:flex-col max-sm:items-start max-sm:gap-5">
          <div>
            <h1 className="text-[28px] font-bold mb-[5px] max-sm:text-2xl text-foreground">
              Admin Dashboard
            </h1>
            <p className="text-base text-muted-foreground max-sm:text-sm">
              Manage users, purchases, and support requests
            </p>
          </div>
        </header>

        <div className="w-64 h-px bg-border mx-0 my-0.5" />

        <div className="mt-10">
          <Tabs defaultValue="signups" className="w-full">
            <TabsList className="mb-6 flex w-full flex-wrap gap-2 overflow-x-auto">
              <TabsTrigger value="purchase-dashboard">
                Purchase Dashboard
              </TabsTrigger>
              <TabsTrigger value="purchases" className="text-slate-900 dark:text-slate-100 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Purchase History</TabsTrigger>
              <TabsTrigger value="signups" className="text-slate-900 dark:text-slate-100 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">User Sign-ups</TabsTrigger>
              <TabsTrigger value="downloads" className="text-slate-900 dark:text-slate-100 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Download History</TabsTrigger>
              <TabsTrigger value="support" className="text-slate-900 dark:text-slate-100 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700">Support Requests</TabsTrigger>
            </TabsList>
            <TabsContent value="purchase-dashboard">
              <PurchaseDashboard />
            </TabsContent>

            <TabsContent value="purchases">
              <AdminPurchases />
            </TabsContent>
            <TabsContent value="signups">
              <AdminSignups />
            </TabsContent>

            <TabsContent value="downloads">
              <AdminDownloads />
            </TabsContent>

            <TabsContent value="support">
              <AdminSupport />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default Admin;
