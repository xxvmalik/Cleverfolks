"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { StepNav } from "@/components/onboarding/step-nav";
import { InfoBanner } from "@/components/onboarding/shared/info-banner";
import { SelectableChips } from "@/components/onboarding/shared/selectable-chips";
import { saveOnboardingStepAction } from "@/app/actions/onboarding";
import { Plus, X } from "lucide-react";

const ROLE_OPTIONS = [
  "Founder/CEO",
  "Sales Lead",
  "Marketing",
  "Operations",
  "Product",
  "Other",
];

type Invite = { email: string; role: string };

type Props = {
  workspaceId: string;
  savedData?: Record<string, unknown>;
  allOrgData?: Record<string, unknown>;
};

export function Step05Team({ workspaceId, savedData }: Props) {
  const router = useRouter();
  const s = (savedData ?? {}) as Record<string, unknown>;

  const [role, setRole] = useState<string>((s.role as string) ?? "");
  const [timezone, setTimezone] = useState<string>((s.timezone as string) ?? "");
  const [workingHoursStart, setWorkingHoursStart] = useState<string>(
    (s.workingHoursStart as string) ?? "09:00"
  );
  const [workingHoursEnd, setWorkingHoursEnd] = useState<string>(
    (s.workingHoursEnd as string) ?? "18:00"
  );
  const [language, setLanguage] = useState<string>(
    (s.language as string) ?? "English"
  );
  const [teamInvites, setTeamInvites] = useState<Invite[]>(
    (s.teamInvites as Invite[]) ?? []
  );
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-detect timezone
  useEffect(() => {
    if (!timezone) {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        setTimezone(tz);
      } catch {
        /* ignore */
      }
    }
  }, [timezone]);

  function addInvite() {
    const email = inviteEmail.trim();
    if (!email || !email.includes("@")) return;
    if (teamInvites.some((inv) => inv.email === email)) return;
    setTeamInvites((prev) => [...prev, { email, role: "Member" }]);
    setInviteEmail("");
  }

  function removeInvite(index: number) {
    setTeamInvites((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleContinue() {
    if (!role) {
      setError("Please select your role.");
      return;
    }
    if (!timezone.trim()) {
      setError("Timezone is required.");
      return;
    }
    if (!language.trim()) {
      setError("Preferred language is required.");
      return;
    }

    setLoading(true);
    setError(null);

    const result = await saveOnboardingStepAction({
      workspaceId,
      step: 5,
      orgData: {
        step5: {
          role,
          timezone,
          workingHoursStart,
          workingHoursEnd,
          language,
          teamInvites,
        },
      },
    });

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    router.push("/onboarding?step=6");
  }

  return (
    <div className="space-y-6">
      <InfoBanner
        title="How does your team operate?"
        description="This ensures your AI Employees respect your working hours, communicate in the right language, and know who's on the team."
      />

      {/* Role */}
      <div className="space-y-2">
        <Label className="text-white text-sm font-medium">
          What&apos;s your role? <span className="text-[#F87171]">*</span>
        </Label>
        <SelectableChips
          options={ROLE_OPTIONS}
          value={role}
          onChange={(val) => setRole(val as string)}
        />
      </div>

      {/* Timezone */}
      <div className="space-y-2">
        <Label htmlFor="timezone" className="text-white text-sm font-medium">
          Timezone <span className="text-[#F87171]">*</span>
        </Label>
        <Input
          id="timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="e.g. Europe/London"
        />
      </div>

      {/* Working Hours */}
      <div className="space-y-2">
        <Label className="text-white text-sm font-medium">Working Hours</Label>
        <div className="flex items-center gap-3">
          <Input
            value={workingHoursStart}
            onChange={(e) => setWorkingHoursStart(e.target.value)}
            placeholder="09:00"
            className="w-32"
          />
          <span className="text-sm text-[#8B8F97]">to</span>
          <Input
            value={workingHoursEnd}
            onChange={(e) => setWorkingHoursEnd(e.target.value)}
            placeholder="18:00"
            className="w-32"
          />
        </div>
      </div>

      {/* Preferred Language */}
      <div className="space-y-2">
        <Label htmlFor="language" className="text-white text-sm font-medium">
          Preferred Language <span className="text-[#F87171]">*</span>
        </Label>
        <Input
          id="language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="English"
        />
        <p className="text-xs text-[#8B8F97]">
          Your AI Employees&apos; outreach and responses will default to this language.
        </p>
      </div>

      {/* Invite Team Members */}
      <div className="space-y-3 pt-4 border-t border-[#2A2D35]">
        <div>
          <Label className="text-white text-sm font-medium">
            Invite Team Members
          </Label>
          <p className="text-xs text-[#8B8F97] mt-0.5">
            Optional — you can do this later
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addInvite();
              }
            }}
          />
          <span className="text-sm text-[#8B8F97] px-3 py-2 rounded-lg bg-[#1C1F24] border border-[#2A2D35] whitespace-nowrap">
            Member
          </span>
          <Button variant="outline" type="button" onClick={addInvite} size="icon">
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {teamInvites.length > 0 && (
          <div className="space-y-2">
            {teamInvites.map((inv, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#1C1F24] border border-[#2A2D35]"
              >
                <span className="text-sm text-white">{inv.email}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#8B8F97]">{inv.role}</span>
                  <button type="button" onClick={() => removeInvite(i)}>
                    <X className="w-3.5 h-3.5 text-[#8B8F97] hover:text-[#F87171] transition-colors" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-[#F87171] text-sm">{error}</p>}

      <StepNav
        step={5}
        loading={loading}
        onBack={() => router.push("/onboarding?step=4")}
        onContinue={handleContinue}
      />
    </div>
  );
}
