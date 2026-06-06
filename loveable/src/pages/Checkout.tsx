// File: src/components/checkout/Checkout.tsx

import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Plus, Minus } from "lucide-react";
import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import { StripeCheckoutForm } from "@/components/payment/StripeCheckoutForm";
import { Toaster } from "@/components/ui/toaster";

// Tiered pricing helper
const getTierPricing = (quantity: number) => {
  if (quantity >= 50) return 100.0;
  if (quantity >= 25) return 110.0;
  if (quantity >= 10) return 120.0;
  return 125.0; // 1–9 credits
};

const TAX_RULES: Record<string, { rate: number; label: string }> = {
  TX: { rate: 0.0825, label: "Texas Sales Tax (8.25%)" },
  TEXAS: { rate: 0.0825, label: "Texas Sales Tax (8.25%)" },
};

const TEXAS_ZIP_PREFIXES = ["75", "76", "77", "78", "79"];

const normalizeState = (state?: string) => state?.trim().toUpperCase() ?? "";

const getTaxRuleForLocation = (state?: string, zip?: string) => {
  const normalizedState = normalizeState(state);
  if (normalizedState && TAX_RULES[normalizedState]) {
    return TAX_RULES[normalizedState];
  }
  if (!normalizedState && zip) {
    const matchesTexas = TEXAS_ZIP_PREFIXES.some((prefix) => zip.startsWith(prefix));
    if (matchesTexas) {
      return TAX_RULES.TX;
    }
  }
  return null;
};

// Stripe publishable key loaded from environment at build time
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY!);

const Checkout: React.FC = () => {
  const location = useLocation() as { state?: any };
  const navigate = useNavigate();

  // plan payload from /payment, or default plan if accessed directly
  const basePlan = location.state?.plan as
    | { id: string; name: string; credits: number; price: number }
    | undefined;
  const returnTo = location.state?.returnTo as string | undefined;

         // Default plan if accessed directly
         const defaultPlan = { id: "custom", name: "Custom Package", credits: 10, price: 50 };
         const effectivePlan = basePlan || defaultPlan;

         const [quantity, setQuantity] = useState(effectivePlan?.credits ?? 10);
  const [billingAddress, setBillingAddress] = useState<{ zipCode: string; state?: string }>({
    zipCode: "",
    state: "",
  });
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentIntentId, setPaymentIntentId] = useState<string | null>(null);
  const [isLoadingSecret, setIsLoadingSecret] = useState(true);
  const [secretError, setSecretError] = useState<string | null>(null);
  
  // Track the last amount we sent to the payment intent to avoid unnecessary updates
  const lastAmountRef = React.useRef<number | null>(null);
  // Track if we're updating (vs creating) to prevent form clearing
  const isUpdatingRef = React.useRef<boolean>(false);

  // pricing calculations - moved before useEffect to avoid temporal dead zone
  const unitPrice = getTierPricing(quantity);
  const subtotal = unitPrice * quantity;
  const activeTaxRule = getTaxRuleForLocation(billingAddress.state, billingAddress.zipCode);
  const salesTax = activeTaxRule ? subtotal * activeTaxRule.rate : 0;
  const totalPrice = subtotal + salesTax;
  const taxLabel = activeTaxRule?.label;

  // Create payment intent only if one doesn't exist
  useEffect(() => {
    if (paymentIntentId) return; // Don't create if we already have one
    
    const controller = new AbortController();
    setIsLoadingSecret(true);
    setSecretError(null);
    (async () => {
      try {
        const apiBase = import.meta.env.VITE_API_URL || "";
        const res = await fetch(`${apiBase}/api/purchase/purchase-credits`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            amountCents: Math.round(totalPrice * 100), // Include tax in payment intent
            credits: quantity,
            taxCents: Math.round(salesTax * 100),
            taxLabel,
          }),
          signal: controller.signal,
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: "Failed to parse error" }));
          throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
        }
        
        const data = await res.json();
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
          setPaymentIntentId(data.paymentIntentId || null);
          // Reset the last amount ref when creating a new payment intent
          lastAmountRef.current = Math.round(totalPrice * 100);
          setSecretError(null);
        } else {
          setSecretError("Missing clientSecret in response");
          console.error("Missing clientSecret in response:", data);
        }
      } catch (err) {
        if ((err as any).name !== "AbortError") {
          const errorMessage = (err as Error).message || "Failed to initialize payment";
          setSecretError(errorMessage);
          console.error("Failed to fetch clientSecret:", err);
        }
      } finally {
        setIsLoadingSecret(false);
      }
    })();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectivePlan]); // Only create on initial mount or plan change

  // Update payment intent when quantity or tax changes (debounced to avoid form clearing)
  useEffect(() => {
    if (!paymentIntentId || !clientSecret) return;
    
    const newAmountCents = Math.round(totalPrice * 100);
    
    // Skip update if amount hasn't changed significantly (avoid rounding differences)
    if (lastAmountRef.current !== null && Math.abs(lastAmountRef.current - newAmountCents) < 1) {
      return;
    }
    
    // Mark that we're updating to prevent form clearing
    isUpdatingRef.current = true;
    
    // Debounce updates - only update after user stops changing quantity/tax for 300ms
    const timeoutId = setTimeout(async () => {
      try {
        const apiBase = import.meta.env.VITE_API_URL || "";
        const res = await fetch(`${apiBase}/api/purchase/update-payment-intent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
          body: JSON.stringify({
            paymentIntentId,
            amountCents: newAmountCents,
            credits: quantity, // Update credits in payment intent metadata
            taxCents: Math.round(salesTax * 100),
            taxLabel,
          }),
        });
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: "Failed to parse error" }));
          console.warn("Failed to update payment intent:", errorData.error);
          return;
        }
        
        const data = await res.json();
        if (data.clientSecret) {
          // Update client secret - Elements will handle this without clearing form
          // because we're using a stable key (paymentIntentId)
          setClientSecret(data.clientSecret);
          lastAmountRef.current = newAmountCents;
        }
      } catch (err) {
        console.warn("Error updating payment intent:", err);
        // Don't show error to user - payment will still work with original amount
      } finally {
        isUpdatingRef.current = false;
      }
    }, 300); // Reduced debounce time for quantity changes

    return () => {
      clearTimeout(timeoutId);
      isUpdatingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity, salesTax, paymentIntentId]); // Update when quantity or tax changes

  // Remove the basePlan check since we now have effectivePlan

  const increment = () => setQuantity((q) => q + 1);
  const decrement = () => setQuantity((q) => Math.max(1, q - 1));

  const getTierName = (q: number) => {
    if (q >= 50) return "Enterprise Tier";
    if (q >= 25) return "Premium Tier";
    if (q >= 10) return "Professional Tier";
    return "Individual Tier";
  };

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-5 pb-8 pt-16 lg:pt-6">
        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/payment")}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to Plans
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/dashboard">Dashboard</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/summaries">Summaries</Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            You can leave checkout anytime using Dashboard or Summaries — your cart is not saved until payment completes.
          </p>
          <h1 className="text-3xl font-bold mb-2">Checkout Summary Credits</h1>
          <p className="text-slate-600 mb-6">
            Select your quantity and complete your purchase.
          </p>

          {/* Quantity selector */}
          <div className="bg-card p-6 rounded-lg shadow mb-6">
            <h3 className="font-semibold mb-4">Select Quantity</h3>
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={decrement}
                disabled={quantity <= 1}
              >
                <Minus />
              </Button>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) =>
                  setQuantity(Math.max(1, Number(e.target.value)))
                }
                className="w-16 text-center border"
              />
              <Button variant="ghost" size="sm" onClick={increment}>
                <Plus />
              </Button>
              <span className="ml-4">
                {getTierName(quantity)} – ${unitPrice.toFixed(2)} each
              </span>
            </div>
          </div>

          {/* Price summary */}
        <div className="bg-muted p-4 rounded-lg border mb-8">
            <div className="flex justify-between">
              <span>Subtotal ({quantity}):</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {salesTax > 0 && (
              <div className="flex justify-between">
                <span>{taxLabel ?? "Sales Tax"}:</span>
                <span>${salesTax.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold mt-2 border-t pt-2">
              <span>Total:</span>
              <span>${totalPrice.toFixed(2)}</span>
            </div>
          </div>
        </header>

        {/* Stripe Elements + CardElement */}
        {isLoadingSecret ? (
          <div className="max-w-2xl mx-auto p-6 bg-card rounded-lg shadow text-center">
            <p className="text-slate-600 dark:text-slate-300">Loading payment form...</p>
          </div>
        ) : secretError ? (
          <div className="max-w-2xl mx-auto p-6 bg-card rounded-lg shadow border border-red-200 dark:border-red-800">
            <div className="text-red-600 dark:text-red-400 mb-4">
              <p className="font-semibold mb-2">Error loading payment form</p>
              <p className="text-sm">{secretError}</p>
            </div>
            <Button
              onClick={() => {
                setSecretError(null);
                setIsLoadingSecret(true);
                // Trigger useEffect by updating a dependency
                setQuantity((q) => q);
              }}
              variant="outline"
            >
              Retry
            </Button>
          </div>
        ) : clientSecret ? (
          <div className="max-w-2xl mx-auto p-6 bg-card rounded-lg shadow">
            {/* Use paymentIntentId as stable key to prevent remounting when clientSecret updates */}
            <Elements
              key={paymentIntentId || "initial"} 
              stripe={stripePromise} 
              options={{ clientSecret }}
            >
              <StripeCheckoutForm
                clientSecret={clientSecret!}
                planId={"custom"}
                amount={totalPrice}
                planName={`${quantity} Summary Credits`}
                credits={quantity}
                returnTo={returnTo}
                onBillingAddressChange={(address) =>
                  setBillingAddress((prev) => ({
                    zipCode: address.zipCode ?? prev.zipCode,
                    state: address.state ?? prev.state,
                  }))
                }
              />
            </Elements>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto p-6 bg-card rounded-lg shadow text-center">
            <p className="text-slate-600 dark:text-slate-300">Unable to load payment form. Please try again.</p>
          </div>
        )}

        <Toaster />
      </main>
    </AuthenticatedLayout>
  );
};

export default Checkout;
