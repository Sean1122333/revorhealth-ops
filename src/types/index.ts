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
  // Joined relations (no FK from work_items → teams; team is via staff)
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

// Real stage slugs from work_items.current_stage, in workflow order
export const STAGE_ORDER = [
  'eligibility',
  'charge_entry',
  'coding',
  'claims_submission',
  'payment_posting',
  'ar_follow_up',
  'denial_management',
  'appeals',
  'patient_collections',
  'credentialing',
  'reporting',
] as const;

export type Stage = (typeof STAGE_ORDER)[number];

export const STAGE_LABELS: Record<string, string> = {
  eligibility:        'Eligibility',
  charge_entry:       'Charge Entry',
  coding:             'Coding',
  claims_submission:  'Claims Submission',
  payment_posting:    'Payment Posting',
  ar_follow_up:       'AR Follow-Up',
  denial_management:  'Denial Management',
  appeals:            'Appeals',
  patient_collections:'Patient Collections',
  credentialing:      'Credentialing',
  reporting:          'Reporting',
};

export const STAGE_COLORS: Record<string, string> = {
  eligibility:        'bg-blue-100 text-blue-700',
  charge_entry:       'bg-violet-100 text-violet-700',
  coding:             'bg-indigo-100 text-indigo-700',
  claims_submission:  'bg-cyan-100 text-cyan-700',
  payment_posting:    'bg-green-100 text-green-700',
  ar_follow_up:       'bg-sky-100 text-sky-700',
  denial_management:  'bg-red-100 text-red-700',
  appeals:            'bg-orange-100 text-orange-700',
  patient_collections:'bg-purple-100 text-purple-700',
  credentialing:      'bg-teal-100 text-teal-700',
  reporting:          'bg-gray-100 text-gray-600',
};

// Terminal stage — equivalent to "closed" in RCM workflow
export const TERMINAL_STAGE = 'reporting';

export function getNextStage(current: string): string | null {
  const idx = STAGE_ORDER.indexOf(current as Stage);
  if (idx === -1 || idx === STAGE_ORDER.length - 1) return null;
  return STAGE_ORDER[idx + 1];
}

export function daysOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}
