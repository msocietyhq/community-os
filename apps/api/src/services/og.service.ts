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

export type MemberForOg = {
	user: {
		name: string;
		image: string | null;
		telegramUsername: string | null;
	};
	bio: string | null;
	currentTitle: string | null;
	currentCompany: string | null;
	skills: string[] | null;
	joinedAt: Date | string | null;
	projectCount: number;
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

/**
 * Fetch a remote image and return it as a base64 data URL so satori can embed
 * it deterministically. Returns null on any failure (missing url, non-ok
 * response, network error) — callers should fall back to a placeholder.
 */
async function fetchImageAsDataUrl(
	url: string | null,
): Promise<string | null> {
	if (!url) return null;
	try {
		const res = await fetch(url);
		if (!res.ok) return null;
		const contentType = res.headers.get("content-type") ?? "image/jpeg";
		const buf = await res.arrayBuffer();
		const base64 = Buffer.from(buf).toString("base64");
		return `data:${contentType};base64,${base64}`;
	} catch {
		return null;
	}
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

// Deterministic gradient palette for avatar placeholders — picks one by index.
const AVATAR_GRADIENTS = [
	"linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)",
	"linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)",
	"linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
	"linear-gradient(135deg, #f59e0b 0%, #f43f5e 100%)",
	"linear-gradient(135deg, #10b981 0%, #06b6d4 100%)",
];

function gradientFor(seed: string): string {
	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) | 0;
	}
	return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]!;
}

// ---------------------------------------------------------------------------
// Satori VDOM primitives
// ---------------------------------------------------------------------------

type VNode = {
	type: string;
	props: {
		style?: Record<string, string | number>;
		children?: VNode | VNode[] | string | null;
		src?: string;
		width?: number;
		height?: number;
	};
};

function el(
	style: Record<string, string | number>,
	children?: VNode | VNode[] | string | null,
): VNode {
	return {
		type: "div",
		props: { style: { display: "flex", ...style }, children },
	};
}

function spacer(): VNode {
	return el({ flexGrow: 1, width: "100%" });
}

// ---------------------------------------------------------------------------
// Shared frame pieces used by both project and member cards
// ---------------------------------------------------------------------------

function buildOrbs(): VNode[] {
	return [
		{
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
		},
		{
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
		},
		{
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
		},
	];
}

function buildBackdrop(char: string): VNode {
	return {
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
			children: char,
		},
	};
}

function buildWordmark(): VNode {
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

	return {
		type: "div",
		props: {
			style: { display: "flex", alignItems: "center", gap: "18px" },
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
}

function buildHeaderRow(rightSlot: VNode | null): VNode {
	const children: VNode[] = [buildWordmark()];
	if (rightSlot) children.push(rightSlot);
	else children.push(el({})); // empty spacer for justify-content
	return {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				width: "100%",
			},
			children,
		},
	};
}

function buildUrlPill(text: string): VNode {
	return {
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
						children: text,
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
}

function buildRoot(
	headerRight: VNode | null,
	backdropChar: string,
	body: VNode,
	footer: VNode,
): VNode {
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
				...buildOrbs(),
				buildBackdrop(backdropChar),
				buildHeaderRow(headerRight),
				spacer(),
				body,
				spacer(),
				footer,
			],
		},
	};
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

function buildProjectCard(project: ProjectForOg): VNode {
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
	const headerRight: VNode = {
		type: "div",
		props: {
			style: { display: "flex", gap: "12px" },
			children: badges,
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

	const footerRow: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				width: "100%",
			},
			children: [membersBlock, buildUrlPill(`${webUrl}/projects/${project.slug}`)],
		},
	};

	return buildRoot(headerRight, backdropInitial, contentRow, footerRow);
}

// ---------------------------------------------------------------------------
// Member card
// ---------------------------------------------------------------------------

function formatJoinedLabel(joinedAt: Date | string | null): string | null {
	if (!joinedAt) return null;
	const d = joinedAt instanceof Date ? joinedAt : new Date(joinedAt);
	if (Number.isNaN(d.getTime())) return null;
	const month = d.toLocaleString("en-US", { month: "short" });
	return `Member since ${month} ${d.getFullYear()}`;
}

function buildMemberCard(
	member: MemberForOg,
	avatarDataUrl: string | null,
): VNode {
	const name = truncate(member.user.name, 40);
	const backdropInitial = (name[0] ?? "M").toUpperCase();
	const telegramUsername = member.user.telegramUsername ?? "";
	const webUrl = env.WEB_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");

	// --- Header right slot: "Member since …" ---
	const joinedLabel = formatJoinedLabel(member.joinedAt);
	const headerRight: VNode | null = joinedLabel
		? {
				type: "div",
				props: {
					style: {
						display: "flex",
						fontSize: "20px",
						fontWeight: 500,
						color: "#94a3b8",
					},
					children: joinedLabel,
				},
			}
		: null;

	// --- Avatar block (image or gradient fallback) ---
	const AVATAR_SIZE = 180;
	const avatarBlock: VNode = avatarDataUrl
		? {
				type: "div",
				props: {
					style: {
						display: "flex",
						width: `${AVATAR_SIZE}px`,
						height: `${AVATAR_SIZE}px`,
						borderRadius: "9999px",
						overflow: "hidden",
						border: "4px solid rgba(255, 255, 255, 0.08)",
						boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
					},
					children: {
						type: "img",
						props: {
							src: avatarDataUrl,
							width: AVATAR_SIZE,
							height: AVATAR_SIZE,
							style: {
								width: `${AVATAR_SIZE}px`,
								height: `${AVATAR_SIZE}px`,
								objectFit: "cover",
							},
						},
					},
				},
			}
		: {
				type: "div",
				props: {
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						width: `${AVATAR_SIZE}px`,
						height: `${AVATAR_SIZE}px`,
						borderRadius: "9999px",
						background: gradientFor(name),
						border: "4px solid rgba(255, 255, 255, 0.08)",
						boxShadow: "0 20px 60px rgba(0, 0, 0, 0.5)",
						fontSize: "72px",
						fontWeight: 700,
						color: "#ffffff",
						letterSpacing: "-0.02em",
					},
					children: getInitials(name) || "?",
				},
			};

	// --- Identity column (name + title/company + bio) ---
	const identityChildren: VNode[] = [];

	identityChildren.push({
		type: "div",
		props: {
			style: {
				display: "flex",
				fontSize: "76px",
				fontWeight: 700,
				lineHeight: 1.05,
				letterSpacing: "-0.03em",
				color: "#ffffff",
			},
			children: name,
		},
	});

	const titleLineParts: string[] = [];
	if (member.currentTitle) titleLineParts.push(member.currentTitle);
	if (member.currentCompany) titleLineParts.push(member.currentCompany);
	const titleLine = titleLineParts.join(" · ");
	if (titleLine) {
		identityChildren.push({
			type: "div",
			props: {
				style: {
					display: "flex",
					fontSize: "28px",
					fontWeight: 500,
					color: "#cbd5e1",
				},
				children: truncate(titleLine, 80),
			},
		});
	}

	if (member.bio) {
		identityChildren.push({
			type: "div",
			props: {
				style: {
					display: "flex",
					fontSize: "24px",
					fontWeight: 400,
					lineHeight: 1.4,
					color: "#94a3b8",
					marginTop: "8px",
				},
				children: truncate(member.bio, 160),
			},
		});
	}

	const identityColumn: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				flexDirection: "column",
				gap: "14px",
				maxWidth: "820px",
			},
			children: identityChildren,
		},
	};

	const contentRow: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				gap: "48px",
				maxWidth: "1080px",
			},
			children: [avatarBlock, identityColumn],
		},
	};

	// --- Footer: skill pills (or project count fallback) + url pill ---
	const skills = (member.skills ?? []).filter(Boolean);
	const visibleSkills = skills.slice(0, 3);
	const skillOverflow = Math.max(0, skills.length - visibleSkills.length);

	let footerLeft: VNode;
	if (visibleSkills.length > 0) {
		const pills: VNode[] = visibleSkills.map((skill) => ({
			type: "div",
			props: {
				style: {
					display: "flex",
					alignItems: "center",
					fontSize: "20px",
					fontWeight: 500,
					padding: "10px 20px",
					borderRadius: "9999px",
					backgroundColor: "rgba(148, 163, 184, 0.1)",
					color: "#cbd5e1",
					border: "1px solid rgba(148, 163, 184, 0.25)",
				},
				children: truncate(skill, 20),
			},
		}));
		if (skillOverflow > 0) {
			pills.push({
				type: "div",
				props: {
					style: {
						display: "flex",
						alignItems: "center",
						fontSize: "20px",
						fontWeight: 600,
						padding: "10px 20px",
						borderRadius: "9999px",
						backgroundColor: "rgba(30, 41, 59, 0.8)",
						color: "#cbd5e1",
						border: "1px solid rgba(148, 163, 184, 0.2)",
					},
					children: `+${skillOverflow}`,
				},
			});
		}
		footerLeft = {
			type: "div",
			props: {
				style: { display: "flex", alignItems: "center", gap: "10px" },
				children: pills,
			},
		};
	} else {
		const count = member.projectCount;
		const label =
			count === 0
				? "No projects yet"
				: count === 1
					? "1 project"
					: `${count} projects`;
		footerLeft = {
			type: "div",
			props: {
				style: {
					display: "flex",
					fontSize: "22px",
					fontWeight: 500,
					color: "#94a3b8",
				},
				children: label,
			},
		};
	}

	const urlText = telegramUsername
		? `${webUrl}/member/${telegramUsername}`
		: webUrl;
	const footerRow: VNode = {
		type: "div",
		props: {
			style: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				width: "100%",
			},
			children: [footerLeft, buildUrlPill(urlText)],
		},
	};

	return buildRoot(headerRight, backdropInitial, contentRow, footerRow);
}

// ---------------------------------------------------------------------------
// Satori runner
// ---------------------------------------------------------------------------

async function renderVDomToPng(vdom: VNode): Promise<Uint8Array> {
	const fonts = await loadFonts();

	const svg = await satori(
		vdom as unknown as Parameters<typeof satori>[0],
		{
			width: 1200,
			height: 630,
			fonts: [
				{ name: "Inter", data: fonts.regular, weight: 400, style: "normal" },
				{ name: "Inter", data: fonts.semibold, weight: 600, style: "normal" },
				{ name: "Inter", data: fonts.bold, weight: 700, style: "normal" },
			],
		},
	);

	const resvg = new Resvg(svg, {
		fitTo: { mode: "width", value: 1200 },
	});
	return resvg.render().asPng();
}

export async function generateProjectOgImage(
	project: ProjectForOg,
): Promise<Uint8Array> {
	return renderVDomToPng(buildProjectCard(project));
}

export async function generateMemberOgImage(
	member: MemberForOg,
): Promise<Uint8Array> {
	const avatarDataUrl = await fetchImageAsDataUrl(member.user.image);
	return renderVDomToPng(buildMemberCard(member, avatarDataUrl));
}
