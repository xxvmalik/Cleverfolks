"use client";

import { useState, useEffect } from "react";
import {
  Video,
  ChevronDown,
  ChevronRight,
  Clock,
  Users,
  FileText,
  Target,
  AlertTriangle,
  Sparkles,
  UserCheck,
  MessageCircle,
  ArrowRight,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type MeetingRecord = {
  id: string;
  bot_id: string;
  meeting_date: string;
  meeting_url: string | null;
  summary: string | null;
  intelligence: MeetingIntelligence | null;
  participants: Array<{ name: string; is_host?: boolean }> | null;
  processing_status: string;
  duration_seconds: number | null;
  created_at: string;
};

type MeetingIntelligence = {
  action_items?: Array<{ text: string; assigned_to?: string }>;
  objections?: Array<{ text: string; speaker?: string; topic?: string }>;
  buying_signals?: Array<{ text: string; speaker?: string; signal_type?: string }>;
  competitor_mentions?: Array<{ competitor_name: string; context: string; speaker?: string }>;
  commitments?: Array<{ text: string; who_committed?: string; what_committed?: string }>;
  key_questions?: Array<{ question: string; speaker?: string; was_answered?: boolean }>;
  stakeholders_identified?: Array<{ name: string; role?: string; influence_level?: string }>;
  pain_points?: Array<{ text: string; speaker?: string; severity?: string }>;
  next_steps_discussed?: Array<{ step: string; owner?: string; timeline?: string }>;
};

type TranscriptLine = {
  speaker: string;
  text: string;
  timestamp: number | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs}h ${rem}m`;
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Speaker colour palette
const SPEAKER_COLORS = [
  "#3A89FF", "#4ADE80", "#F2903D", "#7C3AED", "#06B6D4",
  "#F87171", "#FBBF24", "#A78BFA", "#34D399", "#FB923C",
];

function getSpeakerColor(speaker: string, speakerMap: Map<string, number>): string {
  if (!speakerMap.has(speaker)) {
    speakerMap.set(speaker, speakerMap.size);
  }
  return SPEAKER_COLORS[speakerMap.get(speaker)! % SPEAKER_COLORS.length];
}

// ── Component ────────────────────────────────────────────────────────────────

export function MeetingsPanel({ leadId }: { leadId: string }) {
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["action_items"]));

  useEffect(() => {
    async function fetchMeetings() {
      try {
        const res = await fetch(`/api/skyler/meetings?lead_id=${leadId}`);
        if (res.ok) {
          const data = await res.json();
          setMeetings(data.meetings ?? []);
          if (data.meetings?.length > 0) {
            setSelectedMeetingId(data.meetings[0].id);
          }
        }
      } finally {
        setLoading(false);
      }
    }
    fetchMeetings();
  }, [leadId]);

  const selectedMeeting = meetings.find((m) => m.id === selectedMeetingId) ?? null;

  function toggleSection(section: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  }

  async function loadTranscript(transcriptId: string) {
    if (showTranscript) {
      setShowTranscript(false);
      return;
    }
    setTranscriptLoading(true);
    try {
      const res = await fetch(`/api/skyler/meetings/${transcriptId}`);
      if (res.ok) {
        const data = await res.json();
        setTranscript(data.transcript ?? []);
        setShowTranscript(true);
      }
    } finally {
      setTranscriptLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-[#8B8F97]" />
      </div>
    );
  }

  if (meetings.length === 0) {
    return (
      <div className="rounded-lg bg-[#1A1A1A] border border-[#2A2D35] p-6 text-center">
        <Video className="w-8 h-8 text-[#8B8F97]/50 mx-auto mb-2" />
        <p className="text-[#8B8F97] text-sm">No meetings recorded yet.</p>
        <p className="text-[#555A63] text-xs mt-1">
          Connect your calendar in Workflow Settings to auto-record.
        </p>
      </div>
    );
  }

  const speakerColorMap = new Map<string, number>();

  return (
    <div className="space-y-3">
      {/* Meeting selector */}
      {meetings.length > 1 && (
        <div className="relative">
          <select
            value={selectedMeetingId ?? ""}
            onChange={(e) => {
              setSelectedMeetingId(e.target.value);
              setShowTranscript(false);
              setTranscript([]);
            }}
            className="w-full bg-[#1C1F24] border border-[#2A2D35] rounded-lg px-3 py-2 text-white text-xs appearance-none cursor-pointer focus:outline-none focus:border-[#3A89FF]/50 pr-8"
          >
            {meetings.map((m) => {
              const date = new Date(m.meeting_date).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              });
              const participants = (m.participants ?? []).map((p) => p.name).join(", ");
              return (
                <option key={m.id} value={m.id}>
                  {date} — {participants || "Meeting"}
                </option>
              );
            })}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-[#8B8F97] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      )}

      {/* Selected meeting */}
      {selectedMeeting && (
        <>
          {/* Processing state */}
          {selectedMeeting.processing_status !== "complete" && (
            <div className="rounded-lg bg-[#3A89FF]/5 border border-[#3A89FF]/20 p-3 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#3A89FF]" />
              <p className="text-[#3A89FF] text-xs">
                Meeting from {new Date(selectedMeeting.meeting_date).toLocaleDateString()} is being processed. Summary will appear shortly.
              </p>
            </div>
          )}

          {/* Summary card */}
          {selectedMeeting.processing_status === "complete" && (
            <>
              <div className="rounded-lg bg-[#1A1A1A] border border-[#2A2D35] p-4">
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex items-center gap-1.5 text-[#06B6D4]">
                    <Video className="w-3.5 h-3.5" />
                    <span className="text-xs font-semibold">Meeting Summary</span>
                  </div>
                </div>

                {/* Date + Duration */}
                <div className="flex items-center gap-4 mb-3 text-xs text-[#8B8F97]">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(selectedMeeting.meeting_date).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  {selectedMeeting.duration_seconds && (
                    <span>{formatDuration(selectedMeeting.duration_seconds)}</span>
                  )}
                </div>

                {/* Participants */}
                {selectedMeeting.participants && selectedMeeting.participants.length > 0 && (
                  <div className="flex items-center gap-1.5 mb-3">
                    <Users className="w-3 h-3 text-[#8B8F97]" />
                    <div className="flex flex-wrap gap-1">
                      {selectedMeeting.participants.map((p, i) => (
                        <span
                          key={i}
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px] font-medium",
                            p.is_host
                              ? "bg-[#3A89FF]/15 text-[#3A89FF]"
                              : "bg-[#2A2D35] text-[#8B8F97]"
                          )}
                        >
                          {p.name}{p.is_host ? " (host)" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Executive summary */}
                {selectedMeeting.summary && (
                  <p className="text-[#E0E0E0] text-xs leading-relaxed">
                    {selectedMeeting.summary}
                  </p>
                )}
              </div>

              {/* Intelligence sections */}
              {selectedMeeting.intelligence && (
                <div className="space-y-1">
                  <IntelSection
                    icon={Target}
                    label="Action Items"
                    sectionKey="action_items"
                    expanded={expandedSections.has("action_items")}
                    onToggle={toggleSection}
                    items={selectedMeeting.intelligence.action_items}
                    renderItem={(item) => (
                      <div className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-[#F2903D] mt-1.5 shrink-0" />
                        <div>
                          <span className="text-[#E0E0E0] text-xs">{item.text}</span>
                          {item.assigned_to && (
                            <span className="text-[#8B8F97] text-[10px] ml-1.5">→ {item.assigned_to}</span>
                          )}
                        </div>
                      </div>
                    )}
                  />

                  <IntelSection
                    icon={AlertTriangle}
                    label="Objections Raised"
                    sectionKey="objections"
                    expanded={expandedSections.has("objections")}
                    onToggle={toggleSection}
                    items={selectedMeeting.intelligence.objections}
                    renderItem={(item) => (
                      <div className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-[#F87171] mt-1.5 shrink-0" />
                        <div>
                          <span className="text-[#E0E0E0] text-xs">{item.text}</span>
                          {item.speaker && (
                            <span className="text-[#8B8F97] text-[10px] ml-1.5">— {item.speaker}</span>
                          )}
                        </div>
                      </div>
                    )}
                  />

                  <IntelSection
                    icon={Sparkles}
                    label="Buying Signals"
                    sectionKey="buying_signals"
                    expanded={expandedSections.has("buying_signals")}
                    onToggle={toggleSection}
                    items={selectedMeeting.intelligence.buying_signals}
                    renderItem={(item) => (
                      <div className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-[#4ADE80] mt-1.5 shrink-0" />
                        <span className="text-[#E0E0E0] text-xs">{item.text}</span>
                      </div>
                    )}
                  />

                  <IntelSection
                    icon={UserCheck}
                    label="Stakeholders Identified"
                    sectionKey="stakeholders"
                    expanded={expandedSections.has("stakeholders")}
                    onToggle={toggleSection}
                    items={selectedMeeting.intelligence.stakeholders_identified}
                    renderItem={(item) => (
                      <div className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-[#7C3AED] mt-1.5 shrink-0" />
                        <div>
                          <span className="text-[#E0E0E0] text-xs font-medium">{item.name}</span>
                          {item.role && <span className="text-[#8B8F97] text-[10px] ml-1.5">{item.role}</span>}
                          {item.influence_level && (
                            <span className="text-[#8B8F97] text-[10px] ml-1">({item.influence_level})</span>
                          )}
                        </div>
                      </div>
                    )}
                  />

                  <IntelSection
                    icon={MessageCircle}
                    label="Pain Points"
                    sectionKey="pain_points"
                    expanded={expandedSections.has("pain_points")}
                    onToggle={toggleSection}
                    items={selectedMeeting.intelligence.pain_points}
                    renderItem={(item) => (
                      <div className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-[#FB923C] mt-1.5 shrink-0" />
                        <span className="text-[#E0E0E0] text-xs">{item.text}</span>
                      </div>
                    )}
                  />

                  <IntelSection
                    icon={ArrowRight}
                    label="Next Steps Discussed"
                    sectionKey="next_steps"
                    expanded={expandedSections.has("next_steps")}
                    onToggle={toggleSection}
                    items={selectedMeeting.intelligence.next_steps_discussed}
                    renderItem={(item) => (
                      <div className="flex items-start gap-2">
                        <div className="w-1 h-1 rounded-full bg-[#3A89FF] mt-1.5 shrink-0" />
                        <div>
                          <span className="text-[#E0E0E0] text-xs">{item.step}</span>
                          {item.owner && (
                            <span className="text-[#8B8F97] text-[10px] ml-1.5">→ {item.owner}</span>
                          )}
                          {item.timeline && (
                            <span className="text-[#8B8F97] text-[10px] ml-1">({item.timeline})</span>
                          )}
                        </div>
                      </div>
                    )}
                  />

                  {selectedMeeting.intelligence.competitor_mentions &&
                    selectedMeeting.intelligence.competitor_mentions.length > 0 && (
                      <IntelSection
                        icon={Target}
                        label="Competitor Mentions"
                        sectionKey="competitors"
                        expanded={expandedSections.has("competitors")}
                        onToggle={toggleSection}
                        items={selectedMeeting.intelligence.competitor_mentions}
                        renderItem={(item) => (
                          <div className="flex items-start gap-2">
                            <div className="w-1 h-1 rounded-full bg-[#F87171] mt-1.5 shrink-0" />
                            <div>
                              <span className="text-[#E0E0E0] text-xs font-medium">{item.competitor_name}</span>
                              <span className="text-[#8B8F97] text-[10px] ml-1.5">{item.context}</span>
                            </div>
                          </div>
                        )}
                      />
                    )}
                </div>
              )}

              {/* Full transcript toggle */}
              <button
                onClick={() => loadTranscript(selectedMeeting.id)}
                disabled={transcriptLoading}
                className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#06B6D4]/10 text-[#06B6D4] rounded-lg text-xs font-medium hover:bg-[#06B6D4]/20 transition-colors"
              >
                {transcriptLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <FileText className="w-3 h-3" />
                )}
                {showTranscript ? "Hide Full Transcript" : "View Full Transcript"}
              </button>

              {/* Transcript view */}
              {showTranscript && transcript.length > 0 && (
                <div className="rounded-lg bg-[#111111] border border-[#2A2D35]/50 p-3 max-h-[400px] overflow-y-auto scrollbar-thin">
                  <div className="space-y-2">
                    {transcript.map((line, i) => {
                      const color = getSpeakerColor(line.speaker, speakerColorMap);
                      return (
                        <div key={i} className="text-xs">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="font-semibold" style={{ color }}>
                              {line.speaker}
                            </span>
                            {line.timestamp !== null && (
                              <span className="text-[#555A63] text-[10px]">
                                {formatTimestamp(line.timestamp)}
                              </span>
                            )}
                          </div>
                          <p className="text-[#E0E0E0] leading-relaxed pl-0">{line.text}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ── Collapsible Intelligence Section ─────────────────────────────────────────

function IntelSection<T>({
  icon: Icon,
  label,
  sectionKey,
  expanded,
  onToggle,
  items,
  renderItem,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  sectionKey: string;
  expanded: boolean;
  onToggle: (key: string) => void;
  items: T[] | undefined;
  renderItem: (item: T) => React.ReactNode;
}) {
  if (!items || items.length === 0) return null;

  return (
    <div className="rounded-lg bg-[#1A1A1A] border border-[#2A2D35] overflow-hidden">
      <button
        onClick={() => onToggle(sectionKey)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#1C1F24] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3 h-3 text-[#8B8F97]" />
          <span className="text-white text-xs font-medium">{label}</span>
          <span className="text-[#555A63] text-[10px]">({items.length})</span>
        </div>
        {expanded ? (
          <ChevronDown className="w-3 h-3 text-[#8B8F97]" />
        ) : (
          <ChevronRight className="w-3 h-3 text-[#8B8F97]" />
        )}
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-1.5">
          {items.map((item, i) => (
            <div key={i}>{renderItem(item)}</div>
          ))}
        </div>
      )}
    </div>
  );
}
