import { Random } from "@koishi-ce/utils";
import { Time } from "cosmokit";
import type { Context } from "../context";

export function registerComponents(ctx: Context) {
	ctx.component(
		"execute",
		async (_attrs, children, session) => {
			return session.execute(children.join(""), true);
		},
		{ session: true },
	);

	ctx.component(
		"prompt",
		async (_attrs, children, session) => {
			await session.send(children);
			return (await session.prompt()) ?? "";
		},
		{ session: true },
	);

	ctx.component(
		"i18n",
		async (attrs, children, session) => {
			return session.i18n(attrs["path"], children);
		},
		{ session: true },
	);

	ctx.component("random", async (_attrs, children) => {
		return Random.pick(children);
	});

	ctx.component("plural", async (attrs, children) => {
		const path =
			attrs["count"] in children ? attrs["count"] : children.length - 1;
		return children[path] ?? "";
	});

	const units = ["day", "hour", "minute", "second"] as const;

	ctx.component(
		"i18n:time",
		(attrs, _children, session) => {
			let ms = +attrs["value"];
			for (let index = 0; index < 3; index++) {
				const majorUnit = units[index];
				const minorUnit = units[index + 1];
				if (!majorUnit || !minorUnit) continue;
				const major = Time[majorUnit];
				const minor = Time[minorUnit];
				if (ms >= major - minor / 2) {
					ms += minor / 2;
					let result =
						Math.floor(ms / major) + " " + session.text(`general.${majorUnit}`);
					if (ms % major > minor) {
						result +=
							` ${Math.floor((ms % major) / minor)} ` +
							session.text(`general.${minorUnit}`);
					}
					return result;
				}
			}
			return (
				Math.round(ms / Time.second) + " " + session.text("general.second")
			);
		},
		{ session: true },
	);
}
