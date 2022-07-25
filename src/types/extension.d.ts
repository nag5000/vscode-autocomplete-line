import type * as vscode from 'vscode';

export type AutocompleteContext = {
  searchValue: string,
  searchPathRoot: string,
  activeEditor: vscode.TextEditor,
  activeLine: vscode.TextLine
};
