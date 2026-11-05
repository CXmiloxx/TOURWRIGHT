// The rules a script's `mask` accepts: the built-in kinds, a fixed text, or a pattern. render/page/mask.js applies them.
import { z } from 'zod'

// Built-in kinds: what each finds. `id` is a run of 6 to 12 digits, with or without dots (cédulas, DNI, NIT…).
// `date`: dates in the text (05/11/1987, 1987-11-05, 5 de noviembre de 1987, November 5, 1987) and every filled
// date field, which is blurred (its value cannot change: the form would send it)
export const MASK_KINDS = ['email', 'phone', 'id', 'date']

export const maskRule = z.union([
  z.enum(MASK_KINDS),
  z.object({ text: z.string().min(1), as: z.string() }).strict(),
  z.object({ pattern: z.string().min(1), as: z.string().optional(), flags: z.string().regex(/^[imsu]*$/).optional() }).strict(),
])
