"use client";

import { useState } from "react";
import { Video, ChevronDown, ChevronRight, Search } from "lucide-react";
import { SectionDivider } from "../../shared/section-divider";
import type { CalendarEvent, MeetingRecord } from "../../types";

function formatMeetingDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString("en-GB", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch { return ts; }
}

function durationMin(start: string, end: string): number {
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
}

/** Human-readable label for meeting outcome reasons */
function outcomeLabel(reason: string | null | undefined): { text: string; color: string; bg: string } {
  switch (reason) {
    case "lead_no_show":
      return { text: "Lead didn\u2019t show up", color: "#E54545", bg: "rgba(229,69,69,0.08)" };
    case "user_no_show":
      return { text: "You missed this meeting", color: "#F2903D", bg: "rgba(242,144,61,0.08)" };
    case "nobody_joined":
      return { text: "Nobody joined the meeting", color: "var(--sk-t4)", bg: "rgba(255,255,255,0.03)" };
    case "recording_failed":
      return { text: "Recording failed", color: "#F2903D", bg: "rgba(242,144,61,0.08)" };
    default:
      return { text: "No recording available", color: "var(--sk-t4)", bg: "rgba(255,255,255,0.02)" };
  }
}

export function MeetingsTab({
  upcoming,
  past,
  loading,
  onFetchTranscript,
}: {
  upcoming: CalendarEvent[];
  past: MeetingRecord[];
  loading: boolean;
  onFetchTranscript?: (id: string) => Promise<{ speaker: string; text: string; timestamp?: string }[]>;
}) {
  const [expandedPast, setExpandedPast] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState<string | null>(null);
  const [transcriptLines, setTranscriptLines] = useState<{ speaker: string; text: string; timestamp?: string }[]>([]);
  const [transcriptSearch, setTranscriptSearch] = useState("");
  const [briefOpen, setBriefOpen] = useState<string | null>(null);

  if (loading) {
    return <div className="py-8 text-center" style={{ fontSize: 11, color: "var(--sk-t4)" }}>Loading meetings...</div>;
  }

  return (
    <div className="mt-4">
      {/* Upcoming */}
      <SectionDivider label="UPCOMING" count={upcoming.length} />
      {upcoming.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--sk-t4)", padding: "8px 0" }}>No upcoming meetings</p>
      ) : (
        upcoming.map((evt) => (
          <div
            key={evt.id}
            style={{
              background: "var(--sk-card-lead)",
              border: "1px solid var(--sk-border)",
              borderRadius: 10,
              padding: "14px 16px",
              marginBottom: 8,
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p style={{ fontSize: 12, fontWeight: 700, color: "var(--sk-t1)" }}>{evt.title}</p>
                <p style={{ fontSize: 10, color: "var(--sk-t2)", marginTop: 2 }}>
                  {formatMeetingDate(evt.start_time)} · {durationMin(evt.start_time, evt.end_time)} min
                  {evt.event_type && (
                    <span
                      style={{
                        marginLeft: 6,
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 999,
                        background: "rgba(0,134,255,0.06)",
                        color: "var(--sk-blue)",
                      }}
                    >
                      {evt.event_type}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setBriefOpen(briefOpen === evt.id ? null : evt.id)}
                  style={{
                    background: "var(--sk-card)",
                    border: "1px solid var(--sk-border)",
                    color: "var(--sk-t2)",
                    borderRadius: 7,
                    padding: "6px 12px",
                    fontSize: 11,
                  }}
                >
                  Pre-call Brief
                </button>
                {evt.meeting_url && (
                  <a
                    href={evt.meeting_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      background: "var(--sk-blue)",
                      color: "#fff",
                      borderRadius: 7,
                      padding: "6px 12px",
                      fontSize: 11,
                      fontWeight: 600,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <Video size={13} /> Join
                  </a>
                )}
              </div>
            </div>
            {/* Attendee pills */}
            {evt.attendees.length > 0 && (
              <div className="flex gap-1.5 mt-2">
                {evt.attendees.map((a, i) => (
                  <span
                    key={i}
                    style={{
                      background: "var(--sk-card)",
                      fontSize: 9,
                      color: "var(--sk-t3)",
                      padding: "2px 8px",
                      borderRadius: 999,
                    }}
                  >
                    {a.name ?? a.email}
                  </span>
                ))}
              </div>
            )}
            {/* Pre-call brief (expandable) */}
            {briefOpen === evt.id && (
              <div
                style={{
                  background: "rgba(0,0,0,0.25)",
                  borderRadius: 8,
                  padding: "12px 14px",
                  marginTop: 10,
                }}
              >
                <p style={{ fontSize: 9, fontWeight: 700, color: "var(--sk-orange)", textTransform: "uppercase", marginBottom: 6 }}>
                  PRE-CALL BRIEF
                </p>
                <p style={{ fontSize: 11, color: "var(--sk-t2)", lineHeight: 1.65 }}>
                  {evt.pre_call_brief_sent ? "Brief was sent. Check your Slack or email for the full brief." : "Brief has not been generated yet for this meeting."}
                </p>
              </div>
            )}
          </div>
        ))
      )}

      {/* Past */}
      <SectionDivider label="PAST" count={past.length} />
      {past.length === 0 ? (
        <p style={{ fontSize: 11, color: "var(--sk-t4)", padding: "8px 0" }}>No past meetings</p>
      ) : (
        past.map((m) => {
          const expanded = expandedPast === m.id;
          const intel = m.intelligence as Record<string, unknown> | undefined;
          const decisions = (intel?.key_decisions as string[]) ?? (intel?.commitments as Array<{ text: string }>)?.map((c) => c.text) ?? [];
          const actionItems = (intel?.action_items as Array<{ text: string; assigned_to?: string }>)?.map((a) => a.text) ?? [];
          const dur = durationMin(m.start_time, m.end_time);

          return (
            <div
              key={m.id}
              style={{
                background: "var(--sk-card-lead)",
                border: "1px solid var(--sk-border)",
                borderLeft: (m.no_show_detected || m.meeting_outcome_reason === "lead_no_show" || m.meeting_outcome_reason === "nobody_joined")
                  ? "3px solid #E54545"
                  : m.meeting_outcome_reason === "user_no_show"
                    ? "3px solid #F2903D"
                    : m.meeting_outcome_reason === "recording_failed"
                      ? "3px solid #F2903D"
                      : "1px solid var(--sk-border)",
                borderRadius: 10,
                marginBottom: 8,
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <button
                onClick={() => setExpandedPast(expanded ? null : m.id)}
                className="w-full flex items-center gap-2 text-left"
                style={{ padding: "10px 14px" }}
              >
                <span className="flex-1 flex items-center gap-2">
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--sk-t1)" }}>
                    {m.title}
                  </span>
                  {/* Status badge */}
                  {m.no_show_detected || m.meeting_outcome_reason === "lead_no_show" || m.meeting_outcome_reason === "nobody_joined" ? (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: outcomeLabel(m.meeting_outcome_reason ?? "lead_no_show").bg,
                      color: outcomeLabel(m.meeting_outcome_reason ?? "lead_no_show").color,
                    }}>
                      {m.meeting_outcome_reason === "nobody_joined" ? "No-show" : "No-show"}
                    </span>
                  ) : m.meeting_outcome_reason === "user_no_show" ? (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "rgba(242,144,61,0.1)",
                      color: "#F2903D",
                    }}>
                      You missed
                    </span>
                  ) : m.meeting_outcome_reason === "recording_failed" ? (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "rgba(242,144,61,0.1)",
                      color: "#F2903D",
                    }}>
                      Recording failed
                    </span>
                  ) : m.has_transcript ? (
                    m.processing_status === "complete" && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: "rgba(62,207,142,0.08)",
                        color: "var(--sk-green)",
                      }}>
                        Recorded
                      </span>
                    )
                  ) : (
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.04)",
                      color: "var(--sk-t4)",
                    }}>
                      No recording
                    </span>
                  )}
                </span>
                <span style={{ fontSize: 10, color: "var(--sk-t4)" }}>
                  {formatMeetingDate(m.meeting_date)} · {dur} min
                </span>
                {expanded ? <ChevronDown size={13} style={{ color: "var(--sk-t4)" }} /> : <ChevronRight size={13} style={{ color: "var(--sk-t4)" }} />}
              </button>

              {expanded && (
                <div style={{ padding: "0 14px 14px" }}>
                  {/* Meeting outcome message (when no transcript) */}
                  {!m.has_transcript && (() => {
                    const reason = m.meeting_outcome_reason;
                    const label = outcomeLabel(reason);

                    if (reason === "lead_no_show" || (m.no_show_detected && !reason)) {
                      return (
                        <div style={{
                          background: "rgba(229,69,69,0.05)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          marginBottom: 12,
                        }}>
                          <p style={{ fontSize: 11, color: "#E54545", lineHeight: 1.6 }}>
                            The lead didn&apos;t show up to this meeting. A re-engagement sequence may have been started.
                          </p>
                        </div>
                      );
                    }
                    if (reason === "user_no_show") {
                      return (
                        <div style={{
                          background: "rgba(242,144,61,0.05)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          marginBottom: 12,
                        }}>
                          <p style={{ fontSize: 11, color: "#F2903D", lineHeight: 1.6 }}>
                            The lead joined this meeting but you weren&apos;t there. Consider reaching out to apologise and reschedule.
                          </p>
                        </div>
                      );
                    }
                    if (reason === "nobody_joined") {
                      return (
                        <div style={{
                          background: "rgba(255,255,255,0.03)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          marginBottom: 12,
                        }}>
                          <p style={{ fontSize: 11, color: "var(--sk-t4)", lineHeight: 1.6 }}>
                            Nobody joined this meeting. Both parties may have forgotten or the link may not have worked. Consider reaching out to reschedule.
                          </p>
                        </div>
                      );
                    }
                    if (reason === "recording_failed") {
                      return (
                        <div style={{
                          background: "rgba(242,144,61,0.05)",
                          borderRadius: 8,
                          padding: "10px 12px",
                          marginBottom: 12,
                        }}>
                          <p style={{ fontSize: 11, color: "#F2903D", lineHeight: 1.6 }}>
                            The meeting took place but the recording failed. The conversation was not captured.
                          </p>
                        </div>
                      );
                    }
                    // Default: unknown reason
                    return (
                      <div style={{
                        background: label.bg,
                        borderRadius: 8,
                        padding: "10px 12px",
                        marginBottom: 12,
                      }}>
                        <p style={{ fontSize: 11, color: label.color, lineHeight: 1.6 }}>
                          {label.text}. The meeting bot may not have been scheduled or the recording failed.
                        </p>
                      </div>
                    );
                  })()}

                  {/* Summary (only if transcript exists) */}
                  {m.summary && (
                    <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
                      <p style={{ fontSize: 9, fontWeight: 700, color: "var(--sk-t3)", textTransform: "uppercase", marginBottom: 4 }}>SUMMARY</p>
                      <p style={{ fontSize: 11, color: "var(--sk-t2)", lineHeight: 1.6 }}>{m.summary}</p>
                    </div>
                  )}

                  {/* Decisions + Actions grid */}
                  {(decisions.length > 0 || actionItems.length > 0) && (
                    <div className="grid grid-cols-2 gap-4 mb-3">
                      {decisions.length > 0 && (
                        <div>
                          <p style={{ fontSize: 9, color: "var(--sk-green)", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>KEY DECISIONS</p>
                          {decisions.map((d, i) => (
                            <p key={i} style={{ fontSize: 11, color: "var(--sk-t2)", borderLeft: "2px solid rgba(62,207,142,0.19)", paddingLeft: 8, marginBottom: 4 }}>
                              {d}
                            </p>
                          ))}
                        </div>
                      )}
                      {actionItems.length > 0 && (
                        <div>
                          <p style={{ fontSize: 9, color: "var(--sk-orange)", textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>ACTION ITEMS</p>
                          {actionItems.map((a, i) => (
                            <p key={i} style={{ fontSize: 11, color: "var(--sk-t2)", borderLeft: "2px solid rgba(242,144,61,0.19)", paddingLeft: 8, marginBottom: 4 }}>
                              {a}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transcript toggle (only if transcript exists) */}
                  {m.has_transcript && (
                    <>
                      <button
                        onClick={async () => {
                          if (transcriptOpen === m.id) {
                            setTranscriptOpen(null);
                            return;
                          }
                          setTranscriptOpen(m.id);
                          if (onFetchTranscript && m.transcript_id) {
                            const lines = await onFetchTranscript(m.transcript_id);
                            setTranscriptLines(lines);
                          }
                        }}
                        className="flex items-center gap-1.5"
                        style={{ fontSize: 9, color: "var(--sk-t3)", textTransform: "uppercase" }}
                      >
                        {transcriptOpen === m.id ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                        TRANSCRIPT
                      </button>

                      {transcriptOpen === m.id && (
                        <div style={{ marginTop: 8 }}>
                          <div className="relative mb-2">
                            <Search size={11} className="absolute" style={{ left: 8, top: "50%", transform: "translateY(-50%)", color: "var(--sk-t4)" }} />
                            <input
                              value={transcriptSearch}
                              onChange={(e) => setTranscriptSearch(e.target.value)}
                              placeholder="Search..."
                              style={{
                                width: "100%",
                                background: "rgba(0,0,0,0.2)",
                                border: "1px solid var(--sk-border)",
                                borderRadius: 6,
                                padding: "6px 8px 6px 26px",
                                fontSize: 10,
                                color: "var(--sk-t2)",
                                outline: "none",
                              }}
                            />
                          </div>
                          <div style={{ maxHeight: 300, overflowY: "auto", background: "rgba(0,0,0,0.15)", borderRadius: 8, padding: 8 }}>
                            {transcriptLines
                              .filter((l) => !transcriptSearch || l.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
                              .map((line, i) => {
                                const isMatch = transcriptSearch && line.text.toLowerCase().includes(transcriptSearch.toLowerCase());
                                return (
                                  <div
                                    key={i}
                                    className="flex gap-2 py-1"
                                    style={{
                                      background: isMatch ? "rgba(242,144,61,0.03)" : undefined,
                                      borderLeft: isMatch ? "2px solid var(--sk-orange)" : "2px solid transparent",
                                      paddingLeft: 6,
                                    }}
                                  >
                                    <span style={{ fontSize: 9, color: "var(--sk-t4)", width: 36, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                                      {line.timestamp ?? ""}
                                    </span>
                                    <span style={{ fontSize: 9, fontWeight: 700, width: 56, flexShrink: 0, color: "var(--sk-orange)" }}>
                                      {line.speaker}
                                    </span>
                                    <span style={{ fontSize: 11, color: "var(--sk-t2)", lineHeight: 1.55 }}>{line.text}</span>
                                  </div>
                                );
                              })}
                            {transcriptLines.length === 0 && (
                              <p style={{ fontSize: 10, color: "var(--sk-t4)", textAlign: "center", padding: 16 }}>Loading transcript...</p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
