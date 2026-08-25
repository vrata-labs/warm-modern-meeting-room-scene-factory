import { pathToFileURL } from "node:url";

import {
  verifyApprovedCandidateArchitectureReproducibility,
  verifyApprovedCandidateComponentsReproducibility,
  verifySyntheticRoomReproducibility
} from "./compile-room-shell.mjs";

const candidateArchitectureInputKind = "approved-candidate-architecture";
const candidateComponentInputKind = "approved-candidate-components";

function parseCli(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values[flag] !== undefined) throw new Error("room_reproducibility_cli_arguments_invalid");
    values[flag] = value;
  }
  if ([candidateArchitectureInputKind, candidateComponentInputKind].includes(values["--input-kind"])) {
    const allowed = new Set(["--blender", "--candidate-dir", "--input-kind", "--output-directory", "--report"]);
    if (Object.keys(values).some((key) => !allowed.has(key))
      || ["--blender", "--output-directory", "--report"].some((key) => values[key] === undefined)) throw new Error("room_reproducibility_cli_arguments_invalid");
    return {
      inputKind: values["--input-kind"],
      options: {
        blenderPath: values["--blender"],
        candidateRepositoryPath: values["--candidate-dir"],
        outputDirectory: values["--output-directory"],
        reportPath: values["--report"]
      }
    };
  }
  const expected = ["--asset-ledger", "--blender", "--generation-ledger", "--output-directory", "--report", "--scene-spec"];
  if (Object.keys(values).sort().join(",") !== expected.join(",")) throw new Error("room_reproducibility_cli_arguments_invalid");
  return {
    inputKind: "synthetic-fixture",
    options: {
      blenderPath: values["--blender"],
      scenePath: values["--scene-spec"],
      assetLedgerPath: values["--asset-ledger"],
      generationLedgerPath: values["--generation-ledger"],
      outputDirectory: values["--output-directory"],
      reportPath: values["--report"]
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const cli = parseCli(process.argv.slice(2));
    const report = cli.inputKind === candidateArchitectureInputKind
      ? await verifyApprovedCandidateArchitectureReproducibility(cli.options)
      : cli.inputKind === candidateComponentInputKind
        ? await verifyApprovedCandidateComponentsReproducibility(cli.options)
        : await verifySyntheticRoomReproducibility(cli.options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "room_reproducibility_failed"}\n`);
    process.exitCode = 1;
  }
}
