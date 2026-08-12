export type Role = 'manager' | 'team_lead' | 'senior_associate' | 'associate';

export interface Staff {
  id: string;
  auth_user_id: string;
  full_name: string;
  email: string;
  role: Role;
  team_id: string | null;
  created_at: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  display_order: number;
}

export interface Client {
  id: string;
  name: string;
  type: string;
}

export interface WorkItem {
  id: string;
  client_id: string;
  patient_fake_name: string;
  current_stage: string;
  status: string;
  assigned_to: string;
  value: number;
  days_in_stage: number;
  created_at: string;
  updated_at: string;
  // §2 / §3 blueprint fields
  raw_status?: string | null;
  denial_category?: string | null;
  denial_appealable?: boolean | null;
  // Joined relations
  clients?: { name: string } | null;
  assigned_staff?: { full_name: string } | null;
}

export interface ActivityLog {
  id: string;
  work_item_id: string;
  staff_id: string;
  action: string;
  stage?: string | null;
  notes?: string | null;
  created_at: string;
}

// ── 7 stages matching Blueprint §1 ────────────────────────────
// Order: workflow progression left-to-right on kanban
// Terminal (rightmost): payment_posting — claim resolved, excluded from open queues
export const STAGE_ORDER = [
  'submitted',
  'denial_management',
  'appeals',
  'ar_follow_up',
  'collections',
  'on_hold',
  'payment_posting',
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<string, string> = {
  submitted:         'Submitted',
  denial_management: 'Denial Management',
  appeals:           'Appeals',
  ar_follow_up:      'AR Follow-Up',
  collections:       'Collections',
  on_hold:           'On Hold',
  payment_posting:   'Payment Posting',
};

export const STAGE_COLORS: Record<string, string> = {
  submitted:         'bg-blue-100 text-blue-700',
  denial_management: 'bg-red-100 text-red-700',
  appeals:           'bg-orange-100 text-orange-700',
  ar_follow_up:      'bg-sky-100 text-sky-700',
  collections:       'bg-purple-100 text-purple-700',
  on_hold:           'bg-amber-100 text-amber-700',
  payment_posting:   'bg-green-100 text-green-700',
};

// Terminal stage: payment posted = claim resolved
// Items in this stage are excluded from open queues (MyQueue, TeamQueue)
export const TERMINAL_STAGE = 'payment_posting';

export function getNextStage(current: string): string | null {
  const idx = STAGE_ORDER.indexOf(current as Stage);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function daysOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}
