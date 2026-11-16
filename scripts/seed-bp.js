import { db } from "../server/db.js";
import { bloodPressure, users } from "../server/schema.js";
import { eq } from "drizzle-orm";
import fs from "fs";
import mammoth from "mammoth";

async function extractText(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value;
}

async function parseBP2(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const records = [];
  let i = 0;
  if (lines[0] === "Date") i = 4;
  while (i < lines.length) {
    const date = lines[i];
    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) { i++; continue; }
    const sys = parseInt(lines[i + 1]);
    const dia = parseInt(lines[i + 2]);
    const pulse = parseInt(lines[i + 3]);
    if (!isNaN(sys) && !isNaN(dia) && !isNaN(pulse)) {
      records.push({ date, time: null, sys, dia, pulse });
    }
    i += 4;
  }
  return records;
}

async function parseBP3(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const records = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "Date" && lines[i + 1] === "Time") { i += 5; continue; }
    const date = lines[i];
    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) { i++; continue; }
    const time = lines[i + 1];
    const sys = parseInt(lines[i + 2]);
    const dia = parseInt(lines[i + 3]);
    const pulse = parseInt(lines[i + 4]);
    if (!isNaN(sys) && !isNaN(dia) && !isNaN(pulse)) {
      records.push({ date, time: time && time.match(/^\d{2}:\d{2}$/) ? time : null, sys, dia, pulse });
    }
    i += 5;
  }
  return records;
}

async function parseBP4(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const records = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i] === "Date") {
      while (i < lines.length && !lines[i].match(/^\d{4}-\d{2}-\d{2}$/)) i++;
      continue;
    }
    let date = lines[i];
    if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) { i++; continue; }
    if (date === "2025-01-03") date = "2026-01-03";
    if (i + 1 >= lines.length) break;
    const next = lines[i + 1];
    if (next && next.match(/^\(.*\)$/)) {
      const time = lines[i + 2];
      const sys = parseInt(lines[i + 3]);
      const dia = parseInt(lines[i + 4]);
      const pulse = parseInt(lines[i + 5]);
      if (!isNaN(sys) && !isNaN(dia) && !isNaN(pulse)) {
        records.push({ date, time: time && time.match(/^\d{2}:\d{2}$/) ? time : null, sys, dia, pulse });
      }
      i += 6;
    } else {
      i++;
    }
  }
  return records;
}

async function main() {
  const [user] = await db.select().from(users).where(eq(users.email, "demo@tweek.app"));
  if (!user) { console.error("demo user not found"); process.exit(1); }
  const uid = user.id;

  const bp2Text = await extractText("attached_assets/Blood_Pressure_2_1776177366515.docx");
  const bp3Text = await extractText("attached_assets/Blood_Pressure_3_1776177366515.docx");
  const bp4Text = await extractText("attached_assets/Blood_Pressure_4_1776177366515.docx");

  const r2 = await parseBP2(bp2Text);
  const r3 = await parseBP3(bp3Text);
  const r4 = await parseBP4(bp4Text);

  console.log(`BP2: ${r2.length} records, BP3: ${r3.length} records, BP4: ${r4.length} records`);

  const allRecords = [...r2, ...r3, ...r4];
  console.log(`Total: ${allRecords.length} records`);

  let inserted = 0;
  for (const rec of allRecords) {
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
