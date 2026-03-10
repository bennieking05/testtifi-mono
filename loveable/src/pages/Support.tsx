
import React, { useState } from "react";
import api from "@/lib/axios";
import { toast } from "sonner";

import { AuthenticatedLayout } from "@/components/layout/AuthenticatedLayout";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Mail, CheckCircle2, MapPin } from "lucide-react";

const Support: React.FC = () => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    try {
      setIsSubmitting(true);

      await api.post(`/api/support`, {
        name: fd.get("name"),
        email: fd.get("email"),
        subject: fd.get("subject"),
        message: fd.get("message"),
      });

      toast.success("Support request submitted 🎉");
      setSubmitted(true);
    } catch (err: any) {
      console.error(err);
      toast.error(
        err?.response?.data?.error ||
          "Something went wrong – please try again later."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthenticatedLayout>
      <main className="flex-1 px-4 lg:px-8 py-4 lg:py-8 pt-20 lg:pt-8 pb-8">
          <header className="mb-6">
            <h1 className="text-2xl lg:text-3xl font-bold mb-2 text-slate-900 dark:text-slate-100">
              Support
            </h1>
            <p className="text-sm lg:text-base text-slate-600 dark:text-slate-300">
              Need help? Contact our support team
            </p>
          </header>

          {/* content */}
          <div className="mt-8 max-w-4xl mx-auto">
            {/* quick‑contact cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <ContactCard
                icon={Mail}
                title="Email"
                ctaLabel="Email Us"
                ctaHref="mailto:support@testifi.ai"
              >
                Email us anytime at{" "}
                <span className="font-medium">support@testifi.ai</span>
              </ContactCard>
              <ContactCard icon={MapPin} title="Mailing Address">
                Send correspondence to our Dallas office:
                <br />
                <span className="font-medium">
                  P.O. Box 600876<br />
                  Dallas, TX 75360-0876
                </span>
              </ContactCard>
            </div>

            {/* form OR success message */}
            <Card className="mb-8 bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
              {submitted ? (
                <>
                  <CardHeader className="text-center items-center">
                    <div className="rounded-full bg-green-100 dark:bg-green-900/30 p-3">
                      <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-400" />
                    </div>
                    <CardTitle className="mt-4 text-slate-900 dark:text-slate-100">Request received!</CardTitle>
                    <CardDescription className="dark:text-slate-300">
                      An administrator will review your message and get back to
                      you within <b>one business day</b>. Keep an eye on the inbox
                      you provided.
                    </CardDescription>
                  </CardHeader>
                </>
              ) : (
                <>
                  <CardHeader>
                    <CardTitle className="text-slate-900 dark:text-slate-100">Contact Support</CardTitle>
                    <CardDescription className="dark:text-slate-300">
                      Fill out the form below and we'll get back to you as soon as
                      possible.
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Field id="name" label="Name" required />
                        <Field
                          id="email"
                          label="Email"
                          type="email"
                          required
                          placeholder="you@example.com"
                        />
                      </div>

                      <Field id="subject" label="Subject" required />

                      <Field
                        id="message"
                        label="Message"
                        as={Textarea}
                        rows={5}
                        required
                      />

                      <Button
                        type="submit"
                        className="w-full md:w-auto bg-[#5674BC] hover:bg-[#4a65a7] dark:bg-blue-600 dark:hover:bg-blue-700"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? "Sending…" : "Submit Request"}
                      </Button>
                    </form>
                  </CardContent>
                </>
              )}
            </Card>

            {/* FAQ */}
            <div className="bg-gray-50/50 dark:bg-slate-800/50 rounded-lg p-6 border dark:border-slate-700">
              <h3 className="text-lg font-medium mb-2 text-slate-900 dark:text-slate-100">
                Frequently Asked Questions
              </h3>
              <div className="space-y-4 mt-4">
                <FaqItem question="How long does it take to get a response?">
                  We typically respond to all inquiries within 24-48 business
                  hours.
                </FaqItem>

                <FaqItem question="What information should I include in my request?">
                  Please include your account email, a detailed description of the
                  issue, and any relevant screenshots or error messages.
                </FaqItem>
              </div>
            </div>
          </div>
        </main>
    </AuthenticatedLayout>
  );
};

export default Support;

interface ContactCardProps {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  ctaLabel?: string;
  ctaHref?: string;
}
function ContactCard({
  icon: Icon,
  title,
  children,
  ctaLabel,
  ctaHref,
}: ContactCardProps) {
  return (
    <Card className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm border-white/50 dark:border-slate-700/50 shadow-lg">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-slate-900 dark:text-slate-100">
          <Icon className="h-5 w-5 text-[#5674BC] dark:text-blue-400" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-600 dark:text-slate-300">{children}</p>
      </CardContent>
      {ctaLabel ? (
        <CardFooter>
          <Button
            asChild={Boolean(ctaHref)}
            variant="outline"
            className="w-full dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            {ctaHref ? <a href={ctaHref}>{ctaLabel}</a> : ctaLabel}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

type InputLikeProps = React.ComponentPropsWithoutRef<typeof Input>;
type TextareaLikeProps = React.ComponentPropsWithoutRef<typeof Textarea>;

interface FieldBase {
  id: string;
  label: string;
  as?: typeof Input | typeof Textarea;
}

type FieldProps = FieldBase & (InputLikeProps | TextareaLikeProps);

function Field({
  id,
  label,
  as: Comp = Input,
  ...rest
}: FieldProps): JSX.Element {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-slate-900 dark:text-slate-100">{label}</Label>
      <Comp 
        id={id} 
        name={id} 
        placeholder={label} 
        className="bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 border-gray-300 dark:border-slate-600"
        {...(rest as any)} 
      />
    </div>
  );
}

interface FaqItemProps {
  question: string;
  children: React.ReactNode;
}
function FaqItem({ question, children }: FaqItemProps) {
  return (
    <div>
      <h4 className="font-medium text-slate-900 dark:text-slate-100">{question}</h4>
      <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">{children}</p>
    </div>
  );
}
