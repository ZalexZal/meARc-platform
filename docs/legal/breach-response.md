# Personal data breach - what to do (GDPR art. 33-34)

A breach is any accidental or unlawful loss, change, disclosure of or access
to personal data: a leaked key, a wrong RLS policy, a lost laptop with the
database URL, a trail showing someone's personal data.

## First hour

1. **Contain.** Rotate whatever leaked (Supabase: Settings → API → roll the
   anon key or JWT secret; database password; the keystore password). Take
   the affected page or function down if needed.
2. **Write down** what happened, when it was noticed, what data, whose, how
   many people. Keep everything in `docs/legal/breaches/<date>.md`.

## Within 72 hours of noticing

3. **Notify the CPDP** unless the breach is unlikely to result in a risk to
   people. Children's data or locations almost always count as a risk.
   - Commission for Personal Data Protection, cpdp.bg, kzld@cpdp.bg,
     2 Prof. Tsvetan Lazarov Blvd, Sofia 1592. The CPDP has an online form.
   - If some facts are still unknown, notify anyway and add them later.
4. **Tell the people affected** without undue delay if the risk to them is
   high (art. 34): what happened, what it means for them, what we did, what
   they can do, whom to contact. For 13-year-olds, write to the parent.

## Afterwards

5. Fix the cause, add a check that would have caught it, and record the
   breach here even if it was not notifiable (art. 33(5)).

## Template for the CPDP notice

- Controller: Alexander Zamov (meARc), zalex8623@gmail.com
- Nature of the breach, categories and approximate number of people and records
- Likely consequences
- Measures taken and proposed
- Time of the breach and time it was noticed; reason for any delay
