import { z } from "zod";

const requestId = z.string().min(1).max(256);
const ownedBytes = (maximum: number) => z.custom<Uint8Array>((value) => {
  if (!value || typeof value !== "object" || !ArrayBuffer.isView(value)
    || Object.prototype.toString.call(value) !== "[object Uint8Array]") return false;
  const bytes = value as Uint8Array;
  return Object.prototype.toString.call(bytes.buffer) === "[object ArrayBuffer]"
    && !(bytes.buffer as ArrayBuffer & { readonly resizable?: boolean }).resizable
    && bytes.byteLength > 0 && bytes.byteLength <= maximum
    && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;
}, "Mechanism solver messages require bounded owned bytes");

export const MechanismSolverRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("solve-mechanism"), requestId, inputBytes: ownedBytes(32 * 1024 * 1024) }).strict(),
  z.object({ type: z.literal("cancel"), requestId }).strict(),
]);

export const MechanismSolverEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("succeeded"), requestId, outputBytes: ownedBytes(128 * 1024 * 1024) }).strict(),
  z.object({ type: z.literal("cancelled"), requestId }).strict(),
  z.object({ type: z.literal("failed"), requestId, error: z.string().min(1).max(8_192) }).strict(),
]);

export type MechanismSolverRequest = z.infer<typeof MechanismSolverRequestSchema>;
export type MechanismSolverEvent = z.infer<typeof MechanismSolverEventSchema>;
