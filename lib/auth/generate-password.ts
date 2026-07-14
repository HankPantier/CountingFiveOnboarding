import { randomInt } from 'node:crypto'

// Ambiguity-free character classes (no 0/O, 1/l/I) so an admin can safely read
// or paste the generated password. One char is drawn from each class to satisfy
// any Supabase password policy that requires mixed classes, then the rest are
// filled from the union and shuffled.
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%*?'
const ALL = LOWER + UPPER + DIGITS + SYMBOLS

const pick = (set: string) => set[randomInt(set.length)]

// 20 chars from ~60 symbols ≈ 118 bits of entropy — well beyond Supabase's
// 8-char minimum.
export function generatePassword(length = 20): string {
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  for (let i = chars.length; i < length; i++) chars.push(pick(ALL))

  // Fisher–Yates so the guaranteed-class chars aren't always in the first slots.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}
