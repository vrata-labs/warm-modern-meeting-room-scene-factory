import { pathToFileURL } from "node:url";

import { verifySyntheticRoomReproducibility } from "./compile-room-shell.mjs";

function parseCli(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values[flag] !== undefined) throw new Error("room_reproducibility_cli_arguments_invalid");
    values[flag] = value;
  }
  const expected = ["--asset-ledger", "--blender", "--generation-ledger", "--output-directory", "--report", "--scene-spec"];
  if (Object.keys(values).sort().join(",") !== expected.join(",")) throw new Error("room_reproducibility_cli_arguments_invalid");
  return {
    blenderPath: values["--blender"],
    scenePath: values["--scene-spec"],
    assetLedgerPath: values["--asset-ledger"],
    generationLedgerPath: values["--generation-ledger"],
    outputDirectory: values["--output-directory"],
    reportPath: values["--report"]
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await verifySyntheticRoomReproducibility(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "room_reproducibility_failed"}\n`);
    process.exitCode = 1;
  }
}
