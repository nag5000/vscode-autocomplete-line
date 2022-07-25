import { exec, ExecException } from 'child_process';
import type { RipGrepOptions, RipGrepJsonMatch } from './types/rg';

export async function rg(cwd: string, options: RipGrepOptions): Promise<Array<RipGrepJsonMatch>> {
  if (!cwd) {
    throw new Error('No `cwd` provided');
  }

  if (arguments.length === 1) {
    throw new Error('No search term provided');
  }

  const args = ['--json'];
  if ('regex' in options) {
    args.push(`-e ${options.regex}`);
  } else if ('string' in options) {
    args.push(`-F ${options.string}`);
  }

  if (options.fileType) {
    if (!Array.isArray(options.fileType)) {
      options.fileType = [options.fileType];
    }

    for (const fileType of options.fileType) {
      args.push(`-t ${fileType}`);
    }
  }

  if (options.multiline) {
    args.push(`--multiline`);
  }

  if (options.passthru) {
    args.push(`--passthru`);
  }

  if (options.beforeContext) {
    args.push(`--before-context=${options.beforeContext}`);
  }

  if (options.afterContext) {
    args.push(`--after-context=${options.afterContext}`);
  }

  // Searches case insensitively if the pattern is all lowercase. Search case sensitively otherwise.
  if (options.smartcase) {
    args.push(`--smart-case`);
  }

  args.push(`-- ${cwd}`);

  const command = `rg ${args.join(' ')}`;

  return new Promise(function (resolve, reject) {
    exec(command, (error, stdout, stderr) => {
      if (!error || (error && stderr === '')) {
        resolve(formatResults(stdout));
      } else {
        reject(new RipGrepError(error, stderr));
      }
    });
  });
}

function formatResults(stdout: string) {
  stdout = stdout.trim();

  if (!stdout) {
    return [];
  }

  return stdout
    .split('\n')
    .map((line) => JSON.parse(line));
}

export class RipGrepError {
  private error: ExecException;
  stderr: string;

  constructor(error: ExecException, stderr: string) {
    this.error = error;
    this.stderr = stderr;
  }

  get message(): string {
    return this.error.message;
  }

  toString() {
    return this.stderr || this.message;
  }
}
