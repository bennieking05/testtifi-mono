import React, { useState, useEffect } from "react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, CreditCard, Download, ExternalLink } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { UsageHistory } from "@/components/billing/UsageHistory";

interface Purchase {
  id: string;
  paymentIntent: string;
  amountCents: number;
  currency: string;
  creditsAdded: number;
  status: string;
  receiptUrl?: string;
  createdAt: string;
}

const Billing: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState<number>(0);
  
  const activeTab = searchParams.get("tab") || "purchases";

  useEffect(() => {
    const fetchBillingData = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          navigate("/login");
          return;
        }

        const apiBase = import.meta.env.VITE_API_URL || "";
        
        // Fetch user's current credits
        const creditsResponse = await fetch(`${apiBase}/api/user/credits`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        
        if (creditsResponse.ok) {
          const creditsData = await creditsResponse.json();
          setCredits(creditsData.credits || 0);
        } else if (creditsResponse.status === 404) {
          // Fallback to main user endpoint if credits endpoint doesn't exist
          const userResponse = await fetch(`${apiBase}/api/user`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
          
          if (userResponse.ok) {
            const userData = await userResponse.json();
            setCredits(userData.credits || 0);
          }
        }

        // Fetch user's purchase history
        const historyResponse = await fetch(`${apiBase}/api/purchase/user-history`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (historyResponse.ok) {
          const historyData = await historyResponse.json();
          setPurchases(historyData);
        } else if (historyResponse.status === 404) {
          // Endpoint doesn't exist yet, show empty state
          console.log("Purchase history endpoint not found, showing empty state");
          setPurchases([]);
        } else {
          console.error("Failed to fetch purchase history:", historyResponse.status, historyResponse.statusText);
          // Don't throw error, just show empty state
          setPurchases([]);
        }
      } catch (error) {
        console.error("Error fetching billing data:", error);
        toast.error("Failed to load billing information");
      } finally {
        setLoading(false);
      }
    };

    fetchBillingData();
  }, [navigate]);

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatAmount = (amountCents: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amountCents / 100);
  };

  const getStatusBadge = (status: string) => {
    const statusMap: { [key: string]: { variant: "default" | "secondary" | "destructive" | "outline"; label: string } } = {
      succeeded: { variant: "default", label: "Completed" },
      requires_payment_method: { variant: "secondary", label: "Pending" },
      requires_confirmation: { variant: "secondary", label: "Pending" },
      requires_action: { variant: "secondary", label: "Action Required" },
      processing: { variant: "secondary", label: "Processing" },
      requires_capture: { variant: "secondary", label: "Pending" },
      canceled: { variant: "destructive", label: "Canceled" },
      payment_failed: { variant: "destructive", label: "Failed" },
      refunded: { variant: "outline", label: "Refunded" },
      partially_refunded: { variant: "outline", label: "Partially Refunded" },
    };

    const statusInfo = statusMap[status] || { variant: "outline" as const, label: status };
    return (
      <Badge variant={statusInfo.variant}>
        {statusInfo.label}
      </Badge>
    );
  };

  if (loading) {
    return (
      <AuthenticatedLayout>
        <main className="flex-1 px-6 py-8 lg:px-8">
          <div className="max-w-7xl mx-auto">
            <div className="animate-pulse space-y-6">
              <div className="h-8 bg-muted rounded w-1/4"></div>
              <div className="h-4 bg-muted rounded w-1/2"></div>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-32 bg-muted rounded-lg"></div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </AuthenticatedLayout>
    );
  }

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-6 py-8 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <Button
              variant="ghost"
              onClick={() => navigate("/dashboard")}
              className="mb-6 -ml-2"
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Dashboard
            </Button>
            <div className="mb-8">
              <h1 className="text-4xl font-bold mb-3 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                Billing & Purchase History
              </h1>
              <p className="text-muted-foreground text-lg">
                Manage your account and view your purchase history.
              </p>
            </div>
          </div>

          {/* Current Credits */}
          <Card className="border-primary/20 shadow-lg">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-3 text-2xl">
                <div className="p-2 rounded-lg bg-primary/10">
                  <CreditCard className="h-6 w-6 text-primary" />
                </div>
                Current Credits
              </CardTitle>
              <CardDescription className="text-base">
                Your available summary credits
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="text-5xl font-bold text-primary mb-3">
                {credits.toLocaleString()}
              </div>
              <p className="text-muted-foreground mb-6">
                Use credits to create AI-powered deposition summaries
              </p>
              <Button 
                size="lg"
                onClick={() => navigate("/payment")}
                className="w-full sm:w-auto"
              >
                Purchase More Credits
              </Button>
            </CardContent>
          </Card>

          {/* Tabs for Purchase History and Usage History */}
          <Tabs value={activeTab} onValueChange={(value) => setSearchParams({ tab: value })} className="space-y-6">
            <TabsList className="grid w-full grid-cols-2 h-12">
              <TabsTrigger value="purchases" className="text-base">Purchase History</TabsTrigger>
              <TabsTrigger value="usage" className="text-base">Usage History</TabsTrigger>
            </TabsList>

            <TabsContent value="purchases" className="mt-0">
              <Card className="shadow-md">
                <CardHeader>
                  <CardTitle className="text-2xl">Purchase History</CardTitle>
                  <CardDescription className="text-base">
                    Your recent credit purchases and transactions
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  {purchases.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="inline-flex p-4 rounded-full bg-muted mb-4">
                        <CreditCard className="h-12 w-12 text-muted-foreground" />
                      </div>
                      <h3 className="text-xl font-semibold mb-2">No purchases yet</h3>
                      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                        You haven't made any purchases yet. Get started by purchasing credits.
                      </p>
                      <Button onClick={() => navigate("/payment")} size="lg">
                        Purchase Credits
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {purchases.map((purchase) => (
                        <div
                          key={purchase.id}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-5 border rounded-lg gap-4 hover:border-primary/30 transition-colors bg-card"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold">
                                {purchase.creditsAdded.toLocaleString()} Summary Credits
                              </h3>
                              {getStatusBadge(purchase.status)}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              <p>Amount: {formatAmount(purchase.amountCents, purchase.currency)}</p>
                              <p>Date: {formatDate(purchase.createdAt)}</p>
                              <p>Payment ID: {purchase.paymentIntent}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {purchase.receiptUrl && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => window.open(purchase.receiptUrl, "_blank")}
                              >
                                <Download className="h-4 w-4 mr-2" />
                                Receipt
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(`https://dashboard.stripe.com/payments/${purchase.paymentIntent}`, "_blank")}
                            >
                              <ExternalLink className="h-4 w-4 mr-2" />
                              View in Stripe
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="usage" className="mt-0">
              <UsageHistory />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </AuthenticatedLayout>
  );
};

export default Billing;
