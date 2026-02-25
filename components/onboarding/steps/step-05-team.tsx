"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StepNav } from "@/components/onboarding/step-nav";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Plus, X } from "lucide-react";

const TIMEZONES = ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Toronto","America/Vancouver","Europe/London","Europe/Paris","Europe/Berlin","Europe/Amsterdam","Europe/Madrid","Europe/Rome","Asia/Dubai","Asia/Kolkata","Asia/Singapore","Asia/Tokyo","Asia/Seoul","Asia/Shanghai","Australia/Sydney","Australia/Melbourne","Pacific/Auckland"];
const TIMES = Array.from({ length: 24 }, (_, i) => { const h = i.toString().padStart(2,"0"); return `${h}:00`; });
const LANGUAGES = ["English","Spanish","French","German","Portuguese","Italian","Dutch","Chinese","Japanese","Korean","Arabic"];

type Invite = { email: string; role: string };
type Props = { workspaceId: string; savedData?: Record<string, unknown> };

export function Step05Team({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = savedData ?? {};
  const [form, setForm] = useState({
    yourRole:          (s.yourRole as string)          ?? "",
    timezone:          (s.timezone as string)          ?? "",
    workStartTime:     (s.workStartTime as string)     ?? "09:00",
    workEndTime:       (s.workEndTime as string)       ?? "17:00",
    preferredLanguage: (s.preferredLanguage as string) ?? "English",
  });
  const [invites, setInvites] = useState<Invite[]>((s.invites as Invite[]) ?? []);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!form.timezone) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setForm(p => ({ ...p, timezone: tz }));
      } catch { /* ignore */ }
    }
  }, [form.timezone]);

  function set(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(p => ({ ...p, [k]: e.target.value }));
  }

  function addInvite() {
    if (!inviteEmail.trim() || !inviteEmail.includes("@")) return;
    setInvites(p => [...p, { email: inviteEmail.trim(), role: inviteRole }]);
    setInviteEmail("");
  }

  async function handleContinue() {
    if (!form.yourRole.trim()) { setError("Your role is required"); return; }
    setLoading(true); setError(null);
    const result = await saveOnboardingStepAction({
      workspaceId, step: 5,
      orgData: { step5: { ...form, invites } },
    });
    if (result.error) { setError(result.error); setLoading(false); return; }
    router.push("/onboarding?step=6");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading font-bold text-2xl text-white">Team & Work Style</h1>
        <p className="text-[#8B8F97] text-sm mt-1">Set your preferences and invite your teammates.</p>
      </div>

      <div className="bg-[#1C1F24] border border-[#2A2D35] rounded-2xl p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="yourRole">Your role</Label>
            <Input id="yourRole" value={form.yourRole} onChange={set("yourRole")} placeholder="e.g. CEO, Head of Sales" />
          </div>
          <div className="space-y-1.5">
            <Label>Timezone</Label>
            <Select value={form.timezone} onChange={set("timezone")}>
              <option value="">Detecting…</option>
              {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz.replace(/_/g," ")}</option>)}
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Work starts</Label>
            <Select value={form.workStartTime} onChange={set("workStartTime")}>
              {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Work ends</Label>
            <Select value={form.workEndTime} onChange={set("workEndTime")}>
              {TIMES.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select value={form.preferredLanguage} onChange={set("preferredLanguage")}>
              {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
            </Select>
          </div>
        </div>

        <div className="space-y-3 pt-2 border-t border-[#2A2D35]">
          <Label className="text-white text-sm font-medium">Invite team members</Label>
          <div className="flex gap-2">
            <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="colleague@example.com" onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addInvite())} />
            <Select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="w-36">
              <option value="admin">Admin</option>
              <option value="manager">Manager</option>
              <option value="member">Member</option>
            </Select>
            <Button variant="outline" type="button" onClick={addInvite}><Plus className="w-4 h-4" /></Button>
          </div>
          {invites.length > 0 && (
            <div className="space-y-2">
              {invites.map((inv, i) => (
                <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#131619] border border-[#2A2D35]">
                  <span className="text-sm text-white">{inv.email}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#8B8F97] capitalize">{inv.role}</span>
                    <button type="button" onClick={() => setInvites(p => p.filter((_, idx) => idx !== i))}>
                      <X className="w-3.5 h-3.5 text-[#8B8F97] hover:text-[#F87171]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}
      <StepNav step={5} loading={loading} onBack={() => router.push("/onboarding?step=4")} onContinue={handleContinue} />
    </div>
  );
}
