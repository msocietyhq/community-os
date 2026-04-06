import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { env } from "../env";

type ProjectMember = {
	id: string;
	name: string;
	image: string | null;
	role: string;
	telegramUsername: string | null;
};

type ProjectForOg = {
	name: string;
	slug: string;
	description: string | null;
	nature: "startup" | "community" | "side_project";
	isEndorsed: boolean | null;
	members: ProjectMember[];
};

// Google Fonts serves TTF (rather than WOFF2) when a plain, non-browser
// User-Agent is used. We fetch the CSS once, extract the TTF URLs for the
// weights we need, download them, and cache in memory for the process lifetime.
const GOOGLE_FONTS_CSS_URL =
	"https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap";
const FONT_FETCH_UA = "Mozilla/5.0";

let fontCache: {
	regular: ArrayBuffer;
	semibold: ArrayBuffer;
	bold: ArrayBuffer;
} | null = null;

async function loadFonts() {
	if (fontCache) return fontCache;

	const cssRes = await fetch(GOOGLE_FONTS_CSS_URL, {
		headers: { "User-Agent": FONT_FETCH_UA },
	});
	if (!cssRes.ok) {
		throw new Error(`Failed to fetch Google Fonts CSS: ${cssRes.status}`);
	}
	const css = await cssRes.text();

	const getTtfUrl = (weight: number): string => {
		// Match the @font-face block for the given weight, then pull the .ttf url.
		const blockRe = new RegExp(
			`font-weight:\\s*${weight};[\\s\\S]*?url\\((https:[^)]+\\.ttf)\\)`,
		);
		const match = css.match(blockRe);
		if (!match?.[1]) {
			throw new Error(`Could not find Inter weight ${weight} TTF URL`);
		}
		return match[1];
	};

	const [regular, semibold, bold] = await Promise.all([
		fetch(getTtfUrl(400)).then((r) => r.arrayBuffer()),
		fetch(getTtfUrl(600)).then((r) => r.arrayBuffer()),
		fetch(getTtfUrl(700)).then((r) => r.arrayBuffer()),
	]);

	fontCache = { regular, semibold, bold };
	return fontCache;
}

const NATURE_LABELS: Record<ProjectForOg["nature"], string> = {
	community: "Community",
	startup: "Startup",
	side_project: "Side Project",
};

const NATURE_COLORS: Record<
	ProjectForOg["nature"],
	{ bg: string; text: string; border: string }
> = {
	community: {
		bg: "rgba(59, 130, 246, 0.12)",
		text: "#60a5fa",
		border: "rgba(59, 130, 246, 0.3)",
	},
	startup: {
		bg: "rgba(16, 185, 129, 0.12)",
		text: "#34d399",
		border: "rgba(16, 185, 129, 0.3)",
	},
	side_project: {
		bg: "rgba(244, 63, 94, 0.12)",
		text: "#fb7185",
		border: "rgba(244, 63, 94, 0.3)",
	},
};

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max - 1).trimEnd()}…`;
}

function getInitials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.map((w) => w[0])
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

// Deterministic gradient palette for member avatars — picks one based on index.
const AVATAR_GRADIENTS = [
	"linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
	"linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)",
	"linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
	"linear-gradient(135deg, #f59e0b 0%, #f43f5e 100%)",
	"linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
];

type VNode = {
	type: string;
	props: {
		style?: Record<string, string | number>;
		children?: VNode | VNode[] | string | null;
	};
};

function el(
	style: Record<string, string | number>,
	children?: VNode | VNode[] | string | null,
): VNode {
	return { type: "div", props: { style: { display: "flex", ...style }, children } };
}

/**
 * Build a satori VDOM (React-less) for the OG image card.
 */
function buildCard(project: ProjectForOg): VNode {
	const natureColor = NATURE_COLORS[project.nature];
	const name = truncate(project.name, 70);
	const description = project.description
		? truncate(project.description, 170)
		: null;
	const memberCount = project.members.length;
	const webUrl = env.WEB_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
	const backdropInitial = (name[0] ?? "M").toUpperCase();
	const visibleMembers = project.members.slice(0, 3);
	const overflow = Math.max(0, memberCount - visibleMembers.length);

	// --- Background orbs ---
	const topLeftOrb: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				position: "absolute",
				top: "-280px",
				left: "-180px",
				width: "720px",
				height: "720px",
				borderRadius: "9999px",
				background:
					"radial-gradient(circle, rgba(59, 130, 246, 0.35) 0%, rgba(59, 130, 246, 0) 65%)",
			},
		},
	};
	const bottomRightOrb: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				position: "absolute",
				bottom: "-300px",
				right: "-200px",
				width: "800px",
				height: "800px",
				borderRadius: "9999px",
				background:
					"radial-gradient(circle, rgba(99, 102, 241, 0.3) 0%, rgba(99, 102, 241, 0) 65%)",
			},
		},
	};
	const centerOrb: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				position: "absolute",
				top: "200px",
				right: "300px",
				width: "400px",
				height: "400px",
				borderRadius: "9999px",
				background:
					"radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, rgba(14, 165, 233, 0) 70%)",
			},
		},
	};

	// --- Decorative giant initial in background ---
	const backdrop: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				position: "absolute",
				right: "-60px",
				bottom: "-180px",
				fontSize: "640px",
				fontWeight: 700,
				color: "rgba(255, 255, 255, 0.025)",
				lineHeight: 1,
				letterSpacing: "-0.05em",
			},
			children: backdropInitial,
		},
	};

	// --- Logo mark + wordmark ---
	const logoMark: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: "56px",
				height: "56px",
				borderRadius: "14px",
				background:
					"linear-gradient(135deg, #3b82f6 0%, #6366f1 50%, #8b5cf6 100%)",
				boxShadow: "0 10px 30px rgba(59, 130, 246, 0.3)",
			},
			children: {
				type: "div",
				props: {
					style: {
						display: "flex",
						fontSize: "32px",
						fontWeight: 700,
						color: "#ffffff",
						letterSpacing: "-0.02em",
					},
					children: "M",
				},
			},
		},
	};

	const wordmark: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				gap: "18px",
			},
			children: [
				logoMark,
				{
					type: "div",
					props: {
						style: {
							display: "flex",
							fontSize: "26px",
							fontWeight: 700,
							letterSpacing: "0.18em",
							color: "#ffffff",
						},
						children: "MSOCIETY",
					},
				},
			],
		},
	};

	// --- Badges ---
	const badges: VNode[] = [];
	if (project.isEndorsed) {
		badges.push({
			type: "div",
			props: {
				style: {
					display: "flex",
					alignItems: "center",
					fontSize: "20px",
					fontWeight: 600,
					padding: "12px 22px",
					borderRadius: "9999px",
					backgroundColor: "rgba(16, 185, 129, 0.12)",
					color: "#34d399",
					border: "1px solid rgba(16, 185, 129, 0.35)",
				},
				children: "✓ Endorsed",
			},
		});
	}
	badges.push({
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				fontSize: "20px",
				fontWeight: 600,
				padding: "12px 22px",
				borderRadius: "9999px",
				backgroundColor: natureColor.bg,
				color: natureColor.text,
				border: `1px solid ${natureColor.border}`,
			},
			children: NATURE_LABELS[project.nature],
		},
	});

	const headerRow: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				width: "100%",
			},
			children: [
				wordmark,
				{
					type: "div",
					props: {
						style: { display: "flex", gap: "12px" },
						children: badges,
					},
				},
			],
		},
	};

	// --- Title + description with accent bar ---
	const accentBar: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				width: "6px",
				height: "auto",
				borderRadius: "9999px",
				background:
					"linear-gradient(180deg, #3b82f6 0%, #8b5cf6 100%)",
				marginRight: "32px",
			},
		},
	};

	const titleNode: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				fontSize: "86px",
				fontWeight: 700,
				lineHeight: 1.05,
				letterSpacing: "-0.03em",
				color: "#ffffff",
			},
			children: name,
		},
	};

	const descriptionNode: VNode | null = description
		? {
				type: "div",
				props: {
					style: {
						display: "flex",
						fontSize: "30px",
						fontWeight: 400,
						lineHeight: 1.4,
						color: "#94a3b8",
					},
					children: description,
				},
			}
		: null;

	const titleBlock: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				gap: "24px",
				maxWidth: "1040px",
			},
			children: [titleNode, descriptionNode].filter(
				(n): n is VNode => n !== null,
			),
		},
	};

	const contentRow: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "stretch",
				maxWidth: "1080px",
			},
			children: [accentBar, titleBlock],
		},
	};

	// --- Member avatar stack ---
	const avatarNodes: VNode[] = visibleMembers.map((m, idx) => ({
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				width: "52px",
				height: "52px",
				borderRadius: "9999px",
				background: AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length]!,
				border: "3px solid #020617",
				marginLeft: idx === 0 ? "0" : "-14px",
				fontSize: "18px",
				fontWeight: 600,
				color: "#ffffff",
				letterSpacing: "-0.01em",
			},
			children: getInitials(m.name) || "?",
		},
	}));
	if (overflow > 0) {
		avatarNodes.push({
			type: "div",
			props: {
				style: {
					display: "flex",
					alignItems: "center",
					justifyContent: "center",
					width: "52px",
					height: "52px",
					borderRadius: "9999px",
					backgroundColor: "#1e293b",
					border: "3px solid #020617",
					marginLeft: "-14px",
					fontSize: "16px",
					fontWeight: 600,
					color: "#cbd5e1",
				},
				children: `+${overflow}`,
			},
		});
	}

	const membersLabel =
		memberCount === 0
			? "No members yet"
			: memberCount === 1
				? "1 member"
				: `${memberCount} members`;

	const membersBlock: VNode = {
		type: "div",
		props: {
			style: { display: "flex", alignItems: "center", gap: "18px" },
			children: [
				...(avatarNodes.length > 0
					? [
							{
								type: "div",
								props: {
									style: { display: "flex", alignItems: "center" },
									children: avatarNodes,
								},
							} satisfies VNode,
						]
					: []),
				{
					type: "div",
					props: {
						style: {
							display: "flex",
							fontSize: "22px",
							fontWeight: 500,
							color: "#94a3b8",
						},
						children: membersLabel,
					},
				},
			],
		},
	};

	const urlBlock: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				gap: "12px",
				padding: "14px 24px",
				borderRadius: "9999px",
				border: "1px solid rgba(255, 255, 255, 0.1)",
				backgroundColor: "rgba(255, 255, 255, 0.04)",
			},
			children: [
				{
					type: "div",
					props: {
						style: {
							display: "flex",
							fontSize: "22px",
							fontWeight: 500,
							color: "#e2e8f0",
						},
						children: webUrl,
					},
				},
				{
					type: "div",
					props: {
						style: {
							display: "flex",
							fontSize: "22px",
							fontWeight: 500,
							color: "#60a5fa",
						},
						children: "→",
					},
				},
			],
		},
	};

	const footerRow: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				width: "100%",
			},
			children: [membersBlock, urlBlock],
		},
	};

	// --- Spacers ---
	const spacer = (): VNode =>
		el({ flexGrow: 1, width: "100%" });

	// --- Root ---
	return {
		type: "div",
		props: {
			style: {
				width: "1200px",
				height: "630px",
				display: "flex",
				flexDirection: "column",
				backgroundColor: "#020617",
				padding: "72px",
				position: "relative",
				fontFamily: "Inter",
				color: "#ffffff",
				overflow: "hidden",
			},
			children: [
				topLeftOrb,
				bottomRightOrb,
				centerOrb,
				backdrop,
				headerRow,
				spacer(),
				contentRow,
				spacer(),
				footerRow,
			],
		},
	};
}

export async function generateProjectOgImage(
	project: ProjectForOg,
): Promise<Uint8Array> {
	const fonts = await loadFonts();

	// satori's VDOM type is internal to the library
	const svg = await satori(buildCard(project) as unknown as Parameters<typeof satori>[0], {
		width: 1200,
		height: 630,
		fonts: [
			{
				name: "Inter",
				data: fonts.regular,
				weight: 400,
				style: "normal",
			},
			{
				name: "Inter",
				data: fonts.semibold,
				weight: 600,
				style: "normal",
			},
			{
				name: "Inter",
				data: fonts.bold,
				weight: 700,
				style: "normal",
			},
		],
	});

	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: 1200 },
	});
	return resvg.render().asPng();
}
