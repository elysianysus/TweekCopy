import { getTableColumns } from "drizzle-orm";
import * as tables from "../schema.js";

export const s = { type: "string" };
export const n = { type: "number" };
export const i = { type: "integer" };
export const b = { type: "boolean" };
export const nullable = schema => ({ ...schema, nullable: true });
export const arr = items => ({ type: "array", items });
export const obj = (properties = {}, required = []) => ({
  type: "object", properties, ...(required.length ? { required } : {}),
});
export const strings = names => Object.fromEntries(names.split(" ").filter(Boolean).map(key => [key, s]));
export const enumString = (...values) => ({ type: "string", enum: values });
export const range = (minimum, maximum) => ({ type: "integer", minimum, maximum });
export const date = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
export const ok = obj({ ok: b });
export const success = obj({ success: b });
export const error = obj({ error: s });
// Only used for payloads the handlers deliberately pass through without validation
// (AI/provider JSON). Do not claim a fixed shape from an AI prompt.
export const dynamic = { description: "Unvalidated JSON returned by the upstream provider or AI model." };
export const json = (schema, required = true) => ({
  required, content: { "application/json": { schema } },
});
export const reply = (schema, description = "Successful response") => ({
  description, content: { "application/json": { schema } },
});
export const media = (type, schema = s, description = "Successful response") => ({
  description, content: { [type]: { schema } },
});
export const query = (name, schema = s, required = false, description) => ({
  name, in: "query", required, schema, ...(description ? { description } : {}),
});
export const upload = (field, properties = {}, required = true) => ({
  required,
  description: "Multipart upload; maximum file size is 10 MiB.",
  content: { "multipart/form-data": { schema: obj({
    [field]: { type: "string", format: "binary" }, ...properties,
  }, required ? [field] : []) } },
});
export const stream = description => media("text/event-stream", s, description);

// Row schemas come from the same Drizzle columns selected/returned by handlers.
// This does not discover operations or infer request requirements. Each operation
// below explicitly chooses its returned row/projection and accepted input fields.
export function row(tableName, fields) {
  const columns = getTableColumns(tables[tableName]);
  const keys = fields ? fields.split(" ") : Object.keys(columns);
  return obj(Object.fromEntries(keys.map(key => {
    const col = columns[key];
    if (!col) throw new Error(`Unknown documented column ${tableName}.${key}`);
    let schema;
    if (col.dataType === "date") schema = { type: "string", format: "date-time" };
    else if (col.dataType === "number") schema = /int|serial/i.test(col.getSQLType()) ? i : n;
    else if (col.dataType === "boolean") schema = b;
    else if (col.dataType === "json") schema = {};
    else if (col.dataType === "string") schema = s;
    else throw new Error(`Unmodeled column type ${tableName}.${key}`);
    return [key, col.notNull ? schema : nullable(schema)];
  })));
}
export function input(tableName, fields, required = [], extra = {}) {
  return obj({ ...row(tableName, fields).properties, ...extra }, required);
}
export function operation(output, body, parameters = [], description) {
  return {
    responses: { 200: reply(output) },
    ...(body ? { requestBody: json(body, !!(body.required?.length || body.anyOf || body.minProperties)) } : {}),
    ...(parameters.length ? { parameters } : {}),
    ...(description ? { description } : {}),
  };
}
