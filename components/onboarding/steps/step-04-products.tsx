"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Plus, Trash2 } from "lucide-react";

const PRICING_MODELS = ["Subscription","One-time","Freemium","Custom / Quote","Free"];

type Product = { name: string; description: string };
type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step04Products({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [products, setProducts] = useState<Product[]>(
    (s.products as Product[])?.length ? (s.products as Product[]) : [{ name: "", description: "" }]
  );
  const [pricingModel, setPricingModel] = useState((s.pricingModel as string) ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateProduct(i: number, field: keyof Product, val: string) {
    setProducts(p => p.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  }
  function addProduct() {
    setProducts(p => [...p, { name: "", description: "" }]);
  }
  function removeProduct(i: number) {
    if (products.length > 1) setProducts(p => p.filter((_, idx) => idx !== i));
  }

  async function handleContinue() {
    if (!products[0].name.trim()) { setError("At least one product or service name is required"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 4,
      orgData: { step4: { products, pricingModel } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=5");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Products & Services</h1>
        <p className="text-[#8B8F97] text-sm mt-1">What do you sell? Add each product or service you offer.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-5">
        {products.map((p, i) => (
          <div key={i} className="space-y-3 pb-5 border-b border-[#2A2D35] last:border-0 last:pb-0">
            <div className="flex items-center justify-between">
              <Label className="text-white text-sm font-medium">Product / Service {i + 1}</Label>
              {products.length > 1 && (
                <Button variant="ghost" size="icon" type="button" onClick={() => removeProduct(i)}>
                  <Trash2 className="w-4 h-4 text-[#F87171]" />
                </Button>
              )}
            </div>
            <Input value={p.name} onChange={e => updateProduct(i, "name", e.target.value)} placeholder="Product name" />
            <Textarea value={p.description} onChange={e => updateProduct(i, "description", e.target.value)} placeholder="What does it do? Who is it for?" rows={2} />
          </div>
        ))}

        <Button variant="outline" type="button" onClick={addProduct} className="w-full">
          <Plus className="w-4 h-4" /> Add another
        </Button>

        <div className="space-y-1.5 pt-2">
          <Label>Pricing model</Label>
          <Select value={pricingModel} onChange={e => setPricingModel(e.target.value)}>
            <option value="">Select…</option>
            {PRICING_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={4} loading={loading} onBack={() => router.push("/onboarding?step=3")} onContinue={handleContinue} />
    </div>
  );
}
