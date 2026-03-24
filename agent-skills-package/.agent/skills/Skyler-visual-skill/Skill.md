---
name: skyler-visual
description: Use when building, styling, or modifying any part of the Skyler sales page UI. This includes the lead list, lead detail panel, chat panel, stage badges, health indicators, approval queue, alerts, meetings, instructions, and any Skyler-related frontend component. Always use this skill when touching anything under the Skyler page route, Skyler components, or Skyler-related UI logic. Do NOT use for left sidebar navigation (Lead Qualification, Prospect Engagement, Sales Closer, Workflow Settings, History) — that is standard app shell and already on-brand.
---

# Skyler Sales Page — Visual Design System

This skill defines every visual specification for the Skyler sales page. The backend is fully built. This skill is purely about the frontend presentation layer.

## Visual Reference

Design mockups and screenshots are available at:

```
C:\Users\admin\cleverfolksnew\Design\skyler-design\Skyler updated
```

Use these images as visual reference when building components. If any spec in this document is ambiguous, check the images for the intended look and feel. The specs in this document take precedence if there is a conflict between the images and the written spec (the images may include earlier iterations).

## Wiring to Backend

This is not a static mockup. Wire every UI element to the actual backend functionality that already exists in the codebase. Lead data, email threads, approval actions, chat messages, meetings, health scores, stage data — all of these have real APIs and database tables. Connect them.

After the build is complete, provide a clear list of any design elements that could NOT be wired because the backend endpoint, table, or functionality does not yet exist. Format it as:

```
UNWIRED ELEMENTS:
- [Component name] — [What it needs] — [Why it's unwired]
```

This lets us prioritise what backend work comes next. Do not silently leave things as placeholder or mock data without reporting them.

## What NOT to Touch

The collapsible left sidebar (Skyler avatar, nav items, history section) is standard app shell and already on-brand. Do not modify its structure, colours, or behaviour. The global top bar (CleverFolks logo, notification bell, user profile dropdown) is also standard. This skill covers everything BELOW and TO THE RIGHT of those existing elements.

---

## Page Layout

The Skyler page uses a **three-panel workspace** below the existing header and metrics row:

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Existing] Sales Closer header + toggle + metrics row             │
├──────────┬────────────────────────────────┬─────────────────────────┤
│          │                                │                         │
│  Lead    │       Lead Detail              │    Skyler Chat          │
│  List    │                                │    (collapsible)        │
│  260px   │       flex: 1                  │    310px                │
│          │                                │                         │
│          │                                │                         │
└──────────┴────────────────────────────────┴─────────────────────────┘
```

- **Lead List** — 260px fixed width, left panel, scrollable
- **Lead Detail** — flex: 1, centre panel, scrollable content area
- **Skyler Chat** — 310px fixed width, right panel, can be closed to a floating action button (FAB)

---

## Brand Colour System (LOCKED — do not deviate)

### Core Palette

| Token              | Hex         | Usage                                         |
|--------------------|-------------|-----------------------------------------------|
| `brand-blue`       | `#0086FF`   | Primary brand colour, P1 Prospecting stages   |
| `skyler-orange`    | `#F2903D`   | Skyler's accent, P2 Engaged stages, toggle dot|
| `brand-green`      | `#3ECF8E`   | Health 70+, P3 positive outcomes, approve btn  |
| `brand-red`        | `#E54545`   | Health <50, P3 negative outcomes, reject btn   |
| `brand-lime`       | `#C6E84B`   | P3 neutral (stalled)                          |
| `brand-purple`     | `#5B3DC8`   | Reserved (not currently used in Skyler UI)     |
| `brand-pink`       | `#E87DAA`   | Reserved (not currently used in Skyler UI)     |

### Surface Colours

| Token              | Hex                        | Usage                        |
|--------------------|----------------------------|------------------------------|
| `bg`               | `#0E0E0E`                  | Page background              |
| `surface`          | `#191919`                  | Panel backgrounds, headers   |
| `nav`              | `#111111`                  | Sidebar, chat panel bg       |
| `card`             | `#212121`                  | Metric cards, input fields, general cards |
| `card-lead`        | `#211F1E`                  | Lead cards, email cards, approval cards, alert cards |
| `border`           | `rgba(255,255,255,0.06)`   | Default border colour        |

### Text Hierarchy

| Token  | Value                        | Usage                          |
|--------|------------------------------|--------------------------------|
| `t1`   | `#FFFFFF`                    | Primary text (names, values)   |
| `t2`   | `rgba(255,255,255,0.55)`     | Secondary (body text, previews)|
| `t3`   | `rgba(255,255,255,0.3)`      | Tertiary (labels, hints)       |
| `t4`   | `rgba(255,255,255,0.18)`     | Muted (timestamps, meta)       |

---

## Pipeline Stages — Phase Mapping

All leads have a `stage` field from the database. Each stage maps to one of three phases, and each phase has a colour.

### Phase 1: Prospecting (colour: `#0086FF` brand-blue)

| Stage              | Display Label       |
|--------------------|---------------------|
| `initial_outreach` | Initial Outreach    |
| `follow_up_1`      | Follow Up 1         |
| `follow_up_2`      | Follow Up 2         |
| `follow_up_3`      | Follow Up 3         |

### Phase 2: Engaged (colour: `#F2903D` skyler-orange)

| Stage                  | Display Label          |
|------------------------|------------------------|
| `replied`              | Replied                |
| `pending_clarification`| Pending Clarification  |
| `negotiation`          | Negotiation            |
| `demo_booked`          | Demo Booked            |
| `proposal`             | Proposal               |

### Phase 3: Resolved

Resolved stages split by outcome:

**Positive (colour: `#3ECF8E` brand-green):**
- `payment_secured` → Payment Secured
- `closed_won` → Closed Won
- `meeting_booked` → Meeting Booked

**Negative (colour: `#E54545` brand-red):**
- `disqualified` → Disqualified
- `closed_lost` → Closed Lost
- `no_response` → No Response

**Neutral (colour: `#C6E84B` brand-lime):**
- `stalled` → Stalled

### Stage Badge Component

Display as a pill/chip with the phase colour. The badge always shows the specific stage label (not the phase name).

```
Background: {phase_colour} at 9% opacity (append "18" to hex)
Text colour: {phase_colour} at full opacity
Border: {phase_colour} at 19% opacity (append "30" to hex)
Border-radius: 999px (full pill)
Font-size: 10px
Font-weight: 600
Padding: 2px 9px
```

Example: A lead at `demo_booked` shows a pill reading "Demo Booked" in orange (`#F2903D`) text on an orange-tinted background.

---

## Health Score System

Health is a numeric score (0-100) computed on the backend. The UI shows it in two places:

### 1. Sidebar Lead Cards — Small Dot

A tiny coloured dot before the lead name.

```
Width/Height: 5px
Border-radius: 50%
Opacity: 0.7
```

Colour thresholds:
- Score 70+ → `#3ECF8E` (brand-green)
- Score 50-69 → `#F2903D` (skyler-orange)
- Score below 50 → `#E54545` (brand-red)

### 2. Detail Header — Large Circle

A 32px circle with the numeric score inside, shown in the lead detail header next to the deal value.

```
Width/Height: 32px
Border-radius: 50%
Background: {health_colour} at 9% opacity
Border: 2px solid {health_colour} at 27% opacity
Score text: 11px, font-weight 800, colour = health_colour
Label "HEALTH" below: 9px, t4, uppercase, letter-spacing 0.1em
```

Same colour thresholds as above.

---

## Sales Closer Toggle

The toggle control in the header. Frame and dot are separate elements.

```
Track/Frame: #545454 (ALWAYS — does not change with on/off state)
Width: 36px, Height: 20px, Border-radius: 10px

Dot: #F2903D (ALWAYS — does not change with on/off state)
Width: 16px, Height: 16px, Border-radius: 50%
Box-shadow: 0 1px 4px rgba(0,0,0,0.3)
Position: left: 2px when OFF, left: 18px when ON
Transition: left 0.2s
```

The colour does NOT change. Only the dot position changes to indicate state.

---

## Scrollbar Styling

Apply globally to all scrollable containers. Thin, translucent, visible only on hover.

```css
* {
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.06) transparent;
}
*::-webkit-scrollbar { width: 4px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 2px; }
*::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.12); }
*:hover::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
```

---

## Component Specifications

### 1. Lead List Panel (260px, left)

**Search bar:**
- Background: `#212121` (card)
- Border: 1px solid `border`
- Border-radius: 7px
- Padding: 8px 10px 8px 28px (space for search icon)
- Font-size: 11px
- Search icon: 13px, colour t4, positioned absolute left 9px

**Phase filter pills:**
- Four pills: All, Prospecting, Engaged, Resolved
- Active pill: background = phase_colour at 8% opacity, border = phase_colour at 19% opacity, text = phase_colour
- Inactive pill: transparent background, transparent border, text = t3
- Padding: 3px 8px, border-radius: 5px, font-size: 9px, font-weight: 600
- "All" pill uses neutral white when active (no phase colour)

**Lead cards:**
Each lead is a distinct card component:
```
Background: #211F1E (card-lead)
Border: 1px solid border (default), 1px solid #F2903D at 27% opacity (selected)
Border-radius: 10px
Padding: 12px 14px
Gap between cards: 6px
Container padding: 4px 8px (scroll area)
```

Hover (unselected): border brightens to `rgba(255,255,255,0.1)`

**Card contents (three rows):**

Row 1 — Name + icons:
- Health dot (5px, left)
- Lead name: 12px, font-weight 700, colour t1
- Approval indicator: small mail/envelope icon (11px) in skyler-orange at 60% opacity. Only shows if lead has pending drafts.
- Tag button (@): 11px icon in skyler-orange. Appears on hover or when card is selected. Background on hover: orange at 8% opacity.

Row 2 — Company + stage:
- Company name: 10px, colour t3
- Stage badge: right-aligned (see Stage Badge Component above)

Row 3 — Stats:
- Format: "{sent} sent · {replied} replied · £{dealValue}"
- Font-size: 9px, colour t4
- Dots between stats: 2px circles, rgba(255,255,255,0.1)

**Footer:**
- Border-top: 1px solid border
- Padding: 10px 12px
- Shows: "{count} leads" left, "{pending} pending" right
- Font-size: 9px, colour t4

### 2. Lead Detail Panel (flex, centre)

#### Detail Header

Background: `surface` (#191919). Padding: 14px 22px 12px. Border-bottom: 1px solid border.

**Top row (name + health + value):**

Left side:
- Lead name: 18px, font-weight 800, colour t1
- Stage badge: inline after name (see Stage Badge Component)
- Company: 11px, colour t2
- Email: 11px, colour t3
- Dot separator between company and email: 2px circle, rgba(255,255,255,0.12)

Right side:
- Health circle (large, 32px — see Health Score section)
- Vertical divider: 1px wide, 28px tall, colour = border
- Deal value: 20px, font-weight 800, colour t1
- "DEAL VALUE" label: 9px, colour t4, uppercase

**Bottom row (tags + stats):**

Left: Tag pills
- Background: `#212121` (card)
- Border: 1px solid border
- Padding: 2px 10px, border-radius: 999px
- Font-size: 10px, colour t3

Right: Email stats + time in stage
- Format: [icon] Label Value for each (Sent, Opened, Replied)
- Icon: 11px, colour t4
- Label: 9px, colour t3
- Value: 12px, font-weight 700, colour rgba(255,255,255,0.6)
- Vertical divider before "In stage"

#### Content Area (scrollable)

The content below the header scrolls. Padding: 0 22px 28px. Content sections appear in this order:

**A. Alerts from Skyler**

Contextual per-lead. Only shown when alerts exist for the selected lead. These are informational — Skyler telling the user something.

```
Background: #211F1E (card-lead) — ALL alerts use the same neutral style
Border: 1px solid border
Border-radius: 8px
Padding: 8px 12px
Gap between alerts: 6px
Margin-top: 16px (first section)
```

Contents:
- Emoji icon (12px, flexShrink: 0)
- Alert text: 11px, colour rgba(255,255,255,0.65), line-height 1.4
- Timestamp: 9px, colour t4, right-aligned, no-wrap
- Dismiss button: X icon (12px), opacity 0.3

Alert types (backend provides the emoji):
- 👤 New attendee joined a meeting
- 📧 Draft ready / follow-up sent
- 🚫 No-show
- 🔄 Rescheduling pattern
- 📉 Meeting fatigue (no progression)
- ⏳ Lead going cold
- 📅 Calendar not connected — "Connect your calendar in Settings to let Skyler book meetings." Text includes a clickable link to the Settings/Connectors page.

IMPORTANT: All alerts look identical. No colour differentiation between alert types. The emoji handles type distinction.

**B. Request from Skyler**

When Skyler is blocked and needs user input. Different from alerts — this has a reply button.

```
Background: #F2903D at 3% opacity
Border: 1px solid #F2903D at 9% opacity
Border-radius: 10px
Padding: 14px 16px
Margin-top: 14px
```

Contents:
- Skyler avatar: 26px circle, gradient (orange to #E8752B), rounded 7px, with msgCircle icon
- "SKYLER NEEDS YOUR INPUT" label: 9px, font-weight 700, colour skyler-orange, uppercase
- Request text: 11px, colour rgba(255,255,255,0.65), line-height 1.5
- Buttons: "Reply to Skyler" (background: skyler-orange, white text) + "Dismiss" (background: card, border, text: t3)

**C. Pending Approval Queue**

Drafts from Skyler waiting for approve/reject. This is the MOST important action — it sits above the tabs, not inside them.

IMPORTANT: All drafts appear in this single queue regardless of what triggered them — scheduled follow-ups, no-show response emails, user-requested drafts, breakup emails, etc. There is no separate UI for different draft types. One queue, one flow.

Section header uses a divider component:
```
"PENDING APPROVAL" label: 10px, font-weight 700, colour t3, uppercase, letter-spacing 0.08em
Count badge: 9px, colour t4, background rgba(255,255,255,0.04), pill shape
Horizontal rule: flex: 1, 1px, colour = border
Margin: 20px top, 12px bottom
```

Each approval card:
```
Background: #211F1E (card-lead)
Border: 1px solid #F2903D at 6% opacity
Border-radius: 10px
Gap between cards: 6px
```

Collapsed state (clickable header):
- Mail icon: 13px, colour skyler-orange
- Subject line: 12px, font-weight 600, colour t1
- "Urgent" badge (if applicable): background red at 8%, colour red, 9px
- Timestamp: 10px, colour t4
- Chevron: right (collapsed) or down (expanded), 13px, colour t4

Expanded state:
- Draft preview: background rgba(0,0,0,0.25), border-radius 8px, padding 14px 16px, pre-wrap, 11px, colour t2, line-height 1.7
- Edit mode: textarea with same dimensions, background rgba(0,0,0,0.3), border 1px solid border
- Reject mode (two-step flow):
  1. User clicks "Reject" button → a text input appears below the draft preview
  2. Input placeholder: "Tell Skyler why..." — background rgba(0,0,0,0.2), border 1px solid red at 20% opacity, border-radius 6px, padding 7px 10px, font-size 11px
  3. "Reject" button text changes to "Confirm Reject" (same red styling but slightly stronger background)
  4. User types reason and clicks "Confirm Reject" → card is removed, reason is sent to backend for Skyler's learning system
  5. If user clicks away or selects another lead before confirming, reject mode resets

Action buttons:
- "Approve & Send": background `#3ECF8E` (brand-green), white text, check icon
- "Edit": background `#212121` (card), border, text t2, edit icon
- "Reject": background red at 3%, border red at 7%, text red
- All buttons: padding 7px 16px, border-radius 7px, font-size 11px

**D. Tabbed Content Area**

Three tabs below the approval queue:

```
Tab bar: border-bottom 1px solid border, margin-top 24px
Active tab: text t1, border-bottom 2px solid #F2903D (skyler-orange)
Inactive tab: text t3, border-bottom 2px solid transparent
Padding: 10px 18px per tab
Font-size: 11px, font-weight 600
Icon: 13px, colour = skyler-orange (active) or t4 (inactive)
Count badge: 9px pill, orange-tinted (active) or neutral (inactive)
```

Tabs:
1. **Activity** (mail icon) — Email conversation thread
2. **Meetings** (calendar icon) — Upcoming + past meetings with count badge
3. **Instructions** (list icon) — Per-lead instructions with count badge

#### Tab: Activity

Email thread for the selected lead.

Empty state:
- Inbox icon: 32px, colour rgba(255,255,255,0.06), centred
- "No email activity yet": 12px, colour t4

Each email card:
```
Background: #211F1E (card-lead)
Border: 1px solid border
Border-radius: 10px
Padding: 14px 16px
Gap between emails: 12px
```

Email header row:
- Direction badge: pill, "You" (orange tint, orange text) or lead first name (green tint, green text)
- Subject: 11px, font-weight 600, colour t2
- Sentiment dot: 5px circle — green (positive), red (negative), t4 (neutral)
- Date: 10px, colour t4, right-aligned

Email body:
- 12px, colour rgba(255,255,255,0.45), line-height 1.7, white-space pre-wrap

#### Tab: Meetings

Split into Upcoming and Past with section dividers.

**Upcoming meetings:**

```
Background: #211F1E (card-lead)
Border: 1px solid border
Border-radius: 10px
```

Contents:
- Title: 12px, font-weight 700, colour t1
- Date/time: 10px, colour t2
- Duration: 10px, colour t3
- Type badge: blue-tinted pill (#0086FF at 6% bg, blue text, 9px)
- "Pre-call Brief" button: background card, border, text t2
- "Join" button: background `#0086FF` (brand-blue), white text, video icon
- Attendee pills: background card, 9px, colour t3

Pre-call brief (expandable):
- Background: rgba(0,0,0,0.25), border-radius 8px, padding 12px 14px
- "PRE-CALL BRIEF" label: 9px, font-weight 700, colour skyler-orange, uppercase
- Brief text: 11px, colour t2, line-height 1.65

**Past meetings:**

Collapsible cards. Click to expand.

Summary section:
- Background: rgba(0,0,0,0.2), border-radius 8px
- "SUMMARY" label: 9px, font-weight 700, colour t3, uppercase

Decisions + Actions: displayed side by side (CSS grid, 2 columns)
- "KEY DECISIONS" label: 9px, colour brand-green, uppercase
- Each decision: 11px, colour t2, left border 2px solid green at 19%
- "ACTION ITEMS" label: 9px, colour skyler-orange, uppercase
- Each action: 11px, colour t2, left border 2px solid orange at 19%

**Transcript (deepest disclosure layer):**

Hidden by default. Toggle button:
- Chevron icon + "TRANSCRIPT" label (9px, t3, uppercase) + line count

When expanded:
- Search input: background rgba(0,0,0,0.2), border, 10px font, search icon
- Transcript container: max-height 300px, overflow-y auto, background rgba(0,0,0,0.15), border-radius 8px

Each transcript line:
- Timestamp: 9px, colour t4, width 36px, tabular-nums
- Speaker name: 9px, font-weight 700, width 56px, colour = skyler-orange (workspace owner) or brand-green (prospect)
- Text: 11px, colour t2, line-height 1.55

Search highlight: background orange at 3%, left border 2px solid skyler-orange

#### Tab: Instructions

Per-lead instructions the user has given Skyler.

Description text: 11px, colour t3, line-height 1.5, margin-bottom 16px

Each instruction card:
```
Background: #211F1E (card-lead)
Border: 1px solid border
Border-radius: 8px
Padding: 10px 14px
Gap: 6px
```

Contents:
- Instruction text: 11px, colour t2
- "Added {date}" label: 9px, colour t4
- Remove button: X icon (13px), opacity 0.25

Add instruction input:
- Input: background card, border, border-radius 7px, padding 8px 12px, 11px
- "Add" button: background card, border, text t3, plus icon

---

### 3. Skyler Chat Panel (310px, right)

Background: `#111111` (nav). Border-left: 1px solid border.

#### Chat Header

Two sub-tabs: **Chat** and **History**

- Skyler avatar: 24px, border-radius 6px, gradient (orange to #E8752B), zap icon
- "Skyler" label: 13px, font-weight 700
- "New" button (visible in history/viewing mode): background orange at 6%, border orange at 13%, text orange, newChat icon
- Close button: X icon, opacity 0.3

Tab bar:
- Active: text t1, border-bottom 2px solid skyler-orange
- Inactive: text t3, border-bottom 2px solid transparent
- History tab has a history icon and count badge

#### Chat View

**Empty state:**
- Skyler icon: 44px, border-radius 12px, gradient, zap icon, opacity 0.45
- "Ask Skyler about outreach, pipeline, or performance.": 11px, colour t3
- "Use @ to tag a lead.": 10px, colour t4, with orange @ symbol

**Message bubbles:**

User messages:
```
Background: #F2903D at 9% opacity
Colour: rgba(255,255,255,0.8)
Border-radius: 12px (bottom-right: 3px)
Max-width: 88%
Padding: 10px 14px
Font-size: 11px, line-height 1.6
```

Skyler messages:
```
Background: #212121 (card)
Border: 1px solid border
Colour: t2
Border-radius: 12px (bottom-left: 3px)
Same padding/font as user
```

Tagged lead chip (above user messages when a lead is tagged):
- Health dot + lead name (9px, colour t4)

**Tagged lead context bar** (above input, when a lead is tagged):
```
Background: #F2903D at 3% opacity
Border: 1px solid #F2903D at 6% opacity
Border-radius: 8px
Padding: 7px 10px
```
- Health dot + name (11px, font-weight 600, t1) + company (9px, t3)
- Dismiss X button

**Chat input:**
```
Background: #212121 (card)
Border: 1px solid border
Border-radius: 8px
Padding: 9px 12px
Font-size: 11px
```
- Send icon: 14px, colour skyler-orange, opacity 1 when text present, 0.2 when empty

**Placeholder text:**
- When lead tagged: "Ask about {firstName}..."
- When no lead: "Message Skyler..."

#### History View

**Lead filter pills:**
- Same styling as phase filter pills
- "All" pill + one pill per unique lead name (first name only)
- Active pill: orange-tinted

**Thread list grouped by date:**
- Date header: 9px, font-weight 700, colour t4, uppercase, with horizontal rule
- Thread card: full-width button, padding 10px 12px
  - Health dot + lead name (11px, font-weight 600, t1) + company (9px, t4) + message count (9px, t4)
  - Preview text: 10px, colour t3, ellipsis overflow, left padding 12px
- Hover: background rgba(255,255,255,0.02)

#### Thread Viewing Mode

- Back button: arrowLeft icon + "Back" (12px, font-weight 600, t2)
- Thread header: health dot + lead name + company + date
- Messages rendered with same bubble styles as chat
- "Continue conversation" button at bottom:
  - Full width, background orange at 3%, border orange at 9%, text orange
  - msgCircle icon + "Continue conversation"
  - On click: loads messages into chat, tags the lead, switches to chat view

---

## Interaction Flows

### Tag-to-Chat (@ button on lead cards)

1. User hovers a lead card → @ icon appears (opacity transition)
2. User clicks @ → chat panel opens (if closed), switches to Chat tab, tags the lead, pre-fills input with "@{firstName} "
3. Tagged lead context bar appears above chat input
4. User sends message → Skyler responds with context about that lead
5. User can dismiss tag via X on context bar to go general

### Start New Chat (+ Start new chat button in left nav)

1. Opens chat panel
2. Clears any tagged lead
3. Clears all messages
4. Resets to Chat tab
5. Input placeholder: "Message Skyler..."

### Approve/Reject Draft

1. Click approval card header → expands to show draft preview
2. "Approve & Send" → removes card from queue, triggers backend send
3. "Edit" → switches preview to editable textarea
4. "Done editing" → exits edit mode (content is updated)
5. "Reject" → shows reason input field
6. "Confirm Reject" → removes card, sends rejection reason to backend

### Lead Selection

1. Click lead card → selects lead, resets all expanded states
2. Detail panel updates: header, alerts, request, approvals, tab content
3. Tab resets to "Activity"
4. All expandable sections (approvals, meetings, transcript, brief) collapse

---

## Responsive Behaviour

Desktop-first design. The three-panel layout requires minimum ~1024px viewport width.

- Left nav can collapse to 56px icon-only mode (existing behaviour — do not modify)
- Chat panel can be closed → shows orange FAB (44px, border-radius 12px, gradient, bottom-right fixed)
- When chat is closed, detail panel expands to fill the space
- Lead list width is fixed at 260px (does not resize)

---

## Font

Plus Jakarta Sans. Load from Google Fonts:
```
https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap
```

Fallback: system-ui, sans-serif

---

## Data Sources

All data comes from existing backend tables/APIs. The UI reads from:

- `skyler_leads` or equivalent — lead name, company, email, stage, deal value, health score, tags, email stats, time in stage
- `skyler_actions` — pending approval drafts (subject, preview, urgency, created_at)
- `skyler_alerts` — per-lead alerts (type, text, emoji, timestamp)
- `skyler_requests` — per-lead requests from Skyler (text, type)
- Email thread data — direction, subject, date, body, sentiment
- Meeting data — upcoming/past, attendees, type, summary, decisions, actions, transcript
- Lead instructions — text, added date
- Chat messages — role (user/skyler), text, tagged lead reference
- Chat history — grouped by date, with lead context

---

## Z-Index Layering

1. Global top bar: z-index 20
2. Tooltips (@ button hover): z-index 10
3. Everything else: default stacking

---

Animations and Transitions
The motion system should feel like Linear or Raycast — fast, intentional, and satisfying. Every animation has a purpose. Nothing moves just because it can.
Easing
Use a single custom easing for all transitions:
css--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);
Never use ease or linear. The custom cubic-bezier gives that snappy, modern feel — fast out of the gate, soft landing.
Page Load — Staggered Reveal
When the Skyler page first loads, the three panels fade in with a stagger:
css@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Lead list: delay 0ms, Detail: delay 60ms, Chat: delay 120ms */
animation: fadeSlideUp 0.4s var(--ease-out) forwards;
Metrics cards in the header also stagger left-to-right (20ms between each card). Subtle — 6px translateY, not dramatic.
Lead Card Selection
When a lead card is selected:

Border colour transitions: transition: border-color 0.2s var(--ease-out)
Background transitions: transition: background 0.15s var(--ease-out)
The selected card gets a subtle scale pulse on click: transform: scale(0.98) for 100ms then back to scale(1) — gives tactile feedback

Lead Detail Panel — Content Crossfade
When switching between leads, the detail panel content crossfades:
css@keyframes contentIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Duration: 0.25s, easing: ease-out */
Apply to the scrollable content area (not the header — the header updates instantly). This prevents the jarring snap when clicking between leads.
Expandable Sections (Approvals, Meetings, Transcript, Pre-call Brief)
Use max-height or grid-template-rows: 0fr → 1fr for smooth height animation:
csstransition: grid-template-rows 0.25s var(--ease-out);
Content inside the expanding section fades in with a slight delay (50ms after expand starts):
csstransition: opacity 0.2s var(--ease-out) 0.05s;
Collapse is faster than expand (0.15s vs 0.25s). Closing should feel snappy, opening should feel smooth.
Tab Switching
When switching between Activity / Meetings / Instructions:

Outgoing content fades out: opacity 1 → 0, 0.1s
Incoming content fades in with slight slide: opacity 0 → 1, translateY(4px) → 0, 0.2s
The active tab underline slides to the new position (not a jump): transition: left 0.25s var(--ease-out), width 0.25s var(--ease-out)

The sliding tab indicator is the signature detail — it should feel like it's tracking your selection physically.
Chat Messages
New messages slide in from below:
css@keyframes messageIn {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Duration: 0.3s, easing: ease-out */
User messages slide from the right, Skyler messages slide from the left (add translateX(8px) or translateX(-8px) respectively, in addition to the Y). This gives a natural conversational rhythm.
Alert Dismiss
When dismissing an alert:
css@keyframes alertDismiss {
  to { opacity: 0; transform: translateX(20px); height: 0; padding: 0; margin: 0; border: 0; }
}
/* Duration: 0.25s, easing: ease-in-out */
Slides right and collapses. The remaining alerts shift up smoothly (handled by the gap in the flex container).
Approval Actions

"Approve & Send" click: card briefly flashes green at 10% opacity (a 0.15s pulse), then collapses using the alert dismiss animation
"Confirm Reject" click: same but with a red flash
These micro-celebrations give feedback that the action was registered

Chat Panel Open/Close
When opening the chat panel:
css@keyframes panelSlideIn {
  from { width: 0; min-width: 0; opacity: 0; }
  to { width: 310px; min-width: 310px; opacity: 1; }
}
/* Duration: 0.3s, easing: ease-out */
When closing: reverse, 0.2s (faster out). The FAB that appears after closing fades in with a scale: scale(0.8) → scale(1), opacity 0 → 1, 0.2s.
Hover Micro-Interactions

Lead cards: transition: border-color 0.15s, background 0.15s
Buttons (approve, reject, edit): transition: background 0.12s, border-color 0.12s, transform 0.1s — on hover, add transform: translateY(-1px) for a subtle lift
@ tag button: transition: opacity 0.15s, background 0.12s
Chat send button: transition: opacity 0.15s
Tab items: transition: color 0.15s, border-color 0.15s

Skeleton Loading States
When data is loading from the backend, show skeleton placeholders:
css@keyframes shimmer {
  from { background-position: -200px 0; }
  to { background-position: 200px 0; }
}

.skeleton {
  background: linear-gradient(90deg, #211F1E 25%, #2a2a2a 50%, #211F1E 75%);
  background-size: 400px 100%;
  animation: shimmer 1.2s infinite;
  border-radius: 6px;
}
Apply to:

Lead cards: 3 skeleton cards (name bar + company bar + stats bar)
Detail header: name bar + company bar + stat pills
Email cards: 2 skeleton email blocks
Chat messages: 2 skeleton bubbles

Skeletons use the #211F1E base colour so they feel native to the dark UI.
Performance Rules

Only animate transform and opacity where possible (GPU-composited, no layout thrashing)
will-change: transform on elements that animate frequently (chat messages, lead cards)
Wrap all motion in @media (prefers-reduced-motion: no-preference) — users who disable motion get instant state changes with no animation
No animation should exceed 0.4s. If it feels slow, it is slow. Cut the duration.