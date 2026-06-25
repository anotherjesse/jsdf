export interface AppElements {
  canvas: HTMLCanvasElement;
  codeEditorRoot: HTMLElement;
  graphInspectorRoot: HTMLElement;
  gpuBadge: HTMLElement;
  editorStatus: HTMLElement;
  apiStat: HTMLElement;
  overlay: HTMLElement;
  sourceDialog: HTMLDialogElement;
  closeSourceDialogButton: HTMLButtonElement;
  loadSourceButton: HTMLButtonElement;
  saveSourceButton: HTMLButtonElement;
  stepsInput: HTMLInputElement;
  stepsOutput: HTMLOutputElement;
  gridInput: HTMLInputElement;
  gridOutput: HTMLOutputElement;
  sourceEditor: {
    prettifyButton: HTMLButtonElement;
    sourceHintsButton: HTMLButtonElement;
  };
  editorView: {
    codeModeButton: HTMLButtonElement;
    graphModeButton: HTMLButtonElement;
    selectionFocusButton: HTMLButtonElement;
    codePanel: HTMLElement;
    graphPanel: HTMLElement;
  };
  previewViewport: {
    canvas: HTMLCanvasElement;
    viewLabels: HTMLElement;
    shaderViewButton: HTMLButtonElement;
    meshViewButton: HTMLButtonElement;
    layoutViewButton: HTMLButtonElement;
    downloadButton: HTMLButtonElement;
    surfaceNetButton: HTMLButtonElement;
    tetraMeshButton: HTMLButtonElement;
    stepsInput: HTMLInputElement;
    stepsOutput: HTMLOutputElement;
    gridInput: HTMLInputElement;
    gridOutput: HTMLOutputElement;
    previewStat: HTMLElement;
    meshStat: HTMLElement;
    triangleStat: HTMLElement;
    overlay: HTMLElement;
  };
  previewBounds: {
    root: HTMLElement;
    fitButton: HTMLButtonElement;
    overlay: HTMLElement;
  };
  appHealth: {
    selectionFocusButton: HTMLButtonElement;
    prettifySourceButton: HTMLButtonElement;
    loadSourceButton: HTMLButtonElement;
    saveSourceButton: HTMLButtonElement;
  };
  browserSession: {
    strip: HTMLElement;
    idLabel: HTMLElement;
    copyAgentPromptButton: HTMLButtonElement;
    snapshotButton: HTMLButtonElement;
    status: HTMLElement;
  };
  projectSwitcher: {
    button: HTMLButtonElement;
    nameLabel: HTMLElement;
    dialog: HTMLDialogElement;
    list: HTMLElement;
    closeButton: HTMLButtonElement;
    newButton: HTMLButtonElement;
    newNameInput: HTMLInputElement;
    searchInput: HTMLInputElement;
  };
  graphHistory: {
    undoButton: HTMLButtonElement;
    redoButton: HTMLButtonElement;
    resetButton: HTMLButtonElement;
    journal: HTMLElement;
  };
  sourceWorkspace: {
    documentNameInput: HTMLInputElement;
    dirtyIndicator: HTMLElement;
    saveButton: HTMLButtonElement;
  };
  sourceWorkspaceActions: {
    dialog: HTMLDialogElement;
    list: HTMLElement;
    loadButton: HTMLButtonElement;
  };
}

export function queryAppElements(root: ParentNode = document): AppElements {
  const canvas = query<HTMLCanvasElement>(root, "#canvas");
  const viewLabels = query<HTMLElement>(root, "#viewLabels");
  const documentNameInput = query<HTMLInputElement>(root, "#documentNameInput");
  const dirtyIndicator = query<HTMLElement>(root, "#dirtyIndicator");
  const loadSourceButton = query<HTMLButtonElement>(root, "#loadSourceButton");
  const saveSourceButton = query<HTMLButtonElement>(root, "#saveSourceButton");
  const prettifySourceButton = query<HTMLButtonElement>(root, "#prettifySourceButton");
  const sourceHintsButton = query<HTMLButtonElement>(root, "#sourceHintsButton");
  const sourceDialog = query<HTMLDialogElement>(root, "#sourceDialog");
  const sourceDialogList = query<HTMLElement>(root, "#sourceDialogList");
  const closeSourceDialogButton = query<HTMLButtonElement>(root, "#closeSourceDialogButton");
  const gpuBadge = query<HTMLElement>(root, "#gpuBadge");
  const shaderViewButton = query<HTMLButtonElement>(root, "#shaderViewButton");
  const meshViewButton = query<HTMLButtonElement>(root, "#meshViewButton");
  const layoutViewButton = query<HTMLButtonElement>(root, "#layoutViewButton");
  const downloadButton = query<HTMLButtonElement>(root, "#downloadButton");
  const surfaceNetButton = query<HTMLButtonElement>(root, "#surfaceNetButton");
  const tetraMeshButton = query<HTMLButtonElement>(root, "#tetraMeshButton");
  const fitBoundsButton = query<HTMLButtonElement>(root, "#fitBoundsButton");
  const codeModeButton = query<HTMLButtonElement>(root, "#codeModeButton");
  const graphModeButton = query<HTMLButtonElement>(root, "#graphModeButton");
  const selectionFocusButton = query<HTMLButtonElement>(root, "#selectionFocusButton");
  const codePanel = query<HTMLElement>(root, "#codePanel");
  const graphPanel = query<HTMLElement>(root, "#graphPanel");
  const codeEditorRoot = query<HTMLElement>(root, "#codeEditor");
  const graphInspectorRoot = query<HTMLElement>(root, "#graphInspector");
  const editorStatus = query<HTMLElement>(root, "#editorStatus");
  const undoButton = query<HTMLButtonElement>(root, "#undoGraphButton");
  const redoButton = query<HTMLButtonElement>(root, "#redoGraphButton");
  const resetButton = query<HTMLButtonElement>(root, "#resetGraphButton");
  const graphChangeJournal = query<HTMLElement>(root, "#graphChangeJournal");
  const stepsInput = query<HTMLInputElement>(root, "#stepsInput");
  const stepsOutput = query<HTMLOutputElement>(root, "#stepsOutput");
  const gridInput = query<HTMLInputElement>(root, "#gridInput");
  const gridOutput = query<HTMLOutputElement>(root, "#gridOutput");
  const boundsEditor = query<HTMLElement>(root, "#boundsEditor");
  const previewStat = query<HTMLElement>(root, "#previewStat");
  const meshStat = query<HTMLElement>(root, "#meshStat");
  const triangleStat = query<HTMLElement>(root, "#triangleStat");
  const apiStat = query<HTMLElement>(root, "#apiStat");
  const sessionStrip = query<HTMLElement>(root, "#sessionStrip");
  const sessionIdLabel = query<HTMLElement>(root, "#sessionIdLabel");
  const projectSwitcherButton = query<HTMLButtonElement>(root, "#projectSwitcherButton");
  const projectNameLabel = query<HTMLElement>(root, "#projectNameLabel");
  const copyAgentPromptButton = query<HTMLButtonElement>(root, "#copyAgentPromptButton");
  const sessionSnapshotButton = query<HTMLButtonElement>(root, "#sessionSnapshotButton");
  const sessionStatus = query<HTMLElement>(root, "#sessionStatus");
  const projectDialog = query<HTMLDialogElement>(root, "#projectDialog");
  const projectDialogList = query<HTMLElement>(root, "#projectDialogList");
  const closeProjectDialogButton = query<HTMLButtonElement>(root, "#closeProjectDialogButton");
  const newProjectButton = query<HTMLButtonElement>(root, "#newProjectButton");
  const newProjectNameInput = query<HTMLInputElement>(root, "#newProjectNameInput");
  const projectSearchInput = query<HTMLInputElement>(root, "#projectSearchInput");
  const overlay = query<HTMLElement>(root, "#overlay");

  return {
    canvas,
    codeEditorRoot,
    graphInspectorRoot,
    gpuBadge,
    editorStatus,
    apiStat,
    overlay,
    sourceDialog,
    closeSourceDialogButton,
    loadSourceButton,
    saveSourceButton,
    stepsInput,
    stepsOutput,
    gridInput,
    gridOutput,
    sourceEditor: {
      prettifyButton: prettifySourceButton,
      sourceHintsButton,
    },
    editorView: {
      codeModeButton,
      graphModeButton,
      selectionFocusButton,
      codePanel,
      graphPanel,
    },
    previewViewport: {
      canvas,
      viewLabels,
      shaderViewButton,
      meshViewButton,
      layoutViewButton,
      downloadButton,
      surfaceNetButton,
      tetraMeshButton,
      stepsInput,
      stepsOutput,
      gridInput,
      gridOutput,
      previewStat,
      meshStat,
      triangleStat,
      overlay,
    },
    previewBounds: {
      root: boundsEditor,
      fitButton: fitBoundsButton,
      overlay,
    },
    appHealth: {
      selectionFocusButton,
      prettifySourceButton,
      loadSourceButton,
      saveSourceButton,
    },
    browserSession: {
      strip: sessionStrip,
      idLabel: sessionIdLabel,
      copyAgentPromptButton,
      snapshotButton: sessionSnapshotButton,
      status: sessionStatus,
    },
    projectSwitcher: {
      button: projectSwitcherButton,
      nameLabel: projectNameLabel,
      dialog: projectDialog,
      list: projectDialogList,
      closeButton: closeProjectDialogButton,
      newButton: newProjectButton,
      newNameInput: newProjectNameInput,
      searchInput: projectSearchInput,
    },
    graphHistory: {
      undoButton,
      redoButton,
      resetButton,
      journal: graphChangeJournal,
    },
    sourceWorkspace: {
      documentNameInput,
      dirtyIndicator,
      saveButton: saveSourceButton,
    },
    sourceWorkspaceActions: {
      dialog: sourceDialog,
      list: sourceDialogList,
      loadButton: loadSourceButton,
    },
  };
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required app element: ${selector}`);
  return element;
}
