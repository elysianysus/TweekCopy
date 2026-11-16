import { s, i, n, b, obj, arr, strings, nullable, row, input, operation as op, query, upload, stream, range, enumString, dynamic, ok, json, date } from "./schema.js";

const bp = input("bloodPressure", "date time sys dia pulse source", [], { sys: range(40, 300), dia: range(20, 200), pulse: range(20, 250) });
const steps = input("steps", "date steps distance calories walkTime remarks source", [], { steps: range(0, 200000) });
const medicine = input("medicineLog", "date time symptom medicine dosage severity notes");
const sleep = input("sleepLog", "date totalSleepMin deepSleepMin remSleepMin wakeCount snoreMin effectiveInterventionPct snoreIntensityDropDb offPillowCount interventionMin spo2Min spo2Avg hrAvg bedTime wakeTime source notes", [], { date });
const symptoms = input("sleepSymptomLog", "date morningHeadache daytimeFatigue concentration nightWakeCount notes", [], { date });
const expense = obj({
  ...strings("store date currency notes category"),
  total: { anyOf: [n, s] }, items: { anyOf: [s, arr({})] },
});
const foodItem = obj({ name: s, calories: { ...n, minimum: 0 }, protein: nullable(n), carbs: nullable(n), fat: nullable(n), sodium: nullable(n) });
const period = [query("from"), query("to")];
const month = [query("month", s, false, "Date prefix, normally YYYY-MM.")];
const fieldsWithoutSource = schema => obj(Object.fromEntries(Object.entries(schema.properties).filter(([k]) => k !== "source")));

export const health = {
  "GET /api/expenses": op(arr(row("expenses"))),
  "POST /api/expenses": op(row("expenses"), expense),
  "POST /api/expenses/auto-capture": { ...op(row("expenses"), obj({ text: { ...s, minLength: 1, maxLength: 1000 } }, ["text"]), [], "Limited to 10 requests per minute per share-token owner."), security: [{ shareToken: [] }] },
  "POST /api/expenses/parse": op(dynamic, obj({ text: s }, ["text"])),
  "POST /api/expenses/bulk": op(arr(row("expenses")), obj({ records: arr(expense) }, ["records"])),
  "DELETE /api/expenses/:id": op(ok),
  "GET /api/expenses/audit-log": op(arr(row("expenseAuditLog")), null, [query("limit", { ...i, maximum: 50, default: 10 })]),
  "POST /api/expenses/audit-log/:id/undo": op(obj({ ok: b, kind: enumString("update", "restore"), expense: row("expenses") })),
  "GET /api/food/audit-log": op(arr(row("foodAuditLog")), null, [query("limit", { ...i, maximum: 50, default: 10 })]),
  "POST /api/food/audit-log/:id/undo": op(obj({ ok: b, kind: enumString("update", "restore"), food: row("foodLog") })),
  "GET /api/blood-pressure": op(arr(row("bloodPressure")), null, month),
  "POST /api/blood-pressure": op(row("bloodPressure"), { ...bp, required: ["date", "sys", "dia", "pulse"] }),
  "PUT /api/blood-pressure/:id": op(row("bloodPressure"), fieldsWithoutSource(bp)),
  "DELETE /api/blood-pressure/:id": op(ok),
  "POST /api/blood-pressure/bulk": op(arr(row("bloodPressure")), obj({ records: arr(fieldsWithoutSource(bp)) }, ["records"]), [], "Invalid or out-of-range readings are skipped."),
  "GET /api/steps": op(arr(row("steps")), null, month),
  "POST /api/steps": op(row("steps"), { ...steps, required: ["date", "steps"] }),
  "PUT /api/steps/:id": op(row("steps"), fieldsWithoutSource(steps)),
  "DELETE /api/steps/:id": op(ok),
  "POST /api/steps/bulk": op(arr(row("steps")), obj({ records: arr(fieldsWithoutSource(steps)) }, ["records"]), [], "Invalid or out-of-range step counts are skipped."),
  "GET /api/medicine": op(arr(row("medicineLog")), null, month),
  "POST /api/medicine": op(row("medicineLog"), { ...medicine, properties: { ...medicine.properties, date }, required: ["date", "symptom"] }),
  "PUT /api/medicine/:id": op(row("medicineLog"), medicine),
  "DELETE /api/medicine/:id": op(ok),
  "GET /api/sleep": op(arr(row("sleepLog")), null, period),
  "POST /api/sleep": op(row("sleepLog"), { ...sleep, required: ["date"] }),
  "PATCH /api/sleep/:id": op(row("sleepLog"), { ...sleep, minProperties: 1 }),
  "DELETE /api/sleep/:id": op(ok),
  "GET /api/sleep/symptoms": op(arr(row("sleepSymptomLog")), null, period),
  "POST /api/sleep/symptoms": op(row("sleepSymptomLog"), { ...symptoms, required: ["date"] }),
  "PATCH /api/sleep/symptoms/:id": op(row("sleepSymptomLog"), { ...symptoms, minProperties: 1 }),
  "DELETE /api/sleep/symptoms/:id": op(ok),
  "POST /api/sleep/import-image": { ...op(obj({ parsed: dynamic })), requestBody: upload("image") },
  "GET /api/food": op(arr(row("foodLog")), null, [...month, query("limit", { ...i, default: 100 })]),
  "PATCH /api/food/:id": op(row("foodLog"), { ...obj({
    totalCalories: { ...n, minimum: 0 }, mealType: enumString("breakfast", "lunch", "dinner", "snack", "unknown"),
    date, time: nullable(s), items: { anyOf: [s, arr({ ...foodItem, required: ["calories"] })] },
  }), minProperties: 1 }),
  "DELETE /api/food/:id": op(ok),
  "GET /api/nutrition/usage": op(obj({ date: s, fatsecret: i, openfoodfacts: i, fatsecretConfigured: b, fatsecretDailyLimit: i })),
  "GET /api/nutrition/lookup": op(obj({ source: s, name: s, matchedName: s, servingDescription: nullable(s), cached: b, calories: n, protein: nullable(n), carbs: nullable(n), fat: nullable(n), sodium: nullable(n) }), null, [query("name", s, true)]),
  "GET /api/health/overview": op(obj({
    steps: arr(row("steps")), bp: arr(row("bloodPressure")), medicine: arr(row("medicineLog")),
    sleep: arr(row("sleepLog")), sleepSymptoms: arr(row("sleepSymptomLog")), period: obj(strings("from to")),
  })),
  "POST /api/health/ai-summary": {
    requestBody: json(obj({ question: s })),
    responses: { 200: stream("SSE data frames with JSON text chunks, followed by data: [DONE]. Failures after headers emit a JSON error frame.") },
  },
  "GET /api/weather": { ...op(obj({ current: dynamic, forecast: dynamic, local: dynamic, warnsum: dynamic, warningInfo: dynamic, swt: dynamic, tctrack: dynamic })), security: [] },
};

// Each of these import handlers returns parsed AI JSON without validating the
// records' shape. The bulk-save endpoints above describe the accepted records.
for (const resource of ["expenses", "blood-pressure", "steps"]) {
  health[`POST /api/${resource}/import-text`] = op(obj({ records: dynamic }), obj({ text: s }, ["text"]));
  health[`POST /api/${resource}/import-image`] = {
    ...op(obj({ records: dynamic })), requestBody: upload("image"),
  };
}
