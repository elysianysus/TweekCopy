import { db } from "../server/db.js";
import { bloodPressure, users } from "../server/schema.js";
import { eq } from "drizzle-orm";
import mammoth from "mammoth";

function convertTo24h(timeStr) {
  if (!timeStr) return null;
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (!match) return timeStr.match(/^\d{2}:\d{2}$/) ? timeStr : null;
  let h = parseInt(match[1]);
  const m = match[2];
  const period = match[3].toLowerCase();
  if (period === 'pm' && h !== 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m}`;
}

async function main() {
  const [user] = await db.select().from(users).where(eq(users.email, "demo@tweek.app"));
  if (!user) { console.error("demo user not found"); process.exit(1); }
  const uid = user.id;

  const result = await mammoth.extractRawText({ path: "attached_assets/Blood_Pressure_1_1776178490109.docx" });
  const lines = result.value.split("\n").map(l => l.trim()).filter(Boolean);

  const records = [];
  let currentDate = null;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line === "Date" || line === "Time" || line === "SYS" || line === "DIA" || line === "Pulse") {
      i++;
      continue;
    }

    if (line.match(/^\d{4}-\d{2}-\d{2}/)) {
      currentDate = line.replace(/\s+$/, '');
      i++;
      continue;
    }

    if (line.match(/^\(.*\)$/)) {
      i++;
      continue;
    }

    if (!currentDate) { i++; continue; }

    const ampmMatch = line.match(/^\d{1,2}:\d{2}\s*(am|pm)$/i);
    const h24Match = line.match(/^\d{2}:\d{2}$/);
    if (ampmMatch || h24Match) {
      const time24 = convertTo24h(line);
      if (i + 3 <= lines.length) {
        const sys = parseInt(lines[i + 1]);
        const dia = parseInt(lines[i + 2]);
        const pulse = parseInt(lines[i + 3]);
        if (!isNaN(sys) && !isNaN(dia) && !isNaN(pulse) && sys > 30 && sys < 300) {
          records.push({ date: currentDate, time: time24, sys, dia, pulse });
          i += 4;
          continue;
        }
      }
      i++;
      continue;
    }

    const maybeNum = parseInt(line);
    if (!isNaN(maybeNum) && maybeNum >= 40 && maybeNum <= 250) {
      if (i + 2 < lines.length) {
        const sys = maybeNum;
        const dia = parseInt(lines[i + 1]);
        const pulse = parseInt(lines[i + 2]);
        if (!isNaN(dia) && !isNaN(pulse) && dia >= 20 && dia <= 200 && pulse >= 20 && pulse <= 250) {
          records.push({ date: currentDate, time: null, sys, dia, pulse });
          i += 3;
          continue;
        }
      }
    }

    i++;
  }

  console.log(`BP1: ${records.length} records parsed`);

  let inserted = 0;
  for (const rec of records) {
    await db.insert(bloodPressure).values({
      uid,
      date: rec.date,
      time: rec.time,
      sys: rec.sys,
      dia: rec.dia,
      pulse: rec.pulse,
      source: "import",
    });
    inserted++;
  }

  console.log(`Inserted ${inserted} blood pressure records for uid=${uid}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
