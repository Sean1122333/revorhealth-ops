import { supabase } from "./supabase";

const CLIENTS = [
  { name: "City General Hospital", type: "hospital", location: "Mumbai, MH", status: "active" },
  { name: "Sunrise Medical Center", type: "clinic", location: "Pune, MH", status: "active" },
  { name: "Valley Health Clinic", type: "practice", location: "Nashik, MH", status: "active" },
];

const AGENTS = [
  { name: "Priya Sharma", email: "priya@revorhealth.com", role: "agent", office: "india", target_calls_daily: 60, status: "active" },
  { name: "Rahul Deshmukh", email: "rahul@revorhealth.com", role: "agent", office: "india", target_calls_daily: 55, status: "active" },
  { name: "Anita Patil", email: "anita@revorhealth.com", role: "agent", office: "india", target_calls_daily: 50, status: "active" },
  { name: "Vikram Joshi", email: "vikram@revorhealth.com", role: "agent", office: "india", target_calls_daily: 65, status: "active" },
  { name: "Sneha Kulkarni", email: "sneha@revorhealth.com", role: "agent", office: "india", target_calls_daily: 50, status: "active" },
  { name: "Amit Reddy", email: "amit@revorhealth.com", role: "senior_agent", office: "india", target_calls_daily: 70, status: "active" },
  { name: "Sarah Mitchell", email: "sarah@revorhealth.com", role: "supervisor", office: "us", target_calls_daily: 20, status: "active" },
  { name: "David Chen", email: "david@revorhealth.com", role: "supervisor", office: "us", target_calls_daily: 15, status: "active" },
];

const SERVICE_TYPES = ["payment", "appointment", "ccm"];
const OUTCOMES: Record<string, string[]> = {
  payment: ["collected", "no_answer", "voicemail"],
  appointment: ["confirmed", "no_answer", "voicemail"],
  ccm: ["checked", "no_answer", "voicemail"],
};

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

export async function seedDatabase(): Promise<{ clients: number; agents: number; logs: number }> {
  // Test connection first
  const { error: testErr } = await supabase.from("rh_clients").select("id").limit(1);
  if (testErr) {
    throw new Error(`Supabase connection failed: ${testErr.message}. Check that tables exist and env vars are set.`);
  }

  // Seed clients
  const { data: clientData, error: clientErr } = await supabase.from("rh_clients").insert(CLIENTS).select();
  if (clientErr) throw new Error(`Failed to seed clients: ${clientErr.message}`);
  if (!clientData || clientData.length === 0) throw new Error("Clients insert returned no data");

  // Seed agents
  const { data: agentData, error: agentErr } = await supabase.from("rh_agents").insert(AGENTS).select();
  if (agentErr) throw new Error(`Failed to seed agents: ${agentErr.message}`);
  if (!agentData || agentData.length === 0) throw new Error("Agents insert returned no data");

  // Generate 30 days of daily logs
  const logs: any[] = [];
  for (let day = 30; day >= 0; day--) {
    const date = new Date(Date.now() - day * 86400000).toISOString().split("T")[0];
    const logsPerDay = rand(8, 15);

    for (let i = 0; i < logsPerDay; i++) {
      const serviceType = pick(SERVICE_TYPES);
      const outcomes = OUTCOMES[serviceType]!;
      const callsMade = rand(30, 80);
      const callsConnected = rand(Math.floor(callsMade * 0.3), Math.floor(callsMade * 0.7));

      logs.push({
        date,
        client_id: pick(clientData).id,
        agent_id: pick(agentData).id,
        service_type: serviceType,
        calls_made: callsMade,
        calls_connected: callsConnected,
        outcome: pick(outcomes),
        amount_collected: serviceType === "payment" ? rand(500, 8000) : 0,
        notes: "",
      });
    }
  }

  // Insert in batches
  let insertErrors: string[] = [];
  for (let i = 0; i < logs.length; i += 50) {
    const batch = logs.slice(i, i + 50);
    const { error } = await supabase.from("rh_daily_logs").insert(batch);
    if (error) insertErrors.push(error.message);
  }

  if (insertErrors.length > 0) {
    throw new Error(`Log insert errors: ${insertErrors[0]}`);
  }

  return { clients: clientData.length, agents: agentData.length, logs: logs.length };
}
