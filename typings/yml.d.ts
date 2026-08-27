/**
 * Workspaces import locale files as ES modules (bundled at build time).
 * They describe nested string dictionaries, compatible with `I18n.Store`.
 */
declare module "*.yml" {
	type YamlNode = string | YamlObject;

	interface YamlObject {
		[key: string]: YamlNode;
	}

	const content: YamlObject;

	export default content;
}

declare module "*.yaml" {
	type YamlNode = string | YamlObject;

	interface YamlObject {
		[key: string]: YamlNode;
	}

	const content: YamlObject;

	export default content;
}
