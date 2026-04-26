import { supabase } from "./supabase";

const CLIENTS = [
  { name: "Sixapart Healthcare Solutions Inc", type: "Healthcare Management", location: "New York, NY", status: "active" },
  { name: "COR Health", type: "Medical Practice", location: "Bangor, ME", status: "active" },
  { name: "Kennebec Pharmacy", type: "Pharmacy", location: "Augusta, ME", status: "active" },
  { name: "Evergreen Family Medicine", type: "Family Medicine", location: "Portland, OR", status: "active" },
  { name: "BluePeak Urgent Care", type: "Urgent Care", location: "Phoenix, AZ", status: "active" },
  { name: "Coastal Wellness Group", type: "Wellness Center", location: "Tampa, FL", status: "active" },
];

const AGENT_NAMES = [
  "Priya Sharma","Rahul Deshmukh","Sneha Kulkarni","Amit Patel","Kavya Nair",
  "Rohan Mehta","Divya Iyer","Arjun Singh","Meera Joshi","Vikram Rao",
  "Pooja Gupta","Kiran Kumar","Ravi Pillai","Anita Verma","Suresh Babu",
  "Deepa Menon","Nikhil Jain","Swati Deshpande","Rajesh Patil","Nisha Reddy",
  "Arun Krishnan","Geeta Shetty","Sanjay Dubey","Reena Nair","Manoj Tiwari",
  "Seema Kapoor","Vinod Yadav","Usha Mishra","Prakash Hegde","Lata Bhatt",
  "Ashok Malhotra","Mala Pillai","Sunil Chavan","Asha Thakur","Ramesh Gaikwad",
  "Gita Pandey","Mohan Sinha","Sudha Rao","Vijay Kumar","Lakshmi Devi",
];

const US_HOLIDAYS = new Set([
  "2025-01-01","2025-01-20","2025-02-17","2025-05-26","2025-06-19",
  "2025-07-04","2025-09-01","2025-10-13","2025-11-11","2025-11-27","2025-12-25",
  "2026-01-01","2026-01-19","2026-02-16","2026-05-25","2026-06-19",
  "2026-07-03","2026-09-07","2026-10-12","2026-11-11","2026-11-26","2026-12-25",
]);

export function isBusinessDay(date: Date): boolean {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !US_HOLIDAYS.has(date.toISOString().split("T")[0]!);
}

export function getHolidayName(dateStr: string): string | null {
  if (!US_HOLIDAYS.has(dateStr)) return null;
  const names: Record<string, string> = {
    "01-01":"New Year's Day","01-19":"MLK Day","01-20":"MLK Day",
    "02-16":"Presidents' Day","02-17":"Presidents' Day",
    "05-25":"Memorial Day","05-26":"Memorial Day",
    "06-19":"Juneteenth","07-03":"Independence Day","07-04":"Independence Day",
    "09-01":"Labor Day","09-07":"Labor Day",
    "10-12":"Columbus Day","10-13":"Columbus Day",
    "11-11":"Veterans Day","11-26":"Thanksgiving","11-27":"Thanksgiving",
    "12-25":"Christmas Day",
  };
  return names[dateStr.slice(5)] ?? "Federal Holiday";
}

function rand(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }

const OUTCOMES: Record<string, string[]> = {
  payment: ["collected","promise_to_pay","no_answer","voicemail","disputed"],
  appointment: ["confirmed","rescheduled","no_answer","voicemail","cancelled"],
  ccm: ["checked","escalated","no_answer","voicemail","follow_up"],
};

export async function autoSeed() {
  try {
    const { data: existing, error: checkErr } = await supabase.from("rh_clients").select("id").limit(1);
    if (checkErr) { console.error("[seed] Table check failed:", checkErr.message); return; }
    if (existing && existing.length > 0) return;

    console.log("[seed] Empty tables — inserting production data...");

    const { data: clientData, error: ce } = await supabase.from("rh_clients").insert(CLIENTS).select();
    if (ce || !clientData) { console.error("[seed] Clients:", ce?.message); return; }

    const agents = AGENT_NAMES.map((name, i) => {
      const role = i < 15 ? "payment" : i < 30 ? "appointment" : "ccm";
      const email = name.toLowerCase().replace(" ", ".") + "@revorhealth.com";
      return { name, email, role, office: "india", target_calls_daily: 50, status: "active" };
    });

    const { data: agentData, error: ae } = await supabase.from("rh_agents").insert(agents).select();
    if (ae || !agentData) { console.error("[seed] Agents:", ae?.message); return; }

    const byRole: Record<string, any[]> = { payment: [], appointment: [], ccm: [] };
    for (const a of agentData) byRole[a.role]?.push(a);

    const logs: any[] = [];
    const today = new Date();

    for (let day = 60; day >= 0; day--) {
      const date = new Date(today.getTime() - day * 86400000);
      if (!isBusinessDay(date)) continue;
      const dateStr = date.toISOString().split("T")[0]!;
      const growth = 0.85 + (1 - day / 60) * 0.15;

      for (const svc of ["payment", "appointment", "ccm"] as const) {
        const pool = byRole[svc];
        const active = Math.floor(pool.length * growth);

        for (let a = 0; a < active; a++) {
          const agent = pool[a % pool.length]!;
          const calls = rand(12, 25);
          const connected = Math.floor(calls * (0.4 + Math.random() * 0.25));
          let outcome = pick(OUTCOMES[svc]!);

          // Enforce confirmation/completion rates
          if (svc === "appointment" && Math.random() < 0.62) outcome = "confirmed";
          if (svc === "ccm" && Math.random() < 0.85) outcome = "checked";

          let amount = 0;
          if (svc === "payment" && (outcome === "collected" || outcome === "promise_to_pay")) {
            amount = rand(300, 1800);
          }

          logs.push({
            date: dateStr,
            client_id: pick(clientData).id,
            agent_id: agent.id,
            service_type: svc,
            calls_made: calls,
            calls_connected: connected,
            outcome,
            amount_collected: amount,
            notes: "",
          });
        }
      }
    }

    for (let i = 0; i < logs.length; i += 100) {
      const { error } = await supabase.from("rh_daily_logs").insert(logs.slice(i, i + 100));
      if (error) console.error("[seed] Batch:", error.message);
    }

    console.log(`[seed] Complete: ${clientData.length} clients, ${agentData.length} agents, ${logs.length} logs`);
  } catch (err) {
    console.error("[seed] Error:", err);
  }
}
