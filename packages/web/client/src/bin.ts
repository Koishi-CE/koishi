#!/usr/bin/env node

import { cac } from "cac";
import { resolve } from "path";
import { version } from "../package.json";
import { build } from ".";

const cli = cac("koishi-console").help().version(version);

cli.command("build [root]").action((root) => {
	root = resolve(process.cwd(), root || ".");
	build(root);
});

cli.parse();

if (!cli.matchedCommand && !cli.options.help) {
	cli.outputHelp();
}
