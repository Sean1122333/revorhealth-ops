export interface Client {
  id: string;
  name: string;
  type: string;
  location: string;
  status: string;
  created_at: string;
}

export interface Agent {
  id: string;
  name: string;
  email: string;
  role: string;
  office: string;
  status: string;
  target_calls_daily: number;
  created_at: string;
}

export interface DailyLog {
  id: string;
  date: string;
  client_id: string;
  agent_id: string;
  service_type: string;
  calls_made: number;
  calls_connected: number;
  outcome: string;
  amount_collected: number;
  notes: string;
  created_at: string;
  // Joined
  rh_agents?: { name: string };
  rh_clients?: { name: string };
}

export interface Collection {
  id: string;
  daily_log_id: string;
  patient_ref: string;
  amount: number;
  payment_method: string;
  agent_id: string;
  collected_at: string;
}

export interface Appointment {
  id: string;
  daily_log_id: string;
  patient_ref: string;
  appointment_date: string;
  doctor: string;
  clinic: string;
  status: string;
  agent_id: string;
  created_at: string;
}

export interface CcmCheckin {
  id: string;
  daily_log_id: string;
  patient_ref: string;
  vitals_ok: boolean;
  concerns: string;
  escalated: boolean;
  satisfaction_score: number;
  agent_id: string;
  created_at: string;
}
