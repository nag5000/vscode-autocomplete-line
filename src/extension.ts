import * as vscode from 'vscode';
import * as path from 'path';
import { rg } from './rg';

import type { AutocompleteContext } from './types/extension';
import type { RipGrepJsonMatch } from './types/rg';

const COMMON_RG_OPTIONS = {
  smartcase: true
};

const QUICK_PICK_ITEM_VALUE = Symbol('value');

declare module 'vscode' {
  export interface QuickPickItem {
    [QUICK_PICK_ITEM_VALUE]?: string
  }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json

  let disposable = vscode.commands.registerCommand(
    'autocomplete-line.autocompleteLine',
    () => commandCallback(false)
  );
  context.subscriptions.push(disposable);

  disposable = vscode.commands.registerCommand(
    'autocomplete-line.autocompleteMultiline',
    () => commandCallback(true)
  );
  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() { }

async function commandCallback(multiline: boolean) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const editorWorkspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  const searchPathRoot = editorWorkspaceFolder?.uri.path || editor.document.uri.path;
  if (!searchPathRoot) {
    return;
  }

  const activeLine = editor.document.lineAt(editor.selection.active.line);
  if (activeLine.isEmptyOrWhitespace) {
    return;
  }

  const searchRange = new vscode.Range(activeLine.range.start, editor.selection.start);
  const searchValue = editor.document.getText(searchRange).trim();
  if (!searchValue) {
    return;
  }

  const quickPick = createQuickPick(multiline);
  quickPick.onDidChangeSelection(selection => {
    const pickedValue = selection[0]?.[QUICK_PICK_ITEM_VALUE];
    if (pickedValue) {
      applyEdit(editor, activeLine, pickedValue);
    }

    quickPick.hide();
  });

  try {
    const autocompleteContext: AutocompleteContext = {
      searchValue,
      searchPathRoot,
      activeEditor: editor,
      activeLine
    };

    const items = multiline
      ? await getAutocompleteMultilineItems(autocompleteContext)
      : await getAutocompleteLineItems(autocompleteContext);

    quickPick.title += ` (${items.length} result${items.length === 1 ? '' : 's'})`;
    quickPick.busy = false;

    if (items.length > 1) {
      quickPick.items = items;
      quickPick.show();
    } else if (items.length === 1) {
      quickPick.hide();
      const value = items[0][QUICK_PICK_ITEM_VALUE];
      if (value) {
        applyEdit(editor, activeLine, value);
      }
    } else if (items.length === 0) {
      quickPick.items = [{ label: '$(circle-slash) No results found' }];
      quickPick.show();
    }
  } catch (err) {
    const errMsg = String(err);
    quickPick.busy = false;
    quickPick.items = [{ label: '$(error) Error', detail: errMsg }];
    quickPick.show();

    vscode.window.showErrorMessage(errMsg);
    console.error(errMsg);
  }
}

async function getAutocompleteLineItems(autocompleteContext: AutocompleteContext) {
  const { searchValue, searchPathRoot, activeEditor, activeLine } = autocompleteContext;
  const regex = getAutocompleteRegex(searchValue);
  const rgResults = await rg(searchPathRoot, {
    ...COMMON_RG_OPTIONS,
    regex
  });

  const results = rgResults
    .filter((jsonLine) => jsonLine.type === 'match')
    .map((jsonLine) => jsonLine.data);

  const currentLineInfo = {
    filePath: activeEditor.document.uri.path,
    lineNumber: activeLine.lineNumber
  };
  const existedValues = new Set<string>([searchValue]);
  const items: vscode.QuickPickItem[] = [];

  results.forEach(result => {
    if (
      result.path.text === currentLineInfo.filePath
      && (result.line_number - 1) === currentLineInfo.lineNumber
    ) {
      return;
    }

    const str = result.lines.text.trim();
    if (existedValues.has(str)) {
      return;
    }

    const item = getQuickPickItem(str, str, result, autocompleteContext);
    items.push(item);
    existedValues.add(str);
  });

  return items;
}

async function getAutocompleteMultilineItems(autocompleteContext: AutocompleteContext) {
  const { searchValue, searchPathRoot, activeEditor, activeLine } = autocompleteContext;
  const regex = getAutocompleteRegex(searchValue);
  const rgResults = await rg(searchPathRoot, {
    ...COMMON_RG_OPTIONS,
    regex,
    beforeContext: 9999,
    afterContext: 100
  });

  const fileContents = new Map<string, string[]>();
  let beginIndex = 0;
  let endIndex = 0;

  rgResults.forEach((jsonLine, index) => {
    if (jsonLine.type === 'begin') {
      beginIndex = index;
    } else if (jsonLine.type === 'end') {
      endIndex = index;

      const contentLines = rgResults.slice(beginIndex + 1, endIndex);
      const content = contentLines
        .map(line => line.data.lines.text)
        .join('')
        .split(/\r?\n/);
      fileContents.set(jsonLine.data.path.text, content);
    }
  });

  const results = rgResults
    .filter((jsonLine) => jsonLine.type === 'match')
    .map((jsonLine) => jsonLine.data);

  const currentLineInfo = {
    filePath: activeEditor.document.uri.path,
    lineNumber: activeLine.lineNumber
  };
  const existedValues = new Set<string>();
  const items: vscode.QuickPickItem[] = [];

  results.forEach(result => {
    if (
      result.path.text === currentLineInfo.filePath
      && (result.line_number - 1) === currentLineInfo.lineNumber
    ) {
      return;
    }

    const content = fileContents.get(result.path.text) || [];
    let lines = content.slice(result.line_number - 1);

    const firstLine = lines[0];
    const indent = firstLine.match('^[ \t]*')?.[0].length || 0;
    const sameIndentRegex = new RegExp(`^[ \t]{${indent}}[^ \t]`);

    let strategy = 'same-indent';
    if (firstLine.trimStart().startsWith('<')) {
      strategy = 'same-indent-tag-close';
    }

    let endLineIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];

      if (strategy === 'same-indent') {
        const isSameIndent = sameIndentRegex.test(line);

        if (isSameIndent && i === 1 && line.trim() !== '') {
          strategy = 'empty-line';
          continue;
        }

        if (!isSameIndent) {
          continue;
        }

        endLineIndex = i;
        break;
      } else if (strategy === 'same-indent-tag-close') {
        const isSameIndent = sameIndentRegex.test(line);
        if (!isSameIndent) {
          continue;
        }

        const isTagClose = line.trimStart().startsWith('</');
        if (!isTagClose) {
          continue;
        }

        endLineIndex = i;
        break;
      } else if (strategy === 'empty-line') {
        const isEmptyLine = line.trim() === '';
        if (!isEmptyLine) {
          continue;
        }

        endLineIndex = i - 1;
        break;
      }
    }

    if (endLineIndex === -1) {
      return;
    }

    lines = lines.slice(0, endLineIndex + 1);
    const trimExtraIndentRegex = new RegExp(`^[ \t]{${indent}}`);
    lines = lines.map(line => line.replace(trimExtraIndentRegex, ''));
    const str = lines.join('\n');

    if (existedValues.has(str)) {
      return;
    }

    const item = getQuickPickItem(str, str, result, autocompleteContext);
    items.push(item);
    existedValues.add(str);
  });

  return items;
}

function createQuickPick(multiline: boolean) {
  let quickPickShowDelayId: any = null;
  let shown = false;

  const quickPick = vscode.window.createQuickPick();
  quickPick.title = `Autocomplete ${multiline ? 'multiline' : 'line'}`;
  quickPick.placeholder = 'Type to filter results';
  quickPick.items = [{ label: 'Loading...' }];
  quickPick.busy = true;
  //quickPick.ignoreFocusOut = true;

  const dispose = () => {
    clearTimeout(quickPickShowDelayId);
    quickPick.dispose();
  };

  quickPick.onDidHide(dispose);

  const hide = quickPick.hide;
  quickPick.hide = function() {
    clearTimeout(quickPickShowDelayId);
    return shown ? hide.call(this) : dispose();
  };

  const show = quickPick.show;
  quickPick.show = function() {
    clearTimeout(quickPickShowDelayId);
    return show.call(this);
  };

  quickPickShowDelayId = setTimeout(() => {
    quickPick.show();
    shown = true;
  }, 500);

  return quickPick;
}

function applyEdit(editor: vscode.TextEditor, line: vscode.TextLine, value: string) {
  const lines = value.split(/\r?\n/);
  const indentChar = editor.options.insertSpaces ? ' ' : '\t';
  const extraIndent = indentChar.repeat(line.firstNonWhitespaceCharacterIndex);
  const eolSeq = editor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  value = lines.map(line => extraIndent + line).join(eolSeq);

  editor.edit(edit => edit.replace(line.range, value)).then(success => {
    if (success) {
      const activeLine = editor.document.lineAt(editor.selection.active.line);
      const end = activeLine.range.end;
      editor.selection = new vscode.Selection(end, end);
    }
  });
}

//function convertIndentation(str: string, indentChar: string) {
//  return str.replace(/^[ \t]*/, match => indentChar.repeat(match.length));
//}

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#Escaping
function escapeRegexp(str: string) {
  return str.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function getAutocompleteRegex(searchValue: string) {
  return `'^[ \t]*${escapeRegexp(searchValue)}'`;
}

function getQuickPickItem(
  label: string,
  value: string,
  result: RipGrepJsonMatch['data'],
  autocompleteItemsContext: AutocompleteContext
): vscode.QuickPickItem {
  return {
    label,
    detail: path.relative(autocompleteItemsContext.searchPathRoot, result.path.text)
      + `:${result.line_number}`,
    //description: 'foobar',
    [QUICK_PICK_ITEM_VALUE]: value
  };
}
