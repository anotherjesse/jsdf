export interface ProjectInitialState {
  name: string | null;
  source: string | null;
  snapshotId: string | null;
}

interface ProjectResponse {
  project?: {
    name?: string | null;
    latestSnapshot?: {
      id?: string | null;
      codeUrl?: string | null;
    } | null;
  };
}

export async function loadProjectInitialState(sessionId: string | null): Promise<ProjectInitialState | null> {
  if (!sessionId) return null;

  try {
    const projectResponse = await fetch(`/api/projects/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    if (!projectResponse.ok) return null;
    const body = await projectResponse.json() as ProjectResponse;
    const project = body.project;
    if (!project) return null;

    const source = await loadSnapshotSource(project.latestSnapshot?.codeUrl ?? null);
    return {
      name: project.name?.trim() || null,
      source,
      snapshotId: source ? project.latestSnapshot?.id ?? null : null,
    };
  } catch {
    return null;
  }
}

async function loadSnapshotSource(codeUrl: string | null): Promise<string | null> {
  if (!codeUrl) return null;
  try {
    const response = await fetch(codeUrl, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
