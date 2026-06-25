export interface ProjectSummary {
  id: string;
  name: string;
  path?: string;
  updatedAt?: string | null;
  createdAt?: string | null;
  connected?: boolean;
  snapshotCount?: number;
  latestScreenshotUrl?: string | null;
  latestScreenshotSnapshotId?: string | null;
}

export interface ProjectSwitcherElements {
  button: HTMLButtonElement;
  nameLabel: HTMLElement;
  dialog: HTMLDialogElement;
  list: HTMLElement;
  closeButton: HTMLButtonElement;
  newButton: HTMLButtonElement;
  newNameInput: HTMLInputElement;
  searchInput: HTMLInputElement;
}

export interface ProjectSwitcherOptions {
  sessionId: string | null;
  elements: ProjectSwitcherElements;
  navigate(path: string): void;
}

export interface ProjectSwitcherController {
  configure(): void;
  refreshCurrentProject(): Promise<void>;
  openDialog(): Promise<void>;
}

interface ProjectListResponse {
  projects?: ProjectSummary[];
}

interface ProjectResponse {
  project?: ProjectSummary;
  url?: string;
}

export function createProjectSwitcher(options: ProjectSwitcherOptions): ProjectSwitcherController {
  const { elements, sessionId } = options;
  let configured = false;
  let projects: ProjectSummary[] = [];
  let loading = false;
  let creating = false;
  let errorMessage = "";

  async function refreshCurrentProject(): Promise<void> {
    if (!sessionId) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json() as ProjectResponse;
      applyProjectLabel(body.project ?? null);
    } catch {
      applyProjectLabel(null);
    }
  }

  async function openDialog(): Promise<void> {
    if (!sessionId) return;
    elements.searchInput.value = "";
    elements.newNameInput.value = "";
    renderProjects();
    if (!elements.dialog.open) elements.dialog.showModal();
    elements.searchInput.focus({ preventScroll: true });
    elements.searchInput.select();
    await refreshProjects();
  }

  async function refreshProjects(): Promise<void> {
    loading = true;
    errorMessage = "";
    renderProjects();
    try {
      const response = await fetch("/api/projects", { cache: "no-store" });
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json() as ProjectListResponse;
      projects = body.projects ?? [];
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      projects = [];
    } finally {
      loading = false;
      renderProjects();
    }
  }

  async function createProject(): Promise<void> {
    if (creating) return;
    const name = elements.newNameInput.value.trim() || "Untitled Project";

    creating = true;
    elements.newButton.disabled = true;
    elements.newNameInput.disabled = true;
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await response.text());
      const body = await response.json() as ProjectResponse;
      const projectPath = body.project?.path ?? body.url;
      if (!projectPath) throw new Error("New project did not include a URL.");
      options.navigate(projectPath);
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      renderProjects();
    } finally {
      creating = false;
      elements.newButton.disabled = false;
      elements.newNameInput.disabled = false;
    }
  }

  function switchProject(project: ProjectSummary): void {
    if (project.id === sessionId) {
      elements.dialog.close();
      return;
    }
    options.navigate(project.path ?? `/s/${project.id}`);
  }

  function renderProjects(): void {
    if (loading) {
      elements.list.replaceChildren(renderMessage("Loading projects"));
      return;
    }

    if (errorMessage) {
      elements.list.replaceChildren(renderMessage("Could not load projects"));
      return;
    }

    const visibleProjects = filteredProjects();
    if (visibleProjects.length === 0) {
      elements.list.replaceChildren(renderMessage(elements.searchInput.value ? "No matching projects" : "No projects yet"));
      return;
    }

    elements.list.replaceChildren(...visibleProjects.map(renderProjectCard));
  }

  function renderProjectCard(project: ProjectSummary): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-card";
    button.setAttribute("aria-pressed", String(project.id === sessionId));
    if (project.id === sessionId) button.setAttribute("aria-current", "true");
    button.addEventListener("click", () => switchProject(project));

    const thumbnail = document.createElement("span");
    thumbnail.className = "project-thumbnail";
    if (project.latestScreenshotUrl) {
      const image = document.createElement("img");
      image.src = project.latestScreenshotUrl;
      image.alt = "";
      image.loading = "lazy";
      thumbnail.append(image);
    } else {
      const empty = document.createElement("span");
      empty.textContent = "No preview";
      thumbnail.append(empty);
    }

    const body = document.createElement("span");
    body.className = "project-card-body";

    const name = document.createElement("strong");
    name.textContent = project.name || "Untitled Project";

    const meta = document.createElement("small");
    meta.textContent = projectMeta(project);

    body.append(name, meta);
    if (project.connected || project.id === sessionId) {
      const badges = document.createElement("span");
      badges.className = "project-badges";
      if (project.id === sessionId) badges.append(renderBadge("Current"));
      if (project.connected) badges.append(renderBadge("Connected"));
      body.append(badges);
    }

    button.append(thumbnail, body);
    return button;
  }

  function filteredProjects(): ProjectSummary[] {
    const query = normalizeSearch(elements.searchInput.value);
    if (!query) return projects;
    return projects.filter((project) => {
      return normalizeSearch(project.name).includes(query) || normalizeSearch(project.id).includes(query);
    });
  }

  function applyProjectLabel(project: ProjectSummary | null): void {
    const name = project?.name || "Untitled Project";
    elements.nameLabel.textContent = name;
    elements.button.title = sessionId ? `${name} (${sessionId})` : name;
  }

  function closeDialog(): void {
    elements.dialog.close();
  }

  return {
    configure() {
      if (configured) return;
      configured = true;
      if (!sessionId) {
        elements.button.disabled = true;
        elements.nameLabel.textContent = "No Project";
        return;
      }
      elements.button.addEventListener("click", () => void openDialog());
      elements.closeButton.addEventListener("click", closeDialog);
      elements.newButton.addEventListener("click", () => void createProject());
      elements.newNameInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        event.preventDefault();
        void createProject();
      });
      elements.searchInput.addEventListener("input", renderProjects);
      elements.searchInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.isComposing) return;
        const firstProject = filteredProjects()[0];
        if (!firstProject) return;
        event.preventDefault();
        switchProject(firstProject);
      });
      elements.dialog.addEventListener("click", (event) => {
        if (event.target === elements.dialog) elements.dialog.close();
      });
      elements.dialog.addEventListener("close", () => {
        elements.button.focus({ preventScroll: true });
      });
      void refreshCurrentProject();
    },
    refreshCurrentProject,
    openDialog,
  };
}

function renderBadge(label: string): HTMLElement {
  const badge = document.createElement("span");
  badge.className = "project-badge";
  badge.textContent = label;
  return badge;
}

function renderMessage(message: string): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "project-empty";
  empty.textContent = message;
  return empty;
}

function projectMeta(project: ProjectSummary): string {
  const parts = [];
  const timestamp = project.updatedAt ?? project.createdAt;
  if (timestamp) parts.push(formatProjectTime(timestamp));
  parts.push(snapshotCountLabel(project.snapshotCount ?? 0));
  parts.push(project.id);
  return parts.join(" / ");
}

function snapshotCountLabel(count: number): string {
  return `${count} snapshot${count === 1 ? "" : "s"}`;
}

function formatProjectTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}
