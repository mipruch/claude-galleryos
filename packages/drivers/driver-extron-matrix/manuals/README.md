# Extron SIS reference

- `Extron-108-manual.pdf` — DTP CrossPoint 4K Series user/programming guide.

The driver targets the **Extron SIS** (Simple Instruction Set) protocol over
TCP 23, as spoken by the **DTP CrossPoint 108 4K** (10 inputs × 8 outputs) and
other Extron matrix switchers (CrossPoint, MAV Plus).

The wire grammar in `../src/sis.ts` is **verified against this manual** (see the
"Command and Response Table for General Matrix Switcher Commands", Programming
Guide pp. 63-64, and "Establishing a connection" / "Switcher Error Responses"):

| Operation            | Command         | Response (echo)        |
| -------------------- | --------------- | ---------------------- |
| Tie input→output, AV | `{in}*{out}!`   | `Out{oo} In{ii} All`   |
| Tie, video only      | `{in}*{out}%`   | `Out{oo} In{ii} Vid`   |
| Tie, audio only      | `{in}*{out}$`   | `Out{oo} In{ii} Aud`   |
| Untie an output      | `0*{out}!`      | `Out{oo} In00 All`     |
| Query video input    | `{out}%`        | `{ii}` (2-digit)       |
| Query audio input    | `{out}$`        | `{ii}` (2-digit)       |
| Error                | —               | `E{nn}`                |

Notes confirmed from the manual:

- Responses are always 2-digit; commands accept 1- or 2-digit numbers and are
  **not** case-sensitive.
- Input `0` unties an output; `0*{out}!` clears that output's ties.
- On connect the switcher sends a copyright banner. If password-protected it
  then sends a `Password:` prompt and replies `Login Administrator` / `Login User`
  once accepted — handled by `ExtronMatrixDriver`.
- A **front-panel** tie change emits a bare `Qik` notification (not the new tie),
  so live state is refreshed by polling (`readState`), not by parsing the push.

> The query-response parser still tolerates an optional `In` prefix in case a
> firmware revision adds one.
