export interface PythonEnvironmentCandidate {
  id: string;
  label: string;
  value: string;
  source: "manual" | "vscode" | "local" | "conda-file" | "conda-list" | "terminal";
  detail: string;
}

export interface ConfiguredPythonInterpreter {
  path: string;
  label: string;
}

export interface LocalPythonInterpreter {
  path: string;
  label: string;
}

export interface DeclaredCondaEnvironment {
  name: string;
  filePath: string;
}

export interface PythonProjectRunner {
  command: "uv" | "poetry" | "pipenv";
  argsPrefix: string[];
  label: string;
  filePath: string;
}
