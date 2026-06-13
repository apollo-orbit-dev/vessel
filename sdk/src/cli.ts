import { parseArgs } from "node:util";
import { BundleError } from "@vessel/core";
import { buildBundle } from "./commands/build";
import { newBundle } from "./commands/new";
import { dev } from "./commands/dev";
import { keygen } from "./commands/keygen";

const HELP = `vessel — author .vessel tool bundles

Usage:
  vessel new <name> [dir]              Scaffold a new bundle project
  vessel dev [dir] [-p port]           Run a local dev server (host parity + reload)
  vessel build [dir] [-o out] [--sign key]   Package (and optionally sign) a .vessel
  vessel keygen <name>                 Generate an Ed25519 signing keypair
  vessel --help

Examples:
  vessel new "My Tool"                 Scaffold ./my-tool
  vessel dev examples/notes            Develop with hot reload
  vessel keygen acme                   -> acme.key (secret) + acme.pub (share)
  vessel build . --sign acme.key       Build a signed bundle
`;

/** Returns an exit code, or null to keep running (dev server). */
async function main(argv: string[]): Promise<number | null> {
  const cmd = argv[0];

  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    console.log(HELP);
    return cmd ? 0 : 1;
  }

  try {
    switch (cmd) {
      case "new": {
        const { positionals } = parseArgs({ args: argv.slice(1), allowPositionals: true });
        const name = positionals[0];
        if (!name) {
          console.error("usage: vessel new <name> [dir]");
          return 1;
        }
        const dir = newBundle({ name, dir: positionals[1] });
        console.log(`created ${dir}\n\nNext:\n  vessel build ${dir}`);
        return 0;
      }
      case "dev": {
        const { values, positionals } = parseArgs({
          args: argv.slice(1),
          options: { port: { type: "string", short: "p" } },
          allowPositionals: true,
        });
        await dev({ dir: positionals[0] ?? ".", port: values.port ? Number(values.port) : undefined });
        return null; // server runs until the process is killed
      }
      case "build": {
        const { values, positionals } = parseArgs({
          args: argv.slice(1),
          options: { out: { type: "string", short: "o" }, sign: { type: "string" } },
          allowPositionals: true,
        });
        const out = await buildBundle({ dir: positionals[0] ?? ".", out: values.out, sign: values.sign });
        console.log(`built ${out}${values.sign ? " (signed)" : ""}`);
        return 0;
      }
      case "keygen": {
        const { positionals } = parseArgs({ args: argv.slice(1), allowPositionals: true });
        const name = positionals[0];
        if (!name) {
          console.error("usage: vessel keygen <name>");
          return 1;
        }
        const { keyFile, pubFile } = await keygen({ name });
        console.log(`wrote ${keyFile} (secret — keep safe) and ${pubFile} (share)`);
        return 0;
      }
      default:
        console.error(`unknown command: ${cmd}\n`);
        console.log(HELP);
        return 1;
    }
  } catch (e) {
    console.error(e instanceof BundleError ? `error: ${e.message}` : `error: ${String(e)}`);
    return 1;
  }
}

main(process.argv.slice(2)).then((code) => {
  if (code !== null) process.exit(code);
});
