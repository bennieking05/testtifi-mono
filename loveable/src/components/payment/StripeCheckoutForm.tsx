// File: src/components/payment/StripeCheckoutForm.tsx
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { CardElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import api from "@/lib/axios";

interface StripeCheckoutFormProps {
  clientSecret: string;
  planId: string;
  amount: number;
  planName: string;
  credits: number;
  returnTo?: string;
  onBillingAddressChange?: (address: { zipCode: string; state?: string }) => void;
}

type CachedUser = { credits?: number } & Record<string, unknown>;

export const StripeCheckoutForm: React.FC<StripeCheckoutFormProps> = ({
  clientSecret,
  planId,
  amount,
  planName,
  credits,
  returnTo,
  onBillingAddressChange,
}) => {
  const stripe = useStripe();
  const elements = useElements();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(false);
  // clientSecret now provided by parent
  const [billingDetails, setBillingDetails] = useState({
    name: "",
    firmName: "",
    email: "",
    address: {
      line1: "",
      city: "",
      state: "",
      postal_code: "",
      country: "US", // default to US
    },
  });

  // Notify parent component when postal code changes
  useEffect(() => {
    if (onBillingAddressChange) {
      onBillingAddressChange({
        zipCode: billingDetails.address.postal_code,
        state: billingDetails.address.state,
      });
    }
  }, [billingDetails.address.postal_code, billingDetails.address.state, onBillingAddressChange]);

  // remove internal PaymentIntent creation

  // Watch for theme changes to style CardElement correctly in dark mode
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements || !clientSecret) {
      setError("Stripe not ready or payment not initialized.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      setError("Card information is required");
      setIsProcessing(false);
      return;
    }

    // Force a 2-letter country code
    const formattedAddress = {
      ...billingDetails.address,
      country:
        billingDetails.address.country.length === 2
          ? billingDetails.address.country.toUpperCase()
          : "US",
    };

    let purchaseConfirmed = false;
    try {
      const result = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: cardElement,
          billing_details: {
            name: billingDetails.name,
            email: billingDetails.email,
            address: formattedAddress,
          },
        },
      });

      if (result.error) throw result.error;
      if (result.paymentIntent?.status === "succeeded") {
        toast.info(
          `Payment successful. Finalizing ${credits} credit${credits === 1 ? "" : "s"}...`
        );

        try {
          const { data } = await api.post<{
            balance: number;
            creditsAdded: number;
          }>("/api/purchase/confirm", {
            paymentIntentId: result.paymentIntent.id,
          });

          const confirmedBalance = data.balance;
          // Update cache optimistically
          queryClient.setQueryData(["billing-balance"], confirmedBalance);
          queryClient.setQueryData<CachedUser | undefined>(
            ["user"],
            (prev) =>
              prev ? { ...prev, credits: confirmedBalance } : prev
          );
          // Force refetch to ensure sidebar updates
          await queryClient.refetchQueries({ queryKey: ["billing-balance"] });
          await queryClient.refetchQueries({ queryKey: ["user"] });
          toast.success(`${credits} credits added successfully!`);
          purchaseConfirmed = true;
        } catch (confirmError) {
          console.error("Purchase confirmation error:", confirmError);
          toast.error(
            "Payment succeeded, but we couldn't refresh your credits automatically. They'll appear shortly."
          );
          await queryClient.invalidateQueries({ queryKey: ["billing-balance"] });
          await queryClient.invalidateQueries({ queryKey: ["user"] });
        }
      }
    } catch (err: any) {
      console.error("Payment error:", err);
      setError(err.message || "Payment failed. Please try again.");
    } finally {
      setIsProcessing(false);
      if (purchaseConfirmed) {
        navigate(returnTo ?? "/");
      }
    }
  };

  const cardElementOptions = {
    style: {
      base: {
        fontSize: "16px",
        color: isDark ? "#ffffff" : "#424770",
        "::placeholder": { color: isDark ? "#94a3b8" : "#aab7c4" },
        iconColor: isDark ? "#cbd5e1" : "#666666",
      },
      invalid: { color: isDark ? "#fecaca" : "#9e2146" },
    },
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* billing inputs */}
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Name
          </label>
          <Input
            id="name"
            required
            value={billingDetails.name}
            onChange={(e) =>
              setBillingDetails({ ...billingDetails, name: e.target.value })
            }
            placeholder="John Doe"
          />
        </div>

        {/* Firm Name/Organization */}
        <div>
          <label
            htmlFor="firmName"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Firm Name/Organization
          </label>
          <Input
            id="firmName"
            value={billingDetails.firmName}
            onChange={(e) =>
              setBillingDetails({ ...billingDetails, firmName: e.target.value })
            }
            placeholder="Acme Law Firm"
          />
        </div>

        {/* Email */}
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Email
          </label>
          <Input
            id="email"
            type="email"
            required
            value={billingDetails.email}
            onChange={(e) =>
              setBillingDetails({ ...billingDetails, email: e.target.value })
            }
            placeholder="john@example.com"
          />
        </div>

        {/* Address */}
        <div>
          <label
            htmlFor="address"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Billing Address
          </label>
          <Input
            id="address"
            required
            value={billingDetails.address.line1}
            onChange={(e) =>
              setBillingDetails({
                ...billingDetails,
                address: { ...billingDetails.address, line1: e.target.value },
              })
            }
            placeholder="123 Main St"
            className="mb-2"
          />

          <div className="grid grid-cols-2 gap-2 mb-2">
            <Input
              placeholder="City"
              required
              value={billingDetails.address.city}
              onChange={(e) =>
                setBillingDetails({
                  ...billingDetails,
                  address: { ...billingDetails.address, city: e.target.value },
                })
              }
            />
            <Input
              placeholder="State"
              required
              value={billingDetails.address.state}
              onChange={(e) =>
                setBillingDetails({
                  ...billingDetails,
                  address: { ...billingDetails.address, state: e.target.value },
                })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="ZIP Code"
              required
              value={billingDetails.address.postal_code}
              onChange={(e) =>
                setBillingDetails({
                  ...billingDetails,
                  address: {
                    ...billingDetails.address,
                    postal_code: e.target.value,
                  },
                })
              }
            />
            <Input
              placeholder="Country Code (e.g. US)"
              required
              value={billingDetails.address.country}
              onChange={(e) =>
                setBillingDetails({
                  ...billingDetails,
                  address: {
                    ...billingDetails.address,
                    country: e.target.value,
                  },
                })
              }
            />
          </div>
        </div>

        {/* CardElement */}
        <div>
          <label
            htmlFor="card"
            className="block text-sm font-medium text-foreground mb-1"
          >
            Card information
          </label>
          <div className="p-3 border rounded-md bg-background">
            <CardElement id="card" options={cardElementOptions} />
          </div>
        </div>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}

      {/* Summary */}
      <div className="bg-muted p-4 rounded-md">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-muted-foreground">Plan:</span>
          <span className="text-sm font-medium">
            {planName} ({credits} credits)
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-sm text-muted-foreground">Total:</span>
          <span className="text-sm font-medium text-foreground">${amount.toFixed(2)}</span>
        </div>
      </div>

      {/* Sales Policy Notice */}
      <p className="text-xs text-muted-foreground text-center">
        All sales are final. No refunds or exchanges.
      </p>

      <Button
        type="submit"
        disabled={!stripe || isProcessing || !clientSecret}
        className="w-full bg-[#5674BC] hover:bg-[#4a65a7] text-white py-6 text-lg"
      >
        {isProcessing ? "Processing..." : `Pay $${amount.toFixed(2)}`}
      </Button>
    </form>
  );
};
