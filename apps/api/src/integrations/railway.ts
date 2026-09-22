// Railway GraphQL API integration for PR preview environments (issue #52 /
// ADR-009). Requires `RAILWAY_API_TOKEN` to be a *workspace* token, not a
// project token — project tokens are locked to one existing environment at
// creation time, which can't reach a `pr-<n>` environment that doesn't
// exist yet. A workspace token can create/delete environments and set
// variables across every project in the workspace, which is what lets this
// API manage PR environments directly instead of relying on Railway's
// native "PR Environments" dashboard feature + an app-side self-configure
// step at boot.
//
// Implemented against Railway's public docs (docs.railway.com/integrations/api)
// as of this writing. Railway's schema is the contract and isn't versioned —
// this hasn't been exercised against a live workspace in this environment,
// so verify field names against a GraphiQL introspection (railway.com/graphiql)
// before first production use.
import { env } from "../env";

const RAILWAY_API_BASE = "https://backboard.railway.com/graphql/v2";

export interface RailwayProject {
  id: string;
  name: string;
}
export interface RailwayEnvironment {
  id: string;
  name: string;
  isEphemeral: boolean;
}
export interface RailwayService {
  id: string;
  name: string;
}

function requireApiToken(): string {
  if (!env.RAILWAY_API_TOKEN) {
    throw new Error(
      "RAILWAY_API_TOKEN is not configured — cannot manage Railway resources",
    );
  }
  return env.RAILWAY_API_TOKEN;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

async function railwayRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RAILWAY_API_BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireApiToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Railway API request failed: ${res.status} ${body}`);
  }

  const json = (await res.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(
      `Railway API returned errors: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }
  if (!json.data) {
    throw new Error("Railway API returned no data");
  }
  return json.data;
}

interface EdgesOf<T> {
  edges: Array<{ node: T }>;
}

export const railwayClient = {
  async listProjects(): Promise<RailwayProject[]> {
    const data = await railwayRequest<{ projects: EdgesOf<RailwayProject> }>(
      `query { projects { edges { node { id name } } } }`,
    );
    return data.projects.edges.map((e) => e.node);
  },

  async createProject(name: string): Promise<RailwayProject> {
    const data = await railwayRequest<{ projectCreate: RailwayProject }>(
      `mutation ProjectCreate($input: ProjectCreateInput!) {
        projectCreate(input: $input) { id name }
      }`,
      { input: { name } },
    );
    return data.projectCreate;
  },

  async listServices(projectId: string): Promise<RailwayService[]> {
    const data = await railwayRequest<{
      project: { services: EdgesOf<RailwayService> };
    }>(
      `query Project($id: String!) {
        project(id: $id) { services { edges { node { id name } } } }
      }`,
      { id: projectId },
    );
    return data.project.services.edges.map((e) => e.node);
  },

  async listEnvironments(projectId: string): Promise<RailwayEnvironment[]> {
    const data = await railwayRequest<{
      project: { environments: EdgesOf<RailwayEnvironment> };
    }>(
      `query Project($id: String!) {
        project(id: $id) {
          environments { edges { node { id name isEphemeral } } }
        }
      }`,
      { id: projectId },
    );
    return data.project.environments.edges.map((e) => e.node);
  },

  /** Forks `name` off `sourceEnvironmentId`, cloning its service config. Marked ephemeral (a PR preview), with deploys held until variables are set. */
  async createEnvironment(input: {
    projectId: string;
    name: string;
    sourceEnvironmentId: string;
  }): Promise<RailwayEnvironment> {
    const data = await railwayRequest<{
      environmentCreate: RailwayEnvironment;
    }>(
      `mutation EnvironmentCreate($input: EnvironmentCreateInput!) {
        environmentCreate(input: $input) { id name isEphemeral }
      }`,
      {
        input: {
          projectId: input.projectId,
          name: input.name,
          sourceEnvironmentId: input.sourceEnvironmentId,
          ephemeral: true,
          skipInitialDeploys: true,
        },
      },
    );
    return data.environmentCreate;
  },

  /** Deleting an already-gone environment is treated as success by callers. */
  async deleteEnvironment(environmentId: string): Promise<void> {
    await railwayRequest(
      `mutation EnvironmentDelete($id: String!) { environmentDelete(id: $id) }`,
      { id: environmentId },
    );
  },

  async upsertVariable(input: {
    projectId: string;
    environmentId: string;
    serviceId: string;
    name: string;
    value: string;
  }): Promise<void> {
    await railwayRequest(
      `mutation VariableUpsert($input: VariableUpsertInput!) {
        variableUpsert(input: $input)
      }`,
      {
        input: {
          projectId: input.projectId,
          environmentId: input.environmentId,
          serviceId: input.serviceId,
          name: input.name,
          value: input.value,
          skipDeploys: true,
        },
      },
    );
  },

  /**
   * Names only — never values. Used so an admin can see which keys an
   * environment already has (to decide which ones the platform should
   * take over vs. leave as whatever Railway clones) without this API ever
   * displaying, storing, or logging a live production secret's value.
   * Railway's `variables` query returns a name→value map; the values are
   * discarded the moment this function reads them and never leave it.
   */
  async listVariableNames(input: {
    projectId: string;
    environmentId: string;
    serviceId: string;
  }): Promise<string[]> {
    const data = await railwayRequest<{ variables: Record<string, string> }>(
      `query Variables($projectId: String!, $environmentId: String!, $serviceId: String) {
        variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId)
      }`,
      {
        projectId: input.projectId,
        environmentId: input.environmentId,
        serviceId: input.serviceId,
      },
    );
    return Object.keys(data.variables);
  },

  /** Deploys the service's latest image/build into the given environment — call once all variables are set. */
  async deployService(input: {
    serviceId: string;
    environmentId: string;
  }): Promise<void> {
    await railwayRequest(
      `mutation ServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId: input.serviceId, environmentId: input.environmentId },
    );
  },
};
