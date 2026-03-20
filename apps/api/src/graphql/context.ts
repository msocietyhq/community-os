import { auth } from "../auth";
import { defineAbilityFor, isRole } from "@community-os/shared";

export interface GraphQLContext {
  user: {
    id: string;
    name: string;
    role: string;
    banned: boolean | null;
  } | null;
}

export async function buildContext(request: Request): Promise<GraphQLContext> {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session || session.user.banned) return { user: null };

    return {
      user: {
        id: session.user.id,
        name: session.user.name,
        role: session.user.role ?? "member",
        banned: session.user.banned,
      },
    };
  } catch {
    return { user: null };
  }
}
