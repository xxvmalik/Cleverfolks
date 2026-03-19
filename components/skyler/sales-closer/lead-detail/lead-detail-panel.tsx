"use client";

import { useState } from "react";
import { DetailHeader } from "./detail-header";
import { AlertsSection } from "./alerts-section";
import { SkylerRequest } from "./skyler-request";
import { ApprovalQueue } from "./approval-queue";
import { TabBar, type DetailTab } from "./detail-tabs/tab-bar";
import { ActivityTab } from "./detail-tabs/activity-tab";
import { MeetingsTab } from "./detail-tabs/meetings-tab";
import { InstructionsTab } from "./detail-tabs/instructions-tab";
import { DetailHeaderSkeleton } from "../shared/skeleton-loaders";
import type { PipelineRecord, AlertItem, DirectiveItem, CalendarEvent, MeetingRecord } from "../types";

export function LeadDetailPanel({
  record,
  loading,
  alerts,
  directives,
  directivesLoading,
  upcomingMeetings,
  pastMeetings,
  meetingsLoading,
  onApprove,
  onReject,
  onDismissAlert,
  onReplyToRequest,
  onDismissRequest,
  onAddDirective,
  onRemoveDirective,
  onFetchTranscript,
  onTagForChat,
}: {
  record: PipelineRecord | null;
  loading: boolean;
  alerts: AlertItem[];
  directives: DirectiveItem[];
  directivesLoading: boolean;
  upcomingMeetings: CalendarEvent[];
  pastMeetings: MeetingRecord[];
  meetingsLoading: boolean;
  onApprove: (actionId: string) => void;
  onReject: (actionId: string, feedback: string) => void;
  onDismissAlert: (id: string) => void;
  onReplyToRequest: (text: string) => void;
  onDismissRequest: () => void;
  onAddDirective: (text: string) => void;
  onRemoveDirective: (id: string) => void;
  onFetchTranscript?: (id: string) => Promise<{ speaker: string; text: string; timestamp?: string }[]>;
  onTagForChat: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("activity");

  if (loading || !record) {
    if (loading) {
      return (
        <div className="flex-1 overflow-hidden" style={{ animation: "sk-fadeSlideUp 0.4s var(--sk-ease-out) 60ms forwards" }}>
          <DetailHeaderSkeleton />
        </div>
      );
    }
    return (
      <div
        className="flex-1 flex items-center justify-center"
        style={{ animation: "sk-fadeSlideUp 0.4s var(--sk-ease-out) 60ms forwards" }}
      >
        <p style={{ fontSize: 13, color: "var(--sk-t4)" }}>Select a lead to view details</p>
      </div>
    );
  }

  const pendingRequest = record.pending_requests?.[0];
  const contactFirstName = record.contact_name.split(/\s+/)[0];

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ animation: "sk-fadeSlideUp 0.4s var(--sk-ease-out) 60ms forwards" }}
    >
      <DetailHeader record={record} />

      <div className="flex-1 overflow-y-auto" style={{ padding: "0 22px 28px" }}>
        {/* Alerts */}
        <AlertsSection alerts={alerts} onDismiss={onDismissAlert} />

        {/* Skyler request */}
        {pendingRequest && (
          <SkylerRequest
            text={pendingRequest.request_description}
            onReply={() => onReplyToRequest(pendingRequest.request_description)}
            onDismiss={onDismissRequest}
          />
        )}

        {/* Approval queue */}
        <ApprovalQueue
          actions={record.pending_actions ?? []}
          onApprove={onApprove}
          onReject={onReject}
        />

        {/* Tabs */}
        <TabBar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          meetingCount={upcomingMeetings.length + pastMeetings.length}
          instructionCount={directives.length}
        />

        {/* Tab content with crossfade */}
        <div key={`${record.id}-${activeTab}`} style={{ animation: "sk-contentIn 0.25s var(--sk-ease-out)" }}>
          {activeTab === "activity" && (
            <ActivityTab thread={record.conversation_thread ?? []} loading={false} contactFirstName={contactFirstName} />
          )}
          {activeTab === "meetings" && (
            <MeetingsTab
              upcoming={upcomingMeetings}
              past={pastMeetings}
              loading={meetingsLoading}
              onFetchTranscript={onFetchTranscript}
            />
          )}
          {activeTab === "instructions" && (
            <InstructionsTab
              directives={directives}
              loading={directivesLoading}
              onAdd={onAddDirective}
              onRemove={onRemoveDirective}
            />
          )}
        </div>
      </div>
    </div>
  );
}
