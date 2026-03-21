"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StepNav } from "@/components/onboarding/step-nav";
import { InfoBanner } from "@/components/onboarding/shared/info-banner";
import { SelectableCards } from "@/components/onboarding/shared/selectable-cards";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Plus, Trash2 } from "lucide-react";

const PRICING_OPTIONS = [
  {
    value: "subscription",
    title: "Subscription",
    description: "Monthly or annual recurring",
  },
  {
    value: "one-time",
    title: "One time",
    description: "Single Purchase",
  },
  {
    value: "usage-based",
    title: "Usage-based",
    description: "Pay per use or consumption",
  },
  {
    value: "custom-enterprise",
    title: "Custom / Enterprise",
    description: "Tailored pricing per deal",
  },
];

type Product = { name: string; description: string };

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  allOrgData?: Record<string, unknown>;
};

export function Step04Products({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [products, setProducts] = useState<Product[]>(
    (s.products as Product[])?.length
      ? (s.products as Product[])
      : [{ name: "", description: "" }]
  );
  const [pricingModel, setPricingModel] = useState((s.pricingModel as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateProduct(i: number, field: keyof Product, val: string) {
    setProducts((p) => p.map((item, idx) => (idx === i ? { ...item, [field]: val } : item)));
  }

  function addProduct() {
    setProducts((p) => [...p, { name: "", description: "" }]);
  }

  function removeProduct(i: number) {
    if (products.length > 1) setProducts((p) => p.filter((_, idx) => idx !== i));
  }

  async function handleContinue() {
    if (!products[0].name.trim()) {
      setError("At least one product or service name is required");
      return;
    }
    if (!pricingModel) {
      setError("Please select a pricing model");
      return;
    }
    setLoading(true);
    setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 4,
      orgData: { step4: { products: products.filter((p) => p.name.trim()), pricingModel } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=5");
  }

  return (
    <div className="space-y-6">
      {/* Title */}
      <h1 className="font-heading font-bold text-2xl text-white">Product and Services</h1>

      {/* Info banner */}
      <InfoBanner
        title="What do you sell?"
        description="Your AI Employees need to know exactly what you offer to have informed conversations with prospects — product names, what they do, and who they're for."
      />

      {/* Form fields */}
      <div className="space-y-5">
        {/* Products repeating group */}
        <div className="space-y-2">
          <Label>
            Your Products &amp; Services <span className="text-[#F87171]">*</span>
          </Label>
          <div className="space-y-4">
            {products.map((p, i) => (
              <div
                key={i}
                className="space-y-3 p-4 rounded-xl border border-[#2A2D35] bg-[#131619]/50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[#8B8F97]">
                    Product / Service {i + 1}
                  </span>
                  {products.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      type="button"
                      onClick={() => removeProduct(i)}
                      className="h-8 w-8"
                    >
                      <Trash2 className="w-4 h-4 text-[#F87171]" />
                    </Button>
                  )}
                </div>
                <Input
                  value={p.name}
                  onChange={(e) => updateProduct(i, "name", e.target.value)}
                  placeholder="Product or service name"
                />
                <Textarea
                  value={p.description}
                  onChange={(e) => updateProduct(i, "description", e.target.value)}
                  placeholder="One-line description — what does it do and who is it for?"
                  rows={2}
                />
              </div>
            ))}
          </div>

          <Button
            variant="outline"
            type="button"
            onClick={addProduct}
            className="w-full mt-2 border-dashed border-[#2A2D35] text-[#8B8F97] hover:text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add another product or service
          </Button>
        </div>

        {/* Pricing Model — 2x2 selectable cards */}
        <div className="space-y-2">
          <Label>
            Primary Pricing Model <span className="text-[#F87171]">*</span>
          </Label>
          <SelectableCards
            options={PRICING_OPTIONS}
            value={pricingModel}
            onChange={(v) => setPricingModel(v as string)}
            columns={2}
          />
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav
        step={4}
        loading={loading}
        onBack={() => router.push("/onboarding?step=3")}
        onContinue={handleContinue}
      />
    </div>
  );
}
