import { z } from "zod";

export const connectionKinds = ["fusion", "mechanical", "patch", "through"] as const;
export type ConnectionKind = (typeof connectionKinds)[number];

const optInt = z.number().int().min(1).max(999).nullish();

export const connectionInputSchema = z.object({
  /** Корпус, в котором выполняется соединение (муфта, ящик, кросс). */
  equipmentId: z.uuid(),
  aTerminalId: z.uuid(),
  bTerminalId: z.uuid(),
  /** Не указан — сварка, а для лицевой стороны адаптера и PON-порта — патч-корд. */
  kind: z.enum(["fusion", "mechanical", "patch"]).optional(),
  lossDb: z.number().min(0).max(30).nullish(),
  trayNo: optInt,
  slotNo: optInt,
  notes: z.string().trim().max(500).nullish(),
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export const connectionBatchSchema = z.object({
  equipmentId: z.uuid(),
  kind: z.enum(["fusion", "mechanical", "patch"]).optional(),
  trayNo: optInt,
  pairs: z.array(z.object({ aTerminalId: z.uuid(), bTerminalId: z.uuid() })).min(1).max(576),
});
export type ConnectionBatch = z.infer<typeof connectionBatchSchema>;

export const connectionPatchSchema = z
  .object({
    kind: z.enum(["fusion", "mechanical", "patch"]),
    lossDb: z.number().min(0).max(30).nullable(),
    trayNo: optInt,
    slotNo: optInt,
    notes: z.string().trim().max(500).nullable(),
  })
  .partial();

/** Завести кабель в корпус: конец пролёта, лежащий в месте, или транзитный пролёт, проходящий через место. */
export const enterCableSchema = z.object({ spanId: z.uuid() });
