// Foo
let assert = require("node:assert");
let path = require("node:path");
let { homedir, platform } = require("node:os");
let { spawn } = require("node:child_process");
let {
  window,
  workspace,
  commands,
  Uri,
  EventEmitter,
  FileType,
  Selection,
  languages,
  Range,
  Diagnostic,
  DiagnosticRelatedInformation,
  Location,
  ViewColumn,
  TextEditorRevealType,
  extensions,
} = require("vscode");

/**
 * The scheme is used to associate vsnetrw documents with the text content provider
 * that renders the directory listing.
 */
const scheme = "vsnetrw";

/**
 * The editorLanguageId used to identify vsnetrw buffers.
 */
const languageId = "vsnetrw";

/**
 * The path to the file that was open before the current explorer.
 */
let previousFilePath = "";

/**
 * Map of directory URIs to their last cursor line position.
 */
let cursorPositions = new Map();

/**
 * The initial directory where the explorer was first opened in this session.
 * @type {string | null}
 */
let initialDirectory = null;

/**
 * Whether to show full paths instead of just file names.
 */
let showFullPaths = false;

/**
 * Whether to show bookmarks in the listing.
 */
let showBookmarks = true;

/**
 * Whether to show help text at the top.
 */
let showHelp = false;

/**
 * Whether to show hidden files and directories.
 */
let showHidden = true;

/**
 * Extension context for global state storage.
 * @type {import("vscode").ExtensionContext | null}
 */
let extensionContext = null;

/**
 * Bookmarks storage: map of bookmark keys (letters/names) to paths.
 * @type {Map<string, string>}
 */
let bookmarks = new Map();

/**
 * Creates a vsnetrw document uri for a given path.
 *
 * @param {string} dirName The directory to open
 * @returns {Uri} The path as a Uri
 */
function createUri(dirName) {
  return Uri.from({ scheme, path: dirName });
}

/**
 * Get the current directory from the current document's Uri.
 * @returns The path to the directory that is open in the current vsnetrw document.
 */
function getCurrentDir() {
  let editor = window.activeTextEditor;
  assert(
    editor && editor.document.uri.scheme === scheme,
    "Not a vsnetrw editor"
  );
  return editor.document.uri.path;
}

/**
 * Event emitter used to trigger updates for the text document content provider.
 */
let uriChangeEmitter = new EventEmitter();

/**
 * Save the current cursor position for the active vsnetrw document.
 */
function saveCursorPosition() {
  let editor = window.activeTextEditor;
  if (editor?.document.uri.scheme === scheme) {
    let uri = editor.document.uri.toString();
    let line = editor.selection.active.line;
    cursorPositions.set(uri, line);
  }
}

/**
 * Refresh the current vsnetrw document.
 */
function refresh() {
  let dir = getCurrentDir();
  let uri = createUri(dir);
  uriChangeEmitter.fire(uri);
  refreshDiagnostics();
}

/**
 * Toggle between showing full paths and just file names.
 */
function toggleFullPaths() {
  showFullPaths = !showFullPaths;
  refresh();
}

/**
 * Toggle visibility of bookmarks in the listing.
 */
function toggleBookmarks() {
  showBookmarks = !showBookmarks;
  refresh();
}

/**
 * Toggle visibility of help text.
 */
function toggleHelp() {
  showHelp = !showHelp;
  refresh();
}

/**
 * Toggle visibility of hidden files and directories.
 */
function toggleHidden() {
  showHidden = !showHidden;
  refresh();
}

/**
 * @param {string} prompt
 * @returns {Promise<boolean>}
 */
function confirm(prompt) {
  return new Promise((resolve) => {
    let inputBox = window.createInputBox();
    let resolveOnHide = true;
    inputBox.validationMessage = `${prompt} (y or n)`;

    let onChange = inputBox.onDidChangeValue((text) => {
      let ch = text[0].toLowerCase();
      if (ch === "y") {
        resolve(true);
        resolveOnHide = false;
        inputBox.hide();
      } else if (ch === "n" || "q") {
        inputBox.hide();
      }
    });

    let onHide = inputBox.onDidHide(() => {
      inputBox.dispose();
      onChange.dispose();
      onHide.dispose();
      if (resolveOnHide) {
        resolve(false);
      }
    });

    inputBox.show();
  });
}

function moveCursorToPreviousFile() {
  let editor = window.activeTextEditor;
  if (!editor) return;
  let dir = getCurrentDir();
  let files = editor.document.getText().split("\n");

  let index = files.findIndex(
    (file) =>
      path.join(dir, file) === previousFilePath ||
      path.join(dir, file) === `${previousFilePath}/`
  );

  if (index >= 0) {
    editor.selections = [new Selection(index, 0, index, 0)];
  }
}

/**
 * Open a new vsnetrw document for a given directory.
 * @param {string} dirName
 */
async function openExplorer(dirName) {
  let editor = window.activeTextEditor;

  if (editor) {
    previousFilePath = editor.document.uri.fsPath;
  }

  let uri = createUri(dirName);
  let uriString = uri.toString();
  let doc = await workspace.openTextDocument(uri);
  await languages.setTextDocumentLanguage(doc, languageId);
  let newEditor = await window.showTextDocument(doc, { preview: true });

  // Restore saved cursor position if available
  let savedLine = cursorPositions.get(uriString);
  if (savedLine !== undefined && savedLine >= 0) {
    setTimeout(() => {
      if (newEditor && newEditor.document.uri.toString() === uriString) {
        let lineCount = newEditor.document.lineCount;
        let line = Math.min(savedLine, lineCount - 1);
        newEditor.selections = [new Selection(line, 0, line, 0)];
        newEditor.revealRange(
          new Range(line, 0, line, 0),
          TextEditorRevealType.InCenter
        );
      }
    }, 0);
  }
}

/**
 * Checks whether a file exists.
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function doesFileExist(file) {
  try {
    let uri = Uri.file(file);
    await workspace.fs.stat(uri);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Checks whether a file exists.
 * @param {string} file
 * @returns {Promise<FileType | undefined>}
 */
async function getFileType(file) {
  let uri = Uri.file(file);
  try {
    let stat = await workspace.fs.stat(uri);
    return stat.type;
  } catch (err) {
    return undefined;
  }
}

/**
 * Gets the file path from a line text, handling both relative names and full paths.
 * @param {string} lineText The text of the line
 * @param {string} baseDir The base directory
 * @returns {string} The full path to the file
 */
function getFilePathFromLine(lineText, baseDir) {
  // Skip help lines and bookmark separator line
  if (
    lineText === "-- BOOKMARKS --" ||
    lineText.startsWith("vsnetrw") ||
    lineText.includes(": ")
  ) {
    return "";
  }

  // Handle bookmark entries: [key] /path/to/dir/
  let bookmarkMatch = lineText.match(/^\[([^\]]+)\]\s+(.+)$/);
  if (bookmarkMatch) {
    let bookmarkPath = bookmarkMatch[2];
    // Remove trailing slash
    return bookmarkPath.endsWith("/")
      ? bookmarkPath.slice(0, -1)
      : bookmarkPath;
  }

  // Remove Git status suffix if present (e.g., " M", " A", " D", " U", " R", " C")
  let text = lineText.replace(/\s+[MADURC]$/, "");

  // Handle parent directory reference
  if (text === "../") {
    return path.dirname(baseDir);
  }

  // If showing full paths, the line text is already a full path
  if (showFullPaths) {
    // Remove trailing slash for directories
    return text.endsWith("/") ? text.slice(0, -1) : text;
  }

  // Otherwise, it's a relative path
  return path.join(baseDir, text);
}

/**
 * Returns the name of the file under the cursor in the current vsnetrw
 * document.
 * @returns {string}
 */
function getLineUnderCursor() {
  let editor = window.activeTextEditor;
  assert(editor, "No active editor");
  let line = editor.document.lineAt(editor.selection.active);
  return line.text;
}

/**
 * Returns all lines in the active selection.
 * @returns {string[]}
 */
function getLinesUnderCursor() {
  let editor = window.activeTextEditor;
  assert(editor, "No active editor");
  let lines = [];
  for (
    let i = editor.selection.start.line;
    i <= editor.selection.end.line;
    i++
  ) {
    let line = editor.document.lineAt(i);
    lines.push(line.text);
  }
  return lines;
}

/**
 * Opens a file in a vscode editor.
 * @param {string} fileName
 * @param {ViewColumn} [viewColumn]
 */
async function openFileInVscodeEditor(fileName, viewColumn) {
  let uri = Uri.file(fileName);
  await closeExplorer();

  if (viewColumn) {
    await commands.executeCommand("vscode.open", uri, viewColumn);
  } else {
    await commands.executeCommand("vscode.open", uri);
  }
}

/**
 * Close the vsnetrw explorer if it is the active editor.
 */
async function closeExplorer() {
  let editor = window.activeTextEditor;
  if (editor?.document.uri.scheme === scheme) {
    saveCursorPosition();
    await commands.executeCommand("workbench.action.closeActiveEditor");
  }
}

/**
 * Prompts the user to rename the file that is currently under their cursor in
 * a vsnetrw document.
 *
 * If the name includes a path that does not exist, then it will be created.
 */
async function renameFileUnderCursor() {
  let lineText = getLineUnderCursor();
  let base = getCurrentDir();
  let srcPath = getFilePathFromLine(lineText, base);

  // Get display name (just the filename part) for the input box
  let displayName = showFullPaths
    ? path.basename(srcPath)
    : lineText.endsWith("/")
    ? lineText.slice(0, -1)
    : lineText;

  let newName = await window.showInputBox({
    title: "Rename",
    value: displayName,
    placeHolder: "Enter a new filename",
  });

  if (!newName) return;

  let dstPath = showFullPaths
    ? path.join(path.dirname(srcPath), newName)
    : path.join(base, newName);
  let dstFileType = await getFileType(dstPath);

  // Treat renames like "a.txt -> ../" as "a.txt -> ../a.txt"
  if (dstFileType === FileType.Directory) {
    dstPath = path.join(dstPath, path.basename(srcPath));
    dstFileType = await getFileType(dstPath);
  }

  if (dstFileType === FileType.Directory) {
    window.showErrorMessage(`Can't replace directory: ${dstPath}`);
    return;
  }

  if (dstFileType != undefined) {
    let ok = await confirm("Overwrite existing file?");
    if (!ok) return;
  }

  let srcUri = Uri.file(srcPath);
  let dstUri = Uri.file(dstPath);
  await workspace.fs.rename(srcUri, dstUri, { overwrite: true });
  refresh();
}

/**
 * Attempt to delete the file that is under the cursor in a vsnetrw document.
 */
async function deleteFileUnderCursor() {
  let files = getLinesUnderCursor();
  let base = getCurrentDir();

  // Never allow the user to accidentally delete the parent dir
  files = files.filter((file) => file !== "../");

  let ok = await confirm(
    files.length === 1
      ? `Confirm deletion of ${files[0]}`
      : `Confirm deletion of ${files.length} files`
  );

  if (!ok) return;

  for (let file of files) {
    let pathToFile = path.join(base, file);
    let uri = Uri.file(pathToFile);
    await workspace.fs.delete(uri, { recursive: true, useTrash: true });
  }

  refresh();
}

/**
 * Prompt the user to create a new file. If the name of the new file ends with a slash,
 * a directory will be created instead.
 *
 * If the file includes a path that does not exist, then the path will be created.
 */
async function createFile() {
  let base = getCurrentDir();

  let newFileName = await window.showInputBox({
    title: "Create New File / Directory",
    placeHolder: "Enter a name for the new file",
  });

  if (newFileName == null) return;
  let pathToFile = path.join(base, newFileName);
  let uri = Uri.file(pathToFile);

  // Ignore if the file already exists
  if (await doesFileExist(pathToFile)) return;

  if (newFileName.endsWith("/")) {
    await workspace.fs.createDirectory(uri);
    refresh();
  } else {
    await workspace.fs.writeFile(uri, new Uint8Array());
    await openFileInVscodeEditor(uri.fsPath);
  }
}

/**
 * Prompt the user to create a new directory. Intermediate directories that
 * don't exist will be created too.
 */
async function createDir() {
  let base = getCurrentDir();

  let newFileName = await window.showInputBox({
    title: "Create New Directory",
    placeHolder: "Enter a name for the new directory",
  });

  if (newFileName == null) return;
  let pathToDir = path.join(base, newFileName);
  let uri = Uri.file(pathToDir);
  await workspace.fs.createDirectory(uri);
  refresh();
}

/**
 * @returns {string}
 */
function getInitialDir() {
  let editor = window.activeTextEditor;

  if (editor && !editor.document.isUntitled) {
    return path.dirname(editor.document.uri.fsPath);
  } else if (workspace.workspaceFolders) {
    let folder = workspace.workspaceFolders[0];
    return folder.uri.fsPath;
  } else {
    return homedir();
  }
}

/**
 * Opens a new explorer editor or closes it if already open.
 */
async function openNewExplorer(dir = getInitialDir()) {
  // For some reason vim.normalModeKeyBindings pass an empty array
  if (Array.isArray(dir)) dir = getInitialDir();

  // If vsnetrw is already open, close it
  let editor = window.activeTextEditor;
  if (editor?.document.uri.scheme === scheme) {
    await closeExplorer();
    return;
  }

  // Save initial directory if this is the first time opening in this session
  if (initialDirectory === null) {
    initialDirectory = dir;
  }

  // Otherwise open it
  await openExplorer(dir);
}

/**
 * Attempt to open the file that is currently under the cursor.
 *
 * If there is a file under the cursor, it will open in a vscode text
 * editor. If there is a directory under the cursor, then it will open in a
 * new vsnetrw document.
 * @param {ViewColumn} [viewColumn]
 */
async function openFileUnderCursor(viewColumn) {
  let lineText = getLineUnderCursor();

  // Check if it's a bookmark entry
  let bookmarkMatch = lineText.match(/^\[([^\]]+)\]/);
  if (bookmarkMatch) {
    // Navigate to bookmark
    await jumpToBookmark(bookmarkMatch[1]);
    return;
  }

  let basePath = getCurrentDir();
  let newPath = getFilePathFromLine(lineText, basePath);
  let uri = Uri.file(newPath);
  let stat = await workspace.fs.stat(uri);

  if (stat.type & FileType.Directory) {
    saveCursorPosition();
    await openExplorer(newPath);
  } else {
    await openFileInVscodeEditor(newPath, viewColumn);
  }
}

async function openFileUnderCursorInHorizontalSplit() {
  await openFileUnderCursor(ViewColumn.Beside);
}

async function openFileUnderCursorInVerticalSplit() {
  await openFileUnderCursor(ViewColumn.Beside);
  // saving the reference
  // toggling the editor layout (vertical split) will make the editor lose focus
  const lastActiveEditor = window.activeTextEditor;
  await commands.executeCommand("workbench.action.toggleEditorGroupLayout");
  if (lastActiveEditor) {
    // focus the editor again
    await window.showTextDocument(lastActiveEditor.document);
  }
}

/**
 * Opens the parent directory in a vsnetrw document.
 */
async function openParentDirectory() {
  let editor = window.activeTextEditor;
  assert(editor, "No active editor");
  saveCursorPosition();
  let pathName = editor.document.uri.path;
  let parentPath = path.dirname(pathName);
  openExplorer(parentPath);
}

/**
 * Opens the home directory in a vsnetrw document. If there's an active workspace folder
 * it will be used, otherwise the user's home directory is used.
 */
async function openHomeDirectory() {
  let folder = homedir();
  let editor = window.activeTextEditor;

  if (editor) {
    saveCursorPosition();
    let workspaceFolder =
      workspace.getWorkspaceFolder(editor.document.uri) ||
      workspace.workspaceFolders?.[0];

    if (workspaceFolder) {
      folder = workspaceFolder.uri.fsPath;
    }
  }

  openExplorer(folder);
}

/**
 * Opens the initial directory where the explorer was first opened.
 */
async function openInitialDirectory() {
  if (initialDirectory === null) {
    // If no initial directory was saved, use the current directory or home
    let dir = getInitialDir();
    // Also save it as the initial directory for future use
    initialDirectory = dir;
    openExplorer(dir);
  } else {
    saveCursorPosition();
    openExplorer(initialDirectory);
  }
}

/**
 * Load bookmarks from global state.
 */
function loadBookmarks() {
  if (!extensionContext) return;

  let savedBookmarks = extensionContext.globalState.get(
    "vsnetrw.bookmarks",
    {}
  );
  bookmarks.clear();
  for (let [key, bookmarkPath] of Object.entries(
    /** @type {Record<string, string>} */ (savedBookmarks)
  )) {
    bookmarks.set(key, bookmarkPath);
  }
}

/**
 * Save bookmarks to global state.
 */
async function saveBookmarks() {
  if (!extensionContext) return;

  /** @type {Record<string, string>} */
  let bookmarksObj = {};
  for (let [key, bookmarkPath] of bookmarks.entries()) {
    bookmarksObj[key] = bookmarkPath;
  }
  await extensionContext.globalState.update("vsnetrw.bookmarks", bookmarksObj);
}

/**
 * Add a bookmark.
 * @param {string} key The bookmark key (letter or name)
 * @param {string} bookmarkPath The path to bookmark
 */
async function addBookmark(key, bookmarkPath) {
  bookmarks.set(key, bookmarkPath);
  await saveBookmarks();
}

/**
 * Delete a bookmark.
 * @param {string} key The bookmark key to delete
 */
async function deleteBookmark(key) {
  bookmarks.delete(key);
  await saveBookmarks();
}

/**
 * Get all bookmarks.
 * @returns {Map<string, string>} Map of bookmark keys to paths
 */
function getBookmarks() {
  return bookmarks;
}

/**
 * Jump to a bookmark.
 * @param {string} key The bookmark key to jump to
 */
async function jumpToBookmark(key) {
  let bookmarkPath = bookmarks.get(key);
  if (bookmarkPath) {
    saveCursorPosition();
    await openExplorer(bookmarkPath);
  } else {
    window.showWarningMessage(`Bookmark "${key}" not found`);
  }
}

/**
 * Opens the current directory in Finder (macOS) or File Explorer (Windows/Linux).
 */
async function revealInFileManager() {
  let dir = getCurrentDir();

  try {
    if (platform() === "darwin") {
      // macOS: use 'open' command
      spawn("open", [dir], { detached: true });
    } else if (platform() === "win32") {
      // Windows: use 'explorer' command
      spawn("explorer", [dir], { detached: true });
    } else {
      // Linux: try 'xdg-open'
      spawn("xdg-open", [dir], { detached: true });
    }
  } catch (err) {
    window.showErrorMessage(`Failed to open file manager: ${err.message}`);
  }
}

/**
 * Gets Git status symbol for a file or directory.
 * @param {Uri} fileUri The URI of the file/directory
 * @param {string} baseDir The base directory of the explorer
 * @returns {Promise<string>} Git status symbol (M, A, D, U, etc.) or empty string
 */
async function getGitStatus(fileUri, baseDir) {
  try {
    let gitExtension = extensions.getExtension("vscode.git");
    if (!gitExtension || !gitExtension.isActive) {
      return "";
    }

    let git = gitExtension.exports;
    if (!git || !git.getAPI) {
      return "";
    }

    let gitApi = git.getAPI(1);
    if (!gitApi) {
      return "";
    }

    let repository = gitApi.getRepository(fileUri);
    if (!repository) {
      return "";
    }

    let filePath = fileUri.fsPath;

    // Check index changes (staged) first, as staged takes priority
    let indexChange = repository.state.indexChanges.find(
      (/** @type {any} */ change) => {
        return change.uri.fsPath === filePath;
      }
    );

    if (indexChange) {
      // Status values: 1=Modified, 2=Added, 3=Deleted, 5=Renamed, 6=Copied
      let status = indexChange.status;
      if (status === 1 || status === 5 || status === 6) return "M"; // Modified, Renamed, or Copied (VSCode shows M for all)
      if (status === 2) return "A"; // Added
      if (status === 3) return "D"; // Deleted
    }

    // Check working tree changes (unstaged)
    let workingTreeChange = repository.state.workingTreeChanges.find(
      (/** @type {any} */ change) => {
        return change.uri.fsPath === filePath;
      }
    );

    if (workingTreeChange) {
      // Status values: 1=Modified, 2=Added, 3=Deleted, 4=Untracked, 5=Renamed, 6=Copied
      // VSCode shows M for Modified, Renamed, and Copied files
      let status = workingTreeChange.status;
      if (status === 1 || status === 5 || status === 6) return "M"; // Modified, Renamed, or Copied
      if (status === 2) return "A"; // Added
      if (status === 3) return "D"; // Deleted
      if (status === 4) return "U"; // Untracked
    }

    return "";
  } catch (err) {
    return "";
  }
}

/**
 * Renders the text content for the current vsnetrw document.
 * @param {Uri} documentUri
 * @returns {Promise<string>}
 */
async function provideTextDocumentContent(documentUri) {
  let pathName = documentUri.path;
  let pathUri = Uri.file(pathName);
  let results = await workspace.fs.readDirectory(pathUri);

  // Filter hidden files if showHidden is false
  if (!showHidden) {
    results = results.filter(([name, type]) => !name.startsWith("."));
  }

  results.sort(([aName, aType], [bName, bType]) => {
    return aType & FileType.Directory
      ? bType & FileType.Directory
        ? 0
        : -1
      : aName < bName
      ? -1
      : 1;
  });

  let listings = await Promise.all(
    results.map(async ([name, type]) => {
      let filePath = path.join(pathName, name);
      let fileUri = Uri.file(filePath);
      let gitStatus = await getGitStatus(fileUri, pathName);

      let fileName = showFullPaths
        ? type & FileType.Directory
          ? `${filePath}/`
          : filePath
        : type & FileType.Directory
        ? `${name}/`
        : name;

      return gitStatus ? `${fileName} ${gitStatus}` : fileName;
    })
  );

  let hasParent = path.dirname(pathName) !== pathName;
  if (hasParent) listings.unshift("../");

  // Add help text at the beginning if enabled
  if (showHelp) {
    let helpText = [
      "////////////////////",
      "// Olivo Explorer //",
      "////////////////////",
      "-: close",
      "o: open in finder",
      ".: back to root",
      "b: bookmarks",
      "shift+b: toggle bookmarks",
      "m: add bookmark",
      "shift+m: delete bookmark",
      "r: rename",
      "%: create",
      "d: create dir",
      "D/delete: delete",
      "shift+p: toggle full paths",
      "ctrl+l: refresh",
    ];
    listings.unshift(...helpText);
  }

  // Add bookmarks at the end if enabled
  if (showBookmarks && bookmarks.size > 0) {
    // Sort bookmarks by key for consistent display
    let sortedBookmarks = Array.from(bookmarks.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
    let bookmarkListings = sortedBookmarks.map(
      ([key, bookmarkPath]) => `[${key}] ${bookmarkPath}/`
    );
    listings.push("-- BOOKMARKS --");
    listings.push(...bookmarkListings);
  }

  return listings.join("\n");
}

/**
 * @type {import("vscode").TextDocumentContentProvider}
 */
let contentProvider = {
  onDidChange: uriChangeEmitter.event,
  provideTextDocumentContent,
};

let diagnostics = languages.createDiagnosticCollection("vsnetrw");

/**
 * Propagate diagnostics in files up to the explorer.
 */
function refreshDiagnostics() {
  assert(window.activeTextEditor);

  let document = window.activeTextEditor.document;
  let base = getCurrentDir();

  let uris = document
    .getText()
    .split("\n")
    .map((name) => {
      let pathToFile = path.join(base, name);
      return Uri.file(pathToFile);
    });

  let ownDiagnostics = uris.flatMap((uri, line) => {
    let childDiagnostics = languages.getDiagnostics(uri);
    if (childDiagnostics.length === 0) return [];

    let severities = childDiagnostics.map((diagnostic) => diagnostic.severity);
    let severity = Math.min(...severities);
    let name = path.basename(uri.fsPath);
    let range = new Range(line, 0, line, name.length);

    let diagnostic = new Diagnostic(
      range,
      `${childDiagnostics.length} problems in this file`,
      severity
    );

    diagnostic.relatedInformation = childDiagnostics.map((childDiagnostic) => {
      return new DiagnosticRelatedInformation(
        new Location(uri, childDiagnostic.range),
        childDiagnostic.message
      );
    });

    return diagnostic;
  });

  diagnostics.set(document.uri, ownDiagnostics);
}

/**
 * @param {import("vscode").TextEditor | undefined} editor
 */
function onChangeActiveTextEditor(editor) {
  if (editor?.document.uri.scheme === scheme) {
    refresh();
  }
}

/**
 * Add a bookmark for the current directory or file under cursor.
 * @param {string | undefined} [key] Optional bookmark key (letter). If not provided, prompts for key or uses directory/file name.
 */
async function addBookmarkCommand(/** @type {string | undefined} */ key) {
  let editor = window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== scheme) {
    window.showWarningMessage(
      "Bookmarks can only be added from within the explorer"
    );
    return;
  }

  let bookmarkPath;
  let lineText = getLineUnderCursor();

  // Check if it's a bookmark entry - if so, delete it instead
  let bookmarkMatch = lineText.match(/^\[([^\]]+)\]/);
  if (bookmarkMatch) {
    // User is on a bookmark line, delete it
    await deleteBookmark(bookmarkMatch[1]);
    window.showInformationMessage(`Bookmark "${bookmarkMatch[1]}" deleted`);
    refresh();
    return;
  }

  // Get the path from the current line
  let baseDir = getCurrentDir();
  bookmarkPath = getFilePathFromLine(lineText, baseDir);

  // Check if it's a directory or file
  let fileType = await getFileType(bookmarkPath);
  if (!fileType) {
    window.showErrorMessage(`Path does not exist: ${bookmarkPath}`);
    return;
  }

  // If it's a file, use its parent directory
  if (!(fileType & FileType.Directory)) {
    bookmarkPath = path.dirname(bookmarkPath);
  }

  // If key not provided, prompt for it or use basename
  if (!key) {
    key = await window.showInputBox({
      prompt:
        "Enter bookmark key (letter or name). Leave empty to use directory name.",
      placeHolder: path.basename(bookmarkPath),
    });

    if (key === undefined) {
      return; // User cancelled
    }

    if (!key) {
      key = path.basename(bookmarkPath);
    }
  }

  // Check if bookmark already exists
  if (bookmarks.has(key)) {
    let overwrite = await window.showWarningMessage(
      `Bookmark "${key}" already exists. Overwrite?`,
      { modal: true },
      "Overwrite"
    );
    if (!overwrite) {
      return;
    }
  }

  await addBookmark(key, bookmarkPath);
  window.showInformationMessage(`Bookmark "${key}" added: ${bookmarkPath}`);
  refresh();
}

/**
 * Delete a bookmark.
 */
async function deleteBookmarkCommand() {
  let editor = window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== scheme) {
    window.showWarningMessage(
      "Bookmarks can only be deleted from within the explorer"
    );
    return;
  }

  let lineText = getLineUnderCursor();
  let bookmarkMatch = lineText.match(/^\[([^\]]+)\]/);

  if (!bookmarkMatch) {
    window.showWarningMessage("Cursor must be on a bookmark line");
    return;
  }

  let key = bookmarkMatch[1];
  await deleteBookmark(key);
  window.showInformationMessage(`Bookmark "${key}" deleted`);
  refresh();
}

/**
 * Jump to a bookmark by key.
 * @param {string | undefined} [key] Optional bookmark key. If not provided, shows quick pick.
 */
async function jumpToBookmarkCommand(/** @type {string | undefined} */ key) {
  if (!key) {
    // Show quick pick to select bookmark
    if (bookmarks.size === 0) {
      window.showWarningMessage("No bookmarks available");
      return;
    }

    let items = Array.from(bookmarks.entries()).map(([k, p]) => ({
      label: `[${k}]`,
      description: p,
      key: k,
    }));

    let selected = await window.showQuickPick(items, {
      placeHolder: "Select bookmark to jump to",
    });

    if (selected) {
      await jumpToBookmark(selected.key);
    }
  } else {
    await jumpToBookmark(key);
  }
}

/**
 * @param {import("vscode").ExtensionContext} context
 */
function activate(context) {
  extensionContext = context;
  loadBookmarks();

  context.subscriptions.push(
    workspace.registerTextDocumentContentProvider(scheme, contentProvider)
  );

  context.subscriptions.push(
    window.onDidChangeActiveTextEditor(onChangeActiveTextEditor)
  );

  context.subscriptions.push(
    commands.registerCommand("vsnetrw.open", openNewExplorer),
    commands.registerCommand("vsnetrw.openAtCursor", openFileUnderCursor),
    commands.registerCommand(
      "vsnetrw.openAtCursorInHorizontalSplit",
      openFileUnderCursorInHorizontalSplit
    ),
    commands.registerCommand(
      "vsnetrw.openAtCursorInVerticalSplit",
      openFileUnderCursorInVerticalSplit
    ),
    commands.registerCommand("vsnetrw.openParent", openParentDirectory),
    commands.registerCommand("vsnetrw.openHome", openHomeDirectory),
    commands.registerCommand("vsnetrw.openInitial", openInitialDirectory),
    commands.registerCommand(
      "vsnetrw.revealInFileManager",
      revealInFileManager
    ),
    commands.registerCommand("vsnetrw.rename", renameFileUnderCursor),
    commands.registerCommand("vsnetrw.delete", deleteFileUnderCursor),
    commands.registerCommand("vsnetrw.create", createFile),
    commands.registerCommand("vsnetrw.createDir", createDir),
    commands.registerCommand("vsnetrw.refresh", refresh),
    commands.registerCommand("vsnetrw.close", closeExplorer),
    commands.registerCommand("vsnetrw.toggleFullPaths", toggleFullPaths),
    commands.registerCommand("vsnetrw.toggleBookmarks", toggleBookmarks),
    commands.registerCommand("vsnetrw.toggleHelp", toggleHelp),
    commands.registerCommand("vsnetrw.toggleHidden", toggleHidden),
    commands.registerCommand("vsnetrw.addBookmark", addBookmarkCommand),
    commands.registerCommand("vsnetrw.deleteBookmark", deleteBookmarkCommand),
    commands.registerCommand("vsnetrw.jumpToBookmark", jumpToBookmarkCommand)
  );
}

module.exports = { activate };
