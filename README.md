# vnerdtree
A [split file explorer][oil-and-vinegar] for vscode, inspired by vsnetrw, NERDTree, [netrw][netrw], [vim-vinegar][vinegar], [dired][dired], [vim-dirvish][dirvish], and [NERDTree][nerdtree].

## Features

- **Git status indicators**: Shows Git status (M=Modified, A=Added, D=Deleted, U=Untracked) next to file names, matching VSCode's explorer behavior
- **Full paths toggle**: Toggle between showing just file names or full paths with <kbd>Shift+P</kbd>
- **Cursor position memory**: Automatically saves and restores cursor position per directory
- **Initial directory navigation**: Jump back to the first directory you opened with <kbd>.</kbd>
- **Bookmarks**: Save and quickly navigate to frequently used directories (similar to NerdTree)
- **Help system**: Toggle a help overlay showing all available shortcuts with <kbd>Shift+H</kbd>
- **Hidden files toggle**: Show or hide hidden files and directories with <kbd>I</kbd>
- **File manager integration**: Open current directory in Finder/Explorer with <kbd>o</kbd>
- **Smart keybindings**: Won't interfere when typing in search boxes or input fields

## Shortcuts

Use `vnerdtree.open` (or press <kbd>-</kbd> when no editor is active) to open a file explorer. The explorer will open at the parent directory of the currently active text editor, or the workspace root if no file is open.

### Opening and Closing

| Default Shortcut | Command | Description |
| ---------------- | ------- | ----------- |
| <kbd>-</kbd> | `vnerdtree.open` | Open explorer (when no editor active) or close it (when explorer is active) |
| <kbd>-</kbd> | `vnerdtree.close` | Close the explorer (when inside explorer) |

### Navigation

| Default Shortcut | Command | Description |
| ---------------- | ------- | ----------- |
| <kbd>enter</kbd> | `vnerdtree.openAtCursor` | Open the file or directory under the cursor |
| <kbd>backspace</kbd> | `vnerdtree.openParent` | Jump to the parent directory |
| <kbd>.</kbd> | `vnerdtree.openInitial` | Jump back to the initial directory where you first opened the explorer |
| <kbd>~</kbd> | `vnerdtree.openHome` | Jump to the root of the current workspace folder, or user's homedir |
| <kbd>o</kbd> | `vnerdtree.revealInFileManager` | Open the current directory in Finder (macOS), Explorer (Windows), or file manager (Linux) |

### File Operations

| Default Shortcut | Command | Description |
| ---------------- | ------- | ----------- |
| <kbd>R</kbd> | `vnerdtree.rename` | Rename the file or directory under the cursor |
| <kbd>%</kbd> | `vnerdtree.create` | Create a new file or directory (and any intermediate directories) |
| <kbd>d</kbd> | `vnerdtree.createDir` | Create a new directory (and any intermediate ones) |
| <kbd>D</kbd> | `vnerdtree.delete` | Delete the file or directory under the cursor |
| <kbd>delete</kbd> | `vnerdtree.delete` | Delete the file or directory under the cursor |

### View Options

| Default Shortcut | Command | Description |
| ---------------- | ------- | ----------- |
| <kbd>Shift+P</kbd> | `vnerdtree.toggleFullPaths` | Toggle between showing file names only or full paths |
| <kbd>I</kbd> | `vnerdtree.toggleHidden` | Toggle visibility of hidden files and directories |
| <kbd>Shift+H</kbd> | `vnerdtree.toggleHelp` | Toggle help overlay showing all available shortcuts |
| <kbd>ctrl+l</kbd> | `vnerdtree.refresh` | Refresh the directory listing |

### Bookmarks

| Default Shortcut | Command | Description |
| ---------------- | ------- | ----------- |
| <kbd>m</kbd> | `vnerdtree.addBookmark` | Add a bookmark for the current directory (or delete if cursor is on a bookmark line) |
| <kbd>Shift+M</kbd> | `vnerdtree.deleteBookmark` | Delete the bookmark on the current line |
| <kbd>b</kbd> | `vnerdtree.jumpToBookmark` | Jump to a bookmark (shows quick pick menu) |
| <kbd>Shift+B</kbd> | `vnerdtree.toggleBookmarks` | Toggle visibility of bookmarks in the listing |

## VSCodeVim Keybindings
To make `-` open an explorer from any file (like `vim-vinegar`) add the following binding to your `vim.normalModeKeyBindings`.

```json
{
  "before": ["-"],
  "commands": ["vnerdtree.open"],
  "when": "editorLangId != vnerdtree"
}
```