import prompts from "prompts";

export interface PackageJson {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
}

export const cwd = process.cwd();
export const meta: PackageJson = require(`${cwd}/package.json`);

export async function confirm(message: string) {
	const { value } = await prompts({
		name: "value",
		type: "confirm",
		message,
	});
	return value;
}
