import { supabase } from "./supabase";

const CLIENTS = [
  { name: "Sixapart Healthcare Solutions Inc", type: "healthcare_management", location: "USA", status: "active" },
  { name: "COR Health", type: "medical_practice", location: "Maine, USA", status: "active" },
  { name: "Kennebec Pharmacy", type: "pharmacy", location: "Augusta, Maine, USA", status: "active" },
  { name: "Evergreen Family Medicine", type: "family_medicine", location: "Portland, Oregon", status: "active" },
  { name: "BluePeak Urgent Care", type: "urgent_care", location: "Phoenix, Arizona", status: "active" },
  { name: "Coastal Wellness Group", type: "wellness", location: "Tampa, Florida", status: "active" },
];

const FIRST_NAMES = ["Priya","Rahul","Anita","Vikram","Sneha","Amit","Pooja","Rohan","Kavita","Suresh","Deepa","Arun","Nisha","Rajesh","Meena","Sanjay","Divya","Mohan","Ritu","Kiran","Swati","Nitin","Pallavi","Gaurav","Bhavna","Manoj","Sunita","Vivek","Anjali","Harsh","Rekha","Tushar","Seema","Ashok","Neha","Pankaj","Sapna","Vishal","Lakshmi","Siddharth"];
const LAST_NAMES = ["Sharma","Deshmukh","Patil","Joshi","Kulkarni","Reddy","Gupta","Mehta","Patel","Nair","Iyer","Singh","Verma","Rao","Das","Mishra","Pillai","Chauhan","Thakur","Bhat"];

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

function generateAgents() {
  const agents: any[] = [];
  const roles = [
    ...Array(15).fill("Payment Collection"),
    ...Array(15).fill("Appointment Reminder"),
    ...Array(10).fill("CCM"),
  ];
  const serviceMap: Record<string, string> = {
    "Payment Collection": "payment",
    "Appointment Reminder": "appointment",
    "CCM": "ccm",
  };

  for (let i = 0; i < 40; i++) {
    const first = FIRST_NAMES[i]!;
    const last = pick(LAST_NAMES);
    const role = roles[i]!;
    agents.push({
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@revorhealth.com`,
      role: serviceMap[role],
      office: "india",
      target_calls_daily: role === "Payment Collection" ? rand(50, 70) : role === "Appointment Reminder" ? rand(60, 80) : rand(40, 55),
      status: "active",
    });
  }
  return agents;
}

const OUTCOMES: Record<string, string[]> = {
  payment: ["collected", "promise_to_pay", "no_answer", "voicemail", "disputed"],
  appointment: ["confirmed", "rescheduled", "no_answer", "voicemail", "cancelled"],
  ccm: ["checked", "escalated", "no_answer", "voicemail", "follow_up"],
};

export async function autoSeed() {
  try {
    const { data: existing } = await supabase.from("rh_clients").select("id").limit(1);
    if (existing && existing.length > 0) return; // Already seeded

    console.log("[seed] Tables empty — seeding production data...");

    // Clear any partial data
    await supabase.from("rh_daily_logs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("rh_agents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await supabase.from("rh_clients").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    // Insert clients
    const { data: clientData, error: ce } = await supabase.from("rh_clients").insert(CLIENTS).select();
    if (ce || !clientData) { console.error("[seed] Clients failed:", ce?.message); return; }

    // Insert agents
    const agents = generateAgents();
    const { data: agentData, error: ae } = await supabase.from("rh_agents").insert(agents).select();
    if (ae || !agentData) { console.error("[seed] Agents failed:", ae?.message); return; }

    // Group agents by role for realistic assignment
    const paymentAgents = agentData.filter((a: any) => a.role === "payment");
    const appointmentAgents = agentData.filter((a: any) => a.role === "appointment");
    const ccmAgents = agentData.filter((a: any) => a.role === "ccm");
    const agentsByRole: Record<string, any[]> = { payment: paymentAgents, appointment: appointmentAgents, ccm: ccmAgents };

    // Generate 60 days of daily logs
    const logs: any[] = [];
    const today = new Date();

    for (let day = 60; day >= 0; day--) {
      const date = new Date(today.getTime() - day * 86400000);
      const dateStr = date.toISOString().split("T")[0];
      const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      const volumeMultiplier = isWeekend ? 0.4 : 1;

      // Growth trend: earlier days have ~80% of current volume
      const growthFactor = 0.8 + (1 - day / 60) * 0.2;

      // Each active agent logs 1-2 entries per day
      for (const serviceType of ["payment", "appointment", "ccm"]) {
        const roleAgents = agentsByRole[serviceType] ?? [];
        const activeCount = Math.floor(roleAgents.length * volumeMultiplier * growthFactor);

        for (let a = 0; a < activeCount; a++) {
          const agent = roleAgents[a % roleAgents.length]!;
          const outcomes = OUTCOMES[serviceType]!;
          const target = agent.target_calls_daily || 50;
          const callsMade = Math.floor(target * (0.7 + Math.random() * 0.5) * volumeMultiplier);
          const callsConnected = Math.floor(callsMade * (0.35 + Math.random() * 0.25));

          let amountCollected = 0;
          if (serviceType === "payment") {
            // $15K-$25K daily across all payment agents, so per agent ~$1000-$1700
            amountCollected = Math.floor((400 + Math.random() * 1300) * growthFactor);
          }

          logs.push({
            date: dateStr,
            client_id: pick(clientData).id,
            agent_id: agent.id,
            service_type: serviceType,
            calls_made: callsMade,
            calls_connected: callsConnected,
            outcome: pick(outcomes),
            amount_collected: amountCollected,
            notes: "",
          });
        }
      }
    }

    // Insert in batches
    for (let i = 0; i < logs.length; i += 100) {
      const batch = logs.slice(i, i + 100);
      const { error } = await supabase.from("rh_daily_logs").insert(batch);
      if (error) console.error("[seed] Batch error:", error.message);
    }

    console.log(`[seed] Done: ${clientData.length} clients, ${agentData.length} agents, ${logs.length} logs`);
  } catch (err) {
    console.error("[seed] Error:", err);
  }
}
