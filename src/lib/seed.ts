import { supabase } from "./supabase";

const CLIENTS = [
  { name: "City General Hospital", type: "hospital", location: "Mumbai, MH", status: "active" },
  { name: "Sunrise Medical Center", type: "clinic", location: "Pune, MH", status: "active" },
  { name: "Valley Health Clinic", type: "practice", location: "Nashik, MH", status: "active" },
];

const AGENTS = [
  { name: "Priya Sharma", email: "priya@revorhealth.com", role: "agent", office: "india", target_calls_daily: 60 },
  { name: "Rahul Deshmukh", email: "rahul@revorhealth.com", role: "agent", office: "india", target_calls_daily: 55 },
  { name: "Anita Patil", email: "anita@revorhealth.com", role: "agent", office: "india", target_calls_daily: 50 },
  { name: "Vikram Joshi", email: "vikram@revorhealth.com", role: "agent", office: "india", target_calls_daily: 65 },
  { name: "Sneha Kulkarni", email: "sneha@revorhealth.com", role: "agent", office: "india", target_calls_daily: 50 },
  { name: "Amit Reddy", email: "amit@revorhealth.com", role: "senior_agent", office: "india", target_calls_daily: 70 },
  { name: "Sarah Mitchell", email: "sarah@revorhealth.com", role: "supervisor", office: "us", target_calls_daily: 20 },
  { name: "David Chen", email: "david@revorhealth.com", role: "supervisor", office: "us", target_calls_daily: 15 },
];

const SERVICE_TYPES = ["payment", "appointment", "ccm"];
const OUTCOMES: Record<string, string[]> = {
  payment: ["collected", "no_answer", "voicemail"],
  appointment: ["confirmed", "no_answer", "voicemail"],
  ccm: ["checked", "no_answer", "voicemail"],
};

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

export async function seedDatabase() {
  console.log("Seeding clients...");
  const { data: clientData } = await supabase.from("rh_clients").insert(CLIENTS).select();
  if (!clientData) { console.error("Failed to seed clients"); return; }

  console.log("Seeding agents...");
  const { data: agentData } = await supabase.from("rh_agents").insert(
    AGENTS.map((a) => ({ ...a, status: "active" }))
  ).select();
  if (!agentData) { console.error("Failed to seed agents"); return; }

  console.log("Seeding 30 days of daily logs...");
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

  // Insert in batches of 50
  for (let i = 0; i < logs.length; i += 50) {
    const batch = logs.slice(i, i + 50);
    const { error } = await supabase.from("rh_daily_logs").insert(batch);
    if (error) console.error("Batch error:", error.message);
  }

  console.log(`Seeded: ${clientData.length} clients, ${agentData.length} agents, ${logs.length} daily logs`);
  return { clients: clientData.length, agents: agentData.length, logs: logs.length };
}
