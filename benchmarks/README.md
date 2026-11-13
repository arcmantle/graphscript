# Persistent node file measurement

Install the dependencies with `npm ci` and use Node.js 24. Run these commands from the repository root:

```sh
node benchmarks/measure.cjs prepare /tmp/graphscript-measure-project
node benchmarks/measure.cjs measure /tmp/graphscript-measure-project
```

The prepare command requires a path that does not exist. It creates a library project with 120 persistent TypeScript node files. Run measure again against the same directory; it does not change the files. Use a new path for another fixture. The command reports an error if the node counts, edge count, or diagnostics do not match the expected project.

The project has 40 state, 40 function, and 40 class nodes. Each function reads and writes its state, and all but the first function call the previous function. Each class reads its state and calls its function. The resulting graph has 159 named imports and 199 runtime edges. This synthetic project exercises dependencies and state access, but does not represent every application or node size.

Each measurement runs these steps in one process, in this order:

1. Time `readGraph` on the saved node files.
2. Use the resulting node names and paths to create a temporary `@graph` index and a TypeScript configuration outside the timed interval. The configuration uses the same files and compiler options as `checkProject`: `noEmit`, `strict`, `esnext`, and `nodenext`.
3. Time a new TypeScript API instance, its project snapshot, config, program, global, syntactic, bind, and semantic diagnostics, and API close. This interval excludes graph analysis, index and configuration creation, and temporary-file removal. It checks the original saved node files, not a source projection. Any TypeScript diagnostic fails the measurement.
4. Time `checkProject` on the same saved project. This combined measurement includes GraphScript checks, graph analysis, and TypeScript diagnostics. It uses its own temporary index and compiler snapshots.

The TypeScript measurement is an isolated compiler check, not a component duration to subtract from the combined check: the two checks have different setup and snapshot sequences. The graph read and isolated check can warm caches for later steps. Modules load and the fixture files are listed before timing; the files are hashed after timing. Times are elapsed wall-clock milliseconds, not CPU time. Separate process runs can still use operating system file caches. No performance threshold is applied.

The output includes SHA-256 fingerprints of the sorted fixture files and of `benchmarks/measure.cjs`, `src/check.js`, and `src/graph.js`. Each of these hashes includes each relative filename, a null byte, its file bytes, and another null byte. It also includes the SHA-256 of the root `package-lock.json` bytes. The implementation hash covers only the named files. The lockfile identifies the declared dependency resolution, not the actual installed dependency bytes or proof that the installation matches the lockfile. Neither hash identifies a release artifact.

## Recorded run

On 2026-11-10, these commands created and measured the same saved fixture in three separate processes, using the dependencies already installed in the workspace:

```sh
node benchmarks/measure.cjs prepare /tmp/graphscript-iss3gt7-20261110
node benchmarks/measure.cjs measure /tmp/graphscript-iss3gt7-20261110
node benchmarks/measure.cjs measure /tmp/graphscript-iss3gt7-20261110
node benchmarks/measure.cjs measure /tmp/graphscript-iss3gt7-20261110
```

The host was macOS 26.7.2, Darwin 25.6.0, arm64, Apple M2 Pro, 12 available logical CPUs, and 32 GiB memory. Tools were Node.js v24.22.1, TypeScript 7.0.2, Babel parser 7.29.13, and Babel traverse 8.1.0.

| Run | Graph read (ms) | TypeScript check (ms) | Check including graph (ms) | TypeScript / combined diagnostics |
| --- | ---: | ---: | ---: | ---: |
| 1 | 63.597375000000014 | 256.2695 | 261.77629200000007 | 0 / 0 |
| 2 | 70.58320900000001 | 203.80945799999998 | 263.969083 | 0 / 0 |
| 3 | 62.51795799999999 | 196.852708 | 259.801166 | 0 / 0 |

Fixture SHA-256: `5cccd5229226ce856fe52c64cc70026d39273058c66bc001f5206855f3f17798`.

Implementation SHA-256: `c0a3a5d1f66ae45d8b330553ed0714df5df27355c60bb53cd94577dd4c8fd275`.

Lockfile SHA-256: `7d51081bb9f1d701f10d83c8664700b755c1fdde61a19d1af28b09807bab670c`.

These are observations for this host and source state, not a release-artifact check, a performance guarantee, or evidence for other project sizes or hosts.