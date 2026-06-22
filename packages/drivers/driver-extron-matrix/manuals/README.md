# Extron SIS reference

Drop the device's SIS programming guide here, e.g.:

- `DTP-CrossPoint-108-4K-SIS.pdf`

The driver targets the **Extron SIS** (Simple Instruction Set) protocol over
TCP 23, as spoken by the **DTP CrossPoint 108 4K** (10 inputs × 8 outputs) and
other Extron matrix switchers (CrossPoint, MAV Plus).

The wire grammar implemented in `../src/sis.ts`:

| Operation            | Command         | Response (echo)        |
| -------------------- | --------------- | ---------------------- |
| Tie input→output, AV | `{in}*{out}!`   | `Out{oo} In{ii} All`   |
| Tie, video only      | `{in}*{out}%`   | `Out{oo} In{ii} Vid`   |
| Tie, audio only      | `{in}*{out}$`   | `Out{oo} In{ii} Aud`   |
| Untie an output      | `0*{out}!`      | `Out{oo} In00 All`     |
| Query video input    | `{out}%`        | `In{ii}` / `{ii}`      |
| Query audio input    | `{out}$`        | `In{ii}` / `{ii}`      |
| Error                | —               | `E{nn}`                |

> ⚠️ Response wording can differ slightly across firmware revisions. The parser
> in `sis.ts` is deliberately tolerant; confirm the exact shapes against the
> manual / a live unit and adjust the regexes if needed.
